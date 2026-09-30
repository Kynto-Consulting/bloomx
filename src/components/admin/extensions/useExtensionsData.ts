'use client';

import { useCallback, useMemo } from 'react';
import { mutate as mutateSWR } from 'swr';
import { useAdminQuery, type ApiError } from '@/components/admin/console';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { buildRows, installedFromConfig, type CatalogExtension, type ExtensionRow, type InstalledExtension } from '@/lib/admin/extensions-view';

export interface InstalledResponse {
    managerSessionRequired: boolean;
    extensions: InstalledExtension[];
    errorExtensionIds: string[];
    capabilities: { test: boolean; testReason?: 'user_context_required' | 'signing_key_required' };
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
    const catalogQ = useAdminQuery<{ extensions: CatalogExtension[] }>(CATALOG_URL);
    const installedQ = useAdminQuery<InstalledResponse>(domainId ? installedUrl(domainId) : null);
    const { extensions: configExtensions, isError: configFailed, extensionsLoaded, retry: retryConfig } = useDomainConfig();

    const managerDenied = installedQ.data?.managerSessionRequired === true;
    const installedFailed = !!installedQ.error;
    const readOnly = !domainId || managerDenied || installedFailed;
    const readOnlyReason: ExtensionsData['readOnlyReason'] = !readOnly ? null : !domainId ? 'noDomain' : managerDenied ? 'session' : 'error';

    const installed = useMemo<InstalledExtension[]>(
        () => (readOnly ? installedFromConfig(configExtensions) : installedQ.data?.extensions ?? []),
        [readOnly, configExtensions, installedQ.data],
    );

    const rows = useMemo(
        () => buildRows({ catalog: catalogQ.data?.extensions ?? [], installed, errorIds: installedQ.data?.errorExtensionIds ?? [] }),
        [catalogQ.data, installed, installedQ.data?.errorExtensionIds],
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
