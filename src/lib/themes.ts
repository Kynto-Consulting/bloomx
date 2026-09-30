/**
 * REGISTRO UNICO DE TEMAS / PALETAS DE BLOOMX
 * ------------------------------------------------------------------
 * Esta es la unica fuente de verdad de los colores de la aplicacion.
 * De aqui salen:
 *   - el CSS por tema que se inyecta en <head> desde layout.tsx (sin FOUC),
 *   - el script bloqueante que resuelve el tema antes del primer pintado,
 *   - la lista del selector de Settings (Apariencia),
 *   - el script de contraste (scripts/check-theme-contrast.ts).
 *
 * Los componentes NUNCA deben usar hex ni clases de paleta (bg-white,
 * text-gray-500, ...): solo tokens semanticos (bg-background, text-foreground,
 * text-muted-foreground, border-border, bg-primary, text-destructive, ...).
 * Los nombres de token coinciden con los utilitarios de Tailwind v4 porque
 * globals.css los declara con @theme (--color-<token>).
 *
 * Reglas de contraste (WCAG 2.1 AA) que verifica scripts/check-theme-contrast.ts:
 *   - foreground / card / popover / *-foreground sobre su superficie >= 4.5
 *   - muted-foreground sobre background, card y muted >= 4.5
 *   - primary, destructive, success, warning, info (como texto) sobre background y card >= 4.5
 *   - X-foreground sobre X (botones solidos) >= 4.5
 *   - input (borde de controles) y ring (foco) sobre background >= 3.0
 */

import { contrast, ensureContrast, mix, normalizeHex, readableOn } from './color';
import {
    TOKEN_KEYS, hasBrandConfig, sanitizeThemeConfig,
    type DomainThemeConfig, type ThemeDefaultMode, type TokenKey,
} from './theme-config';

// El modelo de empresa y el registro de tokens viven en theme-config.ts (modulo compartido con el backend).
export { TOKEN_KEYS };
export type { DomainThemeConfig, TokenKey };

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type ThemeTokens = Record<TokenKey, string>;
export type ColorScheme = 'light' | 'dark';

export interface ThemeDefinition {
    id: string;
    label: string;
    description: string;
    scheme: ColorScheme;
    /** Si es true, los colores de marca del dominio (config.theme) se superponen a este tema (applyBrand, legado). */
    brandable: boolean;
    /** true en los temas de empresa generados (brand-light / brand-dark, ver brand-theme.ts). */
    brand?: boolean;
    tokens: ThemeTokens;
}

// ---------------------------------------------------------------------------
// Temas
// ---------------------------------------------------------------------------

const light: ThemeDefinition = {
    id: 'light',
    label: 'Claro',
    description: 'Tema por defecto. Usa los colores de marca de tu dominio.',
    scheme: 'light',
    brandable: true,
    tokens: {
        'background': '#ffffff', 'foreground': '#09090b',
        'card': '#ffffff', 'card-foreground': '#09090b',
        'popover': '#ffffff', 'popover-foreground': '#09090b',
        'primary': '#18181b', 'primary-foreground': '#fafafa',
        'secondary': '#e9e9ec', 'secondary-foreground': '#18181b',
        'muted': '#f4f4f5', 'muted-foreground': '#52525b',
        'accent': '#f0f0f2', 'accent-foreground': '#18181b',
        'destructive': '#b91c1c', 'destructive-foreground': '#ffffff',
        'success': '#15803d', 'success-foreground': '#ffffff',
        'warning': '#b45309', 'warning-foreground': '#ffffff',
        'info': '#1d4ed8', 'info-foreground': '#ffffff',
        'border': '#e4e4e7', 'input': '#8f8f98', 'ring': '#2563eb',
        'brand-accent': '#4f46e5', 'brand-accent-foreground': '#ffffff',
        'sidebar': '#f8f8f8', 'sidebar-foreground': '#09090b', 'sidebar-accent': '#dddddd', 'sidebar-accent-foreground': '#09090b', 'sidebar-border': '#dbdbdc',
        'header': '#ffffff', 'header-foreground': '#09090b',
        'unread': '#f3f3f4', 'unread-foreground': '#09090b', 'row-hover': '#f4f4f4',
        'row-selected': '#dfdfdf', 'row-selected-foreground': '#09090b',
        'link': '#4f46e5', 'link-hover': '#3a34a4',
        'code': '#eeeeee', 'code-foreground': '#09090b',
        'overlay': '#26262673',
        'chip': '#e3e3e4', 'chip-foreground': '#18181b',
        'selection': '#bababb', 'selection-foreground': '#09090b',
        'scrollbar': '#bababb',
    },
};

