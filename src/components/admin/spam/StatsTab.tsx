'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import { Card, EmptyState, ErrorState, FilterSelect, LoadingState, StatCard, apiErrorKey, formatNumber, useAdminQuery } from '@/components/admin/console';
import type { StatsResponse } from './types';

const K = 'admin.console.spam.stats';
const SERIES = [
    { key: 'spam', stroke: 'stroke-destructive', fill: 'fill-destructive', dash: undefined },
    { key: 'blocked', stroke: 'stroke-foreground', fill: 'fill-foreground', dash: '6 3' },
    { key: 'warned', stroke: 'stroke-warning', fill: 'fill-warning', dash: '2 3' },
    { key: 'external', stroke: 'stroke-info', fill: 'fill-info', dash: '10 3 2 3' },
] as const;
type SeriesKey = (typeof SERIES)[number]['key'];

const W = 640;
const H = 240;
const M = { l: 44, r: 12, t: 12, b: 28 };

function LineChart({ perDay, title, desc, labelOf }: { perDay: StatsResponse['perDay']; title: string; desc: string; labelOf: (k: SeriesKey) => string }) {
    const uid = React.useId();
    const n = perDay.length;
    const max = Math.max(1, ...perDay.flatMap((d) => SERIES.map((s) => d[s.key])));
    const x = (i: number) => M.l + (n <= 1 ? (W - M.l - M.r) / 2 : (i * (W - M.l - M.r)) / (n - 1));
    const y = (v: number) => M.t + (H - M.t - M.b) * (1 - v / max);
    const ticks = [0, Math.round(max / 2), max];
    const xl = n === 0 ? [] : Array.from(new Set([0, Math.floor((n - 1) / 2), n - 1]));
    return (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${uid}-t ${uid}-d`} className="h-auto w-full">
            <title id={`${uid}-t`}>{title}</title>
            <desc id={`${uid}-d`}>{desc}</desc>
            {ticks.map((tk) => (
                <g key={tk}>
                    <line x1={M.l} x2={W - M.r} y1={y(tk)} y2={y(tk)} className="stroke-border" strokeWidth={1} />
                    <text x={M.l - 6} y={y(tk) + 4} textAnchor="end" className="fill-muted-foreground" fontSize={11}>{tk}</text>
                </g>
            ))}
            {xl.map((i) => (
                <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'} className="fill-muted-foreground" fontSize={11}>{perDay[i].day.slice(5)}</text>
            ))}
            {SERIES.map((s) => (
                <g key={s.key} data-series={s.key}>
                    {n > 1 && (
                        <polyline fill="none" className={s.stroke} strokeWidth={2} strokeDasharray={s.dash} points={perDay.map((d, i) => `${x(i)},${y(d[s.key])}`).join(' ')}>
                            <title>{labelOf(s.key)}</title>
                        </polyline>
                    )}
                    {perDay.map((d, i) => <circle key={d.day} cx={x(i)} cy={y(d[s.key])} r={2.5} className={s.fill} />)}
                </g>
            ))}
        </svg>
    );
}

export function StatsTab() {
    const { t, intlLocale } = useI18n();
    const [days, setDays] = React.useState('30');
    const { data, error, isLoading, mutate } = useAdminQuery<StatsResponse>(`/api/admin/spam/stats?days=${days}`);
    const nf = (n: number) => formatNumber(n, intlLocale);

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <p className="max-w-3xl text-sm text-muted-foreground">{t(`${K}.description`)}</p>
                <FilterSelect label={t(`${K}.period`)} value={days} onChange={setDays} options={['7', '30', '90', '365'].map((d) => ({ value: d, label: t(`${K}.days`, { count: d }) }))} />
            </div>

            {error && !data ? (
                <ErrorState message={t(apiErrorKey(error))} onRetry={() => void mutate()} />
            ) : isLoading && !data ? (
                <LoadingState />
            ) : data ? (
                <>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <StatCard label={t(`${K}.totals.spam`)} value={nf(data.totals.spam)} tone="danger" />
                        <StatCard label={t(`${K}.totals.blocked`)} value={nf(data.totals.blocked)} />
                        <StatCard label={t(`${K}.totals.warned`)} value={nf(data.totals.warned)} tone="warning" />
                        <StatCard label={t(`${K}.totals.external`)} value={nf(data.totals.external)} tone="info" />
                        <StatCard label={t(`${K}.totals.notspam`)} value={nf(data.totals.notspam)} hint={t(`${K}.totals.notspamHint`)} />
                        <StatCard label={t(`${K}.totals.markspam`)} value={nf(data.totals.markspam)} hint={t(`${K}.totals.markspamHint`)} />
                    </div>

                    <Card title={t(`${K}.chart.title`)} description={t(`${K}.chart.description`)}>
                        {data.perDay.length === 0 ? (
                            <EmptyState title={t(`${K}.empty`)} />
                        ) : (
                            <div className="space-y-4">
                                <LineChart
                                    perDay={data.perDay}
                                    title={t(`${K}.chart.title`)}
                                    desc={t(`${K}.chart.summary`, { days: data.days, spam: data.totals.spam, blocked: data.totals.blocked, warned: data.totals.warned, external: data.totals.external })}
                                    labelOf={(k) => t(`${K}.series.${k}`)}
                                />
                                <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-label={t(`${K}.chart.legend`)}>
                                    {SERIES.map((s) => (
                                        <li key={s.key} className="flex items-center gap-2 text-foreground">
                                            <svg width="28" height="8" aria-hidden="true"><line x1="0" x2="28" y1="4" y2="4" className={s.stroke} strokeWidth={2} strokeDasharray={s.dash} /></svg>
                                            {t(`${K}.series.${s.key}`)}
                                        </li>
                                    ))}
                                </ul>
                                <details className="rounded-md border border-border">
                                    <summary className="cursor-pointer rounded-md px-3 py-2 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t(`${K}.chart.showTable`)}</summary>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <caption className="sr-only">{t(`${K}.chart.tableCaption`)}</caption>
                                            <thead className="bg-muted/60 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                <tr>
                                                    <th scope="col" className="px-3 py-2">{t(`${K}.chart.day`)}</th>
                                                    {SERIES.map((s) => <th key={s.key} scope="col" className="px-3 py-2 text-right">{t(`${K}.series.${s.key}`)}</th>)}
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border/60">
                                                {data.perDay.map((d) => (
                                                    <tr key={d.day}>
                                                        <th scope="row" className="px-3 py-2 text-left font-normal">{d.day}</th>
                                                        {SERIES.map((s) => <td key={s.key} className="px-3 py-2 text-right tabular-nums">{nf(d[s.key])}</td>)}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </details>
                            </div>
                        )}
                    </Card>

                    <Card title={t(`${K}.top.title`)} description={t(`${K}.top.description`)}>
                        {data.topDomains.length === 0 ? (
                            <p className="text-sm text-muted-foreground">{t(`${K}.top.empty`)}</p>
                        ) : (
                            <div className="overflow-x-auto rounded-lg border border-border">
                                <table className="w-full text-sm">
                                    <caption className="sr-only">{t(`${K}.top.caption`)}</caption>
                                    <thead className="bg-muted/60 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                        <tr><th scope="col" className="px-3 py-2.5">{t(`${K}.top.domain`)}</th><th scope="col" className="px-3 py-2.5 text-right">{t(`${K}.top.count`)}</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/60">
                                        {data.topDomains.map((d) => (
                                            <tr key={d.domain}>
                                                <th scope="row" className="break-all px-3 py-2.5 text-left font-normal" translate="no">{d.domain}</th>
                                                <td className="px-3 py-2.5 text-right tabular-nums">{nf(d.count)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </Card>
                </>
            ) : null}
        </div>
    );
}
