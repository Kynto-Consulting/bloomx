/**
 * Resolucion PURA de temas para las herramientas de extensiones (playground y galeria).
 *
 * La vista previa NO cambia el tema de toda la app: los tokens de un tema se aplican como variables CSS EN LINEA
 * (`--color-<token>`, `--radius`, `--font-body`, `--font-title`) sobre el contenedor de la vista previa. Los
 * componentes del kit usan utilidades de Tailwind que leen `var(--color-*)`, asi que heredan la paleta del contenedor.
 *
 * Ids de tema:
 *   - generico:  "light" | "dark" | "midnight" | ...   (THEMES)
 *   - fixture:   "fixture:<nombre>|light" | "fixture:<nombre>|dark"   (BRAND_FIXTURES, paletas de prueba)
 *   - empresa:   "domain:light" | "domain:dark"                        (la empresa real del dominio)
 */
import { THEMES, type ThemeDefinition, type ThemeTokens } from '@/lib/themes';
import { buildBrandThemes } from '@/lib/brand-theme';
import { BRAND_FIXTURES } from '@/lib/theme-fixtures';
import { TOKEN_KEYS, legacyFontStack, resolveFontStack, resolveRadiusRem, sanitizeThemeConfig, type DomainThemeConfig } from '@/lib/theme-config';

export type ThemeGroup = 'generic' | 'fixture' | 'domain';

export interface ThemeChoice {
    id: string;
    label: string;
    group: ThemeGroup;
    scheme: 'light' | 'dark';
    tokens: ThemeTokens;
    /** Radio base en rem (solo empresas con radio definido). */
    radiusRem: number | null;
    /** Stack CSS de la fuente de la empresa (lista blanca), si la definio. */
    fontStack: string | null;
}

/** Paletas de empresa de prueba que usa la vista "todos los temas" (las mismas de la bateria del kit). */
export const GALLERY_FIXTURES = ['oscura corporativa', 'pastel', 'saturada (texto malo)'] as const;

export const DEFAULT_THEME_ID = 'light';

function fontOf(cfg: DomainThemeConfig): string | null {
    return resolveFontStack(cfg.fontFamily) ?? legacyFontStack(cfg.bodyFont);
}

function fromConfig(cfgInput: unknown, prefix: string, group: ThemeGroup, name: string): ThemeChoice[] {
    const cfg = sanitizeThemeConfig(cfgInput);
    const brand = buildBrandThemes(cfg, { name });
    if (!brand) return [];
    const radiusRem = resolveRadiusRem(cfg);
    const fontStack = fontOf(cfg);
    const make = (theme: ThemeDefinition, mode: 'light' | 'dark'): ThemeChoice => ({
        id: `${prefix}${mode}`,
        label: `${name} - ${mode === 'dark' ? 'oscuro' : 'claro'}`,
        group,
        scheme: mode,
        tokens: theme.tokens,
        radiusRem,
        fontStack,
    });
    return [make(brand.light, 'light'), make(brand.dark, 'dark')];
}

export function fixtureThemeId(name: string, mode: 'light' | 'dark'): string {
    return `fixture:${name}|${mode}`;
}

/** Catalogo completo de temas elegibles: genericos, paletas de prueba y (si existe) la empresa real. */
export function listThemeChoices(domainConfig?: DomainThemeConfig | null, domainName = 'Empresa'): ThemeChoice[] {
    const out: ThemeChoice[] = THEMES.map((theme) => ({
        id: theme.id, label: theme.label, group: 'generic' as const, scheme: theme.scheme, tokens: theme.tokens, radiusRem: null, fontStack: null,
    }));
    for (const name of Object.keys(BRAND_FIXTURES)) {
        out.push(...fromConfig(BRAND_FIXTURES[name], `fixture:${name}|`, 'fixture', name));
    }
    if (domainConfig) out.push(...fromConfig(domainConfig, 'domain:', 'domain', domainName));
    return out;
}

/** Busca un tema por id; si no existe devuelve el claro generico (nunca undefined). */
export function resolveThemeChoice(id: string | null | undefined, choices: ThemeChoice[]): ThemeChoice {
    return choices.find((c) => c.id === id) ?? choices.find((c) => c.id === DEFAULT_THEME_ID) ?? choices[0];
}

/** Temas de la vista compacta "todos los temas": 3 paletas de prueba (claro/oscuro) y los 8 genericos. */
export function galleryThemeIds(choices: ThemeChoice[]): string[] {
    const ids: string[] = [];
    for (const c of choices) if (c.group === 'generic') ids.push(c.id);
    for (const name of GALLERY_FIXTURES) for (const mode of ['light', 'dark'] as const) {
        const id = fixtureThemeId(name, mode);
        if (choices.some((c) => c.id === id)) ids.push(id);
    }
    return ids;
}

export type ThemeVars = Record<string, string>;

const TOKEN_SET: ReadonlySet<string> = new Set<string>(TOKEN_KEYS);

/**
 * Variables CSS (clave -> valor) que implementan el tema. Solo tokens conocidos; nunca texto libre.
 * Incluye `--color-<token>`, y `--radius`/`--font-body`/`--font-title` cuando la empresa los define.
 */
export function themeVariables(choice: ThemeChoice): ThemeVars {
    const vars: ThemeVars = {};
    for (const key of Object.keys(choice.tokens)) {
        if (TOKEN_SET.has(key)) vars[`--color-${key}`] = choice.tokens[key as keyof ThemeTokens];
    }
    if (choice.radiusRem !== null) vars['--radius'] = `${choice.radiusRem}rem`;
    if (choice.fontStack) { vars['--font-body'] = choice.fontStack; vars['--font-title'] = choice.fontStack; }
    return vars;
}

/**
 * Estilo en linea completo del contenedor: variables + `color-scheme` + lienzo y texto tomados de los tokens.
 * Solo `var(--color-*)`: ningun color literal.
 */
export function themeStyle(choice: ThemeChoice): Record<string, string> {
    return {
        ...themeVariables(choice),
        colorScheme: choice.scheme,
        backgroundColor: 'var(--color-background)',
        color: 'var(--color-foreground)',
        fontFamily: 'var(--font-body)',
    };
}
