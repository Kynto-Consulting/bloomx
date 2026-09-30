'use client';

import * as React from 'react';
import { Badge, Card, DataTable, ErrorState, LoadingState, apiErrorKey, formatNumber, type Column } from '@/components/admin/console';
import { useI18n } from '@/components/I18nProvider';
import { RangeSelect } from './RangeSelect';
import { useMailMetrics } from './useMailMetrics';
import type { MailMetrics, MailRange } from './types';

type QuotaRow = MailMetrics['quota']['topLastHour'][number];
type VolumeRow = MailMetrics['quota']['topRange'][number];

export function QuotasTab({ range, onRangeChange }: { range: MailRange; onRangeChange: (r: MailRange) => void }) {
    const { t, intlLocale } = useI18n();
    const { data, error, isLoading, mutate } = useMailMetrics(range);
    const n = (v: number) => formatNumber(v, intlLocale);

    const quotaCols: Column<QuotaRow>[] = [
        { id: 'user', header: t('admin.console.mail.quotas.user'), isRowHeader: true, cell: (r) => <span className="break-all">{r.email}</span> },
        { id: 'sent', header: t('admin.console.mail.quotas.sentLastHour'), cell: (r) => <span className="tabular-nums">{n(r.sentLastHour)}</span> },
        {
            id: 'usage',
            header: t('admin.console.mail.quotas.usage'),
            hideBelow: 'sm',
            cell: (r) => {
                const label = t('admin.console.mail.quotas.usageValue', { sent: n(r.sentLastHour), limit: n(r.limit), percent: r.percent });
                return (
                    <div className="min-w-[8rem]">
                        <div
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={r.percent}
                            aria-label={label}
                            className="h-2 w-full overflow-hidden rounded-full bg-muted"
                        >
                            <div className={r.percent >= 100 ? 'h-full bg-destructive' : r.percent >= 80 ? 'h-full bg-warning' : 'h-full bg-primary'} style={{ width: `${r.percent}%` }} />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{label}</p>
                    </div>
                );
            },
        },
        {
            id: 'status',
            header: t('admin.console.mail.quotas.status'),
            cell: (r) =>
                r.percent >= 100 ? <Badge tone="danger">{t('admin.console.mail.quotas.atLimit')}</Badge>
                : r.percent >= 80 ? <Badge tone="warning">{t('admin.console.mail.quotas.near')}</Badge>
                : <Badge tone="success">{t('admin.console.mail.quotas.ok')}</Badge>,
        },
    ];

    const volumeCols: Column<VolumeRow>[] = [
        { id: 'user', header: t('admin.console.mail.quotas.user'), isRowHeader: true, cell: (r) => <span className="break-all">{r.email}</span> },
        { id: 'sent', header: t('admin.console.mail.quotas.sent'), cell: (r) => <span className="tabular-nums">{n(r.sent)}</span> },
        { id: 'received', header: t('admin.console.mail.quotas.receivedCol'), hideBelow: 'sm', cell: (r) => <span className="tabular-nums">{n(r.received)}</span> },
        { id: 'total', header: t('admin.console.mail.quotas.total'), cell: (r) => <span className="tabular-nums">{n(r.total)}</span> },
    ];

    return (
        <div className="space-y-6">
            <Card
                title={t('admin.console.mail.quotas.title')}
                description={data ? t('admin.console.mail.quotas.description', { limit: n(data.quota.limit) }) : undefined}
            >
                {error && !data ? (
                    <ErrorState message={`${t('admin.console.mail.overview.loadFailed')} ${t(apiErrorKey(error))}`} onRetry={() => void mutate()} />
                ) : isLoading && !data ? (
                    <LoadingState />
                ) : data ? (
                    <DataTable
                        caption={t('admin.console.mail.quotas.caption')}
                        columns={quotaCols}
                        rows={data.quota.topLastHour}
                        getRowId={(r) => r.userId}
                        minWidth={320}
                        empty={<p className="px-4 py-8 text-center text-sm text-muted-foreground">{t('admin.console.mail.quotas.none')}</p>}
                    />
                ) : null}
            </Card>

            <Card title={t('admin.console.mail.quotas.topRangeTitle')} actions={<RangeSelect value={range} onChange={onRangeChange} />}>
                {data ? (
                    <DataTable
                        caption={t('admin.console.mail.quotas.topRangeCaption')}
                        columns={volumeCols}
                        rows={data.quota.topRange}
                        getRowId={(r) => r.userId}
                        minWidth={320}
                        empty={<p className="px-4 py-8 text-center text-sm text-muted-foreground">{t('admin.console.mail.quotas.topRangeNone')}</p>}
                    />
                ) : isLoading ? <LoadingState /> : null}
            </Card>
        </div>
    );
}
