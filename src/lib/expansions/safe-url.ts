/**
 * URLs que llegan desde manifests/respuestas de extensiones (LINK.url, OPEN_URL, IMAGE_BUTTON.src, AVATAR.src,
 * NAVIGATE.path). Un manifest es dato de terceros: solo se aceptan esquemas inertes (nunca javascript:/data:).
 */

const NAVIGABLE = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const IMAGE = new Set(['http:', 'https:']);

function parse(raw: unknown): URL | null {
    const value = String(raw ?? '').trim();
    if (!value) return null;
    try {
        return new URL(value, 'https://placeholder.invalid');
    } catch {
        return null;
    }
}

/** Devuelve la URL si es http(s)/mailto/tel (o relativa); si no, null. */
export function safeHref(raw: unknown): string | null {
    const value = String(raw ?? '').trim();
    const url = parse(value);
    if (!url) return null;
    return NAVIGABLE.has(url.protocol) ? value : null;
}

/** Igual que safeHref pero solo http(s) (imagenes). */
export function safeImageSrc(raw: unknown): string | null {
    const value = String(raw ?? '').trim();
    const url = parse(value);
    if (!url) return null;
    return IMAGE.has(url.protocol) ? value : null;
}

/** Ruta interna de la app para NAVIGATE: debe empezar por una sola "/" (nada de //host ni esquemas). */
export function safeInternalPath(raw: unknown): string | null {
    const value = String(raw ?? '').trim();
    if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
    return value;
}
