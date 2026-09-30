/**
 * Modelo PURO del editor de tema (sin React): documento editable, mutaciones inmutables, generador "desde 3 colores",
 * importar/exportar, avisos de contraste con correccion propuesta y construccion del payload de guardado.
 *
 * Regla de oro: el editor trabaja SIEMPRE sobre `theme.palette` (por modo). Los campos antiguos de color se migran
 * al cargar (migrateLegacyTheme, mismo resultado visual) y no se vuelven a emitir.
 */
import { backgroundScheme } from '@/lib/color';
import {
    analyzeBrandTheme, buildBrandThemes, deriveFullPaletteDetailed, harmonicBackground, migrateLegacyTheme,
    type PaletteWarning,
} from '@/lib/brand-theme';
import {
    ALPHA_TOKENS, FONT_FAMILIES, THEME_CONFIG_LIMITS, TOKEN_KEYS, hasBrandConfig, normalizeThemeHex, validateThemeConfig,
    type DomainThemeConfig, type ThemeConfigIssue, type ThemeMode, type ThemePaletteMode, type TokenKey,
} from '@/lib/theme-config';
import { getTheme, type ThemeTokens } from '@/lib/themes';
import { sanitizeLandingConfig, sanitizeLandingConfigDetailed, type LandingConfig, type LandingIssue } from '@/lib/landing-config';

// ---------------------------------------------------------------------------
// Documento
// ---------------------------------------------------------------------------

export interface EditorDoc {
    displayName: string;
    /** Domain.logo: icono de la pestana (favicon) y logo de respaldo. Vacio = sin logo. */
    logo: string;
    theme: DomainThemeConfig;
}

export const EMPTY_DOC: EditorDoc = { displayName: '', logo: '', theme: {} };

const landingSanitizer = (input: unknown) => sanitizeLandingConfig(input) as Record<string, unknown>;

/** Mapa de fuentes antiguas (titleFont/bodyFont) a ids de la lista blanca. */
const LEGACY_FONT_TO_ID: Record<string, string> = { inter: 'inter' };

/** Construye el documento a partir de la respuesta de GET /api/admin/domain. Nunca lanza. */
export function docFromDomain(data: unknown): EditorDoc {
    const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const rawTheme = validateThemeConfig(d.theme, { sanitizeLanding: landingSanitizer }).config;
    const theme = migrateLegacyTheme(rawTheme);
    // Tipografia antigua: si ambas fuentes equivalen a un id de la lista blanca se migra; si no, se conserva tal cual.
    if (!theme.fontFamily) {
        const t = (theme.titleFont ?? theme.bodyFont ?? '').toLowerCase();
        const sameFont = (theme.titleFont ?? '').toLowerCase() === (theme.bodyFont ?? '').toLowerCase();
        if (t && sameFont && LEGACY_FONT_TO_ID[t]) {
            theme.fontFamily = LEGACY_FONT_TO_ID[t];
            delete theme.titleFont;
            delete theme.bodyFont;
        }
    }
    const displayName = typeof d.displayName === 'string' && d.displayName ? d.displayName : typeof d.name === 'string' ? d.name : '';
    return { displayName, logo: typeof d.logo === 'string' ? d.logo : '', theme };
}

// ---------------------------------------------------------------------------
// Mutaciones inmutables
// ---------------------------------------------------------------------------

function cleanPalette(theme: DomainThemeConfig): DomainThemeConfig {
    const p = theme.palette;
    if (!p) return theme;
    const next: NonNullable<DomainThemeConfig['palette']> = {};
    if (p.light && Object.keys(p.light).length) next.light = p.light;
    if (p.dark && Object.keys(p.dark).length) next.dark = p.dark;
    const out = { ...theme };
    if (next.light || next.dark) out.palette = next; else delete out.palette;
    return out;
}

/** Fija (o, con null, elimina = "derivado") el valor explicito de un token en un modo. Valor invalido: sin cambios. */
export function setTokenValue(doc: EditorDoc, mode: ThemeMode, token: TokenKey, value: string | null): EditorDoc {
    const current = { ...(doc.theme.palette?.[mode] ?? {}) };
    if (value === null) {
        delete current[token];
    } else {
        const hex = normalizeThemeHex(value, (ALPHA_TOKENS as readonly string[]).includes(token));
        if (!hex) return doc;
        current[token] = hex;
    }
    const theme = cleanPalette({ ...doc.theme, palette: { ...(doc.theme.palette ?? {}), [mode]: current } });
    return { ...doc, theme };
}

