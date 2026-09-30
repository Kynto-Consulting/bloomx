/**
 * Referencias de icono de una extension (PURO, sin React):
 *
 *   brand:<slug>     logotipo de una app integrada (registro brand-icons.ts)
 *   lucide:<Nombre>  icono funcional de Lucide
 *   initials:<XY>    ficha con 1 a 3 letras
 *   <Nombre>         (compatibilidad) nombre Lucide sin esquema, como siempre
 *
 * Nunca hay URLs de imagen: los iconos son datos del registro, asi que la CSP no cambia y no se contacta a terceros.
 */
import { BRAND_ICONS, NEUTRAL_BRANDS, type BrandIcon, type NeutralBrand } from './brand-icons';
import { isIconRef } from './ui-schema';
import { contrast, ensureContrast, mix, normalizeHex } from '@/lib/color';

export type IconRef =
    | { kind: 'brand'; icon: BrandIcon }
    | { kind: 'neutral'; brand: NeutralBrand }
    | { kind: 'lucide'; name: string }
    | { kind: 'initials'; text: string };

/** Nombres antiguos (sin esquema) de apps que ya no son un icono generico de Lucide. */
export const LEGACY_BRAND_ALIASES: Readonly<Record<string, string>> = {
    GoogleDrive: 'googledrive', Drive: 'googledrive', HubSpot: 'hubspot', Notion: 'notion', Zoom: 'zoom', Trello: 'trello',
};

const LEGACY_NAME_RE = /^[A-Za-z][A-Za-z0-9]{0,39}$/;

/** Iniciales para una ficha: hasta 2 letras/digitos en mayusculas. */
export function initialsOf(text: string): string {
    const chars = Array.from(text.trim().split(/[\s\-_/]+/).filter(Boolean).map((w) => Array.from(w)[0]).join('')).filter((c) => /\p{L}|\p{N}/u.test(c));
    return chars.slice(0, 2).join('').toUpperCase();
}

/**
 * Resuelve el `icon` de un manifest. Devuelve null si el valor no es una referencia (p. ej. un emoji o vacio): el llamante decide
 * el respaldo. Un `brand:<slug>` desconocido NO falla: se pinta como ficha con la inicial del slug.
 */
export function resolveIconRef(value: unknown): IconRef | null {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    if (v.startsWith('brand:') || v.startsWith('lucide:') || v.startsWith('initials:')) {
        if (!isIconRef(v)) return null;
        const arg = v.slice(v.indexOf(':') + 1);
        if (v.startsWith('brand:')) {
            const icon = Object.prototype.hasOwnProperty.call(BRAND_ICONS, arg) ? BRAND_ICONS[arg] : undefined;
            if (icon) return { kind: 'brand', icon };
            const neutral = Object.prototype.hasOwnProperty.call(NEUTRAL_BRANDS, arg) ? NEUTRAL_BRANDS[arg] : undefined;
            if (neutral) return { kind: 'neutral', brand: neutral };
            return { kind: 'initials', text: initialsOf(arg.slice(0, 1)) || '?' };
        }
        if (v.startsWith('lucide:')) return { kind: 'lucide', name: arg };
        return { kind: 'initials', text: arg.toUpperCase() };
    }
    if (LEGACY_NAME_RE.test(v)) {
        const alias = Object.prototype.hasOwnProperty.call(LEGACY_BRAND_ALIASES, v) ? LEGACY_BRAND_ALIASES[v] : undefined;
        if (alias && BRAND_ICONS[alias]) return { kind: 'brand', icon: BRAND_ICONS[alias] };
        return { kind: 'lucide', name: v };
    }
    return null;
}

// ------------------------------------------------------------------ contraste
/** Contraste minimo (WCAG 1.4.11, componentes graficos) del glifo de marca contra la superficie donde se pinta. */
export const BRAND_MIN_CONTRAST = 3;

/**
 * Tokens de superficie sobre los que puede caer un glifo de marca: fondo de la pagina, tarjeta/ficha (donde se dibuja), atenuado y
 * hover de las barras. El glifo cumple el minimo contra TODOS a la vez.
 */
export const BRAND_SURFACE_TOKENS = ['background', 'card', 'muted', 'accent'] as const;

/**
 * Color con el que se pinta un logotipo de marca: el OFICIAL si contrasta >= 3:1 con todas las superficies; si no, una variante
 * mas clara/oscura del mismo tono calculada con `ensureContrast` (color.ts); y, si ninguna variante sirve (superficies opuestas),
 * blanco o negro segun cual contraste mas. Las superficies invalidas se ignoran; sin ellas se devuelve el color oficial.
 */
export function brandGlyphColor(officialHex: string, surfaces: readonly string[], min = BRAND_MIN_CONTRAST): string {
    const official = normalizeHex(officialHex);
    if (!official) return '#000000';
    const bgs = surfaces.map((s) => normalizeHex(s)).filter((s): s is string => s !== null);
    if (bgs.length === 0) return official;
    const worst = (c: string) => Math.min(...bgs.map((bg) => contrast(c, bg)));
    if (worst(official) >= min) return official;
    const adjusted = ensureContrast(official, bgs, min);
    if (worst(adjusted) >= min) return adjusted;
    // Superficies muy dispares: nada de la familia del tono llega; se elige el extremo con mayor contraste minimo.
    const candidates = ['#ffffff', '#000000', mix(official, '#ffffff', 0.85), mix(official, '#000000', 0.85)];
    return candidates.reduce((best, c) => (worst(c) > worst(best) ? c : best), candidates[0]);
}
