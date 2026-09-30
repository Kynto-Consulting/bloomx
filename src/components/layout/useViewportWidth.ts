'use client';

import { useSyncExternalStore } from 'react';
import { COLLAPSE_BELOW_PX } from '@/lib/layout/sidebar-width';

/** Puntos de corte de la app (px de viewport). Bajo 768 = movil (cajon), 768-899 = riel de iconos + cajon, desde 900 = barra fija. */
export const MOBILE_BELOW_PX = 768;

export type SidebarMode = 'full' | 'rail' | 'drawer';

export function sidebarModeFor(viewportWidth: number, collapseBelow = COLLAPSE_BELOW_PX): SidebarMode {
    if (!Number.isFinite(viewportWidth)) return 'full';
    return viewportWidth < MOBILE_BELOW_PX ? 'drawer' : viewportWidth < collapseBelow ? 'rail' : 'full';
}

function subscribe(onChange: () => void): () => void {
    if (typeof window === 'undefined') return () => undefined;
    window.addEventListener('resize', onChange);
    window.addEventListener('orientationchange', onChange);
    return () => {
        window.removeEventListener('resize', onChange);
        window.removeEventListener('orientationchange', onChange);
    };
}

/** Ancho del viewport. `null` en el servidor y durante la hidratacion (el shell pinta entonces un esqueleto con el ancho de la cookie). */
export function useViewportWidth(): number | null {
    return useSyncExternalStore(subscribe, () => (typeof window === 'undefined' ? 1280 : window.innerWidth), () => null);
}
