'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Drawer } from '@/components/ui/Drawer';
import { DRAWER_WIDTH_CLASS, MODAL_WIDTH_CLASS, pick } from './tokens';
import { useKitStrings } from './strings';

export interface OverlayHostProps {
    kind?: 'modal' | 'drawer';
    open: boolean;
    onClose: () => void;
    /** Nombre accesible del dialogo (el contenido suele llevar su propio titulo visible). */
    label: string;
    /** sm|md|lg|xl|full (modal) o sm|md|lg (drawer). Otros valores (p. ej. "420px" heredado) se aproximan. */
    width?: string;
    side?: 'left' | 'right';
    /** false = sin boton cerrar (el contenido lo gestiona). */
    closable?: boolean;
    children: React.ReactNode;
}

/** Aproxima anchos heredados en px ("420px") a la escala nueva. */
export function normalizeWidth(width: unknown): 'sm' | 'md' | 'lg' | 'xl' | 'full' {
    if (typeof width === 'string' && ['sm', 'md', 'lg', 'xl', 'full'].includes(width)) return width as 'sm' | 'md' | 'lg' | 'xl' | 'full';
    const px = parseInt(String(width ?? ''), 10);
    if (!Number.isFinite(px)) return 'md';
    return px <= 460 ? 'sm' : px <= 620 ? 'md' : px <= 800 ? 'lg' : px <= 1000 ? 'xl' : 'full';
}

/**
 * Contenedor accesible de los OVERLAY de las extensiones (modal o cajon): role=dialog, aria-modal, foco atrapado,
 * Escape, restauracion de foco, fondo `bg-overlay`. Lo usan ExpansionUIContext (app) y el renderer (playground/tests).
 */
export function OverlayHost({ kind = 'modal', open, onClose, label, width, side = 'right', closable = true, children }: OverlayHostProps) {
    const strings = useKitStrings();
    const closeButton = closable ? (
        <button
            type="button"
            onClick={onClose}
            aria-label={strings.close}
            className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
            <X size={16} aria-hidden="true" />
        </button>
    ) : null;

    if (kind === 'drawer') {
        const w = pick(normalizeWidth(width) === 'xl' || normalizeWidth(width) === 'full' ? 'lg' : normalizeWidth(width), ['sm', 'md', 'lg'] as const, 'md');
        return (
            <Drawer open={open} onClose={onClose} label={label} side={side} className={`${DRAWER_WIDTH_CLASS[w]} max-w-[90vw] overflow-y-auto`}>
                {closeButton}
                {children}
            </Drawer>
        );
    }

    return (
        <Modal
            open={open}
            onClose={closable ? onClose : () => undefined}
            closeOnBackdrop={closable}
            ariaLabel={label}
            panelClassName={`relative max-h-[85vh] w-full ${MODAL_WIDTH_CLASS[normalizeWidth(width)]} overflow-y-auto rounded-xl border border-border shadow-2xl`}
        >
            {closeButton}
            {children}
        </Modal>
    );
}
