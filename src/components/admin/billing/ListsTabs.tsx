'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import { Badge, Card, DataTable, EmptyState, btnOutline, buildQuery, formatDate, formatDateTime, useAdminQuery, type Column, type Tone } from '@/components/admin/console';
import { QueryBoundary, usePaged, useFinError, useMoney } from './shared';
import { ReceiptDialog } from './ReceiptDialog';
import type { LedgerItem, PayoutItem, PurchaseItem, SaleItem } from './types';

const ORDER_TONE: Record<string, Tone> = { CAPTURED: 'success', PENDING: 'warning', CREATED: 'neutral', FAILED: 'danger', REFUNDED: 'info', DISPUTED: 'danger' };
const PAYOUT_TONE: Record<string, Tone> = { HELD: 'warning', READY: 'info', SENT: 'success', FAILED: 'danger', CANCELLED: 'neutral' };
const INSTALL_TONE: Record<string, Tone> = { installed: 'success', pending_approval: 'warning', failed: 'danger', skipped: 'neutral' };

export function useLabel() {
    const { t } = useI18n();
    return React.useCallback((key: string, value: string | null | undefined) => {
        if (!value) return '—';
        const full = `${key}.${value}`;
        const text = t(full);
        return text === full ? value : text;
    }, [t]);
}

function LoadMore({ hasMore, loading, onClick }: { hasMore: boolean; loading: boolean; onClick: () => void }) {
    const { t } = useI18n();
    if (!hasMore) return null;
    return (
        <div className="border-t border-border/60 p-3 text-center">
            <button type="button" className={btnOutline} onClick={onClick} disabled={loading} aria-busy={loading || undefined}>{t('admin.console.billing.loadMore')}</button>
        </div>
    );
}

export function PurchasesTab() {
    const { t, locale } = useI18n();
    const money = useMoney();
    const label = useLabel();
    const finError = useFinError('billing');
    const paged = usePaged<PurchaseItem>('/api/admin/billing/purchases');
    const [receipt, setReceipt] = React.useState<string | null>(null);

    const columns: Column<PurchaseItem>[] = [
        { id: 'date', header: t('admin.console.billing.purchases.colDate'), cell: (r) => formatDate(r.capturedAt ?? r.createdAt, locale) },
        { id: 'ext', header: t('admin.console.billing.purchases.colExtension'), cell: (r) => <span className="break-all font-medium">{r.extensionId}</span>, isRowHeader: true },
        { id: 'kind', header: t('admin.console.billing.purchases.colKind'), cell: (r) => (r.kind === 'subscription' ? t('admin.console.billing.purchases.kindSubscription') : t('admin.console.billing.purchases.kindOrder')), hideBelow: 'md' },
        { id: 'amount', header: t('admin.console.billing.purchases.colAmount'), cell: (r) => money(r.amountCents, r.currency) },
        { id: 'status', header: t('admin.console.billing.purchases.colStatus'), cell: (r) => <Badge tone={ORDER_TONE[r.status] ?? 'neutral'}>{label('admin.console.billing.status', r.status)}</Badge> },
        { id: 'install', header: t('admin.console.billing.purchases.colInstall'), cell: (r) => (r.installStatus ? <Badge tone={INSTALL_TONE[r.installStatus] ?? 'neutral'}>{label('admin.console.billing.install', r.installStatus)}</Badge> : '—'), hideBelow: 'lg' },
        {
            id: 'receipt', header: t('admin.console.billing.purchases.colReceipt'),
            cell: (r) => (r.status === 'CAPTURED' || r.status === 'REFUNDED'
                ? <button type="button" className="text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t('admin.console.billing.purchases.viewReceipt', { id: r.orderId })} onClick={() => setReceipt(r.orderId)}>{t('admin.console.billing.purchases.receipt')}</button>
                : '—'),
        },
    ];
    if (paged.query.error && !paged.query.data) return <QueryBoundary q={paged.query} ns="billing">{() => null}</QueryBoundary>;
    return (
        <Card title={t('admin.console.billing.purchases.title')}>
            <DataTable caption={t('admin.console.billing.purchases.caption')} columns={columns} rows={paged.items} getRowId={(r) => r.orderId} loading={!paged.query.data} empty={<EmptyState title={t('admin.console.billing.purchases.empty')} />} />
            {paged.moreError ? <p role="alert" className="p-3 text-sm text-destructive">{finError(paged.moreError)}</p> : null}
            <LoadMore hasMore={paged.hasMore} loading={paged.loadingMore} onClick={() => void paged.loadMore()} />
            <ReceiptDialog orderId={receipt} onClose={() => setReceipt(null)} />
        </Card>
    );
}

