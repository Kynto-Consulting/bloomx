/**
 * Modelo y sanitizador ESTRICTO de la "landing" (pantalla de acceso) de cada empresa.
 *
 * Se guarda dentro de Domain.theme.landing. Es DATO, nunca codigo: solo claves de una lista blanca,
 * longitudes maximas, enums, colores hex, numeros acotados y URLs https (o rutas relativas seguras
 * en los enlaces). Sin HTML, sin CSS libre, sin JS, sin `data:`/`javascript:`/`http:`.
 *
 * ESPEJO: este archivo debe ser IDENTICO (byte a byte) en
 *   - bloomx/src/lib/landing-config.ts            (frontend: render + editor)
 *   - bloomx-backend/src/lib/landing-config.ts    (backend: sanitiza al guardar y al servir /api/config)
 * Un test de paridad (src/lib/__tests__/landing-config.test.ts) lo comprueba. Por eso NO tiene imports
 * y solo usa sintaxis que Node (--experimental-strip-types) acepta: sin enums ni parameter properties.
 *
 * CSP / imagenes: las imagenes de empresa (hero, fondo, logos, avatares) solo pueden ser https:. El
 * `img-src` de next.config.js ya permite `https:` (no `http:`); no hace falta abrirlo mas. El render usa
 * <img referrerPolicy="no-referrer"> y nunca `url(...)` en CSS, asi no hay inyeccion de CSS por URL.
 */

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

export const LANDING_MAX_BYTES = 32 * 1024;

export const LANDING_LAYOUTS = ['split-left', 'split-right', 'center', 'fullscreen-bg', 'minimal'] as const;
export const LANDING_ICONS = [
    'shield', 'lock', 'zap', 'globe', 'mail', 'users', 'sparkles', 'check', 'star', 'heart',
    'clock', 'cloud', 'key', 'inbox', 'send', 'calendar', 'bell', 'file', 'headphones', 'rocket',
    'chart', 'building',
] as const;
export const LANDING_PATTERNS = ['none', 'dots', 'grid', 'diagonal'] as const;
export const LANDING_IMAGE_POSITIONS = ['center', 'top', 'bottom', 'left', 'right'] as const;
export const LANDING_TESTIMONIAL_STYLES = ['cards', 'carousel', 'quote'] as const;
export const LANDING_LOGO_POSITIONS = ['panel', 'hero', 'header'] as const;
export const LANDING_BACKGROUND_TYPES = ['color', 'gradient', 'image'] as const;
export const LANDING_ALIGNMENTS = ['left', 'center'] as const;
export const LANDING_MOBILE_HERO = ['banner', 'hidden'] as const;
export const LANDING_LOCALES = ['es', 'en'] as const;

export type LandingLayout = (typeof LANDING_LAYOUTS)[number];
export type LandingIcon = (typeof LANDING_ICONS)[number];
export type LandingPattern = (typeof LANDING_PATTERNS)[number];
export type LandingImagePosition = (typeof LANDING_IMAGE_POSITIONS)[number];
export type LandingTestimonialStyle = (typeof LANDING_TESTIMONIAL_STYLES)[number];
export type LandingLogoPosition = (typeof LANDING_LOGO_POSITIONS)[number];
export type LandingBackgroundType = (typeof LANDING_BACKGROUND_TYPES)[number];
export type LandingAlignment = (typeof LANDING_ALIGNMENTS)[number];
export type LandingMobileHero = (typeof LANDING_MOBILE_HERO)[number];
export type LandingLocale = (typeof LANDING_LOCALES)[number];

export const LANDING_LIMITS = {
    heroTitle: 80,
    heroSubtitle: 240,
    heroBadge: 40,
    imageAlt: 120,
    formTitle: 80,
    formSubtitle: 200,
    submitLabel: 40,
    url: 500,
    quote: 280,
    author: 60,
    role: 80,
    featureTitle: 60,
    featureText: 160,
    statValue: 16,
    statLabel: 40,
    footerText: 200,
    linkLabel: 40,
    registrationMessage: 200,
    testimonials: 8,
    features: 6,
    stats: 4,
    links: 6,
    panelWidthMin: 320,
    panelWidthMax: 560,
    logoHeightMin: 16,
    logoHeightMax: 96,
} as const;

