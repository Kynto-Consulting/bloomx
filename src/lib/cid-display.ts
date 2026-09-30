/**
 * Resolucion de imagenes `cid:` al MOSTRAR un correo abierto (MailView -> SafeIframe).
 *
 * Se sustituye `src="cid:..."` por la URL FIRMADA del adjunto inline (la que ya entrega la API en `attachment.url`,
 * proxy /api/assets con HMAC + caducidad). Se resuelve por Content-ID y, si no hay, por nombre de archivo
 * (findAttachmentForCid). Reglas de seguridad:
 *  - Solo se tocan atributos `src="cid:..."` (no texto, no otros atributos, no CSS).
 *  - La URL inyectada debe ser http(s) y apuntar a `/api/assets/` (proxy propio); cualquier otra cosa se descarta y el
 *    `cid:` queda como estaba. El HTML del correo NUNCA aporta la URL final: solo la elige nuestro adjunto.
 *  - El valor se escapa para atributo HTML.
 *  - Las imagenes remotas no se tocan: siguen bloqueadas por SafeIframe (la CSP solo abre `origen/api/assets/`).
 */
import { findAttachmentForCid } from './email-utils';

const ASSET_PATH = '/api/assets/';

type AttLike = { filename?: string | null; mimeType?: string | null; key?: string | null; contentId?: string | null; url?: string | null };

/** URL firmada valida de nuestro proxy de adjuntos (o null). */
export function safeAssetUrl(raw: unknown): URL | null {
    if (typeof raw !== 'string' || !raw || raw.length > 4096) return null;
    try {
        if (raw.startsWith('//')) return null; // protocol-relative: el host lo elegiria el texto, no la app
        const u = new URL(raw, 'http://relative.invalid');
        // Ruta relativa (mismo origen que la app): se acepta si empieza por /api/assets/.
        if (raw.startsWith('/')) return u.pathname.startsWith(ASSET_PATH) ? u : null;
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
        if (u.username || u.password) return null;
        return u.pathname.startsWith(ASSET_PATH) ? u : null;
    } catch {
        return null;
    }
}

const escapeAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Fuente CSP (`https://host/api/assets/`) para permitir SOLO esas imagenes en el iframe aunque las remotas esten
 * bloqueadas. null si no es una URL absoluta valida de nuestro proxy.
 */
export function assetCspSource(raw: string, baseOrigin?: string): string | null {
    const abs = raw.startsWith('/') && !raw.startsWith('//') ? (baseOrigin ? new URL(raw, baseOrigin).toString() : null) : raw;
    if (!abs) return null;
    const u = safeAssetUrl(abs);
    if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:')) return null;
    return `${u.origin}${ASSET_PATH}`;
}

export interface CidDisplayResult {
    html: string;
    /** Fuentes CSP (origen + /api/assets/) de las URLs inyectadas, para img-src del iframe. */
    sources: string[];
}

/** `html` debe venir ya saneado (o pasara por SafeIframe/DOMPurify despues). No toca nada que no sea `src="cid:..."`. */
export function resolveInlineCidImages(html: string, attachments: AttLike[] | null | undefined, baseOrigin?: string): CidDisplayResult {
    const source = String(html || '');
    if (!attachments?.length || !/cid:/i.test(source)) return { html: source, sources: [] };

    const sources = new Set<string>();
    const out = source.replace(/(\bsrc\s*=\s*)(["'])cid:([^"'<>]*)\2/gi, (whole, prefix: string, quote: string, cidRaw: string) => {
        const cid = cidRaw.replace(/&amp;/gi, '&');
        const att = findAttachmentForCid(cid, attachments);
        const url = att && safeAssetUrl(att.url);
        if (!att || !url) return whole;
        // El iframe tiene origen opaco: una ruta relativa solo sirve si se conoce el origen de la app.
        const finalUrl = String(att.url).startsWith('/') ? (baseOrigin ? new URL(String(att.url), baseOrigin).toString() : null) : url.toString();
        const cspSource = finalUrl && assetCspSource(finalUrl);
        if (!finalUrl || !cspSource) return whole;
        sources.add(cspSource);
        return `${prefix}${quote}${escapeAttr(finalUrl)}${quote}`;
    });
    return { html: out, sources: [...sources] };
}
