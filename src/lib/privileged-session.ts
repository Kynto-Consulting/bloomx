import { prisma } from './prisma';
import { execute, isMissingRelation, query, toIso } from './admin/sql';
import { auditLog } from './audit';
import { effectiveLevelSync, emailsAtLeast, normalizeEmail } from './permissions-core';
import { deviceKey, deviceLabel, sendNotice, type DeviceInfo } from './privileged-notify';

/**
 * UNA sola sesion privilegiada por cuenta (permission_level >= 1): la consola web de administracion (/admin/**, incluida la consola de
 * comandos) y el CLI interactivo (token de CLI) comparten un unico slot (tabla "PrivilegedSession", una fila por usuario).
 *
 *  - Se "entra" en el primer uso de admin de una sesion web (jti) o de un token interactivo (id) que NO es el dueno del slot. Renovaciones
 *    deslizantes y refrescos conservan el jti: no son una sesion nueva. El correo web normal (sin entrar al admin) no se toca.
 *  - La sesion nueva GANA: la anterior se REVOCA en el acto (jti en RevokedSession / token revocado) y se anota por que (PrivilegedSessionEnd)
 *    para mostrar un mensaje claro cuando se vuelva a usar (401 `superseded`). Dos entradas simultaneas se serializan con un candado
 *    consultivo por usuario dentro de una transaccion: gana una, la otra queda revocada.
 *  - Cierre por INACTIVIDAD (15 min por defecto, 5..60 configurable por instancia) y tope ABSOLUTO (12 h): 401 `expired`.
 *  - >= 3 reemplazos en 10 min (configurable) => BLOQUEO del acceso privilegiado hasta que un superadmin la desbloquee.
 *  - Los tokens "machine" (automatizacion, solo lectura) NO ocupan el slot, pero respetan el bloqueo.
 */

export const IDLE_DEFAULT_MIN = 15;
export const IDLE_MIN = 5;
export const IDLE_MAX = 60;
export const ABSOLUTE_MAX_MS = 12 * 3600_000;
export const LOCK_THRESHOLD_DEFAULT = 3;
export const LOCK_WINDOW_DEFAULT_MIN = 10;
const TOUCH_EVERY_MS = 15_000;
const SETTING_KEY = 'privileged_session';

export interface PrivilegedPolicy { idleMinutes: number; lockThreshold: number; lockWindowMinutes: number; absoluteHours: number }
export const POLICY_LIMITS = { idleMinutes: { min: IDLE_MIN, max: IDLE_MAX }, lockThreshold: { min: 2, max: 10 }, lockWindowMinutes: { min: 1, max: 60 } } as const;
const clampInt = (v: unknown, min: number, max: number, def: number) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };

function skipInTests(): boolean {
    return (process.env.NODE_ENV === 'test' || !!process.env.VITEST) && !process.env.PG_TEST_URL;
}

// --- politica (AdminSetting, cache 30 s) ---
let policyCache: { at: number; value: PrivilegedPolicy } | null = null;
export const __resetPrivilegedPolicyCache = () => { policyCache = null; };

export async function getPrivilegedPolicy(): Promise<PrivilegedPolicy> {
    if (policyCache && Date.now() - policyCache.at < 30_000) return policyCache.value;
    let raw: Record<string, unknown> = {};
    try {
        const rows = await query<{ value: unknown }>(`SELECT "value" FROM "AdminSetting" WHERE "key" = $1`, SETTING_KEY);
        if (rows[0]?.value && typeof rows[0].value === 'object') raw = rows[0].value as Record<string, unknown>;
    } catch (e) { if (!isMissingRelation(e)) throw e; }
    const value: PrivilegedPolicy = {
        idleMinutes: clampInt(raw.idleMinutes, IDLE_MIN, IDLE_MAX, IDLE_DEFAULT_MIN),
        lockThreshold: clampInt(raw.lockThreshold, 2, 10, LOCK_THRESHOLD_DEFAULT),
        lockWindowMinutes: clampInt(raw.lockWindowMinutes, 1, 60, LOCK_WINDOW_DEFAULT_MIN),
        absoluteHours: ABSOLUTE_MAX_MS / 3600_000,
    };
    policyCache = { at: Date.now(), value };
    return value;
}

