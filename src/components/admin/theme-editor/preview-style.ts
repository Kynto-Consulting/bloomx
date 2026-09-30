import type { CSSProperties } from 'react';
import { buildBrandThemes } from '@/lib/brand-theme';
import { TOKEN_KEYS, legacyFontStack, resolveFontStack, resolveRadiusRem, sanitizeThemeConfig, type DomainThemeConfig, type ThemeMode } from '@/lib/theme-config';
import { getTheme } from '@/lib/themes';

const DEFAULT_STACK = 'Inter,system-ui,sans-serif';

/**
 * Variables CSS que aplican un tema de empresa (o el generico si no hay colores) SOLO al contenedor de una vista previa.
 * Usa exactamente los mismos tokens que la app (buildBrandThemes), el radio y las fuentes de la empresa. La escala de
 * radios se emite completa porque en globals.css `--radius-*` se calculan en :root y no siguen a un `--radius` local.
 */
export function previewCssVars(mode: ThemeMode, themeConfig?: DomainThemeConfig | null, brandName?: string): CSSProperties {
    const cfg = sanitizeThemeConfig(themeConfig ?? {});
    const brand = buildBrandThemes(cfg, { name: brandName });
    const tokens = (brand ? brand[mode] : getTheme(mode)!).tokens;
    const style: Record<string, string> = { colorScheme: mode };
    for (const key of TOKEN_KEYS) if (tokens[key]) style[`--color-${key}`] = tokens[key];

    const r = resolveRadiusRem(cfg) ?? 0.5;
    const rem = (n: number) => `${Math.max(0, n)}rem`;
    style['--radius'] = rem(r);
    style['--radius-xs'] = rem(r - 0.375);
    style['--radius-sm'] = rem(r - 0.25);
    style['--radius-md'] = rem(r - 0.125);
    style['--radius-lg'] = rem(r);
    style['--radius-xl'] = rem(r + 0.25);
    style['--radius-2xl'] = rem(r + 0.5);
    style['--radius-3xl'] = rem(r + 1);

    const family = resolveFontStack(cfg.fontFamily);
    style['--font-body'] = family ?? legacyFontStack(cfg.bodyFont) ?? DEFAULT_STACK;
    style['--font-title'] = family ?? legacyFontStack(cfg.titleFont) ?? DEFAULT_STACK;
    return style as CSSProperties;
}
