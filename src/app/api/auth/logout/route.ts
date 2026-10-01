import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, getSessionCookie, revokeAllSessions, revokeCurrentSession } from "@/lib/session";
import { verifyJWT, isSessionPayload } from "@/lib/jwt";
import { revokeSession } from "@/lib/session-revocation";
import { auditLog, getClientIp } from "@/lib/security";
import { closePrivileged, releaseIfOwner } from "@/lib/privileged-session";

/**
 * POST /api/auth/logout
 *  - sin cuerpo: revoca en servidor la sesion actual (jti) y borra la cookie.
 *  - { all: true }: ademas cierra TODAS las sesiones del usuario (tokenVersion++).
 *  - { token }: revoca un JWT concreto de la boveda multicuenta (olvidar cuenta) sin tocar la cookie actual.
 * NIST AC-12 / IA-11, ISO 27001:2022 A.8.5.
 */
export async function POST(req: NextRequest) {
    const ip = getClientIp(req);
    const body = await req.json().catch(() => ({} as any));
    const session = await getSessionCookie().catch(() => null);

    // Revocar un token concreto (solo si su firma es valida; no requiere que sea el de la cookie)
    if (typeof body?.token === "string" && body.token.length < 4096) {
        const p = await verifyJWT(body.token);
        if (isSessionPayload(p) && typeof p.jti === "string") {
            await revokeSession(p.jti, String(p.sub), typeof p.exp === "number" ? p.exp : undefined).catch(() => false);
            auditLog("auth.logout.token_revoked", { userId: String(p.sub), ip });
        }
        return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
    }

    let revokedServerSide = false;
    if (session) {
        revokedServerSide = await revokeCurrentSession(session).catch(() => false);
        if (body?.all === true && session.sub) {
            revokedServerSide = (await revokeAllSessions(String(session.sub)).catch(() => false)) || revokedServerSide;
            // "Cerrar todas las sesiones" tambien cierra la sesion privilegiada vigente (web o CLI).
            await closePrivileged(String(session.sub)).catch(() => undefined);
        } else if (session.sub && typeof session.jti === "string") {
            // Logout normal: si esta sesion ocupaba el slot privilegiado, se libera.
            await releaseIfOwner(String(session.sub), session.jti).catch(() => undefined);
        }
    }
    await clearSessionCookie();
    auditLog("auth.logout", {
        userId: session?.sub ? String(session.sub) : undefined,
        ip,
        all: body?.all === true,
        revokedServerSide,
    });
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