const dark: ThemeDefinition = {
    id: 'dark',
    label: 'Oscuro',
    description: 'Gris carbon neutro. Usa los colores de marca de tu dominio.',
    scheme: 'dark',
    brandable: true,
    tokens: {
        'background': '#0f1115', 'foreground': '#e8eaed',
        'card': '#171a20', 'card-foreground': '#e8eaed',
        'popover': '#1b1f26', 'popover-foreground': '#e8eaed',
        'primary': '#e8eaed', 'primary-foreground': '#0f1115',
        'secondary': '#2a2f39', 'secondary-foreground': '#e8eaed',
        'muted': '#1e222a', 'muted-foreground': '#a3aab8',
        'accent': '#252a34', 'accent-foreground': '#e8eaed',
        'destructive': '#f87171', 'destructive-foreground': '#1a0505',
        'success': '#4ade80', 'success-foreground': '#04210e',
        'warning': '#fbbf24', 'warning-foreground': '#231600',
        'info': '#60a5fa', 'info-foreground': '#04152e',
        'border': '#2b303a', 'input': '#5d6677', 'ring': '#7aa2ff',
        'brand-accent': '#818cf8', 'brand-accent-foreground': '#0f1115',
        'sidebar': '#0b0d10', 'sidebar-foreground': '#e8eaed', 'sidebar-accent': '#2d2f32', 'sidebar-accent-foreground': '#e8eaed', 'sidebar-border': '#2e3033',
        'header': '#171a20', 'header-foreground': '#e8eaed',
        'unread': '#25272b', 'unread-foreground': '#e8eaed', 'row-hover': '#1c1e22',
        'row-selected': '#333539', 'row-selected-foreground': '#e8eaed',
        'link': '#818cf8', 'link-hover': '#a0a8f5',
        'code': '#292b2f', 'code-foreground': '#e8eaed',
        'overlay': '#050506b3',
        'chip': '#3f4145', 'chip-foreground': '#e8eaed',
        'selection': '#4c4e51', 'selection-foreground': '#e8eaed',
        'scrollbar': '#595b5e',
    },
};

const midnight: ThemeDefinition = {
    id: 'midnight',
    label: 'Medianoche',
    description: 'Azul marino profundo, suave para la vista.',
    scheme: 'dark',
    brandable: false,
    tokens: {
        'background': '#0a1224', 'foreground': '#e6ecfa',
        'card': '#111b33', 'card-foreground': '#e6ecfa',
        'popover': '#142040', 'popover-foreground': '#e6ecfa',
        'primary': '#7cb1ff', 'primary-foreground': '#04122b',
        'secondary': '#1f2d52', 'secondary-foreground': '#e6ecfa',
        'muted': '#16213f', 'muted-foreground': '#a3b3d6',
        'accent': '#1b2a4d', 'accent-foreground': '#e6ecfa',
        'destructive': '#ff8a8a', 'destructive-foreground': '#2b0505',
        'success': '#5eea9c', 'success-foreground': '#04210e',
        'warning': '#ffc94d', 'warning-foreground': '#231600',
        'info': '#7cc4ff', 'info-foreground': '#04152e',
        'border': '#26365f', 'input': '#5f76a8', 'ring': '#7cb1ff',
        'brand-accent': '#a5b4fc', 'brand-accent-foreground': '#0a1224',
        'sidebar': '#080e1b', 'sidebar-foreground': '#e6ecfa', 'sidebar-accent': '#22324d', 'sidebar-accent-foreground': '#e6ecfa', 'sidebar-border': '#2c323f',
        'header': '#111b33', 'header-foreground': '#e6ecfa',
        'unread': '#15223a', 'unread-foreground': '#e6ecfa', 'row-hover': '#171f31',
        'row-selected': '#253859', 'row-selected-foreground': '#e6ecfa',
        'link': '#7cb1ff', 'link-hover': '#9cc3fe',
        'code': '#242c3e', 'code-foreground': '#e6ecfa',
        'overlay': '#03050bb3',
        'chip': '#233554', 'chip-foreground': '#7cb1ff',
        'selection': '#38527c', 'selection-foreground': '#e6ecfa',
        'scrollbar': '#555c6d',
    },
};

const amoled: ThemeDefinition = {
    id: 'amoled',
    label: 'Negro AMOLED',
    description: 'Negro puro para pantallas OLED y maximo ahorro de bateria.',
    scheme: 'dark',
    brandable: false,
    tokens: {
        'background': '#000000', 'foreground': '#f5f5f5',
        'card': '#0a0a0a', 'card-foreground': '#f5f5f5',
        'popover': '#111111', 'popover-foreground': '#f5f5f5',
        'primary': '#f5f5f5', 'primary-foreground': '#000000',
        'secondary': '#1f1f1f', 'secondary-foreground': '#f5f5f5',
        'muted': '#141414', 'muted-foreground': '#a8a8a8',
        'accent': '#1a1a1a', 'accent-foreground': '#f5f5f5',
        'destructive': '#ff7b7b', 'destructive-foreground': '#1a0000',
        'success': '#4ade80', 'success-foreground': '#04210e',
        'warning': '#fbbf24', 'warning-foreground': '#231600',
        'info': '#60a5fa', 'info-foreground': '#04152e',
        'border': '#2a2a2a', 'input': '#6b6b6b', 'ring': '#8ab4ff',
        'brand-accent': '#a5b4fc', 'brand-accent-foreground': '#000000',
        'sidebar': '#000000', 'sidebar-foreground': '#f5f5f5', 'sidebar-accent': '#363636', 'sidebar-accent-foreground': '#f5f5f5', 'sidebar-border': '#272727',
        'header': '#0a0a0a', 'header-foreground': '#f5f5f5',
        'unread': '#191919', 'unread-foreground': '#f5f5f5', 'row-hover': '#0f0f0f',
        'row-selected': '#292929', 'row-selected-foreground': '#f5f5f5',
        'link': '#a5b4fc', 'link-hover': '#bdc8fa',
        'code': '#1d1d1d', 'code-foreground': '#f5f5f5',
        'overlay': '#000000b3',
        'chip': '#363636', 'chip-foreground': '#f5f5f5',
        'selection': '#626262', 'selection-foreground': '#f5f5f5',
        'scrollbar': '#535353',
    },
};

