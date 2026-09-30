'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { Card, Field, adminFetch, btnPrimary, inputClass } from '@/components/admin/console';
import { errorText } from './helpers';

const MIN_LENGTH = 12;

/** Cambio de contrasena propio (admins kind "user"). PUT /api/admin/profile/password. */
export function PasswordSection({ mustChange }: { mustChange?: boolean }) {
    const { t } = useI18n();
    const uid = React.useId();
    const [current, setCurrent] = React.useState('');
    const [next, setNext] = React.useState('');
    const [confirm, setConfirm] = React.useState('');
    const [errors, setErrors] = React.useState<{ current?: string; next?: string; confirm?: string }>({});
    const [serverError, setServerError] = React.useState<string | null>(null);
    const [success, setSuccess] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const p = (k: string) => t(`admin.console.profile.password.${k}`);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSuccess(false);
        setServerError(null);
        const v: typeof errors = {};
        if (!current) v.current = p('required');
        if (next.length < MIN_LENGTH) v.next = p('tooShort');
        else if (next === current) v.next = p('same');
        if (confirm !== next) v.confirm = p('mismatch');
        setErrors(v);
        if (v.current || v.next || v.confirm) return;

        setBusy(true);
        try {
            await adminFetch('/api/admin/profile/password', { method: 'PUT', body: { currentPassword: current, newPassword: next } });
            setCurrent('');
            setNext('');
            setConfirm('');
            setSuccess(true);
        } catch (err) {
            setServerError(errorText(t, err, 'password'));
        } finally {
            setBusy(false);
        }
    };

    const ids = { cur: `${uid}-cur`, next: `${uid}-new`, conf: `${uid}-conf` };
    return (
        <Card title={p('title')} description={p('description')}>
            {mustChange && (
                <p role="status" className="mb-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                    {t('admin.console.profile.header.mustChange')}
                </p>
            )}
            <form onSubmit={submit} noValidate className="grid max-w-md gap-4">
                <Field label={p('current')} htmlFor={ids.cur} error={errors.current} required>
                    <input id={ids.cur} type="password" autoComplete="current-password" className={inputClass} value={current}
                        onChange={(e) => setCurrent(e.target.value)} aria-invalid={!!errors.current} aria-describedby={errors.current ? `${ids.cur}-err` : undefined} />
                </Field>
                <Field label={p('new')} htmlFor={ids.next} hint={p('hint')} error={errors.next} required>
                    <input id={ids.next} type="password" autoComplete="new-password" minLength={MIN_LENGTH} className={inputClass} value={next}
                        onChange={(e) => setNext(e.target.value)} aria-invalid={!!errors.next}
                        aria-describedby={errors.next ? `${ids.next}-err` : `${ids.next}-hint`} />
                </Field>
                <Field label={p('confirm')} htmlFor={ids.conf} error={errors.confirm} required>
                    <input id={ids.conf} type="password" autoComplete="new-password" className={inputClass} value={confirm}
                        onChange={(e) => setConfirm(e.target.value)} aria-invalid={!!errors.confirm} aria-describedby={errors.confirm ? `${ids.conf}-err` : undefined} />
                </Field>
                {serverError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{serverError}</p>}
                <div aria-live="polite">
                    {success && <p role="status" className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">{p('success')}</p>}
                </div>
                <div>
                    <button type="submit" className={btnPrimary} disabled={busy} aria-busy={busy || undefined}>
                        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                        {busy ? p('submitting') : p('submit')}
                    </button>
                </div>
            </form>
        </Card>
    );
}
