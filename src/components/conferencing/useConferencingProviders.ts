'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchProviders } from '@/lib/conferencing/client';
import { isConferencingError, type ConferencingError, type ConferencingProviderStatus } from '@/lib/conferencing/types';

export interface UseConferencingProviders {
    providers: ConferencingProviderStatus[];
    loading: boolean;
    error: ConferencingError | null;
    refresh: () => void;
}

/** Estado de los proveedores de videoconferencia (GET /api/calendar/conferencing/providers). */
export function useConferencingProviders(): UseConferencingProviders {
    const [providers, setProviders] = useState<ConferencingProviderStatus[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<ConferencingError | null>(null);
    const [tick, setTick] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError(null);
        fetchProviders({ signal: controller.signal })
            .then((list) => {
                if (controller.signal.aborted) return;
                setProviders(list);
                setLoading(false);
            })
            .catch((e) => {
                if (controller.signal.aborted || (e as { name?: string })?.name === 'AbortError') return;
                setError(isConferencingError(e) ? e : ({ code: 'provider_error', name: 'ConferencingError', message: 'error' } as ConferencingError));
                setLoading(false);
            });
        return () => controller.abort();
    }, [tick]);

    const refresh = useCallback(() => setTick((n) => n + 1), []);
    return { providers, loading, error, refresh };
}
