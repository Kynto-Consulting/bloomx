'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useCache } from '@/contexts/CacheContext';
import { LABELS_CACHE_KEY, normalizeLabelList, type LabelRef } from '@/lib/mail-list';

/**
 * Etiquetas del usuario (cache 'labels-all' + GET /api/labels). `ensure()` las carga bajo demanda (al abrir un menu);
 * con `eager` se cargan al montar. La forma es siempre la de normalizeLabelList (con id).
 */
export function useLabels(eager = false) {
    const { getData, setData } = useCache();
    const [labels, setLabels] = useState<LabelRef[]>([]);
    const [loading, setLoading] = useState(false);
    const loadedRef = useRef(false);

    const ensure = useCallback(async (force = false) => {
        if (loadedRef.current && !force) return;
        loadedRef.current = true;
        setLoading(true);
        try {
            const cached = normalizeLabelList(await getData<unknown>(LABELS_CACHE_KEY));
            if (cached.length > 0) setLabels(cached);
            const res = await fetch('/api/labels', { cache: 'no-store' });
            if (res.ok) {
                const fresh = normalizeLabelList(await res.json().catch(() => null));
                setLabels(fresh);
                void setData(LABELS_CACHE_KEY, fresh, { silent: true });
            }
        } catch (err) {
            loadedRef.current = false;
            console.error('Failed to load labels', err);
        } finally {
            setLoading(false);
        }
    }, [getData, setData]);

    useEffect(() => { if (eager) void ensure(); }, [eager, ensure]);

    return { labels, loading, ensure, setLabels };
}