export async function setPrivilegedPolicy(patch: Partial<Pick<PrivilegedPolicy, 'idleMinutes' | 'lockThreshold' | 'lockWindowMinutes'>>, by: string): Promise<PrivilegedPolicy> {
    const cur = await getPrivilegedPolicy();
    const next = {
        idleMinutes: patch.idleMinutes === undefined ? cur.idleMinutes : clampInt(patch.idleMinutes, IDLE_MIN, IDLE_MAX, cur.idleMinutes),
        lockThreshold: patch.lockThreshold === undefined ? cur.lockThreshold : clampInt(patch.lockThreshold, 2, 10, cur.lockThreshold),
        lockWindowMinutes: patch.lockWindowMinutes === undefined ? cur.lockWindowMinutes : clampInt(patch.lockWindowMinutes, 1, 60, cur.lockWindowMinutes),
    };
    await execute(
        `INSERT INTO "AdminSetting" ("key","value","updatedAt","updatedBy") VALUES ($1,$2::jsonb,NOW(),$3)
         ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW(), "updatedBy" = EXCLUDED."updatedBy"`,
        SETTING_KEY, JSON.stringify(next), by.slice(0, 200),
    );
    policyCache = null;
    return getPrivilegedPolicy();
}

// --- filas ---
export type SlotKind = 'web' | 'cli';
export interface SlotRow { userId: string; kind: SlotKind; sessionRef: string; ip: string | null; userAgent: string | null; createdAt: Date; lastSeenAt: Date }
export type EndReason = 'superseded' | 'expired_idle' | 'expired_absolute' | 'closed' | 'locked';
export interface EndRow { sessionRef: string; userId: string; kind: SlotKind; reason: EndReason; endedAt: string | null; byKind: SlotKind | null; byIp: string | null; byUserAgent: string | null }

const cleanStr = (v: string | null | undefined, n: number) => (v ? String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n) : null);

async function getSlot(userId: string): Promise<SlotRow | null> {
    try {
        const r = await query<SlotRow>(`SELECT "userId","kind","sessionRef","ip","userAgent","createdAt","lastSeenAt" FROM "PrivilegedSession" WHERE "userId" = $1`, userId);
        return r[0] ?? null;
    } catch (e) { if (isMissingRelation(e)) return null; throw e; }
}

export async function getEnd(sessionRef: string): Promise<EndRow | null> {
    try {
        const r = await query<any>(`SELECT "sessionRef","userId","kind","reason","endedAt","byKind","byIp","byUserAgent" FROM "PrivilegedSessionEnd" WHERE "sessionRef" = $1`, sessionRef);
        return r[0] ? { ...r[0], endedAt: toIso(r[0].endedAt) } : null;
    } catch (e) { if (isMissingRelation(e)) return null; throw e; }
}

async function recordEnd(slot: Pick<SlotRow, 'sessionRef' | 'userId' | 'kind'>, reason: EndReason, by?: { kind: SlotKind; ip: string | null; userAgent: string | null }) {
    try {
        await execute(
            `INSERT INTO "PrivilegedSessionEnd" ("sessionRef","userId","kind","reason","endedAt","byKind","byIp","byUserAgent") VALUES ($1,$2,$3,$4,NOW(),$5,$6,$7)
             ON CONFLICT ("sessionRef") DO UPDATE SET "reason" = EXCLUDED."reason", "endedAt" = NOW(), "byKind" = EXCLUDED."byKind", "byIp" = EXCLUDED."byIp", "byUserAgent" = EXCLUDED."byUserAgent"`,
            slot.sessionRef, slot.userId, slot.kind, reason, by?.kind ?? null, cleanStr(by?.ip, 64), cleanStr(by?.userAgent, 300),
        );
        if (Math.random() < 0.02) void execute(`DELETE FROM "PrivilegedSessionEnd" WHERE "endedAt" < NOW() - INTERVAL '30 days'`).catch(() => undefined);
    } catch (e) { if (!isMissingRelation(e)) throw e; }
}

/** Revoca en servidor la sesion que ocupa el slot: jti en la lista de revocados (web) o token de CLI revocado. */
async function revokeOwner(slot: Pick<SlotRow, 'userId' | 'kind' | 'sessionRef'>): Promise<void> {
    if (slot.kind === 'web') {
        const { findSessionOfUser } = await import('./admin/session-registry');
        const { revokeSession } = await import('./session-revocation');
        const reg = await findSessionOfUser(slot.userId, slot.sessionRef).catch(() => null);
        await revokeSession(slot.sessionRef, slot.userId, reg ? Math.floor(new Date(reg.expiresAt).getTime() / 1000) : undefined);
    } else {
        const { revokeCliToken } = await import('./admin-cli/tokens');
        await revokeCliToken(slot.userId, slot.sessionRef);
    }
}