const ocean: ThemeDefinition = {
    id: 'ocean',
    label: 'Oceano',
    description: 'Claro con acentos turquesa.',
    scheme: 'light',
    brandable: false,
    tokens: {
        'background': '#f2f9fb', 'foreground': '#0b2a33',
        'card': '#ffffff', 'card-foreground': '#0b2a33',
        'popover': '#ffffff', 'popover-foreground': '#0b2a33',
        'primary': '#0e7490', 'primary-foreground': '#ffffff',
        'secondary': '#d6ecf2', 'secondary-foreground': '#0b2a33',
        'muted': '#e4f2f6', 'muted-foreground': '#3f636e',
        'accent': '#dceff4', 'accent-foreground': '#0b2a33',
        'destructive': '#b91c1c', 'destructive-foreground': '#ffffff',
        'success': '#15803d', 'success-foreground': '#ffffff',
        'warning': '#b45309', 'warning-foreground': '#ffffff',
        'info': '#0369a1', 'info-foreground': '#ffffff',
        'border': '#cfe3ea', 'input': '#6a919d', 'ring': '#0e7490',
        'brand-accent': '#0369a1', 'brand-accent-foreground': '#ffffff',
        'sidebar': '#ebf3f5', 'sidebar-foreground': '#0b2a33', 'sidebar-accent': '#d8e8ed', 'sidebar-accent-foreground': '#0b2a33', 'sidebar-border': '#d0dbde',
        'header': '#ffffff', 'header-foreground': '#0b2a33',
        'unread': '#e7f2f6', 'unread-foreground': '#0b2a33', 'row-hover': '#e8f0f2',
        'row-selected': '#d2e6ec', 'row-selected-foreground': '#0b2a33',
        'link': '#0e7490', 'link-hover': '#0d5e74',
        'code': '#e2ebed', 'code-foreground': '#0b2a33',
        'overlay': '#24252673',
        'chip': '#d7e9ee', 'chip-foreground': '#0b2a33',
        'selection': '#aed1db', 'selection-foreground': '#0b2a33',
        'scrollbar': '#b1bfc3',
    },
};

const forest: ThemeDefinition = {
    id: 'forest',
    label: 'Bosque',
    description: 'Claro con verdes naturales.',
    scheme: 'light',
    brandable: false,
    tokens: {
        'background': '#f4f7f2', 'foreground': '#14231a',
        'card': '#ffffff', 'card-foreground': '#14231a',
        'popover': '#ffffff', 'popover-foreground': '#14231a',
        'primary': '#166534', 'primary-foreground': '#ffffff',
        'secondary': '#dcebdc', 'secondary-foreground': '#14231a',
        'muted': '#e8f0e6', 'muted-foreground': '#48604f',
        'accent': '#e0ecde', 'accent-foreground': '#14231a',
        'destructive': '#b91c1c', 'destructive-foreground': '#ffffff',
        'success': '#15803d', 'success-foreground': '#ffffff',
        'warning': '#a16207', 'warning-foreground': '#ffffff',
        'info': '#1d4ed8', 'info-foreground': '#ffffff',
        'border': '#d3e0d0', 'input': '#76907c', 'ring': '#166534',
        'brand-accent': '#a16207', 'brand-accent-foreground': '#ffffff',
        'sidebar': '#edf1ec', 'sidebar-foreground': '#14231a', 'sidebar-accent': '#d3e0d6', 'sidebar-accent-foreground': '#14231a', 'sidebar-border': '#d3d8d3',
        'header': '#ffffff', 'header-foreground': '#14231a',
        'unread': '#e9f0e9', 'unread-foreground': '#14231a', 'row-hover': '#eaede8',
        'row-selected': '#d5e3d7', 'row-selected-foreground': '#14231a',
        'link': '#166534', 'link-hover': '#15512c',
        'code': '#e4e8e3', 'code-foreground': '#14231a',
        'overlay': '#25252473',
        'chip': '#d9e5db', 'chip-foreground': '#166534',
        'selection': '#b1cbb9', 'selection-foreground': '#14231a',
        'scrollbar': '#b5bcb6',
    },
};

