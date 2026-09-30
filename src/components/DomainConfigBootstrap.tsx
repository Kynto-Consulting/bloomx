'use client';

import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import type { DomainThemeConfig } from '@/lib/theme-config';

/** Config de dominio ya saneada en el servidor (forma de /api/config sin extensiones). */
export interface InitialDomainConfig {
    config: {
        id?: string;
        name: string;
        displayName: string;
        logo: string | null;
        theme: DomainThemeConfig;
    };
}

/**
 * Precarga la cache SWR de '/api/config' con la config que el servidor ya obtuvo y sanero (tema + landing). Asi
 * useDomainConfig / useLandingConfig devuelven los datos de la empresa desde el primer render (login y registro no
 * parpadean). SWR revalida al montar, de modo que el cliente siempre converge al valor vigente. Sin `initial`
 * (el fetch del servidor fallo) no cambia nada: comportamiento de cliente de siempre.
 *
 * Un `initial` VACIO o malformado (sin config, sin nombre) tampoco se fija: precargar un config vacio taparia el valor por defecto
 * y mostraria una empresa sin nombre ante un fallo. Y la precarga NUNCA trae `extensions`: useDomainConfig la trata como
 * "lista de extensiones aun no cargada" (extensionsLoaded=false), no como "sin extensiones".
 */

/** La precarga es utilizable solo si trae una empresa con nombre (lo demas cae al comportamiento de cliente). */
export function isUsableInitialConfig(initial: unknown): initial is InitialDomainConfig {
    const config = (initial as { config?: unknown } | null | undefined)?.config as Record<string, unknown> | undefined;
    if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
    const named = (value: unknown) => typeof value === 'string' && value.trim() !== '';
    return named(config.name) || named(config.displayName);
}

export function DomainConfigBootstrap({ initial, children }: { initial: InitialDomainConfig | null; children: ReactNode }) {
    if (!isUsableInitialConfig(initial)) return <>{children}</>;
    return <SWRConfig value={{ fallback: { '/api/config': initial } }}>{children}</SWRConfig>;
}
