'use client';

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useSession } from '@/components/SessionProvider';
import {
    EMPTY_PREFS, activatePrefsUser, getPrefs, isExtensionEnabled, orderIds, pullPrefsFromServer, setPrefs, subscribePrefs, withEnabled, withMoved,
    type ExtensionPrefs,
} from '@/lib/expansions/client/prefs';

let pulledFor: string | null = null;

/**
 * Preferencias del usuario sobre las extensiones instaladas (activar/desactivar sin desinstalar, orden).
 * Estado compartido por toda la app (ExtensionLoader y la pagina /extensions se actualizan a la vez).
 */
export function useExtensionPrefs() {
    const { data: session } = useSession();
    const userId: string | null = session?.user?.id || null;

    // Carga (sincrona) las preferencias locales del usuario activo antes de leerlas.
    activatePrefsUser(userId);
    const prefs = useSyncExternalStore(subscribePrefs, getPrefs, () => EMPTY_PREFS);

    // Una vez por usuario y sesion de pagina: trae las del servidor (otro dispositivo) si existen.
    useEffect(() => {
        if (!userId || pulledFor === userId) return;
        pulledFor = userId;
        void pullPrefsFromServer().then((remote) => { if (remote) setPrefs(remote, { sync: false }); });
    }, [userId]);

    const setEnabled = useCallback((id: string, enabled: boolean) => setPrefs(withEnabled(getPrefs(), id, enabled)), []);
    const move = useCallback((allIds: string[], id: string, direction: -1 | 1) => setPrefs(withMoved(getPrefs(), allIds, id, direction)), []);
    const isEnabled = useCallback((id: string) => isExtensionEnabled(prefs, id), [prefs]);
    const order = useCallback((ids: string[]) => orderIds(ids, prefs), [prefs]);

    return useMemo(() => ({ prefs: prefs as ExtensionPrefs, isEnabled, setEnabled, move, order }), [prefs, isEnabled, setEnabled, move, order]);
}
