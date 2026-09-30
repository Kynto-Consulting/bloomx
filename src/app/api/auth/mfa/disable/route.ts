import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { auditLog, getClientIp } from "@/lib/security";
import { disableMfa, mfaRequiredFor, verifyMfa } from "@/lib/mfa";
import { mfaAttemptLimit, NO_STORE, resolveMfaActor } from "@/lib/mfa-http";
import { revokeAllSessions, setSessionCookie } from "@/lib/session";

/**
 * POST /api/auth/mfa/disable   { password, code? | recoveryCode? }
 * Desactiva MFA. Exige sesion + contrasena + un codigo valido. No permitido si el rol/politica exige MFA.
 * Cierra todas las sesiones y renueva la actual.
 */
export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => ({}));
    const actor = await resolveMfaActor({}); // solo sesion (nunca mfaToken)
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    if (mfaRequiredFor(actor.email)) {
        return NextResponse.json({ error: "MFA is required for this account" }, { status: 403, headers: NO_STORE });
    }
    const limited = await mfaAttemptLimit(req, actor.userId, "disable");
    if (limited) return limited;

    const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { password: true } });
    const passOk = !!user?.password && typeof body?.password === "string" && (await bcrypt.compare(body.password, user.password));
    const res = passOk ? await verifyMfa(actor.userId, { code: body?.code, recoveryCode: body?.recoveryCode }) : { ok: false as const };
    if (!res.ok) {
        auditLog("auth.mfa.disable_failed", { userId: actor.userId, ip: getClientIp(req) });
        return NextResponse.json({ error: "Invalid credentials or code" }, { status: 400, headers: NO_STORE });
    }

    await disableMfa(actor.userId);
    await revokeAllSessions(actor.userId);
    const token = await setSessionCookie({ sub: actor.userId, email: actor.email, name: actor.name });
    auditLog("auth.mfa.disabled", { userId: actor.userId, ip: getClientIp(req) });
    return NextResponse.json({ success: true, token }, { headers: NO_STORE });
}
