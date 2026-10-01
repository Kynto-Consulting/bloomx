import { randomUUID } from 'node:crypto';
import { execute, isMissingRelation, query, toIso } from '@/lib/admin/sql';
import { prisma } from '@/lib/prisma';
import { getMfaStatus, MfaStoreUnavailableError } from '@/lib/mfa';
import { findUserByEmail } from '@/lib/user-lookup';
import {
    DENIAL_STATUS, LEVEL_NAMES, MAX_PRIVILEGED_ACCOUNTS, checkPermissionChange, effectiveLevelSync, emailsAtLeast, envAdminEmails, isLevel, isPermissionsLocked,
    normalizeEmail, peekPermissionSnapshot, permissionSnapshotAge, setPermissionSnapshot, type EffectiveLevel, type PermissionLevel,
} from './permissions-core';

/**
 * Almacen de niveles de permisos (tabla aditiva "UserPermission" + historial). La instantanea en memoria se refresca con un TTL
 * corto (30 s): un cambio aplica a las sesiones abiertas de las demas instancias serverless en <= 30 s y en esta, al instante.
 * Falla CERRADO: si la BD no responde se conserva la ultima instantanea como mucho 5 minutos y despues solo vale el entorno.
 */

/** Error de regla de negocio (la ruta lo traduce a HttpError: este modulo no importa admin/http para evitar ciclos). */
export class PermissionError extends Error {
    constructor(public status: number, public code: string, message?: string) {
        super(message ?? code);
        this.name = 'PermissionError';
    }
}

export const PERMISSIONS_TTL_MS = 30_000;
export const PERMISSIONS_STALE_LIMIT_MS = 5 * 60_000;

function skipInTests(): boolean {
    // Las pruebas unitarias no tocan la BD; las de integracion (npm run test:pg) si (definen PG_TEST_URL).
    return (process.env.NODE_ENV === 'test' || !!process.env.VITEST) && !process.env.PG_TEST_URL;
}

let inflight: Promise<void> | null = null;

/** Refresca la instantanea (si esta caducada o con `force`). Nunca lanza. */
export async function refreshPermissions(opts: { force?: boolean } = {}): Promise<void> {
    if (isPermissionsLocked()) { setPermissionSnapshot([]); return; }
    if (skipInTests()) return;
    if (!opts.force && permissionSnapshotAge() < PERMISSIONS_TTL_MS) return;
    if (inflight && !opts.force) return inflight;
    const run = (async () => {
        try {
            const rows = await query<{ email: string; permission_level: number }>(`SELECT "email", "permission_level" FROM "UserPermission" WHERE "permission_level" > 0`);
            setPermissionSnapshot(rows.filter((r) => isLevel(Number(r.permission_level))).map((r) => [normalizeEmail(r.email), Number(r.permission_level) as PermissionLevel]));
        } catch (error) {
            if (isMissingRelation(error)) { setPermissionSnapshot([]); return; } // despliegue sin db:ensure: solo entorno
            if (permissionSnapshotAge() > PERMISSIONS_STALE_LIMIT_MS) setPermissionSnapshot([]); // fail closed tras 5 min sin poder leer
        }
    })().finally(() => { inflight = null; });
    inflight = run;
    return run;
}

/** Nivel efectivo (entorno + consola) de un correo, con la instantanea fresca. */
export async function getEffectiveLevel(email: unknown): Promise<EffectiveLevel> {
    await refreshPermissions();
    return effectiveLevelSync(email);
}

// ---------------------------------------------------------------------------------------------------------------------
// Listados
// ---------------------------------------------------------------------------------------------------------------------
export interface PermissionAccount {
    email: string; name: string | null; userId: string | null; level: PermissionLevel; levelName: string; source: 'env' | 'console';
    grantedBy: string | null; grantedAt: string | null; note: string | null; mfaEnabled: boolean | null;
    /** Acceso privilegiado bloqueado por pelea de sesiones (desbloquea un superadmin: perms unlock). */
    locked: boolean;
}

