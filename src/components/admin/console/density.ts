'use client';

import { useCallback, useEffect, useState } from 'react';

/** Densidad de la consola (preferencia por navegador): "comoda" o "compacta". La aplica ConsoleShell con data-density. */
export type Density = 'comfortable' | 'compact';
export const DENSITY_KEY = 'bloomx:admin:density:v1';
const EVENT = 'bloomx:admin-density';

export function readDensity(): Density {
    try {
        return window.localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable';
    } catch {
        return 'comfortable';
    }
}

export function writeDensity(value: Density): void {
    try { window.localStorage.setItem(DENSITY_KEY, value); } catch { /* storage bloqueado */ }
    try { window.dispatchEvent(new CustomEvent(EVENT, { detail: value })); } catch { /* sin window */ }
}

export function useDensity(): [Density, (d: Density) => void] {
    const [density, setDensityState] = useState<Density>('comfortable');
    useEffect(() => {
        setDensityState(readDensity());
        const onChange = () => setDensityState(readDensity());
        window.addEventListener(EVENT, onChange);
        window.addEventListener('storage', onChange);
        return () => { window.removeEventListener(EVENT, onChange); window.removeEventListener('storage', onChange); };
    }, []);
    const set = useCallback((d: Density) => { writeDensity(d); setDensityState(d); }, []);
    return [density, set];
}
