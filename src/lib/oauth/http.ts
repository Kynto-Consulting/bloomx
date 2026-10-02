import { lookup } from 'node:dns/promises';
import https from 'node:https';
import { Readable } from 'node:stream';
import { BlockList, isIP } from 'node:net';
import { checkOAuthEndpointUrl } from '@/lib/expansions/oauth-schema';

/**
 * Transporte HTTP del flujo OAuth hacia el PROVEEDOR (token, revocacion, userinfo, JWKS, acciones). Todo lo que sale pasa por aqui:
 *  - solo https, puerto 443, sin credenciales en la URL, host dentro de `allowedHosts` del proveedor registrado (lo declara la extension y el
 *    admin la aprueba) y DNS publico: se resuelve el host y se rechaza si ALGUNA direccion es privada/loopback/link-local/CGNAT/multicast;
 *  - sin redirecciones (un 3xx es error: un proveedor legitimo no redirige un POST de token y asi nadie desvia el client_secret);
 *  - timeout y tope de tamano de respuesta (se corta la lectura al exceder);
 *  - nunca se registran URLs con query, cuerpos ni cabeceras (el secreto va en el cuerpo del token).
 * RFC 9700 §4.12-4.13, OWASP API7:2023 (SSRF), NIST SP 800-53 SC-7.
 */

const PRIVATE = new BlockList();
for (const [net, prefix] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
    ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) PRIVATE.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['2001:db8::', 32], ['::', 96], ['2002::', 16], ['2001::', 32]] as const) PRIVATE.addSubnet(net, prefix, 'ipv6');

/** true si la direccion NO es enrutable publicamente (incluye IPv6 mapeado a IPv4 privado). */
export function isPrivateAddress(address: string): boolean {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    // IPv4 mapeado en notacion hexadecimal (::ffff:7f00:1 == 127.0.0.1).
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
    const fromHex = hex ? `${parseInt(hex[1], 16) >> 8}.${parseInt(hex[1], 16) & 255}.${parseInt(hex[2], 16) >> 8}.${parseInt(hex[2], 16) & 255}` : null;
    const ip = mapped ? mapped[1] : fromHex ?? address;
    const family = isIP(ip);
    if (family === 0) return true; // no es una IP valida: no se confia
    return PRIVATE.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

export class ProviderHttpError extends Error {
    constructor(public code: 'oauth_url_rejected' | 'oauth_dns_rejected' | 'oauth_redirect_rejected' | 'oauth_response_too_large' | 'oauth_timeout' | 'oauth_network', message?: string) {
        super(message ?? code);
        this.name = 'ProviderHttpError';
    }
}

export type TransportFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<Response>;
let transportOverride: TransportFetch | null = null;
let resolverOverride: ((host: string) => Promise<string[]>) | null = null;

/** SOLO PRUEBAS: sustituye el transporte (servidor OAuth falso en proceso). Lanza fuera de NODE_ENV=test. */
export function __setOAuthTransport(impl: TransportFetch | null, resolver?: ((host: string) => Promise<string[]>) | null): void {
    if (process.env.NODE_ENV !== 'test') throw new Error('__setOAuthTransport is only available in tests');
    transportOverride = impl;
    resolverOverride = resolver ?? null;
}

const systemResolve = async (host: string): Promise<string[]> => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/**
 * `lookup` para https.request que VALIDA CADA resolucion y devuelve esa MISMA direccion al socket: no hay ventana entre "comprobar el DNS" y
 * "conectar" (anti DNS-rebinding / TOCTOU). El SNI y la cabecera Host siguen siendo el nombre del proveedor (TLS valida el certificado contra el host).
 */
export function makePinnedLookup(resolve: (host: string) => Promise<string[]>) {
    return (hostname: string, options: unknown, callback: (err: Error | null, address?: string | Array<{ address: string; family: number }>, family?: number) => void) => {
        const wantAll = !!(options && typeof options === 'object' && (options as { all?: boolean }).all);
        resolve(hostname).then((addresses) => {
            if (addresses.length === 0 || addresses.some(isPrivateAddress)) return callback(new ProviderHttpError('oauth_dns_rejected'));
            const address = addresses[0];
            const family = isIP(address);
            return wantAll ? callback(null, [{ address, family }]) : callback(null, address, family);
        }, () => callback(new ProviderHttpError('oauth_network')));
    };
}

function pinnedTransport(url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }): Promise<Response> {
    const u = new URL(url);
    return new Promise<Response>((resolve, reject) => {
        const req = https.request({
            protocol: 'https:', hostname: u.hostname, port: 443, path: `${u.pathname}${u.search}`, method: init.method, headers: init.headers,
            servername: u.hostname, lookup: makePinnedLookup(resolverOverride ?? systemResolve) as never, signal: init.signal, agent: false,
        }, (res) => {
            const headers = new Headers();
            for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
            const status = res.statusCode ?? 502;
            const nullBody = status === 204 || status === 205 || status === 304 || (status >= 100 && status < 200);
            resolve(new Response(nullBody ? null : (Readable.toWeb(res) as unknown as ReadableStream), { status, headers }));
        });
        req.on('error', (e) => reject(e));
        if (init.body !== undefined) req.write(init.body);
        req.end();
    });
}

