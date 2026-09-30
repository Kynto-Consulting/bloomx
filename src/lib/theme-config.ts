/**
 * MODELO DE TEMA DE EMPRESA + SANEADO ESTRICTO  (modulo COMPARTIDO frontend/backend)
 * ------------------------------------------------------------------------------
 * ATENCION: este fichero existe en DOS repos y debe ser BYTE-IDENTICO (salvo fin de linea):
 *   bloomx/src/lib/theme-config.ts            <- copia frontend
 *   bloomx-backend/src/lib/theme-config.ts    <- copia backend (la que guarda Domain.theme)
 * Los tests de ambos repos comprueban la paridad (vectores de oro + comparacion de ficheros).
 * Por eso NO tiene imports: es TypeScript "borrable" (compatible con node --experimental-strip-types).
 *
 * Contenido:
 *   - TOKEN_KEYS: registro de tokens semanticos (fuente de verdad; themes.ts lo reexporta).
 *   - DomainThemeConfig: forma que guarda cada empresa en Domain.theme (retrocompatible).
 *   - sanitizeThemeConfig / validateThemeConfig: lista blanca de claves, solo hex normalizado,
 *     sin CSS arbitrario, con tamanos maximos. Nunca lanza excepciones.
 *   - FONT_FAMILIES / RADIUS_PRESETS_REM: valores permitidos (los stacks son constantes, nunca texto del usuario).
 */

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export const TOKEN_KEYS = [
    // Lienzo y superficies
    'background', 'foreground',
    'card', 'card-foreground',
    'popover', 'popover-foreground',
    // Acciones y estados
    'primary', 'primary-foreground',
    'secondary', 'secondary-foreground',
    'muted', 'muted-foreground',
    'accent', 'accent-foreground',
    'destructive', 'destructive-foreground',
    'success', 'success-foreground',
    'warning', 'warning-foreground',
    'info', 'info-foreground',
    // Bordes, controles, foco
    'border', 'input', 'ring',
    // Acento de marca
    'brand-accent', 'brand-accent-foreground',
    // Navegacion lateral
    'sidebar', 'sidebar-foreground',
    'sidebar-accent', 'sidebar-accent-foreground',
    'sidebar-border',
    // Cabecera
    'header', 'header-foreground',
    // Listas de correo
    'unread', 'unread-foreground',
    'row-hover',
    'row-selected', 'row-selected-foreground',
    // Enlaces
    'link', 'link-hover',
    // Codigo, capas, etiquetas, seleccion, scroll
    'code', 'code-foreground',
    'overlay',
    'chip', 'chip-foreground',
    'selection', 'selection-foreground',
    'scrollbar',
] as const;

export type TokenKey = typeof TOKEN_KEYS[number];

/** Unico token que admite canal alfa (#rrggbbaa): una capa translucida. El resto son opacos. */
export const ALPHA_TOKENS: readonly TokenKey[] = ['overlay'];

// ---------------------------------------------------------------------------
// Modelo
// ---------------------------------------------------------------------------

export type ThemeMode = 'light' | 'dark';
export type ThemeDefaultMode = ThemeMode | 'system';
export type ThemeRadius = 'none' | 'sm' | 'md' | 'lg' | 'xl';
export type ThemePaletteMode = Partial<Record<TokenKey, string>>;
export interface ThemePalette { light?: ThemePaletteMode; dark?: ThemePaletteMode }

