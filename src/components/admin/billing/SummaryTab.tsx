'use client';

import * as React from 'react';
import { Download } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { Card, DataTable, EmptyState, StatCard, btnOutline, buildQuery, useAdminQuery, type Column } from '@/components/admin/console';
import { useStepUp } from '@/components/admin/permissions/useStepUp';
import { QueryBoundary, downloadFinanceCsv, useFinError, useMoney } from './shared';
import type { BillingSummary } from './types';

type ExportKind = 'purchases' | 'sales' | 'ledger' | 'payouts';

export function SummaryTab({ range }: { range: { from: string; to: string } }) {
    const { t } = useI18n();
    const money = useMoney();
    const q = useAdminQuery<BillingSummary>(`/api/admin/billing/summary${buildQuery(range)}`);
    return (
        <div className="space-y-5">
            <QueryBoundary q={q} ns="billing">
                {(s) => {
                    const cur = s.currency || 'USD';
                    const columns: Column<BillingSummary['byExtension'][number]>[] = [
                        { id: 'ext', header: t('admin.console.billing.summary.colExtension'), cell: (r) => <span className="break-all font-medium">{r.extensionId}</span>, isRowHeader: true },
                        { id: 'sales', header: t('admin.console.billing.summary.colSales'), cell: (r) => r.salesCount },
                        { id: 'gross', header: t('admin.console.billing.summary.colGross'), cell: (r) => money(r.grossCents, cur) },
                        { id: 'net', header: t('admin.console.billing.summary.colNet'), cell: (r) => money(r.netCents, cur) },
                        { id: 'refunds', header: t('admin.console.billing.summary.colRefunds'), cell: (r) => money(r.refundsCents, cur), hideBelow: 'sm' },
                        { id: 'subs', header: t('admin.console.billing.summary.colSubscribers'), cell: (r) => r.activeSubscribers, hideBelow: 'sm' },
                    ];
                    return (
                        <>
                            <section aria-label={t('admin.console.billing.summary.incomeTitle')}>
                                <h2 className="mb-2 text-sm font-semibold text-foreground">{t('admin.console.billing.summary.incomeTitle')}</h2>
                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                    <StatCard label={t('admin.console.billing.summary.gross')} value={money(s.income.grossCents, cur)} hint={t('admin.console.billing.summary.salesCount', { count: s.income.salesCount })} />
                                    <StatCard label={t('admin.console.billing.summary.platformFee')} value={money(s.income.platformFeeCents, cur)} />
                                    <StatCard label={t('admin.console.billing.summary.net')} value={money(s.income.netCents, cur)} tone="success" />
                                    <StatCard label={t('admin.console.billing.summary.refunds')} value={money(s.income.refundsCents, cur)} tone={s.income.refundsCents > 0 ? 'warning' : 'neutral'} />
                                </div>
                            </section>
                            <section aria-label={t('admin.console.billing.summary.expensesTitle')}>
                                <h2 className="mb-2 text-sm font-semibold text-foreground">{t('admin.console.billing.summary.expensesTitle')}</h2>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <StatCard label={t('admin.console.billing.summary.purchases')} value={money(s.expenses.purchasesCents, cur)} hint={t('admin.console.billing.summary.purchasesCount', { count: s.expenses.purchasesCount })} />
                                    <StatCard label={t('admin.console.billing.summary.refundedExpenses')} value={money(s.expenses.refundedCents ?? 0, cur)} hint={t('admin.console.billing.summary.refundedExpensesHint')} />
                                </div>
                            </section>
                            <section aria-label={t('admin.console.billing.summary.balanceTitle')}>
                                <h2 className="mb-2 text-sm font-semibold text-foreground">{t('admin.console.billing.summary.balanceTitle')}</h2>
                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                    <StatCard label={t('admin.console.billing.summary.available')} value={money(s.balance.availableCents, cur)} hint={t('admin.console.billing.summary.availableHint')} tone="success" />
                                    <StatCard label={t('admin.console.billing.summary.held')} value={money(s.balance.heldCents, cur)} hint={t('admin.console.billing.summary.heldHint')} />
                                    <StatCard label={t('admin.console.billing.summary.paid')} value={money(s.balance.paidCents, cur)} hint={t('admin.console.billing.summary.paidHint')} />
                                    <StatCard label={t('admin.console.billing.summary.pendingPayout')} value={money(s.balance.pendingPayoutCents, cur)} hint={t('admin.console.billing.summary.pendingHint')} />
                                </div>
                            </section>
                            <section aria-label={t('admin.console.billing.summary.recurringTitle')}>
                                <h2 className="mb-2 text-sm font-semibold text-foreground">{t('admin.console.billing.summary.recurringTitle')}</h2>
                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                    <StatCard label={t('admin.console.billing.summary.mrr')} value={money(s.mrr.cents, cur)} />
                                    <StatCard label={t('admin.console.billing.summary.activeSubscribers')} value={s.mrr.activeSubscribers} />
                                    <StatCard label={t('admin.console.billing.summary.churned')} value={s.mrr.churnedInRange} tone={s.mrr.churnedInRange > 0 ? 'warning' : 'neutral'} />
                                    <StatCard label={t('admin.console.billing.summary.trialing')} value={s.mrr.trialing} />
                                </div>
                            </section>
                            <Card title={t('admin.console.billing.summary.byExtension')} bodyClassName="p-0">
                                <DataTable
                                    caption={t('admin.console.billing.summary.byExtensionCaption')}
                                    columns={columns}
                                    rows={s.byExtension}
                                    getRowId={(r) => r.extensionId}
                                    empty={<EmptyState title={t('admin.console.billing.summary.noSales')} />}
                                />
                            </Card>
                        </>
                    );
                }}
            </QueryBoundary>
            <ExportBar range={range} />
        </div>
    );
}

function ExportBar({ range }: { range: { from: string; to: string } }) {
    const { t } = useI18n();
    const { guard, dialog } = useStepUp();
    const finError = useFinError('billing');
    const [busy, setBusy] = React.useState<ExportKind | null>(null);
    const [error, setError] = React.useState<string | null>(null);

    const run = (kind: ExportKind) => {
        setError(null);
        setBusy(kind);
        void guard(() => downloadFinanceCsv(`/api/admin/billing/export${buildQuery({ kind, ...range })}`, `bloomx-${kind}.csv`))
            .catch((e) => setError(finError(e) || t('admin.console.billing.summary.exportFailed')))
            .finally(() => setBusy(null));
    };
    const kinds: { id: ExportKind; label: string }[] = [
        { id: 'purchases', label: t('admin.console.billing.summary.exportPurchases') },
        { id: 'sales', label: t('admin.console.billing.summary.exportSales') },
        { id: 'ledger', label: t('admin.console.billing.summary.exportLedger') },
        { id: 'payouts', label: t('admin.console.billing.summary.exportPayouts') },
    ];
    return (
        <Card title={t('admin.console.billing.summary.export')}>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('admin.console.billing.summary.export')}>
                {kinds.map((k) => (
                    <button key={k.id} type="button" className={btnOutline} onClick={() => run(k.id)} disabled={busy !== null} aria-busy={busy === k.id || undefined}>
                        <Download className="h-4 w-4" aria-hidden="true" />
                        {busy === k.id ? t('admin.console.billing.summary.exporting') : k.label}
                    </button>
                ))}
            </div>
            {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
            {dialog}
        </Card>
    );
}