export async function listPermissionAccounts(): Promise<PermissionAccount[]> {
    await refreshPermissions({ force: true });
    const locked = isPermissionsLocked();
    const rows = locked ? [] : await query<{ email: string; userId: string | null; permission_level: number; grantedBy: string | null; grantedAt: Date; note: string | null }>(
        `SELECT "email","userId","permission_level","grantedBy","grantedAt","note" FROM "UserPermission" WHERE "permission_level" > 0 ORDER BY "permission_level" DESC, "email"`,
    ).catch((e) => { if (isMissingRelation(e)) return []; throw e; });
    const envEmails = envAdminEmails();
    const emails = [...new Set([...envEmails, ...rows.map((r) => r.email)])];
    const users = emails.length
        ? await query<{ id: string; email: string; name: string | null; mfa: boolean | null }>(
            `SELECT u."id", lower(u."email") AS email, u."name", (SELECT m."enabled" FROM "UserMfa" m WHERE m."userId" = u."id") AS mfa FROM "User" u WHERE lower(u."email") = ANY($1::text[])`, emails,
        ).catch(async (e) => {
            if (!isMissingRelation(e)) throw e;
            return (await query<{ id: string; email: string; name: string | null }>(`SELECT "id", lower("email") AS email, "name" FROM "User" WHERE lower("email") = ANY($1::text[])`, emails)).map((u) => ({ ...u, mfa: null }));
        })
        : [];
    const byEmail = new Map(users.map((u) => [u.email, u]));
    const lockedIds = await (await import('./privileged-session')).lockedUserIds().catch(() => new Set<string>());
    const out: PermissionAccount[] = [];
    for (const e of envEmails) {
        const u = byEmail.get(e);
        const db = rows.find((r) => r.email === e);
        out.push({ email: e, name: u?.name ?? null, userId: u?.id ?? null, level: 4, levelName: LEVEL_NAMES[4], source: 'env', grantedBy: null, grantedAt: db ? toIso(db.grantedAt) : null, note: db?.note ?? null, mfaEnabled: u?.mfa ?? null, locked: !!u && lockedIds.has(u.id) });
    }
    for (const r of rows) {
        if (envEmails.includes(r.email)) continue;
        const u = byEmail.get(r.email);
        const level = Number(r.permission_level) as PermissionLevel;
        out.push({ email: r.email, name: u?.name ?? null, userId: u?.id ?? r.userId, level, levelName: LEVEL_NAMES[level], source: 'console', grantedBy: r.grantedBy, grantedAt: toIso(r.grantedAt), note: r.note, mfaEnabled: u?.mfa ?? null, locked: !!(u?.id ?? r.userId) && lockedIds.has((u?.id ?? r.userId) as string) });
    }
    return out.sort((a, b) => b.level - a.level || a.email.localeCompare(b.email));
}

export interface PermissionHistoryRow { id: string; email: string; previousLevel: number; newLevel: number; changedBy: string | null; changedByLevel: number | null; changedAt: string | null; ip: string | null; source: string | null; note: string | null }

