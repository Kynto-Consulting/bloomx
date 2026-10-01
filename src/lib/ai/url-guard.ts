import { lookup as dnsLookup } from 'node:dns';
import net from 'node:net';
import https from 'node:https';

/**
 * Proteccion SSRF para la baseUrl del proveedor de IA (y para TODAS las llamadas salientes del servicio de IA):
 *  - solo https, sin credenciales en la URL, sin fragmentos;
 *  - el host no puede ser una IP privada / loopback / link-local / metadata cloud ni un nombre interno (localhost, *.local, *.internal);
 *  - la resolucion DNS se valida al guardar Y en cada conexion (el `lookup` del socket rechaza IPs privadas: cierra el DNS rebinding);
 *  - sin redirecciones.
 */
export class UnsafeUrlError extends Error {
    constructor(public readonly reason: string) { super(reason); this.name = 'UnsafeUrlError'; }
}

export function isPrivateIp(ip: string): boolean {
    let v = ip.trim().toLowerCase();
    if (v.startsWith('::ffff:')) v = v.slice(7); // IPv4 mapeada
    if (net.isIPv4(v)) {
        const [a, b] = v.split('.').map(Number);
        return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
    }
    if (net.isIPv6(v)) {
        if (v === '::' || v === '::1') return true;
        return /^(fc|fd)/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('ff') || v.startsWith('64:ff9b') || v.startsWith('2001:db8');
    }
    return true; // no es una IP valida: falla cerrado
}

const BAD_HOST = /(^|\.)(localhost|local|internal|localdomain|lan|home|corp|intranet)$/i;

/** Validacion sincrona (sin DNS). Devuelve la URL normalizada (sin barra final) o lanza UnsafeUrlError. */
export function parseSafeBaseUrl(raw: unknown): URL {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 300) throw new UnsafeUrlError('invalid');
    let u: URL;
    try { u = new URL(raw.trim()); } catch { throw new UnsafeUrlError('invalid'); }
    if (u.protocol !== 'https:') throw new UnsafeUrlError('not_https');
    if (u.username || u.password) throw new UnsafeUrlError('credentials');
    if (u.hash || u.search) throw new UnsafeUrlError('query_or_fragment');
    // Un punto final ("localhost.", "x.internal.") es el mismo nombre: se quita para no saltarse la lista de nombres internos.
    const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.+$/, '');
    if (!host) throw new UnsafeUrlError('invalid');
    if (net.isIP(host)) { if (isPrivateIp(host)) throw new UnsafeUrlError('private_ip'); }
    else {
        if (BAD_HOST.test(host) || !host.includes('.')) throw new UnsafeUrlError('internal_host');
        // Formas numericas de IP que net.isIP no reconoce (0x7f.1, 2130706433, 017700000001...)
        if (/^[0-9a-fx.]+$/i.test(host) && /\d/.test(host) && !/[g-wyz]/i.test(host)) throw new UnsafeUrlError('private_ip');
    }
    if (u.port && Number(u.port) < 1024 && u.port !== '443') throw new UnsafeUrlError('port');
    u.pathname = u.pathname.replace(/\/+$/, '');
    return u;
}

export const safeLookup: typeof dnsLookup = ((hostname: string, options: any, cb: any) => {
    const callback = typeof options === 'function' ? options : cb;
    const opts = typeof options === 'function' ? {} : options;
    dnsLookup(hostname, { ...opts, all: true }, (err, addrs: any) => {
        if (err) return callback(err);
        const list = Array.isArray(addrs) ? addrs : [{ address: addrs, family: 4 }];
        if (list.length === 0 || list.some((a: any) => isPrivateIp(a.address))) return callback(new UnsafeUrlError('private_ip'));
        if (opts?.all) return callback(null, list);
        return callback(null, list[0].address, list[0].family);
    });
}) as any;

/** Validacion completa al guardar: sintaxis + resolucion DNS (todas las direcciones deben ser publicas). */
export async function assertSafeBaseUrl(raw: unknown): Promise<URL> {
    const u = parseSafeBaseUrl(raw);
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host)) return u;
    await new Promise<void>((resolve, reject) => {
        safeLookup(host, { all: true }, (err: any) => (err ? reject(err instanceof UnsafeUrlError ? err : new UnsafeUrlError('dns')) : resolve()));
    });
    return u;
}

export interface TransportRequest { url: string; headers: Record<string, string>; body: string; timeoutMs: number; maxBytes?: number }
export interface TransportResponse { status: number; body: string }
export type AiTransport = (req: TransportRequest) => Promise<TransportResponse>;

/** Transporte real: https.request con lookup validado, sin redirecciones, con timeout y tope de tamano. */
export const httpsTransport: AiTransport = (req) => new Promise((resolve, reject) => {
    let u: URL;
    try { u = new URL(req.url); } catch { return reject(new UnsafeUrlError('invalid')); }
    if (u.protocol !== 'https:') return reject(new UnsafeUrlError('not_https'));
    const max = req.maxBytes ?? 2 * 1024 * 1024;
    const r = https.request(u, { method: 'POST', headers: { ...req.headers, 'Content-Length': Buffer.byteLength(req.body) }, lookup: safeLookup as any, timeout: req.timeoutMs }, (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => { size += c.length; if (size > max) { r.destroy(new Error('too_large')); return; } chunks.push(c); });
        res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', reject);
    r.write(req.body);
    r.end();
});
