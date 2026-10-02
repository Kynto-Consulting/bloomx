import { useCallback, useMemo } from 'react';
import useSWR from 'swr';
import { sanitizeThemeConfig, type DomainThemeConfig } from '@/lib/theme-config';

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

// ---------------------------------------------------------------------------------------------------------------
// Carga de /api/config con errores DISTINGUIBLES ("sin extensiones" != "no se pudo cargar")
// ---------------------------------------------------------------------------------------------------------------

export type DomainConfigErrorKind = 'network' | 'timeout' | 'http' | 'invalid';

/** Error de carga de la config del dominio. `retryable` = tiene sentido reintentar solo (red, timeout, 5xx, 408, 429). */
export class DomainConfigError extends Error {
    kind: DomainConfigErrorKind;
    status?: number;
    retryable: boolean;
    constructor(kind: DomainConfigErrorKind, message: string, status?: number) {
        super(message);
        this.name = 'DomainConfigError';
        this.kind = kind;
        this.status = status;
        // 4xx (salvo 408/429) no se arregla reintentando; un JSON invalido si puede ser un fallo transitorio de un proxy.
        this.retryable = kind === 'http' ? (status === undefined || status >= 500 || status === 408 || status === 429) : true;
    }
}

export const CONFIG_URL = '/api/config';
export const CONFIG_TIMEOUT_MS = 10_000;
export const CONFIG_MAX_RETRIES = 5;
const RETRY_BASE_MS = 1_000;
const RETRY_CAP_MS = 30_000;

/**
 * GET /api/config con: comprobacion de `res.ok`, tiempo maximo, JSON valido y forma minima (`config` objeto; `extensions`, si
 * viene, un arreglo). Cualquier fallo lanza DomainConfigError (nunca devuelve un config vacio como si fuera bueno).
 */
export async function fetchDomainConfig(url: string = CONFIG_URL, options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<any> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), options.timeoutMs ?? CONFIG_TIMEOUT_MS) : null;
    try {
        let res: Response;
        try {
            res = await fetchImpl(url, controller ? { signal: controller.signal } : undefined);
        } catch (error: any) {
            if (error?.name === 'AbortError') throw new DomainConfigError('timeout', 'La configuracion tardo demasiado en responder');
            throw new DomainConfigError('network', 'No se pudo conectar para cargar la configuracion');
        }
        if (!res.ok) throw new DomainConfigError('http', `La configuracion respondio ${res.status}`, res.status);
        let data: any;
        try {
            data = await res.json();
        } catch (error: any) {
            if (error?.name === 'AbortError') throw new DomainConfigError('timeout', 'La configuracion tardo demasiado en responder');
            throw new DomainConfigError('invalid', 'La configuracion no es JSON valido');
        }
        if (!data || typeof data !== 'object' || Array.isArray(data) || !data.config || typeof data.config !== 'object' || Array.isArray(data.config)) {
            throw new DomainConfigError('invalid', 'La configuracion recibida no tiene el formato esperado');
        }
        if (data.extensions !== undefined && !Array.isArray(data.extensions)) {
            throw new DomainConfigError('invalid', 'La lista de extensiones recibida no es valida');
        }
        return data;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * Espera antes del reintento n (0 = primero): 1 s, 2 s, 4 s, 8 s, 16 s (tope 30 s) mas un jitter de hasta 250 ms.
 * `null` = no reintentar (error no reintentable o intentos agotados).
 */
export function computeRetryDelayMs(retryCount: number, error: unknown, random: () => number = Math.random): number | null {
    if (retryCount >= CONFIG_MAX_RETRIES) return null;
    if (error instanceof DomainConfigError && !error.retryable) return null;
    return Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** retryCount) + Math.floor(random() * 250);
}

/** `true` si la config trae una lista de extensiones autoritativa (la precarga del servidor NO la trae: no es "sin extensiones"). */
export function hasExtensionsList(data: any): boolean {
    return !!data && typeof data === 'object' && Array.isArray(data.extensions);
}

