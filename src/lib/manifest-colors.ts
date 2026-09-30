import { sanitizeThemeConfig } from './theme-config';
import { buildBrandThemes } from './brand-theme';
import { getThemePolicy } from './themes';

/**
 * Colores del manifest desde la paleta de empresa (modo por defecto de la empresa; claro si no define).
 * theme_color = barra superior (header) y background_color = lienzo. Sin colores de empresa: los del tema base.
 */
export function manifestColors(rawTheme: unknown): { themeColor: string; backgroundColor: string } {
    try {
        const cfg = sanitizeThemeConfig(rawTheme);
        const brand = buildBrandThemes(cfg);
        if (brand) {
            const def = brand.list.find((t) => t.id === (getThemePolicy(cfg).defaultMode === 'dark' ? 'brand-dark' : 'brand-light')) ?? brand.light;
            return { themeColor: def.tokens.header || def.tokens.primary, backgroundColor: def.tokens.background };
        }
    } catch {
        // config corrupta: cae al tema base
    }
    return { themeColor: '#ffffff', backgroundColor: '#ffffff' };
}