/** Textos traducibles por idioma (config.i18n[locale]). */
export const LANDING_TEXT_KEYS = [
    'heroTitle', 'heroSubtitle', 'heroBadge', 'imageAlt',
    'formTitle', 'formSubtitle', 'submitLabel',
    'registerTitle', 'registerSubtitle', 'registerSubmitLabel',
    'footerText', 'registrationMessage',
] as const;
export type LandingTextKey = (typeof LANDING_TEXT_KEYS)[number];

export const LANDING_TEXT_LIMITS: Record<LandingTextKey, number> = {
    heroTitle: LANDING_LIMITS.heroTitle,
    heroSubtitle: LANDING_LIMITS.heroSubtitle,
    heroBadge: LANDING_LIMITS.heroBadge,
    imageAlt: LANDING_LIMITS.imageAlt,
    formTitle: LANDING_LIMITS.formTitle,
    formSubtitle: LANDING_LIMITS.formSubtitle,
    submitLabel: LANDING_LIMITS.submitLabel,
    registerTitle: LANDING_LIMITS.formTitle,
    registerSubtitle: LANDING_LIMITS.formSubtitle,
    registerSubmitLabel: LANDING_LIMITS.submitLabel,
    footerText: LANDING_LIMITS.footerText,
    registrationMessage: LANDING_LIMITS.registrationMessage,
};

/** Donde vive cada texto en la config base (seccion, campo). */
export const LANDING_TEXT_PATHS: Record<LandingTextKey, [string, string]> = {
    heroTitle: ['hero', 'title'],
    heroSubtitle: ['hero', 'subtitle'],
    heroBadge: ['hero', 'badge'],
    imageAlt: ['hero', 'imageAlt'],
    formTitle: ['form', 'title'],
    formSubtitle: ['form', 'subtitle'],
    submitLabel: ['form', 'submitLabel'],
    registerTitle: ['form', 'registerTitle'],
    registerSubtitle: ['form', 'registerSubtitle'],
    registerSubmitLabel: ['form', 'registerSubmitLabel'],
    footerText: ['footer', 'text'],
    registrationMessage: ['registration', 'message'],
};

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface LandingGradient { from: string; to: string; angle: number }
export interface LandingTestimonial { quote: string; author?: string; role?: string; avatarUrl?: string }
export interface LandingFeature { icon?: LandingIcon; title: string; text?: string }
export interface LandingStat { value: string; label?: string }
export interface LandingLink { label: string; url: string }
export type LandingTexts = Partial<Record<LandingTextKey, string>>;

export interface LandingConfig {
    layout?: LandingLayout;
    /** Ancho del panel de login en px (320-560). */
    panelWidth?: number;
    /** Fuerza el idioma de la landing (textos de empresa y diccionario). */
    locale?: LandingLocale;
    hero?: {
        title?: string; subtitle?: string; badge?: string;
        imageUrl?: string; imageAlt?: string; imagePosition?: LandingImagePosition;
        /** 0..1. El render sube el minimo necesario para garantizar contraste AA del texto. */
        overlay?: number;
        gradient?: LandingGradient | null;
        pattern?: LandingPattern;
        /** En movil: 'banner' = hero compacto arriba; 'hidden' = solo cabecera de marca. */
        mobile?: LandingMobileHero;
    };
    logo?: {
        light?: string; dark?: string; height?: number;
        position?: LandingLogoPosition; showName?: boolean;
    };
    background?: {
        type?: LandingBackgroundType;
        color?: string; gradient?: LandingGradient; imageUrl?: string; overlay?: number;
    };
    form?: {
        title?: string; subtitle?: string; submitLabel?: string;
        registerTitle?: string; registerSubtitle?: string; registerSubmitLabel?: string;
        showRegisterLink?: boolean; showForgotLink?: boolean; showGoogle?: boolean; showRememberMe?: boolean;
        alignment?: LandingAlignment;
    };
    testimonials?: { enabled?: boolean; style?: LandingTestimonialStyle; items?: LandingTestimonial[] };
    features?: LandingFeature[];
    stats?: LandingStat[];
    footer?: { text?: string; links?: LandingLink[]; showPoweredBy?: boolean };
    legal?: { termsUrl?: string; privacyUrl?: string };
    docs?: { visible?: boolean; showInFooter?: boolean; showInSidebar?: boolean; landingLink?: boolean };
    registration?: { enabled?: boolean; requireKey?: boolean; message?: string };
    i18n?: { es?: LandingTexts; en?: LandingTexts };
}

