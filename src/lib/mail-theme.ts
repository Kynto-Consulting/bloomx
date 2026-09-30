/**
 * Paleta del documento aislado (iframe) donde se muestra el HTML de un correo, derivada de los
 * tokens del tema activo (fondo, texto, enlace, aviso). Solo se emiten colores calculados aqui
 * (hex validados), nunca datos del correo, asi que es seguro concatenarlos en el <style> del iframe.
 *
 * Modos (opciones existentes del usuario):
 *  - 'paper':  papel claro. Tema claro -> papel = fondo del tema. Tema oscuro -> papel casi blanco
 *              con el matiz del fondo del tema (los correos HTML suelen estar pensados sobre blanco).
 *  - 'invert': solo en temas oscuros; el iframe aplica invert+hue-rotate, asi que todos los colores
 *              se emiten PRE-invertidos para que tras el filtro coincidan con los del tema.
 */
import { contrast, ensureContrast, hexToRgb, mix, normalizeHex, readableOnAA, rgbToHex } from '@/lib/color';

export interface MailThemeTokens {
    background: string;
    foreground: string;
    link: string;
    warning: string;
    /** Opcional (--link-hover); si falta se deriva del enlace. */
    linkHover?: string;
}

export interface MailPalette {
    paper: string;
    text: string;
    link: string;
    linkHover: string;
    /** Texto atenuado (citas de nivel 2+, atribuciones, firmas). */
    muted: string;
    /** Separadores sutiles (hr, firmas, tablas). */
    border: string;
    /** Fondo de <code>/<pre>. */
    codeBg: string;
    /** Fondo/texto de chips (boton de citas). */
    chip: string;
    chipText: string;
    chipBorder: string;
    /** Borde de citas (blockquote). */
    quote: string;
    warnBg: string;
    warnText: string;
    warnBorder: string;
}

/** Respaldo = tema `light` de la app (solo si el DOM no expone los tokens). */
export const MAIL_FALLBACK_LIGHT: MailThemeTokens = { background: '#ffffff', foreground: '#0f172a', link: '#1d4ed8', warning: '#b45309' };
export const MAIL_FALLBACK_DARK: MailThemeTokens = { background: '#0f1115', foreground: '#e6e8ec', link: '#8ab4ff', warning: '#fbbf24' };

function pick(value: unknown, fallback: string): string {
    return normalizeHex(typeof value === 'string' ? value : '') ?? fallback;
}

/** Lee los tokens del tema activo desde un elemento (normalmente <html>). */
export function readMailTokens(el: Element | null | undefined, scheme: 'light' | 'dark'): MailThemeTokens {
    const fb = scheme === 'dark' ? MAIL_FALLBACK_DARK : MAIL_FALLBACK_LIGHT;
    if (!el || typeof getComputedStyle !== 'function') return fb;
    try {
        const cs = getComputedStyle(el);
        const get = (n: string) => cs.getPropertyValue(`--color-${n}`).trim();
        return {
            background: pick(get('background'), fb.background),
            foreground: pick(get('foreground'), fb.foreground),
            link: pick(get('link'), pick(get('primary'), fb.link)),
            warning: pick(get('warning'), fb.warning),
            linkHover: normalizeHex(get('link-hover')) ?? undefined,
        };
    } catch {
        return fb;
    }
}

/** Texto principal: >= 7:1 si el fondo lo permite; en fondos de tono medio, el mejor negro/blanco (>= 4.5). */
function bodyText(preferred: string, paper: string): string {
    const c = ensureContrast(preferred, [paper], 7);
    return contrast(c, paper) >= 7 ? c : readableOnAA(paper);
}

