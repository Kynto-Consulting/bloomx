/**
 * URL del backend compartido. En PRODUCCION debe ser https (o localhost): una URL http enviaria las llamadas firmadas, el registro de proveedores
 * OAuth y los tokens de extension en claro. El valor por defecto es https. Lanza `insecure_backend_url` si no cumple.
 */
export const DEFAULT_BACKEND_URL = 'https://backend.bloomx.arubik.dev';

export function backendUrl(env: Record<string, string | undefined> = process.env): string {
    const raw = (env.NEXT_PUBLIC_BACKEND_URL || DEFAULT_BACKEND_URL).trim().replace(/\/+$/, '');
    let u: URL;
    try { u = new URL(raw); } catch { throw new Error('insecure_backend_url'); }
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (env.NODE_ENV !== 'production' || local))) throw new Error('insecure_backend_url');
    return raw;
}
