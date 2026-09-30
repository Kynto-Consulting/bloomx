/**
 * raw-mime.ts - MIME ORIGINAL de los correos entrantes (Resend).
 *
 * El webhook guarda `raw.json` (payload del evento, con un subconjunto de cabeceras) y NO el mensaje original. process-attachments ya
 * descarga el MIME crudo de Resend para extraer adjuntos; ahi se guarda TAMBIEN como `raw.eml` (mismo prefijo que raw.json), si:
 *   - MAIL_STORE_RAW_MIME no es 'false', y
 *   - su tamano <= RAW_MIME_MAX_MB (25 por defecto).
 * La exportacion prefiere ese objeto (cabeceras exactas: Received, Authentication-Results, DKIM-Signature...) y solo si no existe intenta
 * bajarlo de `Email.rawMimeUrl` (con timeout, sin bloquear) antes de reconstruir el mensaje.
 *
 * `Email.rawKey` SIGUE apuntando a raw.json: api/emails/[id] y process-attachments/reprocess lo parsean como JSON. La clave de raw.eml
 * se DERIVA de rawKey (`rawEmlKey`), asi que no hay migracion ni columna nueva; la retencion borra ambos objetos.
 */
import { lookup } from 'node:dns/promises';
import net from 'node:net';

export function rawMimeMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
    const n = Number.parseFloat(String(env.RAW_MIME_MAX_MB ?? ''));
    const mb = Number.isFinite(n) && n > 0 ? Math.min(n, 512) : 25;
    return Math.floor(mb * 1024 * 1024);
}

export function storeRawMimeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return String(env.MAIL_STORE_RAW_MIME ?? '').trim().toLowerCase() !== 'false';
}

/** Clave de raw.eml a partir de la clave de raw.json (o de raw.eml). null si `rawKey` no tiene la forma esperada. */
export function rawEmlKey(rawKey: string | null | undefined): string | null {
    const k = String(rawKey ?? '');
    const m = /^(.*\/)raw\.(?:json|eml)$/.exec(k);
    return m ? `${m[1]}raw.eml` : null;
}

/** Clave de raw.json a partir de la de raw.eml (o la misma si ya es raw.json). */
export function rawJsonKey(rawKey: string | null | undefined): string | null {
    const k = String(rawKey ?? '');
    const m = /^(.*\/)raw\.(?:json|eml)$/.exec(k);
    return m ? `${m[1]}raw.json` : k || null;
}

/** Todos los objetos "crudos" que cuelgan de un correo (para retencion y borrado completo). */
export function rawObjectKeys(rawKey: string | null | undefined): string[] {
    const out = new Set<string>();
    if (rawKey) out.add(rawKey);
    const e = rawEmlKey(rawKey);
    if (e) out.add(e);
    return [...out];
}

// ---------------------------------------------------------------------------------------------------------------------
// Descarga segura del MIME desde rawMimeUrl (exportacion de correos antiguos)
// ---------------------------------------------------------------------------------------------------------------------

export function isPrivateAddress(ip: string): boolean {
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split('.').map(Number);
        return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
    }
    if (net.isIPv6(ip)) {
        const v = ip.toLowerCase();
        if (v === '::1' || v === '::') return true;
        if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')) return true;
        const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
        return mapped ? isPrivateAddress(mapped[1]) : false;
    }
    return true;
}

/** Solo https, sin credenciales, sin IP literal privada ni nombres locales. */
export function isSafeRemoteMimeUrl(raw: string | null | undefined): URL | null {
    if (!raw || raw.length > 4000) return null;
    let u: URL;
    try { u = new URL(raw); } catch { return null; }
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname) return null;
    const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return null;
    if (net.isIP(host) && isPrivateAddress(host)) return null;
    return u;
}

export type RawMimeFetcher = (url: string) => Promise<Buffer | null>;

/**
 * Descarga el MIME original con timeout y tope de tamano. Devuelve null ante cualquier fallo (URL caducada, red, tamano, host privado):
 * el llamador reconstruye el mensaje. No sigue redirecciones a otros hosts.
 */
export function createRawMimeFetcher(opts: { timeoutMs?: number; maxBytes?: number; fetchImpl?: typeof fetch; resolve?: (host: string) => Promise<string[]> } = {}): RawMimeFetcher {
    const timeoutMs = opts.timeoutMs ?? 4000;
    const doFetch = opts.fetchImpl ?? fetch;
    const resolve = opts.resolve ?? (async (host: string) => (await lookup(host, { all: true })).map((a) => a.address));
    return async (rawUrl: string) => {
        const max = opts.maxBytes ?? rawMimeMaxBytes();
        const u = isSafeRemoteMimeUrl(rawUrl);
        if (!u) return null;
        try {
            const host = u.hostname.replace(/^\[|\]$/g, '');
            if (!net.isIP(host)) {
                const addrs = await resolve(host);
                if (addrs.length === 0 || addrs.some(isPrivateAddress)) return null;
            }
            const res = await doFetch(u.toString(), { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual', headers: { Accept: 'message/rfc822, */*' } });
            if (!res.ok || !res.body) return null;
            const declared = Number(res.headers.get('content-length') || 0);
            if (declared > max) return null;
            const chunks: Buffer[] = [];
            let total = 0;
            const reader = res.body.getReader();
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                total += value.length;
                if (total > max) { await reader.cancel().catch(() => undefined); return null; }
                chunks.push(Buffer.from(value));
            }
            return total > 0 ? Buffer.concat(chunks) : null;
        } catch {
            return null;
        }
    };
}