function build(paper: string, text: string, link: string, warning: string, linkHover?: string): MailPalette {
    const chip = mix(paper, text, 0.1);
    const warnBg = mix(paper, warning, 0.16);
    const safeLink = ensureContrast(link, [paper], 4.5);
    return {
        paper,
        text,
        link: safeLink,
        linkHover: ensureContrast(linkHover ?? mix(safeLink, text, 0.35), [paper], 4.5),
        muted: ensureContrast(mix(paper, text, 0.62), [paper], 4.5),
        border: mix(paper, text, 0.16),
        codeBg: mix(paper, text, 0.07),
        chip,
        chipText: ensureContrast(mix(paper, text, 0.7), [chip], 4.5),
        chipBorder: mix(paper, text, 0.28),
        quote: mix(paper, text, 0.4),
        warnBg,
        warnText: ensureContrast(warning, [warnBg], 4.5),
        warnBorder: mix(paper, warning, 0.65),
    };
}

/** Papel del correo en modo `paper`. */
export function deriveMailPaper(t: MailThemeTokens, scheme: 'light' | 'dark'): MailPalette {
    if (scheme === 'light') {
        return build(t.background, bodyText(t.foreground, t.background), t.link, t.warning, t.linkHover);
    }
    // Hoja clara con el matiz del fondo del tema (no un gris plano): casi blanca, tintada por el tema.
    const paper = mix(t.background, '#ffffff', 0.965);
    const text = bodyText(mix(t.background, '#000000', 0.35), paper);
    return build(paper, text, t.link, t.warning, t.linkHover);
}

/** Paleta del tema oscuro tal cual (se pre-invierte al emitir en modo `invert`). */
export function deriveMailDark(t: MailThemeTokens): MailPalette {
    return build(t.background, bodyText(t.foreground, t.background), t.link, t.warning, t.linkHover);
}

/** Matriz de `hue-rotate(180deg)` (CSS Filter Effects). Es una involucion: H(H(x)) = x. */
const HUE_180 = [[-0.574, 1.43, 0.144], [0.426, 0.43, 0.144], [0.426, 1.43, -0.856]];
const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
function hue180(hex: string): string {
    const { r, g, b } = hexToRgb(hex);
    const [nr, ng, nb] = HUE_180.map((row) => clamp255(row[0] * r + row[1] * g + row[2] * b));
    return rgbToHex({ r: nr, g: ng, b: nb });
}
/** Lo que el navegador pinta tras `filter: invert(1) hue-rotate(180deg)` sobre un color (para tests). */
export function afterInvertFilter(hex: string): string {
    const { r, g, b } = hexToRgb(hex);
    return hue180(rgbToHex({ r: 255 - r, g: 255 - g, b: 255 - b }));
}
/**
 * Color a EMITIR para que, tras `filter: invert(1) hue-rotate(180deg)`, se vea `hex`: f(p) = H(1 - p) = c  =>  p = 1 - H(c).
 * Invertir solo (255 - c) desplazaba el matiz 180 grados (un fondo azul marino salia amarillento).
 */
export function preInvert(hex: string): string {
    const { r, g, b } = hexToRgb(hue180(hex));
    return rgbToHex({ r: 255 - r, g: 255 - g, b: 255 - b });
}

const KEYS: Array<[keyof MailPalette, string]> = [
    ['paper', '--bx-paper'], ['text', '--bx-text'], ['link', '--bx-link'], ['linkHover', '--bx-link-hover'],
    ['muted', '--bx-muted'], ['border', '--bx-border'], ['codeBg', '--bx-code'], ['chip', '--bx-chip'],
    ['chipText', '--bx-chip-text'], ['chipBorder', '--bx-chip-border'], ['quote', '--bx-quote'],
    ['warnBg', '--bx-warn-bg'], ['warnText', '--bx-warn-text'], ['warnBorder', '--bx-warn-border'],
];

/**
 * Estilo base tipografico del correo (pila del sistema, sin fuentes web por la CSP). Selectores de elemento de baja
 * especificidad: los estilos propios del correo (inline o <style>) los superan; solo las citas se normalizan con
 * !important para que tengan jerarquia coherente con el tema (el inline de Gmail las pinta con un gris fijo).
 */
