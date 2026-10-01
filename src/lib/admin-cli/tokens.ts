import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { decrypt, encrypt } from '@/lib/encryption';
import { execute, query, tolerant, toIso } from '@/lib/admin/sql';
import { SCOPE_MIN_LEVEL } from '../admin-levels';
import { isLevel, type PermissionLevel } from '../permissions-core';
import { CmdError, SCOPES, type Scope } from './types';

/**
 * Tokens de CLI (tabla aditiva "AdminCliToken"). Se muestran UNA sola vez; en BD solo vive el SHA-256 (nunca el valor).
 *
 *  - formato `bxa_<43 caracteres base64url>` (256 bits de entropia: un hash rapido es suficiente, no hace falta KDF lento).
 *  - nombre, ambitos (read / write / security), caducidad (defecto 12 h, maximo 30 d), ultimo uso (hora, IP, agente), revocable.
 *  - limite de tokens ACTIVOS por administrador.
 *  - para admins de tipo "manager" se guarda CIFRADA (AES-GCM, lib/encryption) la cookie de sesion del backend, para que los
 *    comandos que hablan con el backend compartido (extensiones, clave de firma, dominio) funcionen igual que en la web.
 *    Se borra al revocar/caducar y nunca se devuelve ni se audita.
 */

export const TOKEN_PREFIX = 'bxa_';
export const DEFAULT_TTL_HOURS = 12;
export const MAX_TTL_HOURS = 30 * 24;
export const MIN_TTL_HOURS = 5 / 60;
export const MAX_ACTIVE_TOKENS_PER_ADMIN = 10;
/** Tokens "machine" (cron/CI): solo lectura, corta duracion (24 h por defecto, 7 d maximo), nunca nivel 4 y NO ocupan el slot de sesion privilegiada. */
export type TokenClass = 'interactive' | 'machine';
export const MACHINE_DEFAULT_TTL_HOURS = 24;
export const MACHINE_MAX_TTL_HOURS = 7 * 24;
export const MACHINE_MAX_LEVEL = 3;
export const MACHINE_SCOPES: readonly Scope[] = ['read'];

export const hashToken = (plain: string): string => createHash('sha256').update(plain, 'utf8').digest('hex');

export function looksLikeToken(value: unknown): value is string {
    return typeof value === 'string' && /^bxa_[A-Za-z0-9_-]{43}$/.test(value);
}

