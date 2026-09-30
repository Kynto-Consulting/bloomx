/**
 * Nucleo de i18n (puro: sin React, sin next/headers) para poder testearlo con vitest
 * y usarlo tanto en servidor como en cliente.
 *
 *  - Idiomas soportados: es, en. Idioma por defecto: es.
 *  - Resolucion del idioma: cookie (preferencia del usuario) -> Accept-Language -> defecto.
 *  - Traduccion: `t('seccion.clave', { param })`. Si falta la clave en el idioma
 *    activo se usa el idioma por defecto, luego ingles y, en ultimo caso, la propia
 *    clave (nunca lanza ni devuelve vacio, asi una cadena olvidada se ve y se reporta).
 */

export const LOCALES = ['es', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'es';

/** Cookie legible por el servidor para pintar <html lang> ya en el primer HTML. */
export const LOCALE_COOKIE = 'bloomx-lang';
export const LOCALE_STORAGE_KEY = 'bloomx:lang:v1';

export const LOCALE_LABELS: Record<Locale, string> = {
    es: 'Español',
    en: 'English',
};

export function isLocale(value: unknown): value is Locale {
    return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Diccionario anidado de cadenas. */
export interface NestedMessages {
    [key: string]: string | NestedMessages;
}

export type FlatMessages = Record<string, string>;

/** { a: { b: 'x' } } -> { 'a.b': 'x' } */
export function flattenMessages(dict: NestedMessages, prefix = '', out: FlatMessages = {}): FlatMessages {
    for (const [k, v] of Object.entries(dict)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (typeof v === 'string') out[key] = v;
        else if (v && typeof v === 'object') flattenMessages(v, key, out);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Negociacion de idioma
// ---------------------------------------------------------------------------

export interface LanguageRange {
    tag: string;
    q: number;
}

/** Parsea un header Accept-Language ("es-PE,es;q=0.9,en;q=0.8") ordenado por q descendente. */
export function parseAcceptLanguage(header: string | null | undefined): LanguageRange[] {
    if (!header || typeof header !== 'string') return [];
    const ranges: LanguageRange[] = [];
    header.split(',').forEach((part, index) => {
        const [rawTag, ...params] = part.trim().split(';');
        const tag = rawTag.trim().toLowerCase();
        if (!tag || tag === '*') return;
        let q = 1;
        for (const p of params) {
            const m = p.trim().match(/^q=([0-9.]+)$/i);
            if (m) q = Number(m[1]);
        }
        if (!Number.isFinite(q) || q <= 0 || q > 1) return;
        // El indice desempata de forma estable respetando el orden del header.
        ranges.push({ tag, q: q - index * 1e-6 });
    });
    return ranges.sort((a, b) => b.q - a.q);
}

/** Primer idioma soportado que pide el navegador, o null si ninguno coincide. */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale | null {
    for (const { tag } of parseAcceptLanguage(acceptLanguage)) {
        const base = tag.split('-')[0];
        if (isLocale(base)) return base;
    }
    return null;
}

/** cookie -> Accept-Language -> defecto. */
export function resolveLocale(opts: { cookie?: string | null; acceptLanguage?: string | null }): Locale {
    if (isLocale(opts.cookie)) return opts.cookie;
    return negotiateLocale(opts.acceptLanguage) ?? DEFAULT_LOCALE;
}

// ---------------------------------------------------------------------------
// Traduccion
// ---------------------------------------------------------------------------

export type TranslateParams = Record<string, string | number>;

/** Reemplaza {param}; los parametros ausentes se dejan tal cual para que se note. */
export function interpolate(template: string, params?: TranslateParams): string {
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
    );
}

export type Dictionaries = Partial<Record<Locale, NestedMessages>>;

export interface Translator {
    locale: Locale;
    t: (key: string, params?: TranslateParams) => string;
    /** true si la clave existe en el idioma activo (sin considerar el respaldo). */
    has: (key: string) => boolean;
}

/** Orden de busqueda: idioma activo -> idioma por defecto -> ingles. */
export function fallbackChain(locale: Locale): Locale[] {
    const chain: Locale[] = [locale];
    for (const l of [DEFAULT_LOCALE, 'en'] as Locale[]) if (!chain.includes(l)) chain.push(l);
    return chain;
}

export function createTranslator(locale: Locale, dictionaries: Dictionaries): Translator {
    const flat: Partial<Record<Locale, FlatMessages>> = {};
    const flatOf = (l: Locale): FlatMessages => {
        if (!flat[l]) flat[l] = dictionaries[l] ? flattenMessages(dictionaries[l]!) : {};
        return flat[l]!;
    };
    const chain = fallbackChain(locale);
    return {
        locale,
        has: (key) => Object.prototype.hasOwnProperty.call(flatOf(locale), key),
        t: (key, params) => {
            for (const l of chain) {
                const hit = flatOf(l)[key];
                if (typeof hit === 'string') return interpolate(hit, params);
            }
            return key;
        },
    };
}