export interface DomainThemeConfig {
    // ---- Campos ANTIGUOS (siguen funcionando igual; son mono-modo y de marca) ----
    primaryColor?: string; primaryForeground?: string;
    secondaryColor?: string; secondaryForeground?: string;
    accentColor?: string; accentForeground?: string;
    backgroundColor?: string; textColor?: string;
    mutedColor?: string; mutedForeground?: string;
    cardColor?: string; cardForeground?: string;
    borderColor?: string; inputColor?: string; ringColor?: string;
    titleFont?: string; bodyFont?: string;
    // ---- Campos NUEVOS ----
    /** Cualquier token sobreescribible por modo. El valor explicito GANA sobre la derivacion automatica. */
    palette?: ThemePalette;
    /** Modo inicial cuando el usuario aun no eligio tema. 'system' sigue prefers-color-scheme. */
    defaultMode?: ThemeDefaultMode;
    /** Escala de radio. Acepta tambien un numero (rem, 0-3) por compatibilidad con configs antiguas. */
    radius?: ThemeRadius | number | string;
    /** Id de FONT_FAMILIES (lista blanca). Afecta a cuerpo y titulos; titleFont/bodyFont lo refinan. */
    fontFamily?: string;
    /** Ids de temas genericos que el usuario puede elegir. Vacio/omitido = todos. */
    allowedThemes?: string[];
    /** true: el usuario solo ve los temas de la empresa (brand-light / brand-dark). */
    lockBrand?: boolean;
    /** false: NO se corrigen automaticamente los tokens explicitos que incumplan AA (solo se avisa). Por defecto true. */
    autoFixContrast?: boolean;
    /** Configuracion del landing/login. Se delega en sanitizeLandingConfig (ver LANDING_SEAM); opaca para el motor de temas. */
    landing?: Record<string, unknown>;
}

export const LEGACY_COLOR_FIELDS = [
    'primaryColor', 'primaryForeground', 'secondaryColor', 'secondaryForeground',
    'accentColor', 'accentForeground', 'backgroundColor', 'textColor',
    'mutedColor', 'mutedForeground', 'cardColor', 'cardForeground',
    'borderColor', 'inputColor', 'ringColor',
] as const;

export const THEME_MODES: readonly ThemeDefaultMode[] = ['light', 'dark', 'system'];

/** Radio base (--radius) por preset, en rem. 'md' = 0.5rem = el valor historico de la app. */
export const RADIUS_PRESETS_REM: Record<ThemeRadius, number> = { none: 0, sm: 0.25, md: 0.5, lg: 0.75, xl: 1 };

/** Familias permitidas. El usuario solo elige el id; el stack es una constante (sin CSS arbitrario). */
export const FONT_FAMILIES: Record<string, { label: string; stack: string }> = {
    inter: { label: 'Inter', stack: 'Inter,system-ui,sans-serif' },
    system: { label: 'Sistema', stack: 'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif' },
    humanist: { label: 'Humanista', stack: '"Segoe UI",Seravek,"Gill Sans Nova",Ubuntu,Calibri,"DejaVu Sans",sans-serif' },
    geometric: { label: 'Geometrica', stack: 'Avenir,"Avenir Next",Montserrat,Corbel,"URW Gothic",system-ui,sans-serif' },
    rounded: { label: 'Redondeada', stack: 'ui-rounded,"Hiragino Maru Gothic ProN",Quicksand,Nunito,"Varela Round",system-ui,sans-serif' },
    serif: { label: 'Serif', stack: 'ui-serif,Georgia,Cambria,"Times New Roman",Times,serif' },
    mono: { label: 'Monoespaciada', stack: 'ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace' },
};

export const THEME_CONFIG_LIMITS = {
    /** Tamano maximo (JSON) de la entrada completa; por encima se rechaza todo. */
    maxInputJson: 96_000,
    /** Tamano maximo (JSON) de la subclave `landing` cuando se preserva tal cual. */
    maxLandingJson: 32_000,
    maxAllowedThemes: 32,
} as const;

export interface ThemeConfigIssue {
    /** Ruta del campo, p. ej. "palette.dark.background". */
    path: string;
    code: 'not_object' | 'too_large' | 'unknown_key' | 'invalid_color' | 'invalid_token' | 'alpha_not_allowed'
        | 'invalid_value' | 'too_many' | 'landing_invalid';
}

// ---------------------------------------------------------------------------
// Primitivas de saneado
// ---------------------------------------------------------------------------

const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const SAFE_FONT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 \-_]{0,48}$/;
const THEME_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isPlainObject = (v: unknown): v is Record<string, unknown> => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
};

/**
 * Normaliza un color a #rrggbb (o #rrggbbaa si allowAlpha y alfa != ff), en minusculas.
 * Devuelve null si no es un hex valido o si trae alfa cuando no esta permitido.
 */
