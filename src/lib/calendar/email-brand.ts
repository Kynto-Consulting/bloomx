/**
 * MARCA DE LA EMPRESA PARA LOS CORREOS DE REUNIONES / EVENTOS / CITAS.
 *
 * Convierte la configuracion del dominio activo (nombre, tema, landing) en la `brand` que consume la plantilla unica
 * (`invite-template.js`): nombre visible, color de marca (tono exacto) con su texto legible, logo claro https, enlace y pie.
 *
 * Puro y sin red: sirve en servidor y en cliente. La carga de la config del dominio (con la misma cache de Next que el
 * layout) vive en `email-brand-server.ts`. Sin configuracion -> comportamiento historico (Bloom / azul).
 *
 * Seguridad: todo lo que sale de aqui ya esta saneado (hex validado, URL https, texto plano sin < > ni control) y la
 * plantilla lo vuelve a sanear; el HTML nunca recibe datos de marca sin escapar.
 */
import { buildBrandThemes } from '@/lib/brand-theme';
import { contrast, normalizeHex } from '@/lib/color';
import { resolveInviteBrand } from './invite-template.js';
import { sanitizeLandingConfig, type LandingConfig } from '@/lib/landing-config';
import { sanitizeThemeConfig } from '@/lib/theme-config';
import { negotiateLocale, isLocale, type Locale } from '@/lib/i18n/core';

export type EmailLocale = 'es' | 'en';

export interface EmailBrand {
    /** Nombre visible (texto plano, <= 60). */
    name: string;
    /** TONO EXACTO de la marca (#rrggbb) para superficies decorativas: banda de cabecera, boton solido, franja, borde. */
    color: string;
    /** Texto/iconos sobre `color`: blanco o casi negro, el que de >= 4.5:1. */
    onColor: string;
    /** La marca corregida a AA (>= 4.5:1) sobre blanco: SOLO para usarla como color de texto o de enlace sobre fondo blanco. */
    linkColor: string;
    /** Logo para fondo claro (https) o null: entonces la cabecera lleva el nombre como texto. */
    logoUrl: string | null;
    /** Sitio de la empresa (https) o null. */
    url: string | null;
    /** Pie de correo (texto plano) o null. */
    footer: string | null;
    /** Idioma forzado por la empresa (landing.locale) o null. */
    locale: EmailLocale | null;
}

/** Lo minimo que hace falta del dominio (forma de `config` en /api/config). */
export interface EmailDomainContext {
    name?: string | null;
    displayName?: string | null;
    logo?: string | null;
    theme?: unknown;
}

export const FALLBACK_BRAND_COLOR = '#2563eb';
const MAX_NAME = 60;
const MAX_FOOTER = 160;

const envName = () => process.env.NEXT_PUBLIC_BRAND_NAME || 'Bloom';
const envColor = () => normalizeHex(process.env.NEXT_PUBLIC_BRAND_COLOR) || FALLBACK_BRAND_COLOR;

/** Texto plano de una linea: sin control, sin < >, colapsado y acotado. */
export function cleanBrandText(value: unknown, max: number): string {
    if (typeof value !== 'string') return '';
    return value
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, ' ')
        .replace(/[<>]/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, max);
}

/** https sin credenciales ni puerto raro (las imagenes y enlaces de marca nunca viajan por http). */
export function httpsOnly(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text || text.length > 2048 || /[^!-~]/.test(text) || /["'<>\\`]/.test(text)) return null;
    let url: URL;
    try { url = new URL(text); } catch { return null; }
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (url.port && url.port !== '443') return null;
    if (!url.hostname.includes('.')) return null;
    return url.toString();
}

function hostToSite(name: unknown): string | null {
    const host = typeof name === 'string' ? name.trim().toLowerCase() : '';
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host) || host.endsWith('.local') || host.endsWith('.test')) return null;
    return `https://${host}`;
}

/** Color de marca de la configuracion: paleta clara > campos antiguos > entorno > azul. Siempre #rrggbb (aun sin AA). */
function pickPrimary(theme: ReturnType<typeof sanitizeThemeConfig>): string {
    const fromPalette = normalizeHex(theme.palette?.light?.primary);
    if (fromPalette) return fromPalette;
    try {
        const built = buildBrandThemes(theme);
        const token = normalizeHex(built?.light.tokens.primary);
        if (token) return token;
    } catch { /* tema atipico: cae a los campos antiguos */ }
    return normalizeHex(theme.primaryColor) || envColor();
}

/** Marca por defecto (sin configuracion de dominio). */
export function defaultEmailBrand(): EmailBrand {
    return getEmailBrand(null);
}

