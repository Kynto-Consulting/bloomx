'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { useReAuth, type ReAuthRequirements } from '@/contexts/ReAuthContext';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { syncExtensionSettingsTabs } from '@/lib/expansions/client/dynamic-settings';
import { OverlayHost } from '@/components/expansions/kit/OverlayHost';

interface ModalOptions {
    /** sm|md|lg|xl|full (los anchos heredados en px se aproximan). */
    width?: string;
    closable?: boolean;
    /** Nombre accesible del dialogo. */
    label?: string;
}

interface DrawerOptions {
    side?: 'left' | 'right';
    /** sm|md|lg */
    width?: string;
    label?: string;
}

interface ExpansionUIContextType {
    openModal: (content: ReactNode, options?: ModalOptions) => void;
    closeModal: () => void;
    openDrawer: (content: ReactNode, options?: DrawerOptions) => void;
    closeDrawer: () => void;
    /**
     * Request a reauth/re-link for a provider + scopes from within an extension.
     * Shows a non-blocking popup prompting the user to reconnect.
     *
     * @example
     * const { requestReAuth } = useExpansionUI();
     * requestReAuth({
     *   provider: 'google',
     *   scopes: ['https://www.googleapis.com/auth/some.scope'],
     *   reason: 'This extension needs X to work correctly.',
     *   requestedBy: 'My Extension',
     * });
     */
    requestReAuth: (req: ReAuthRequirements) => void;
}

/** Exportado para aislar una vista previa (playground/galeria): `<ExpansionUIContext.Provider value={undefined}>` hace que los overlays se abran dentro del marco con su propio tema. */
export const ExpansionUIContext = createContext<ExpansionUIContextType | undefined>(undefined);

export function ExpansionUIProvider({ children }: { children: ReactNode }) {
    const [modalContent, setModalContent] = useState<ReactNode | null>(null);
    const [modalOptions, setModalOptions] = useState<ModalOptions>({});
    const [drawerContent, setDrawerContent] = useState<ReactNode | null>(null);
    const [drawerOptions, setDrawerOptions] = useState<DrawerOptions>({});
    const { requestReAuth } = useReAuth();
    const { extensions: domainExtensions, isLoading: domainConfigLoading } = useDomainConfig();

    // Las pestanas de ajustes que declaran los manifests (CUSTOM_SETTINGS_TAB) se publican en el registro que lee SettingsModal.
    const domainExtensionsKey = domainExtensions.map((extension: any) => `${extension.id}@${extension.template?.version || ''}`).join(',');
    useEffect(() => {
        if (!domainConfigLoading) syncExtensionSettingsTabs(domainExtensions);
        // domainExtensions cambia de identidad en cada render de useDomainConfig; la clave describe su contenido
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [domainExtensionsKey, domainConfigLoading]);

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

    return (
        <ExpansionUIContext.Provider value={{ openModal, closeModal, openDrawer, closeDrawer, requestReAuth }}>
            {children}

            {/* Overlays de extensiones: dialogo/cajon accesibles (foco atrapado, Escape, fondo bg-overlay) */}
            <OverlayHost
                kind="modal"
                open={modalContent !== null}
                onClose={closeModal}
                label={modalOptions.label || 'Extension'}
                width={modalOptions.width}
                closable={modalOptions.closable !== false}
            >
                {modalContent}
            </OverlayHost>
            <OverlayHost
                kind="drawer"
                open={drawerContent !== null}
                onClose={closeDrawer}
                label={drawerOptions.label || 'Extension'}
                width={drawerOptions.width}
                side={drawerOptions.side}
            >
                {drawerContent}
            </OverlayHost>
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
