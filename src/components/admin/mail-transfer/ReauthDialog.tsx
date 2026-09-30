'use client';

import * as React from 'react';
import { Modal } from '@/components/ui/Modal';
import { useI18n } from '@/components/I18nProvider';
import { ApiError, Field, adminFetch, btnOutline, btnPrimary, inputClass } from '@/components/admin/console';

/**
 * Re-autenticacion reciente (10 min) para operaciones que mueven correo de otros usuarios: contrasena o codigo MFA.
 * Al verificar, el servidor deja una cookie httpOnly ligada al administrador; aqui solo se notifica el exito.
 */
export function ReauthDialog({
    open, base, mfaEnrolled, canUsePassword = true, isAdmin = true, onVerified, onClose,
}: { open: boolean; base: string; mfaEnrolled: boolean; canUsePassword?: boolean; isAdmin?: boolean; onVerified: () => void; onClose: () => void }) {
    const { t } = useI18n();
    const uid = React.useId();
    const [useCode, setUseCode] = React.useState(false);
    const [value, setValue] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (open) { setValue(''); setError(null); setBusy(false); setUseCode(!canUsePassword && mfaEnrolled); }
    }, [open, canUsePassword, mfaEnrolled]);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (busy || !value) return;
        setBusy(true);
        setError(null);
        try {
            await adminFetch(`${base}/reauth`, { method: 'POST', body: useCode ? { code: value.replace(/\s+/g, '') } : { password: value } });
            onVerified();
        } catch (err) {
            if (err instanceof ApiError && err.status === 429) setError(t('admin.console.transfer.reauth.tooMany'));
            else if (err instanceof ApiError && err.status === 401) setError(t('admin.console.transfer.reauth.invalid'));
            else setError(t('admin.console.transfer.errors.generic'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal open={open} onClose={busy ? () => undefined : onClose} closeOnBackdrop={!busy} panelClassName="w-full max-w-md rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl">
            {({ titleId, descriptionId }) => (
                <form onSubmit={submit} aria-describedby={descriptionId}>
                    <h2 id={titleId} className="text-base font-semibold text-foreground">{t('admin.console.transfer.reauth.title')}</h2>
                    <p id={descriptionId} className="mt-2 text-sm text-muted-foreground">{t('admin.console.transfer.reauth.body', { minutes: 10 })}</p>
                    <div className="mt-4">
                        <Field label={useCode ? t('admin.console.transfer.reauth.code') : t('admin.console.transfer.reauth.password')} htmlFor={`${uid}-v`}>
                            <input
                                id={`${uid}-v`}
                                type={useCode ? 'text' : 'password'}
                                inputMode={useCode ? 'numeric' : undefined}
                                autoComplete={useCode ? 'one-time-code' : 'current-password'}
                                autoFocus
                                value={value}
                                onChange={(e) => setValue(e.target.value)}
                                className={inputClass}
                                aria-invalid={error ? true : undefined}
                                aria-describedby={error ? `${uid}-err` : undefined}
                                disabled={busy}
                            />
                        </Field>
                    </div>
                    {error && <p id={`${uid}-err`} role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
                    {mfaEnrolled && canUsePassword && (
                        <button type="button" className="mt-3 text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { setUseCode((c) => !c); setValue(''); setError(null); }}>
                            {useCode ? t('admin.console.transfer.reauth.usePassword') : t('admin.console.transfer.reauth.useCode')}
                        </button>
                    )}
                    {isAdmin && !mfaEnrolled && <p className="mt-3 text-xs text-muted-foreground">{t('admin.console.transfer.reauth.noMfaTip')}</p>}
                    <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <button type="button" className={btnOutline} onClick={onClose} disabled={busy}>{t('admin.console.transfer.common.cancel')}</button>
                        <button type="submit" className={btnPrimary} disabled={busy || !value} aria-busy={busy || undefined}>
                            {busy ? t('admin.console.transfer.reauth.verifying') : t('admin.console.transfer.reauth.submit')}
                        </button>
                    </div>
                </form>
            )}
        </Modal>
    );
}
