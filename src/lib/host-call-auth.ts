import { GRANT_HEADER, consumeGrantUse, grantAllowsService, verifyExecutionGrant, type GrantClaims } from '@/lib/exec-grant';

/**
 * Autenticacion de las llamadas backend -> instancia a /api/internal/**.
 *
 *  1. CAMINO NUEVO (ext.grants.v1): cabecera `X-BloomX-Grant` = la `executionGrant` que ESTA instancia firmo con su propia clave de dominio y que el
 *     backend reenvia tal cual. Se verifica sin red (clave publica derivada de la privada de la instancia), caducidad, audiencia = X-BloomX-Domain,
 *     extension/usuario del cuerpo == los de la concesion, servicio cubierto por sus permisos y tope de usos por jti.
 *  2. LEGADO DEPRECADO: firma Ed25519 del backend (clave global del backend, BLOOMX_BACKEND_PUBLIC_KEY o descubrimiento HTTP). Se sigue ACEPTANDO si llega
 *     (transicion con backends/instancias ya desplegados) con aviso en el log. Apagar: BLOOMX_ACCEPT_BACKEND_SIGNATURE=false. Se retirara en una version futura.
 */

type Env = Record<string, string | undefined>;
export type HostCallVerdict =
    | { ok: true; userId: string | null; grant?: GrantClaims; legacy?: boolean }
    | { ok: false; reason: 'unavailable' | 'invalid' };

/** true si la instancia todavia acepta la firma antigua del backend (por defecto si; `false` la apaga). */
export function acceptsLegacyBackendSignature(env: Env = process.env): boolean {
    return String(env.BLOOMX_ACCEPT_BACKEND_SIGNATURE ?? 'true').toLowerCase() !== 'false';
}

let warnedLegacy = false;
export function __resetLegacyWarning(): void { warnedLegacy = false; }

/** Servicio que se pide: ultimo segmento de /api/internal/<svc> o /api/internal/host/<svc>. */
export function serviceFromPath(pathname: string): string | null {
    const m = /^\/api\/internal\/(?:host\/)?([a-z][a-z0-9-]{1,31})\/?$/.exec(pathname);
    return m ? m[1] : null;
}

export async function verifyHostCall(
    req: { method: string; url: string; headers: { get(name: string): string | null } },
    raw: string,
    opts: { env?: Env; nowMs?: number; legacyVerify?: (req: any, raw: string) => Promise<{ ok: true; userId: string | null } | { ok: false; reason: 'unavailable' | 'invalid' }> } = {},
): Promise<HostCallVerdict> {
    const env = opts.env ?? process.env;
    const token = req.headers.get(GRANT_HEADER);
    if (token) {
        const v = verifyExecutionGrant(token, env, opts.nowMs);
        if (v.ok === false) return { ok: false, reason: 'invalid' };
        const c = v.claims;
        const headerDomain = (req.headers.get('x-bloomx-domain') || '').split(':')[0].toLowerCase();
        if (!headerDomain || headerDomain !== c.aud) return { ok: false, reason: 'invalid' };
        let body: Record<string, unknown> | null = null;
        try { const parsed = JSON.parse(raw); body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null; } catch { body = null; }
        if (!body || body.extensionId !== c.ext) return { ok: false, reason: 'invalid' };
        if (body.userId !== undefined && (c.sub === null || body.userId !== c.sub)) return { ok: false, reason: 'invalid' };
        let pathname = '';
        try { pathname = new URL(req.url, 'https://x.invalid').pathname; } catch { return { ok: false, reason: 'invalid' }; }
        const service = serviceFromPath(pathname);
        if (!service || !grantAllowsService(c, service)) return { ok: false, reason: 'invalid' };
        if (!consumeGrantUse(c, opts.nowMs)) return { ok: false, reason: 'invalid' };
        return { ok: true, userId: c.sub, grant: c };
    }
    if (!acceptsLegacyBackendSignature(env)) return { ok: false, reason: 'invalid' };
    const legacy = opts.legacyVerify ?? (async (r: any, b: string) => (await import('@/lib/backend-auth')).verifyBackendRequest(r, b));
    const verdict = await legacy(req, raw);
    if (verdict.ok) {
        if (!warnedLegacy) { warnedLegacy = true; console.warn('[HOST_AUTH] DEPRECADO: llamada autenticada con la firma del backend (clave global). Usa ext.grants.v1 y BLOOMX_ACCEPT_BACKEND_SIGNATURE=false.'); }
        return { ok: true, userId: verdict.userId, legacy: true };
    }
    return verdict;
}
