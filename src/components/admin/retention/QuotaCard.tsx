'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import {
    Badge, Card, ErrorState, Field, LoadingState, adminFetch, apiErrorKey, btnOutline, btnPrimary, formatDateTime, inputClass,
    useAdminQuery, useUnsavedChanges,
} from '@/components/admin/console';
import type { QuotaSettingsResponse } from './types';

/** Cuota de buzon del dominio (MB por usuario) y bloqueo opcional de envio al 100 %. Escribe AdminSetting via PUT .../retention/quota. */
export function QuotaCard() {
    const { t, intlLocale } = useI18n();
    const { data, error, isLoading, mutate } = useAdminQuery<QuotaSettingsResponse>('/api/admin/retention/quota');
    const [mb, setMb] = React.useState<string | null>(null);
    const [enforce, setEnforce] = React.useState(false);
    const [busy, setBusy] = React.useState<'save' | 'reset' | null>(null);
    const [msg, setMsg] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

    // Reinicia los campos cuando llegan datos nuevos del servidor (primera carga, guardado, restablecer).
    const signature = data ? JSON.stringify([data.mailQuotaMb, data.enforceMailQuota, data.effectiveMb, data.updatedAt]) : '';
    React.useEffect(() => {
        if (data) {
            setMb(String(data.effectiveMb ?? 0));
            setEnforce(data.enforceMailQuota);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signature]);

    const maxMb = data?.maxMb ?? 10_000_000;
    const error1 = React.useMemo(() => {
        if (mb === null) return null;
        const s = mb.trim();
        if (!/^\d{1,8}$/.test(s)) return t('admin.console.account.retention.quota.errors.integer');
        if (Number(s) > maxMb) return t('admin.console.account.retention.quota.errors.range', { max: maxMb });
        return null;
    }, [mb, maxMb, t]);

    const mbChanged = data && mb !== null ? mb.trim() !== String(data.effectiveMb ?? 0) : false;
    const enforceChanged = data ? enforce !== data.enforceMailQuota : false;
    const dirty = mbChanged || enforceChanged;
    useUnsavedChanges(dirty);

    const send = async (body: { mailQuotaMb?: number | null; enforceMailQuota?: boolean | null }, who: 'save' | 'reset') => {
        setBusy(who);
        setMsg(null);
        try {
            const next = await adminFetch<QuotaSettingsResponse>('/api/admin/retention/quota', { method: 'PUT', body });
            await mutate(next, { revalidate: false });
            setMsg({ kind: 'ok', text: t(who === 'save' ? 'admin.console.account.retention.quota.saved' : 'admin.console.account.retention.quota.resetDone') });
        } catch (e) {
            setMsg({ kind: 'error', text: t(apiErrorKey(e)) });
        } finally {
            setBusy(null);
        }
    };

    const save = (e: React.FormEvent) => {
        e.preventDefault();
        if (!data || mb === null || error1 || !dirty) return;
        const body: { mailQuotaMb?: number; enforceMailQuota?: boolean } = {};
        if (mbChanged) body.mailQuotaMb = Number(mb.trim());
        if (enforceChanged) body.enforceMailQuota = enforce;
        void send(body, 'save');
    };

    const effectiveText = data?.effectiveMb ? `${data.effectiveMb} MB` : t('admin.console.account.retention.quota.unlimited');
    const sourceKey = data?.source === 'console' ? 'sourceConsole' : data?.source === 'env' ? 'sourceEnv' : 'sourceNone';

    return (
        <Card title={t('admin.console.account.retention.quota.title')} description={t('admin.console.account.retention.quota.description')} id="quota">
            {error && !data ? (
                <ErrorState message={t(apiErrorKey(error))} onRetry={() => void mutate()} />
            ) : isLoading || !data || mb === null ? (
                <LoadingState />
            ) : (
                <form onSubmit={save} noValidate className="space-y-5">
                    <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
                        <div className="space-y-2 rounded-lg border border-border/60 p-3">
                            <Field
                                label={t('admin.console.account.retention.quota.fields.mailQuotaMb.label')}
                                htmlFor="retention-quota-mb"
                                hint={t('admin.console.account.retention.quota.fields.mailQuotaMb.hint')}
                                error={error1}
                            >
                                <input
                                    id="retention-quota-mb"
                                    type="number"
                                    inputMode="numeric"
                                    min={0}
                                    max={maxMb}
                                    step={1}
                                    value={mb}
                                    onChange={(e) => setMb(e.target.value)}
                                    aria-invalid={!!error1 || undefined}
                                    aria-describedby={error1 ? 'retention-quota-mb-err' : 'retention-quota-mb-hint'}
                                    className={inputClass}
                                />
                            </Field>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span>{t('admin.console.account.retention.quota.effective', { value: effectiveText })}</span>
                                <Badge tone={data.source === 'console' ? 'info' : 'neutral'}>{t(`admin.console.account.retention.quota.${sourceKey}`)}</Badge>
                                {data.source === 'console' && (
                                    <button
                                        type="button"
                                        onClick={() => void send({ mailQuotaMb: null }, 'reset')}
                                        disabled={busy !== null}
                                        aria-label={t('admin.console.account.retention.quota.resetAria')}
                                        className="rounded-md border border-border px-2 py-1 font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                                    >
                                        {t('admin.console.account.retention.quota.reset')}
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="space-y-2 rounded-lg border border-border/60 p-3">
                            <div className="flex items-start gap-3">
                                <input
                                    id="retention-quota-enforce"
                                    type="checkbox"
                                    checked={enforce}
                                    onChange={(e) => setEnforce(e.target.checked)}
                                    aria-describedby="retention-quota-enforce-hint"
                                    className="mt-1 h-4 w-4 rounded border-input accent-primary"
                                />
                                <label htmlFor="retention-quota-enforce" className="text-sm font-medium text-foreground">
                                    {t('admin.console.account.retention.quota.fields.enforce.label')}
                                </label>
                            </div>
                            <p id="retention-quota-enforce-hint" className="text-xs text-muted-foreground">
                                {t('admin.console.account.retention.quota.fields.enforce.hint')}
                            </p>
                            {enforce && (mb.trim() === '0' || mb.trim() === '') && (
                                <p role="status" className="text-xs text-warning">{t('admin.console.account.retention.quota.enforceNoLimit')}</p>
                            )}
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <button type="submit" className={btnPrimary} disabled={!dirty || !!error1 || busy !== null} aria-busy={busy === 'save' || undefined}>
                            {t('admin.console.account.retention.quota.save')}
                        </button>
                        <button
                            type="button"
                            className={btnOutline}
                            disabled={!dirty || busy !== null}
                            onClick={() => { setMb(String(data.effectiveMb ?? 0)); setEnforce(data.enforceMailQuota); }}
                        >
                            {t('admin.console.account.retention.quota.discard')}
                        </button>
                        <p className="text-xs text-muted-foreground">
                            {data.updatedAt
                                ? t('admin.console.account.retention.quota.updated', { date: formatDateTime(data.updatedAt, intlLocale), by: data.updatedBy ?? '—' })
                                : t('admin.console.account.retention.quota.neverUpdated')}
                        </p>
                    </div>
                    <div role="status" aria-live="polite" className="min-h-[1.25rem] text-sm">
                        {msg && <p className={msg.kind === 'error' ? 'text-destructive' : 'text-success'} role={msg.kind === 'error' ? 'alert' : undefined}>{msg.text}</p>}
                    </div>
                    <p className="text-xs text-muted-foreground">{t('admin.console.account.retention.quota.note')}</p>
                </form>
            )}
        </Card>
    );
}
