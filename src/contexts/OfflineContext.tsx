'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { AccountManager } from '@/lib/account-manager';
import {
    QueueItem,
    applyOutcome,
    classifyStatus,
    createItem,
    dueItems,
    enqueue,
    nextDueAt,
    normalizeStoredQueue,
} from '@/lib/offline-queue';

export type { QueueItem } from '@/lib/offline-queue';

interface AddToQueueOptions {
    /** Correo de la cuenta que origina la accion (p. ej. el remitente elegido). Por defecto, la cuenta activa. */
    accountEmail?: string | null;
    /** Clave para deduplicar (p. ej. `send:<draftId>`). Por defecto se deriva de metodo+url+cuerpo. */
    dedupeKey?: string;
}

interface OfflineContextType {
    isOnline: boolean;
    queue: QueueItem[];
    /** Encola una peticion. Devuelve el id de la operacion (o null si ya estaba encolada). */
    addToQueue: (url: string, method: string, body: any, description: string, options?: AddToQueueOptions) => string | null;
    removeFromQueue: (id: string) => void;
    /** Procesa la cola ahora (normalmente no hace falta llamarlo). */
    processQueue: () => Promise<void>;
}

const OfflineContext = createContext<OfflineContextType | null>(null);

const STORAGE_KEY = 'offline-queue';
const LOCK_NAME = 'bloomx-offline-queue';

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

function readStoredQueue(): QueueItem[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? normalizeStoredQueue(JSON.parse(raw), newId, Date.now()) : [];
    } catch {
        return [];
    }
}

function writeStoredQueue(queue: QueueItem[]): boolean {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
        return true;
    } catch (e) {
        // Cuota excedida o almacenamiento bloqueado.
        console.error('[offline] Could not persist queue:', e);
        return false;
    }
}

/**
 * Cabeceras de autenticacion de la cuenta que origino la accion. Sin esto una accion encolada
 * desde la cuenta A se ejecutaria como la cuenta B si el usuario cambio de cuenta entre tanto.
 * Devuelve null si la cuenta ya no existe en el navegador (la operacion no debe ejecutarse).
 */
function resolveAuthHeaders(item: QueueItem): Record<string, string> | null {
    if (item.accountId) {
        const account = AccountManager.getAccounts().find((a) => a.id === item.accountId);
        if (!account) return null;
        return { Authorization: `Bearer ${account.token}` };
    }
    if (item.accountEmail) {
        const token = AccountManager.getTokenForEmail(item.accountEmail);
        return token ? { Authorization: `Bearer ${token}` } : {};
    }
    return {};
}