export interface LandingIssue {
    path: string;
    code: 'truncated' | 'html_removed' | 'invalid_url' | 'not_https' | 'invalid_color' | 'invalid_value'
        | 'clamped' | 'too_many_items' | 'missing_field' | 'too_large' | 'invalid';
}

export interface LandingSanitizeResult {
    config: LandingConfig;
    issues: LandingIssue[];
    /** Tamano en bytes del JSON saneado. */
    bytes: number;
}

// ---------------------------------------------------------------------------
// Primitivas de saneado
// ---------------------------------------------------------------------------

interface Ctx { issues: LandingIssue[] }

function isObj(v: unknown): v is Record<string, unknown> {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
}

function get(o: Record<string, unknown>, key: string): unknown {
    return Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined;
}

// Clases de caracteres construidas con codigos (sin escapes unicode en el fuente: el espejo debe ser 100% ASCII).
function charClassRanges(ranges: number[][]): string {
    return ranges.map((r) => (r[0] === r[1] ? String.fromCharCode(r[0]) : String.fromCharCode(r[0]) + '-' + String.fromCharCode(r[1]))).join('');
}
function charClassRegExp(ranges: number[][], flags: string): RegExp {
    return new RegExp('[' + charClassRanges(ranges) + ']', flags);
}

// Controles C0/C1, separadores de linea, marcas bidi (spoofing) y caracteres de ancho cero.
const CONTROL_RE = charClassRegExp([[0, 31], [127, 159], [0x2028, 0x2029], [0x200b, 0x200f], [0x202a, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff]], 'g');

function cleanText(ctx: Ctx, path: string, v: unknown, max: number): string | undefined {
    if (typeof v !== 'string') return undefined;
    let s = v.replace(CONTROL_RE, ' ');
    const stripped = s.replace(/<[^>]*>?/g, '').replace(/[<>]/g, '');
    if (stripped !== s) ctx.issues.push({ path, code: 'html_removed' });
    s = stripped.replace(/\s+/g, ' ').trim();
    if (s.length > max) {
        s = s.slice(0, max).trim();
        ctx.issues.push({ path, code: 'truncated' });
    }
    return s || undefined;
}

const BAD_URL_CHARS_RE = new RegExp('[' + charClassRanges([[0, 32], [127, 159]]) + '"\'<>\\\\`{}|^]');

function httpsUrl(ctx: Ctx, path: string, v: unknown): string | undefined {
    if (typeof v !== 'string') return undefined;
    const s = v.trim();
    if (!s) return undefined;
    if (s.length > LANDING_LIMITS.url || BAD_URL_CHARS_RE.test(s)) { ctx.issues.push({ path, code: 'invalid_url' }); return undefined; }
    let u: URL;
    try { u = new URL(s); } catch { ctx.issues.push({ path, code: 'invalid_url' }); return undefined; }
    if (u.protocol !== 'https:') { ctx.issues.push({ path, code: 'not_https' }); return undefined; }
    if (u.username || u.password || !u.hostname) { ctx.issues.push({ path, code: 'invalid_url' }); return undefined; }
    return u.href;
}

