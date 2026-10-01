'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import { AlertTriangle } from 'lucide-react';
import { Badge, Card, DefinitionList, ErrorState, LoadingState, StatCard, adminFetch, btnOutline, formatNumber, useAdminQuery } from '@/components/admin/console';
import type { UsageSummary } from '@/lib/ai/usage';
import type { TestResult } from '@/lib/ai/service';
import { formatCost, quotaPercent } from './logic';
import { Notice, useErrorText, type TabProps } from './shared';

export function TestButton({ body, disabled, onResult }: { body?: Record<string, unknown>; disabled?: boolean; onResult?: (r: TestResult) => void }) {
    const { t } = useI18n();
    const errorText = useErrorText();
    const [busy, setBusy] = React.useState(false);
    const [res, setRes] = React.useState<TestResult | null>(null);
    const [err, setErr] = React.useState<string | null>(null);
    const run = async () => {
        setBusy(true); setErr(null); setRes(null);
        try {
            const r = await adminFetch<TestResult>('/api/admin/ai/test', { method: 'POST', body: body ?? {} });
            setRes(r); onResult?.(r);
        } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
    };
    return (
        <div className="space-y-1">
            <button type="button" className={btnOutline} onClick={() => void run()} disabled={busy || disabled} aria-busy={busy || undefined}>
                {busy ? t('admin.ai.test.running') : t('admin.ai.test.button')}
            </button>
            <div aria-live="polite">
                {res && (res.ok
                    ? <Notice msg={{ kind: 'ok', text: t('admin.ai.test.ok', { ms: res.latencyMs, model: res.model ?? '-' }) }} />
                    : <Notice msg={{ kind: 'error', text: t('admin.ai.test.fail', { error: res.error ?? '-' }) }} />)}
                <Notice msg={err ? { kind: 'error', text: err } : null} />
            </div>
        </div>
    );
}

export function SummaryTab({ settings, extensions, level }: TabProps) {
    const { t, intlLocale } = useI18n();
    const { data: usage, error, mutate } = useAdminQuery<UsageSummary>('/api/admin/ai/usage?days=30');
    const total = usage ? usage.totals.tokensIn + usage.totals.tokensOut : 0;
    const q = settings.config.quotas.global;
    const pct = quotaPercent(total, q.tokensMonth);
    const affected = extensions.filter((e) => e.blocked || e.degraded);
    void level;
    return (
        <div className="space-y-4">
            {settings.legacyEnv && (
                <div role="alert" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                    <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{t('admin.ai.summary.legacyEnv')}</span>
                </div>
            )}
            <Card title={t('admin.ai.summary.statusTitle')}>
                <DefinitionList items={[
                    { label: t('admin.ai.summary.state'), value: <Badge tone={settings.enabled ? 'success' : 'neutral'}>{settings.enabled ? t('admin.ai.summary.on') : t('admin.ai.summary.off')}</Badge> },
                    { label: t('admin.ai.summary.configured'), value: <Badge tone={settings.configured ? 'success' : 'warning'}>{settings.configured ? t('admin.ai.summary.yes') : t('admin.ai.summary.no')}</Badge> },
                    { label: t('admin.ai.provider.provider'), value: settings.provider ?? '-' },
                    { label: t('admin.ai.provider.model'), value: settings.model ?? '-' },
                    { label: t('admin.ai.summary.source'), value: t(`admin.ai.summary.sources.${settings.source}`) },
                ]} />
                <div className="mt-3"><TestButton disabled={!settings.configured} /></div>
            </Card>
            <Card title={t('admin.ai.summary.monthTitle')} description={t('admin.ai.summary.monthDesc')}>
                {error && !usage ? <ErrorState message={t('admin.console.common.errors.generic')} onRetry={() => void mutate()} />
                    : !usage ? <LoadingState label={t('admin.console.common.loading')} />
                        : (
                            <div className="grid gap-3 sm:grid-cols-4">
                                <StatCard label={t('admin.ai.usage.requests')} value={formatNumber(usage.totals.requests, intlLocale)} />
                                <StatCard label={t('admin.ai.usage.tokens')} value={formatNumber(total, intlLocale)} hint={pct === null ? undefined : t('admin.ai.summary.ofQuota', { pct })} />
                                <StatCard label={t('admin.ai.usage.errors')} value={formatNumber(usage.totals.errors, intlLocale)} tone={usage.totals.errors ? 'warning' : 'neutral'} />
                                <StatCard label={t('admin.ai.usage.cost')} value={formatCost(usage.totals.costUsd, intlLocale)} />
                            </div>
                        )}
            </Card>
            <Card title={t('admin.ai.summary.extensionsTitle')} description={t('admin.ai.summary.extensionsDesc')}>
                {extensions.length === 0 ? <p className="text-sm text-muted-foreground">{t('admin.ai.summary.noExtensions')}</p> : (
                    <ul className="divide-y divide-border/60">
                        {extensions.map((e) => (
                            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                                <span className="font-medium text-foreground">{e.name}</span>
                                <span className="flex flex-wrap items-center gap-1">
                                    {e.features.map((f) => <Badge key={f}>{t(`admin.ai.features.names.${f}`)}</Badge>)}
                                    {e.blocked && <Badge tone="danger" title={e.reason ?? undefined}>{t('admin.ai.summary.blocked')}</Badge>}
                                    {!e.blocked && e.degraded && <Badge tone="warning" title={e.reason ?? undefined}>{t('admin.ai.summary.degraded')}</Badge>}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
                {affected.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{t('admin.ai.summary.affected', { n: affected.length })}</p>}
            </Card>
        </div>
    );
}
