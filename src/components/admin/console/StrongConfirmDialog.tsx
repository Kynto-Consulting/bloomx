'use client';

import * as React from 'react';
import { Modal } from '@/components/ui/Modal';
import { useI18n } from '@/components/I18nProvider';
import { btnDanger, btnOutline, inputClass } from './ui';
import { cn } from '@/lib/utils';

/**
 * Confirmacion FUERTE para acciones sensibles (restablecer MFA, ejecutar retencion...): el admin debe escribir una frase
 * (p. ej. el correo del usuario) para habilitar el boton. Mismo patron accesible que ConfirmDialog (Modal/useDialog:
 * foco atrapado, Escape, foco inicial en el campo). El boton de confirmar sigue deshabilitado mientras `busy`.
 */
export function StrongConfirmDialog({
    open, title, description, phrase, confirmLabel, cancelLabel, busy, error, onConfirm, onCancel, destructive = true,
}: {
    open: boolean; title: string; description: React.ReactNode; phrase: string; confirmLabel: string; cancelLabel: string;
    busy?: boolean; error?: string | null; onConfirm: () => void; onCancel: () => void; destructive?: boolean;
}) {
    const { t } = useI18n();
    const [text, setText] = React.useState('');
    const uid = React.useId();
    React.useEffect(() => { if (!open) setText(''); }, [open]);
    const matches = text.trim().toLowerCase() === phrase.trim().toLowerCase() && phrase.trim() !== '';
    return (
        <Modal
            open={open}
            onClose={busy ? () => undefined : onCancel}
            closeOnBackdrop={!busy}
            dialogOptions={{ disableEscape: busy }}
            panelClassName="w-full max-w-md rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl"
        >
            {({ titleId, descriptionId }) => (
                <form
                    onSubmit={(e) => { e.preventDefault(); if (matches && !busy) onConfirm(); }}
                    aria-describedby={descriptionId}
                >
                    <h2 id={titleId} className="text-base font-semibold text-foreground">{title}</h2>
                    <div id={descriptionId} className="mt-2 text-sm text-muted-foreground">{description}</div>
                    <label htmlFor={`${uid}-phrase`} className="mt-4 block text-sm font-medium text-foreground">
                        {t('admin.console.common.strongConfirm.typeToConfirm', { phrase })}
                    </label>
                    <input
                        id={`${uid}-phrase`}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={busy}
                        className={cn(inputClass, 'mt-1')}
                    />
                    {text && !matches && <p className="mt-1 text-xs text-muted-foreground">{t('admin.console.common.strongConfirm.mismatch')}</p>}
                    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
                    <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <button type="button" onClick={onCancel} disabled={busy} className={btnOutline}>{cancelLabel}</button>
                        <button
                            type="submit"
                            disabled={!matches || busy}
                            aria-busy={busy || undefined}
                            className={destructive ? btnDanger : 'inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50'}
                        >
                            {confirmLabel}
                        </button>
                    </div>
                </form>
            )}
        </Modal>
    );
}
