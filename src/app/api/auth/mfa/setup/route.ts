import { NextRequest, NextResponse } from "next/server";
import { auditLog, getClientIp } from "@/lib/security";
import { beginEnrollment, MfaStoreUnavailableError } from "@/lib/mfa";
import { mfaIssuer, NO_STORE, resolveMfaActor } from "@/lib/mfa-http";

/**
 * POST /api/auth/mfa/setup   { mfaToken? }
 * Genera un secreto TOTP nuevo (sin activar). Se puede llamar con sesion o con el mfaToken que devuelve
 * el login cuando el rol exige MFA y aun no esta enrolado. El secreto solo se devuelve aqui.
 */
export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => ({}));
    const actor = await resolveMfaActor(body);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });

    try {
        const { secret, otpauthUri } = await beginEnrollment(actor.userId, actor.email, mfaIssuer());
        auditLog("auth.mfa.setup_started", { userId: actor.userId, ip: getClientIp(req), via: actor.via });
        return NextResponse.json({ secret, otpauthUri, issuer: mfaIssuer(), account: actor.email }, { headers: NO_STORE });
    } catch (e: any) {
        if (e?.message === "MFA_ALREADY_ENABLED") {
            return NextResponse.json({ error: "MFA already enabled" }, { status: 409, headers: NO_STORE });
        }
        if (e instanceof MfaStoreUnavailableError) {
            return NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503, headers: NO_STORE });
        }
        console.error("[MFA_SETUP]", e?.message || "unknown");
        return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
    }
}
