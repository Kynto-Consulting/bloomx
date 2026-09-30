import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, getSessionCookie } from "./session";
import { isAdminEmail, mfaRequiredFor } from "./mfa";
import { verifyManagerOwnsInstance } from "./manager-auth";
import { auditLog, getClientIp } from "./security";

// Guardia unica para api/admin/** (el middleware las deja pasar y solo exige una cookie).
// NIST AC-3 / AC-6, CIS v8 6.8 (control de acceso basado en roles), ISO 27001:2022 A.5.15 / A.8.2.
//
// Una persona es admin de ESTA instancia solo si:
//  a) es "manager" del backend compartido Y DUENO del Domain cuyo name es el dominio activo de la instancia
//     (TOP_DOMAIN / NEXT_PUBLIC_APP_URL; ver verifyManagerOwnsInstance: consulta al backend con su cookie, cache 45 s,
//     falla cerrado si el backend no responde), o
//  b) usuario de la app con email en ADMIN_EMAILS Y sesion con segundo factor verificado (claim mfa),
//     salvo MFA_ENFORCE_ADMIN=false.
// Un manager ajeno (el alta es abierta) NO es admin de esta instancia. Cualquier otro caso: 401 (sin sesion) o
// 403 (sesion sin rol/propiedad/MFA). Los rechazos se auditan.

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
    // a) manager del backend, solo si es DUENO del dominio de esta instancia (falla cerrado)
    let managerDenied: string | null = null;
    if (req && (req as NextRequest).cookies?.get?.("auth_session")?.value) {
        const own = await verifyManagerOwnsInstance(req).catch(() => ({ ok: false as const, reason: "backend_unavailable" as const }));
        if (own.ok) return { ok: true, actor: { kind: "manager", id: own.managerId, email: own.email } };
        managerDenied = own.reason;
    }

    // b) usuario admin con MFA
    const user = await getCurrentUser();
    if (!user) {
        // Sesion de manager valida pero sin propiedad del dominio (o backend caido): 403, no 401 (hay sesion, falta rol).
        if (managerDenied && managerDenied !== "no_session") return deny(req, 403, `manager_${managerDenied}`);
        return deny(req, 401, "no_session");
    }
    if (!isAdminEmail(user.email)) return deny(req, 403, managerDenied ? `manager_${managerDenied}` : "not_admin", user.id);
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
