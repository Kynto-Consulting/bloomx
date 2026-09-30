import { NextRequest, NextResponse } from "next/server";
import { auditLog, getClientIp } from "@/lib/security";
import { confirmEnrollment, MfaStoreUnavailableError } from "@/lib/mfa";
import { mfaAttemptLimit, NO_STORE, resolveMfaActor } from "@/lib/mfa-http";
import { revokeAllSessions, setSessionCookie } from "@/lib/session";

/**
 * POST /api/auth/mfa/confirm   { code, mfaToken? }
 * Verifica el primer codigo TOTP, activa MFA y devuelve los codigos de recuperacion (solo se muestran una vez).
 * - via mfaToken (login con MFA obligatorio): completa el login y emite la sesion (con claim mfa).
 * - via sesion: cierra las demas sesiones del usuario y renueva la actual con claim mfa.
 */
export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => ({}));
    const actor = await resolveMfaActor(body);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });

    const limited = await mfaAttemptLimit(req, actor.userId, "confirm");
    if (limited) return limited;

    try {
        const result = await confirmEnrollment(actor.userId, String(body?.code ?? ""));
        if (!result.ok) {
            auditLog("auth.mfa.confirm_failed", { userId: actor.userId, ip: getClientIp(req) });
            return NextResponse.json({ error: "Invalid code" }, { status: 400, headers: NO_STORE });
        }
        auditLog("auth.mfa.enabled", { userId: actor.userId, ip: getClientIp(req), via: actor.via });

        if (actor.via === "session") await revokeAllSessions(actor.userId);
        const token = await setSessionCookie({ sub: actor.userId, email: actor.email, name: actor.name }, { mfa: true });

        return NextResponse.json(
            {
                success: true,
                recoveryCodes: result.recoveryCodes,
                token,
                user: { id: actor.userId, email: actor.email, name: actor.name },
            },
            { headers: NO_STORE }
        );
    } catch (e: any) {
        if (e instanceof MfaStoreUnavailableError) {
            return NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503, headers: NO_STORE });
        }
        console.error("[MFA_CONFIRM]", e?.message || "unknown");
        return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
    }
}
