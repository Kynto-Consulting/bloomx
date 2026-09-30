import { getSessionTtlSeconds } from "./jwt";
import { prisma } from "./prisma";

// Revocacion de sesiones JWT (NIST AC-12 / IA-11, ISO 27001:2022 A.8.5, OWASP ASVS 3.3).
//
// Dos mecanismos, ambos ADITIVOS y tolerantes a que aun no exista el DDL:
//  1) "User"."tokenVersion" (INT): el claim `tv` del JWT debe coincidir. Incrementarlo cierra TODAS las sesiones
//     del usuario (cambio de contrasena, "cerrar en todos los dispositivos", desactivar MFA...).
//  2) Tabla "RevokedSession"(jti): cierra UNA sesion concreta (logout).
// Se usa SQL crudo (no el modelo Prisma) para que las consultas existentes a User no dependan de la columna nueva.
//
// Cache en proceso de 5 s (SESSION_REVOCATION_CACHE_MS) para no duplicar consultas por peticion;
// en serverless multi-instancia una revocacion puede tardar hasta ese tiempo en verse en otras instancias.

type PayloadLike = { sub?: unknown; jti?: unknown; tv?: unknown; iat?: unknown; exp?: unknown };

const MISSING_RE = /does not exist|42P01|42703|no such (table|column)/i;
const warned = new Set<string>();
function warnOnce(key: string, msg: string) {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(msg);
}

function cacheMs() {
    const n = Number.parseInt(String(process.env.SESSION_REVOCATION_CACHE_MS ?? ""), 10);
    return Number.isFinite(n) && n >= 0 ? n : 5000;
}

const okCache = new Map<string, number>(); // jti -> valido hasta (ms)
const tvCache = new Map<string, { tv: number; until: number }>();

async function db() {
    return prisma;
}

export function __resetRevocationCache() {
    okCache.clear();
    tvCache.clear();
    warned.clear();
}

/** tokenVersion vigente del usuario (0 si la columna aun no existe). */
export async function getTokenVersion(userId: string): Promise<number> {
    const hit = tvCache.get(userId);
    if (hit && hit.until > Date.now()) return hit.tv;
    try {
        const prisma = await db();
        const rows = await prisma.$queryRaw<Array<{ tv: number | null }>>`
            SELECT "tokenVersion" AS tv FROM "User" WHERE "id" = ${userId}`;
        const tv = Number(rows?.[0]?.tv ?? 0) || 0;
        tvCache.set(userId, { tv, until: Date.now() + cacheMs() });
        return tv;
    } catch (e: any) {
        if (MISSING_RE.test(String(e?.message || e))) {
            warnOnce("tv", "[SESSION] Falta la columna User.tokenVersion: ejecuta la migracion aditiva (db:ensure). Revocacion global desactivada.");
            return 0;
        }
        throw e;
    }
}

/** Cierra todas las sesiones del usuario. Devuelve la nueva version, o null si la columna no existe. */
export async function bumpTokenVersion(userId: string): Promise<number | null> {
    try {
        const prisma = await db();
        const rows = await prisma.$queryRaw<Array<{ tv: number }>>`
            UPDATE "User" SET "tokenVersion" = COALESCE("tokenVersion", 0) + 1 WHERE "id" = ${userId}
            RETURNING "tokenVersion" AS tv`;
        tvCache.delete(userId);
        okCache.clear();
        return Number(rows?.[0]?.tv ?? 0);
    } catch (e: any) {
        if (MISSING_RE.test(String(e?.message || e))) {
            warnOnce("tv-bump", "[SESSION] No se pudo invalidar sesiones: falta User.tokenVersion.");
            return null;
        }
        throw e;
    }
}

/** Revoca una sesion concreta (logout). `expSec` = exp del JWT (la fila puede purgarse despues). */
export async function revokeSession(jti: string, userId: string, expSec?: number): Promise<boolean> {
    okCache.delete(jti);
    try {
        const prisma = await db();
        const expiresAt = new Date((expSec ?? Math.floor(Date.now() / 1000) + 30 * 24 * 3600) * 1000);
        await prisma.$executeRaw`
            INSERT INTO "RevokedSession" ("jti", "userId", "expiresAt") VALUES (${jti}, ${userId}, ${expiresAt})
            ON CONFLICT ("jti") DO NOTHING`;
        return true;
    } catch (e: any) {
        if (MISSING_RE.test(String(e?.message || e))) {
            warnOnce("rs", "[SESSION] Falta la tabla RevokedSession: el logout no puede invalidar el token en servidor.");
            return false;
        }
        throw e;
    }
}

