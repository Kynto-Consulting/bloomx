'use client';

import * as React from 'react';
import { Download } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { Card, ErrorState, LoadingState, StatCard, btnOutline, formatNumber, selectClass, useAdminQuery } from '@/components/admin/console';
import type { UsageSummary } from '@/lib/ai/usage';
import { USAGE_RANGES, barHeights, formatCost } from './logic';
import { useErrorText, type TabProps } from './shared';

function SimpleTable({ caption, head, rows }: { caption: string; head: string[]; rows: Array<Array<React.ReactNode>> }) {
    const { t } = useI18n();
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <caption className="sr-only">{caption}</caption>
                <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        {head.map((h, i) => <th key={h} scope="col" className={`px-2 py-1.5 font-medium ${i > 0 ? 'text-right' : ''}`}>{h}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {rows.length === 0 && <tr><td colSpan={head.length} className="px-2 py-3 text-muted-foreground">{t('admin.ai.usage.empty')}</td></tr>}
                    {rows.map((r, i) => (
                        <tr key={i} className="border-b border-border/50 last:border-0">
                            {r.map((c, j) => <td key={j} className={`px-2 py-1.5 ${j > 0 ? 'text-right tabular-nums' : 'text-foreground'}`}>{c}</td>)}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function UsageTab({ settings }: TabProps) {
    const { t, intlLocale } = useI18n();
    const errorText = useErrorText();
    const [days, setDays] = React.useState<number>(30);
    const { data, error, mutate } = useAdminQuery<UsageSummary>(`/api/admin/ai/usage?days=${days}`);
    const n = (v: number) => formatNumber(v, intlLocale);
    const uid = React.useId();
    void settings;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <label htmlFor={`${uid}-range`} className="block text-sm font-medium text-foreground">{t('admin.ai.usage.range')}</label>
                    <select id={`${uid}-range`} className={`${selectClass} mt-1 w-44`} value={days} onChange={(e) => setDays(Number(e.target.value))}>
                        {USAGE_RANGES.map((d) => <option key={d} value={d}>{t('admin.ai.usage.lastDays', { n: d })}</option>)}
                    </select>
                </div>
                <a className={btnOutline} href={`/api/admin/ai/usage/csv?days=${days}`} download>
                    <Download aria-hidden className="mr-1.5 h-4 w-4" />{t('admin.ai.usage.exportCsv')}
                </a>
            </div>

            {error && !data ? <ErrorState message={errorText(error)} onRetry={() => void mutate()} />
                : !data ? <LoadingState label={t('admin.console.common.loading')} />
                    : (
                        <>
                            <div className="grid gap-3 sm:grid-cols-4">
                                <StatCard label={t('admin.ai.usage.requests')} value={n(data.totals.requests)} />
                                <StatCard label={t('admin.ai.usage.tokens')} value={n(data.totals.tokensIn + data.totals.tokensOut)} hint={t('admin.ai.usage.inOut', { i: n(data.totals.tokensIn), o: n(data.totals.tokensOut) })} />
                                <StatCard label={t('admin.ai.usage.errors')} value={n(data.totals.errors)} tone={data.totals.errors ? 'warning' : 'neutral'} />
                                <StatCard label={t('admin.ai.usage.cost')} value={formatCost(data.totals.costUsd, intlLocale)} hint={t('admin.ai.usage.costHint')} />
                            </div>

                            <Card title={t('admin.ai.usage.byDay')}>
                                {data.byDay.length === 0 ? <p className="text-sm text-muted-foreground">{t('admin.ai.usage.empty')}</p> : (
                                    <>
                                        <div role="img" aria-label={t('admin.ai.usage.chartLabel', { n: data.byDay.length })} className="flex h-32 items-end gap-1">
                                            {(() => {
                                                const hs = barHeights(data.byDay.map((d) => d.tokens));
                                                return data.byDay.map((d, i) => (
                                                    <div key={d.day} className="flex h-full flex-1 items-end" title={`${d.day}: ${n(d.tokens)} ${t('admin.ai.usage.tokens').toLowerCase()}`}>
                                                        <div className="w-full rounded-t bg-primary/80" style={{ height: `${hs[i]}%` }} />
                                                    </div>
                                                ));
                                            })()}
                                        </div>
                                        <div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>{data.byDay[0].day}</span><span>{data.byDay[data.byDay.length - 1].day}</span></div>
                                    </>
                                )}
                                <div className="mt-4">
                                    <SimpleTable caption={t('admin.ai.usage.byDay')} head={[t('admin.ai.usage.day'), t('admin.ai.usage.requests'), t('admin.ai.usage.tokens'), t('admin.ai.usage.cost')]}
                                        rows={[...data.byDay].reverse().map((d) => [d.day, n(d.requests), n(d.tokens), formatCost(d.costUsd, intlLocale)])} />
                                </div>
                            </Card>

                            <div className="grid gap-4 lg:grid-cols-2">
                                <Card title={t('admin.ai.usage.byFeature')}>
                                    <SimpleTable caption={t('admin.ai.usage.byFeature')} head={[t('admin.ai.usage.feature'), t('admin.ai.usage.requests'), t('admin.ai.usage.tokens'), t('admin.ai.usage.cost')]}
                                        rows={data.byFeature.map((f) => [f.feature, n(f.requests), n(f.tokens), formatCost(f.costUsd, intlLocale)])} />
                                </Card>
                                <Card title={t('admin.ai.usage.byExtension')}>
                                    <SimpleTable caption={t('admin.ai.usage.byExtension')} head={[t('admin.ai.usage.extension'), t('admin.ai.usage.requests'), t('admin.ai.usage.tokens')]}
                                        rows={data.byExtension.map((x) => [x.extensionId, n(x.requests), n(x.tokens)])} />
                                </Card>
                            </div>
                            <Card title={t('admin.ai.usage.byUser')}>
                                <SimpleTable caption={t('admin.ai.usage.byUser')} head={[t('admin.ai.usage.user'), t('admin.ai.usage.requests'), t('admin.ai.usage.tokens'), t('admin.ai.usage.cost')]}
                                    rows={data.byUser.map((u) => [u.email ?? u.userId, n(u.requests), n(u.tokens), formatCost(u.costUsd, intlLocale)])} />
                            </Card>
                        </>
                    )}
        </div>
    );
}
