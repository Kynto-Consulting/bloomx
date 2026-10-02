'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { ApiError, adminFetch, useAdminQuery } from '@/components/admin/console';
import { withStar } from '@/lib/admin/marketplace/market-model';

export const STARS_URL = '/api/admin/extensions/stars';

interface StarsResponse { stars: string[] }

export interface ExtensionStars {
    starred: ReadonlySet<string>;
    /** Resultado del ultimo cambio ('saved' | 'limit' | 'error') para anunciarlo; null si no hubo. */
    lastError: 'limit' | 'error' | null;
    toggle: (extensionId: string, next?: boolean) => Promise<boolean>;
}

/**
 * Favoritas del administrador (persistidas en la BD de la instancia, por usuario). Optimista: la estrella cambia al instante y, si el
 * servidor la rechaza, vuelve a como estaba. Si la lectura falla (sin sesion, tabla ausente...) la lista queda vacia y la pantalla sigue.
 */
export function useExtensionStars(): ExtensionStars {
    const q = useAdminQuery<StarsResponse>(STARS_URL);
    const [lastError, setLastError] = useState<'limit' | 'error' | null>(null);
    const { mutate } = q;
    const dataRef = useRef<string[]>([]);
    dataRef.current = q.data?.stars ?? [];

    const starred = useMemo(() => new Set(q.data?.stars ?? []), [q.data]);

    const toggle = useCallback(
        async (extensionId: string, next?: boolean): Promise<boolean> => {
            const current = dataRef.current;
            const want = next ?? !current.includes(extensionId);
            setLastError(null);
            try {
                await mutate(
                    async () => {
                        const res = await adminFetch<StarsResponse>(STARS_URL, { method: 'PUT', body: { extensionId, starred: want } });
                        return { stars: Array.isArray(res?.stars) ? res.stars : withStar(current, extensionId, want) };
                    },
                    { optimisticData: { stars: withStar(current, extensionId, want) }, rollbackOnError: true, populateCache: true, revalidate: false },
                );
                return true;
            } catch (error) {
                setLastError(error instanceof ApiError && error.code === 'star_limit' ? 'limit' : 'error');
                return false;
            }
        },
        [mutate],
    );

    return { starred, lastError, toggle };
}
