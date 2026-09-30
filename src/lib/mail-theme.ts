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
import { contrast, ensureContrast, invert, mix, normalizeHex, readableOnAA } from '@/lib/color';

export interface MailThemeTokens {
    background: string;
    foreground: string;
    link: string;
    warning: string;
}

export interface MailPalette {
    paper: string;
    text: string;
    link: string;
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

function build(paper: string, text: string, link: string, warning: string): MailPalette {
    const chip = mix(paper, text, 0.1);
    const warnBg = mix(paper, warning, 0.16);
    return {
        paper,
        text,
        link: ensureContrast(link, [paper], 4.5),
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
        return build(t.background, bodyText(t.foreground, t.background), t.link, t.warning);
    }
    const paper = mix(t.background, '#ffffff', 0.94);
    const text = bodyText(mix(t.background, '#000000', 0.35), paper);
    return build(paper, text, t.link, t.warning);
}

/** Paleta del tema oscuro tal cual (se pre-invierte al emitir en modo `invert`). */
export function deriveMailDark(t: MailThemeTokens): MailPalette {
    return build(t.background, bodyText(t.foreground, t.background), t.link, t.warning);
}

const KEYS: Array<[keyof MailPalette, string]> = [
    ['paper', '--bx-paper'], ['text', '--bx-text'], ['link', '--bx-link'], ['chip', '--bx-chip'],
    ['chipText', '--bx-chip-text'], ['chipBorder', '--bx-chip-border'], ['quote', '--bx-quote'],
    ['warnBg', '--bx-warn-bg'], ['warnText', '--bx-warn-text'], ['warnBorder', '--bx-warn-border'],
];

/** CSS del tema del correo: variables `--bx-*` y reglas de fondo/filtro. */
export function buildMailThemeCss(t: MailThemeTokens, scheme: 'light' | 'dark', invertMode: boolean): string {
    if (invertMode && scheme === 'dark') {
        const p = deriveMailDark(t);
        const vars = KEYS.map(([k, v]) => `${v}: ${invert(p[k])};`).join(' ');
        return `
:root { ${vars} }
html { background: ${invert(p.paper)}; filter: invert(1) hue-rotate(180deg); }
img, video, picture, canvas, svg image, [style*="background-image"] { filter: invert(1) hue-rotate(180deg); }
.gmail_quote_toggle { filter: none; }`;
    }
    const p = deriveMailPaper(t, scheme);
    const vars = KEYS.map(([k, v]) => `${v}: ${p[k]};`).join(' ');
    return `
:root { ${vars} }
html { background: var(--bx-paper); color-scheme: light; }`;
}

/** Contraste texto/papel resultante (para tests). */
export function mailTextContrast(t: MailThemeTokens, scheme: 'light' | 'dark'): number {
    const p = deriveMailPaper(t, scheme);
    return contrast(p.text, p.paper);
}
