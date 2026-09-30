import { cookies, headers } from "next/headers";
import type { JWTPayload } from "jose";
import {
    signSessionJWT,
    verifyJWT,
    isSessionPayload,
    type SessionIssueOptions,
} from "./jwt";
import { clearSessionCookies, readSessionCookie, sessionCookieOptions, writeSessionCookie } from "./session-cookie";
import { prisma } from "./prisma";
import { checkSessionNotRevoked, getTokenVersion, revokeSession, bumpTokenVersion } from "./session-revocation";

// Atributos de cookie de sesion: HttpOnly + Secure (prod) + SameSite=Lax (CIS 16.x, NIST SC-23, ISO 27002 8.26)
// Nombre (`__Host-` en produccion), lectura dual y borrado viven en ./session-cookie.
export const SESSION_COOKIE_OPTIONS = sessionCookieOptions();

/**
 * Emite la sesion (JWT con jti + tokenVersion) y fija la cookie.
 * `opts.mfa` marca que el segundo factor fue verificado en este login.
 */
export async function setSessionCookie(
    payload: { sub: string; email?: string | null; name?: string | null },
    opts: Pick<SessionIssueOptions, "mfa" | "at"> = {}
) {
    const tv = await getTokenVersion(payload.sub);
    const { token, ttl } = await signSessionJWT(payload, { ...opts, tv });
    writeSessionCookie(await cookies(), token, ttl);
    return token; // Return token for client-side storage
}

/**
 * Verifica un JWT de sesion COMPLETO: firma/exp + tipo + revocacion (jti, tokenVersion).
 * Devuelve el payload o null.
 */
export async function verifySessionToken(token: string): Promise<JWTPayload | null> {
    const payload = await verifyJWT(token);
    if (!isSessionPayload(payload)) return null;
    const check = await checkSessionNotRevoked(payload as any);
    if (!check.valid) return null;
    return payload;
}

export async function getSessionCookie() {
    const headersList = await headers();
    const authHeader = headersList.get("authorization");
    let token = authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.substring(7)
        : null;

    if (!token) {
        const cookieStore = await cookies();
        token = readSessionCookie(cookieStore).token;
    }

    if (!token) return null;
    return await verifySessionToken(token);
}

export async function clearSessionCookie() {
    clearSessionCookies(await cookies());
}

/** Revoca en servidor la sesion actual (el token deja de valer aunque alguien lo haya copiado). */
export async function revokeCurrentSession(session: JWTPayload | null): Promise<boolean> {
    if (!session?.sub || typeof session.jti !== "string") return false;
    return revokeSession(session.jti, String(session.sub), typeof session.exp === "number" ? session.exp : undefined);
}

/** Cierra TODAS las sesiones del usuario (cambio de contrasena, reset, "salir en todos los dispositivos"). */
export async function revokeAllSessions(userId: string): Promise<boolean> {
    return (await bumpTokenVersion(userId)) !== null;
}

export async function getCurrentUser() {
    const session = await getSessionCookie();
    if (!session || !session.sub) return null;

    try {
        const user = await prisma.user.findUnique({
            where: { id: session.sub as string },
            select: {
                id: true,
                name: true,
                email: true,
                avatar: true,
            }
        });
        return user;
    } catch (error) {
        return null;
    }
}