export function generateToken(): string {
    return `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** `write` incluye `read`; `security` incluye ambos. */
export function scopeAllows(granted: readonly Scope[], required: Scope): boolean {
    if (granted.includes('security')) return true;
    if (granted.includes('write')) return required === 'read' || required === 'write';
    return granted.includes('read') && required === 'read';
}

export function normalizeScopes(input: unknown): Scope[] {
    const list = Array.isArray(input) ? input : typeof input === 'string' ? input.split(',') : [];
    const out = Array.from(new Set(list.map((s) => String(s).trim()).filter(Boolean)));
    if (out.length === 0) return ['read'];
    for (const s of out) if (!(SCOPES as readonly string[]).includes(s)) throw new CmdError('invalid_scope', `Unknown scope: ${s.slice(0, 20)}`, 2);
    return out as Scope[];
}

/** Ambitos que un nivel puede tener en un token (read desde 1, write desde 2, security desde 2). */
export function scopesAllowedForLevel(level: number): Scope[] {
    return (SCOPES as readonly Scope[]).filter((s) => level >= SCOPE_MIN_LEVEL[s]);
}

export function clampTtlHours(input: unknown, cls: TokenClass = 'interactive'): number {
    const def = cls === 'machine' ? MACHINE_DEFAULT_TTL_HOURS : DEFAULT_TTL_HOURS;
    const max = cls === 'machine' ? MACHINE_MAX_TTL_HOURS : MAX_TTL_HOURS;
    if (input === undefined || input === null || input === '') return def;
    const n = Number(input);
    if (!Number.isFinite(n) || n <= 0) throw new CmdError('invalid_ttl', 'ttl must be a positive number of hours', 2);
    return Math.min(max, Math.max(MIN_TTL_HOURS, n));
}

export interface CliTokenRecord {
    id: string;
    name: string;
    kind: 'manager' | 'user';
    adminId: string;
    adminEmail: string | null;
    scopes: Scope[];
    domain: string | null;
    createdAt: string | null;
    expiresAt: string | null;
    lastUsedAt: string | null;
    lastUsedIp: string | null;
    lastUsedUa: string | null;
    createdIp: string | null;
    revokedAt: string | null;
    /** Tope de nivel (permission_level de la cuenta al emitir el token). */
    permissionLevel: PermissionLevel;
    tokenClass: TokenClass;
}

interface Row {
    id: string; name: string; kind: string; adminId: string; adminEmail: string | null; scopes: string; domain: string | null;
    createdAt: Date; expiresAt: Date; lastUsedAt: Date | null; lastUsedIp: string | null; lastUsedUa: string | null; createdIp: string | null;
    revokedAt: Date | null; managerSessionEnc?: string | null; permission_level?: number | null; class?: string | null;
}

const COLS = `"id","name","kind","adminId","adminEmail","scopes","domain","createdAt","expiresAt","lastUsedAt","lastUsedIp","lastUsedUa","createdIp","revokedAt","permission_level","class"`;

function toRecord(r: Row): CliTokenRecord {
    return {
        id: r.id, name: r.name, kind: r.kind === 'manager' ? 'manager' : 'user', adminId: r.adminId, adminEmail: r.adminEmail,
        scopes: normalizeScopes(r.scopes), domain: r.domain,
        createdAt: toIso(r.createdAt), expiresAt: toIso(r.expiresAt), lastUsedAt: toIso(r.lastUsedAt),
        lastUsedIp: r.lastUsedIp, lastUsedUa: r.lastUsedUa, createdIp: r.createdIp, revokedAt: toIso(r.revokedAt),
        permissionLevel: isLevel(Number(r.permission_level)) ? (Number(r.permission_level) as PermissionLevel) : 1,
        tokenClass: r.class === 'machine' ? 'machine' : 'interactive',
    };
}

const clean = (v: string | null | undefined, max: number) => (v ? String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : null);

export interface CreateTokenInput {
    kind: 'manager' | 'user';
    adminId: string;
    adminEmail?: string | null;
    name: string;
    scopes: Scope[];
    ttlHours?: number;
    ip?: string | null;
    domain?: string | null;
    /** Valor de la cookie `auth_session` del backend (solo managers). Se cifra. */
    managerSession?: string | null;
    /** Nivel de la cuenta al emitir: TOPE del token (nunca tiene mas nivel que la cuenta). */
    permissionLevel: PermissionLevel;
    /** machine: automatizacion (solo lectura, <= 7 d, nivel <= 3, sin slot). Por defecto interactive. */
    tokenClass?: TokenClass;
}

export async function countActiveTokens(adminId: string): Promise<number> {
    const rows = await tolerant(
        () => query<{ n: bigint | number }>(`SELECT COUNT(*) AS n FROM "AdminCliToken" WHERE "adminId" = $1 AND "revokedAt" IS NULL AND "expiresAt" > NOW()`, adminId),
        [{ n: 0 }],
    );
    return Number(rows[0]?.n ?? 0);
}

/** Crea un token. Devuelve el valor en claro UNA vez. */
export async function createCliToken(input: CreateTokenInput): Promise<{ token: string; record: CliTokenRecord }> {
    const name = (input.name || 'cli').trim().slice(0, 60) || 'cli';
    if (!isLevel(input.permissionLevel) || input.permissionLevel < 1) throw new CmdError('level_required', 'Only accounts with permission_level >= 1 can have CLI tokens', 1, 403);
    for (const sc of input.scopes) if (input.permissionLevel < SCOPE_MIN_LEVEL[sc]) throw new CmdError('scope_exceeds_level', `The scope "${sc}" needs permission_level >= ${SCOPE_MIN_LEVEL[sc]}`, 1, 403);
    const cls: TokenClass = input.tokenClass === 'machine' ? 'machine' : 'interactive';
    if (cls === 'machine') {
        for (const sc of input.scopes) if (!MACHINE_SCOPES.includes(sc)) throw new CmdError('scope_not_allowed_for_machine', 'Machine tokens are read-only', 1, 403);
        input = { ...input, permissionLevel: Math.min(input.permissionLevel, MACHINE_MAX_LEVEL) as PermissionLevel }; // nunca nivel 4
    }
    const ttl = clampTtlHours(input.ttlHours, cls);
    if ((await countActiveTokens(input.adminId)) >= MAX_ACTIVE_TOKENS_PER_ADMIN) {
        throw new CmdError('token_limit', `Active token limit reached (${MAX_ACTIVE_TOKENS_PER_ADMIN}). Revoke one first.`, 1, 409);
    }
    const token = generateToken();
    const id = randomUUID();
    const rows = await query<Row>(
        `INSERT INTO "AdminCliToken" ("id","tokenHash","name","kind","adminId","adminEmail","scopes","domain","createdAt","expiresAt","createdIp","managerSessionEnc","permission_level","class")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(), NOW() + make_interval(secs => $9::double precision), $10, $11, $12, $13)
         RETURNING ${COLS}`,
        id, hashToken(token), name, input.kind, input.adminId, input.adminEmail ?? null, input.scopes.join(','), input.domain ?? null,
        Math.round(ttl * 3600) as number, clean(input.ip, 64), input.managerSession ? encrypt(input.managerSession) : null, input.permissionLevel, cls,
    );
    return { token, record: toRecord(rows[0]) };
}

export type VerifyResult =
    | { ok: true; record: CliTokenRecord; managerSession: string | null }
    | { ok: false; reason: 'malformed' | 'unknown' | 'revoked' | 'expired' | 'unavailable'; tokenId?: string };

/** Verifica un token presentado: hash, caducidad y revocacion. Actualiza "ultimo uso" (como maximo una vez por minuto). */
export async function verifyCliToken(plain: unknown, meta: { ip?: string | null; ua?: string | null } = {}): Promise<VerifyResult> {
    if (!looksLikeToken(plain)) return { ok: false, reason: 'malformed' };
    let rows: (Row & { managerSessionEnc: string | null })[];
    try {
        rows = await query(`SELECT ${COLS}, "managerSessionEnc" FROM "AdminCliToken" WHERE "tokenHash" = $1`, hashToken(plain));
    } catch {
        return { ok: false, reason: 'unavailable' }; // falla cerrado
    }
    const r = rows[0];
    if (!r) return { ok: false, reason: 'unknown' };
    if (r.revokedAt) return { ok: false, reason: 'revoked', tokenId: r.id };
    if (new Date(r.expiresAt).getTime() <= Date.now()) return { ok: false, reason: 'expired', tokenId: r.id };
    void execute(
        `UPDATE "AdminCliToken" SET "lastUsedAt" = NOW(), "lastUsedIp" = $2, "lastUsedUa" = $3
         WHERE "id" = $1 AND ("lastUsedAt" IS NULL OR "lastUsedAt" < NOW() - INTERVAL '1 minute' OR "lastUsedIp" IS DISTINCT FROM $2)`,
        r.id, clean(meta.ip, 64), clean(meta.ua, 200),
    ).catch(() => undefined);
    let managerSession: string | null = null;
    if (r.managerSessionEnc) {
        try { managerSession = decrypt(r.managerSessionEnc); } catch { managerSession = null; }
    }
    return { ok: true, record: toRecord(r), managerSession };
}

export async function listCliTokens(adminId: string, opts: { includeInactive?: boolean } = {}): Promise<CliTokenRecord[]> {
    const rows = await tolerant(
        () => query<Row>(
            `SELECT ${COLS} FROM "AdminCliToken" WHERE "adminId" = $1 ${opts.includeInactive ? '' : `AND "revokedAt" IS NULL AND "expiresAt" > NOW()`} ORDER BY "createdAt" DESC LIMIT 100`,
            adminId,
        ),
        [],
    );
    return rows.map(toRecord);
}

/** Revoca por id (o prefijo unico de >= 6 caracteres). Solo tokens del propio administrador. Borra la sesion de manager guardada. */
export async function revokeCliToken(adminId: string, idOrPrefix: string): Promise<CliTokenRecord | null> {
    const ref = String(idOrPrefix || '').trim().toLowerCase();
    if (!/^[0-9a-f-]{6,36}$/.test(ref)) return null;
    const rows = await query<Row>(`SELECT ${COLS} FROM "AdminCliToken" WHERE "adminId" = $1 AND "revokedAt" IS NULL AND "id" LIKE $2 LIMIT 2`, adminId, `${ref}%`);
    if (rows.length !== 1) return null;
    await execute(`UPDATE "AdminCliToken" SET "revokedAt" = NOW(), "managerSessionEnc" = NULL WHERE "id" = $1 AND "adminId" = $2`, rows[0].id, adminId);
    return toRecord({ ...rows[0], revokedAt: new Date() });
}

export async function revokeAllCliTokens(adminId: string, exceptId?: string | null): Promise<number> {
    return tolerant(
        () => execute(
            `UPDATE "AdminCliToken" SET "revokedAt" = NOW(), "managerSessionEnc" = NULL WHERE "adminId" = $1 AND "revokedAt" IS NULL AND ($2::text IS NULL OR "id" <> $2)`,
            adminId, exceptId ?? null,
        ),
        0,
    );
}

/** Purga filas caducadas/revocadas hace mas de 30 dias. */
export async function purgeCliTokens(): Promise<number> {
    return tolerant(() => execute(`DELETE FROM "AdminCliToken" WHERE COALESCE("revokedAt", "expiresAt") < NOW() - INTERVAL '30 days'`), 0);
}
