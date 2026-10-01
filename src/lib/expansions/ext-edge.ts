/**
 * Proxy publico de rutas de extensiones (`/api/ext/[extensionId]/[...path]`), parte PURA: saneo de la peticion entrante, URL firmada hacia
 * el backend compartido y relevo de la respuesta. El backend decide el modo de autenticacion segun el manifest; este borde solo aporta
 * (dentro de la URL FIRMADA con Ed25519) quien llama: `_bx_src=edge`, el nivel de admin, el step-up y la IP real. Ver
 * bloomx-backend/src/lib/extensions/ext-routes.ts y bloomx-extensions/_shared/OAUTH-PROVIDERS.md (modelo de amenazas).
 */

export const EDGE_MAX_BODY_BYTES = 1_048_576;
export const EXTENSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const RESERVED_PREFIX = '_bx_';
export const FORWARD_HEADER_PREFIX = 'x-bloomx-fwd-';

/** Ruta tras /api/ext/<id>: sin percent-encoding, sin `\`, `//`, `.` ni `..`. null = rechazada. */
export function edgeRoutePath(pathname: string, extensionId: string): string | null {
    const prefix = `/api/ext/${extensionId}`;
    if (!pathname.startsWith(prefix)) return null;
    const rest = pathname.slice(prefix.length) || '/';
    if (rest.includes('%') || rest.includes('\\') || rest.includes('//') || !rest.startsWith('/')) return null;
    if (rest.split('/').some((s) => s === '.' || s === '..')) return null;
    return rest;
}

/** Query del llamador SIN ningun parametro reservado (`_bx_*`): nadie de fuera puede fijar la identidad que el borde firma. */
export function sanitizeEdgeQuery(searchParams: URLSearchParams): URLSearchParams {
    const out = new URLSearchParams();
    for (const [k, v] of searchParams) if (!k.toLowerCase().startsWith(RESERVED_PREFIX)) out.append(k, v);
    return out;
}

export type EdgeIdentityParams = { level: number | null; stepUp: boolean; clientIp: string | null; /** Sec-Fetch-Site de la peticion original (firmado en la URL). */ fetchSite?: string | null };

/** URL del backend con la query del llamador + los parametros reservados (todo queda dentro de la firma). */
export function buildBackendRouteUrl(backendBase: string, extensionId: string, path: string, query: URLSearchParams, edge: EdgeIdentityParams): string {
    const q = new URLSearchParams(query);
    q.set('_bx_src', 'edge');
    if (edge.level !== null && edge.level >= 1 && edge.level <= 4) q.set('_bx_lvl', String(edge.level));
    if (edge.stepUp) q.set('_bx_su', '1');
    if (edge.clientIp && /^[0-9a-fA-F:.]{3,45}$/.test(edge.clientIp)) q.set('_bx_ip', edge.clientIp);
    if (edge.fetchSite && ['same-origin', 'same-site', 'cross-site', 'none'].includes(edge.fetchSite)) q.set('_bx_fs', edge.fetchSite);
    return `${backendBase.replace(/\/+$/, '')}/api/ext/${extensionId}${path}?${q.toString()}`;
}

export function isSafeMethod(method: string): boolean {
    const m = method.toUpperCase();
    return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
}

/**
 * La sesion del navegador solo cuenta en peticiones de MISMO ORIGEN (o no navegador). Un POST/PUT/PATCH/DELETE cross-site se trata como
 * ANONIMO (defensa CSRF): una ruta `session` responde 401 y un tercero legitimo (webhook, sin cookie) no se ve afectado.
 */
export function sessionAllowed(method: string, headers: { get(name: string): string | null }): boolean {
    if (isSafeMethod(method)) return true;
    const fetchSite = headers.get('sec-fetch-site');
    if (fetchSite) return fetchSite === 'same-origin' || fetchSite === 'none';
    const origin = headers.get('origin');
    if (!origin) return true; // cliente que no es un navegador
    const host = headers.get('x-forwarded-host') || headers.get('host') || '';
    try { return new URL(origin).host === host; } catch { return false; }
}

const DROP_REQUEST_HEADERS = new Set([
    'cookie', 'authorization', 'proxy-authorization', 'host', 'connection', 'content-length', 'transfer-encoding', 'upgrade',
    'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'forwarded', 'te', 'expect',
]);

/** Cabeceras del tercero que se reenvian como `x-bloomx-fwd-<nombre>` (para HMAC): sin cookies/authorization/reservadas, acotadas. */
export function forwardableHeaders(headers: { forEach(cb: (value: string, key: string) => void): void }): Record<string, string> {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
        const k = key.toLowerCase();
        if (DROP_REQUEST_HEADERS.has(k) || k.startsWith('x-bloomx-') || k.startsWith('sec-') || k.startsWith('x-vercel-') || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(k)) return;
        if (Object.keys(out).length >= 24) return;
        out[`${FORWARD_HEADER_PREFIX}${k}`] = value.slice(0, 1024);
    });
    return out;
}

const RELAY_RESPONSE_HEADERS = new Set([
    'content-type', 'cache-control', 'etag', 'retry-after', 'content-language', 'content-disposition', 'allow', 'vary',
    'x-content-type-options', 'content-security-policy', 'referrer-policy', 'cross-origin-resource-policy', 'x-frame-options',
    'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers', 'access-control-max-age',
]);

/** Cabeceras del backend que se relevan al navegador (lista blanca; jamas set-cookie ni cabeceras internas). */
export function relayResponseHeaders(headers: { forEach(cb: (value: string, key: string) => void): void }): Record<string, string> {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
        const k = key.toLowerCase();
        if (RELAY_RESPONSE_HEADERS.has(k) || /^x-ext-[a-z0-9-]{1,40}$/.test(k)) out[k] = value.slice(0, 1024);
    });
    return out;
}