/** Sustituye la paleta de un modo (p. ej. "restablecer modo"). */
export function setModePalette(doc: EditorDoc, mode: ThemeMode, palette: ThemePaletteMode | null): EditorDoc {
    const theme = { ...doc.theme, palette: { ...(doc.theme.palette ?? {}) } };
    if (palette && Object.keys(palette).length) theme.palette[mode] = palette; else delete theme.palette[mode];
    return { ...doc, theme: cleanPalette(theme) };
}

/** Aplica cambios al tema; una clave con valor undefined se elimina. */
export function patchTheme(doc: EditorDoc, patch: Partial<Record<keyof DomainThemeConfig, unknown>>): EditorDoc {
    const theme = { ...doc.theme } as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === null || v === '') delete theme[k]; else theme[k] = v;
    }
    return { ...doc, theme: theme as DomainThemeConfig };
}

/** Sustituye theme.landing (vacio = se elimina). */
export function setLanding(doc: EditorDoc, landing: LandingConfig | Record<string, unknown> | null | undefined): EditorDoc {
    const theme = { ...doc.theme };
    if (landing && Object.keys(landing).length) theme.landing = landing as Record<string, unknown>; else delete theme.landing;
    return { ...doc, theme };
}

export function getLanding(doc: EditorDoc): LandingConfig {
    return (doc.theme.landing ?? {}) as LandingConfig;
}

/** Restablecer a valores por defecto: colores, tipografia, forma y politica. Conserva landing y logos. */
export function resetThemeDefaults(doc: EditorDoc): EditorDoc {
    const theme: DomainThemeConfig = {};
    if (doc.theme.landing) theme.landing = doc.theme.landing;
    return { ...doc, theme };
}

// ---------------------------------------------------------------------------
// Tokens: grupos, valores efectivos, estado derivado/explicito
// ---------------------------------------------------------------------------

export const TOKEN_GROUPS: readonly { id: string; tokens: readonly TokenKey[] }[] = [
    { id: 'surfaces', tokens: ['background', 'card', 'card-foreground', 'popover', 'popover-foreground', 'muted', 'secondary', 'secondary-foreground', 'accent', 'accent-foreground'] },
    { id: 'text', tokens: ['foreground', 'muted-foreground'] },
    { id: 'brand', tokens: ['primary', 'primary-foreground', 'brand-accent', 'brand-accent-foreground'] },
    { id: 'states', tokens: ['destructive', 'destructive-foreground', 'success', 'success-foreground', 'warning', 'warning-foreground', 'info', 'info-foreground'] },
    { id: 'borders', tokens: ['border', 'input', 'ring'] },
    { id: 'chrome', tokens: ['sidebar', 'sidebar-foreground', 'sidebar-accent', 'sidebar-accent-foreground', 'sidebar-border', 'header', 'header-foreground'] },
    { id: 'inbox', tokens: ['unread', 'unread-foreground', 'row-hover', 'row-selected', 'row-selected-foreground', 'chip', 'chip-foreground'] },
    { id: 'links', tokens: ['link', 'link-hover', 'code', 'code-foreground'] },
    { id: 'overlay', tokens: ['overlay', 'selection', 'selection-foreground', 'scrollbar'] },
];

export function isAlphaToken(token: TokenKey): boolean {
    return (ALPHA_TOKENS as readonly string[]).includes(token);
}

export function hasColors(theme: DomainThemeConfig): boolean {
    return hasBrandConfig(theme);
}

/** Tokens efectivos de un modo (los que se aplicaran: derivados + explicitos ya corregidos). Sin colores: tema generico. */
export function resolveTokens(theme: DomainThemeConfig, mode: ThemeMode, name?: string): ThemeTokens {
    const brand = buildBrandThemes(theme, { name });
    return (brand ? brand[mode] : getTheme(mode)!).tokens;
}

export function explicitValue(theme: DomainThemeConfig, mode: ThemeMode, token: TokenKey): string | undefined {
    return theme.palette?.[mode]?.[token];
}

export function explicitCount(theme: DomainThemeConfig, mode: ThemeMode): number {
    return Object.keys(theme.palette?.[mode] ?? {}).length;
}

// ---------------------------------------------------------------------------
// Generador "Desde 3 colores"
// ---------------------------------------------------------------------------

export interface ThreeColors { primary: string; background: string; text?: string }

/**
 * Desde primario + fondo + texto: rellena AMBOS modos con primary/background/foreground (los demas tokens se derivan).
 * El fondo se respeta en el modo de su esquema; el otro modo usa el fondo armonico (mismo matiz, luminosidad invertida).
 * Los valores guardados son los ya corregidos por deriveFullPalette: cumplen AA en ambos modos. null si algun color es invalido.
 */
