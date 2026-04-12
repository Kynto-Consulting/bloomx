'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

interface ComposeWindow {
    id: string;
    from?: string;
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    body: string;
    minimized: boolean;
    draftId?: string;
    attachments?: any[];
}

interface ComposeContextType {
    windows: ComposeWindow[];
    openCompose: (draft?: Partial<ComposeWindow>) => void;
    closeCompose: (id: string) => void;
    updateCompose: (id: string, data: Partial<ComposeWindow>) => void;
    toggleMinimize: (id: string) => void;
}

const ComposeContext = createContext<ComposeContextType | undefined>(undefined);

export function ComposeProvider({ children }: { children: React.ReactNode }) {
    const [windows, setWindows] = useState<ComposeWindow[]>([]);

    // Load drafts on mount
    useEffect(() => {
        async function loadDrafts() {
            try {
                const res = await fetch('/api/drafts');
                const data = await res.json();
                if (data.drafts && data.drafts.length > 0) {
                    // Don't auto-open drafts, just keep them available
                }
            } catch (err) {
                console.error('Failed to load drafts:', err);
            }
        }
        loadDrafts();
    }, []);

    const openCompose = useCallback((draft?: Partial<ComposeWindow>) => {
        setWindows((prev) => {
            // If opening a draft that is already open, just bring it to attention (maximize if minimized)
            if (draft?.id) {
                const existing = prev.find(w => w.id === draft.id);
                if (existing) {
                    return prev.map(w => w.id === draft.id ? { ...w, minimized: false, ...draft } : w);
                }
            }

            const newWindow: ComposeWindow = {
                id: draft?.id || crypto.randomUUID(),
                from: draft?.from,
                to: draft?.to || '',
                cc: draft?.cc,
                bcc: draft?.bcc,
                subject: draft?.subject || '',
                body: draft?.body || '',
                minimized: draft?.minimized || false,
                attachments: draft?.attachments || [],
                draftId: draft?.draftId
            };
            return [...prev, newWindow];
        });
    }, []);

    const closeCompose = useCallback((id: string) => {
        setWindows((prev) => prev.filter((w) => w.id !== id));
    }, []);

    const updateCompose = useCallback((id: string, data: Partial<ComposeWindow>) => {
        setWindows((prev) =>
            prev.map((w) => (w.id === id ? { ...w, ...data } : w))
        );
    }, []);

    const toggleMinimize = useCallback((id: string) => {
        setWindows((prev) =>
            prev.map((w) => (w.id === id ? { ...w, minimized: !w.minimized } : w))
        );
    }, []);

    return (
        <ComposeContext.Provider
            value={{ windows, openCompose, closeCompose, updateCompose, toggleMinimize }}
        >
            {children}
        </ComposeContext.Provider>
    );
}

export function useCompose() {
    const context = useContext(ComposeContext);
    if (!context) {
        throw new Error('useCompose must be used within ComposeProvider');
    }
    return context;
}