export const MAIL_TYPOGRAPHY_CSS = `
body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 15px; line-height: 1.6; color: var(--bx-text); -webkit-text-size-adjust: 100%; overflow-wrap: break-word; }
p { margin: 0 0 .85em; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; font-weight: 650; margin: 1.2em 0 .5em; }
h1 { font-size: 1.6em; } h2 { font-size: 1.35em; } h3 { font-size: 1.15em; } h4 { font-size: 1em; } h5 { font-size: .92em; } h6 { font-size: .85em; color: var(--bx-muted); }
#content > :first-child { margin-top: 0; }
ul, ol { margin: 0 0 .85em; padding-left: 1.6em; }
li { margin: .2em 0; }
a { color: var(--bx-link); text-decoration: none; overflow-wrap: anywhere; }
a:hover, a:focus-visible { color: var(--bx-link-hover); text-decoration: underline; }
a:focus-visible { outline: 2px solid var(--bx-link); outline-offset: 2px; border-radius: 2px; }
blockquote { margin: .6em 0 !important; padding: .1em 0 .1em 1em !important; border: 0 !important; border-left: 3px solid var(--bx-quote) !important; max-width: 100%; }
blockquote blockquote { color: var(--bx-muted); }
blockquote blockquote blockquote { padding-left: .7em !important; border-left-width: 2px !important; }
blockquote blockquote blockquote blockquote { margin-left: 0 !important; padding-left: 0 !important; border-left: 0 !important; }
.gmail_attr, .moz-cite-prefix, .OutlookMessageHeader, #divRplyFwdMsg { font-size: .85em; color: var(--bx-muted); margin: .4em 0; }
.gmail_signature_prefix { display: none; }
.gmail_signature { margin-top: 1.2em; padding-top: .8em; border-top: 1px solid var(--bx-border); color: var(--bx-muted); }
pre, code, kbd, samp { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; font-size: .9em; background: var(--bx-code); border-radius: 4px; }
code, kbd, samp { padding: .1em .35em; }
pre { padding: .75em 1em; margin: 0 0 .85em; overflow-x: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
pre code { padding: 0; background: none; }
#content > pre:only-child { font-family: inherit; font-size: inherit; background: none; padding: 0; margin: 0; }
img { max-width: 100%; height: auto; border-radius: 4px; }
hr { border: 0; border-top: 1px solid var(--bx-border); margin: 1.2em 0; }
table { max-width: 100%; }
th, td { overflow-wrap: break-word; }
`;

/** CSS del tema del correo: variables `--bx-*`, estilo base y reglas de fondo/filtro. `sheet` = hoja con margen interior (tema oscuro + papel). */
export function buildMailThemeCss(t: MailThemeTokens, scheme: 'light' | 'dark', invertMode: boolean): string {
    if (invertMode && scheme === 'dark') {
        const p = deriveMailDark(t);
        const vars = KEYS.map(([k, v]) => `${v}: ${preInvert(p[k])};`).join(' ');
        return `
:root { ${vars} }
html { background: ${preInvert(p.paper)}; filter: invert(1) hue-rotate(180deg); }
img, video, picture, canvas, svg image, [style*="background-image"] { filter: invert(1) hue-rotate(180deg); }
${MAIL_TYPOGRAPHY_CSS}`;
    }
    const p = deriveMailPaper(t, scheme);
    const vars = KEYS.map(([k, v]) => `${v}: ${p[k]};`).join(' ');
    return `
:root { ${vars} }
html { background: var(--bx-paper); color-scheme: light; }
${scheme === 'dark' ? '#content { padding: 16px 18px; }' : ''}
${MAIL_TYPOGRAPHY_CSS}`;
}

/** Contraste texto/papel resultante (para tests). */
export function mailTextContrast(t: MailThemeTokens, scheme: 'light' | 'dark'): number {
    const p = deriveMailPaper(t, scheme);
    return contrast(p.text, p.paper);
}