export function paletteFromThree(input: ThreeColors): { light: ThemePaletteMode; dark: ThemePaletteMode } | null {
    const primary = normalizeThemeHex(input.primary);
    const background = normalizeThemeHex(input.background);
    const text = input.text ? normalizeThemeHex(input.text) : null;
    if (!primary || !background || (input.text && !text)) return null;
    const scheme = backgroundScheme(background);
    const other: ThemeMode = scheme === 'light' ? 'dark' : 'light';
    const base: Record<ThemeMode, Partial<Record<TokenKey, string>>> = {
        light: {}, dark: {},
    };
    base[scheme] = { primary, background, ...(text ? { foreground: text } : {}) };
    base[other] = { primary, background: harmonicBackground(background, other, primary) };
    const out = { light: {} as ThemePaletteMode, dark: {} as ThemePaletteMode };
    for (const m of ['light', 'dark'] as const) {
        const { tokens } = deriveFullPaletteDetailed(base[m], m, { autoFix: true });
        out[m] = { primary: tokens.primary, background: tokens.background, foreground: tokens.foreground };
    }
    return out;
}

/** Aplica el generador: sustituye la paleta de ambos modos (conserva landing, forma y politica). */
export function applyThreeColors(doc: EditorDoc, input: ThreeColors): EditorDoc | null {
    const p = paletteFromThree(input);
    if (!p) return null;
    return { ...doc, theme: cleanPalette({ ...doc.theme, palette: p }) };
}

/** Los 3 colores actuales (para precargar el generador): valores efectivos del modo indicado. */
export function currentThree(theme: DomainThemeConfig, mode: ThemeMode): ThreeColors {
    const t = resolveTokens(theme, mode);
    return { primary: t.primary, background: t.background, text: t.foreground };
}

// ---------------------------------------------------------------------------
// Presets de empresa
// ---------------------------------------------------------------------------

export interface ThemePreset {
    id: string;
    colors: ThreeColors;
    radius: 'none' | 'sm' | 'md' | 'lg' | 'xl';
    fontFamily: keyof typeof FONT_FAMILIES;
    defaultMode: 'light' | 'dark' | 'system';
}

export const PRESETS: readonly ThemePreset[] = [
    { id: 'corporateBlue', colors: { primary: '#1d4ed8', background: '#f8fafc', text: '#0f172a' }, radius: 'md', fontFamily: 'inter', defaultMode: 'system' },
    { id: 'emerald', colors: { primary: '#047857', background: '#f0fdf4', text: '#052e16' }, radius: 'lg', fontFamily: 'humanist', defaultMode: 'light' },
    { id: 'violet', colors: { primary: '#6d28d9', background: '#faf5ff', text: '#2e1065' }, radius: 'xl', fontFamily: 'rounded', defaultMode: 'system' },
    { id: 'crimson', colors: { primary: '#b91c1c', background: '#fff7f7', text: '#450a0a' }, radius: 'sm', fontFamily: 'geometric', defaultMode: 'light' },
    { id: 'graphite', colors: { primary: '#111827', background: '#ffffff', text: '#111827' }, radius: 'none', fontFamily: 'system', defaultMode: 'light' },
    { id: 'sand', colors: { primary: '#b45309', background: '#fffbeb', text: '#451a03' }, radius: 'md', fontFamily: 'serif', defaultMode: 'light' },
    { id: 'oceanNight', colors: { primary: '#22d3ee', background: '#0b1220', text: '#e2e8f0' }, radius: 'lg', fontFamily: 'inter', defaultMode: 'dark' },
    { id: 'rose', colors: { primary: '#be185d', background: '#fff1f2', text: '#4c0519' }, radius: 'xl', fontFamily: 'rounded', defaultMode: 'system' },
];

/** Aplica un preset: paleta de ambos modos + forma + tipografia + modo inicial. Conserva landing, politica y logos. */
export function applyPreset(doc: EditorDoc, preset: ThemePreset): EditorDoc {
    const withColors = applyThreeColors(doc, preset.colors) ?? doc;
    const next = patchTheme(withColors, { radius: preset.radius, fontFamily: preset.fontFamily, defaultMode: preset.defaultMode });
    delete next.theme.titleFont;
    delete next.theme.bodyFont;
    return next;
}

// ---------------------------------------------------------------------------
// Avisos de contraste
// ---------------------------------------------------------------------------

