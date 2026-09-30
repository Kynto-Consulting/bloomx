import { NextRequest, NextResponse } from "next/server";
import { auditLog, getClientIp } from "@/lib/security";
import { regenerateRecoveryCodes, verifyMfa } from "@/lib/mfa";
import { mfaAttemptLimit, NO_STORE, resolveMfaActor } from "@/lib/mfa-http";

/** POST /api/auth/mfa/recovery-codes  { code }: regenera los 10 codigos (invalida los anteriores). Exige TOTP vigente. */
export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => ({}));
    const actor = await resolveMfaActor({});
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    const limited = await mfaAttemptLimit(req, actor.userId, "recovery");
    if (limited) return limited;

    // Solo TOTP (un codigo de recuperacion no puede regenerar codigos de recuperacion)
    const res = await verifyMfa(actor.userId, { code: body?.code });
    if (!res.ok) {
        auditLog("auth.mfa.recovery_regen_failed", { userId: actor.userId, ip: getClientIp(req) });
        return NextResponse.json({ error: "Invalid code" }, { status: 400, headers: NO_STORE });
    }
    const codes = await regenerateRecoveryCodes(actor.userId);
    auditLog("auth.mfa.recovery_regenerated", { userId: actor.userId, ip: getClientIp(req) });
    return NextResponse.json({ recoveryCodes: codes }, { headers: NO_STORE });
}