const info = (kind: SlotKind | null, ip: string | null, ua: string | null, at: Date | string | null): DeviceInfo => ({ kind, ip, device: deviceLabel(ua), at: at ? toIso(at) : null });

// ---------------------------------------------------------------------------------------------------------------------
// Entrada, inactividad y reemplazo
// ---------------------------------------------------------------------------------------------------------------------
export interface EnterInput {
    userId: string;
    email: string;
    level: number;
    kind: SlotKind;
    /** jti (web) o id del token (cli). */
    ref: string;
    ip: string | null;
    userAgent: string | null;
    /** Peticion pasiva (sondeo de estado): se valida pero no cuenta como actividad. */
    passive?: boolean;
}
export type DeniedReason = 'superseded' | 'expired_idle' | 'expired_absolute' | 'locked';
export type EnterResult = { ok: true; superseded?: boolean } | { ok: false; reason: DeniedReason; end?: EndRow | null };

export async function isLocked(userId: string, email?: string): Promise<boolean> {
    if (skipInTests()) return false;
    try {
        // Rescate por entorno: los correos de ADMIN_LOCKOUT_RESET quedan desbloqueados (quitar la variable despues).
        if (email && String(process.env.ADMIN_LOCKOUT_RESET || '').split(',').map(normalizeEmail).includes(normalizeEmail(email))) {
            await execute(`DELETE FROM "PrivilegedLock" WHERE "userId" = $1`, userId);
            return false;
        }
        const r = await query<{ userId: string }>(`SELECT "userId" FROM "PrivilegedLock" WHERE "userId" = $1`, userId);
        return r.length > 0;
    } catch (e) { if (isMissingRelation(e)) return false; throw e; }
}

async function endAndDeny(slot: SlotRow, reason: 'expired_idle' | 'expired_absolute', email: string): Promise<EnterResult> {
    await revokeOwner(slot).catch(() => undefined);
    await execute(`DELETE FROM "PrivilegedSession" WHERE "userId" = $1 AND "sessionRef" = $2`, slot.userId, slot.sessionRef);
    await recordEnd(slot, reason);
    auditLog('admin.session.expired', { userId: slot.userId, ip: slot.ip, kind: slot.kind, reason });
    void sendNotice({ userId: slot.userId, email }, { type: 'expired', old: info(slot.kind, slot.ip, slot.userAgent, slot.createdAt), reason });
    return { ok: false, reason, end: await getEnd(slot.sessionRef) };
}

