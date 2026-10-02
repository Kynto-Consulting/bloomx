'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import { ApiError, Badge, Card, DefinitionList, adminFetch, btnPrimary, formatDate, formatDateTime, useAdminQuery, type Tone } from '@/components/admin/console';
import { useStepUp } from '@/components/admin/permissions/useStepUp';
import { safePayPalUrl } from '@/lib/billing/paypal-url';
import { QueryBoundary, goExternal, useFinError } from './shared';
import type { PayPalAccount } from './types';

const TONE: Record<PayPalAccount['status'], Tone> = { linked: 'success', pending_switch: 'warning', disabled: 'danger', none: 'neutral' };

/** Vincula o cambia la cuenta de PayPal del desarrollador ("Log in with PayPal": solo prueba de propiedad, sin tokens guardados). */
export function PayPalAccountCard({ outcome }: { outcome?: { result: 'linked' | 'error'; reason?: string } | null }) {
    const { t, locale } = useI18n();
    const finError = useFinError('billing');
    const q = useAdminQuery<PayPalAccount>('/api/admin/billing/paypal/account');
    const { guard, dialog } = useStepUp();
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const { mutate } = q;
    const linkedNow = outcome?.result === 'linked';
    React.useEffect(() => { if (linkedNow) void mutate(); }, [linkedNow, mutate]);

    const start = () => {
        setError(null);
        setBusy(true);
        void guard(async () => {
            const r = await adminFetch<{ authorizeUrl?: unknown }>('/api/admin/billing/paypal/link/start', { body: {} });
            const url = safePayPalUrl(r.authorizeUrl);
            if (!url) throw new ApiError(502, 'paypal_unavailable');
            goExternal(url);
        })
            .catch((e) => { setError(finError(e)); })
            .finally(() => setBusy(false));
    };

    return (
        <Card title={t('admin.console.billing.account.title')} description={t('admin.console.billing.account.description')}>
            {outcome?.result === 'linked' && <p role="status" className="mb-3 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">{t('admin.console.billing.account.linkedOk')}</p>}
            {outcome?.result === 'error' && (
                <p role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    {t('admin.console.billing.account.linkedError')}{outcome.reason ? ` ${t('admin.console.billing.account.reason', { reason: outcome.reason })}` : ''}
                </p>
            )}
            <QueryBoundary q={q} ns="billing">
                {(a) => (
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={TONE[a.status] ?? 'neutral'}>{t(`admin.console.billing.account.status.${a.status}`)}</Badge>
                        </div>
                        {a.status !== 'none' && (
                            <DefinitionList
                                items={[
                                    { label: t('admin.console.billing.account.email'), value: a.emailMasked ?? '—' },
                                    { label: t('admin.console.billing.account.linkedAt'), value: formatDate(a.linkedAt, locale) },
                                    { label: t('admin.console.billing.account.payouts'), value: a.payoutsEnabled ? t('admin.console.billing.account.payoutsOn') : t('admin.console.billing.account.payoutsOff') },
                                    ...(a.status === 'pending_switch'
                                        ? [
                                            { label: t('admin.console.billing.account.pendingSince'), value: formatDateTime(a.pendingSince, locale) },
                                            { label: t('admin.console.billing.account.effective'), value: formatDateTime(a.switchEffectiveAt, locale) },
                                            { label: t('admin.console.billing.account.previous'), value: a.previousEmailMasked ?? '—' },
                                        ]
                                        : []),
                                ]}
                            />
                        )}
                        {a.status !== 'pending_switch' && a.status !== 'disabled' && (
                            <div className="space-y-2">
                                {a.linked && <p className="text-sm text-muted-foreground">{t('admin.console.billing.account.switchHint')}</p>}
                                <button type="button" className={btnPrimary} onClick={start} disabled={busy} aria-busy={busy || undefined}>
                                    {busy ? t('admin.console.billing.account.redirecting') : a.linked ? t('admin.console.billing.account.switch') : t('admin.console.billing.account.link')}
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </QueryBoundary>
            {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
            {dialog}
        </Card>
    );
}
