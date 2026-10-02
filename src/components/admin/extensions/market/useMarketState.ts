'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { buildMarketQuery, parseMarketUrl, type MarketState } from '@/lib/admin/marketplace/market-model';

type SearchLike = { get(name: string): string | null; toString(): string };

/** Cambios que ABREN una pagina nueva (el boton Atras vuelve a la anterior); el resto (escribir, filtrar) reemplaza la entrada del historial. */
const NAVIGATIONAL: Array<keyof MarketState> = ['section', 'suite', 'publisher', 'ext'];

function writeUrl(next: MarketState, push: boolean, keep: URLSearchParams | null) {
    if (typeof window === 'undefined') return;
    const qs = buildMarketQuery(next, keep);
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
    try {
        if (push) window.history.pushState(window.history.state, '', url);
        else window.history.replaceState(window.history.state, '', url);
    } catch {
        /* entornos sin History API: el estado sigue en memoria */
    }
}

/**
 * Estado del marketplace sincronizado con la URL (?q=&cat=&suite=&publisher=&view=&sec=&status=&sort=&ext=...). Se inicializa desde los
 * parametros de la ruta, escribe la URL al cambiar (sin recargar) y vuelve a leerla con Atras/Adelante. Parametros desconocidos o invalidos
 * caen al valor por defecto, y `?open=<id>` (busqueda global) lo trata la pantalla, asi que las URLs de antes siguen funcionando.
 */
export function useMarketState(searchParams: SearchLike | null) {
    const [state, setState] = useState<MarketState>(() => parseMarketUrl(searchParams ?? new URLSearchParams()));
    const ref = useRef(state);
    ref.current = state;

    const update = useCallback((patch: Partial<MarketState>) => {
        const prev = ref.current;
        const next: MarketState = { ...prev, ...patch };
        // Cualquier cambio que no sea la propia paginacion vuelve a la primera pagina.
        if (patch.page === undefined) next.page = 1;
        const push = NAVIGATIONAL.some((k) => k in patch && patch[k] !== prev[k]);
        ref.current = next;
        setState(next);
        writeUrl(next, push, typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null);
    }, []);

    useEffect(() => {
        const onPop = () => {
            const next = parseMarketUrl(new URLSearchParams(window.location.search));
            ref.current = next;
            setState(next);
        };
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, []);

    return { state, update };
}