/** Enlace: https absoluto o ruta relativa segura ("/x"; nunca "//host" ni "/\\host"). */
function linkUrl(ctx: Ctx, path: string, v: unknown): string | undefined {
    if (typeof v !== 'string') return undefined;
    const s = v.trim();
    if (!s) return undefined;
    if (s.startsWith('/')) {
        if (s.length > LANDING_LIMITS.url || s.startsWith('//') || BAD_URL_CHARS_RE.test(s)) {
            ctx.issues.push({ path, code: 'invalid_url' });
            return undefined;
        }
        return s;
    }
    return httpsUrl(ctx, path, s);
}

function hexColor(ctx: Ctx, path: string, v: unknown): string | undefined {
    if (typeof v !== 'string') return undefined;
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
    if (!m) { ctx.issues.push({ path, code: 'invalid_color' }); return undefined; }
    let h = m[1].toLowerCase();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return '#' + h;
}

function num(ctx: Ctx, path: string, v: unknown, min: number, max: number, integer: boolean): number | undefined {
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
    let n = integer ? Math.round(v) : Math.round(v * 100) / 100;
    if (n < min) n = min;
    if (n > max) n = max;
    if (n !== v) ctx.issues.push({ path, code: 'clamped' });
    return n;
}

function oneOf<T extends string>(ctx: Ctx, path: string, v: unknown, list: readonly T[]): T | undefined {
    if (typeof v !== 'string') return undefined;
    if ((list as readonly string[]).includes(v)) return v as T;
    ctx.issues.push({ path, code: 'invalid_value' });
    return undefined;
}

function bool(v: unknown): boolean | undefined {
    return typeof v === 'boolean' ? v : undefined;
}

function list(ctx: Ctx, path: string, v: unknown, max: number): unknown[] {
    if (!Array.isArray(v)) return [];
    if (v.length > max) ctx.issues.push({ path, code: 'too_many_items' });
    return v.slice(0, max);
}

/** Copia solo las claves con valor definido. Devuelve undefined si queda vacio. */
function compact<T extends Record<string, unknown>>(o: T): T | undefined {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) if (o[k] !== undefined) out[k] = o[k];
    return Object.keys(out).length ? (out as T) : undefined;
}

function gradient(ctx: Ctx, path: string, v: unknown): LandingGradient | undefined {
    if (!isObj(v)) return undefined;
    const from = hexColor(ctx, path + '.from', get(v, 'from'));
    const to = hexColor(ctx, path + '.to', get(v, 'to'));
    if (!from || !to) { if (get(v, 'from') !== undefined || get(v, 'to') !== undefined) ctx.issues.push({ path, code: 'missing_field' }); return undefined; }
    const angle = num(ctx, path + '.angle', get(v, 'angle'), 0, 360, true);
    return { from, to, angle: angle === undefined ? 135 : angle };
}

function texts(ctx: Ctx, path: string, v: unknown): LandingTexts | undefined {
    if (!isObj(v)) return undefined;
    const out: LandingTexts = {};
    for (const key of LANDING_TEXT_KEYS) {
        const s = cleanText(ctx, path + '.' + key, get(v, key), LANDING_TEXT_LIMITS[key]);
        if (s !== undefined) out[key] = s;
    }
    return compact(out);
}

// ---------------------------------------------------------------------------
// Sanitizador
// ---------------------------------------------------------------------------

function byteLength(s: string): number {
    return new TextEncoder().encode(s).length;
}

