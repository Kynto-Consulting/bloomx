import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, getSessionCookie } from "./session";
import { mfaRequiredFor } from "./mfa";
import { verifyManagerOwnsInstance } from "./manager-auth";
import { auditLog, getClientIp } from "./security";
import { refreshPermissions } from "./permissions";
import { enterPrivileged, getEnd, peekSessionJti, type EnterResult } from "./privileged-session";
import { deviceLabel } from "./privileged-notify";
import { ADMIN_LEVEL, effectiveLevelSync, type LevelSource, type PermissionLevel } from "./permissions-core";

// Guardia unica para api/admin/** (el middleware las deja pasar y solo exige una cookie).
// NIST AC-3 / AC-6, CIS v8 6.8 (control de acceso basado en roles), ISO 27001:2022 A.5.15 / A.8.2.
//
// Modelo de permisos: `permission_level` 0..4 (ver permissions-core.ts). requireLevel(n) es la UNICA comprobacion de nivel:
//  a) "manager" del backend compartido y DUENO del Domain de la instancia (verifyManagerOwnsInstance: consulta al backend con
//     su cookie, cache 45 s, falla cerrado) => nivel 4 en SU instancia;
//  b) usuario de la app con nivel efectivo >= n (max(ADMIN_EMAILS = 4, concesion de consola)) Y sesion con segundo factor
//     verificado (claim mfa) para cualquier cuenta con acceso al admin (nivel >= 1), salvo MFA_ENFORCE_ADMIN=false.
// requireAdmin() == requireLevel(3) (compatibilidad con el antiguo "administrador"). Un manager ajeno (el alta es abierta) NO tiene
// nivel en esta instancia. Cualquier otro caso: 401 (sin sesion) o 403 (sesion sin nivel/propiedad/MFA). Los rechazos se auditan.

export interface LevelInfo { level: PermissionLevel; levelSource: LevelSource }

export type AdminActor =
    | ({ kind: "manager"; id?: string; email?: string } & Partial<LevelInfo>)
    | ({ kind: "user"; id: string; email: string } & Partial<LevelInfo>);

export type AdminGuardResult = { ok: true; actor: AdminActor & LevelInfo } | { ok: false; response: NextResponse };

/**
 * 401/403 por sesion privilegiada: `superseded` (otra sesion de administracion la reemplazo), `expired` (inactividad o tope de 12 h) o
 * `locked` (bloqueo por pelea de sesiones). El cuerpo lleva el motivo, cuando y desde donde para mostrar un mensaje claro.
 */
export interface PrivilegedDenial { reason: 'superseded' | 'expired_idle' | 'expired_absolute' | 'locked'; end?: { endedAt: string | null; byKind: string | null; byIp: string | null; byUserAgent: string | null } | null }

function denyPrivileged(req: Request | undefined, d: PrivilegedDenial, userId?: string): AdminGuardResult {
    const locked = d.reason === "locked";
    auditLog("admin.access_denied", { reason: `privileged_${d.reason}`, userId, ip: req ? getClientIp(req) : undefined, path: req ? new URL(req.url).pathname : undefined });
    return {
        ok: false,
        response: NextResponse.json(
            {
                error: locked ? "Forbidden" : "Unauthorized",
                code: locked ? "ACCOUNT_LOCKED" : d.reason === "superseded" ? "SUPERSEDED" : "EXPIRED",
                reason: d.reason,
                ...(d.end ? { at: d.end.endedAt, byKind: d.end.byKind, byIp: d.end.byIp, byDevice: d.end.byUserAgent ? deviceLabel(d.end.byUserAgent) : null } : {}),
            },
            { status: locked ? 403 : 401, headers: { "Cache-Control": "no-store" } }
        ),
    };
}

function deny(req: Request | undefined, status: 401 | 403, reason: string, userId?: string, required?: number): AdminGuardResult {
    auditLog("admin.access_denied", {
        reason,
        userId,
        ip: req ? getClientIp(req) : undefined,
        path: req ? new URL(req.url).pathname : undefined,
        ...(required !== undefined ? { required } : {}),
    });
    return {
        ok: false,
        response: NextResponse.json(
            {
                error: status === 401 ? "Unauthorized" : "Forbidden",
                ...(reason === "mfa_required" ? { code: "MFA_REQUIRED" } : {}),
                ...(reason === "insufficient_level" ? { code: "INSUFFICIENT_LEVEL", required } : {}),
            },
            { status, headers: { "Cache-Control": "no-store" } }
        ),
    };
}

