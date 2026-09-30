'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import {
    Badge, Card, ErrorState, Field, LoadingState, adminFetch, apiErrorKey, btnOutline, btnPrimary, formatDateTime, inputClass,
    useAdminQuery, useUnsavedChanges,
} from '@/components/admin/console';
import { DEFAULT_LIMITS, RETENTION_KEYS, type RetentionKey, type SettingsResponse } from './types';

type Drafts = Record<RetentionKey, string>;

function toDrafts(v: SettingsResponse['effective']): Drafts {
    return Object.fromEntries(RETENTION_KEYS.map((k) => [k, String(v[k])])) as Drafts;
}

export function PolicyCard() {
    const { t, intlLocale } = useI18n();
    const { data, error, isLoading, mutate } = useAdminQuery<SettingsResponse>('/api/admin/retention/settings');
    const [drafts, setDrafts] = React.useState<Drafts | null>(null);
    const [busy, setBusy] = React.useState<RetentionKey | 'save' | null>(null);
    const [msg, setMsg] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

    // Reinicia los campos cuando llegan datos nuevos del servidor (primera carga, guardado, restablecer).
    const signature = data ? JSON.stringify([data.effective, data.updatedAt]) : '';
    React.useEffect(() => {
        if (data) setDrafts(toDrafts(data.effective));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signature]);

    const limits = data?.limits ?? DEFAULT_LIMITS;

    const validate = (key: RetentionKey, raw: string): string | null => {
        const s = raw.trim();
        if (!/^\d{1,5}$/.test(s)) return t('admin.console.account.retention.policy.errors.integer');
        const n = Number(s);
        const l = limits[key];
        if (n < l.min || n > l.max) return t('admin.console.account.retention.policy.errors.range', { min: l.min, max: l.max });
        if (l.zeroOrMin !== undefined && n !== 0 && n < l.zeroOrMin) return t('admin.console.account.retention.policy.errors.zeroOrMin', { min: l.zeroOrMin });
        return null;
    };

    const errors = React.useMemo(() => {
        const out: Partial<Record<RetentionKey, string>> = {};
        if (drafts) for (const k of RETENTION_KEYS) { const e = validate(k, drafts[k]); if (e) out[k] = e; }
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drafts, limits, t]);

    const changed = data && drafts ? RETENTION_KEYS.filter((k) => drafts[k].trim() !== String(data.effective[k])) : [];
    const dirty = changed.length > 0;
    useUnsavedChanges(dirty);
    const invalid = RETENTION_KEYS.some((k) => errors[k]);

    const send = async (body: Partial<Record<RetentionKey, number | null>>, who: RetentionKey | 'save') => {
        setBusy(who);
        setMsg(null);
        try {
            const next = await adminFetch<SettingsResponse>('/api/admin/retention/settings', { method: 'PUT', body });
            await mutate(next, { revalidate: false });
            setMsg({ kind: 'ok', text: t(who === 'save' ? 'admin.console.account.retention.policy.saved' : 'admin.console.account.retention.policy.resetDone') });
        } catch (e) {
            setMsg({ kind: 'error', text: t(apiErrorKey(e)) });
        } finally {
            setBusy(null);
        }
    };

    const save = (e: React.FormEvent) => {
        e.preventDefault();
        if (!data || !drafts || invalid || !dirty) return;
        const body: Partial<Record<RetentionKey, number>> = {};
        for (const k of changed) body[k] = Number(drafts[k].trim());
        void send(body, 'save');
    };

    return (
        <Card title={t('admin.console.account.retention.policy.title')} description={t('admin.console.account.retention.policy.description')} id="policy">
            {error && !data ? (
                <ErrorState message={t(apiErrorKey(error))} onRetry={() => void mutate()} />
            ) : isLoading || !data || !drafts ? (
                <LoadingState />
            ) : (
                <form onSubmit={save} noValidate className="space-y-5">
                    <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
                        {RETENTION_KEYS.map((key) => {
                            const id = `retention-${key}`;
                            const fromConsole = data.overrides[key] !== undefined;
                            const err = errors[key];
                            return (
                                <div key={key} className="space-y-2 rounded-lg border border-border/60 p-3">
                                    <Field
                                        label={t(`admin.console.account.retention.policy.fields.${key}.label`)}
                                        htmlFor={id}
                                        hint={t(`admin.console.account.retention.policy.fields.${key}.hint`)}
                                        error={err ?? null}
                                    >
                                        <input
                                            id={id}
                                            type="number"
                                            inputMode="numeric"
                                            min={limits[key].min}
                                            max={limits[key].max}
                                            step={1}
                                            value={drafts[key]}
                                            onChange={(e) => setDrafts({ ...drafts, [key]: e.target.value })}
                                            aria-invalid={!!err || undefined}
                                            aria-describedby={err ? `${id}-err` : `${id}-hint`}
                                            className={inputClass}
                                        />
                                    </Field>
                                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                        <span>{t('admin.console.account.retention.policy.effective', { value: data.effective[key] })}</span>
                                        <Badge tone={fromConsole ? 'info' : 'neutral'}>
                                            {t(fromConsole ? 'admin.console.account.retention.policy.sourceConsole' : 'admin.console.account.retention.policy.sourceEnv')}
                                        </Badge>
                                        {fromConsole && (
                                            <>
                                                <span>{t('admin.console.account.retention.policy.envValue', { value: data.env[key] })}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => void send({ [key]: null }, key)}
                                                    disabled={busy !== null}
                                                    aria-label={t('admin.console.account.retention.policy.resetAria', { name: t(`admin.console.account.retention.policy.fields.${key}.label`) })}
                                                    className="rounded-md border border-border px-2 py-1 font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                                                >
                                                    {t('admin.console.account.retention.policy.reset')}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <button type="submit" className={btnPrimary} disabled={!dirty || invalid || busy !== null} aria-busy={busy === 'save' || undefined}>
                            {t('admin.console.account.retention.policy.save')}
                        </button>
                        <button type="button" className={btnOutline} disabled={!dirty || busy !== null} onClick={() => setDrafts(toDrafts(data.effective))}>
                            {t('admin.console.account.retention.policy.discard')}
                        </button>
                        <p className="text-xs text-muted-foreground">
                            {data.updatedAt
                                ? t('admin.console.account.retention.policy.updated', { date: formatDateTime(data.updatedAt, intlLocale), by: data.updatedBy ?? '—' })
                                : t('admin.console.account.retention.policy.neverUpdated')}
                        </p>
                    </div>
                    <div role="status" aria-live="polite" className="min-h-[1.25rem] text-sm">
                        {msg && <p className={msg.kind === 'error' ? 'text-destructive' : 'text-success'} role={msg.kind === 'error' ? 'alert' : undefined}>{msg.text}</p>}
                    </div>
                    <p className="text-xs text-muted-foreground">{t('admin.console.account.retention.policy.note')}</p>
                </form>
            )}
        </Card>
    );
}
