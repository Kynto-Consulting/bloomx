'use client';

import * as React from 'react';
import { Modal } from './Modal';
import { cn } from '@/lib/utils';

export interface ConfirmDialogProps {
    open: boolean;
    title: string;
    description: React.ReactNode;
    confirmLabel: string;
    cancelLabel: string;
    /** Estilo de accion destructiva; el foco inicial va a "Cancelar". */
    destructive?: boolean;
    /** Mientras es true no se puede cerrar ni confirmar de nuevo. */
    busy?: boolean;
    /** Error a mostrar (role="alert") si la accion fallo. */
    error?: string | null;
    onConfirm: () => void;
    onCancel: () => void;
}

/** Confirmacion accesible (role="dialog", foco atrapado, Escape). Reutiliza Modal/useDialog. */
export function ConfirmDialog({
    open, title, description, confirmLabel, cancelLabel, destructive, busy, error, onConfirm, onCancel,
}: ConfirmDialogProps) {
    const cancelRef = React.useRef<HTMLButtonElement>(null);
    return (
        <Modal
            open={open}
            onClose={busy ? () => undefined : onCancel}
            closeOnBackdrop={!busy}
            dialogOptions={{ disableEscape: busy, initialFocus: () => (destructive ? cancelRef.current : undefined) }}
            panelClassName="w-full max-w-md rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl"
        >
            {({ titleId, descriptionId }) => (
                <div role="document">
                    <h2 id={titleId} className="text-base font-semibold text-foreground">{title}</h2>
                    <div id={descriptionId} className="mt-2 text-sm text-muted-foreground">{description}</div>
                    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
                    <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <button
                            ref={cancelRef}
                            type="button"
                            onClick={onCancel}
                            disabled={busy}
                            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
                        >
                            {cancelLabel}
                        </button>
                        <button
                            type="button"
                            onClick={onConfirm}
                            disabled={busy}
                            aria-busy={busy || undefined}
                            className={cn(
                                'rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50',
                                destructive
                                    ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                                    : 'bg-primary text-primary-foreground hover:bg-primary/90',
                            )}
                        >
                            {confirmLabel}
                        </button>
                    </div>
                </div>
            )}
        </Modal>
    );
}
