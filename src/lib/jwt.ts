import { SignJWT, jwtVerify } from "jose";

// CIS 3.11 / 16.x, NIST SC-12 / SC-13 / IA-5(1), ISO 27002 8.24.
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

// Duracion de sesion: 30 dias (sin revocacion server-side; ver informe de auditoria).
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export async function signJWT(payload: any) {
    return await new SignJWT(payload)
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
        .sign(getJwtSecret());
}

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
