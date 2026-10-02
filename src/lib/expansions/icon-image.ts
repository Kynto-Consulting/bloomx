/**
 * Imagenes de icono de extension (PURO, sin React). La fuente de verdad de los logotipos es el BACKEND compartido
 * (GET /api/extensions/icons/<id>): cambiar un logo no exige desplegar ni recargar clientes. Aqui se decide de DONDE sale la imagen:
 *
 *   1. `icon` = data URL (data:image/png|webp|svg+xml;base64,...): manifests/desarrolladores. Validada por lista blanca de prefijos,
 *      firma real y limite de tamano (64 KB), igual que el backend.
 *   2. `iconUrl` del catalogo (`/api/extensions/icons/<id>?h=<hash>`): el hash cambia cuando cambia el logo, asi el navegador cachea
 *      "para siempre" cada version y la URL nueva se pide sola.
 *   3. `brand:<slug>`: `/api/extensions/icons/brand.<slug>` (logotipos de marca, mismos que usa cualquier superficie).
 *
 * Todo lo demas (lucide:, initials:, nombres sueltos) no tiene imagen: se queda el placeholder del componente.
 */

export const MAX_ICON_BYTES = 64 * 1024;
/** Un data URL base64 de 64 KB ocupa ~87.4 K caracteres; se deja margen para el prefijo. */
const MAX_DATA_URL_CHARS = Math.ceil((MAX_ICON_BYTES * 4) / 3) + 64;

const DATA_URL_RE = /^data:image\/(png|webp|svg\+xml);base64,([A-Za-z0-9+/]+={0,2})$/;
const BRAND_SLUG_RE = /^[a-z][a-z0-9]{0,39}$/;
const ICON_PATH_RE = /^\/api\/extensions\/icons\/[a-z0-9][a-z0-9._-]{0,99}(\?h=[a-f0-9]{8,64})?$/;

export const backendBaseUrl = (): string => (process.env.NEXT_PUBLIC_BACKEND_URL || 'https://backend.bloomx.arubik.dev').replace(/\/+$/, '');

export type IconImage = { kind: 'data'; src: string; mime: 'image/png' | 'image/webp' | 'image/svg+xml'; svg: string | null } | { kind: 'remote'; src: string };

function decodeBase64(b64: string): string | null {
    try {
        if (typeof atob === 'function') return atob(b64);
        return Buffer.from(b64, 'base64').toString('binary');
    } catch {
        return null;
    }
}

/** Defensa en profundidad (un <img> ya es inerte): el SVG no puede contener nada activo ni referencias externas. */
export function svgLooksSafe(svg: string): boolean {
    if (!/^\s*(<\?xml[^>]*\?>\s*)?<svg[\s>]/i.test(svg)) return false;
    return !/<\s*(script|foreignObject|iframe|object|embed|image|use|a|style|animate|set)\b|\son[a-z]+\s*=|javascript:|data:text|<!ENTITY|<!DOCTYPE|<!--|xlink:href|href\s*=|&|url\(\s*['"]?(?!#)/i.test(svg);
}

/** Valida un data URL de icono. null = invalido (el llamante cae al placeholder/iniciales). */
export function parseIconDataUrl(value: unknown): Extract<IconImage, { kind: 'data' }> | null {
    if (typeof value !== 'string' || value.length > MAX_DATA_URL_CHARS) return null;
    const m = DATA_URL_RE.exec(value.trim());
    if (!m) return null;
    const bin = decodeBase64(m[2]);
    if (bin === null || bin.length === 0 || bin.length > MAX_ICON_BYTES) return null;
    const mime = (`image/${m[1]}`) as 'image/png' | 'image/webp' | 'image/svg+xml';
    if (mime === 'image/png' && bin.slice(0, 8) !== '\x89PNG\r\n\x1a\n') return null;
    if (mime === 'image/webp' && !(bin.slice(0, 4) === 'RIFF' && bin.slice(8, 12) === 'WEBP')) return null;
    let svg: string | null = null;
    if (mime === 'image/svg+xml') {
        try { svg = decodeURIComponent(escape(bin)); } catch { return null; }
        if (!svgLooksSafe(svg)) return null;
    }
    return { kind: 'data', src: value.trim(), mime, svg };
}

/** URL absoluta de un icono del backend a partir de la ruta relativa del catalogo (o de una URL https del propio backend). */
export function resolveBackendIconUrl(iconUrl: unknown, base: string = backendBaseUrl()): string | null {
    if (typeof iconUrl !== 'string') return null;
    if (ICON_PATH_RE.test(iconUrl)) return `${base}${iconUrl}`;
    if (iconUrl.startsWith(`${base}/api/extensions/icons/`) && ICON_PATH_RE.test(iconUrl.slice(base.length))) return iconUrl;
    return null;
}

export function brandIconUrl(slug: string, base: string = backendBaseUrl()): string | null {
    return BRAND_SLUG_RE.test(slug) ? `${base}/api/extensions/icons/brand.${slug}` : null;
}

/** Sustituye `currentColor` de un SVG (data URL) por el color de texto del tema activo y lo devuelve como data URL. */
export function recolorCurrentColor(image: Extract<IconImage, { kind: 'data' }>, color: string): string {
    if (!image.svg || !/currentColor/i.test(image.svg) || !/^#[0-9a-f]{6}$/i.test(color)) return image.src;
    const svg = image.svg.replace(/currentColor/gi, color);
    return `data:image/svg+xml;base64,${typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(svg))) : Buffer.from(svg, 'utf8').toString('base64')}`;
}
