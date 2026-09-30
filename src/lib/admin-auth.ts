import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, getSessionCookie } from "./session";
import { isAdminEmail, mfaRequiredFor } from "./mfa";
import { verifyManagerSession } from "./manager-auth";
import { auditLog, getClientIp } from "./security";

// Guardia unica para api/admin/** (el middleware las deja pasar y solo exige una cookie).
// NIST AC-3 / AC-6, CIS v8 6.8 (control de acceso basado en roles), ISO 27001:2022 A.5.15 / A.8.2.
//
// Se acepta:
//  a) sesion de "manager" del backend (cookie auth_session verificada contra /api/auth/me del backend), o
//  b) usuario de la app con email en ADMIN_EMAILS Y sesion con segundo factor verificado (claim mfa),
//     salvo MFA_ENFORCE_ADMIN=false.
// Cualquier otro caso: 401 (sin sesion) o 403 (sesion sin rol/MFA). Los rechazos se auditan.

export type AdminActor =
    | { kind: "manager"; id?: string; email?: string }
    | { kind: "user"; id: string; email: string };

export type AdminGuardResult = { ok: true; actor: AdminActor } | { ok: false; response: NextResponse };

function deny(req: Request | undefined, status: 401 | 403, reason: string, userId?: string): AdminGuardResult {
    auditLog("admin.access_denied", {
        reason,
        userId,
        ip: req ? getClientIp(req) : undefined,
        path: req ? new URL(req.url).pathname : undefined,
    });
    return {
        ok: false,
        response: NextResponse.json(
            { error: status === 401 ? "Unauthorized" : "Forbidden", ...(reason === "mfa_required" ? { code: "MFA_REQUIRED" } : {}) },
            { status, headers: { "Cache-Control": "no-store" } }
        ),
    };
}

export async function requireAdmin(req?: NextRequest | Request): Promise<AdminGuardResult> {
    // a) manager del backend
    if (req && (req as NextRequest).cookies?.get?.("auth_session")?.value) {
        const manager: any = await verifyManagerSession(req as NextRequest).catch(() => null);
        if (manager) return { ok: true, actor: { kind: "manager", id: manager.id, email: manager.email } };
    }

    // b) usuario admin con MFA
    const user = await getCurrentUser();
    if (!user) return deny(req, 401, "no_session");
    if (!isAdminEmail(user.email)) return deny(req, 403, "not_admin", user.id);
    if (mfaRequiredFor(user.email)) {
        const session = await getSessionCookie();
        if (session?.mfa !== true) return deny(req, 403, "mfa_required", user.id);
    }
    return { ok: true, actor: { kind: "user", id: user.id, email: user.email } };
}

/** True si el usuario de la app es admin con MFA valido (para rutas mixtas: usuario normal sobre lo suyo, admin sobre todo). */
export async function isAdminUserSession(): Promise<boolean> {
    const user = await getCurrentUser();
    if (!user || !isAdminEmail(user.email)) return false;
    if (!mfaRequiredFor(user.email)) return true;
    return (await getSessionCookie())?.mfa === true;
}