const rose: ThemeDefinition = {
    id: 'rose',
    label: 'Rosa',
    description: 'Claro y calido con acentos rosa.',
    scheme: 'light',
    brandable: false,
    tokens: {
        'background': '#fff7f9', 'foreground': '#2a0f1a',
        'card': '#ffffff', 'card-foreground': '#2a0f1a',
        'popover': '#ffffff', 'popover-foreground': '#2a0f1a',
        'primary': '#be185d', 'primary-foreground': '#ffffff',
        'secondary': '#fbdbe6', 'secondary-foreground': '#2a0f1a',
        'muted': '#fdebf1', 'muted-foreground': '#6b4453',
        'accent': '#fce4ec', 'accent-foreground': '#2a0f1a',
        'destructive': '#b91c1c', 'destructive-foreground': '#ffffff',
        'success': '#15803d', 'success-foreground': '#ffffff',
        'warning': '#b45309', 'warning-foreground': '#ffffff',
        'info': '#1d4ed8', 'info-foreground': '#ffffff',
        'border': '#f3d3de', 'input': '#a97889', 'ring': '#be185d',
        'brand-accent': '#6d28d9', 'brand-accent-foreground': '#ffffff',
        'sidebar': '#f9f0f2', 'sidebar-foreground': '#2a0f1a', 'sidebar-accent': '#f2d6e0', 'sidebar-accent-foreground': '#2a0f1a', 'sidebar-border': '#e0d5d8',
        'header': '#ffffff', 'header-foreground': '#2a0f1a',
        'unread': '#fcecf1', 'unread-foreground': '#2a0f1a', 'row-hover': '#f5edef',
        'row-selected': '#f6d8e3', 'row-selected-foreground': '#2a0f1a',
        'link': '#be185d', 'link-hover': '#921549',
        'code': '#f0e7e9', 'code-foreground': '#2a0f1a',
        'overlay': '#26252573',
        'chip': '#f7dce6', 'chip-foreground': '#be185d',
        'selection': '#ecb4ca', 'selection-foreground': '#2a0f1a',
        'scrollbar': '#c3b6bb',
    },
};

const contrastTheme: ThemeDefinition = {
    id: 'contrast',
    label: 'Alto contraste',
    description: 'Blanco y negro con bordes marcados (accesibilidad AAA).',
    scheme: 'light',
    brandable: false,
    tokens: {
        'background': '#ffffff', 'foreground': '#000000',
        'card': '#ffffff', 'card-foreground': '#000000',
        'popover': '#ffffff', 'popover-foreground': '#000000',
        'primary': '#0033cc', 'primary-foreground': '#ffffff',
        'secondary': '#e6e6e6', 'secondary-foreground': '#000000',
        'muted': '#f0f0f0', 'muted-foreground': '#333333',
        'accent': '#e0e0e0', 'accent-foreground': '#000000',
        'destructive': '#a10000', 'destructive-foreground': '#ffffff',
        'success': '#005c1f', 'success-foreground': '#ffffff',
        'warning': '#7a3b00', 'warning-foreground': '#ffffff',
        'info': '#003a99', 'info-foreground': '#ffffff',
        'border': '#4d4d4d', 'input': '#333333', 'ring': '#0033cc',
        'brand-accent': '#5b1fa8', 'brand-accent-foreground': '#ffffff',
        'sidebar': '#ffffff', 'sidebar-foreground': '#000000', 'sidebar-accent': '#d9dff2', 'sidebar-accent-foreground': '#000000', 'sidebar-border': '#4d4d4d',
        'header': '#ffffff', 'header-foreground': '#000000',
        'unread': '#eef2ff', 'unread-foreground': '#000000', 'row-hover': '#e6e6e6',
        'row-selected': '#dbe2f8', 'row-selected-foreground': '#000000',
        'link': '#0033cc', 'link-hover': '#00248f',
        'code': '#e6e6e6', 'code-foreground': '#000000',
        'overlay': '#26262673',
        'chip': '#e0e7f9', 'chip-foreground': '#0033cc',
        'selection': '#99b0f5', 'selection-foreground': '#000000',
        'scrollbar': '#767676',
    },
};

/** Orden = orden de aparicion en el selector. */
export const THEMES: readonly ThemeDefinition[] = [
    light, dark, midnight, amoled, ocean, forest, rose, contrastTheme,
];

export const THEME_IDS = THEMES.map((t) => t.id);
export const DEFAULT_LIGHT_THEME = 'light';
export const DEFAULT_DARK_THEME = 'dark';

/** Ids de los temas de empresa generados por brand-theme.ts (siempre son "primera clase" si la empresa define colores). */
export const BRAND_THEME_IDS = ['brand-light', 'brand-dark'] as const;
export type BrandThemeId = typeof BRAND_THEME_IDS[number];

/** Preferencia del usuario: 'system' sigue prefers-color-scheme; el resto es el id de un tema (generico o de empresa). */
export type ThemePreference = 'system' | string;

export function getTheme(id: string | null | undefined): ThemeDefinition | undefined {
    return THEMES.find((t) => t.id === id);
}

/** Esquema de un id de tema conocido (generico o de empresa) sin necesidad de construir los temas de empresa. */
export function getThemeScheme(id: string | null | undefined): ColorScheme | undefined {
    if (id === 'brand-light') return 'light';
    if (id === 'brand-dark') return 'dark';
    return getTheme(id)?.scheme;
}

export function isThemePreference(value: unknown): value is ThemePreference {
    return value === 'system' || (typeof value === 'string' && (THEME_IDS.includes(value) || (BRAND_THEME_IDS as readonly string[]).includes(value)));
}

/** Resolucion SIN politica de empresa (comportamiento historico). */
export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): ThemeDefinition {
    if (pref === 'system') return getTheme(systemPrefersDark ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME)!;
    return getTheme(pref) ?? getTheme(DEFAULT_LIGHT_THEME)!;
}

