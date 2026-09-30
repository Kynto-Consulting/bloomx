/**
 * Utilidades de color puras (sin dependencias de DOM) usadas por:
 *  - el generador de CSS de temas (servidor y cliente)
 *  - el script de verificacion de contraste (scripts/check-theme-contrast.ts)
 *  - SafeIframe (inversion del fondo para correos en modo oscuro)
 *
 * Solo se aceptan colores hexadecimales (#rgb, #rrggbb). Cualquier otro valor
 * se descarta: esto tambien evita inyeccion de CSS cuando los colores vienen
 * de la configuracion del dominio y se emiten dentro de un <style>.
 */

export type RGB = { r: number; g: number; b: number };

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: unknown): value is string {
    return typeof value === 'string' && HEX_RE.test(value.trim());
}

/** Devuelve #rrggbb en minusculas o null si el valor no es un hex valido. */
export function normalizeHex(value: unknown): string | null {
    if (!isHexColor(value)) return null;
    let hex = value.trim().slice(1).toLowerCase();
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    return `#${hex}`;
}

export function hexToRgb(hex: string): RGB {
    const n = normalizeHex(hex);
    if (!n) throw new Error(`Color invalido: ${hex}`);
    return {
        r: parseInt(n.slice(1, 3), 16),
        g: parseInt(n.slice(3, 5), 16),
        b: parseInt(n.slice(5, 7), 16),
    };
}

const toHex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');

export function rgbToHex({ r, g, b }: RGB): string {
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Luminancia relativa WCAG 2.x. */
export function luminance(hex: string): number {
    const { r, g, b } = hexToRgb(hex);
    const lin = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Ratio de contraste WCAG (1 a 21). */
export function contrast(a: string, b: string): number {
    const la = luminance(a);
    const lb = luminance(b);
    const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
}

/** Mezcla `a` con `b`; t=0 -> a, t=1 -> b. */
export function mix(a: string, b: string, t: number): string {
    const ca = hexToRgb(a);
    const cb = hexToRgb(b);
    return rgbToHex({
        r: ca.r + (cb.r - ca.r) * t,
        g: ca.g + (cb.g - ca.g) * t,
        b: ca.b + (cb.b - ca.b) * t,
    });
}

/** Invierte el color (255 - canal). Aproxima el fondo tras `filter: invert(1)`. */
export function invert(hex: string): string {
    const { r, g, b } = hexToRgb(hex);
    return rgbToHex({ r: 255 - r, g: 255 - g, b: 255 - b });
}

/** Elige #ffffff o #000000 (con matiz muy sutil) segun cual contraste mas con `bg`. */
export function readableOn(bg: string): string {
    const white = '#ffffff';
    const black = '#0a0a0a';
    return contrast(bg, white) >= contrast(bg, black) ? white : black;
}

/**
 * Ajusta `color` (mezclandolo hacia blanco o negro) hasta alcanzar `minRatio`
 * contra TODOS los fondos indicados. Conserva el tono de marca lo mas posible:
 * primero prueba en la direccion natural (oscurecer sobre fondos claros,
 * aclarar sobre fondos oscuros) y, si no llega, en la opuesta.
 */
export function ensureContrast(color: string, backgrounds: string[], minRatio: number): string {
    const passes = (c: string) => backgrounds.every((bg) => contrast(c, bg) >= minRatio);
    if (passes(color)) return color;

    const avgLum = backgrounds.reduce((s, bg) => s + luminance(bg), 0) / backgrounds.length;
    const directions = avgLum > 0.4 ? ['#000000', '#ffffff'] : ['#ffffff', '#000000'];

    for (const target of directions) {
        for (let i = 1; i <= 20; i++) {
            const candidate = mix(color, target, i / 20);
            if (passes(candidate)) return candidate;
        }
    }
    return avgLum > 0.4 ? '#000000' : '#ffffff';
}
