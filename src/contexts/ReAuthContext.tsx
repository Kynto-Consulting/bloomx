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
    /** IDs dismissed during this browser session — stored in sessionStorage. */
    const dismissedRef = useRef<Set<string>>(new Set());

    // Restore dismissed IDs from sessionStorage so they survive hot reloads.
    useEffect(() => {
        try {
            const stored = sessionStorage.getItem('bloomx:reauth:dismissed');
            if (stored) {
                JSON.parse(stored).forEach((id: string) => dismissedRef.current.add(id));
            }
        } catch {
            // ignore
        }
    }, []);

    const requestReAuth = useCallback(async (req: ReAuthRequirements) => {
        const id = makeId(req.provider, req.scopes);
        if (dismissedRef.current.has(id)) return;

        // Verify via API that the scopes are actually missing before showing UI.
        try {
            const params = new URLSearchParams({
                provider: req.provider,
                scopes: req.scopes.join(' '),
            });
            const res = await fetch(`/api/auth/check-scopes?${params}`);
            if (!res.ok) return;
            const { missing }: { missing: string[] } = await res.json();
            if (!missing.length) return; // Already granted — nothing to do.
        } catch {
            return;
        }

        setRequests(prev => {
            if (prev.find(r => r.id === id)) return prev;
            return [...prev, { ...req, id }];
        });
    }, []);

    const dismiss = useCallback((id: string) => {
        dismissedRef.current.add(id);
        try {
            sessionStorage.setItem(
                'bloomx:reauth:dismissed',
                JSON.stringify([...dismissedRef.current]),
            );
        } catch {
            // ignore
        }
        setRequests(prev => prev.filter(r => r.id !== id));
    }, []);

    const dismissAll = useCallback(() => {
        setRequests(prev => {
            prev.forEach(r => {
                dismissedRef.current.add(r.id);
            });
            try {
                sessionStorage.setItem(
                    'bloomx:reauth:dismissed',
                    JSON.stringify([...dismissedRef.current]),
                );
            } catch {
                // ignore
            }
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
