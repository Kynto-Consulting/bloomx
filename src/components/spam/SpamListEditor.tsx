'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Badge, Card, ErrorState, Field, FilterBar, FilterSelect, SearchInput, btnDangerOutline, btnOutline, btnPrimary, inputClass, selectClass, useDebounced } from '@/components/admin/console/ui';
import { DataTable, type Column } from '@/components/admin/console/DataTable';
import { Pagination } from '@/components/admin/console/Pagination';
import { StrongConfirmDialog } from '@/components/admin/console/StrongConfirmDialog';
import { ApiError, adminFetch, apiErrorKey, buildQuery, downloadCsv, useAdminQuery } from '@/components/admin/console/api';
import { formatDateTime } from '@/components/admin/console/format';

/**
 * Editor COMPARTIDO de las listas de spam (bloqueados, permitidos, externos de confianza).
 *  - variant "admin": consola, listas del DOMINIO (`/api/admin/spam/lists`): muestra "creada por", importa y exporta CSV.
 *  - variant "user":  Ajustes, listas PERSONALES (`/api/spam/lists`): sin "creada por", sin importar y el CSV se exporta con ?format=csv.
 * Textos bajo `spam.lists.*`. API estable: { apiBase, kind, variant, idPrefix?, headingLevel?, className? }.
 */

export type SpamListKind = 'block' | 'allow' | 'external';
export type SpamMatchType = 'email' | 'domain' | 'wildcard' | 'tld' | 'regex';

export interface SpamListRow {
    id: string;
    matchType: SpamMatchType;
    value: string;
    includeSubdomains: boolean;
    reason: string | null;
    expiresAt: string | null;
    expired: boolean;
    createdBy: string | null;
    hits: number;
    lastHitAt: string | null;
    createdAt: string;
}

interface ListResponse { rows: SpamListRow[]; total: number; limit: number }
interface AddResponse { added: number; duplicates: number; invalid: Array<{ index: number; error: string }>; limitReached: boolean }
interface ImportResponse extends AddResponse { lines: number; errors: Array<{ line: number; error: string }> }

export interface SpamListEditorProps {
    apiBase: string;
    kind: SpamListKind;
    variant: 'admin' | 'user';
    idPrefix?: string;
    headingLevel?: 2 | 3;
    className?: string;
}

const ALL_TYPES: SpamMatchType[] = ['email', 'domain', 'wildcard', 'tld', 'regex'];
const MAX_CSV_FILE = 2 * 1024 * 1024;
const SORTS = ['createdAt', 'hits', 'value', 'expiresAt'] as const;
const SORT_KEY: Record<(typeof SORTS)[number], string> = { createdAt: 'sortCreatedAt', hits: 'sortHits', value: 'sortValue', expiresAt: 'sortExpiresAt' };

function readFileText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
    });
}

