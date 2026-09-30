'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Estado de la pagina en la URL (filtros, orden, pagina, ?open=, ?create=) para poder compartir el enlace y volver atras.
 * `update` mezcla el parche con los parametros actuales (null/'' elimina la clave) y hace router.replace sin saltar el scroll.
 */
export function useUrlParams() {
    const sp = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const spRef = React.useRef(sp);
    spRef.current = sp;

    const get = React.useCallback((key: string) => sp?.get(key) ?? '', [sp]);

    const update = React.useCallback(
        (patch: Record<string, string | number | null | undefined>, opts: { resetPage?: boolean } = {}) => {
            const next = new URLSearchParams(spRef.current?.toString() ?? '');
            for (const [k, v] of Object.entries(patch)) {
                if (v === null || v === undefined || v === '') next.delete(k);
                else next.set(k, String(v));
            }
            if (opts.resetPage) next.delete('page');
            const qs = next.toString();
            router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
        },
        [router, pathname],
    );

    return { get, update, searchParams: sp };
}

export function intParam(value: string, fallback: number, min = 1, max = 10_000): number {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
