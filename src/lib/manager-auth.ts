
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { ownDomains } from "./backend-auth";

function backendBase(): string {
    return (process.env.NEXT_PUBLIC_BACKEND_URL || 'https://backend.bloomx.arubik.dev').replace(/\/+$/, '');
}

export async function verifyManagerSession(req: NextRequest) {
    const sessionCookie = req.cookies.get("auth_session");

    if (!sessionCookie?.value) {
        console.log("[MANAGER_AUTH] No session cookie found");
        return null;
    }

    try {
        const res = await fetch(`${backendBase()}/api/auth/me`, {
            headers: {
                Cookie: `auth_session=${sessionCookie.value}`
            },
            signal: AbortSignal.timeout(4000),
        });

        if (!res.ok) {
            console.error(`[MANAGER_AUTH] Failed to verify session. Status: ${res.status}`);
            return null;
        }

        const data = await res.json();
        return data.user; // Returns manager user object or null
    } catch (error) {
        console.error("[MANAGER_AUTH] Verification failed:", error);
        return null;
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Propiedad del dominio de ESTA instancia (modelo multi-tenant: el backend es compartido y el alta de managers es abierta,
// asi que "tener sesion de manager" NO basta para administrar esta instancia).
//
// Una persona es admin de la instancia por la via manager solo si es DUENA (Domain.managerId) del Domain cuyo `name` es el
// dominio activo de la instancia. El dominio activo sale de la configuracion del servidor (TOP_DOMAIN / host de
// NEXT_PUBLIC_APP_URL, ver ownDomains), NUNCA de cabeceras de la peticion. La consulta al backend
// (GET /api/manager/domains) va con la cookie de sesion del propio manager y el backend solo devuelve sus dominios.
//
// Falla cerrado: sin dominio configurado, backend caido/lento/respuesta invalida => false. Solo se cachea un resultado
// definitivo (dueno / no dueno) 45 s por sesion; los fallos de red NO se cachean para no fijar un estado erroneo.
// ---------------------------------------------------------------------------------------------------------------------

export const MANAGER_OWNERSHIP_TTL_MS = 45_000;
const OWNERSHIP_CACHE_MAX = 500;
const ownershipCache = new Map<string, { owner: boolean; until: number; managerId?: string; email?: string }>();

export function __resetManagerOwnershipCache() {
    ownershipCache.clear();
}

export type ManagerOwnership =
    | { ok: true; managerId?: string; email?: string }
    | { ok: false; reason: 'no_session' | 'no_instance_domain' | 'not_owner' | 'backend_unavailable' };

/**
 * Un manager es dueno de la instancia si posee el Domain cuyo name es el de la instancia O un dominio PADRE con al
 * menos dos etiquetas (dueno de ulima.dev => administra mail.ulima.dev). Nunca un TLD (dev, com): evita reclamar
 * instancias ajenas con un dominio demasiado general.
 */
export function isInstanceOwned(instanceDomains: string[], owned: ReadonlySet<string>): boolean {
    for (const raw of instanceDomains) {
        const labels = raw.toLowerCase().split('.').filter(Boolean);
        for (let i = 0; i <= labels.length - 2; i++) {
            if (owned.has(labels.slice(i).join('.'))) return true;
        }
    }
    return false;
}

export async function verifyManagerOwnsInstance(req: NextRequest | Request, opts: { now?: number } = {}): Promise<ManagerOwnership> {
    const cookie = (req as NextRequest).cookies?.get?.("auth_session")?.value;
    return verifyManagerCookieOwnsInstance(cookie, opts);
}

/** Igual que verifyManagerOwnsInstance pero a partir del valor de la cookie auth_session (p. ej. la recien emitida en login). */
export async function verifyManagerCookieOwnsInstance(cookie: string | undefined, opts: { now?: number } = {}): Promise<ManagerOwnership> {
    if (!cookie) return { ok: false, reason: 'no_session' };

    const instanceDomains = ownDomains();
    if (instanceDomains.length === 0) return { ok: false, reason: 'no_instance_domain' };

    const now = opts.now ?? Date.now();
    // La clave no guarda la cookie en claro y incluye los dominios de la instancia (cambian solo con el entorno).
    const key = crypto.createHash("sha256").update(`${cookie}|${instanceDomains.join(",")}`).digest("hex");
    const hit = ownershipCache.get(key);
    if (hit && hit.until > now) {
        return hit.owner ? { ok: true, managerId: hit.managerId, email: hit.email } : { ok: false, reason: 'not_owner' };
    }

    try {
        const headers = { Cookie: `auth_session=${cookie}` };
        const signal = () => AbortSignal.timeout(4000);
        const [meRes, domRes] = await Promise.all([
            fetch(`${backendBase()}/api/auth/me`, { headers, signal: signal(), cache: 'no-store' } as RequestInit),
            fetch(`${backendBase()}/api/manager/domains`, { headers, signal: signal(), cache: 'no-store' } as RequestInit),
        ]);
        // 401 en /api/manager/domains: sesion invalida (definitivo, pero no se cachea: barato y evita fijar estados raros)
        if (!meRes.ok || !domRes.ok) return { ok: false, reason: domRes.status === 401 || meRes.status === 401 ? 'no_session' : 'backend_unavailable' };

        const me: any = await meRes.json();
        const data: any = await domRes.json();
        const manager = me?.user;
        if (!manager || !Array.isArray(data?.domains)) return { ok: false, reason: manager ? 'backend_unavailable' : 'no_session' };

        const owned = new Set<string>(
            data.domains
                .map((d: any) => (typeof d?.name === 'string' ? d.name.split(':')[0].trim().toLowerCase() : ''))
                .filter(Boolean),
        );
        const owner = isInstanceOwned(instanceDomains, owned);

        if (ownershipCache.size >= OWNERSHIP_CACHE_MAX) {
            for (const [k, v] of ownershipCache) if (v.until <= now) ownershipCache.delete(k);
            if (ownershipCache.size >= OWNERSHIP_CACHE_MAX) ownershipCache.delete(ownershipCache.keys().next().value as string);
        }
        ownershipCache.set(key, { owner, until: now + MANAGER_OWNERSHIP_TTL_MS, managerId: manager.id, email: manager.email });
        return owner ? { ok: true, managerId: manager.id, email: manager.email } : { ok: false, reason: 'not_owner' };
    } catch (error) {
        console.error("[MANAGER_AUTH] Ownership check failed:", error instanceof Error ? error.message : error);
        return { ok: false, reason: 'backend_unavailable' };
    }
}
