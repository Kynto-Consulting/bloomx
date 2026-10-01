'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useCompose } from '@/contexts/ComposeContext';
import { useOffline } from '@/contexts/OfflineContext';
import { CLIENT_API_VERSION, MIN_CLIENT_API_HEADER } from '@/lib/expansions/client/capabilities';
import { BUILD_ID } from './version-info';
import {
    compareBuild,
    needsMandatoryUpdate,
    nextCheckDelay,
    parseMinClientApi,
    parseRemoteVersion,
    serviceWorkerUrl,
    shouldAutoReload,
} from './client-version';
import { hasUnsavedWork } from './unsaved-work';

export type ClientVersionStatus = 'current' | 'available' | 'mandatory';

const FLUSH_WAIT_MS = 4000;
const FALLBACK_RELOAD_MS = 4000;

/**
 * Vigila la version del servidor (GET /api/version) y prepara la actualizacion del SW.
 * Comprueba al cargar, al volver a la pestana, al recuperar la red y cada ~10 min (+-20%).
 * Sin red no hace nada ni lanza errores.
 */
export function useClientVersion() {
    const { windows } = useCompose();
    const { queue, isOnline } = useOffline();
    const [status, setStatus] = useState<ClientVersionStatus>('current');
    const [userAccepted, setUserAccepted] = useState(false);
    const remoteBuildRef = useRef<string | null>(null);
    const reloadedRef = useRef(false);

    const unsaved = hasUnsavedWork(windows, queue.length);
    const unsavedRef = useRef(unsaved);
    unsavedRef.current = unsaved;
    const queueLenRef = useRef(queue.length);
    queueLenRef.current = queue.length;

    const prepareServiceWorker = useCallback(async (buildId: string) => {
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
        try {
            // Registrar la URL del build nuevo: la URL cambia, asi el navegador instala el SW nuevo aunque sw.js no cambie de bytes.
            await navigator.serviceWorker.register(serviceWorkerUrl(buildId), { scope: '/', updateViaCache: 'none' });
        } catch { /* sin red / SW no permitido: se recargara sin SW nuevo */ }
    }, []);

    const check = useCallback(async () => {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        try {
            const res = await fetch('/api/version', { cache: 'no-store', credentials: 'omit' });
            if (!res.ok) return;
            const remote = parseRemoteVersion(await res.json());
            if (!remote) return;
            const mandatory = needsMandatoryUpdate(CLIENT_API_VERSION, remote.minClientApi);
            const newer = compareBuild(BUILD_ID, remote.buildId) === 'newer';
            if (newer && remoteBuildRef.current !== remote.buildId) {
                remoteBuildRef.current = remote.buildId;
                void prepareServiceWorker(remote.buildId);
            }
            setStatus((prev) => (mandatory ? 'mandatory' : prev === 'mandatory' ? prev : newer ? 'available' : 'current'));
        } catch { /* offline u otro fallo de red: nada que hacer */ }
    }, [prepareServiceWorker]);

    // Programacion de comprobaciones.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        let timer: number | undefined;
        const schedule = () => {
            timer = window.setTimeout(() => { void check().finally(schedule); }, nextCheckDelay());
        };
        const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
        const onOnline = () => { void check(); };
        void check();
        schedule();
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('online', onOnline);
        return () => {
            if (timer !== undefined) window.clearTimeout(timer);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('online', onOnline);
        };
    }, [check]);

    // Cabecera X-BloomX-Min-Client-Api en respuestas (backend de extensiones): si exige mas que este cliente, obligatoria.
    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
        const original = window.fetch;
        const wrapped: typeof window.fetch = async (...args) => {
            const response = await original.apply(window, args);
            try {
                const min = parseMinClientApi(response.headers.get(MIN_CLIENT_API_HEADER));
                if (min !== null && needsMandatoryUpdate(CLIENT_API_VERSION, min)) setStatus('mandatory');
            } catch { /* cabecera ilegible: ignorar */ }
            return response;
        };
        window.fetch = wrapped;
        return () => { if (window.fetch === wrapped) window.fetch = original; };
    }, []);

    const reloadNow = useCallback(() => {
        if (reloadedRef.current) return;
        reloadedRef.current = true;
        window.location.reload(); // pagehide/beforeunload hace flush de los borradores; la cola offline persiste.
    }, []);

    const activateAndReload = useCallback(() => {
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) { reloadNow(); return; }
        navigator.serviceWorker.addEventListener('controllerchange', reloadNow, { once: true });
        navigator.serviceWorker.getRegistration().then((reg) => {
            const waiting = reg?.waiting;
            if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
            else window.setTimeout(reloadNow, FALLBACK_RELOAD_MS); // sin SW nuevo en espera: recargar igualmente
        }).catch(() => reloadNow());
    }, [reloadNow]);

    /** El usuario pulsa "Actualizar". */
    const apply = useCallback(() => setUserAccepted(true), []);

    useEffect(() => {
        if (status === 'current') return;
        const go = shouldAutoReload({
            newBuild: status === 'available',
            mandatory: status === 'mandatory',
            hasUnsavedWork: unsavedRef.current,
            userAccepted,
        });
        if (!go) return;
        if (status === 'mandatory' && queueLenRef.current > 0 && isOnline) {
            // Margen para que la cola offline termine de enviarse (persiste igualmente si no da tiempo).
            const t = window.setTimeout(activateAndReload, FLUSH_WAIT_MS);
            return () => window.clearTimeout(t);
        }
        activateAndReload();
    }, [status, userAccepted, unsaved, isOnline, activateAndReload]);

    return { status, apply, hasUnsavedWork: unsaved, accepted: userAccepted };
}
