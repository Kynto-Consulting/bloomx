/**
 * Limpieza de colores al pegar HTML en el editor.
 *
 * Problema: texto copiado de una web/Word con `color:#000` (o blanco) queda ilegible sobre el
 * fondo del tema (oscuro/claro). Se eliminan los colores de texto y de fondo casi negros o casi
 * blancos (los que dependen del fondo original); los colores intermedios/de marca se conservan.
 * El correo enviado hereda entonces el color por defecto del cliente del destinatario.
 *
 * Puro y basado en regex sobre atributos style/color/bgcolor para poder probarse en Node.
 */

type RGB = { r: number; g: number; b: number };

const NAMED: Record<string, RGB> = {
    black: { r: 0, g: 0, b: 0 },
    white: { r: 255, g: 255, b: 255 },
    windowtext: { r: 0, g: 0, b: 0 },
    canvastext: { r: 0, g: 0, b: 0 },
    window: { r: 255, g: 255, b: 255 },
    canvas: { r: 255, g: 255, b: 255 },
    whitesmoke: { r: 245, g: 245, b: 245 },
    snow: { r: 255, g: 250, b: 250 },
    ivory: { r: 255, g: 255, b: 240 },
    darkslategray: { r: 47, g: 79, b: 79 },
};

export function parseCssColor(input: string): RGB | null {
    const v = String(input || '').trim().toLowerCase().replace(/\s*!important$/, '');
    if (!v) return null;
    if (NAMED[v]) return NAMED[v];

    let m = v.match(/^#([0-9a-f]{3,8})$/);
    if (m) {
        let h = m[1];
        if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
        if (h.length !== 6 && h.length !== 8) return null;
        if (h.length === 8 && parseInt(h.slice(6), 16) < 128) return null; // muy transparente: no cuenta
        return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
    }

    m = v.match(/^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/);
    if (m) {
        const alpha = m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
        if (alpha < 0.5) return null;
        const c = (s: string) => Math.max(0, Math.min(255, Math.round(parseFloat(s))));
        return { r: c(m[1]), g: c(m[2]), b: c(m[3]) };
    }
    return null;
}

/** Luminancia relativa WCAG (0 negro, 1 blanco). */
export function relativeLuminance({ r, g, b }: RGB): number {
    const lin = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Colores que dependen del fondo original: casi negros o casi blancos (desaturados incluidos). */
export function isBackgroundDependentColor(value: string): boolean {
    const rgb = parseCssColor(value);
    if (!rgb) return false;
    // Solo tonos casi grises: un azul marino o un amarillo de marca no dependen del fondo de la misma forma.
    const chroma = Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b);
    if (chroma > 48) return false;
    const lum = relativeLuminance(rgb);
    return lum < 0.06 || lum > 0.8;
}

const TEXT_PROPS = new Set(['color']);
const BG_PROPS = new Set(['background-color', 'background']);

function cleanStyle(style: string): string {
    const kept: string[] = [];
    for (const decl of style.split(';')) {
        const idx = decl.indexOf(':');
        if (idx === -1) { if (decl.trim()) kept.push(decl.trim()); continue; }
        const prop = decl.slice(0, idx).trim().toLowerCase();
        const value = decl.slice(idx + 1).trim();
        if ((TEXT_PROPS.has(prop) || BG_PROPS.has(prop)) && isBackgroundDependentColor(value)) continue;
        // "background" con imagen/gradiente no se toca; solo se evalua si es un color simple (ya cubierto arriba).
        kept.push(`${prop}: ${value}`);
    }
    return kept.join('; ');
}

export function sanitizePastedColors(html: string): string {
    return String(html || '')
        // style="..." / style='...'
        .replace(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi, (_whole, _q, dq, sq) => {
            const cleaned = cleanStyle(dq ?? sq ?? '');
            return cleaned ? ` style="${cleaned.replace(/"/g, '&quot;')}"` : '';
        })
        // <font color="#000"> / bgcolor="#fff"
        .replace(/\s(color|bgcolor)\s*=\s*("([^"]*)"|'([^']*)')/gi, (whole, _attr, _q, dq, sq) =>
            isBackgroundDependentColor(dq ?? sq ?? '') ? '' : whole);
}
