'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useI18n } from '@/components/I18nProvider';
import { Badge, ErrorState, LoadingState, PageHeader, btnOutline, btnPrimary, inputClass, useAdminQuery } from '@/components/admin/console';
import { TabList, panelDomId, tabDomId } from '@/components/admin/extensions/Tabs';
import { NotConfiguredNotice, NotSignedNotice, defaultRange, isoDay, rangeValid, useFinError } from './shared';
import { ReturnHandler } from './ReturnHandler';
import { SummaryTab } from './SummaryTab';
import { PayoutsTab, PurchasesTab, SalesTab } from './ListsTabs';
import { SubscriptionsTab } from './SubscriptionsTab';
import { PayPalAccountCard } from './PayPalAccountCard';
import type { PaymentsStatus } from './types';

const TABS = ['summary', 'purchases', 'sales', 'subscriptions', 'payouts', 'account'] as const;
type TabId = (typeof TABS)[number];
const isTab = (v: string | null): v is TabId => !!v && (TABS as readonly string[]).includes(v);

/** /admin/billing — compras, suscripciones, ingresos/egresos, saldo, pagos al desarrollador, recibos y cuenta de PayPal. */
export function BillingScreen() {
    const { t } = useI18n();
    const finError = useFinError('billing');
    const params = useSearchParams();
    const paypalParam = params?.get('paypal') ?? null;
    const reason = params?.get('reason') ?? null;
    const outcome = React.useMemo(
        () => (paypalParam === 'linked' || paypalParam === 'error' ? { result: paypalParam, reason: reason && /^[A-Za-z0-9_ .:-]{1,80}$/.test(reason) ? reason : undefined } as const : null),
        [paypalParam, reason],
    );
    const paymentReturn = !!(params?.get('order') || params?.get('subscription') || params?.get('buy'));

    const [tab, setTab] = React.useState<TabId>(() => {
        const q = params?.get('tab') ?? null;
        return isTab(q) ? q : paypalParam ? 'account' : 'summary';
    });
    const [range, setRange] = React.useState(() => defaultRange());
    const [draft, setDraft] = React.useState(range);
    const status = useAdminQuery<PaymentsStatus>('/api/admin/billing/status');

    const apply = () => { if (rangeValid(draft)) setRange(draft); };
    const preset = (kind: 'last30' | 'thisMonth' | 'lastMonth') => {
        const now = new Date();
        let r: { from: string; to: string };
        if (kind === 'last30') r = defaultRange(now);
        else if (kind === 'thisMonth') r = { from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDay(now) };
        else r = { from: isoDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: isoDay(new Date(now.getFullYear(), now.getMonth(), 0)) };
        setDraft(r);
        setRange(r);
    };

    const tabs = TABS.map((id) => ({ id, label: t(`admin.console.billing.tabs.${id}`) }));
    const showRange = tab === 'summary' || tab === 'payouts';

    let body: React.ReactNode;
    if (status.error?.code === 'signature_required') body = <NotSignedNotice ns="billing" />;
    else if (status.error && !status.data && status.error.code !== 'payments_not_configured' && status.error.code !== 'payments_unavailable') body = <ErrorState message={finError(status.error)} onRetry={() => void status.mutate()} />;
    else if (!status.data && !status.error) body = <LoadingState />;
    else {
        body = (
            <>
                {status.data && !status.data.configured && <div className="mb-4"><NotConfiguredNotice /></div>}
                <TabList tabs={tabs} active={tab} onChange={setTab} label={t('admin.console.billing.tabs.label')} idPrefix="billing" />
                {showRange && (
                    <form
                        onSubmit={(e) => { e.preventDefault(); apply(); }}
                        aria-label={t('admin.console.billing.range.label')}
                        className="mt-4 flex flex-wrap items-end gap-3"
                    >
                        <div>
                            <label htmlFor="bx-range-from" className="mb-1 block text-xs font-medium text-muted-foreground">{t('admin.console.billing.range.from')}</label>
                            <input id="bx-range-from" type="date" className={inputClass} value={draft.from} max={draft.to || undefined} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
                        </div>
                        <div>
                            <label htmlFor="bx-range-to" className="mb-1 block text-xs font-medium text-muted-foreground">{t('admin.console.billing.range.to')}</label>
                            <input id="bx-range-to" type="date" className={inputClass} value={draft.to} min={draft.from || undefined} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
                        </div>
                        <button type="submit" className={btnPrimary} disabled={!rangeValid(draft)}>{t('admin.console.billing.range.apply')}</button>
                        <div className="flex flex-wrap gap-2" role="group" aria-label={t('admin.console.billing.range.label')}>
                            <button type="button" className={btnOutline} onClick={() => preset('last30')}>{t('admin.console.billing.range.last30')}</button>
                            <button type="button" className={btnOutline} onClick={() => preset('thisMonth')}>{t('admin.console.billing.range.thisMonth')}</button>
                            <button type="button" className={btnOutline} onClick={() => preset('lastMonth')}>{t('admin.console.billing.range.lastMonth')}</button>
                        </div>
                        {!rangeValid(draft) && <p role="alert" className="w-full text-xs text-destructive">{t('admin.console.billing.range.invalid')}</p>}
                    </form>
                )}
                <div role="tabpanel" id={panelDomId('billing', tab)} aria-labelledby={tabDomId('billing', tab)} tabIndex={0} className="mt-5 focus-visible:outline-none">
                    {tab === 'summary' && <SummaryTab range={range} />}
                    {tab === 'purchases' && <PurchasesTab />}
                    {tab === 'sales' && <SalesTab />}
                    {tab === 'subscriptions' && <SubscriptionsTab />}
                    {tab === 'payouts' && <PayoutsTab range={range} />}
                    {tab === 'account' && <PayPalAccountCard outcome={outcome} />}
                </div>
            </>
        );
    }

    return (
        <div className="mx-auto max-w-7xl">
            <PageHeader
                title={t('admin.console.billing.title')}
                description={t('admin.console.billing.subtitle')}
                actions={status.data?.env ? <Badge tone={status.data.env === 'live' ? 'success' : 'warning'}>{status.data.env === 'live' ? 'PayPal live' : 'PayPal sandbox'}</Badge> : undefined}
            />
            {paymentReturn && <ReturnHandler />}
            {body}
        </div>
    );
}
