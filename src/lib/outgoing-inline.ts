// Imagenes incrustadas como data: URI -> adjuntos inline con Content-ID (puro).
//
// Gmail, Outlook y otros clientes NO muestran `<img src="data:...">` en el cuerpo de un correo recibido; las imagenes incrustadas
// (p. ej. las `cid:` del original que el redactor pasa a data: URI al responder) deben viajar como partes MIME inline referenciadas por
// `cid:`. Esto reescribe el HTML que SALE (la copia guardada en Enviados conserva la data: URI, que nuestro lector si muestra).
import { randomUUID } from 'node:crypto';

export interface InlineImage {
    contentId: string;
    filename: string;
    contentType: string;
    content: Buffer;
}

export const MAX_INLINE_IMAGES = 20;
export const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;
const TYPES: Record<string, string> = { png: 'png', jpeg: 'jpg', jpg: 'jpg', gif: 'gif', webp: 'webp', bmp: 'bmp', 'svg+xml': '' };

/** Sustituye cada `<img src="data:image/...;base64,...">` por `cid:` y devuelve las imagenes. Las SVG y las que exceden los topes se dejan. */
export function hoistInlineImages(html: string, domain = 'bloomx.invalid'): { html: string; images: InlineImage[] } {
    if (!html || !/data:image\//i.test(html)) return { html, images: [] };
    const images: InlineImage[] = [];
    const byData = new Map<string, string>();
    const out = html.replace(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])data:image\/([a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)\2/gi, (whole, pre: string, quote: string, subtype: string, b64: string) => {
        const ext = TYPES[subtype.toLowerCase()];
        if (!ext) return whole; // svg y desconocidos: se dejan tal cual (el saneado los trata)
        const clean = b64.replace(/\s+/g, '');
        const known = byData.get(clean);
        if (known) return `${pre}${quote}cid:${known}${quote}`;
        if (images.length >= MAX_INLINE_IMAGES || clean.length * 0.75 > MAX_INLINE_IMAGE_BYTES) return whole;
        let content: Buffer;
        try { content = Buffer.from(clean, 'base64'); } catch { return whole; }
        if (content.length === 0) return whole;
        const contentId = `img-${images.length + 1}-${randomUUID().slice(0, 8)}@${domain}`;
        byData.set(clean, contentId);
        images.push({ contentId, filename: `image-${images.length + 1}.${ext}`, contentType: `image/${subtype.toLowerCase() === 'jpg' ? 'jpeg' : subtype.toLowerCase()}`, content });
        return `${pre}${quote}cid:${contentId}${quote}`;
    });
    return { html: out, images };
}
