import { SignJWT, jwtVerify, type JWTPayload } from "jose";

// CIS v8 3.11 / 6.x, NIST SC-12 / SC-13 / IA-5(1) / AC-12 / IA-11, ISO 27001:2022 A.8.5 / A.8.24.
// Este modulo es "edge-safe" (lo importa el middleware): solo jose, sin Node ni BD.
// La revocacion (jti / tokenVersion) se comprueba en session.ts (Node, con BD).
//
// El secreto de firma es NEXTAUTH_SECRET sin derivar porque bloomx-backend verifica este mismo JWT (HS256).
//
// En produccion NO se permite un secreto por defecto (se falla cerrado al usarlo, no al importar,
// para no romper `next build`).
const DEV_FALLBACK_SECRET = "fallback_secret_for_dev_only_change_in_prod";

let cachedSecret: Uint8Array | null = null;
export function getJwtSecret(): Uint8Array {
    if (cachedSecret) return cachedSecret;
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret && process.env.NODE_ENV === "production") {
        throw new Error("NEXTAUTH_SECRET is required in production");
    }
    cachedSecret = new TextEncoder().encode(secret || DEV_FALLBACK_SECRET);
    return cachedSecret;
}

export const COOKIE_NAME = "next-auth.session-token";

function intEnv(name: string, def: number, min: number, max: number): number {
    const n = Number.parseInt(String(process.env[name] ?? ""), 10);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
}

/** Vigencia por inactividad (ventana deslizante). Por defecto 24 h (antes 30 dias). */
export function getSessionTtlSeconds(): number {
    return intEnv("SESSION_TTL_SECONDS", 24 * 60 * 60, 300, 30 * 24 * 60 * 60);
}
/** Tope absoluto desde el login, aunque haya actividad. Por defecto 14 dias. */
export function getSessionAbsoluteMaxSeconds(): number {
    return intEnv("SESSION_ABSOLUTE_MAX_SECONDS", 14 * 24 * 60 * 60, 3600, 90 * 24 * 60 * 60);
}
/** Compatibilidad: valor por defecto evaluado al importar. Preferir getSessionTtlSeconds(). */
export const SESSION_MAX_AGE_SECONDS = getSessionTtlSeconds();

const nowSec = () => Math.floor(Date.now() / 1000);

export async function signJWT(payload: any, expiresInSeconds: number = getSessionTtlSeconds()) {
    return await new SignJWT(payload)
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime(`${expiresInSeconds}s`)
        .sign(getJwtSecret());
}

export interface SessionClaimsInput {
    sub: string;
    email?: string | null;
    name?: string | null;
}
export interface SessionIssueOptions {
    jti?: string;
    /** User.tokenVersion vigente; se guarda en el claim `tv`. */
    tv?: number;
    /** Instante (epoch s) del login original; se conserva al renovar para respetar el tope absoluto. */
    at?: number;
    /** Sesion con segundo factor verificado. */
    mfa?: boolean;
}

function newJti(): string {
    // crypto.randomUUID existe en Node >= 19, Edge y navegadores
    return globalThis.crypto.randomUUID();
}

/** Emite un JWT de sesion con jti, tv, at y (opcional) mfa. */
export async function signSessionJWT(claims: SessionClaimsInput, opts: SessionIssueOptions = {}) {
    const at = opts.at ?? nowSec();
    const ttl = Math.max(60, Math.min(getSessionTtlSeconds(), at + getSessionAbsoluteMaxSeconds() - nowSec()));
    const payload: Record<string, unknown> = {
        sub: claims.sub,
        email: claims.email ?? undefined,
        name: claims.name ?? undefined,
        use: "session",
        jti: opts.jti ?? newJti(),
        tv: opts.tv ?? 0,
        at,
    };
    if (opts.mfa) payload.mfa = true;
    return { token: await signJWT(payload, ttl), ttl, jti: payload.jti as string };
}

