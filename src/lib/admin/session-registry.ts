import { execute, query, tolerant, toIso } from './sql';

/**
 * Registro de sesiones emitidas (tabla aditiva "UserSession"). El JWT de sesion es sin estado: sin este registro el admin
 * no podria LISTAR las sesiones de un usuario. La revocacion sigue siendo la existente (lib/session-revocation.ts):
 *  - una sesion: fila en "RevokedSession" (revokeSession)
 *  - todas: User.tokenVersion + 1 (bumpTokenVersion)
 * Una sesion esta ACTIVA si no ha caducado, su jti no esta revocado y su `tv` >= User.tokenVersion.
 * Nunca se guarda el token ni la cookie: solo jti, ip y user-agent recortado.
 */

export interface SessionRow {
    jti: string;
    userId: string;
    tv: number;
    mfa: boolean;
    ip: string | null;
    userAgent: string | null;
    createdAt: string | null;
    expiresAt: string | null;
}

export interface RegisterSessionInput {
    jti: string;
    userId: string;
    tv: number;
    mfa: boolean;
    ip?: string | null;
    userAgent?: string | null;
    expiresAtSec: number;
}

let override: ((input: RegisterSessionInput) => Promise<void>) | null = null;
/** Solo para tests. */
export function __setSessionRegistrySink(fn: typeof override) {
    override = fn;
}

/** Registra una sesion recien emitida y el ultimo acceso del usuario. Best-effort: nunca rompe el login. */
export async function registerSession(input: RegisterSessionInput): Promise<void> {
    if (!override && (process.env.NODE_ENV === 'test' || process.env.VITEST)) return; // los tests no tocan la BD
    try {
        if (override) return await override(input);
        await tolerant(async () => {
            await execute(
                `INSERT INTO "UserSession" ("jti", "userId", "tv", "mfa", "ip", "userAgent", "createdAt", "expiresAt")
                 VALUES ($1, $2, $3, $4, $5, $6, NOW(), to_timestamp($7))
                 ON CONFLICT ("jti") DO NOTHING`,
                input.jti,
                input.userId,
                Math.max(0, Math.trunc(input.tv)),
                !!input.mfa,
                input.ip ? String(input.ip).slice(0, 64) : null,
                input.userAgent ? String(input.userAgent).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 300) : null,
                Math.trunc(input.expiresAtSec),
            );
        }, undefined);
        const { touchLastLogin } = await import('./user-state');
        await touchLastLogin(input.userId, input.ip);
    } catch {
        // el registro es best-effort
    }
}

const ACTIVE_WHERE = `s."expiresAt" > NOW()
    AND NOT EXISTS (SELECT 1 FROM "RevokedSession" r WHERE r."jti" = s."jti")
    AND s."tv" >= COALESCE((SELECT u."tokenVersion" FROM "User" u WHERE u."id" = s."userId"), 0)`;

/** Sesiones activas de un usuario (mas recientes primero, maximo 50). */
export async function listActiveSessions(userId: string): Promise<SessionRow[]> {
    const rows = await tolerant(
        () => query<{ jti: string; userId: string; tv: number; mfa: boolean; ip: string | null; userAgent: string | null; createdAt: Date; expiresAt: Date }>(
            `SELECT s."jti", s."userId", s."tv", s."mfa", s."ip", s."userAgent", s."createdAt", s."expiresAt"
             FROM "UserSession" s WHERE s."userId" = $1 AND ${ACTIVE_WHERE} ORDER BY s."createdAt" DESC LIMIT 50`,
            userId,
        ),
        [],
    );
    return rows.map((r) => ({ ...r, createdAt: toIso(r.createdAt), expiresAt: toIso(r.expiresAt) }));
}

/** Busca una sesion por jti SOLO si pertenece a `userId` (evita revocar sesiones de otro usuario). */
export async function findSessionOfUser(userId: string, jti: string): Promise<{ jti: string; expiresAt: Date } | null> {
    const rows = await tolerant(
        () => query<{ jti: string; expiresAt: Date }>('SELECT "jti", "expiresAt" FROM "UserSession" WHERE "userId" = $1 AND "jti" = $2', userId, jti),
        [],
    );
    return rows[0] ?? null;
}

/** Numero de sesiones activas por usuario (para la tabla). */
export async function countActiveSessions(userIds: string[]): Promise<Record<string, number>> {
    if (userIds.length === 0) return {};
    const rows = await tolerant(
        () => query<{ userId: string; n: bigint | number }>(
            `SELECT s."userId", COUNT(*) AS n FROM "UserSession" s WHERE s."userId" = ANY($1::text[]) AND ${ACTIVE_WHERE} GROUP BY s."userId"`,
            userIds,
        ),
        [],
    );
    return Object.fromEntries(rows.map((r) => [r.userId, Number(r.n)]));
}

/** Purga filas de sesiones caducadas hace mas de un dia (lo llama la retencion). */
export async function purgeExpiredSessionRows(): Promise<number> {
    return tolerant(() => execute(`DELETE FROM "UserSession" WHERE "expiresAt" < NOW() - INTERVAL '1 day'`), 0);
}
