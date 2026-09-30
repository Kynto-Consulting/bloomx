'use client';

import { useEffect, useMemo, useState } from 'react';
import { getExtensionErrors, subscribeExtensionErrors, type ExtensionErrorEntry } from '@/lib/expansions/client/error-log';
import type { CatalogInfo } from '@/lib/expansions/manage/model';

/** Errores de ejecucion, actualizados en vivo (error-log.ts). */
export function useLiveExtensionErrors(): ExtensionErrorEntry[] {
    const [errors, setErrors] = useState<ExtensionErrorEntry[]>(() => getExtensionErrors());
    useEffect(() => {
        const update = () => setErrors(getExtensionErrors());
        update();
        return subscribeExtensionErrors(update);
    }, []);
    return errors;
}

/** Hora actual refrescada cada `ms` (para "hace 5 min"). */
export function useNow(ms = 30_000): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), ms);
        return () => window.clearInterval(timer);
    }, [ms]);
    return now;
}

/**
 * Puede ver herramientas de desarrollo (enlace al playground)? En desarrollo siempre; en produccion solo si
 * /api/admin/me responde 200 (el playground gestiona despues su propio acceso).
 */
export function useCanSeeTools(): boolean {
    const dev = process.env.NODE_ENV !== 'production';
    const [allowed, setAllowed] = useState(dev);
    useEffect(() => {
        if (dev) return;
        let cancelled = false;
        fetch('/api/admin/me', { cache: 'no-store' }).then((res) => { if (!cancelled) setAllowed(res.status === 200); }).catch(() => { if (!cancelled) setAllowed(false); });
        return () => { cancelled = true; };
    }, [dev]);
    return allowed;
}

/**
 * Catalogo (version mas reciente, precio). Solo lo devuelve la ruta de administradores: con 401/403/error
 * simplemente no hay catalogo (mapa vacio).
 */
export function useCatalogInfo(): Map<string, CatalogInfo> {
    const [items, setItems] = useState<any[] | null>(null);
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/admin/extensions/catalog', { cache: 'no-store' });
                if (!res.ok) return;
                const data = await res.json();
                if (!cancelled && Array.isArray(data?.extensions)) setItems(data.extensions);
            } catch { /* sin catalogo */ }
        })();
        return () => { cancelled = true; };
    }, []);
    return useMemo(() => {
        const map = new Map<string, CatalogInfo>();
        for (const item of items ?? []) {
            if (item && typeof item.id === 'string') map.set(item.id, { version: typeof item.version === 'string' ? item.version : null, isPaid: item.isPaid === true, price: item.price ?? null, currency: typeof item.currency === 'string' ? item.currency : null });
        }
        return map;
    }, [items]);
}
