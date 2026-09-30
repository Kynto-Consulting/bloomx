'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useSession } from '@/components/SessionProvider';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ReAuthProvider = 'google' | 'zoom' | 'slack' | 'hubspot' | 'notion' | string;

export interface ReAuthRequest {
    /** Stable ID derived from provider + sorted scopes. */
    id: string;
    provider: ReAuthProvider;
    /** Exact OAuth scope strings required. */
    scopes: string[];
    /** Human-readable reason shown to the user. */
    reason: string;
    /** Optional label for the feature/extension requesting this. */
    requestedBy?: string;
}

export interface ReAuthRequirements {
    provider: ReAuthProvider;
    scopes: string[];
    reason: string;
    requestedBy?: string;
    /**
     * Saltar la verificacion de scopes. Para tokens revocados/expirados (el proveedor respondio
     * "reconecta"): los scopes figuran concedidos en la BD pero el token ya no sirve.
     */
    force?: boolean;
}

interface ReAuthContextType {
    /** Active pending reauth requests (after scope verification). */
    requests: ReAuthRequest[];
    /**
     * Request a reauth for the given provider + scopes.
     * Silently no-ops if the scopes are already granted or already dismissed
     * for this session.
     */
    requestReAuth: (req: ReAuthRequirements) => void;
    /** Dismiss a single request for the current session. */
    dismiss: (id: string) => void;
    /** Dismiss all pending requests for the current session. */
    dismissAll: () => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const ReAuthContext = createContext<ReAuthContextType | undefined>(undefined);

function makeId(provider: string, scopes: string[]) {
    return `${provider}:${[...scopes].sort().join(',')}`;
}

// ─── Persistencia de "descartado" ───────────────────────────────────────────────

const DISMISSED_KEY = 'bloomx:reauth:dismissed:v2';
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000;

function loadDismissed(): Set<string> {
    const result = new Set<string>();
    try {
        const stored = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '{}') as Record<string, number>;
        const now = Date.now();
        for (const [id, at] of Object.entries(stored)) {
            if (typeof at === 'number' && now - at < DISMISS_TTL_MS) result.add(id);
        }
    } catch {
        // almacenamiento no disponible o JSON invalido
    }
    return result;
}

function saveDismissed(ids: Set<string>) {
    try {
        const previous = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '{}') as Record<string, number>;
        const now = Date.now();
        const next: Record<string, number> = {};
        for (const id of ids) next[id] = typeof previous[id] === 'number' ? previous[id] : now;
        localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
        // ignore
    }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

interface ReAuthProviderProps {
    children: React.ReactNode;
    /**
     * Scope requirements checked automatically once the session is loaded.
     * Use this in layout.tsx to declare scopes the core app always needs.
     */
    initialChecks?: ReAuthRequirements[];
}

export function ReAuthProvider({ children, initialChecks }: ReAuthProviderProps) {
    const { status } = useSession();
    const [requests, setRequests] = useState<ReAuthRequest[]>([]);
    /** IDs descartados: se recuerdan 24 h en localStorage (compartido entre pestanas) para no reaparecer en cada pestana nueva. */
    const dismissedRef = useRef<Set<string>>(new Set());
    /** Aborta las verificaciones pendientes al desmontar el provider. */
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        dismissedRef.current = loadDismissed();
        const controller = new AbortController();
        abortRef.current = controller;
        return () => controller.abort();
    }, []);

    const requestReAuth = useCallback(async (req: ReAuthRequirements) => {
        const id = makeId(req.provider, req.scopes);
        if (dismissedRef.current.has(id) && !req.force) return;

        // Verify via API that the scopes are actually missing before showing UI.
        if (!req.force) {
            try {
                const params = new URLSearchParams({
                    provider: req.provider,
                    scopes: req.scopes.join(' '),
                });
                const res = await fetch(`/api/auth/check-scopes?${params}`, { signal: abortRef.current?.signal });
                if (!res.ok) return;
                const { missing }: { missing: string[] } = await res.json();
                if (!missing.length) return; // Already granted — nothing to do.
            } catch {
                return; // Abortada o sin red.
            }
        }

        setRequests(prev => {
            if (prev.find(r => r.id === id)) return prev;
            return [...prev, { ...req, id }];
        });
    }, []);

    const dismiss = useCallback((id: string) => {
        dismissedRef.current.add(id);
        saveDismissed(dismissedRef.current);
        setRequests(prev => prev.filter(r => r.id !== id));
    }, []);

    const dismissAll = useCallback(() => {
        setRequests(prev => {
            prev.forEach(r => {
                dismissedRef.current.add(r.id);
            });
            saveDismissed(dismissedRef.current);
            return [];
        });
    }, []);

    // Run initial checks once the user is authenticated.
    useEffect(() => {
        if (status !== 'authenticated' || !initialChecks?.length) return;
        initialChecks.forEach(check => requestReAuth(check));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status]);

    // Listen for events dispatched by extensions that don't have React context access.
    // Usage from an extension (no React context needed):
    //   window.dispatchEvent(new CustomEvent('bloomx:request-reauth', {
    //     detail: { provider, scopes, reason, requestedBy }
    //   }));
    useEffect(() => {
        const handler = (e: Event) => {
            const d = (e as CustomEvent<ReAuthRequirements>).detail;
            if (d?.provider && Array.isArray(d?.scopes) && d?.reason) {
                requestReAuth(d);
            }
        };
        window.addEventListener('bloomx:request-reauth', handler);
        return () => window.removeEventListener('bloomx:request-reauth', handler);
    }, [requestReAuth]);

    return (
        <ReAuthContext.Provider value={{ requests, requestReAuth, dismiss, dismissAll }}>
            {children}
        </ReAuthContext.Provider>
    );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useReAuth() {
    const ctx = useContext(ReAuthContext);
    if (!ctx) throw new Error('useReAuth must be used within ReAuthProvider');
    return ctx;
}

/**
 * Convenience hook for components / features that need specific OAuth scopes.
 * Fires the reauth request once on mount and whenever `scopes` changes.
 */
export function useRequireScopes(
    provider: ReAuthProvider,
    scopes: string[],
    options: { reason: string; requestedBy?: string },
) {
    const { requestReAuth } = useReAuth();
    useEffect(() => {
        if (scopes.length) requestReAuth({ provider, scopes, ...options });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [provider, scopes.join(',')]);
}
