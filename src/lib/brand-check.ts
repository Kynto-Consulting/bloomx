/**
 * Diagnostico de contraste de la marca del dominio (panel admin).
 *
 * `applyBrand` (themes.ts) corrige en silencio cualquier color de marca que no
 * cumpla WCAG AA. Este modulo hace visible esa correccion: para cada color que
 * el administrador configuro compara el valor elegido con el que realmente se
 * aplicara y avisa cuando difieren, con el ratio antes/despues.
 *
 * Funciones puras (sin DOM) para poder testearlas con vitest.
 */
import { contrast, normalizeHex } from './color';
import { applyBrand, getTheme, type DomainThemeConfig, type TokenKey } from './themes';

export interface BrandIssue {
    /** Campo de DomainThemeConfig al que corresponde (primaryColor, ...). */
    field: keyof DomainThemeConfig;
    /** Etiqueta corta para mostrar. */
    label: string;
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
    /** Token de fondo contra el que debe leerse. */
    on: TokenKey;
    min: number;
}

const SPECS: Spec[] = [
    { field: 'primaryColor', label: 'Color primario', token: 'primary', on: 'background', min: 4.5 },
    { field: 'accentColor', label: 'Color de acento', token: 'brand-accent', on: 'background', min: 4.5 },
    { field: 'ringColor', label: 'Color de foco', token: 'ring', on: 'background', min: 3 },
    { field: 'inputColor', label: 'Borde de campos', token: 'input', on: 'background', min: 3 },
    { field: 'mutedForeground', label: 'Texto atenuado', token: 'muted-foreground', on: 'background', min: 4.5 },
    { field: 'textColor', label: 'Texto principal', token: 'foreground', on: 'background', min: 4.5 },
];

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Analiza la marca sobre el tema claro (el que recibe todos los neutros de marca).
 * Solo se reportan los campos que el administrador definio.
 */
export function analyzeBrand(cfg: DomainThemeConfig): BrandIssue[] {
    const theme = getTheme('light')!;
    const applied = { ...theme.tokens, ...applyBrand(theme, cfg) };
    const out: BrandIssue[] = [];

    for (const spec of SPECS) {
        const chosen = normalizeHex((cfg as Record<string, unknown>)[spec.field]);
        if (!chosen) continue;
        const final = applied[spec.token];
        const against = applied[spec.on];
        const chosenRatio = contrast(chosen, against);
        const appliedRatio = contrast(final, against);
        out.push({
            field: spec.field,
            label: spec.label,
            chosen,
            applied: final,
            against,
            chosenRatio: round(chosenRatio),
            appliedRatio: round(appliedRatio),
            min: spec.min,
            corrected: final.toLowerCase() !== chosen.toLowerCase(),
            ok: chosenRatio >= spec.min,
        });
    }
    return out;
}

/** Solo los campos que no cumplen AA y fueron corregidos. */
export function brandWarnings(cfg: DomainThemeConfig): BrandIssue[] {
    return analyzeBrand(cfg).filter((i) => !i.ok);
}