// Peticiones fabricadas EN PROCESO por el motor de comandos (lib/admin-cli/bridge.ts) tras autenticar al administrador
// (cookie de la consola o token de CLI) y comprobar nivel, ambito y riesgo. Es un WeakMap en memoria: no se puede falsificar desde
// fuera del proceso (ninguna cabecera, cookie ni cuerpo HTTP puede marcar una peticion como confiable). El nivel del actor se
// vuelve a comprobar en cada ruta (requireLevel), igual que en una peticion normal.
const trustedRequests = new WeakMap<object, AdminActor>();

/** Solo para el motor de comandos: marca `req` como ejecutada por `actor` (ya autenticado, con su nivel). */
export function markTrustedAdminRequest(req: Request, actor: AdminActor): void {
    trustedRequests.set(req, actor);
}

/**
 * Exige `min` (0..4). Devuelve el actor con su nivel efectivo y origen. 401 sin sesion, 403 sin nivel suficiente / propiedad / MFA.
 */
export async function requireLevel(min: PermissionLevel, req?: NextRequest | Request, opts: { passive?: boolean } = {}): Promise<AdminGuardResult> {
    const trusted = req ? trustedRequests.get(req) : undefined;
    if (trusted) {
        const level = (trusted.level ?? 0) as PermissionLevel; // sin nivel declarado: el mas bajo (falla cerrado)
        if (level < min) return deny(req, 403, "insufficient_level", trusted.id, min);
        return { ok: true, actor: { ...trusted, level, levelSource: trusted.levelSource ?? "none" } as AdminActor & LevelInfo };
    }

    // a) manager del backend, solo si es DUENO del dominio de esta instancia (falla cerrado) => nivel 4
    let managerDenied: string | null = null;
    if (req && (req as NextRequest).cookies?.get?.("auth_session")?.value) {
        const own = await verifyManagerOwnsInstance(req).catch(() => ({ ok: false as const, reason: "backend_unavailable" as const }));
        if (own.ok) return { ok: true, actor: { kind: "manager", id: own.managerId, email: own.email, level: 4, levelSource: "manager" } };
        managerDenied = own.reason;
    }

    // b) usuario con nivel suficiente y MFA
    const user = await getCurrentUser();
    if (!user) {
        // Una sesion revocada por una nueva / caducada por inactividad se explica con un mensaje claro (no un 401 generico).
        const jti = await peekSessionJti();
        const end = jti ? await getEnd(jti).catch(() => null) : null;
        if (end && end.reason !== "closed") return denyPrivileged(req, { reason: end.reason === "superseded" ? "superseded" : end.reason === "locked" ? "locked" : (end.reason as "expired_idle" | "expired_absolute"), end });
        // Sesion de manager valida pero sin propiedad del dominio (o backend caido): 403, no 401 (hay sesion, falta rol).
        if (managerDenied && managerDenied !== "no_session") return deny(req, 403, `manager_${managerDenied}`);
        return deny(req, 401, "no_session");
    }
    await refreshPermissions();
    const eff = effectiveLevelSync(user.email);
    if (eff.level < 1) return deny(req, 403, managerDenied ? `manager_${managerDenied}` : "not_admin", user.id);
    if (eff.level < min) return deny(req, 403, "insufficient_level", user.id, min);
    const session = await getSessionCookie();
    if (mfaRequiredFor(user.email) && session?.mfa !== true) return deny(req, 403, "mfa_required", user.id);

    // Una sola sesion privilegiada por cuenta (web + CLI), con cierre por inactividad y tope de 12 h (ver privileged-session.ts).
    if (typeof session?.jti === "string") {
        const entered: EnterResult = await enterPrivileged({
            userId: user.id, email: user.email, level: eff.level, kind: "web", ref: session.jti,
            ip: req ? getClientIp(req) : null, userAgent: req?.headers.get("user-agent") ?? null, passive: opts.passive,
        });
        if (!entered.ok) return denyPrivileged(req, { reason: entered.reason, end: entered.end }, user.id);
    }
    return { ok: true, actor: { kind: "user", id: user.id, email: user.email, level: eff.level, levelSource: eff.source } };
}

/** Compatibilidad: el antiguo "administrador" == nivel >= 3. Las rutas con adminRoute usan requireLevel segun su scope. */
export async function requireAdmin(req?: NextRequest | Request): Promise<AdminGuardResult> {
    return requireLevel(ADMIN_LEVEL, req);
}

/** True si el usuario de la app tiene nivel >= `min` (por defecto 3, el antiguo "admin") con MFA valido (rutas mixtas). */
export async function isAdminUserSession(min: PermissionLevel = ADMIN_LEVEL): Promise<boolean> {
    const user = await getCurrentUser();
    if (!user) return false;
    await refreshPermissions();
    if (effectiveLevelSync(user.email).level < Math.max(1, min)) return false;
    if (!mfaRequiredFor(user.email)) return true;
    return (await getSessionCookie())?.mfa === true;
}