export function analyze(theme: DomainThemeConfig): PaletteWarning[] {
    return hasColors(theme) ? analyzeBrandTheme(theme) : [];
}

/** Valor corregido que el motor propone para ese aviso (siempre calculado con autoFix, aunque el interruptor este apagado). */
export function proposedFix(theme: DomainThemeConfig, w: PaletteWarning): string | null {
    if (w.reason === 'scheme') return null; // se corrige quitando el valor (derivado)
    const fixed = buildBrandThemes({ ...theme, autoFixContrast: true });
    return fixed ? fixed[w.mode].tokens[w.token] : null;
}

/** Aplica la correccion de un aviso: fija el valor corregido (o, para 'scheme', vuelve a derivado). */
export function applyFix(doc: EditorDoc, w: PaletteWarning): EditorDoc {
    if (w.reason === 'scheme') return setTokenValue(doc, w.mode, w.token, null);
    const value = proposedFix(doc.theme, w);
    return value ? setTokenValue(doc, w.mode, w.token, value) : doc;
}

/** Aplica todas las correcciones pendientes (un aviso por par modo/token; iterando hasta 3 veces por dependencias). */
export function applyAllFixes(doc: EditorDoc): EditorDoc {
    let cur = doc;
    for (let i = 0; i < 3; i++) {
        const pending = analyze(cur.theme).filter((w) => w.reason === 'scheme' || !w.ok || w.corrected);
        if (!pending.length) break;
        const seen = new Set<string>();
        for (const w of pending) {
            const k = `${w.mode}:${w.token}`;
            if (seen.has(k)) continue;
            seen.add(k);
            cur = applyFix(cur, w);
        }
    }
    return cur;
}

// ---------------------------------------------------------------------------
// Importar / exportar
// ---------------------------------------------------------------------------

export function exportTheme(doc: EditorDoc): string {
    const { config } = validateThemeConfig(doc.theme, { sanitizeLanding: landingSanitizer });
    return JSON.stringify(config, null, 2);
}

export type ImportResult =
    | { ok: true; theme: DomainThemeConfig; issues: ThemeConfigIssue[] }
    | { ok: false; reason: 'empty' | 'too_large' | 'invalid_json' | 'not_object' | 'nothing_valid'; issues: ThemeConfigIssue[] };

/** Importa un JSON de tema. Entrada hostil: nunca lanza; solo pasa lo que sanea el validador compartido. */
export function importTheme(text: string): ImportResult {
    const raw = typeof text === 'string' ? text.trim() : '';
    if (!raw) return { ok: false, reason: 'empty', issues: [] };
    if (raw.length > THEME_CONFIG_LIMITS.maxInputJson) return { ok: false, reason: 'too_large', issues: [] };
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return { ok: false, reason: 'invalid_json', issues: [] }; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'not_object', issues: [] };
    // Admite el envoltorio { theme: {...} } (lo que devuelve GET /api/admin/domain).
    const rec = parsed as Record<string, unknown>;
    if (rec.theme && typeof rec.theme === 'object' && !Array.isArray(rec.theme) && !('palette' in rec)) parsed = rec.theme;
    const { config, issues } = validateThemeConfig(parsed, { sanitizeLanding: landingSanitizer });
    if (issues.some((i) => i.code === 'too_large')) return { ok: false, reason: 'too_large', issues };
    if (issues.some((i) => i.code === 'not_object')) return { ok: false, reason: 'not_object', issues };
    if (Object.keys(config).length === 0) return { ok: false, reason: 'nothing_valid', issues };
    return { ok: true, theme: migrateLegacyTheme(config), issues };
}

/** Aplica un tema importado; si el JSON no trae landing se conserva la actual. */
export function applyImported(doc: EditorDoc, theme: DomainThemeConfig): EditorDoc {
    const next: DomainThemeConfig = { ...theme };
    if (!next.landing && doc.theme.landing) next.landing = doc.theme.landing;
    return { ...doc, theme: next };
}

// ---------------------------------------------------------------------------
// Validacion y payload de guardado
// ---------------------------------------------------------------------------

export const LOGO_MAX_LENGTH = 2048;

