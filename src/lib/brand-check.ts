/**
 * Diagnostico de contraste de la marca del dominio (campos ANTIGUOS: primaryColor, accentColor, ...).
 *
 * Adaptador sobre el motor actual (buildBrandThemes): para cada color antiguo que el administrador configuro compara
 * el valor elegido con el que realmente se aplicara en el modo que corresponde a su fondo (claro si no hay fondo) y
 * avisa cuando difieren, con el ratio antes/despues. El editor nuevo usa directamente `analyzeBrandTheme`
 * (todos los tokens, ambos modos); este modulo se conserva para configuraciones antiguas y sus pruebas.
 *
 * Funciones puras (sin DOM) para poder testearlas con vitest.
 */
import { backgroundScheme, contrast } from './color';
import { buildBrandThemes } from './brand-theme';
import { normalizeThemeHex, sanitizeThemeConfig, type DomainThemeConfig, type ThemeMode, type TokenKey } from './theme-config';

export interface BrandIssue {
    /** Campo de DomainThemeConfig al que corresponde (primaryColor, ...). */
    field: keyof DomainThemeConfig;
    /** Etiqueta corta para mostrar. */
    label: string;
    /** Modo en el que se mide. */
    mode: ThemeMode;
    /** Token equivalente. */
    token: TokenKey;
    /** Color que el administrador eligio (#rrggbb). */
    chosen: string;
    /** Color que realmente se aplicara. */
    applied: string;
    /** Fondo contra el que se mide. */
    against: string;
    /** Contraste del color elegido contra `against`. */
    chosenRatio: number;
    /** Contraste del color aplicado contra `against`. */
    appliedRatio: number;
    /** Minimo requerido. */
    min: number;
    /** true si el color aplicado difiere del elegido (se corrigio). */
    corrected: boolean;
    /** true si el elegido ya cumple. */
    ok: boolean;
}

interface Spec {
    field: keyof DomainThemeConfig;
    label: string;
    token: TokenKey;
    min: number;
}

const SPECS: Spec[] = [
    { field: 'primaryColor', label: 'Color primario', token: 'primary', min: 4.5 },
    { field: 'accentColor', label: 'Color de acento', token: 'brand-accent', min: 4.5 },
    { field: 'ringColor', label: 'Color de foco', token: 'ring', min: 3 },
    { field: 'inputColor', label: 'Borde de campos', token: 'input', min: 3 },
    { field: 'mutedForeground', label: 'Texto atenuado', token: 'muted-foreground', min: 4.5 },
    { field: 'textColor', label: 'Texto principal', token: 'foreground', min: 4.5 },
];

const round = (n: number) => Math.round(n * 100) / 100;

/** Analiza los campos antiguos definidos por el administrador (solo esos). */
export function analyzeBrand(cfgInput: DomainThemeConfig): BrandIssue[] {
    const cfg = sanitizeThemeConfig(cfgInput);
    const themes = buildBrandThemes(cfg);
    if (!themes) return [];
    const mode: ThemeMode = cfg.backgroundColor ? backgroundScheme(cfg.backgroundColor) : 'light';
    const tokens = themes[mode].tokens;
    const out: BrandIssue[] = [];
    for (const spec of SPECS) {
        const chosen = normalizeThemeHex((cfg as Record<string, unknown>)[spec.field]);
        if (!chosen) continue;
        const applied = tokens[spec.token];
        const against = tokens.background;
        const chosenRatio = contrast(chosen, against);
        out.push({
            field: spec.field,
            label: spec.label,
            mode,
            token: spec.token,
            chosen,
            applied,
            against,
            chosenRatio: round(chosenRatio),
            appliedRatio: round(contrast(applied, against)),
            min: spec.min,
            corrected: applied.toLowerCase() !== chosen.toLowerCase(),
            ok: chosenRatio >= spec.min,
        });
    }
    return out;
}

/** Solo los campos que no cumplen AA y fueron corregidos. */
export function brandWarnings(cfg: DomainThemeConfig): BrandIssue[] {
    return analyzeBrand(cfg).filter((i) => !i.ok);
}