/**
 * Marca de correo del dominio. NUNCA lanza: cualquier dato invalido cae al valor por defecto.
 * `domainCtx` puede ser la `config` de /api/config, el resultado de `useDomainConfig().config`, o null.
 */
export function getEmailBrand(domainCtx?: EmailDomainContext | null): EmailBrand {
    const ctx = domainCtx && typeof domainCtx === 'object' ? domainCtx : null;
    const theme = sanitizeThemeConfig(ctx?.theme, { sanitizeLanding: (input) => sanitizeLandingConfig(input) as Record<string, unknown> });
    const landing = (theme.landing ?? {}) as LandingConfig;

    const name = cleanBrandText(ctx?.displayName, MAX_NAME) || cleanBrandText(ctx?.name, MAX_NAME) || cleanBrandText(envName(), MAX_NAME) || 'Bloom';

    const primary = pickPrimary(theme);
    // El tono de la marca se conserva TAL CUAL en las superficies (un amarillo sigue siendo amarillo); el texto encima se
    // elige por contraste (onColor) y solo el uso como texto/enlace sobre blanco pasa por una version corregida a AA.
    // Se calculan con la MISMA funcion que usa la plantilla, para que el editor muestre exactamente lo que se envia.
    const resolved = resolveInviteBrand({ color: primary });
    const color = resolved.color as string;
    const onColor = resolved.onColor as string;
    const linkColor = resolved.linkColor as string;

    const logoUrl = httpsOnly(landing.logo?.light);
    const footer = cleanBrandText(landing.footer?.text, MAX_FOOTER) || null;
    const locale = landing.locale === 'en' || landing.locale === 'es' ? landing.locale : null;

    return { name, color, onColor, linkColor, logoUrl, url: hostToSite(ctx?.name), footer, locale };
}

/**
 * Comprobacion expuesta para tests y el panel: el texto sobre la marca (onColor/color) y la marca usada como texto sobre
 * blanco (linkColor) cumplen AA (>= 4.5:1).
 */
export function brandPassesAA(brand: Pick<EmailBrand, 'color' | 'onColor' | 'linkColor'>): boolean {
    return contrast(brand.color, brand.onColor) >= 4.5 && contrast(brand.linkColor, '#ffffff') >= 4.5;
}

export interface EmailBrandAnalysis {
    /** Color de marca tal como lo pidio el administrador (#rrggbb). */
    requested: string;
    /** true si, usada como texto o enlace sobre blanco, la marca hubo que corregirla (oscurecerla) para llegar a AA. */
    textCorrected: boolean;
    /** Color que se usa para texto/enlaces de marca sobre blanco. */
    linkColor: string;
    /** Contraste del texto sobre la marca (superficies) y de la marca-como-texto sobre blanco. */
    onColorRatio: number;
    linkRatio: number;
    /** Las superficies (banda, boton) mantienen el tono exacto: siempre true en esta version. */
    surfacesExact: boolean;
}

/** Que se corrigio y que no: alimenta el aviso del editor de temas ("como texto, tu color se oscurece para ser legible"). */
export function analyzeEmailBrand(brand: Pick<EmailBrand, 'color' | 'onColor' | 'linkColor'>, requested?: string | null): EmailBrandAnalysis {
    const wanted = normalizeHex(requested) ?? brand.color;
    return {
        requested: wanted,
        textCorrected: brand.linkColor !== wanted,
        linkColor: brand.linkColor,
        onColorRatio: contrast(brand.color, brand.onColor),
        linkRatio: contrast(brand.linkColor, '#ffffff'),
        surfacesExact: brand.color === wanted,
    };
}

/**
 * Idioma del correo.
 *  - audience 'recipient' (invitado de una reserva publica, sin cuenta): Accept-Language del invitado > idioma de la empresa > es.
 *  - audience 'user' (usuario autenticado / anfitrion): preferencia explicita del usuario (cookie) > idioma de la empresa >
 *    Accept-Language > es.
 */
export function resolveEmailLocale(input: {
    brand?: Pick<EmailBrand, 'locale'> | null;
    preferred?: string | null;
    acceptLanguage?: string | null;
    audience?: 'recipient' | 'user';
}): EmailLocale {
    const preferred = isLocale(input.preferred) ? (input.preferred as Locale) : null;
    const accept = negotiateLocale(input.acceptLanguage);
    const company = input.brand?.locale ?? null;
    const order = input.audience === 'recipient' ? [accept, company] : [preferred, company, accept];
    return (order.find(Boolean) as EmailLocale | undefined) ?? 'es';
}