export async function enterPrivileged(i: EnterInput): Promise<EnterResult> {
    if (skipInTests() || i.level < 1) return { ok: true };
    if (await isLocked(i.userId, i.email)) return { ok: false, reason: 'locked' };

    const policy = await getPrivilegedPolicy();
    const idleMs = policy.idleMinutes * 60_000;
    const now = Date.now();
    const slot = await getSlot(i.userId);

    if (slot && slot.sessionRef === i.ref) {
        if (now - new Date(slot.createdAt).getTime() > ABSOLUTE_MAX_MS) return endAndDeny(slot, 'expired_absolute', i.email);
        if (now - new Date(slot.lastSeenAt).getTime() > idleMs) return endAndDeny(slot, 'expired_idle', i.email);
        if (!i.passive && now - new Date(slot.lastSeenAt).getTime() > TOUCH_EVERY_MS) {
            await execute(`UPDATE "PrivilegedSession" SET "lastSeenAt" = NOW() WHERE "userId" = $1 AND "sessionRef" = $2`, i.userId, i.ref);
        }
        return { ok: true };
    }

    // --- sesion NUEVA: reclamar el slot (serializado por usuario) ---
    let old: SlotRow | null = null;
    try {
        old = await prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `privslot:${i.userId}`);
            const rows = (await tx.$queryRawUnsafe(`SELECT "userId","kind","sessionRef","ip","userAgent","createdAt","lastSeenAt" FROM "PrivilegedSession" WHERE "userId" = $1`, i.userId)) as SlotRow[];
            const prev = rows[0] ?? null;
            if (prev && prev.sessionRef === i.ref) return null; // otra peticion en paralelo ya la reclamo
            await tx.$executeRawUnsafe(
                `INSERT INTO "PrivilegedSession" ("userId","kind","sessionRef","ip","userAgent","createdAt","lastSeenAt") VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
                 ON CONFLICT ("userId") DO UPDATE SET "kind" = EXCLUDED."kind", "sessionRef" = EXCLUDED."sessionRef", "ip" = EXCLUDED."ip", "userAgent" = EXCLUDED."userAgent", "createdAt" = NOW(), "lastSeenAt" = NOW()`,
                i.userId, i.kind, i.ref, cleanStr(i.ip, 64), cleanStr(i.userAgent, 300),
            );
            return prev;
        });
    } catch (e) {
        if (isMissingRelation(e)) return { ok: true }; // despliegue sin db:ensure: sin slot (no se puede imponer)
        throw e;
    }
    if (!old) return { ok: true };

    // Reemplazo: revocar a la anterior (aunque ya estuviera caducada) y anotar el motivo. Solo un reemplazo VIVO genera avisos/bloqueo.
    const live = now - new Date(old.lastSeenAt).getTime() <= idleMs && now - new Date(old.createdAt).getTime() <= ABSOLUTE_MAX_MS;
    await revokeOwner(old).catch(() => undefined);
    await recordEnd(old, live ? 'superseded' : 'expired_idle', { kind: i.kind, ip: i.ip, userAgent: i.userAgent });
    if (!live) return { ok: true };

    const oldInfo = info(old.kind, old.ip, old.userAgent, old.createdAt);
    const nowInfo = info(i.kind, i.ip, i.userAgent, new Date());
    const suspicious = (old.ip ?? '') !== (i.ip ?? '') || deviceKey(old.userAgent) !== deviceKey(i.userAgent);
    auditLog('admin.session.superseded', { userId: i.userId, ip: i.ip, oldKind: old.kind, newKind: i.kind, oldIp: old.ip, suspicious });
    if (suspicious) auditLog('admin.session.superseded.suspicious', { userId: i.userId, ip: i.ip, oldKind: old.kind, newKind: i.kind, oldIp: old.ip, oldDevice: oldInfo.device, newDevice: nowInfo.device });
    void sendNotice({ userId: i.userId, email: i.email }, { type: 'superseded', old: oldInfo, now: nowInfo, suspicious });
    if (suspicious) void alertSuperAdmins(i.email, { type: 'suspicious_alert', targetEmail: i.email, old: oldInfo, now: nowInfo });

    // "Pelea de sesiones": demasiados reemplazos en la ventana => bloqueo del acceso privilegiado.
    const locked = await maybeLock(i, policy);
    if (locked) return { ok: false, reason: 'locked' };
    return { ok: true, superseded: true };
}

async function alertSuperAdmins(targetEmail: string, notice: Parameters<typeof sendNotice>[1]): Promise<void> {
    try {
        const emails = emailsAtLeast(4).filter((e) => normalizeEmail(e) !== normalizeEmail(targetEmail));
        if (emails.length === 0) return;
        const users = await query<{ id: string; email: string }>(`SELECT "id", lower("email") AS email FROM "User" WHERE lower("email") = ANY($1::text[])`, emails).catch(() => []);
        const byEmail = new Map(users.map((u) => [u.email, u.id]));
        for (const e of emails.slice(0, 25)) await sendNotice({ userId: byEmail.get(e) ?? null, email: e }, notice);
    } catch { /* alerta opcional */ }
}