async function resolvePublic(host: string): Promise<void> {
    const addresses = resolverOverride ? await resolverOverride(host) : await systemResolve(host);
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new ProviderHttpError('oauth_dns_rejected');
}

export interface ProviderRequest {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    maxBytes?: number;
}
/** Solo las cabeceras de limite de tasa (X-RateLimit-*, Retry-After), NUNCA las demas: el broker no devuelve cabeceras del proveedor. */
export interface ProviderRateInfo { remaining?: number; resetAfterMs?: number; retryAfterMs?: number }
export interface ProviderResponse { status: number; ok: boolean; text: string; json: unknown | null; rate?: ProviderRateInfo }

export async function providerFetch(allowedHosts: readonly string[], url: string, req: ProviderRequest = {}): Promise<ProviderResponse> {
    if (checkOAuthEndpointUrl(url, allowedHosts) !== null) throw new ProviderHttpError('oauth_url_rejected');
    // Con transporte inyectado (pruebas) se comprueba el DNS aqui; el transporte real valida CADA resolucion en su propio lookup (sin TOCTOU).
    if (transportOverride) await resolvePublic(new URL(url).hostname);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 10_000);
    const max = req.maxBytes ?? 1_048_576;
    try {
        const init = { method: req.method ?? 'GET', headers: { Accept: 'application/json', 'User-Agent': 'BloomX-OAuth/1.0', ...(req.headers ?? {}) }, body: req.body, signal: controller.signal };
        const res = transportOverride
            ? await transportOverride(url, init)
            : await pinnedTransport(url, init);
        if (res.status >= 300 && res.status < 400) throw new ProviderHttpError('oauth_redirect_rejected');
        const declared = Number(res.headers.get('content-length') || 0);
        if (declared > max) throw new ProviderHttpError('oauth_response_too_large');
        let text = '';
        if (res.body) {
            const reader = res.body.getReader();
            const chunks: Buffer[] = [];
            let total = 0;
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                total += value.byteLength;
                if (total > max) { await reader.cancel().catch(() => undefined); throw new ProviderHttpError('oauth_response_too_large'); }
                chunks.push(Buffer.from(value));
            }
            text = Buffer.concat(chunks).toString('utf8');
        }
        let json: unknown | null = null;
        try { json = text ? JSON.parse(text) : null; } catch { json = null; }
        const num = (h: string): number | undefined => { const v = res.headers.get(h); const n = v === null ? NaN : Number(v); return Number.isFinite(n) && n >= 0 ? n : undefined; };
        const remaining = num('x-ratelimit-remaining'); const reset = num('x-ratelimit-reset-after'); const retry = num('retry-after');
        const rate: ProviderRateInfo = { ...(remaining !== undefined ? { remaining } : {}), ...(reset !== undefined ? { resetAfterMs: Math.round(reset * 1000) } : {}), ...(retry !== undefined ? { retryAfterMs: Math.round(retry * 1000) } : {}) };
        return { status: res.status, ok: res.status >= 200 && res.status < 300, text, json, ...(Object.keys(rate).length ? { rate } : {}) };
    } catch (error) {
        if (error instanceof ProviderHttpError) throw error;
        if ((error as { name?: string } | null)?.name === 'AbortError') throw new ProviderHttpError('oauth_timeout');
        throw new ProviderHttpError('oauth_network');
    } finally {
        clearTimeout(timer);
    }
}