// Los tokens de un solo proposito se firman con una clave DERIVADA (HMAC(NEXTAUTH_SECRET, dominio)), distinta de la de
// sesion: bloomx-backend verifica la sesion con NEXTAUTH_SECRET a secas y, si el paso intermedio de MFA usara esa misma
// clave, el backend lo aceptaria como sesion y se saltaria el segundo factor.
let cachedPendingKey: Uint8Array | null = null;
async function getPendingSecret(): Promise<Uint8Array> {
    if (cachedPendingKey) return cachedPendingKey;
    const subtle = globalThis.crypto.subtle;
    const key = await subtle.importKey("raw", getJwtSecret() as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await subtle.sign("HMAC", key, new TextEncoder().encode("bloomx:pending-token:v1"));
    cachedPendingKey = new Uint8Array(sig);
    return cachedPendingKey;
}

/** Token corto de un solo proposito (p. ej. paso intermedio de MFA). Nunca es valido como sesion (clave distinta). */
export async function signPendingJWT(purpose: "mfa", claims: Record<string, unknown>, ttlSeconds = 300) {
    return await new SignJWT({ ...claims, use: purpose, jti: newJti() })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime(`${ttlSeconds}s`)
        .sign(await getPendingSecret());
}

/** Verificacion criptografica (firma + exp). No comprueba revocacion. */
export async function verifyJWT(token: string) {
    try {
        // Se fija el algoritmo para evitar confusion de algoritmos (alg=none / RS-HS).
        const { payload } = await jwtVerify(token, getJwtSecret(), { algorithms: ["HS256"] });
        return payload;
    } catch (error: any) {
        // No se registra el token ni el objeto de error completo (puede contener fragmentos del JWT).
        console.warn("[JWT] Verify failed:", error?.code || error?.name || "unknown");
        return null;
    }
}

/**
 * Un JWT firmado con este secreto solo es sesion si NO es de otro proposito:
 * - `type` presente (p. ej. molt_access) => otro tipo de token, se rechaza.
 * - `use` presente y distinto de "session" (p. ej. "mfa") => se rechaza.
 * Los tokens anteriores a la revocacion (sin `use`) se siguen aceptando aqui; session.ts aplica su tope de edad.
 */
export function isSessionPayload(payload: JWTPayload | null | undefined): payload is JWTPayload {
    if (!payload || !payload.sub) return false;
    if ((payload as any).type) return false;
    const use = (payload as any).use;
    if (use !== undefined && use !== "session") return false;
    return true;
}

export async function verifyPendingJWT(token: string, purpose: "mfa") {
    try {
        const { payload } = await jwtVerify(token, await getPendingSecret(), { algorithms: ["HS256"] });
        if (!payload.sub || (payload as any).use !== purpose) return null;
        return payload;
    } catch {
        return null;
    }
}

/**
 * Renovacion deslizante: si a la sesion le queda menos de la mitad de su vigencia devuelve un token nuevo
 * (mismo jti/tv/at/mfa, exp renovado y acotado por el tope absoluto). Si no procede, null.
 * Los tokens heredados (sin jti) no se renuevan: caducan y obligan a reautenticar.
 */
export async function renewSessionIfNeeded(payload: JWTPayload): Promise<{ token: string; ttl: number } | null> {
    const p = payload as any;
    if (!p.jti || typeof p.exp !== "number") return null;
    const now = nowSec();
    const ttl = getSessionTtlSeconds();
    if (p.exp - now > ttl / 2) return null;
    const at = typeof p.at === "number" ? p.at : p.iat ?? now;
    const absoluteEnd = at + getSessionAbsoluteMaxSeconds();
    if (now >= absoluteEnd) return null;
    const newTtl = Math.max(60, Math.min(ttl, absoluteEnd - now));
    if (p.exp >= now + newTtl) return null; // ya no ganaria vigencia
    const { sub, email, name, jti, tv, mfa } = p;
    const token = await signJWT({ sub, email, name, use: "session", jti, tv: tv ?? 0, at, ...(mfa ? { mfa: true } : {}) }, newTtl);
    return { token, ttl: newTtl };
}