export async function purgeExpiredRevocations(): Promise<number> {
    try {
        const prisma = await db();
        return Number(await prisma.$executeRaw`DELETE FROM "RevokedSession" WHERE "expiresAt" < NOW()`);
    } catch (e: any) {
        if (MISSING_RE.test(String(e?.message || e))) return 0;
        throw e;
    }
}

export interface SessionCheck {
    valid: boolean;
    reason?: "legacy_expired" | "legacy_disabled" | "disabled" | "revoked" | "version_mismatch" | "user_missing" | "error";
}

/**
 * Comprueba jti/tokenVersion de un payload ya verificado criptograficamente.
 * - Tokens heredados (sin jti): validos solo mientras no superen la vigencia deslizante desde su `iat`
 *   (SESSION_ALLOW_LEGACY_TOKENS=false los rechaza ya).
 */
export async function checkSessionNotRevoked(payload: PayloadLike): Promise<SessionCheck> {
    const sub = String(payload.sub || "");
    if (!sub) return { valid: false, reason: "error" };
    const jti = typeof payload.jti === "string" ? payload.jti : null;
    const nowMs = Date.now();

    if (!jti) {
        if (process.env.SESSION_ALLOW_LEGACY_TOKENS === "false") return { valid: false, reason: "legacy_disabled" };
        const iat = typeof payload.iat === "number" ? payload.iat : 0;
        if (nowMs / 1000 - iat > getSessionTtlSeconds()) return { valid: false, reason: "legacy_expired" };
        // aun asi respeta tokenVersion (0 si no existia)
    } else {
        const hit = okCache.get(jti);
        if (hit && hit > nowMs) return { valid: true };
    }

    try {
        const prisma = await db();
        let tv: number | null = null;
        let revoked = false;
        try {
            const rows = await prisma.$queryRaw<Array<{ tv: number | null; revoked: boolean; disabled?: boolean }>>`
                SELECT u."tokenVersion" AS tv,
                       EXISTS (SELECT 1 FROM "RevokedSession" r WHERE r."jti" = ${jti ?? ""}) AS revoked,
                       EXISTS (SELECT 1 FROM "UserAdminState" d WHERE d."userId" = u."id" AND d."disabled" = TRUE) AS disabled
                FROM "User" u WHERE u."id" = ${sub}`;
            if (!rows?.length) return { valid: false, reason: "user_missing" }; // usuario inexistente
            // Cuenta deshabilitada desde la consola de administracion: ninguna sesion vale (ni las nuevas).
            if (Boolean(rows[0].disabled)) return { valid: false, reason: "disabled" };
            tv = Number(rows[0].tv ?? 0);
            revoked = Boolean(rows[0].revoked);
        } catch (e: any) {
            if (!MISSING_RE.test(String(e?.message || e))) throw e;
            // Falta la tabla o la columna: comprobar cada mecanismo por separado
            try {
                tv = await getTokenVersion(sub);
            } catch { tv = 0; }
            if (jti) {
                try {
                    const r = await prisma.$queryRaw<Array<{ x: number }>>`SELECT 1 AS x FROM "RevokedSession" WHERE "jti" = ${jti} LIMIT 1`;
                    revoked = r.length > 0;
                } catch (e2: any) {
                    if (!MISSING_RE.test(String(e2?.message || e2))) throw e2;
                    warnOnce("rs-read", "[SESSION] Falta la tabla RevokedSession: se omite la comprobacion de jti.");
                }
            }
        }
        if (revoked) return { valid: false, reason: "revoked" };
        const claimTv = typeof payload.tv === "number" ? payload.tv : 0;
        if (claimTv < (tv ?? 0)) return { valid: false, reason: "version_mismatch" };
        if (jti) {
            if (okCache.size > 5000) okCache.clear();
            okCache.set(jti, nowMs + cacheMs());
        }
        return { valid: true };
    } catch {
        // Fallo real de BD: falla cerrado (sin sesion), coherente con getCurrentUser que ya necesita la BD.
        return { valid: false, reason: "error" };
    }
}
