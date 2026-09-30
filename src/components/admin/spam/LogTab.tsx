'use client';

import * as React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import {
    Badge, ErrorState, FilterBar, FilterSelect, LoadingState, Pagination, SearchInput, buildQuery, apiErrorKey, btnOutline, formatDateTime, inputClass, useAdminQuery, useDebounced,
    type Tone,
} from '@/components/admin/console';
import { dayBoundIso } from './parts';
import type { EventRow, EventsResponse } from './types';

const K = 'admin.console.spam.log';
const DECISIONS = ['delivered', 'warned', 'spam', 'blocked', 'notspam', 'markspam'] as const;
const TONE: Record<string, Tone> = { delivered: 'success', warned: 'warning', spam: 'danger', blocked: 'danger', notspam: 'info', markspam: 'neutral' };

function ReasonsCell({ row, open, onToggle, id }: { row: EventRow; open: boolean; onToggle: () => void; id: string }) {
    const { t } = useI18n();
    const n = row.reasons.length + (row.ruleLabel ? 1 : 0);
    if (n === 0) return <span className="text-muted-foreground">{t(`${K}.noReasons`)}</span>;
    const Icon = open ? ChevronDown : ChevronRight;
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={id}
            className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {t(`${K}.showReasons`, { count: n })}
        </button>
    );
}

export function LogTab() {
    const { t, locale, intlLocale } = useI18n();
    const [from, setFrom] = React.useState('');
    const [to, setTo] = React.useState('');
    const [decision, setDecision] = React.useState('');
    const [domain, setDomain] = React.useState('');
    const [page, setPage] = React.useState(1);
    const [pageSize, setPageSize] = React.useState(50);
    const [open, setOpen] = React.useState<Set<string>>(new Set());
    const dDomain = useDebounced(domain, 300);
    React.useEffect(() => { setPage(1); }, [from, to, decision, dDomain, pageSize]);

    const url = `/api/admin/spam/events${buildQuery({ from: dayBoundIso(from, false), to: dayBoundIso(to, true), decision, domain: dDomain.trim(), page, pageSize })}`;
    const { data, error, isLoading, mutate } = useAdminQuery<EventsResponse>(url);
    const rows = data?.rows ?? [];
    const total = data?.total ?? 0;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const hasFilters = !!(from || to || decision || domain);
    const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const lang: 'es' | 'en' = locale === 'en' ? 'en' : 'es';

    return (
        <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t(`${K}.description`)}</p>
            <FilterBar label={t(`${K}.filters.label`)}>
                <div>
                    <label htmlFor="spam-log-from" className="mb-1 block text-xs font-medium text-muted-foreground">{t(`${K}.filters.from`)}</label>
                    <input id="spam-log-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={`${inputClass} w-auto`} />
                </div>
                <div>
                    <label htmlFor="spam-log-to" className="mb-1 block text-xs font-medium text-muted-foreground">{t(`${K}.filters.to`)}</label>
                    <input id="spam-log-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={`${inputClass} w-auto`} />
                </div>
                <FilterSelect
                    label={t(`${K}.filters.decision`)}
                    value={decision}
                    onChange={setDecision}
                    options={[{ value: '', label: t(`${K}.filters.allDecisions`) }, ...DECISIONS.map((d) => ({ value: d, label: t(`${K}.decisions.${d}`) }))]}
                />
                <SearchInput value={domain} onChange={setDomain} label={t(`${K}.filters.domain`)} placeholder={t(`${K}.filters.domainPlaceholder`)} />
                {hasFilters && (
                    <button type="button" className={btnOutline} onClick={() => { setFrom(''); setTo(''); setDecision(''); setDomain(''); }}>{t('admin.console.common.clearFilters')}</button>
                )}
            </FilterBar>

            {error && !data ? (
                <ErrorState message={t(apiErrorKey(error))} onRetry={() => void mutate()} />
            ) : isLoading && !data ? (
                <LoadingState />
            ) : (
                <div className="overflow-x-auto rounded-lg border border-border bg-card">
                    <table className="w-full text-sm" style={{ minWidth: 820 }} aria-busy={isLoading || undefined}>
                        <caption className="sr-only">{t(`${K}.caption`)}</caption>
                        <thead className="bg-muted/60 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            <tr>
                                {(['date', 'sender', 'recipient', 'decision', 'score', 'rule', 'reasons'] as const).map((c) => (
                                    <th key={c} scope="col" className="px-3 py-2.5">{t(`${K}.columns.${c}`)}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                            {rows.length === 0 && (
                                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">{t(hasFilters ? 'admin.console.common.emptyFiltered' : `${K}.empty`)}</td></tr>
                            )}
                            {rows.map((r) => {
                                const isOpen = open.has(r.id);
                                const panelId = `spam-log-reasons-${r.id}`;
                                return (
                                    <React.Fragment key={r.id}>
                                        <tr className="align-top hover:bg-row-hover">
                                            <th scope="row" className="whitespace-nowrap px-3 py-3 text-left font-normal">{formatDateTime(r.ts, intlLocale)}</th>
                                            <td className="break-all px-3 py-3" translate="no">{r.sender}</td>
                                            <td className="break-all px-3 py-3 text-muted-foreground" translate="no">{r.recipient ?? '—'}</td>
                                            <td className="px-3 py-3">
                                                <Badge tone={TONE[r.decision] ?? 'neutral'}>{DECISIONS.includes(r.decision as (typeof DECISIONS)[number]) ? t(`${K}.decisions.${r.decision}`) : r.decision}</Badge>
                                                {r.external && <Badge tone="info" className="ml-1">{t(`${K}.external`)}</Badge>}
                                            </td>
                                            <td className="px-3 py-3 tabular-nums">{r.score ?? '—'}</td>
                                            <td className="break-all px-3 py-3 text-muted-foreground" translate="no">{r.ruleLabel ?? '—'}</td>
                                            <td className="px-3 py-3"><ReasonsCell row={r} open={isOpen} onToggle={() => toggle(r.id)} id={panelId} /></td>
                                        </tr>
                                        {isOpen && (
                                            <tr id={panelId} className="bg-muted/30">
                                                <td colSpan={7} className="px-4 py-3">
                                                    {r.ruleLabel && <p className="mb-2 text-sm text-foreground">{t(`${K}.rule`)}: <span translate="no">{r.ruleLabel}</span></p>}
                                                    <ul className="space-y-1" aria-label={t(`${K}.reasonsLabel`)}>
                                                        {r.reasons.map((x, i) => (
                                                            <li key={`${x.id}-${i}`} className="flex gap-2 text-sm">
                                                                <span className={`w-10 shrink-0 text-right tabular-nums ${x.weight > 0 ? 'text-destructive' : x.weight < 0 ? 'text-success' : 'text-muted-foreground'}`}>{x.weight > 0 ? `+${x.weight}` : x.weight}</span>
                                                                <span className="text-foreground">{x[lang]}</span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
            <Pagination page={page} pages={pages} total={total} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} pageSizes={[25, 50, 100, 200]} />
        </div>
    );
}
