'use client';

import { useCallback, useMemo } from 'react';
import { mutate as mutateSWR } from 'swr';
import { useAdminQuery, type ApiError } from '@/components/admin/console';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { useI18n } from '@/components/I18nProvider';
import { manifestHealth, type ManifestHealth } from '@/lib/expansions/manage/health';
import { buildRows, installedFromConfig, type CatalogExtension, type ExtensionRow, type InstalledExtension } from '@/lib/admin/extensions-view';

export interface InstalledResponse {
    managerSessionRequired: boolean;
    extensions: InstalledExtension[];
    errorExtensionIds: string[];
    capabilities: { test: boolean; testReason?: 'user_context_required' | 'signing_key_required' };
    /** Estado de IA de la instancia (sin secretos) para marcar las extensiones que requieren IA. */
    ai?: { enabled: boolean; features: Record<string, boolean>; extensions: Record<string, boolean> } | null;
}

export const CATALOG_URL = '/api/admin/extensions/catalog';
export const installedUrl = (domainId: string) => `/api/admin/extensions/installed?domainId=${encodeURIComponent(domainId)}`;

export interface ExtensionsData {
    rows: ExtensionRow[];
    loading: boolean;
    /** Error del catalogo (sin catalogo no hay pantalla util). */
    catalogError: ApiError | undefined;
    /** Error al leer lo instalado (la pantalla se degrada a solo lectura). */
    installedError: ApiError | undefined;
    /** Sin sesion de gestor del dominio (o sin dominio): no se puede instalar, activar ni ordenar. */
    readOnly: boolean;
    readOnlyReason: 'session' | 'noDomain' | 'error' | null;
    testSupported: boolean;
    testReason: string | null;
    /** Solo lectura y /api/config fallo (red, timeout, 5xx): NO es "sin extensiones"; se muestra el error con Reintentar. */
    configError: boolean;
    retry: () => void;
    /** Refresca lo instalado y la configuracion publica (/api/config) tras una accion. */
    refresh: () => Promise<void>;
}

/** Une catalogo + instaladas (+ errores) en filas; en solo lectura usa `useDomainConfig().extensions`. */
export function useExtensionsData(domainId: string | undefined): ExtensionsData {
    const { locale } = useI18n();
    const catalogQ = useAdminQuery<{ extensions: CatalogExtension[] }>(CATALOG_URL);
    const installedQ = useAdminQuery<InstalledResponse>(domainId ? installedUrl(domainId) : null);
    const domain = useDomainConfig();
    const { isError: configFailed, extensionsLoaded, retry: retryConfig } = domain;
    // Incluye las pausadas por la IA (aiBlock.blocked): siguen instaladas y se listan.
    const configExtensions = domain.allExtensions ?? domain.extensions;

    const managerDenied = installedQ.data?.managerSessionRequired === true;
    const installedFailed = !!installedQ.error;
    const readOnly = !domainId || managerDenied || installedFailed;
    const readOnlyReason: ExtensionsData['readOnlyReason'] = !readOnly ? null : !domainId ? 'noDomain' : managerDenied ? 'session' : 'error';

    const installed = useMemo<InstalledExtension[]>(
        () => (readOnly ? installedFromConfig(configExtensions) : installedQ.data?.extensions ?? []),
        [readOnly, configExtensions, installedQ.data],
    );

    // Salud del manifest que se CARGA en este dominio (mounts descartados, manifest invalido...), a partir de /api/config.
    const health = useMemo(() => {
        const map = new Map<string, ManifestHealth>();
        for (const extension of configExtensions) {
            const id = typeof extension?.template?.id === 'string' && extension.template.id ? extension.template.id : typeof extension?.id === 'string' ? extension.id : '';
            if (id && !map.has(id)) map.set(id, manifestHealth(id, extension.template));
        }
        return map;
    }, [configExtensions]);

    const rows = useMemo(
        () => buildRows({ catalog: catalogQ.data?.extensions ?? [], installed, errorIds: installedQ.data?.errorExtensionIds ?? [], health, locale, ai: installedQ.data?.ai as any }),
        [catalogQ.data, installed, installedQ.data?.errorExtensionIds, installedQ.data?.ai, health, locale],
    );

    const { mutate: mutateCatalog } = catalogQ;
    const { mutate: mutateInstalled } = installedQ;
    const retry = useCallback(() => {
        void mutateCatalog();
        void mutateInstalled();
        retryConfig?.();
    }, [mutateCatalog, mutateInstalled, retryConfig]);

    const refresh = useCallback(async () => {
        await Promise.all([mutateInstalled(), mutateSWR('/api/config')]);
    }, [mutateInstalled]);

    const loading = (catalogQ.isLoading && !catalogQ.data) || (!!domainId && installedQ.isLoading && !installedQ.data);

    return {
        rows,
        loading,
        catalogError: catalogQ.error,
        installedError: installedQ.error,
        readOnly,
        readOnlyReason,
        testSupported: installedQ.data?.capabilities?.test === true,
        testReason: installedQ.data?.capabilities?.testReason ?? null,
        configError: readOnly && !!domainId && configFailed === true && extensionsLoaded !== true,
        retry,
        refresh,
    };
}