/** Sanea y devuelve tambien las incidencias (para la validacion en vivo del editor). Nunca lanza. */
export function sanitizeLandingConfigDetailed(input: unknown): LandingSanitizeResult {
    const ctx: Ctx = { issues: [] };
    const empty = (code: LandingIssue['code']): LandingSanitizeResult => ({ config: {}, issues: [{ path: '', code }], bytes: 2 });

    if (!isObj(input)) return { config: {}, issues: [], bytes: 2 };
    try {
        if (byteLength(JSON.stringify(input)) > LANDING_MAX_BYTES) return empty('too_large');
    } catch {
        return empty('invalid');
    }

    const cfg: LandingConfig = {};
    cfg.layout = oneOf(ctx, 'layout', get(input, 'layout'), LANDING_LAYOUTS);
    cfg.panelWidth = num(ctx, 'panelWidth', get(input, 'panelWidth'), LANDING_LIMITS.panelWidthMin, LANDING_LIMITS.panelWidthMax, true);
    cfg.locale = oneOf(ctx, 'locale', get(input, 'locale'), LANDING_LOCALES);

    const hero = get(input, 'hero');
    if (isObj(hero)) {
        cfg.hero = compact({
            title: cleanText(ctx, 'hero.title', get(hero, 'title'), LANDING_LIMITS.heroTitle),
            subtitle: cleanText(ctx, 'hero.subtitle', get(hero, 'subtitle'), LANDING_LIMITS.heroSubtitle),
            badge: cleanText(ctx, 'hero.badge', get(hero, 'badge'), LANDING_LIMITS.heroBadge),
            imageUrl: httpsUrl(ctx, 'hero.imageUrl', get(hero, 'imageUrl')),
            imageAlt: cleanText(ctx, 'hero.imageAlt', get(hero, 'imageAlt'), LANDING_LIMITS.imageAlt),
            imagePosition: oneOf(ctx, 'hero.imagePosition', get(hero, 'imagePosition'), LANDING_IMAGE_POSITIONS),
            overlay: num(ctx, 'hero.overlay', get(hero, 'overlay'), 0, 1, false),
            gradient: gradient(ctx, 'hero.gradient', get(hero, 'gradient')),
            pattern: oneOf(ctx, 'hero.pattern', get(hero, 'pattern'), LANDING_PATTERNS),
            mobile: oneOf(ctx, 'hero.mobile', get(hero, 'mobile'), LANDING_MOBILE_HERO),
        });
    }

    const logo = get(input, 'logo');
    if (isObj(logo)) {
        cfg.logo = compact({
            light: httpsUrl(ctx, 'logo.light', get(logo, 'light')),
            dark: httpsUrl(ctx, 'logo.dark', get(logo, 'dark')),
            height: num(ctx, 'logo.height', get(logo, 'height'), LANDING_LIMITS.logoHeightMin, LANDING_LIMITS.logoHeightMax, true),
            position: oneOf(ctx, 'logo.position', get(logo, 'position'), LANDING_LOGO_POSITIONS),
            showName: bool(get(logo, 'showName')),
        });
    }

    const bg = get(input, 'background');
    if (isObj(bg)) {
        cfg.background = compact({
            type: oneOf(ctx, 'background.type', get(bg, 'type'), LANDING_BACKGROUND_TYPES),
            color: hexColor(ctx, 'background.color', get(bg, 'color')),
            gradient: gradient(ctx, 'background.gradient', get(bg, 'gradient')),
            imageUrl: httpsUrl(ctx, 'background.imageUrl', get(bg, 'imageUrl')),
            overlay: num(ctx, 'background.overlay', get(bg, 'overlay'), 0, 1, false),
        });
    }

    const form = get(input, 'form');
    if (isObj(form)) {
        cfg.form = compact({
            title: cleanText(ctx, 'form.title', get(form, 'title'), LANDING_LIMITS.formTitle),
            subtitle: cleanText(ctx, 'form.subtitle', get(form, 'subtitle'), LANDING_LIMITS.formSubtitle),
            submitLabel: cleanText(ctx, 'form.submitLabel', get(form, 'submitLabel'), LANDING_LIMITS.submitLabel),
            registerTitle: cleanText(ctx, 'form.registerTitle', get(form, 'registerTitle'), LANDING_LIMITS.formTitle),
            registerSubtitle: cleanText(ctx, 'form.registerSubtitle', get(form, 'registerSubtitle'), LANDING_LIMITS.formSubtitle),
            registerSubmitLabel: cleanText(ctx, 'form.registerSubmitLabel', get(form, 'registerSubmitLabel'), LANDING_LIMITS.submitLabel),
            showRegisterLink: bool(get(form, 'showRegisterLink')),
            showForgotLink: bool(get(form, 'showForgotLink')),
            showGoogle: bool(get(form, 'showGoogle')),
            showRememberMe: bool(get(form, 'showRememberMe')),
            alignment: oneOf(ctx, 'form.alignment', get(form, 'alignment'), LANDING_ALIGNMENTS),
        });
    }

    const tst = get(input, 'testimonials');
    if (isObj(tst)) {
        const items: LandingTestimonial[] = [];
        list(ctx, 'testimonials.items', get(tst, 'items'), LANDING_LIMITS.testimonials).forEach((raw, i) => {
            const p = 'testimonials.items[' + i + ']';
            if (!isObj(raw)) return;
            const quote = cleanText(ctx, p + '.quote', get(raw, 'quote'), LANDING_LIMITS.quote);
            if (!quote) { ctx.issues.push({ path: p + '.quote', code: 'missing_field' }); return; }
            items.push(compact({
                quote,
                author: cleanText(ctx, p + '.author', get(raw, 'author'), LANDING_LIMITS.author),
                role: cleanText(ctx, p + '.role', get(raw, 'role'), LANDING_LIMITS.role),
                avatarUrl: httpsUrl(ctx, p + '.avatarUrl', get(raw, 'avatarUrl')),
            }) as LandingTestimonial);
        });
        cfg.testimonials = compact({
            enabled: bool(get(tst, 'enabled')),
            style: oneOf(ctx, 'testimonials.style', get(tst, 'style'), LANDING_TESTIMONIAL_STYLES),
            items: items.length ? items : undefined,
        });
    }

    const features: LandingFeature[] = [];
    list(ctx, 'features', get(input, 'features'), LANDING_LIMITS.features).forEach((raw, i) => {
        const p = 'features[' + i + ']';
        if (!isObj(raw)) return;
        const title = cleanText(ctx, p + '.title', get(raw, 'title'), LANDING_LIMITS.featureTitle);
        if (!title) { ctx.issues.push({ path: p + '.title', code: 'missing_field' }); return; }
        features.push(compact({
            icon: oneOf(ctx, p + '.icon', get(raw, 'icon'), LANDING_ICONS),
            title,
            text: cleanText(ctx, p + '.text', get(raw, 'text'), LANDING_LIMITS.featureText),
        }) as LandingFeature);
    });
    if (features.length) cfg.features = features;

    const stats: LandingStat[] = [];
    list(ctx, 'stats', get(input, 'stats'), LANDING_LIMITS.stats).forEach((raw, i) => {
        const p = 'stats[' + i + ']';
        if (!isObj(raw)) return;
        const value = cleanText(ctx, p + '.value', get(raw, 'value'), LANDING_LIMITS.statValue);
        if (!value) { ctx.issues.push({ path: p + '.value', code: 'missing_field' }); return; }
        stats.push(compact({ value, label: cleanText(ctx, p + '.label', get(raw, 'label'), LANDING_LIMITS.statLabel) }) as LandingStat);
    });
    if (stats.length) cfg.stats = stats;

    const footer = get(input, 'footer');
    if (isObj(footer)) {
        const links: LandingLink[] = [];
        list(ctx, 'footer.links', get(footer, 'links'), LANDING_LIMITS.links).forEach((raw, i) => {
            const p = 'footer.links[' + i + ']';
            if (!isObj(raw)) return;
            const label = cleanText(ctx, p + '.label', get(raw, 'label'), LANDING_LIMITS.linkLabel);
            const url = linkUrl(ctx, p + '.url', get(raw, 'url'));
            if (!label || !url) { ctx.issues.push({ path: p, code: 'missing_field' }); return; }
            links.push({ label, url });
        });
        cfg.footer = compact({
            text: cleanText(ctx, 'footer.text', get(footer, 'text'), LANDING_LIMITS.footerText),
            links: links.length ? links : undefined,
            showPoweredBy: bool(get(footer, 'showPoweredBy')),
        });
    }

    const legal = get(input, 'legal');
    if (isObj(legal)) {
        cfg.legal = compact({
            termsUrl: linkUrl(ctx, 'legal.termsUrl', get(legal, 'termsUrl')),
            privacyUrl: linkUrl(ctx, 'legal.privacyUrl', get(legal, 'privacyUrl')),
        });
    }

    const docs = get(input, 'docs');
    if (isObj(docs)) {
        cfg.docs = compact({
            visible: bool(get(docs, 'visible')),
            showInFooter: bool(get(docs, 'showInFooter')),
            showInSidebar: bool(get(docs, 'showInSidebar')),
            landingLink: bool(get(docs, 'landingLink')),
        });
    }

    const reg = get(input, 'registration');
    if (isObj(reg)) {
        cfg.registration = compact({
            enabled: bool(get(reg, 'enabled')),
            requireKey: bool(get(reg, 'requireKey')),
            message: cleanText(ctx, 'registration.message', get(reg, 'message'), LANDING_LIMITS.registrationMessage),
        });
    }

    const i18n = get(input, 'i18n');
    if (isObj(i18n)) {
        cfg.i18n = compact({
            es: texts(ctx, 'i18n.es', get(i18n, 'es')),
            en: texts(ctx, 'i18n.en', get(i18n, 'en')),
        });
    }

    // Quita claves undefined de primer nivel.
    const config = (compact(cfg as Record<string, unknown>) || {}) as LandingConfig;
    return { config, issues: ctx.issues, bytes: byteLength(JSON.stringify(config)) };
}

