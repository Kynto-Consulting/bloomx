'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ApiError, Badge, Card, DefinitionList, EmptyState, adminFetch, btnOutline, btnPrimary, formatDate, useAdminQuery, type Tone } from '@/components/admin/console';
import { useStepUp } from '@/components/admin/permissions/useStepUp';
import { safePayPalUrl } from '@/lib/billing/paypal-url';
import { QueryBoundary, goExternal, useFinError, useMoney } from './shared';
import type { SubscriptionItem } from './types';

const TONE: Record<string, Tone> = { ACTIVE: 'success', TRIAL: 'info', PENDING: 'neutral', PAST_DUE: 'warning', SUSPENDED: 'warning', CANCELLED: 'neutral', EXPIRED: 'neutral' };

export function SubscriptionsTab() {
    const { t } = useI18n();
    const q = useAdminQuery<{ items: SubscriptionItem[] }>('/api/admin/billing/subscriptions');
    const [notice, setNotice] = React.useState('');
    return (
        <div className="space-y-4">
            <div aria-live="polite" className="sr-only">{notice}</div>
            <QueryBoundary q={q} ns="billing">
                {(d) => (d.items.length === 0
                    ? <Card><EmptyState title={t('admin.console.billing.subscriptions.empty')} /></Card>
                    : <ul aria-label={t('admin.console.billing.subscriptions.caption')} className="space-y-4">
                        {d.items.map((s) => <li key={s.id}><SubscriptionCard sub={s} onChanged={async (msg) => { setNotice(msg); await q.mutate(); }} /></li>)}
                    </ul>)}
            </QueryBoundary>
            {notice && <p role="status" className="text-sm text-success">{notice}</p>}
        </div>
    );
}