// ---------------------------------------------------------------------------
// Politica de seleccion por empresa (allowedThemes / lockBrand / defaultMode)
// ---------------------------------------------------------------------------

export interface ThemePolicy {
    /** La empresa define colores => existen brand-light / brand-dark. */
    brand: boolean;
    /** Modo cuando el usuario aun no eligio tema. */
    defaultMode: ThemeDefaultMode;
    /** Ids genericos permitidos; null = todos. */
    allowed: string[] | null;
    /** Solo temas de empresa (solo efectivo si brand). */
    lock: boolean;
}

export const DEFAULT_THEME_POLICY: ThemePolicy = { brand: false, defaultMode: 'system', allowed: null, lock: false };

/** Politica de una configuracion de empresa (se sanea antes). Sin configuracion = comportamiento historico. */
export function getThemePolicy(cfgInput: unknown): ThemePolicy {
    const cfg = sanitizeThemeConfig(cfgInput);
    const brand = hasBrandConfig(cfg);
    const allowed = (cfg.allowedThemes ?? []).filter((id) => THEME_IDS.includes(id));
    return {
        brand,
        defaultMode: cfg.defaultMode ?? 'system',
        allowed: allowed.length > 0 ? allowed : null,
        lock: brand && cfg.lockBrand === true,
    };
}

/** Ids elegibles, en orden de aparicion: empresa primero, despues los genericos permitidos. */
export function getAvailableThemeIds(policy: ThemePolicy = DEFAULT_THEME_POLICY): string[] {
    const out: string[] = policy.brand ? [...BRAND_THEME_IDS] : [];
    if (policy.lock) return out;
    for (const t of THEMES) {
        if (policy.allowed && !policy.allowed.includes(t.id)) continue;
        // Con empresa, los genericos Claro/Oscuro sobran (ya estan los de la empresa) salvo que se listen expresamente.
        if (policy.brand && (t.id === DEFAULT_LIGHT_THEME || t.id === DEFAULT_DARK_THEME) && !(policy.allowed && policy.allowed.includes(t.id))) continue;
        out.push(t.id);
    }
    return out;
}

/** Tema por defecto de un esquema: el de empresa, o el primer generico permitido de ese esquema (o el primero permitido). */
export function fallbackThemeId(scheme: ColorScheme, policy: ThemePolicy = DEFAULT_THEME_POLICY): string {
    if (policy.brand) return scheme === 'dark' ? 'brand-dark' : 'brand-light';
    const ids = getAvailableThemeIds(policy);
    return ids.find((id) => getTheme(id)?.scheme === scheme) ?? ids[0] ?? (scheme === 'dark' ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME);
}

/**
 * Preferencia EFECTIVA a partir de la almacenada (cookie/localStorage/BD; null si nunca eligio):
 *   'system' | id concreto elegible. Una preferencia no elegible se sustituye por el tema por defecto
 *   de su mismo esquema (p. ej. 'dark' antiguo -> 'brand-dark' cuando la empresa define colores).
 */
export function resolvePreference(stored: string | null | undefined, policy: ThemePolicy = DEFAULT_THEME_POLICY): ThemePreference {
    if (isThemePreference(stored)) {
        if (stored === 'system') return 'system';
        if (getAvailableThemeIds(policy).includes(stored)) return stored;
        return fallbackThemeId(getThemeScheme(stored) ?? 'light', policy);
    }
    return policy.defaultMode === 'system' ? 'system' : fallbackThemeId(policy.defaultMode, policy);
}

/** Id del tema aplicado para una preferencia efectiva (resuelve 'system' con el SO). */
export function resolveThemeId(pref: ThemePreference, systemPrefersDark: boolean, policy: ThemePolicy = DEFAULT_THEME_POLICY): string {
    if (pref === 'system') return fallbackThemeId(systemPrefersDark ? 'dark' : 'light', policy);
    if (getAvailableThemeIds(policy).includes(pref)) return pref;
    return fallbackThemeId(getThemeScheme(pref) ?? 'light', policy);
}

// ---------------------------------------------------------------------------
// Persistencia (constantes compartidas servidor / cliente / script bloqueante)
// ---------------------------------------------------------------------------

export const THEME_COOKIE = 'bloomx-theme';
export const THEME_STORAGE_KEY = 'bloomx:theme:v1';
export const THEME_UPDATED_KEY = 'bloomx:theme:updated:v1';
export const MAIL_DARK_STORAGE_KEY = 'bloomx:mail-dark:v1';
/** Clave dentro de user.expansionSettings (JSONB cifrado) donde se guarda la preferencia. */
export const APPEARANCE_SETTINGS_KEY = 'core-appearance';

export type MailDarkMode = 'paper' | 'invert';
/** Modo por defecto para quien no tiene preferencia guardada (quien ya eligio conserva su eleccion). */
export const DEFAULT_MAIL_DARK_MODE: MailDarkMode = 'invert';
export const MAIL_DARK_MODES: readonly { id: MailDarkMode; label: string; description: string }[] = [
    { id: 'paper', label: 'Papel claro', description: 'El correo se muestra tal cual, sobre fondo blanco.' },
    { id: 'invert', label: 'Oscurecer correo', description: 'Invierte los colores del correo (las imagenes se conservan). Puede alterar diseños de marca. Opcion predeterminada.' },
];
export function isMailDarkMode(value: unknown): value is MailDarkMode {
    return value === 'paper' || value === 'invert';
}