export function normalizeThemeHex(value: unknown, allowAlpha = false): string | null {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    if (v.length > 9 || !HEX_RE.test(v)) return null;
    let h = v.slice(1).toLowerCase();
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length === 8) {
        if (h.slice(6) === 'ff') return `#${h.slice(0, 6)}`;
        return allowAlpha ? `#${h}` : null;
    }
    return `#${h}`;
}

function toRadius(value: unknown): ThemeRadius | number | null {
    if (typeof value === 'string') {
        const s = value.trim().toLowerCase();
        if (hasOwn(RADIUS_PRESETS_REM, s)) return s as ThemeRadius;
        if (/^\d(\.\d{1,3})?$/.test(s)) return toRadius(Number(s));
        return null;
    }
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 3) {
        return Math.round(value * 1000) / 1000;
    }
    return null;
}

/** Copia profunda JSON-segura (solo objetos planos/arrays/primitivos, sin claves peligrosas, profundidad acotada). */
function cloneJsonSafe(value: unknown, depth = 0): unknown {
    if (depth > 8) return undefined;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (Array.isArray(value)) {
        if (value.length > 200) return undefined;
        const out: unknown[] = [];
        for (const item of value) {
            const c = cloneJsonSafe(item, depth + 1);
            if (c !== undefined) out.push(c);
        }
        return out;
    }
    if (isPlainObject(value)) {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(value)) {
            if (FORBIDDEN_KEYS.has(k) || k.length > 64) continue;
            const c = cloneJsonSafe(value[k], depth + 1);
            if (c !== undefined) out[k] = c;
        }
        return out;
    }
    return undefined;
}

/**
 * LANDING_SEAM: mientras no exista ./landing-config, `landing` se preserva tal cual (objeto plano, <= 32 KB, JSON-seguro).
 * Cuando exista sanitizeLandingConfig(input), pasarla en `opts.sanitizeLanding` (o importarla aqui en AMBOS repos).
 */
function landingPassthrough(value: unknown): Record<string, unknown> | null {
    if (!isPlainObject(value)) return null;
    const clean = cloneJsonSafe(value);
    if (!isPlainObject(clean)) return null;
    try {
        if (JSON.stringify(clean).length > THEME_CONFIG_LIMITS.maxLandingJson) return null;
    } catch { return null; }
    return clean;
}

export interface SanitizeOptions {
    /** Sanitizador del landing (sanitizeLandingConfig). Por defecto: passthrough acotado. */
    sanitizeLanding?: (input: unknown) => Record<string, unknown> | null | undefined;
}

// ---------------------------------------------------------------------------
// Saneado
// ---------------------------------------------------------------------------

const KNOWN_TOP_KEYS: ReadonlySet<string> = new Set<string>([
    ...LEGACY_COLOR_FIELDS, 'titleFont', 'bodyFont',
    'palette', 'defaultMode', 'radius', 'fontFamily', 'allowedThemes', 'lockBrand', 'autoFixContrast', 'landing',
]);

const TOKEN_SET: ReadonlySet<string> = new Set<string>(TOKEN_KEYS);

function sanitizePaletteMode(input: unknown, path: string, issues: ThemeConfigIssue[]): ThemePaletteMode | undefined {
    if (!isPlainObject(input)) {
        if (input !== undefined && input !== null) issues.push({ path, code: 'invalid_value' });
        return undefined;
    }
    const out: ThemePaletteMode = {};
    let count = 0;
    for (const key of Object.keys(input)) {
        if (FORBIDDEN_KEYS.has(key) || !TOKEN_SET.has(key)) { issues.push({ path: `${path}.${key.slice(0, 40)}`, code: 'invalid_token' }); continue; }
        const raw = input[key];
        if (raw === undefined || raw === null || raw === '') continue;
        const allowAlpha = (ALPHA_TOKENS as readonly string[]).includes(key);
        const hex = normalizeThemeHex(raw, allowAlpha);
        if (!hex) {
            const alphaCase = typeof raw === 'string' && /^#(?:[0-9a-f]{4}|[0-9a-f]{8})$/i.test(raw.trim());
            issues.push({ path: `${path}.${key}`, code: alphaCase ? 'alpha_not_allowed' : 'invalid_color' });
            continue;
        }
        out[key as TokenKey] = hex;
        count++;
    }
    return count > 0 ? out : undefined;
}

