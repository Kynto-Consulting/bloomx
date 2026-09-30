'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/Modal';
import { useI18n } from '@/components/I18nProvider';
import { ApiError, Field, adminFetch, apiErrorKey, btnOutline, btnPrimary, inputClass } from '@/components/admin/console';
import { generatePassword } from './password';
import { TempPasswordBox } from './TempPasswordBox';

interface CreateResponse {
    success: boolean;
    user: { id: string; email: string; name: string | null };
    temporaryPassword?: string;
}

/**
 * Alta de usuario. Politica visible (12+ caracteres), generador de contrasena y, si se deja vacia, el servidor genera una
 * temporal que se muestra UNA sola vez con boton de copiar.
 */
export function CreateUserModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
    const { t } = useI18n();
    const uid = React.useId();
    const [email, setEmail] = React.useState('');
    const [name, setName] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [show, setShow] = React.useState(false);
    const [mustChange, setMustChange] = React.useState(true);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [result, setResult] = React.useState<{ email: string; temporaryPassword: string } | null>(null);

    React.useEffect(() => {
        if (!open) {
            setEmail(''); setName(''); setPassword(''); setShow(false); setMustChange(true); setBusy(false); setError(null); setResult(null);
        }
    }, [open]);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
            const res = await adminFetch<CreateResponse>('/api/admin/users', {
                method: 'POST',
                body: { email: email.trim(), name: name.trim() || undefined, password: password || undefined, mustChangePassword: mustChange },
            });
            onCreated();
            if (res.temporaryPassword) {
                setResult({ email: res.user.email, temporaryPassword: res.temporaryPassword });
            } else {
                toast.success(t('admin.console.users.toast.created'));
                onClose();
            }
        } catch (err) {
            if (err instanceof ApiError && err.code === 'user_exists') setError(t('admin.console.users.error.exists'));
            else if (err instanceof ApiError && err.code === 'weak_password') setError(t('admin.console.users.error.weakPassword'));
            else setError(t(apiErrorKey(err)));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            open={open}
            onClose={busy ? () => undefined : onClose}
            closeOnBackdrop={!busy && !result}
            panelClassName="w-full max-w-lg rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl"
        >
            {({ titleId, descriptionId }) =>
                result ? (
                    <div>
                        <h2 id={titleId} className="text-base font-semibold text-foreground">{t('admin.console.users.createModal.doneTitle')}</h2>
                        <p id={descriptionId} className="mt-2 text-sm text-muted-foreground">{t('admin.console.users.createModal.doneBody')}</p>
                        <p className="mt-3 text-sm text-foreground">{result.email}</p>
                        <div className="mt-3">
                            <TempPasswordBox value={result.temporaryPassword} label={t('admin.console.users.createModal.tempLabel')} copyLabel={t('admin.console.users.createModal.copy')} />
                        </div>
                        <div className="mt-5 flex justify-end">
                            <button type="button" className={btnPrimary} onClick={onClose}>{t('admin.console.users.createModal.close')}</button>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={submit} noValidate={false}>
                        <h2 id={titleId} className="text-base font-semibold text-foreground">{t('admin.console.users.createModal.title')}</h2>
                        <p id={descriptionId} className="mt-1 text-xs text-muted-foreground">{t('admin.console.users.createModal.policy')}</p>
                        <div className="mt-4 space-y-3">
                            <Field label={t('admin.console.users.createModal.email')} htmlFor={`${uid}-email`} required>
                                <input id={`${uid}-email`} type="email" required maxLength={254} autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
                            </Field>
                            <Field label={t('admin.console.users.createModal.name')} htmlFor={`${uid}-name`}>
                                <input id={`${uid}-name`} type="text" maxLength={200} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
                            </Field>
                            <Field label={t('admin.console.users.createModal.password')} htmlFor={`${uid}-pw`} hint={t('admin.console.users.createModal.passwordHint')}>
                                <div className="flex flex-wrap gap-2">
                                    <input
                                        id={`${uid}-pw`}
                                        type={show ? 'text' : 'password'}
                                        autoComplete="new-password"
                                        maxLength={1024}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        aria-describedby={`${uid}-pw-hint`}
                                        className={`${inputClass} min-w-0 flex-1 font-mono`}
                                    />
                                    <button type="button" className={btnOutline} onClick={() => { setPassword(generatePassword()); setShow(true); }}>
                                        {t('admin.console.users.createModal.generate')}
                                    </button>
                                    <button type="button" className={btnOutline} aria-pressed={show} onClick={() => setShow((s) => !s)}>
                                        {show ? t('admin.console.users.createModal.hide') : t('admin.console.users.createModal.show')}
                                    </button>
                                </div>
                            </Field>
                            <label className="flex items-center gap-2 text-sm text-foreground">
                                <input type="checkbox" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} className="h-4 w-4 rounded border-input accent-primary" />
                                {t('admin.console.users.createModal.mustChange')}
                            </label>
                        </div>
                        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
                        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                            <button type="button" className={btnOutline} onClick={onClose} disabled={busy}>{t('admin.console.common.cancel')}</button>
                            <button type="submit" className={btnPrimary} disabled={busy || !email.trim()} aria-busy={busy || undefined}>
                                {busy ? t('admin.console.users.createModal.creating') : t('admin.console.users.createModal.submit')}
                            </button>
                        </div>
                    </form>
                )
            }
        </Modal>
    );
}