// ---------------------------------------------------------------------------
// Generacion de CSS
// ---------------------------------------------------------------------------

export const HUES: Record<string, number> = {
    red: 0, orange: 25, amber: 40, yellow: 50, lime: 85, green: 142, emerald: 160,
    teal: 173, cyan: 190, sky: 200, blue: 217, indigo: 239, violet: 258,
    purple: 271, fuchsia: 292, pink: 330, rose: 350,
};
const NEUTRALS = ['gray', 'slate', 'zinc', 'neutral', 'stone'];

/**
 * Red de seguridad para temas oscuros: reasigna la paleta por defecto de
 * Tailwind (--color-red-50, --color-gray-200, ...) para que las clases que aun
 * usen la paleta cruda (bg-amber-50 text-amber-900, border-gray-200, ...) queden
 * legibles.
 *
 * 500 y 600 TAMBIEN se aclaran: en el codigo se usan como color de texto/acento
 * (text-purple-600, border-teal-500, degradados), y sobre fondos oscuros los tonos
 * originales dan 2-3:1. Consecuencia: NO usar bg-<color>-500/600 con texto blanco
 * para rellenos solidos; para eso estan los tokens (bg-primary + text-primary-foreground,
 * bg-destructive, ...). Los tintes (bg-<color>-500/10) no se ven afectados en la practica.
 * `npm run check:themes` verifica >= 4.5:1 de estos tonos sobre fondo/tarjeta/muted de cada tema oscuro.
 */
export const DARK_ACCENT_SHADES = { 500: { s: 92, l: 74 }, 600: { s: 90, l: 78 } } as const;

export function darkPaletteRemap(): string {
    const lines: string[] = [];
    for (const [name, h] of Object.entries(HUES)) {
        lines.push(
            `--color-${name}-500:hsl(${h} ${DARK_ACCENT_SHADES[500].s}% ${DARK_ACCENT_SHADES[500].l}%)`,
            `--color-${name}-600:hsl(${h} ${DARK_ACCENT_SHADES[600].s}% ${DARK_ACCENT_SHADES[600].l}%)`,
            `--color-${name}-50:hsl(${h} 40% 13%)`,
            `--color-${name}-100:hsl(${h} 38% 17%)`,
            `--color-${name}-200:hsl(${h} 36% 23%)`,
            `--color-${name}-300:hsl(${h} 34% 34%)`,
            `--color-${name}-700:hsl(${h} 85% 76%)`,
            `--color-${name}-800:hsl(${h} 88% 82%)`,
            `--color-${name}-900:hsl(${h} 92% 88%)`,
        );
    }
    for (const n of NEUTRALS) {
        lines.push(
            `--color-${n}-50:var(--color-muted)`,
            `--color-${n}-100:var(--color-muted)`,
            `--color-${n}-200:var(--color-secondary)`,
            `--color-${n}-300:var(--color-input)`,
            `--color-${n}-400:var(--color-muted-foreground)`,
            `--color-${n}-500:var(--color-muted-foreground)`,
            `--color-${n}-600:var(--color-muted-foreground)`,
            `--color-${n}-700:var(--color-foreground)`,
            `--color-${n}-800:var(--color-foreground)`,
            `--color-${n}-900:var(--color-foreground)`,
            `--color-${n}-950:var(--color-foreground)`,
        );
    }
    return lines.join(';');
}

function tokensToDecls(tokens: Partial<Record<TokenKey, string>>): string {
    return Object.entries(tokens)
        .map(([k, v]) => `--color-${k}:${v}`)
        .join(';');
}

/**
 * CSS de todos los temas. Estructura:
 *   :root, :root[data-theme=light]  -> tokens claros (tambien son el fallback sin JS)
 *   :root[data-theme=X]             -> un bloque por tema (X != light)
 *   :root[data-scheme=dark]         -> remapeo de paleta cruda para temas oscuros
 *   @media prefers-color-scheme     -> respaldo sin JS cuando la preferencia es "system"
 */
export function buildThemeCss(): string {
    const base = getTheme(DEFAULT_LIGHT_THEME)!;
    const darkBase = getTheme(DEFAULT_DARK_THEME)!;
    const out: string[] = [];

    out.push(`:root,:root[data-theme="light"]{color-scheme:light;${tokensToDecls(base.tokens)}}`);
    for (const t of THEMES) {
        if (t.id === DEFAULT_LIGHT_THEME) continue;
        out.push(`:root[data-theme="${t.id}"]{color-scheme:${t.scheme};${tokensToDecls(t.tokens)}}`);
    }
    const remap = darkPaletteRemap();
    out.push(`:root[data-scheme="dark"]{${remap}}`);
    out.push(
        `@media (prefers-color-scheme:dark){:root[data-theme-pref="system"]:not([data-theme]){color-scheme:dark;${tokensToDecls(darkBase.tokens)};${remap}}}`,
    );
    return out.join('\n');
}

// ---------------------------------------------------------------------------
// Marca del dominio (config.theme) superpuesta a los temas "brandable"
// ---------------------------------------------------------------------------

