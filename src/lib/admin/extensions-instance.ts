import { clientVersionHeaders } from '@/lib/expansions/client/capabilities';
import { HttpError } from '@/lib/admin/http';

/**
 * Datos del backend compartido que necesitan las rutas /api/admin/extensions/**:
 *  - URL base del backend (misma resolucion que el resto de proxies).
 *  - Id del Domain de ESTA instancia: los proxies de escritura solo aceptan ese `domainId`. El backend ya comprueba que el
 *    manager es dueno del dominio, pero un manager puede poseer varios: aqui se impide actuar sobre otro dominio suyo desde
 *    la consola de esta instancia.
 */

export const backendUrl = () => (process.env.NEXT_PUBLIC_BACKEND_URL || 'https://backend.bloomx.arubik.dev').replace(/\/+$/, '');

const TTL_MS = 60_000;
let cache: { host: string; id: string | null; until: number } | null = null;

export function __resetInstanceCache() {
    cache = null;
}

function instanceHost(req?: Request): string {
    if (process.env.TOP_DOMAIN) return process.env.TOP_DOMAIN.split(':')[0];
    try {
        if (process.env.NEXT_PUBLIC_APP_URL) return new URL(process.env.NEXT_PUBLIC_APP_URL).hostname;
    } catch {
        /* sin URL publica */
    }
    return (req?.headers.get('host') || '').split(':')[0];
}

/** Host con el que esta instancia se identifica ante el backend (para firmar y para /api/config). */
export const ownHost = instanceHost;

/** Id del Domain de esta instancia segun el backend (`/api/config`), con cache de 60 s. null = no resuelto. */
export async function resolveInstanceDomainId(req?: Request): Promise<string | null> {
    const host = instanceHost(req);
    if (!host) return null;
    const now = Date.now();
    if (cache && cache.host === host && cache.until > now) return cache.id;
    let id: string | null = null;
    try {
        const res = await fetch(`${backendUrl()}/api/config?domain=${encodeURIComponent(host)}`, {
            cache: 'no-store',
            headers: clientVersionHeaders(),
            signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
            const data: any = await res.json().catch(() => null);
            id = typeof data?.config?.id === 'string' && data.config.id.length <= 200 ? data.config.id : null;
        }
    } catch {
        id = null;
    }
    cache = { host, id, until: now + (id ? TTL_MS : 5_000) };
    return id;
}

/** 403 `domain_mismatch` si `domainId` no es el dominio de esta instancia; 503 si no se puede determinar (falla cerrado). */
export async function assertInstanceDomain(domainId: string, req?: Request): Promise<void> {
    const own = await resolveInstanceDomainId(req);
    if (!own) throw new HttpError(503, 'instance_unavailable');
    if (own !== domainId) throw new HttpError(403, 'domain_mismatch');
}
