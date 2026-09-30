'use client';

import React, { createContext, useContext, useRef, useCallback, useMemo } from 'react';
import { useSession } from '@/components/SessionProvider';
import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface BloomxDB extends DBSchema {
    cache: {
        key: string;
        value: {
            data: any;
            timestamp: number;
        };
    };
}

interface CacheContextType {
    getData: <T>(key: string) => Promise<T | null>;
    setData: <T>(key: string, data: T, options?: { silent?: boolean }) => Promise<void>;
    invalidate: (key: string | RegExp) => Promise<void>;
    /** El listener recibe la clave que cambio; `undefined` = cambio global (invalidate con regex). */
    subscribe: (listener: (key?: string) => void) => () => void;
}

const CacheContext = createContext<CacheContextType | undefined>(undefined);

const DB_NAME = 'bloomx-cache-v3';
const STORE_NAME = 'cache';

export function CacheProvider({ children }: { children: React.ReactNode }) {
    const { data: session } = useSession();
    const userEmail = session?.user?.email;

    // L1 Cache (Memory) - for super fast access during session
    const memoryCache = useRef(new Map<string, { data: any, timestamp: number }>());
    const dbPromise = useRef<Promise<IDBPDatabase<BloomxDB>> | null>(null);
    const listeners = useRef(new Set<(key?: string) => void>());

    // Apertura perezosa: los efectos de los hijos corren antes que los del provider,
    // asi que abrir en un useEffect dejaba las primeras lecturas en null.
    const getDb = useCallback((): Promise<IDBPDatabase<BloomxDB>> | null => {
        if (typeof window === 'undefined') return null;
        if (!dbPromise.current) {
            dbPromise.current = openDB<BloomxDB>(DB_NAME, 1, {
                upgrade(db) {
                    db.createObjectStore(STORE_NAME);
                },
            });
            dbPromise.current.catch(() => { dbPromise.current = null; });
        }
        return dbPromise.current;
    }, []);

    const getNamespacedKey = useCallback((key: string) => {
        if (!userEmail) return null;
        return `${userEmail}:${key}`;
    }, [userEmail]);

    const notifyListeners = useCallback((key?: string) => {
        listeners.current.forEach(l => {
            try { l(key); } catch (e) { console.error('Cache listener error', e); }
        });
    }, []);

    const getData = useCallback(async <T,>(key: string): Promise<T | null> => {
        const namespacedKey = getNamespacedKey(key);
        if (!namespacedKey) return null;

        // 1. Check Memory (L1)
        const cached = memoryCache.current.get(namespacedKey);
        if (cached) {
            // Check TTL (e.g. 24h for persistence? or keep 5m validity but store indefinitely?)
            // User asked for "500mb cache", implying long term storage.
            // Let's set a long TTL for storage, but maybe refresh in background?
            // For now, return what we have in mem.
            return cached.data as T;
        }

        // 2. Check IndexedDB (L2)
        const dbp = getDb();
        if (!dbp) return null;
        try {
            const db = await dbp;
            const entry = await db.get(STORE_NAME, namespacedKey);

            if (entry) {
                // Populate L1
                memoryCache.current.set(namespacedKey, entry);
                return entry.data as T;
            }
        } catch (e) {
            console.error("Cache read error", e);
        }

        return null;
    }, [getNamespacedKey, getDb]);

    const setData = useCallback(async <T,>(key: string, data: T, options?: { silent?: boolean }) => {
        const namespacedKey = getNamespacedKey(key);
        if (!namespacedKey) return;

        const entry = { data, timestamp: Date.now() };

        // 1. Update Memory
        memoryCache.current.set(namespacedKey, entry);

        // 2. Update DB
        const dbp = getDb();
        if (dbp) {
            try {
                const db = await dbp;
                await db.put(STORE_NAME, entry, namespacedKey);
            } catch (e) {
                console.error("Cache write error", e);
            }
        }

        if (!options?.silent) {
            notifyListeners(key);
        }
    }, [getNamespacedKey, notifyListeners, getDb]);

    const invalidate = useCallback(async (key: string | RegExp) => {
        const namespacedKeyPrefix = userEmail ? `${userEmail}:` : '';
        if (!namespacedKeyPrefix) return;

        let db: IDBPDatabase<BloomxDB> | null = null;
        try {
            const dbp = getDb();
            db = dbp ? await dbp : null;
        } catch (e) {
            console.error('Cache open error', e);
        }

        try {
            if (typeof key === 'string') {
                const fullKey = namespacedKeyPrefix + key;
                memoryCache.current.delete(fullKey);
                if (db) await db.delete(STORE_NAME, fullKey);
            } else {
                for (const k of Array.from(memoryCache.current.keys())) {
                    if (k.startsWith(namespacedKeyPrefix) && key.test(k.substring(namespacedKeyPrefix.length))) {
                        memoryCache.current.delete(k);
                    }
                }

                if (db) {
                    const keys = await db.getAllKeys(STORE_NAME);
                    const tx = db.transaction(STORE_NAME, 'readwrite');
                    const store = tx.objectStore(STORE_NAME);
                    for (const k of keys) {
                        if (k.startsWith(namespacedKeyPrefix) && key.test(k.substring(namespacedKeyPrefix.length))) {
                            store.delete(k);
                        }
                    }
                    await tx.done;
                }
            }
        } catch (e) {
            console.error('Cache invalidate error', e);
        }
        // string -> se avisa con su clave; regex -> aviso global (undefined)
        notifyListeners(typeof key === 'string' ? key : undefined);
    }, [userEmail, notifyListeners, getDb]);

    const subscribe = useCallback((listener: (key?: string) => void) => {
        listeners.current.add(listener);
        return () => listeners.current.delete(listener);
    }, []);

    const value = useMemo(
        () => ({ getData, setData, invalidate, subscribe }),
        [getData, setData, invalidate, subscribe]
    );

    return (
        <CacheContext.Provider value={value}>
            {children}
        </CacheContext.Provider>
    );
}

export function useCache() {
    const context = useContext(CacheContext);
    if (!context) {
        throw new Error('useCache must be used within a CacheProvider');
    }
    return context;
}
