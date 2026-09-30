'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { useDialog, type UseDialogOptions } from './useDialog';

export interface ModalProps {
    open: boolean;
    onClose: () => void;
    /** Nombre accesible si no hay un titulo visible. */
    ariaLabel?: string;
    /** id del elemento de titulo. Usa `titleId` que entrega el render-prop, o pasa uno propio. */
    ariaLabelledBy?: string;
    /** Clases del contenedor a pantalla completa (posicionamiento del panel). */
    className?: string;
    /** Clases del panel. */
    panelClassName?: string;
    /** Clases del fondo oscuro. */
    backdropClassName?: string;
    /** Cerrar al pulsar el fondo (por defecto si). */
    closeOnBackdrop?: boolean;
    dialogOptions?: UseDialogOptions;
    children: React.ReactNode | ((ctx: { titleId: string; descriptionId: string }) => React.ReactNode);
}

/**
 * Dialogo modal accesible: role="dialog", aria-modal, foco atrapado, Escape, restauracion de foco.
 * El fondo NO es un boton enfocable (evita un tab-stop fantasma); se cierra con clic o Escape.
 */
export function Modal({
    open,
    onClose,
    ariaLabel,
    ariaLabelledBy,
    className,
    panelClassName,
    backdropClassName,
    closeOnBackdrop = true,
    dialogOptions,
    children,
}: ModalProps) {
    const { ref, titleId, descriptionId } = useDialog<HTMLDivElement>(open, onClose, dialogOptions);
    if (!open) return null;
    return (
        <div className={cn('fixed inset-0 z-[100] flex items-center justify-center p-4', className)}>
            <div
                aria-hidden="true"
                className={cn('absolute inset-0 bg-overlay', backdropClassName)}
                onMouseDown={closeOnBackdrop ? onClose : undefined}
            />
            <div
                ref={ref}
                role="dialog"
                aria-modal="true"
                aria-label={ariaLabelledBy ? undefined : ariaLabel}
                aria-labelledby={ariaLabelledBy ?? (ariaLabel ? undefined : titleId)}
                tabIndex={-1}
                className={cn('relative bg-card text-card-foreground outline-none', panelClassName)}
            >
                {typeof children === 'function' ? children({ titleId, descriptionId }) : children}
            </div>
        </div>
    );
}