/** Calcula los tokens de un tema brandable con la marca del dominio aplicada, garantizando AA. */
export function applyBrand(theme: ThemeDefinition, cfg: DomainThemeConfig): Partial<Record<TokenKey, string>> {
    const t = { ...theme.tokens };
    const out: Partial<Record<TokenKey, string>> = {};
    const set = (k: TokenKey, v: string) => { t[k] = v; out[k] = v; };

    // Neutros: solo en el tema claro (un fondo claro de marca romperia el oscuro). Un fondo de marca OSCURO
    // tampoco se aplica al tema claro (quedaria un lienzo oscuro con tokens y color-scheme claros): el dominio
    // conserva su primario/acento y el usuario puede elegir un tema oscuro.
    const brandBg = normalizeHex(cfg.backgroundColor);
    const darkBrandBg = !!brandBg && contrast(brandBg, '#ffffff') > 3;
    if (theme.scheme === 'light' && !darkBrandBg) {
        const bg = normalizeHex(cfg.backgroundColor);
        if (bg) {
            set('background', bg);
            const fg = normalizeHex(cfg.textColor);
            set('foreground', fg && contrast(fg, bg) >= 4.5 ? fg : readableOn(bg));
        } else {
            // Solo texto de marca (sin fondo propio): se corrige contra el fondo y la tarjeta del tema.
            const fg = normalizeHex(cfg.textColor);
            if (fg) set('foreground', ensureContrast(fg, [t.background, t.card], 4.5));
        }
        const card = normalizeHex(cfg.cardColor);
        if (card) {
            set('card', card);
            set('popover', card);
            const cfgFg = normalizeHex(cfg.cardForeground);
            set('card-foreground', cfgFg && contrast(cfgFg, card) >= 4.5 ? cfgFg : ensureContrast(t.foreground, [card], 4.5));
            set('popover-foreground', t['card-foreground']);
        } else if (bg && contrast(t['card-foreground'], t.card) < 4.5) {
            set('card-foreground', ensureContrast(t['card-foreground'], [t.card], 4.5));
        }
        const muted = normalizeHex(cfg.mutedColor);
        if (muted) set('muted', muted);
        const border = normalizeHex(cfg.borderColor);
        if (border) set('border', border);
        const secondary = normalizeHex(cfg.secondaryColor);
        // Un secundario casi identico al fondo (p. ej. el #ffffff por defecto del panel admin) no aporta nada.
        if (secondary && contrast(secondary, t.background) >= 1.08) {
            set('secondary', secondary);
            const sf = normalizeHex(cfg.secondaryForeground);
            set('secondary-foreground', sf && contrast(sf, secondary) >= 4.5 ? sf : readableOn(secondary));
        }
        if (bg || muted || card) {
            const mf = normalizeHex(cfg.mutedForeground);
            const surfaces = [t.background, t.card, t.muted];
            const mfBase = mf ?? t['muted-foreground'];
            set('muted-foreground', ensureContrast(mfBase, surfaces, 4.5));
            set('accent', mix(t.muted, t.foreground, 0.04));
            set('accent-foreground', ensureContrast(t['accent-foreground'], [t.accent], 4.5));
            set('input', ensureContrast(normalizeHex(cfg.inputColor) ?? t.input, [t.background], 3));
        } else {
            const inputCfg = normalizeHex(cfg.inputColor);
            if (inputCfg) set('input', ensureContrast(inputCfg, [t.background], 3));
        }
    }

    // Marca: primario y acento. Se ajustan para leerse (4.5) sobre fondo y tarjeta.
    const surfaces = [t.background, t.card];
    const primary = normalizeHex(cfg.primaryColor);
    if (primary) {
        const adjusted = ensureContrast(primary, surfaces, 4.5);
        set('primary', adjusted);
        const pf = normalizeHex(cfg.primaryForeground);
        set('primary-foreground', pf && contrast(pf, adjusted) >= 4.5 ? pf : readableOn(adjusted));
    }
    // Anillo de foco: propio del dominio si cumple 3:1; si no, el primario ya corregido (o el del tema).
    const ringCfg = normalizeHex(cfg.ringColor);
    if (ringCfg) {
        const fallback = primary ? t.primary : ensureContrast(ringCfg, [t.background], 3);
        set('ring', contrast(ringCfg, t.background) >= 3 ? ringCfg : fallback);
    } else if (primary) {
        set('ring', t.primary);
    }
    const accent = normalizeHex(cfg.accentColor);
    if (accent) {
        const adjusted = ensureContrast(accent, surfaces, 4.5);
        set('brand-accent', adjusted);
        const af = normalizeHex(cfg.accentForeground);
        set('brand-accent-foreground', af && contrast(af, adjusted) >= 4.5 ? af : readableOn(adjusted));
    }
    return out;
}


// ---------------------------------------------------------------------------
// Requisitos de contraste (fuente unica: motor, tests y scripts/check-theme-contrast.ts)
// ---------------------------------------------------------------------------

export interface ContrastRequirement { label: string; fg: TokenKey; on: TokenKey; min: number }

const req = (label: string, fg: TokenKey, on: TokenKey, min = 4.5): ContrastRequirement => ({ label, fg, on, min });

