import { NextRequest, NextResponse } from "next/server";
import { auditLog, getClientIp } from "@/lib/security";
import { getMfaStatus, MfaStoreUnavailableError, verifyMfa } from "@/lib/mfa";
import { mfaAttemptLimit, NO_STORE, resolveMfaActor } from "@/lib/mfa-http";
import { setSessionCookie } from "@/lib/session";
import { getUserState } from "@/lib/admin/user-state";

/**
 * POST /api/auth/mfa/verify   { mfaToken, code? | recoveryCode? }
 * Segundo paso del login: valida TOTP (anti-replay) o un codigo de recuperacion de un solo uso y emite la sesion.
 */
export async function POST(req: NextRequest) {
    const ip = getClientIp(req);
    const body = await req.json().catch(() => ({}));
    if (typeof body?.mfaToken !== "string") {
        return NextResponse.json({ error: "Missing token" }, { status: 400, headers: NO_STORE });
    }
    const actor = await resolveMfaActor(body);
    if (!actor || actor.via !== "pending") {
        return NextResponse.json({ error: "Invalid or expired challenge" }, { status: 401, headers: NO_STORE });
    }

    const limited = await mfaAttemptLimit(req, actor.userId, "verify");
    if (limited) return limited;

    try {
        const status = await getMfaStatus(actor.userId);
        if (!status.enabled) {
            return NextResponse.json({ error: "Invalid or expired challenge" }, { status: 401, headers: NO_STORE });
        }
        const result = await verifyMfa(actor.userId, { code: body?.code, recoveryCode: body?.recoveryCode });
        if (!result.ok) {
            auditLog("auth.mfa.verify_failed", { userId: actor.userId, ip });
            return NextResponse.json({ error: "Invalid code" }, { status: 401, headers: NO_STORE });
        }

        const adminState = await getUserState(actor.userId);
        if (adminState.disabled) {
            auditLog("auth.login.disabled", { userId: actor.userId, ip });
            return NextResponse.json({ error: "Account disabled", code: "ACCOUNT_DISABLED" }, { status: 403, headers: NO_STORE });
        }
        const token = await setSessionCookie({ sub: actor.userId, email: actor.email, name: actor.name }, { mfa: true });
        auditLog("auth.login.success", { userId: actor.userId, email: actor.email, ip, mfa: result.method });
        if (result.method === "recovery") {
            auditLog("auth.mfa.recovery_used", { userId: actor.userId, ip, left: result.recoveryCodesLeft });
        }
        return NextResponse.json(
            {
                success: true,
                token,
                user: { id: actor.userId, email: actor.email, name: actor.name },
                recoveryCodesLeft: result.recoveryCodesLeft,
                ...(adminState.mustChangePassword ? { mustChangePassword: true } : {}),
            },
            { headers: NO_STORE }
        );
    } catch (e: any) {
        if (e instanceof MfaStoreUnavailableError) {
            return NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503, headers: NO_STORE });
        }
        console.error("[MFA_VERIFY]", e?.message || "unknown");
        return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
    }
}
