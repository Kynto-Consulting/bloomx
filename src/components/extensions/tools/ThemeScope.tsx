'use client';

/**
 * ThemeScope: aplica un tema SOLO al contenedor (no cambia el tema de la app). Los tokens del tema se escriben como
 * variables CSS en linea (`--color-<token>`, `--radius`, fuente de empresa) y `color-scheme`; los componentes del kit,
 * que usan utilidades de tokens (bg-card, text-foreground...), se pintan con esa paleta dentro del marco.
 *
 * Los temas disponibles salen de ThemeChoicesProvider (empresa real incluida); sin proveedor solo estan los genericos
 * y las paletas de prueba. NOTA: los portales (dialogos de OVERLAY) se montan en <body> y usan el tema de la app.
 */
import React, { createContext, useContext, useMemo } from 'react';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { getThemeOverride } from '@/lib/brand-theme';
import { hasBrandConfig } from '@/lib/theme-config';
import { listThemeChoices, resolveThemeChoice, themeStyle, type ThemeChoice } from '@/lib/expansions/playground/theme-scope';

let staticChoices: ThemeChoice[] | null = null;
const getStaticChoices = () => (staticChoices ??= listThemeChoices(null));

const ThemeChoicesContext = createContext<ThemeChoice[] | null>(null);

/** Una sola lectura de la config del dominio para todos los ThemeScope de la pagina. */
export function ThemeChoicesProvider({ children }: { children: React.ReactNode }) {
    const domain = useDomainConfig() as { config?: { displayName?: string; name?: string }; themeConfig?: any };
    const themeConfig = domain.themeConfig;
    const name = domain.config?.displayName || domain.config?.name || 'Empresa';
    const choices = useMemo(() => {
        const cfg = getThemeOverride() ?? themeConfig;
        return listThemeChoices(hasBrandConfig(cfg) ? cfg : null, name);
    }, [themeConfig, name]);
    return <ThemeChoicesContext.Provider value={choices}>{children}</ThemeChoicesContext.Provider>;
}

export function useThemeChoices(): ThemeChoice[] {
    return useContext(ThemeChoicesContext) ?? getStaticChoices();
}

export interface ThemeScopeProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'style'> {
    /** Id de tema: generico ("dark"), paleta de prueba ("fixture:pastel|dark") o empresa real ("domain:light"). */
    themeId: string;
    children: React.ReactNode;
}

export function ThemeScope({ themeId, children, className, ...rest }: ThemeScopeProps) {
    const choices = useThemeChoices();
    const choice = useMemo(() => resolveThemeChoice(themeId, choices), [themeId, choices]);
    const style = useMemo(() => themeStyle(choice) as React.CSSProperties, [choice]);
    return (
        <div {...rest} data-theme-scope={choice.id} className={className} style={style}>
            {children}
        </div>
    );
}
