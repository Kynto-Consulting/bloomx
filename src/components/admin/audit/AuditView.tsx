'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Download, RefreshCw } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import {
    Badge, Card, DataTable, DetailDrawer, EmptyState, ErrorState, FilterBar, FilterSelect, Pagination, RowButton, SearchInput,
    apiErrorKey, btnOutline, buildQuery, downloadCsv, formatDateTime, inputClass, useAdminQuery, useDebounced, type Column,
} from '@/components/admin/console';
import { EVENT_FILTER_RE, FAMILY_PREFIXES, FAMILY_TONE, auditFamily } from './family';

export interface AuditEntry {
    id: string;
    ts: string | null;
    event: string;
    userId: string | null;
    ip: string | null;
    data: Record<string, unknown>;
}
interface AuditResponse {
    available: boolean;
    items: AuditEntry[];
    total: number;
    totalCapped: boolean;
    page: number;
    pageSize: number;
    pages: number;
    eventTypes: string[];
}

const MAX_RANGE_MS = 366 * 24 * 3600 * 1000;

/** datetime-local -> ISO (vacio o invalido => ''). */
function toIso(value: string): string {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

const dtClass = 'mb-1 block text-xs font-medium text-muted-foreground';
const ddLabel = 'text-xs font-medium uppercase tracking-wide text-muted-foreground';

export function AuditView() {
    const { t, intlLocale } = useI18n();
    const sp = useSearchParams();
    const urlEvent = sp?.get('event') ?? '';
    const initialEvent = EVENT_FILTER_RE.test(urlEvent) ? urlEvent : '';

    const [event, setEvent] = React.useState(initialEvent);
    const [user, setUser] = React.useState('');
    const [from, setFrom] = React.useState('');
    const [to, setTo] = React.useState('');
    const [q, setQ] = React.useState('');
    const [page, setPage] = React.useState(1);
    const [pageSize, setPageSize] = React.useState(25);
    const [openId, setOpenId] = React.useState<string | null>(null);
    const [exporting, setExporting] = React.useState(false);
    const [exportMsg, setExportMsg] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

    React.useEffect(() => {
        if (initialEvent) {
            setEvent(initialEvent);
            setPage(1);
        }
    }, [initialEvent]);

    const dUser = useDebounced(user.trim(), 350);
    const dQ = useDebounced(q.trim(), 350);
    const fromIso = toIso(from);
    const toIsoValue = toIso(to);

    let rangeError: string | null = null;
    if (fromIso && toIsoValue) {
        const span = new Date(toIsoValue).getTime() - new Date(fromIso).getTime();
        if (span < 0) rangeError = t('admin.console.account.audit.errors.fromAfterTo');
        else if (span > MAX_RANGE_MS) rangeError = t('admin.console.account.audit.errors.rangeTooLarge');
    }

    const filterQs = buildQuery({ event, user: dUser, from: fromIso, to: toIsoValue, q: dQ });
    const listUrl = rangeError ? null : `/api/admin/audit${buildQuery({ event, user: dUser, from: fromIso, to: toIsoValue, q: dQ, page, pageSize })}`;
    const { data, error, isLoading, isValidating, mutate } = useAdminQuery<AuditResponse>(listUrl);

    const resetPage = <T,>(setter: (v: T) => void) => (v: T) => {
        setter(v);
        setPage(1);
    };

    const eventOptions = React.useMemo(() => {
        const known = new Set<string>([...FAMILY_PREFIXES, ...(data?.eventTypes ?? [])]);
        if (event) known.add(event);
        return [
            { value: '', label: t('admin.console.account.audit.filters.allEvents') },
            ...Array.from(known).sort().map((v) => ({ value: v, label: v.endsWith('*') ? t('admin.console.account.audit.filters.family', { prefix: v }) : v })),
        ];
    }, [data?.eventTypes, event, t]);

    const rows = data?.items ?? [];
    const active = rows.find((r) => r.id === openId) ?? null;
    const hasFilters = !!(event || dUser || fromIso || toIsoValue || dQ);
    const nf = new Intl.NumberFormat(intlLocale);

    const clear = () => {
        setEvent('');
        setUser('');
        setFrom('');
        setTo('');
        setQ('');
        setPage(1);
    };

    const onExport = async () => {
        setExporting(true);
        setExportMsg(null);
        try {
            await downloadCsv(`/api/admin/audit/export${filterQs}`, 'audit.csv');
            setExportMsg({ kind: 'ok', text: t('admin.console.account.audit.export.done') });
        } catch (e) {
            setExportMsg({ kind: 'error', text: t(apiErrorKey(e)) });
        } finally {
            setExporting(false);
        }
    };

    const columns: Column<AuditEntry>[] = [
        {
            id: 'ts', header: t('admin.console.account.audit.table.date'), isRowHeader: true, className: 'whitespace-nowrap',
            cell: (r) => (
                <RowButton onClick={() => setOpenId(r.id)} label={t('admin.console.account.audit.table.open', { event: r.event })}>
                    {formatDateTime(r.ts, intlLocale)}
                </RowButton>
            ),
        },
        {
            id: 'event', header: t('admin.console.account.audit.table.event'),
            cell: (r) => <Badge tone={FAMILY_TONE[auditFamily(r.event)]} title={t(`admin.console.account.audit.family.${auditFamily(r.event)}`)}>{r.event}</Badge>,
        },
        {
            id: 'user', header: t('admin.console.account.audit.table.user'), hideBelow: 'sm',
            cell: (r) => r.userId
                ? <Link href={`/admin/users?open=${encodeURIComponent(r.userId)}`} className="break-all font-mono text-xs text-primary underline underline-offset-2">{r.userId}</Link>
                : <span className="text-muted-foreground">—</span>,
        },
        { id: 'ip', header: t('admin.console.account.audit.table.ip'), hideBelow: 'md', cell: (r) => <span className="font-mono text-xs">{r.ip ?? '—'}</span> },
    ];

    return (
        <div className="space-y-4">
            <Card>
                <FilterBar label={t('admin.console.account.audit.filters.label')}>
                    <FilterSelect label={t('admin.console.account.audit.filters.event')} value={event} onChange={resetPage(setEvent)} options={eventOptions} className="w-full sm:w-64" />
                    <div className="w-full sm:w-56">
                        <label htmlFor="audit-user" className={dtClass}>{t('admin.console.account.audit.filters.user')}</label>
                        <input id="audit-user" value={user} maxLength={200} autoComplete="off" onChange={(e) => resetPage(setUser)(e.target.value)} placeholder={t('admin.console.account.audit.filters.userPlaceholder')} className={inputClass} />
                    </div>
                    <div>
                        <label htmlFor="audit-from" className={dtClass}>{t('admin.console.account.audit.filters.from')}</label>
                        <input id="audit-from" type="datetime-local" value={from} onChange={(e) => resetPage(setFrom)(e.target.value)} aria-invalid={!!rangeError || undefined} aria-describedby={rangeError ? 'audit-range-err' : undefined} className={inputClass} />
                    </div>
                    <div>
                        <label htmlFor="audit-to" className={dtClass}>{t('admin.console.account.audit.filters.to')}</label>
                        <input id="audit-to" type="datetime-local" value={to} onChange={(e) => resetPage(setTo)(e.target.value)} aria-invalid={!!rangeError || undefined} aria-describedby={rangeError ? 'audit-range-err' : undefined} className={inputClass} />
                    </div>
                    <div className="w-full sm:w-56">
                        <span className={dtClass}>{t('admin.console.account.audit.filters.search')}</span>
                        <SearchInput value={q} onChange={resetPage(setQ)} label={t('admin.console.account.audit.filters.search')} placeholder={t('admin.console.account.audit.filters.searchPlaceholder')} className="sm:w-full" />
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {hasFilters && <button type="button" onClick={clear} className={btnOutline}>{t('admin.console.account.audit.filters.clear')}</button>}
                        <button type="button" onClick={() => void mutate()} className={btnOutline} disabled={isValidating}>
                            <RefreshCw className={isValidating ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden="true" />
                            {t('admin.console.account.audit.refresh')}
                        </button>
                        <button type="button" onClick={() => void onExport()} className={btnOutline} disabled={exporting || !!rangeError} aria-busy={exporting || undefined}>
                            <Download className="h-4 w-4" aria-hidden="true" />
                            {t('admin.console.account.audit.export.button')}
                        </button>
                    </div>
                </FilterBar>
                {rangeError && <p id="audit-range-err" role="alert" className="mt-2 text-sm text-destructive">{rangeError}</p>}
                <div aria-live="polite" className="mt-2 min-h-[1.25rem] text-sm">
                    {exportMsg && <p className={exportMsg.kind === 'error' ? 'text-destructive' : 'text-success'}>{exportMsg.text}</p>}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t('admin.console.account.audit.privacy')}</p>
            </Card>

            {error && !data ? (
                <ErrorState message={t(apiErrorKey(error))} onRetry={() => void mutate()} />
            ) : data && !data.available ? (
                <Card><EmptyState title={t('admin.console.account.audit.unavailable.title')} description={t('admin.console.account.audit.unavailable.description')} /></Card>
            ) : (
                <>
                    {error && <ErrorState message={t(apiErrorKey(error))} onRetry={() => void mutate()} />}
                    <DataTable<AuditEntry>
                        caption={t('admin.console.account.audit.table.caption')}
                        columns={columns}
                        rows={rows}
                        getRowId={(r) => r.id}
                        rowLabel={(r) => r.event}
                        activeRowId={openId}
                        loading={isLoading || (!data && !rangeError)}
                        empty={<EmptyState title={t(hasFilters ? 'admin.console.account.audit.empty.filtered' : 'admin.console.account.audit.empty.none')} description={hasFilters ? t('admin.console.account.audit.empty.filteredHint') : undefined} />}
                        minWidth={560}
                    />
                    {data && data.total > 0 && (
                        <Pagination page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
                    )}
                    {data?.totalCapped && <p className="text-xs text-muted-foreground">{t('admin.console.account.audit.capped', { max: nf.format(data.total) })}</p>}
                </>
            )}

            <DetailDrawer
                open={!!active}
                onClose={() => setOpenId(null)}
                title={active?.event ?? t('admin.console.account.audit.detail.title')}
                subtitle={active ? formatDateTime(active.ts, intlLocale) : undefined}
            >
                {active && (
                    <div className="space-y-4">
                        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                            <div><dt className={ddLabel}>{t('admin.console.account.audit.detail.id')}</dt><dd className="break-all font-mono text-xs">{active.id}</dd></div>
                            <div><dt className={ddLabel}>{t('admin.console.account.audit.table.user')}</dt><dd className="break-all font-mono text-xs">{active.userId ?? '—'}</dd></div>
                            <div><dt className={ddLabel}>{t('admin.console.account.audit.table.ip')}</dt><dd className="font-mono text-xs">{active.ip ?? '—'}</dd></div>
                            <div><dt className={ddLabel}>{t('admin.console.account.audit.detail.family')}</dt><dd><Badge tone={FAMILY_TONE[auditFamily(active.event)]}>{t(`admin.console.account.audit.family.${auditFamily(active.event)}`)}</Badge></dd></div>
                        </dl>
                        <div>
                            <h3 id="audit-json-title" className="mb-1 text-sm font-semibold text-foreground">{t('admin.console.account.audit.detail.data')}</h3>
                            <p className="mb-2 text-xs text-muted-foreground">{t('admin.console.account.audit.detail.masked')}</p>
                            <pre tabIndex={0} aria-labelledby="audit-json-title" className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-code p-3 text-xs text-code-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                {JSON.stringify(active.data, null, 2)}
                            </pre>
                        </div>
                    </div>
                )}
            </DetailDrawer>
        </div>
    );
}