/** URL de imagen permitida por el editor: https, sin espacios, <= 2048. '' es valido (sin logo). */
export function validateHttpsUrl(value: string): 'ok' | 'not_https' | 'invalid' | 'too_long' {
    const v = value.trim();
    if (!v) return 'ok';
    if (v.length > LOGO_MAX_LENGTH) return 'too_long';
    if (/\s/.test(v)) return 'invalid';
    if (!/^https:\/\//i.test(v)) return 'not_https';
    try { return new URL(v).protocol === 'https:' ? 'ok' : 'not_https'; } catch { return 'invalid'; }
}

export interface FieldErrors { [path: string]: string }

export interface SaveCheck {
    payload: { displayName: string; logo: string; theme: DomainThemeConfig };
    /** Errores por campo (clave = ruta: logo, displayName, palette.dark.primary, landing.logo.light...). */
    errors: FieldErrors;
    /** Avisos no bloqueantes (el saneador descarta algo, p. ej. una clave desconocida). */
    warnings: FieldErrors;
    themeIssues: ThemeConfigIssue[];
    landingIssues: LandingIssue[];
    /** true si hay algo que impide guardar. */
    blocked: boolean;
}

const BLOCKING_LANDING: LandingIssue['code'][] = ['too_large'];

/** Comprueba el documento como lo haria el servidor y construye el payload EXACTO que se enviara. */
export function checkForSave(doc: EditorDoc): SaveCheck {
    const errors: FieldErrors = {};
    const warnings: FieldErrors = {};
    const { config, issues: themeIssues } = validateThemeConfig(doc.theme, { sanitizeLanding: landingSanitizer });
    const landingIssues = sanitizeLandingConfigDetailed(doc.theme.landing ?? {}).issues;

    const displayName = doc.displayName.trim();
    if (displayName.length > 120) errors.displayName = 'tooLong';
    const logo = doc.logo.trim();
    const logoState = validateHttpsUrl(logo);
    if (logoState !== 'ok') errors.logo = logoState;

    for (const i of themeIssues) {
        if (i.code === 'too_large' || i.code === 'not_object') errors[i.path || 'theme'] = i.code;
        else warnings[i.path || 'theme'] = i.code;
    }
    for (const i of landingIssues) {
        const path = `landing.${i.path}`;
        if (BLOCKING_LANDING.includes(i.code)) errors[path] = i.code; else warnings[path] = i.code;
    }
    return {
        payload: { displayName, logo, theme: config },
        errors, warnings, themeIssues, landingIssues,
        blocked: Object.keys(errors).length > 0,
    };
}

/** Forma canonica (claves ordenadas) del documento saneado: base de la comparacion "sucio". */
export function canonicalDoc(doc: EditorDoc): string {
    const c = checkForSave(doc).payload;
    const sort = (v: unknown): unknown => {
        if (Array.isArray(v)) return v.map(sort);
        if (v && typeof v === 'object') {
            const o = v as Record<string, unknown>;
            return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sort(o[k])]));
        }
        return v;
    };
    return JSON.stringify(sort(c));
}

export function isDirty(doc: EditorDoc, baseline: EditorDoc): boolean {
    return canonicalDoc(doc) !== canonicalDoc(baseline);
}

// ---------------------------------------------------------------------------
// Historial (deshacer / rehacer)
// ---------------------------------------------------------------------------

export interface HistoryState {
    present: EditorDoc;
    past: EditorDoc[];
    future: EditorDoc[];
    /** Clave y hora del ultimo cambio: los cambios seguidos con la misma clave se funden en un solo paso. */
    key: string | null;
    at: number;
}

export type HistoryAction =
    | { type: 'set'; doc: EditorDoc; key?: string; at?: number }
    | { type: 'undo' }
    | { type: 'redo' }
    | { type: 'load'; doc: EditorDoc };

export const HISTORY_LIMIT = 100;
export const COALESCE_MS = 900;

export function initHistory(doc: EditorDoc = EMPTY_DOC): HistoryState {
    return { present: doc, past: [], future: [], key: null, at: 0 };
}

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
    switch (action.type) {
        case 'load':
            return initHistory(action.doc);
        case 'set': {
            if (action.doc === state.present) return state;
            const at = action.at ?? Date.now();
            const merge = !!action.key && action.key === state.key && at - state.at < COALESCE_MS && state.past.length > 0;
            const past = merge ? state.past : [...state.past, state.present].slice(-HISTORY_LIMIT);
            return { present: action.doc, past, future: [], key: action.key ?? null, at };
        }
        case 'undo': {
            if (!state.past.length) return state;
            const prev = state.past[state.past.length - 1];
            return { present: prev, past: state.past.slice(0, -1), future: [state.present, ...state.future], key: null, at: 0 };
        }
        case 'redo': {
            if (!state.future.length) return state;
            const [next, ...rest] = state.future;
            return { present: next, past: [...state.past, state.present], future: rest, key: null, at: 0 };
        }
    }
}

export { TOKEN_KEYS };
