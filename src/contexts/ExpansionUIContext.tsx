'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';

interface ModalOptions {
    width?: string;
    closable?: boolean;
}

interface DrawerOptions {
    side?: 'left' | 'right';
    width?: string;
}

interface ExpansionUIContextType {
    openModal: (content: ReactNode, options?: ModalOptions) => void;
    closeModal: () => void;
    openDrawer: (content: ReactNode, options?: DrawerOptions) => void;
    closeDrawer: () => void;
}

const ExpansionUIContext = createContext<ExpansionUIContextType | undefined>(undefined);

export function ExpansionUIProvider({ children }: { children: ReactNode }) {
    const [modalContent, setModalContent] = useState<ReactNode | null>(null);
    const [modalOptions, setModalOptions] = useState<ModalOptions>({});
    const [drawerContent, setDrawerContent] = useState<ReactNode | null>(null);
    const [drawerOptions, setDrawerOptions] = useState<DrawerOptions>({});

    const openModal = useCallback((content: ReactNode, options?: ModalOptions) => {
        setModalContent(content);
        setModalOptions(options || {});
    }, []);

    const closeModal = useCallback(() => {
        setModalContent(null);
        setModalOptions({});
    }, []);

    const openDrawer = useCallback((content: ReactNode, options?: DrawerOptions) => {
        setDrawerContent(content);
        setDrawerOptions(options || {});
    }, []);

    const closeDrawer = useCallback(() => {
        setDrawerContent(null);
        setDrawerOptions({});
    }, []);

    // Escape key to close
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (modalContent) closeModal();
                else if (drawerContent) closeDrawer();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [modalContent, drawerContent, closeModal, closeDrawer]);

    return (
        <ExpansionUIContext.Provider value={{ openModal, closeModal, openDrawer, closeDrawer }}>
            {children}

            {/* Modal Overlay */}
            {modalContent && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200"
                    onClick={(e) => {
                        if (e.target === e.currentTarget && modalOptions.closable !== false) closeModal();
                    }}
                >
                    <div
                        className="relative bg-white rounded-xl shadow-2xl animate-in zoom-in-95 duration-200 max-h-[85vh] overflow-y-auto"
                        style={{ width: modalOptions.width || 'auto', maxWidth: '90vw' }}
                    >
                        {modalOptions.closable !== false && (
                            <button
                                onClick={closeModal}
                                className="absolute top-3 right-3 z-10 p-1 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                            </button>
                        )}
                        {modalContent}
                    </div>
                </div>
            )}

            {/* Drawer Overlay */}
            {drawerContent && (
                <div
                    className="fixed inset-0 z-[100] bg-black/30 backdrop-blur-sm animate-in fade-in duration-150"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) closeDrawer();
                    }}
                >
                    <div
                        className={`fixed top-0 bottom-0 bg-white shadow-2xl animate-in duration-200 overflow-y-auto ${drawerOptions.side === 'left'
                                ? 'left-0 slide-in-from-left'
                                : 'right-0 slide-in-from-right'
                            }`}
                        style={{ width: drawerOptions.width || '400px', maxWidth: '90vw' }}
                    >
                        <button
                            onClick={closeDrawer}
                            className="absolute top-3 right-3 z-10 p-1 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        </button>
                        {drawerContent}
                    </div>
                </div>
            )}
        </ExpansionUIContext.Provider>
    );
}

export function useExpansionUI() {
    const context = useContext(ExpansionUIContext);
    if (!context) {
        throw new Error('useExpansionUI must be used within an ExpansionUIProvider');
    }
    return context;
}

export function useOptionalExpansionUI() {
    return useContext(ExpansionUIContext);
}