export function SpamListEditor({ apiBase, kind, variant, idPrefix, headingLevel = 2, className }: SpamListEditorProps) {
    const { t, intlLocale } = useI18n();
    const p = idPrefix ?? `spam-list-${kind}`;
    const isAdmin = variant === 'admin';
    const base = `${apiBase}/${kind}`;
    const types = kind === 'external' ? ALL_TYPES.filter((x) => x !== 'regex') : ALL_TYPES;
    const nf = React.useMemo(() => new Intl.NumberFormat(intlLocale), [intlLocale]);
    const errText = (code: string) => {
        const key = `spam.lists.errors.${code}`;
        const s = t(key);
        return s === key ? t('spam.lists.errors.unknown') : s;
    };

    // --- listado ---
    const [q, setQ] = React.useState('');
    const [matchType, setMatchType] = React.useState('');
    const [status, setStatus] = React.useState('all');
    const [sort, setSort] = React.useState<(typeof SORTS)[number]>('createdAt');
    const [page, setPage] = React.useState(1);
    const [pageSize, setPageSize] = React.useState(25);
    const [selected, setSelected] = React.useState<string[]>([]);
    const dq = useDebounced(q, 300);
    React.useEffect(() => { setPage(1); setSelected([]); }, [dq, matchType, status, sort, pageSize]);

    const url = `${base}${buildQuery({ q: dq.trim(), matchType, status: status === 'all' ? '' : status, sort, page, pageSize })}`;
    const { data, error, isLoading, mutate } = useAdminQuery<ListResponse>(url);
    const rows = data?.rows ?? [];
    const total = data?.total ?? 0;
    const limit = data?.limit ?? 0;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const filtered = !!dq.trim() || !!matchType || status !== 'all';
    const full = !!data && limit > 0 && total >= limit;

    // --- estado de acciones ---
    const [notice, setNotice] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
    const ok = (text: string) => setNotice({ kind: 'ok', text });
    const fail = (e: unknown) => setNotice({ kind: 'error', text: e instanceof ApiError && e.code && t(`spam.lists.errors.${e.code}`) !== `spam.lists.errors.${e.code}` ? errText(e.code) : t(apiErrorKey(e)) });

    // --- alta ---
    const [aType, setAType] = React.useState<SpamMatchType>('domain');
    const [aValue, setAValue] = React.useState('');
    const [aSub, setASub] = React.useState(false);
    const [aReason, setAReason] = React.useState('');
    const [aExpires, setAExpires] = React.useState('');
    const [aError, setAError] = React.useState<string | null>(null);
    const [adding, setAdding] = React.useState(false);

    const submitAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (adding) return;
        setAdding(true);
        setAError(null);
        setNotice(null);
        try {
            let expiresAt: string | null = null;
            if (aExpires) { const d = new Date(aExpires); expiresAt = Number.isNaN(d.getTime()) ? aExpires : d.toISOString(); }
            const entry: Record<string, unknown> = { matchType: aType, value: aValue.trim() };
            if (aType === 'domain' || aType === 'wildcard') entry.includeSubdomains = aSub;
            if (aReason.trim()) entry.reason = aReason.trim();
            if (expiresAt) entry.expiresAt = expiresAt;
            const r = await adminFetch<AddResponse>(base, { method: 'POST', body: { entries: [entry] } });
            if (r.invalid.length > 0) { setAError(errText(r.invalid[0].error)); return; }
            if (r.limitReached) { setNotice({ kind: 'error', text: t('spam.lists.add.limitReached') }); return; }
            if (r.added > 0) { ok(t('spam.lists.add.added', { count: r.added })); setAValue(''); setAReason(''); setAExpires(''); }
            else if (r.duplicates > 0) setNotice({ kind: 'ok', text: t('spam.lists.add.duplicates') });
            await mutate();
        } catch (err) { fail(err); } finally { setAdding(false); }
    };

    // --- borrado ---
    const [confirm, setConfirm] = React.useState<{ ids: string[]; label: string } | null>(null);
    const [removeAllOpen, setRemoveAllOpen] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [dialogError, setDialogError] = React.useState<string | null>(null);

    const doRemove = async () => {
        if (!confirm) return;
        setBusy(true); setDialogError(null);
        try {
            const r = await adminFetch<{ deleted: number }>(base, { method: 'DELETE', body: { ids: confirm.ids } });
            setConfirm(null); setSelected([]);
            ok(t('spam.lists.remove.done', { count: r.deleted }));
            await mutate();
        } catch (err) { setDialogError(err instanceof ApiError ? t(apiErrorKey(err)) : errText('action')); } finally { setBusy(false); }
    };
    const doRemoveAll = async () => {
        setBusy(true); setDialogError(null);
        try {
            const r = await adminFetch<{ deleted: number }>(base, { method: 'DELETE', body: { all: true, confirm: true } });
            setRemoveAllOpen(false); setSelected([]);
            ok(t('spam.lists.removeAll.done', { count: r.deleted }));
            await mutate();
        } catch (err) { setDialogError(err instanceof ApiError ? t(apiErrorKey(err)) : errText('action')); } finally { setBusy(false); }
    };

    // --- CSV ---
    const [exporting, setExporting] = React.useState(false);
    const doExport = async () => {
        setExporting(true); setNotice(null);
        try { await downloadCsv(isAdmin ? `${base}/export` : `${base}?format=csv`, `spam-${kind}.csv`); }
        catch { setNotice({ kind: 'error', text: t('spam.lists.csv.exportFailed') }); }
        finally { setExporting(false); }
    };
    const [csvText, setCsvText] = React.useState('');
    const [csvFileError, setCsvFileError] = React.useState<string | null>(null);
    const [importing, setImporting] = React.useState(false);
    const [report, setReport] = React.useState<ImportResponse | null>(null);
    const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        setCsvFileError(null);
        if (!f) return;
        if (f.size > MAX_CSV_FILE) { setCsvFileError(t('spam.lists.csv.fileTooLarge')); e.target.value = ''; return; }
        try { setCsvText(await readFileText(f)); } catch { setCsvFileError(t('spam.lists.csv.exportFailed')); }
    };
    const doImport = async () => {
        if (!csvText.trim()) { setCsvFileError(t('spam.lists.csv.empty')); return; }
        setImporting(true); setReport(null); setCsvFileError(null);
        try {
            const r = await adminFetch<ImportResponse>(`${base}/import`, { method: 'POST', body: { csv: csvText } });
            setReport(r);
            await mutate();
        } catch (err) { setCsvFileError(err instanceof ApiError && err.code && t(`spam.lists.errors.${err.code}`) !== `spam.lists.errors.${err.code}` ? errText(err.code) : t(apiErrorKey(err))); }
        finally { setImporting(false); }
    };

    // --- tabla ---
    const columns: Column<SpamListRow>[] = [
        { id: 'value', header: t('spam.lists.table.value'), isRowHeader: true, className: 'break-all font-medium text-foreground', cell: (r) => <span translate="no">{r.value}</span> },
        { id: 'type', header: t('spam.lists.table.type'), cell: (r) => t(`spam.lists.types.${r.matchType}`) },
        { id: 'sub', header: t('spam.lists.table.subdomains'), hideBelow: 'md', cell: (r) => (r.matchType === 'domain' || r.matchType === 'wildcard' ? t(r.includeSubdomains ? 'spam.lists.table.yes' : 'spam.lists.table.no') : '—') },
        { id: 'reason', header: t('spam.lists.table.reason'), hideBelow: 'md', className: 'max-w-[16rem] break-words text-muted-foreground', cell: (r) => r.reason ?? '—' },
        {
            id: 'expires', header: t('spam.lists.table.expires'), hideBelow: 'sm',
            cell: (r) => (r.expiresAt ? (
                <span className="flex flex-wrap items-center gap-1">
                    <span>{formatDateTime(r.expiresAt, intlLocale)}</span>
                    {r.expired && <Badge tone="warning">{t('spam.lists.table.expired')}</Badge>}
                </span>
            ) : <span className="text-muted-foreground">{t('spam.lists.table.noExpiry')}</span>),
        },
        { id: 'hits', header: t('spam.lists.table.hits'), hideBelow: 'sm', className: 'tabular-nums', cell: (r) => nf.format(r.hits) },
        { id: 'lastHit', header: t('spam.lists.table.lastHit'), hideBelow: 'lg', cell: (r) => (r.lastHitAt ? formatDateTime(r.lastHitAt, intlLocale) : t('spam.lists.table.never')) },
        ...(isAdmin ? [{ id: 'createdBy', header: t('spam.lists.table.createdBy'), hideBelow: 'lg' as const, className: 'break-all text-muted-foreground', cell: (r: SpamListRow) => r.createdBy ?? '—' }] : []),
        {
            id: 'actions', header: t('spam.lists.table.actions'),
            cell: (r) => (
                <button type="button" className={btnDangerOutline} onClick={() => { setDialogError(null); setConfirm({ ids: [r.id], label: r.value }); }} aria-label={t('spam.lists.remove.row', { value: r.value })}>
                    {t('spam.lists.remove.confirm')}
                </button>
            ),
        },
    ];

    const showSub = aType === 'domain' || aType === 'wildcard';
    const guard = kind === 'block' ? (isAdmin ? 'spam.lists.guards.blockAdmin' : 'spam.lists.guards.blockUser') : `spam.lists.guards.${kind}`;

    return (
        <div className={className ?? 'space-y-6'} data-testid={`${p}-editor`}>
            <Card
                title={t(`spam.lists.title.${kind}`)}
                headingLevel={headingLevel}
                description={t(`spam.lists.intro.${kind}`)}
                actions={(
                    <>
                        <p id={`${p}-counter`} aria-live="polite" aria-label={t('spam.lists.counterLabel')} className="text-sm font-medium tabular-nums text-foreground">
                            {data ? t('spam.lists.counter', { total: nf.format(total), limit: nf.format(limit) }) : ''}
                        </p>
                        <button type="button" className={btnOutline} onClick={() => void doExport()} disabled={exporting} aria-busy={exporting || undefined}>
                            {t(exporting ? 'spam.lists.csv.exporting' : 'spam.lists.csv.exportButton')}
                        </button>
                        {total > 0 && (
                            <button type="button" className={btnDangerOutline} onClick={() => { setDialogError(null); setRemoveAllOpen(true); }}>
                                {t('spam.lists.removeAll.button')}
                            </button>
                        )}
                    </>
                )}
            >
                <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">{t(guard)}</p>
            </Card>

            <Card title={t('spam.lists.add.title')} headingLevel={headingLevel}>
                <form onSubmit={(e) => void submitAdd(e)} noValidate className="grid gap-4 md:grid-cols-2">
                    <Field label={t('spam.lists.add.type')} htmlFor={`${p}-type`}>
                        <select id={`${p}-type`} value={aType} onChange={(e) => { setAType(e.target.value as SpamMatchType); setAError(null); }} className={selectClass}>
                            {types.map((x) => <option key={x} value={x}>{t(`spam.lists.types.${x}`)}</option>)}
                        </select>
                    </Field>
                    <Field label={t('spam.lists.add.value')} htmlFor={`${p}-value`} error={aError} required>
                        <input
                            id={`${p}-value`}
                            value={aValue}
                            onChange={(e) => { setAValue(e.target.value); setAError(null); }}
                            placeholder={t(`spam.lists.add.placeholder.${aType}`)}
                            aria-invalid={!!aError || undefined}
                            aria-describedby={aError ? `${p}-value-err` : undefined}
                            autoComplete="off"
                            spellCheck={false}
                            maxLength={300}
                            className={inputClass}
                        />
                    </Field>
                    <Field label={t('spam.lists.add.reason')} htmlFor={`${p}-reason`}>
                        <input id={`${p}-reason`} value={aReason} onChange={(e) => setAReason(e.target.value)} maxLength={200} autoComplete="off" className={inputClass} />
                    </Field>
                    <Field label={t('spam.lists.add.expires')} htmlFor={`${p}-expires`} hint={t('spam.lists.add.expiresHint')}>
                        <input id={`${p}-expires`} type="datetime-local" value={aExpires} onChange={(e) => setAExpires(e.target.value)} aria-describedby={`${p}-expires-hint`} className={inputClass} />
                    </Field>
                    {showSub && (
                        <label className="flex items-center gap-2 text-sm text-foreground">
                            <input id={`${p}-sub`} type="checkbox" checked={aSub} onChange={(e) => setASub(e.target.checked)} className="h-4 w-4 rounded border-input accent-primary" />
                            {t('spam.lists.add.includeSubdomains')}
                        </label>
                    )}
                    <div className="flex flex-wrap items-center gap-3 md:col-span-2">
                        <button type="submit" className={btnPrimary} disabled={adding || !aValue.trim() || full} aria-busy={adding || undefined}>
                            {t(adding ? 'spam.lists.add.submitting' : 'spam.lists.add.submit')}
                        </button>
                        {full && <p className="text-sm text-warning">{t('spam.lists.full')}</p>}
                    </div>
                </form>
            </Card>

            <div role="status" aria-live="polite" className="min-h-[1.25rem] text-sm">
                {notice && <p className={notice.kind === 'error' ? 'text-destructive' : 'text-success'} role={notice.kind === 'error' ? 'alert' : undefined}>{notice.text}</p>}
            </div>

            <div className="space-y-3">
                <FilterBar label={t('spam.lists.filters.label')}>
                    <SearchInput value={q} onChange={setQ} label={t('spam.lists.filters.search')} placeholder={t('spam.lists.filters.searchPlaceholder')} />
                    <FilterSelect
                        label={t('spam.lists.filters.type')}
                        value={matchType}
                        onChange={setMatchType}
                        options={[{ value: '', label: t('spam.lists.filters.allTypes') }, ...types.map((x) => ({ value: x, label: t(`spam.lists.types.${x}`) }))]}
                    />
                    <FilterSelect
                        label={t('spam.lists.filters.status')}
                        value={status}
                        onChange={setStatus}
                        options={[{ value: 'all', label: t('spam.lists.filters.all') }, { value: 'active', label: t('spam.lists.filters.active') }, { value: 'expired', label: t('spam.lists.filters.expired') }]}
                    />
                    <FilterSelect
                        label={t('spam.lists.filters.sort')}
                        value={sort}
                        onChange={(v) => setSort(v as (typeof SORTS)[number])}
                        options={SORTS.map((s) => ({ value: s, label: t(`spam.lists.filters.${SORT_KEY[s]}`) }))}
                    />
                    {selected.length > 0 && (
                        <button type="button" className={btnDangerOutline} onClick={() => { setDialogError(null); setConfirm({ ids: selected, label: String(selected.length) }); }}>
                            {t('spam.lists.remove.selected', { count: selected.length })}
                        </button>
                    )}
                </FilterBar>

                {error && !data ? (
                    <ErrorState message={t('spam.lists.table.loadFailed')} onRetry={() => void mutate()} />
                ) : (
                    <DataTable
                        caption={t(`spam.lists.table.caption.${kind}`)}
                        columns={columns}
                        rows={rows}
                        getRowId={(r) => r.id}
                        rowLabel={(r) => r.value}
                        selectable
                        selected={selected}
                        onSelectedChange={setSelected}
                        loading={isLoading}
                        minWidth={720}
                        empty={<p className="px-4 py-8 text-center text-sm text-muted-foreground">{t(filtered ? 'spam.lists.table.emptyFiltered' : 'spam.lists.table.empty')}</p>}
                    />
                )}
                <Pagination page={page} pages={pages} total={total} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />
            </div>

            {isAdmin && (
                <Card title={t('spam.lists.csv.importTitle')} headingLevel={headingLevel} description={t('spam.lists.csv.importHint')}>
                    <div className="space-y-3">
                        <Field label={t('spam.lists.csv.textLabel')} htmlFor={`${p}-csv`}>
                            <textarea id={`${p}-csv`} value={csvText} onChange={(e) => setCsvText(e.target.value)} rows={5} spellCheck={false} className={`${inputClass} h-auto py-2 font-mono`} />
                        </Field>
                        <Field label={t('spam.lists.csv.fileLabel')} htmlFor={`${p}-csvfile`} error={csvFileError}>
                            <input id={`${p}-csvfile`} type="file" accept=".csv,text/csv,text/plain" onChange={(e) => void onFile(e)} className="block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm" />
                        </Field>
                        <button type="button" className={btnPrimary} onClick={() => void doImport()} disabled={importing} aria-busy={importing || undefined}>
                            {t(importing ? 'spam.lists.csv.running' : 'spam.lists.csv.run')}
                        </button>
                        <div role="status" aria-live="polite" className="space-y-2 text-sm">
                            {report && (
                                <>
                                    <p className="text-foreground">{t('spam.lists.csv.result', { added: report.added, duplicates: report.duplicates, lines: report.lines, errors: report.errors.length })}</p>
                                    {report.limitReached && <p className="text-warning">{t('spam.lists.csv.limitReached')}</p>}
                                    {report.errors.length > 0 && (
                                        <div className="max-h-64 overflow-auto rounded-lg border border-border">
                                            <table className="w-full text-sm">
                                                <caption className="sr-only">{t('spam.lists.csv.errorsCaption')}</caption>
                                                <thead className="bg-muted/60 text-left text-xs font-semibold uppercase text-muted-foreground">
                                                    <tr><th scope="col" className="px-3 py-2">{t('spam.lists.csv.line')}</th><th scope="col" className="px-3 py-2">{t('spam.lists.csv.error')}</th></tr>
                                                </thead>
                                                <tbody className="divide-y divide-border/60">
                                                    {report.errors.map((er, i) => (
                                                        <tr key={`${er.line}-${i}`}>
                                                            <th scope="row" className="px-3 py-2 text-left font-normal tabular-nums">{er.line}</th>
                                                            <td className="px-3 py-2">{errText(er.error)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </Card>
            )}

            <ConfirmDialog
                open={!!confirm}
                destructive
                title={t(confirm && confirm.ids.length > 1 ? 'spam.lists.remove.manyTitle' : 'spam.lists.remove.title')}
                description={confirm && confirm.ids.length > 1 ? t('spam.lists.remove.manyBody', { count: confirm.ids.length }) : t('spam.lists.remove.body', { value: confirm?.label ?? '' })}
                confirmLabel={t('spam.lists.remove.confirm')}
                cancelLabel={t('spam.lists.remove.cancel')}
                busy={busy}
                error={dialogError}
                onConfirm={() => void doRemove()}
                onCancel={() => setConfirm(null)}
            />
            <StrongConfirmDialog
                open={removeAllOpen}
                title={t('spam.lists.removeAll.title')}
                description={t('spam.lists.removeAll.body', { total: nf.format(total) })}
                phrase={t('spam.lists.removeAll.phrase')}
                confirmLabel={t('spam.lists.removeAll.confirm')}
                cancelLabel={t('spam.lists.removeAll.cancel')}
                busy={busy}
                error={dialogError}
                onConfirm={() => void doRemoveAll()}
                onCancel={() => setRemoveAllOpen(false)}
            />
        </div>
    );
}
