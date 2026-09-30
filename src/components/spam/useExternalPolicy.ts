'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { parseExternalPolicy, type ExternalPolicy } from './external-display';

/**
 * Politica publica de externos (GET /api/spam/external) con UNA cache compartida por toda la app: una sola peticion en vuelo,
 * revalidacion al montar si pasaron `STALE_MS` y refresco explicito (`refreshExternalPolicy`) tras anadir un confiable.
 * Devuelve null hasta cargar (y si la peticion falla): sin datos no se muestra nada.
 */
const STALE_MS = 5 * 60_000;
const URL_POLICY = '/api/spam/external';

let current: ExternalPolicy | null = null;
let loadedAt = 0;
let lastTry = 0;
const RETRY_MS = 30_000;
let inflight: Promise<ExternalPolicy | null> | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => current;

/** Pide la politica (deduplicado). Un error conserva la ultima politica conocida. */
export function refreshExternalPolicy(): Promise<ExternalPolicy | null> {
    if (inflight) return inflight;
    lastTry = Date.now();
    inflight = (async () => {
        try {
            const res = await fetch(URL_POLICY, { cache: 'no-store', credentials: 'same-origin' });
            if (!res.ok) return current;
            const next = parseExternalPolicy(await res.json());
            if (next) { current = next; loadedAt = Date.now(); emit(); }
            return current;
        } catch {
            return current;
        } finally {
            inflight = null;
        }
    })();
    return inflight;
}

export function useExternalPolicy(): ExternalPolicy | null {
    const policy = useSyncExternalStore(subscribe, snapshot, () => null);
    useEffect(() => {
        const now = Date.now();
        if (current ? now - loadedAt > STALE_MS : now - lastTry > RETRY_MS) void refreshExternalPolicy();
    }, []);
    return policy;
}

/** Solo para pruebas: vacia la cache compartida. */
export function __resetExternalPolicyForTests(): void {
    current = null; loadedAt = 0; lastTry = 0; inflight = null; emit();
}