export async function permissionHistory(opts: { email?: string; limit?: number } = {}): Promise<PermissionHistoryRow[]> {
    const limit = Math.min(200, Math.max(1, Math.trunc(opts.limit ?? 50)));
    const email = opts.email ? normalizeEmail(opts.email) : null;
    const rows = await query<any>(
        `SELECT "id","email","previousLevel","newLevel","changedBy","changedByLevel","changedAt","ip","source","note" FROM "UserPermissionHistory"
         WHERE ($1::text IS NULL OR "email" = $1) ORDER BY "changedAt" DESC, "id" DESC LIMIT ${limit}`, email,
    ).catch((e) => { if (isMissingRelation(e)) return []; throw e; });
    return rows.map((r: any) => ({ ...r, previousLevel: Number(r.previousLevel), newLevel: Number(r.newLevel), changedByLevel: r.changedByLevel === null ? null : Number(r.changedByLevel), changedAt: toIso(r.changedAt) }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Cambio de nivel
// ---------------------------------------------------------------------------------------------------------------------
export interface ChangeArgs {
    actor: { kind: 'user' | 'manager'; id?: string; email: string; level: PermissionLevel };
    targetEmail: string;
    newLevel: number;
    note?: string;
    confirmSuper?: boolean;
    ip: string;
    source: 'console' | 'cli' | 'api';
}
export interface ChangeResult { email: string; userId: string | null; from: PermissionLevel; to: PermissionLevel; fromSource: string; privileged: number }

const mfaEnforced = () => process.env.MFA_REQUIRED_ALL === 'true' || process.env.MFA_ENFORCE_ADMIN !== 'false';

export async function changePermission(a: ChangeArgs): Promise<ChangeResult> {
    const email = normalizeEmail(a.targetEmail);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new PermissionError(400, 'invalid_input', 'Invalid input: email');
    if (!isLevel(a.newLevel)) throw new PermissionError(400, 'invalid_level', 'permission_level must be an integer 0..4');
    await refreshPermissions({ force: true });

    const user = await findUserByEmail(email);
    let mfaEnabled = false;
    if (user) {
        try { mfaEnabled = (await getMfaStatus(user.id)).enabled; } catch (e) { if (!(e instanceof MfaStoreUnavailableError)) throw e; }
    }
    const current = effectiveLevelSync(email);
    const privilegedCount = emailsAtLeast(3).length;
    const denial = checkPermissionChange({
        actor: { email: a.actor.email, level: a.actor.level },
        target: { email, level: current, hasAccount: !!user, mfaEnabled },
        newLevel: a.newLevel, locked: isPermissionsLocked(), mfaEnforced: mfaEnforced(), privilegedCount, confirmSuper: a.confirmSuper,
    });
    if (denial) throw new PermissionError(DENIAL_STATUS[denial], denial, denial === 'privileged_limit' ? `Limit of ${MAX_PRIVILEGED_ACCOUNTS} accounts with level >= 3` : denial);

    const to = a.newLevel as PermissionLevel;
    const by = a.actor.email || a.actor.id || 'unknown';
    const note = a.note ? String(a.note).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300) || null : null;
    await prisma.$transaction([
        prisma.$executeRawUnsafe(
            `INSERT INTO "UserPermission" ("email","userId","permission_level","grantedBy","grantedAt","updatedAt","note")
             VALUES ($1,$2,$3,$4,NOW(),NOW(),$5)
             ON CONFLICT ("email") DO UPDATE SET "permission_level" = EXCLUDED."permission_level", "userId" = COALESCE(EXCLUDED."userId","UserPermission"."userId"),
                 "grantedBy" = EXCLUDED."grantedBy", "updatedAt" = NOW(), "note" = EXCLUDED."note"`,
            email, user?.id ?? null, to, by, note,
        ),
        prisma.$executeRawUnsafe(
            `INSERT INTO "UserPermissionHistory" ("id","email","userId","previousLevel","newLevel","changedBy","changedByLevel","changedAt","ip","source","note")
             VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8,$9,$10)`,
            randomUUID(), email, user?.id ?? null, current.level, to, by, a.actor.level, String(a.ip).slice(0, 64), a.source, note,
        ),
    ]);
    await refreshPermissions({ force: true });

    // Al bajar (o quitar) el nivel se invalidan SUS tokens de CLI al instante; las sesiones web siguen la instantanea (<= 30 s).
    if (to < current.level && user) {
        const { revokeAllCliTokens } = await import('./admin-cli/tokens');
        await revokeAllCliTokens(user.id).catch(() => undefined);
    }
    // Nivel 0: se revoca tambien su sesion privilegiada (web o CLI) y se libera el slot.
    if (to === 0 && user) {
        const { closePrivileged } = await import('./privileged-session');
        await closePrivileged(user.id).catch(() => undefined);
    }
    return { email, userId: user?.id ?? null, from: current.level, to, fromSource: current.source, privileged: emailsAtLeast(3).length };
}

/** Aviso por correo (mejor esfuerzo, como el de importar/exportar) al afectado y a los superadmins. Nunca rompe el cambio. */
export async function notifyPermissionChange(r: ChangeResult, actorEmail: string): Promise<void> {
    const topDomain = process.env.TOP_DOMAIN;
    if (!topDomain || !process.env.RESEND_API_KEY) return;
    const recipients = [...new Set([r.email, ...emailsAtLeast(4)])].filter((e) => normalizeEmail(e) !== normalizeEmail(actorEmail) || e === r.email).slice(0, 30);
    if (recipients.length === 0) return;
    try {
        const { resend } = await import('@/lib/resend');
        for (const to of recipients) {
            const self = to === r.email;
            await resend.emails.send({
                from: `noreply@${topDomain}`,
                to,
                subject: self ? 'Tu nivel de permisos de administración ha cambiado' : 'Cambio de niveles de permisos de administración',
                text: `${self ? 'Tu nivel de permisos' : `El nivel de permisos de ${r.email}`} en ${topDomain} pasó de ${r.from} (${LEVEL_NAMES[r.from]}) a ${r.to} (${LEVEL_NAMES[r.to]}), cambio hecho por ${actorEmail}. Si no lo esperabas, contacta con un superadministrador.\n\n${self ? 'Your permission level' : `The permission level of ${r.email}`} on ${topDomain} changed from ${r.from} (${LEVEL_NAMES[r.from]}) to ${r.to} (${LEVEL_NAMES[r.to]}), changed by ${actorEmail}. If you did not expect this, contact a super administrator.`,
                headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
            }).catch(() => undefined);
        }
    } catch { /* aviso opcional */ }
}

export { peekPermissionSnapshot };
void execute;
