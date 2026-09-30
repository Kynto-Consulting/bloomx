
import { useMemo } from 'react';
import useSWR from 'swr';
import { sanitizeThemeConfig, type DomainThemeConfig } from '@/lib/theme-config';

const fetcher = (url: string) => fetch(url).then(res => res.json());

function getCanonicalExtensionId(extension: any) {
    const templateId = typeof extension?.template?.id === 'string' ? extension.template.id.trim() : '';
    const extensionId = typeof extension?.id === 'string' ? extension.id.trim() : '';
    return templateId || extensionId;
}

function normalizeExtensions(extensions: any[]) {
    const uniqueExtensions = new Map<string, any>();

    for (const extension of extensions) {
        const canonicalId = getCanonicalExtensionId(extension);
        if (!canonicalId) {
            continue;
        }

        if (!uniqueExtensions.has(canonicalId)) {
            uniqueExtensions.set(canonicalId, {
                ...extension,
                id: canonicalId,
            });
        }
    }

    return Array.from(uniqueExtensions.values());
}

export const DEFAULT_CONFIG = {
    name: process.env.NEXT_PUBLIC_BRAND_NAME || 'Bloom',
    displayName: process.env.NEXT_PUBLIC_BRAND_NAME || 'Bloom',
    logo: process.env.NEXT_PUBLIC_BRAND_LOGO || null,
    theme: {
        primaryColor: process.env.NEXT_PUBLIC_BRAND_COLOR || '#2563EB', // blue-600 default
    }
};
/**
 * Config del dominio. `themeConfig` es config.theme YA saneado (sanitizeThemeConfig): es lo que deben usar
 * los consumidores de tema (nunca config.theme en crudo). Mientras carga (isLoading) es el tema por defecto.
 */
export function useDomainConfig() {
    const { data, error, isLoading } = useSWR('/api/config', fetcher, {
        revalidateOnFocus: true
    });

    // data puede ser undefined si /api/config falla (isLoading=false y error definido).
    const config = isLoading ? DEFAULT_CONFIG : (data?.config ?? DEFAULT_CONFIG);
    const rawTheme = (config as { theme?: unknown }).theme;
    const themeConfig = useMemo<DomainThemeConfig>(() => sanitizeThemeConfig(rawTheme), [rawTheme]);
    const extensions = useMemo(() => (isLoading ? [] : normalizeExtensions(data?.extensions || [])), [isLoading, data]);

    return {
        config,
        themeConfig,
        extensions,
        isLoading,
        isError: isLoading ? false : error,
    };
}
