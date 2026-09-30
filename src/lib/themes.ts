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

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export const TOKEN_KEYS = [
    'background', 'foreground',
    'card', 'card-foreground',
    'popover', 'popover-foreground',
    'primary', 'primary-foreground',
    'secondary', 'secondary-foreground',
    'muted', 'muted-foreground',
    'accent', 'accent-foreground',
    'destructive', 'destructive-foreground',
    'success', 'success-foreground',
    'warning', 'warning-foreground',
    'info', 'info-foreground',
    'border', 'input', 'ring',
    'brand-accent', 'brand-accent-foreground',
] as const;

export type TokenKey = typeof TOKEN_KEYS[number];
export type ThemeTokens = Record<TokenKey, string>;
export type ColorScheme = 'light' | 'dark';

export interface ThemeDefinition {
    id: string;
    label: string;
    description: string;
    scheme: ColorScheme;
    /** Si es true, los colores de marca del dominio (config.theme) se superponen a este tema. */
    brandable: boolean;
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
    },
};

/** Orden = orden de aparicion en el selector. */
export const THEMES: readonly ThemeDefinition[] = [
    light, dark, midnight, amoled, ocean, forest, rose, contrastTheme,
];

export const THEME_IDS = THEMES.map((t) => t.id);
export const DEFAULT_LIGHT_THEME = 'light';
export const DEFAULT_DARK_THEME = 'dark';

/** Preferencia del usuario: 'system' sigue prefers-color-scheme. */
export type ThemePreference = 'system' | (typeof THEMES)[number]['id'];

export function getTheme(id: string | null | undefined): ThemeDefinition | undefined {
    return THEMES.find((t) => t.id === id);
}

export function isThemePreference(value: unknown): value is ThemePreference {
    return value === 'system' || (typeof value === 'string' && THEME_IDS.includes(value));
}

export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): ThemeDefinition {
    if (pref === 'system') return getTheme(systemPrefersDark ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME)!;
    return getTheme(pref) ?? getTheme(DEFAULT_LIGHT_THEME)!;
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
export const MAIL_DARK_MODES: readonly { id: MailDarkMode; label: string; description: string }[] = [
    { id: 'paper', label: 'Papel claro', description: 'El correo se muestra tal cual, sobre fondo blanco. Es la opcion mas fiel y legible.' },
    { id: 'invert', label: 'Oscurecer correo', description: 'Invierte los colores del correo (las imagenes se conservan). Puede alterar diseños de marca.' },
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

function darkPaletteRemap(): string {
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

export interface DomainThemeConfig {
    primaryColor?: string; primaryForeground?: string;
    secondaryColor?: string; secondaryForeground?: string;
    accentColor?: string; accentForeground?: string;
    backgroundColor?: string; textColor?: string;
    mutedColor?: string; mutedForeground?: string;
    cardColor?: string; cardForeground?: string;
    borderColor?: string; inputColor?: string; ringColor?: string;
    radius?: number | string;
    titleFont?: string; bodyFont?: string;
}

const SAFE_FONT_RE = /^[A-Za-z0-9][A-Za-z0-9 \-_]{0,48}$/;

function fontStack(name: unknown): string | null {
    if (typeof name !== 'string') return null;
    const n = name.trim();
    if (!SAFE_FONT_RE.test(n)) return null;
    return `"${n}",system-ui,sans-serif`;
}

/** Calcula los tokens de un tema brandable con la marca del dominio aplicada, garantizando AA. */
export function applyBrand(theme: ThemeDefinition, cfg: DomainThemeConfig): Partial<Record<TokenKey, string>> {
    const t = { ...theme.tokens };
    const out: Partial<Record<TokenKey, string>> = {};
    const set = (k: TokenKey, v: string) => { t[k] = v; out[k] = v; };

    // Neutros: solo en el tema claro (un fondo claro de marca romperia el oscuro).
    if (theme.scheme === 'light') {
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

/** CSS de la marca del dominio (colores para temas brandable + tipografia). Vacio si no hay marca. */
export function buildBrandCss(cfg: DomainThemeConfig | null | undefined): string {
    if (!cfg || typeof cfg !== 'object') return '';
    const blocks: string[] = [];

    for (const theme of THEMES) {
        if (!theme.brandable) continue;
        const overrides = applyBrand(theme, cfg);
        if (Object.keys(overrides).length === 0) continue;
        const decls = tokensToDecls(overrides);
        blocks.push(`:root[data-theme="${theme.id}"]{${decls}}`);
        if (theme.id === DEFAULT_LIGHT_THEME) blocks.push(`:root:not([data-theme]){${decls}}`);
        if (theme.id === DEFAULT_DARK_THEME) {
            blocks.push(`@media (prefers-color-scheme:dark){:root[data-theme-pref="system"]:not([data-theme]){${decls}}}`);
        }
    }

    const root: string[] = [];
    const body = fontStack(cfg.bodyFont);
    const title = fontStack(cfg.titleFont);
    if (body) root.push(`--font-body:${body}`);
    if (title) root.push(`--font-title:${title}`);
    const radius = Number(cfg.radius);
    if (Number.isFinite(radius) && radius >= 0 && radius <= 3) root.push(`--radius:${radius}rem`);
    if (root.length) blocks.push(`:root{${root.join(';')}}`);

    return blocks.join('\n');
}

// ---------------------------------------------------------------------------
// Script bloqueante anti-FOUC
// ---------------------------------------------------------------------------

/**
 * Se inyecta como <script> sincrono en <head>. Corre antes del primer pintado:
 * lee la preferencia (cookie -> localStorage), resuelve "system" con
 * matchMedia y fija data-theme / data-theme-pref / data-scheme / color-scheme
 * en <html>. Todo en try/catch: si algo falla queda el tema claro por defecto.
 */
export function buildBootScript(): string {
    const schemes: Record<string, ColorScheme> = {};
    THEMES.forEach((t) => { schemes[t.id] = t.scheme; });
    return `(function(){try{var d=document.documentElement,S=${JSON.stringify(schemes)},p=null,m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=([^;]*)/);if(m)p=decodeURIComponent(m[1]);if(!p){try{p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}}if(p!=='system'&&!S[p])p='system';var r=p;if(p==='system')r=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?${JSON.stringify(DEFAULT_DARK_THEME)}:${JSON.stringify(DEFAULT_LIGHT_THEME)};d.setAttribute('data-theme',r);d.setAttribute('data-theme-pref',p);d.setAttribute('data-scheme',S[r]);d.style.colorScheme=S[r]}catch(e){}})();`;
}