/**
 * Config del dominio. `themeConfig` es config.theme YA saneado (sanitizeThemeConfig): es lo que deben usar
 * los consumidores de tema (nunca config.theme en crudo). Mientras carga (isLoading) es el tema por defecto.
 *
 * Estados de las extensiones:
 *   - isLoading         primera carga en curso (sin datos ni error).
 *   - extensionsLoaded  hay una lista autoritativa (puede estar vacia: entonces SI es "sin extensiones").
 *   - isError / error   la carga fallo (red, timeout, 5xx, JSON invalido). Si ya habia datos buenos se CONSERVAN (`isStale`).
 *   - retry()           reintento manual inmediato. Ademas hay reintento automatico con backoff acotado (computeRetryDelayMs).
 */
export function useDomainConfig() {
    const { data, error, isLoading: swrLoading, isValidating, mutate } = useSWR<any, DomainConfigError>(CONFIG_URL, (url: string) => fetchDomainConfig(url), {
        revalidateOnFocus: true,
        // El kill switch de IA surte efecto en <= 30 s (cache del servidor) tambien en pestanas abiertas.
        refreshInterval: 30_000,
        // Con datos buenos previos, un fallo NO los borra (SWR conserva `data`); el reintento es por nuestra politica acotada.
        shouldRetryOnError: true,
        // SWR cuenta los reintentos desde 1 y espera que se le devuelvan las mismas `opts` (incrementa el en el siguiente fallo).
        onErrorRetry: (err, _key, _config, revalidate, opts) => {
            const delay = computeRetryDelayMs(opts.retryCount - 1, err);
            if (delay !== null) setTimeout(revalidate, delay, opts);
        },
    });
    // "Cargando" solo si aun NO hay datos ni error: con la config precargada por el servidor (DomainConfigBootstrap, SWR fallback)
    // SWR sigue revalidando al montar, pero el primer render ya tiene la empresa y su landing (sin parpadeo). Durante los
    // reintentos tras un fallo tampoco se vuelve a "cargando": se mantiene el estado de error con su boton.
    const isLoading = swrLoading && !data && !error;
    const isError = !!error;
    const extensionsLoaded = hasExtensionsList(data);

    // data puede ser undefined si /api/config falla (isLoading=false y error definido).
    const config = isLoading ? DEFAULT_CONFIG : (data?.config ?? DEFAULT_CONFIG);
    const rawTheme = (config as { theme?: unknown }).theme;
    const themeConfig = useMemo<DomainThemeConfig>(() => sanitizeThemeConfig(rawTheme), [rawTheme]);
    // `allExtensions`: todas las instaladas (la pagina de gestion muestra tambien las pausadas por la IA). `extensions`: las que se pueden
    // MONTAR: se excluyen las que /api/config marca `aiBlock.blocked` (IA/funcion desactivada); siguen instaladas y vuelven al reactivar la IA.
    const allExtensions = useMemo(() => (isLoading ? [] : normalizeExtensions(data?.extensions || [])), [isLoading, data]);
    const extensions = useMemo(() => allExtensions.filter((e) => e?.aiBlock?.blocked !== true), [allExtensions]);

    const retry = useCallback(() => { void mutate(); }, [mutate]);
    // Nivel de administrador del usuario (1..4) segun /api/config; null = no es administrador o aun no se sabe (falla cerrado: no se muestran entradas admin).
    const rawLevel = data?.viewer?.level;
    const viewerLevel = typeof rawLevel === 'number' && Number.isInteger(rawLevel) && rawLevel >= 1 && rawLevel <= 4 ? rawLevel : null;

    return {
        config,
        themeConfig,
        extensions,
        allExtensions,
        viewerLevel,
        isLoading,
        isError,
        error: (error ?? null) as DomainConfigError | null,
        /** Fallo de la ultima carga pero se muestran los ultimos datos buenos. */
        isStale: isError && !!data,
        extensionsLoaded,
        /** Hay una peticion en curso (reintento automatico o manual). */
        isRetrying: isError && isValidating,
        retry,
    };
}
