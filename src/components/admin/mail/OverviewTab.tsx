'use client';

import * as React from 'react';
import { Badge, Card, DefinitionList, ErrorState, LoadingState, StatCard, apiErrorKey, formatDateTime, formatNumber } from '@/components/admin/console';
import { useI18n } from '@/components/I18nProvider';
import { BarChart, type ChartPoint, type ChartSeries } from './MailCharts';
import { RangeSelect } from './RangeSelect';
import { useMailMetrics } from './useMailMetrics';
import type { MailRange } from './types';

export function OverviewTab({ range, onRangeChange }: { range: MailRange; onRangeChange: (r: MailRange) => void }) {
    const { t, intlLocale } = useI18n();
    const { data, error, isLoading, mutate } = useMailMetrics(range);
    const n = (v: number) => formatNumber(v, intlLocale);

    const volumeSeries: ChartSeries[] = [
        { key: 'sent', label: t('admin.console.mail.overview.legendSent'), className: 'bg-primary' },
        { key: 'received', label: t('admin.console.mail.overview.legendReceived'), className: 'bg-muted-foreground/50' },
    ];
    const issueSeries: ChartSeries[] = [
        { key: 'bounces', label: t('admin.console.mail.overview.legendBounces'), className: 'bg-destructive' },
        { key: 'complaints', label: t('admin.console.mail.overview.legendComplaints'), className: 'bg-warning' },
        { key: 'unsubscribes', label: t('admin.console.mail.overview.legendUnsubscribes'), className: 'bg-muted-foreground/50' },
    ];
    const points: ChartPoint[] = (data?.series ?? []).map(({ bucket, ...values }) => ({ bucket, values }));

    const unit = data?.granularity === 'hour' ? t('admin.console.mail.overview.unitHour') : t('admin.console.mail.overview.unitDay');
    const volumeTitle = t('admin.console.mail.overview.volumeTitle');
    const issuesTitle = t('admin.console.mail.overview.issuesTitle');
    const totals = data?.totals;
    const sched = data?.scheduled;

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <RangeSelect value={range} onChange={onRangeChange} />
                {data && (
                    <p className="text-sm text-muted-foreground">
                        {data.domain ? t('admin.console.mail.overview.domain', { domain: data.domain }) : t('admin.console.mail.overview.domainUnknown')}
                    </p>
                )}
            </div>

            {error && !data ? (
                <ErrorState message={`${t('admin.console.mail.overview.loadFailed')} ${t(apiErrorKey(error))}`} onRetry={() => void mutate()} />
            ) : isLoading && !data ? (
                <LoadingState />
            ) : data && totals && sched ? (
                <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="mail-stats">
                        <StatCard label={t('admin.console.mail.overview.sent')} value={n(totals.sent)} hint={t('admin.console.mail.overview.sentHint')} />
                        <StatCard label={t('admin.console.mail.overview.received')} value={n(totals.received)} hint={t('admin.console.mail.overview.receivedHint')} />
                        <StatCard label={t('admin.console.mail.overview.bounces')} value={n(totals.bounces)} hint={t('admin.console.mail.overview.bouncesHint')} tone={totals.bounces > 0 ? 'warning' : 'neutral'} />
                        <StatCard label={t('admin.console.mail.overview.complaints')} value={n(totals.complaints)} hint={t('admin.console.mail.overview.complaintsHint')} tone={totals.complaints > 0 ? 'danger' : 'neutral'} />
                        <StatCard label={t('admin.console.mail.overview.unsubscribes')} value={n(totals.unsubscribes)} hint={t('admin.console.mail.overview.unsubscribesHint')} />
                        <StatCard label={t('admin.console.mail.overview.spam')} value={n(totals.spam)} hint={t('admin.console.mail.overview.spamHint')} />
                        <StatCard
                            label={t('admin.console.mail.overview.blocked')}
                            value={data.blockedAttachments.available ? n(totals.blocked) : t('admin.console.mail.overview.blockedUnavailable')}
                            hint={data.blockedAttachments.available ? t('admin.console.mail.overview.blockedHint') : t('admin.console.mail.overview.blockedUnavailableHint')}
                            tone={data.blockedAttachments.available && totals.blocked > 0 ? 'warning' : 'neutral'}
                        />
                    </div>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <Card title={volumeTitle} description={t('admin.console.mail.overview.volumeDescription', { unit })}>
                            <BarChart title={volumeTitle} series={volumeSeries} points={points} />
                        </Card>
                        <Card title={issuesTitle} description={t('admin.console.mail.overview.volumeDescription', { unit })}>
                            <BarChart title={issuesTitle} series={issueSeries} points={points} />
                        </Card>
                    </div>

                    <Card title={t('admin.console.mail.scheduled.title')} description={t('admin.console.mail.scheduled.description')} id="scheduled">
                        {sched.pending + sched.overdue === 0 ? (
                            <p className="text-sm text-muted-foreground">{t('admin.console.mail.scheduled.none')}</p>
                        ) : (
                            <DefinitionList
                                items={[
                                    { label: t('admin.console.mail.scheduled.pending'), value: n(sched.pending) },
                                    {
                                        label: t('admin.console.mail.scheduled.overdue'),
                                        value: (
                                            <span className="inline-flex flex-wrap items-center gap-2">
                                                {n(sched.overdue)}
                                                {sched.overdue > 0 && <Badge tone="warning">{t('admin.console.mail.scheduled.overdueHint')}</Badge>}
                                            </span>
                                        ),
                                    },
                                    { label: t('admin.console.mail.scheduled.oldest'), value: formatDateTime(sched.oldest, intlLocale) },
                                ]}
                            />
                        )}
                    </Card>
                </>
            ) : null}
        </div>
    );
}