/**
 * Valida y sanea la configuracion de tema de una empresa. NUNCA lanza.
 *   - Solo claves de la lista blanca; el resto se descarta (con issue `unknown_key`).
 *   - Colores: solo #rgb / #rgba / #rrggbb / #rrggbbaa; salida normalizada #rrggbb (alfa solo en `overlay`).
 *   - Sin CSS arbitrario: fuentes por id de lista blanca (o nombre alfanumerico legado), radio por enum/numero acotado.
 *   - Entrada > maxInputJson => {} + issue `too_large`.
 */
export function validateThemeConfig(input: unknown, opts: SanitizeOptions = {}): { config: DomainThemeConfig; issues: ThemeConfigIssue[] } {
    const issues: ThemeConfigIssue[] = [];
    const config: DomainThemeConfig = {};
    if (!isPlainObject(input)) {
        if (input !== undefined && input !== null) issues.push({ path: '', code: 'not_object' });
        return { config, issues };
    }
    try {
        if (JSON.stringify(input).length > THEME_CONFIG_LIMITS.maxInputJson) {
            return { config, issues: [{ path: '', code: 'too_large' }] };
        }
    } catch {
        return { config, issues: [{ path: '', code: 'not_object' }] };
    }

    for (const key of Object.keys(input)) {
        if (!KNOWN_TOP_KEYS.has(key)) issues.push({ path: key.slice(0, 40), code: 'unknown_key' });
    }

    const rec = config as Record<string, unknown>;
    for (const f of LEGACY_COLOR_FIELDS) {
        if (!hasOwn(input, f)) continue;
        const raw = input[f];
        if (raw === undefined || raw === null || raw === '') continue;
        const hex = normalizeThemeHex(raw, false);
        if (hex) rec[f] = hex; else issues.push({ path: f, code: 'invalid_color' });
    }
    for (const f of ['titleFont', 'bodyFont'] as const) {
        if (!hasOwn(input, f)) continue;
        const raw = input[f];
        if (raw === undefined || raw === null || raw === '') continue;
        const name = typeof raw === 'string' ? raw.trim() : '';
        if (SAFE_FONT_NAME_RE.test(name)) rec[f] = name; else issues.push({ path: f, code: 'invalid_value' });
    }

    if (hasOwn(input, 'palette') && input.palette !== undefined && input.palette !== null) {
        if (!isPlainObject(input.palette)) {
            issues.push({ path: 'palette', code: 'invalid_value' });
        } else {
            for (const k of Object.keys(input.palette)) {
                if (k !== 'light' && k !== 'dark') issues.push({ path: `palette.${k.slice(0, 40)}`, code: 'invalid_value' });
            }
            const light = sanitizePaletteMode(input.palette.light, 'palette.light', issues);
            const dark = sanitizePaletteMode(input.palette.dark, 'palette.dark', issues);
            if (light || dark) {
                const palette: ThemePalette = {};
                if (light) palette.light = light;
                if (dark) palette.dark = dark;
                config.palette = palette;
            }
        }
    }

    if (hasOwn(input, 'defaultMode') && input.defaultMode !== undefined && input.defaultMode !== null) {
        const m = typeof input.defaultMode === 'string' ? input.defaultMode.trim().toLowerCase() : '';
        if ((THEME_MODES as readonly string[]).includes(m)) config.defaultMode = m as ThemeDefaultMode;
        else issues.push({ path: 'defaultMode', code: 'invalid_value' });
    }

    if (hasOwn(input, 'radius') && input.radius !== undefined && input.radius !== null && input.radius !== '') {
        const r = toRadius(input.radius);
        if (r !== null) config.radius = r; else issues.push({ path: 'radius', code: 'invalid_value' });
    }

    if (hasOwn(input, 'fontFamily') && input.fontFamily !== undefined && input.fontFamily !== null && input.fontFamily !== '') {
        const id = typeof input.fontFamily === 'string' ? input.fontFamily.trim().toLowerCase() : '';
        if (hasOwn(FONT_FAMILIES, id)) config.fontFamily = id; else issues.push({ path: 'fontFamily', code: 'invalid_value' });
    }

    if (hasOwn(input, 'allowedThemes') && input.allowedThemes !== undefined && input.allowedThemes !== null) {
        if (!Array.isArray(input.allowedThemes)) {
            issues.push({ path: 'allowedThemes', code: 'invalid_value' });
        } else {
            const ids: string[] = [];
            for (const raw of input.allowedThemes) {
                if (ids.length >= THEME_CONFIG_LIMITS.maxAllowedThemes) { issues.push({ path: 'allowedThemes', code: 'too_many' }); break; }
                const id = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
                if (!THEME_ID_RE.test(id) || id === 'system' || id.startsWith('brand-')) { issues.push({ path: 'allowedThemes', code: 'invalid_value' }); continue; }
                if (!ids.includes(id)) ids.push(id);
            }
            if (ids.length > 0) config.allowedThemes = ids;
        }
    }

    for (const f of ['lockBrand', 'autoFixContrast'] as const) {
        if (!hasOwn(input, f) || input[f] === undefined || input[f] === null) continue;
        if (typeof input[f] === 'boolean') rec[f] = input[f]; else issues.push({ path: f, code: 'invalid_value' });
    }

    if (hasOwn(input, 'landing') && input.landing !== undefined && input.landing !== null) {
        let landing: Record<string, unknown> | null | undefined = null;
        try {
            landing = opts.sanitizeLanding ? opts.sanitizeLanding(input.landing) : landingPassthrough(input.landing);
        } catch { landing = null; }
        if (landing && isPlainObject(landing)) config.landing = landing;
        else issues.push({ path: 'landing', code: 'landing_invalid' });
    }

    return { config, issues };
}