export function SalesTab() {
    const { t, locale } = useI18n();
    const money = useMoney();
    const label = useLabel();
    const finError = useFinError('billing');
    const paged = usePaged<SaleItem>('/api/admin/billing/sales');
    const columns: Column<SaleItem>[] = [
        { id: 'date', header: t('admin.console.billing.sales.colDate'), cell: (r) => formatDate(r.capturedAt, locale) },
        { id: 'ext', header: t('admin.console.billing.sales.colExtension'), cell: (r) => <span className="break-all font-medium">{r.extensionId}</span>, isRowHeader: true },
        { id: 'buyer', header: t('admin.console.billing.sales.colBuyer'), cell: (r) => <span className="break-all">{r.buyerDomain}</span>, hideBelow: 'md' },
        { id: 'kind', header: t('admin.console.billing.sales.colKind'), cell: (r) => (r.kind === 'subscription' ? t('admin.console.billing.purchases.kindSubscription') : t('admin.console.billing.purchases.kindOrder')), hideBelow: 'lg' },
        { id: 'amount', header: t('admin.console.billing.sales.colAmount'), cell: (r) => money(r.amountCents) },
        { id: 'platform', header: t('admin.console.billing.sales.colPlatform'), cell: (r) => money(r.platformShareCents), hideBelow: 'sm' },
        { id: 'you', header: t('admin.console.billing.sales.colYou'), cell: (r) => <span className="font-medium">{money(r.developerShareCents)}</span> },
        { id: 'status', header: t('admin.console.billing.sales.colStatus'), cell: (r) => <Badge tone={ORDER_TONE[r.status] ?? 'neutral'}>{label('admin.console.billing.status', r.status)}</Badge>, hideBelow: 'sm' },
    ];
    if (paged.query.error && !paged.query.data) return <QueryBoundary q={paged.query} ns="billing">{() => null}</QueryBoundary>;
    return (
        <Card title={t('admin.console.billing.sales.title')}>
            <DataTable caption={t('admin.console.billing.sales.caption')} columns={columns} rows={paged.items} getRowId={(r) => r.orderId + r.capturedAt} loading={!paged.query.data} empty={<EmptyState title={t('admin.console.billing.sales.empty')} />} />
            {paged.moreError ? <p role="alert" className="p-3 text-sm text-destructive">{finError(paged.moreError)}</p> : null}
            <LoadMore hasMore={paged.hasMore} loading={paged.loadingMore} onClick={() => void paged.loadMore()} />
        </Card>
    );
}

export function PayoutsTab({ range }: { range: { from: string; to: string } }) {
    const { t, locale } = useI18n();
    const money = useMoney();
    const label = useLabel();
    const payouts = useAdminQuery<{ items: PayoutItem[] }>('/api/admin/billing/payouts');
    const ledger = useAdminQuery<{ items: LedgerItem[] }>(`/api/admin/billing/ledger${buildQuery(range)}`);

    const payoutCols: Column<PayoutItem>[] = [
        { id: 'date', header: t('admin.console.billing.payouts.colDate'), cell: (r) => formatDate(r.createdAt, locale) },
        { id: 'amount', header: t('admin.console.billing.payouts.colAmount'), cell: (r) => <span className="font-medium">{money(r.amountCents)}</span>, isRowHeader: true },
        { id: 'status', header: t('admin.console.billing.payouts.colStatus'), cell: (r) => <Badge tone={PAYOUT_TONE[r.status] ?? 'neutral'} title={r.id.startsWith('held:') ? t('admin.console.billing.payouts.heldVirtual') : undefined}>{label('admin.console.billing.payouts.status', r.status)}</Badge> },
        { id: 'hold', header: t('admin.console.billing.payouts.colHold'), cell: (r) => formatDate(r.holdUntil, locale), hideBelow: 'sm' },
        { id: 'sent', header: t('admin.console.billing.payouts.colSent'), cell: (r) => formatDateTime(r.sentAt, locale), hideBelow: 'md' },
        { id: 'error', header: t('admin.console.billing.payouts.colError'), cell: (r) => (r.error ? <span className="text-destructive">{r.error.slice(0, 120)}</span> : '—'), hideBelow: 'lg' },
    ];
    const ledgerCols: Column<LedgerItem>[] = [
        { id: 'date', header: t('admin.console.billing.payouts.colDate'), cell: (r) => formatDateTime(r.createdAt, locale) },
        { id: 'kind', header: t('admin.console.billing.payouts.colKind'), cell: (r) => <Badge tone={r.kind === 'refund' || r.kind === 'chargeback' ? 'warning' : 'neutral'}>{label('admin.console.billing.payouts.kinds', r.kind)}</Badge>, isRowHeader: true },
        { id: 'amount', header: t('admin.console.billing.payouts.colAmount'), cell: (r) => <span className="font-medium">{money(r.amountCents)}</span> },
        { id: 'order', header: t('admin.console.billing.payouts.colOrder'), cell: (r) => <span className="break-all">{r.orderId ?? '—'}</span>, hideBelow: 'md' },
        { id: 'avail', header: t('admin.console.billing.payouts.colAvailable'), cell: (r) => formatDate(r.availableAt, locale), hideBelow: 'sm' },
    ];
    return (
        <div className="space-y-5">
            <Card title={t('admin.console.billing.payouts.title')}>
                <QueryBoundary q={payouts} ns="billing">
                    {(d) => <DataTable caption={t('admin.console.billing.payouts.caption')} columns={payoutCols} rows={d.items} getRowId={(r) => r.id} empty={<EmptyState title={t('admin.console.billing.payouts.empty')} />} />}
                </QueryBoundary>
            </Card>
            <Card title={t('admin.console.billing.payouts.ledgerTitle')}>
                <QueryBoundary q={ledger} ns="billing">
                    {(d) => <DataTable caption={t('admin.console.billing.payouts.ledgerCaption')} columns={ledgerCols} rows={d.items} getRowId={(r) => r.id} empty={<EmptyState title={t('admin.console.billing.payouts.ledgerEmpty')} />} />}
                </QueryBoundary>
            </Card>
        </div>
    );
}

