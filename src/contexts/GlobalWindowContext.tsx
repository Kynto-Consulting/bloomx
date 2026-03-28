'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { FloatingWindow } from '@/components/ui/FloatingWindow';
import { AnimatePresence } from 'framer-motion';

export interface GlobalWindowItem {
    id: string;
    title: string;
    type: 'event' | 'contact' | 'custom' | 'compose';
    minimized: boolean;
    props?: any;
    content: React.ReactNode;
    icon?: React.ReactNode;
}

interface GlobalWindowContextType {
    windows: GlobalWindowItem[];
    openWindow: (window: Omit<GlobalWindowItem, 'id' | 'minimized'> & { id?: string }) => void;
    closeWindow: (id: string) => void;
    updateWindow: (id: string, data: Partial<GlobalWindowItem>) => void;
    toggleMinimize: (id: string) => void;
}

const GlobalWindowContext = createContext<GlobalWindowContextType | undefined>(undefined);

export function GlobalWindowProvider({ children }: { children: React.ReactNode }) {
    const [windows, setWindows] = useState<GlobalWindowItem[]>([]);

    const openWindow = useCallback((windowData: Omit<GlobalWindowItem, 'id' | 'minimized'> & { id?: string }) => {
        setWindows((prev) => {
            const id = windowData.id || crypto.randomUUID();
            if (prev.find((w) => w.id === id)) {
                return prev.map((w) => w.id === id ? { ...w, minimized: false } : w);
            }
            return [...prev, { ...windowData, id, minimized: false }];
        });
    }, []);

    const closeWindow = useCallback((id: string) => {
        setWindows((prev) => prev.filter((w) => w.id !== id));
    }, []);

    const updateWindow = useCallback((id: string, data: Partial<GlobalWindowItem>) => {
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
        <GlobalWindowContext.Provider value={{ windows, openWindow, closeWindow, updateWindow, toggleMinimize }}>
            {children}
            <GlobalWindowsRenderer />
        </GlobalWindowContext.Provider>
    );
}

export function useGlobalWindow() {
    const context = useContext(GlobalWindowContext);
    if (!context) {
        throw new Error('useGlobalWindow must be used within a GlobalWindowProvider');
    }
    return context;
}

function GlobalWindowsRenderer() {
    const { windows, closeWindow, toggleMinimize } = useGlobalWindow();

    return (
        <AnimatePresence>
            {windows.map((w, index) => (
                <FloatingWindow
                    key={w.id}
                    id={w.id}
                    title={w.title}
                    minimized={w.minimized}
                    onToggleMinimize={() => toggleMinimize(w.id)}
                    onClose={() => closeWindow(w.id)}
                    index={index}
                    headerIcon={w.icon}
                >
                    {w.content}
                </FloatingWindow>
            ))}
        </AnimatePresence>
    );
}