async function maybeLock(i: EnterInput, policy: PrivilegedPolicy): Promise<boolean> {
    const r = await query<{ n: bigint | number }>(
        `SELECT COUNT(*) AS n FROM "PrivilegedSessionEnd" WHERE "userId" = $1 AND "reason" = 'superseded' AND "endedAt" > NOW() - make_interval(mins => $2::int)`,
        i.userId, policy.lockWindowMinutes,
    );
    const replacements = Number(r[0]?.n ?? 0);
    if (replacements < policy.lockThreshold) return false;
    await execute(
        `INSERT INTO "PrivilegedLock" ("userId","email","lockedAt","replacements","reason") VALUES ($1,$2,NOW(),$3,'session_fight')
         ON CONFLICT ("userId") DO UPDATE SET "lockedAt" = NOW(), "replacements" = EXCLUDED."replacements", "email" = EXCLUDED."email"`,
        i.userId, normalizeEmail(i.email), replacements,
    );
    // Se cierra TAMBIEN la sesion que acaba de entrar y se libera el slot: nadie conserva acceso privilegiado hasta el desbloqueo.
    const cur = await getSlot(i.userId);
    if (cur) { await revokeOwner(cur).catch(() => undefined); await recordEnd(cur, 'locked'); await execute(`DELETE FROM "PrivilegedSession" WHERE "userId" = $1`, i.userId); }
    auditLog('admin.session.lockout', { userId: i.userId, ip: i.ip, replacements, windowMinutes: policy.lockWindowMinutes });
    void sendNotice({ userId: i.userId, email: i.email }, { type: 'lockout', replacements, windowMinutes: policy.lockWindowMinutes });
    void alertSuperAdmins(i.email, { type: 'lockout_alert', targetEmail: i.email, replacements, windowMinutes: policy.lockWindowMinutes });
    return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// Estado, cierre y liberacion
// ---------------------------------------------------------------------------------------------------------------------
export interface PrivilegedStatus {
    active: { kind: SlotKind; ip: string | null; device: string; since: string | null; lastSeenAt: string | null; refShort: string; expiresIdleAt: string | null; expiresAbsoluteAt: string | null } | null;
    locked: { at: string | null; replacements: number } | null;
    policy: PrivilegedPolicy;
}

export async function getPrivilegedStatus(userId: string): Promise<PrivilegedStatus> {
    const policy = await getPrivilegedPolicy();
    const slot = await getSlot(userId);
    const lockRows = await query<{ lockedAt: Date; replacements: number }>(`SELECT "lockedAt","replacements" FROM "PrivilegedLock" WHERE "userId" = $1`, userId).catch(() => []);
    return {
        active: slot ? {
            kind: slot.kind, ip: slot.ip, device: deviceLabel(slot.userAgent), since: toIso(slot.createdAt), lastSeenAt: toIso(slot.lastSeenAt), refShort: slot.sessionRef.slice(0, 8),
            expiresIdleAt: new Date(new Date(slot.lastSeenAt).getTime() + policy.idleMinutes * 60_000).toISOString(),
            expiresAbsoluteAt: new Date(new Date(slot.createdAt).getTime() + ABSOLUTE_MAX_MS).toISOString(),
        } : null,
        locked: lockRows[0] ? { at: toIso(lockRows[0].lockedAt), replacements: Number(lockRows[0].replacements) } : null,
        policy,
    };
}

/** Cierra la sesion privilegiada vigente de la cuenta (boton "Cerrar sesion privilegiada" / nivel 0): la revoca y libera el slot. */
export async function closePrivileged(userId: string, reason: EndReason = 'closed'): Promise<{ closed: boolean; kind: SlotKind | null }> {
    const slot = await getSlot(userId);
    if (!slot) return { closed: false, kind: null };
    await revokeOwner(slot).catch(() => undefined);
    await execute(`DELETE FROM "PrivilegedSession" WHERE "userId" = $1`, userId);
    await recordEnd(slot, reason);
    auditLog('admin.session.closed', { userId, kind: slot.kind, reason });
    return { closed: true, kind: slot.kind };
}

/** Logout / caducidad normal: libera el slot si lo ocupaba esa sesion (la sesion ya esta revocada por el logout). */
export async function releaseIfOwner(userId: string, ref: string): Promise<void> {
    try { await execute(`DELETE FROM "PrivilegedSession" WHERE "userId" = $1 AND "sessionRef" = $2`, userId, ref); } catch (e) { if (!isMissingRelation(e)) throw e; }
}

/** Desbloquea una cuenta (superadmin con step-up, o el rescate por entorno). */
export async function unlockAccount(userId: string): Promise<boolean> {
    const n = await execute(`DELETE FROM "PrivilegedLock" WHERE "userId" = $1`, userId);
    if (n > 0) auditLog('admin.session.unlocked', { userId });
    return n > 0;
}

export async function lockedUserIds(): Promise<Set<string>> {
    try { return new Set((await query<{ userId: string }>(`SELECT "userId" FROM "PrivilegedLock"`)).map((r) => r.userId)); } catch (e) { if (isMissingRelation(e)) return new Set(); throw e; }
}

/** jti de la cookie de sesion SIN comprobar revocacion (para explicar por que una sesion revocada ya no vale). */
export async function peekSessionJti(): Promise<string | null> {
    try {
        const { cookies } = await import('next/headers');
        const { readSessionCookie } = await import('./session-cookie');
        const { verifyJWT } = await import('./jwt');
        const token = readSessionCookie(await cookies()).token;
        if (!token) return null;
        const p = await verifyJWT(token);
        return typeof p?.jti === 'string' ? p.jti : null;
    } catch { return null; }
}

export { effectiveLevelSync };