/** Sanea una config de landing. Entrada desconocida/hostil -> solo lo valido (o {}). Nunca lanza. */
export function sanitizeLandingConfig(input: unknown): LandingConfig {
    return sanitizeLandingConfigDetailed(input).config;
}

// ---------------------------------------------------------------------------
// Helpers compartidos (frontend y backend)
// ---------------------------------------------------------------------------

/** Extrae y sanea `theme.landing`. Sin landing -> {}. */
export function landingFromTheme(theme: unknown): LandingConfig {
    if (!isObj(theme)) return {};
    return sanitizeLandingConfig(get(theme, 'landing'));
}

/**
 * Para /api/config: devuelve el theme tal cual si no tiene `landing` (instancias viejas, misma referencia);
 * si lo tiene, una copia con `landing` re-saneado (se omite si queda vacio).
 */
export function withSanitizedLanding<T>(theme: T): T {
    if (!isObj(theme) || get(theme, 'landing') === undefined) return theme;
    const { landing, ...rest } = theme as Record<string, unknown>;
    const clean = sanitizeLandingConfig(landing);
    return (Object.keys(clean).length ? { ...rest, landing: clean } : rest) as T;
}

/** Que partes de la documentacion se muestran. Sin config = comportamiento historico (enlace en login, docs abiertas). */
export function resolveDocsVisibility(landing: LandingConfig | null | undefined) {
    const d = landing && landing.docs ? landing.docs : {};
    const visible = d.visible !== false;
    return {
        /** Las paginas /docs existen para esta empresa. */
        visible,
        /** Enlace "Documentacion" en el hero/cabecera de login y registro. */
        landingLink: visible && d.landingLink !== false,
        /** Enlace en el pie de la landing (opt-in). */
        footer: visible && d.showInFooter === true,
        /** Enlace en la barra lateral / ajustes de la app. */
        sidebar: visible && d.showInSidebar !== false,
    };
}

/** Texto efectivo: config.i18n[locale] > config base > undefined (el llamador aplica el diccionario). */
export function resolveLandingText(
    landing: LandingConfig | null | undefined,
    locale: string,
    key: LandingTextKey,
): string | undefined {
    if (!landing) return undefined;
    const byLocale = landing.i18n && (landing.i18n as Record<string, LandingTexts | undefined>)[locale];
    const override = byLocale ? byLocale[key] : undefined;
    if (override) return override;
    const [section, field] = LANDING_TEXT_PATHS[key];
    const sec = (landing as Record<string, unknown>)[section];
    if (sec && typeof sec === 'object') {
        const v = (sec as Record<string, unknown>)[field];
        if (typeof v === 'string' && v) return v;
    }
    return undefined;
}