function SubscriptionCard({ sub, onChanged }: { sub: SubscriptionItem; onChanged: (message: string) => Promise<void> }) {
    const { t, locale } = useI18n();
    const money = useMoney();
    const finError = useFinError('billing');
    const { guard, dialog } = useStepUp();
    const [busy, setBusy] = React.useState<string | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [confirmCancel, setConfirmCancel] = React.useState(false);
    const statusLabel = t(`admin.console.billing.subscriptions.status.${sub.status}`);
    const other = sub.interval === 'month' ? 'year' : 'month';
    const live = sub.status === 'ACTIVE' || sub.status === 'TRIAL' || sub.status === 'PAST_DUE';
    const base = `/api/admin/billing/subscriptions/${encodeURIComponent(sub.id)}`;

    const run = (name: string, job: () => Promise<string | null>) => {
        setError(null);
        setBusy(name);
        void guard(async () => {
            const message = await job();
            if (message) await onChanged(message);
        })
            .catch((e) => setError(finError(e)))
            .finally(() => { setBusy(null); setConfirmCancel(false); });
    };

    const cancel = () => run('cancel', async () => { await adminFetch(`${base}/cancel`, { body: {} }); return t('admin.console.billing.subscriptions.done.cancel'); });
    const resume = () => run('resume', async () => {
        // Una suscripcion cancelada se reanuda creando una NUEVA que el comprador debe aprobar en PayPal.
        const r = await adminFetch<{ approveUrl?: unknown }>(`${base}/resume`, { body: {} });
        if (r.approveUrl !== undefined) {
            const url = safePayPalUrl(r.approveUrl);
            if (!url) throw new ApiError(502, 'paypal_unavailable');
            goExternal(url);
            return null;
        }
        return t('admin.console.billing.subscriptions.done.resume');
    });
    const approve = () => run('approve', async () => {
        const r = await adminFetch<{ approveUrl?: unknown }>(`${base}/approve-price`, { body: {} });
        const url = safePayPalUrl(r.approveUrl);
        if (!url) throw new ApiError(502, 'paypal_unavailable');
        goExternal(url);
        return null;
    });
    const doSwitch = () => run('switch', async () => {
        const r = await adminFetch<{ effective?: string; approveUrl?: unknown }>(`${base}/switch`, { body: { interval: other } });
        if (r.approveUrl !== undefined) {
            const url = safePayPalUrl(r.approveUrl);
            if (!url) throw new ApiError(502, 'paypal_unavailable');
            goExternal(url);
            return null;
        }
        return r.effective === 'immediate' ? t('admin.console.billing.subscriptions.switchedNow') : t('admin.console.billing.subscriptions.switchedNext');
    });

    const items = [
        { label: t('admin.console.billing.subscriptions.price'), value: `${money(sub.priceCents, sub.currency)} / ${t(`admin.console.billing.subscriptions.interval.${sub.interval}`).toLowerCase()}` },
        ...(sub.status === 'TRIAL' && sub.trialEndsAt ? [{ label: t('admin.console.billing.subscriptions.trialEnds'), value: formatDate(sub.trialEndsAt, locale) }] : []),
        ...(live && !sub.cancelAtPeriodEnd && sub.nextRenewalAt ? [{ label: t('admin.console.billing.subscriptions.nextRenewal'), value: formatDate(sub.nextRenewalAt, locale) }] : []),
        ...(sub.accessUntil ? [{ label: t('admin.console.billing.subscriptions.accessUntil'), value: formatDate(sub.accessUntil, locale) }] : []),
        ...(sub.status === 'PAST_DUE' && sub.graceUntil ? [{ label: t('admin.console.billing.subscriptions.graceUntil'), value: formatDate(sub.graceUntil, locale) }] : []),
    ];

    return (
        <Card
            title={<span className="break-all">{sub.extensionId}</span>}
            headingLevel={3}
            actions={<Badge tone={TONE[sub.status] ?? 'neutral'}>{statusLabel}</Badge>}
        >
            <DefinitionList items={items} />
            {sub.cancelAtPeriodEnd && <p className="mt-3 text-sm text-muted-foreground">{t('admin.console.billing.subscriptions.cancelAtEnd')}</p>}
            {sub.pendingPrice && (
                <div role="status" className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
                    {t('admin.console.billing.subscriptions.priceChange', { price: money(sub.pendingPrice.cents, sub.currency) })}
                </div>
            )}
            {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
                {live && sub.cancelAtPeriodEnd && <button type="button" className={btnPrimary} onClick={resume} disabled={busy !== null} aria-busy={busy === 'resume' || undefined}>{t('admin.console.billing.subscriptions.resume')}</button>}
                {live && !sub.cancelAtPeriodEnd && <button type="button" className={btnOutline} onClick={() => setConfirmCancel(true)} disabled={busy !== null}>{t('admin.console.billing.subscriptions.cancel')}</button>}
                {live && !sub.cancelAtPeriodEnd && <button type="button" className={btnOutline} onClick={doSwitch} disabled={busy !== null} aria-busy={busy === 'switch' || undefined}>{other === 'year' ? t('admin.console.billing.subscriptions.switchYear') : t('admin.console.billing.subscriptions.switchMonth')}</button>}
                {sub.pendingPrice && <button type="button" className={btnPrimary} onClick={approve} disabled={busy !== null} aria-busy={busy === 'approve' || undefined}>{t('admin.console.billing.subscriptions.approvePrice')}</button>}
            </div>
            <details className="mt-4 text-sm">
                <summary className="cursor-pointer font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('admin.console.billing.subscriptions.charges')}</summary>
                {sub.charges.length === 0
                    ? <p className="mt-2 text-muted-foreground">{t('admin.console.billing.subscriptions.noCharges')}</p>
                    : <ul className="mt-2 divide-y divide-border/60">
                        {sub.charges.map((c) => (
                            <li key={c.orderId} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                                <span>{formatDate(c.capturedAt, locale)}</span>
                                <span className="font-medium">{money(c.amountCents, sub.currency)}</span>
                                <Badge tone={c.status === 'CAPTURED' ? 'success' : c.status === 'FAILED' ? 'danger' : 'neutral'}>{t(`admin.console.billing.status.${c.status}`) === `admin.console.billing.status.${c.status}` ? c.status : t(`admin.console.billing.status.${c.status}`)}</Badge>
                            </li>
                        ))}
                    </ul>}
            </details>
            <ConfirmDialog
                open={confirmCancel}
                title={t('admin.console.billing.subscriptions.cancelTitle', { name: sub.extensionId })}
                description={t('admin.console.billing.subscriptions.cancelBody')}
                confirmLabel={t('admin.console.billing.subscriptions.cancelConfirm')}
                cancelLabel={t('admin.console.billing.subscriptions.keep')}
                destructive
                busy={busy === 'cancel'}
                onConfirm={cancel}
                onCancel={() => setConfirmCancel(false)}
            />
            {dialog}
        </Card>
    );
}