/** Pares (texto/control sobre superficie) que TODO tema, generico o de empresa, debe cumplir. */
export const CONTRAST_REQUIREMENTS: readonly ContrastRequirement[] = [
    req('texto / fondo', 'foreground', 'background'),
    req('texto / tarjeta', 'foreground', 'card'),
    req('texto / tarjeta (card-foreground)', 'card-foreground', 'card'),
    req('texto / popover', 'popover-foreground', 'popover'),
    req('atenuado / fondo', 'muted-foreground', 'background'),
    req('atenuado / tarjeta', 'muted-foreground', 'card'),
    req('atenuado / muted', 'muted-foreground', 'muted'),
    req('atenuado / popover', 'muted-foreground', 'popover'),
    req('atenuado / sidebar', 'muted-foreground', 'sidebar'),
    req('atenuado / no leido', 'muted-foreground', 'unread'),
    req('atenuado / fila hover', 'muted-foreground', 'row-hover'),
    req('atenuado / fila seleccionada', 'muted-foreground', 'row-selected'),
    req('boton primario', 'primary-foreground', 'primary'),
    req('texto primario / fondo', 'primary', 'background'),
    req('texto primario / tarjeta', 'primary', 'card'),
    req('boton secundario', 'secondary-foreground', 'secondary'),
    req('hover accent', 'accent-foreground', 'accent'),
    req('boton peligro', 'destructive-foreground', 'destructive'),
    req('texto peligro / fondo', 'destructive', 'background'),
    req('texto peligro / tarjeta', 'destructive', 'card'),
    req('boton exito', 'success-foreground', 'success'),
    req('texto exito / fondo', 'success', 'background'),
    req('texto exito / tarjeta', 'success', 'card'),
    req('boton aviso', 'warning-foreground', 'warning'),
    req('texto aviso / fondo', 'warning', 'background'),
    req('texto aviso / tarjeta', 'warning', 'card'),
    req('boton info', 'info-foreground', 'info'),
    req('texto info / fondo', 'info', 'background'),
    req('texto info / tarjeta', 'info', 'card'),
    req('acento marca', 'brand-accent-foreground', 'brand-accent'),
    req('texto acento marca / fondo', 'brand-accent', 'background'),
    req('sidebar', 'sidebar-foreground', 'sidebar'),
    req('sidebar activo', 'sidebar-accent-foreground', 'sidebar-accent'),
    req('cabecera', 'header-foreground', 'header'),
    req('fila no leida', 'unread-foreground', 'unread'),
    req('texto / fila hover', 'foreground', 'row-hover'),
    req('fila seleccionada', 'row-selected-foreground', 'row-selected'),
    req('enlace / fondo', 'link', 'background'),
    req('enlace / tarjeta', 'link', 'card'),
    req('enlace / popover', 'link', 'popover'),
    req('enlace hover / fondo', 'link-hover', 'background'),
    req('enlace hover / tarjeta', 'link-hover', 'card'),
    req('codigo', 'code-foreground', 'code'),
    req('etiqueta (chip)', 'chip-foreground', 'chip'),
    req('seleccion de texto', 'selection-foreground', 'selection'),
    req('borde de control / fondo (3:1)', 'input', 'background', 3),
    req('borde de control / tarjeta (3:1)', 'input', 'card', 3),
    req('foco / fondo (3:1)', 'ring', 'background', 3),
    req('foco / tarjeta (3:1)', 'ring', 'card', 3),
    req('scrollbar / fondo (1.5:1)', 'scrollbar', 'background', 1.5),
];

// ---------------------------------------------------------------------------
// Script bloqueante anti-FOUC
// ---------------------------------------------------------------------------

/**
 * Se inyecta como <script> sincrono en <head>. Corre antes del primer pintado:
 * lee la preferencia (cookie -> localStorage), la valida contra la politica de la empresa
 * (mismo algoritmo que resolvePreference/resolveThemeId; hay un test de paridad), resuelve "system"
 * con matchMedia y fija data-theme / data-theme-pref / data-scheme / color-scheme en <html>.
 * Todo en try/catch: si algo falla queda el tema por defecto del CSS.
 */
export function buildBootScript(policy: ThemePolicy = DEFAULT_THEME_POLICY): string {
    const schemes: Record<string, ColorScheme> = { 'brand-light': 'light', 'brand-dark': 'dark' };
    THEMES.forEach((t) => { schemes[t.id] = t.scheme; });
    const available = getAvailableThemeIds(policy);
    const fb = { light: fallbackThemeId('light', policy), dark: fallbackThemeId('dark', policy) };
    return `(function(){try{var d=document.documentElement,S=${JSON.stringify(schemes)},A=${JSON.stringify(available)},F=${JSON.stringify(fb)},M=${JSON.stringify(policy.defaultMode)},p=null,m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=([^;]*)/);if(m)p=decodeURIComponent(m[1]);if(!p){try{p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}}if(p!=='system'&&!S[p])p=null;if(p===null)p=M==='system'?'system':F[M];else if(p!=='system'&&A.indexOf(p)<0)p=F[S[p]];var r=p;if(p==='system')r=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?F.dark:F.light;d.setAttribute('data-theme',r);d.setAttribute('data-theme-pref',p);d.setAttribute('data-scheme',S[r]);d.style.colorScheme=S[r]}catch(e){}})();`;
}
