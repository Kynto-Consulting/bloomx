import type { NextRequest } from 'next/server';
import { HttpError } from './http';
export { looksLikePrivateKey } from './profile-keys';
import { backendBaseUrl, ownDomains } from '@/lib/backend-auth';

/**
 * Utilidades del proxy de la clave de firma (/api/admin/domain-key). Solo servidor.
 * Nunca se manejan claves privadas: si el texto pegado parece una, se rechaza antes de tocar la red.
 */

/** Huella segura para devolver/auditar: solo caracteres hex/base64 cortos, si no null. */
export function cleanFingerprint(value: unknown): string | null {
    return typeof value === 'string' && /^[A-Za-z0-9:+/=_-]{6,128}$/.test(value) ? value : null;
}

/** Solo la cookie de sesion del manager (nunca el resto de cookies de la app). */
export function managerCookieHeader(req: NextRequest): string {
    const v = req.cookies.get('auth_session')?.value;
    return v ? `auth_session=${v}` : '';
}

/**
 * Comprueba que `domainId` es el Domain de ESTA instancia y que el manager lo posee, consultando al backend con su cookie.
 * Sin revelar datos: dominio ajeno o desconocido => 403 `forbidden_domain`. Backend caido => 502.
 */
export async function assertDomainIsThisInstance(req: NextRequest, domainId: string): Promise<void> {
    const cookie = managerCookieHeader(req);
    if (!cookie) throw new HttpError(409, 'manager_session_required');
    let res: Response;
    try {
        res = await fetch(`${backendBaseUrl()}/api/manager/domains`, {
            method: 'GET',
            headers: { Cookie: cookie },
            cache: 'no-store',
            signal: AbortSignal.timeout(4000),
        });
    } catch {
        throw new HttpError(502, 'backend_unavailable');
    }
    if (res.status === 401 || res.status === 403) throw new HttpError(403, 'forbidden_domain');
    if (!res.ok) throw new HttpError(502, 'backend_unavailable');
    const data: any = await res.json().catch(() => null);
    const own = new Set(ownDomains());
    const found = Array.isArray(data?.domains)
        && data.domains.some((d: any) =>
            d && d.id === domainId && typeof d.name === 'string' && own.has(d.name.split(':')[0].trim().toLowerCase()));
    if (!found) throw new HttpError(403, 'forbidden_domain');
}