export function OfflineProvider({ children }: { children: ReactNode }) {
    const router = useRouter();
    const [isOnline, setIsOnline] = useState(true);
    const [queue, setQueue] = useState<QueueItem[]>([]);
    const processingRef = useRef(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const processQueueRef = useRef<() => Promise<void>>(async () => {});

    /** La fuente de verdad es localStorage (compartido entre pestanas); el estado de React es un espejo. */
    const commit = useCallback((fn: (current: QueueItem[]) => QueueItem[]) => {
        const next = fn(readStoredQueue());
        writeStoredQueue(next);
        setQueue(next);
        return next;
    }, []);

    const scheduleNext = useCallback((current: QueueItem[]) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        const at = nextDueAt(current);
        if (at === null || !navigator.onLine) return;
        const wait = Math.max(500, at - Date.now());
        timerRef.current = setTimeout(() => void processQueueRef.current(), wait);
    }, []);

    const runProcessing = useCallback(async () => {
        let synced = 0;
        let stoppedByNetwork = false;

        for (const item of dueItems(readStoredQueue(), Date.now())) {
            // Otra pestana pudo haberlo procesado mientras tanto.
            if (!readStoredQueue().some((q) => q.id === item.id)) continue;

            const auth = resolveAuthHeaders(item);
            if (auth === null) {
                commit((cur) => applyOutcome(cur, item.id, 'drop', Date.now()).queue);
                toast.error(`Discarded "${item.description}": the account is no longer signed in on this device.`);
                continue;
            }

            let outcome: ReturnType<typeof classifyStatus>;
            try {
                const res = await fetch(item.url, {
                    method: item.method,
                    headers: {
                        'Content-Type': 'application/json',
                        'Idempotency-Key': item.id,
                        ...auth,
                    },
                    body: item.method === 'DELETE' && item.body == null ? undefined : JSON.stringify(item.body),
                    // Una redireccion a /login no es exito ni una respuesta de la API.
                    redirect: 'manual',
                });
                outcome = res.type === 'opaqueredirect' ? 'retry' : classifyStatus(res.status);
                if (outcome === 'drop') console.warn(`[offline] Dropping non-retryable operation (${res.status}):`, item.description);
            } catch {
                // Sin red: dejar la cola intacta y parar; se reintentara al volver la conexion.
                stoppedByNetwork = true;
                break;
            }

            const result: { dropped: QueueItem | null } = { dropped: null };
            commit((cur) => {
                const applied = applyOutcome(cur, item.id, outcome, Date.now());
                result.dropped = applied.dropped;
                return applied.queue;
            });

            if (outcome === 'success') synced += 1;
            else if (result.dropped) toast.error(`Could not apply "${result.dropped.description}". It was discarded.`);
        }

        if (synced > 0) {
            toast.success(synced === 1 ? 'Pending action synced' : `${synced} pending actions synced`);
            window.dispatchEvent(new CustomEvent('bloomx:offline-synced'));
            router.refresh();
        }
        if (!stoppedByNetwork) scheduleNext(readStoredQueue());
    }, [commit, router, scheduleNext]);

    const processQueue = useCallback(async () => {
        if (!navigator.onLine) return;
        // Candado en memoria (misma pestana) + Web Locks (entre pestanas) para no enviar dos veces.
        if (processingRef.current) return;
        processingRef.current = true;
        try {
            if (typeof navigator !== 'undefined' && navigator.locks?.request) {
                await navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
                    if (!lock) return;
                    await runProcessing();
                });
            } else {
                await runProcessing();
            }
        } finally {
            processingRef.current = false;
        }
    }, [runProcessing]);

    processQueueRef.current = processQueue;

    useEffect(() => {
        setIsOnline(navigator.onLine);
        const initial = readStoredQueue();
        setQueue(initial);
        if (navigator.onLine && initial.length > 0) scheduleNext(initial);

        const handleOnline = () => {
            setIsOnline(true);
            toast.success('Back online');
            void processQueueRef.current();
        };
        const handleOffline = () => {
            setIsOnline(false);
            toast.warning('You are offline. Actions will be queued.');
            if (timerRef.current) clearTimeout(timerRef.current);
        };
        // Cambios hechos por otras pestanas.
        const handleStorage = (event: StorageEvent) => {
            if (event.key === STORAGE_KEY) setQueue(readStoredQueue());
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        window.addEventListener('storage', handleStorage);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            window.removeEventListener('storage', handleStorage);
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [scheduleNext]);

    const addToQueue = useCallback(
        (url: string, method: string, body: any, description: string, options?: AddToQueueOptions) => {
            const active = AccountManager.getActiveAccount();
            const item = createItem(
                {
                    url,
                    method,
                    body,
                    description,
                    accountId: options?.accountEmail ? null : active?.id ?? null,
                    accountEmail: options?.accountEmail ?? active?.email ?? null,
                    dedupeKey: options?.dedupeKey,
                },
                Date.now(),
                newId,
            );

            const state = { added: false };
            const next = commit((cur) => {
                const result = enqueue(cur, item);
                state.added = result.added;
                return result.queue;
            });

            if (!state.added) {
                toast.info(`Already queued: ${description}`);
                return null;
            }
            toast.info(`Queued: ${description}`);
            if (navigator.onLine) scheduleNext(next);
            return item.id;
        },
        [commit, scheduleNext],
    );

    const removeFromQueue = useCallback((id: string) => {
        commit((cur) => cur.filter((i) => i.id !== id));
    }, [commit]);

    const value = useMemo(
        () => ({ isOnline, queue, addToQueue, removeFromQueue, processQueue }),
        [isOnline, queue, addToQueue, removeFromQueue, processQueue],
    );

    return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline() {
    const context = useContext(OfflineContext);
    if (!context) throw new Error('useOffline must be used within OfflineProvider');
    return context;
}