/** Version corta de validateThemeConfig: solo devuelve la configuracion limpia. */
export function sanitizeThemeConfig(input: unknown, opts: SanitizeOptions = {}): DomainThemeConfig {
    return validateThemeConfig(input, opts).config;
}

// ---------------------------------------------------------------------------
// Consultas sobre una configuracion YA saneada
// ---------------------------------------------------------------------------

/** true si la empresa define algun color (campo antiguo o palette): hay que generar temas de empresa. */
export function hasBrandConfig(cfg: DomainThemeConfig | null | undefined): boolean {
    if (!cfg || typeof cfg !== 'object') return false;
    for (const f of LEGACY_COLOR_FIELDS) if (typeof (cfg as Record<string, unknown>)[f] === 'string') return true;
    const p = cfg.palette;
    return !!p && (Object.keys(p.light ?? {}).length > 0 || Object.keys(p.dark ?? {}).length > 0);
}

/** Radio base en rem (0-3) o null si la empresa no lo definio. */
export function resolveRadiusRem(cfg: DomainThemeConfig | null | undefined): number | null {
    const r = cfg ? toRadius(cfg.radius) : null;
    if (r === null) return null;
    return typeof r === 'number' ? r : RADIUS_PRESETS_REM[r];
}

/** Stack CSS de una familia de la lista blanca, o null. */
export function resolveFontStack(id: unknown): string | null {
    if (typeof id !== 'string') return null;
    const k = id.trim().toLowerCase();
    return hasOwn(FONT_FAMILIES, k) ? FONT_FAMILIES[k].stack : null;
}

/** Stack CSS de un nombre de fuente legado (titleFont/bodyFont): nombre alfanumerico entre comillas + fallback. */
export function legacyFontStack(name: unknown): string | null {
    if (typeof name !== 'string') return null;
    const n = name.trim();
    return SAFE_FONT_NAME_RE.test(n) ? `"${n}",system-ui,sans-serif` : null;
}
