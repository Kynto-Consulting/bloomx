'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { mutate as mutateSWR } from 'swr';
import { useDomainConfig } from '@/hooks/useDomainConfig';
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

export type UpdateResult = { ok: true; to: string | null } | { ok: false; reason: 'invalid-catalog' | 'forbidden' | 'failed' };

/**
 * Actualizar una extension instalada a la version del catalogo (POST /api/admin/extensions/update: conserva credenciales, ajustes y
 * estado). Solo tiene sentido para el administrador dueno del dominio: `canManage` (lo determina la presencia del catalogo, que solo
 * devuelve la ruta de administradores) y el servidor vuelve a comprobar sesion y propiedad.
 */
export function useExtensionUpdater(canManage: boolean) {
    const { config } = useDomainConfig();
    const domainId = typeof (config as { id?: unknown })?.id === 'string' ? ((config as { id: string }).id) : null;
    const [busyId, setBusyId] = useState<string | null>(null);

    const update = useCallback(async (extensionId: string): Promise<UpdateResult> => {
        if (!domainId) return { ok: false, reason: 'forbidden' };
        setBusyId(extensionId);
        try {
            const res = await fetch('/api/admin/extensions/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-store',
                credentials: 'same-origin',
                body: JSON.stringify({ domainId, extensionId }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.success === true) {
                await mutateSWR('/api/config');
                return { ok: true, to: typeof data.to === 'string' ? data.to : null };
            }
            if (data?.code === 'EXTENSION_INVALID') return { ok: false, reason: 'invalid-catalog' };
            if (res.status === 401 || res.status === 403) return { ok: false, reason: 'forbidden' };
            return { ok: false, reason: 'failed' };
        } catch {
            return { ok: false, reason: 'failed' };
        } finally {
            setBusyId(null);
        }
    }, [domainId]);

    return { canUpdate: canManage && domainId !== null, busyId, update };
}
