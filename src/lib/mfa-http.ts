import { NextRequest, NextResponse } from "next/server";
import { verifyPendingJWT } from "./jwt";
import { getCurrentUser, getSessionCookie } from "./session";
import { prisma } from "./prisma";
import { auditLog, getClientIp, rateLimitAsync } from "./security";

// Utilidades HTTP compartidas por /api/auth/mfa/*.

export const NO_STORE = { "Cache-Control": "no-store" };

export interface MfaActor {
    userId: string;
    email: string;
    name: string | null;
    /** "session": usuario con sesion iniciada; "pending": paso intermedio del login (tras la contrasena). */
    via: "session" | "pending";
    sessionMfa: boolean;
}

/** Identifica al usuario por sesion o por token MFA pendiente (login en curso / enrolamiento obligatorio). */
export async function resolveMfaActor(body: any): Promise<MfaActor | null> {
    if (body && typeof body.mfaToken === "string" && body.mfaToken.length < 4096) {
        const pending = await verifyPendingJWT(body.mfaToken, "mfa");
        if (!pending) return null;
        const user = await prisma.user.findUnique({
            where: { id: String(pending.sub) },
            select: { id: true, email: true, name: true },
        });
        if (!user) return null;
        return { userId: user.id, email: user.email, name: user.name, via: "pending", sessionMfa: false };
    }
    const user = await getCurrentUser();
    if (!user) return null;
    const session = await getSessionCookie();
    return { userId: user.id, email: user.email, name: user.name, via: "session", sessionMfa: session?.mfa === true };
}

/** Rate limit por usuario e IP para intentos de codigo (NIST AC-7 / 800-63B 5.2.2). Devuelve una respuesta 429 o null. */
export async function mfaAttemptLimit(req: NextRequest, userId: string, scope: string): Promise<NextResponse | null> {
    const ip = getClientIp(req);
    const [perUser, perIp] = await Promise.all([rateLimitAsync(`mfa:${scope}:user:${userId}`, 6, 5 * 60_000), rateLimitAsync(`mfa:${scope}:ip:${ip}`, 40, 15 * 60_000)]);
    if (!perUser.ok || !perIp.ok) {
        auditLog("auth.mfa.rate_limited", { userId, ip, scope });
        return NextResponse.json(
            { error: "Too many attempts. Try again later." },
            { status: 429, headers: { ...NO_STORE, "Retry-After": String(Math.max(perUser.retryAfter, perIp.retryAfter)) } }
        );
    }
    return null;
}

export function mfaIssuer(): string {
    return (process.env.MFA_ISSUER || process.env.BRAND_NAME || "Bloomx").slice(0, 60);
}
