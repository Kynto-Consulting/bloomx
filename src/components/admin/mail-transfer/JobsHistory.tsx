'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
    ApiError, Badge, DataTable, DefinitionList, DetailDrawer, EmptyState, ErrorState, Pagination, adminFetch, btnOutline, downloadCsv, formatBytes, formatDateTime, formatNumber, useAdminQuery,
    type Tone,
} from '@/components/admin/console';
import { ProgressBar } from './Progress';
import { TERMINAL, errorText, jobErrorText, transferBase, type JobPublic, type TransferMode } from './api';

const TONE: Record<string, Tone> = {
    done: 'success', failed: 'danger', canceled: 'neutral', expired: 'neutral', running: 'info', queued: 'info', analyzing: 'info', ready: 'warning', uploading: 'info', uploaded: 'info', created: 'neutral',
};

/** Historial de trabajos: estado, progreso (sondeo), reanudar, cancelar, informe y descarga. */
export function JobsHistory({ mode, onOpen, refreshKey }: { mode: TransferMode; onOpen: (job: JobPublic) => void; refreshKey?: number }) {
    const { t, intlLocale } = useI18n();
    const base = transferBase(mode);
    const [page, setPage] = React.useState(1);
    const [pageSize, setPageSize] = React.useState(10);
    const [detail, setDetail] = React.useState<JobPublic | null>(null);
    const [confirm, setConfirm] = React.useState<{ kind: 'cancel' | 'remove'; job: JobPublic } | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const q = useAdminQuery<{ jobs: JobPublic[]; page: { page: number; pageSize: number; total: number; pages: number } }>(
        `${base}/jobs?page=${page}&pageSize=${pageSize}&r=${refreshKey ?? 0}`,
        { refreshInterval: (d) => (d?.jobs.some((j) => !TERMINAL.includes(j.status) && j.status !== 'ready') ? 3000 : 0) },
    );
    const rows = q.data?.jobs ?? [];

    const act = async (fn: () => Promise<unknown>) => {
        setBusy(true);
        setError(null);
        try { await fn(); await q.mutate(); } catch (e) { setError(errorText(t, e)); } finally { setBusy(false); }
    };

    const progress = (j: JobPublic): number | null => {
        if (j.status === 'done') return 100;
        if (j.status === 'uploading') return j.totalBytes > 0 ? (j.uploadedBytes / j.totalBytes) * 100 : 0;
        const total = Math.max(j.totalItems, j.doneItems);
        return total > 0 ? (j.doneItems / total) * 100 : null;
    };

    const actions = (j: JobPublic) => {
        const label = `${j.kind === 'import' ? t('admin.console.transfer.history.typeImport') : t('admin.console.transfer.history.typeExport')} ${j.fileName ?? j.id.slice(4, 12)}`;
        const btn = 'rounded px-2 py-1 text-xs font-medium text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
        const danger = 'rounded px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
        const active = !TERMINAL.includes(j.status);
        return (
            <div className="flex flex-wrap gap-1">
                <button type="button" className={btn} onClick={() => setDetail(j)} aria-label={`${t('admin.console.transfer.history.open')}: ${label}`}>{t('admin.console.transfer.history.open')}</button>
                {(j.status === 'failed' || (active && j.stale)) && (
                    <button type="button" className={btn} disabled={busy} aria-label={`${t('admin.console.transfer.history.resume')}: ${label}`} onClick={() => void act(() => adminFetch(`${base}/jobs/${j.id}/resume`, { method: 'POST' }))}>{t('admin.console.transfer.history.resume')}</button>
                )}
                {(j.status === 'ready' || j.status === 'uploading') && (
                    <button type="button" className={btn} onClick={() => onOpen(j)} aria-label={`${t('admin.console.transfer.import.resumeUpload')}: ${label}`}>{j.status === 'ready' ? t('admin.console.transfer.import.continueBtn') : t('admin.console.transfer.import.resumeUpload')}</button>
                )}
                {active && <button type="button" className={danger} disabled={busy} aria-label={`${t('admin.console.transfer.history.cancel')}: ${label}`} onClick={() => setConfirm({ kind: 'cancel', job: j })}>{t('admin.console.transfer.history.cancel')}</button>}
                {j.kind === 'import' && TERMINAL.includes(j.status) && j.doneItems > 0 && (
                    <button type="button" className={btn} aria-label={`${t('admin.console.transfer.history.report')}: ${label}`} onClick={() => void downloadCsv(`${base}/jobs/${j.id}/report?lang=${intlLocale.startsWith('en') ? 'en' : 'es'}`, 'bloomx-report.csv').catch((e) => setError(errorText(t, e)))}>{t('admin.console.transfer.history.report')}</button>
                )}
                {j.kind === 'export' && j.downloadable && <button type="button" className={btn} onClick={() => onOpen(j)} aria-label={`${t('admin.console.transfer.history.download')}: ${label}`}>{t('admin.console.transfer.history.download')}</button>}
                {TERMINAL.includes(j.status) && <button type="button" className={danger} disabled={busy} aria-label={`${t('admin.console.transfer.history.remove')}: ${label}`} onClick={() => setConfirm({ kind: 'remove', job: j })}>{t('admin.console.transfer.history.remove')}</button>}
            </div>
        );
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-foreground">{t('admin.console.transfer.history.title')}</h2>
                <button type="button" className={btnOutline} onClick={() => void q.mutate()}>{t('admin.console.transfer.history.refresh')}</button>
            </div>
            {q.error && <ErrorState message={errorText(t, q.error)} onRetry={() => void q.mutate()} />}
            {error && <ErrorState message={error} />}
            <DataTable
                caption={t('admin.console.transfer.history.caption')}
                rows={rows}
                getRowId={(r) => r.id}
                loading={q.isLoading}
                minWidth={760}
                empty={<EmptyState title={t('admin.console.transfer.history.empty')} description={t('admin.console.transfer.history.emptyHint')} />}
                columns={[
                    {
                        id: 'type', header: t('admin.console.transfer.history.colType'), isRowHeader: true,
                        cell: (r) => (
                            <div>
                                <p className="font-medium text-foreground">{r.kind === 'import' ? t('admin.console.transfer.history.typeImport') : t('admin.console.transfer.history.typeExport')}</p>
                                <p className="max-w-[14rem] truncate text-xs text-muted-foreground">{r.fileName ?? `${r.format.toUpperCase()} · ${r.scope}`}</p>
                            </div>
                        ),
                    },
                    {
                        id: 'status', header: t('admin.console.transfer.history.colStatus'),
                        cell: (r) => (
                            <div className="flex flex-wrap items-center gap-1">
                                <Badge tone={TONE[r.status] ?? 'neutral'}>{t(`admin.console.transfer.status.${r.status}`)}</Badge>
                                {!TERMINAL.includes(r.status) && r.stale && <Badge tone="warning">{t('admin.console.transfer.history.stalled')}</Badge>}
                            </div>
                        ),
                    },
                    {
                        id: 'progress', header: t('admin.console.transfer.history.colProgress'), hideBelow: 'sm',
                        cell: (r) => (
                            <div className="w-40">
                                <ProgressBar value={progress(r)} label={`${t('admin.console.transfer.history.colProgress')}: ${r.fileName ?? r.id}`} />
                                <p className="mt-1 text-xs tabular-nums text-muted-foreground">{formatNumber(r.doneItems, intlLocale)} / {formatNumber(Math.max(r.totalItems, r.doneItems), intlLocale)}</p>
                            </div>
                        ),
                    },
                    { id: 'size', header: t('admin.console.transfer.history.colSize'), hideBelow: 'md', cell: (r) => formatBytes(r.kind === 'export' ? r.outputBytes : r.totalBytes, intlLocale) },
                    { id: 'created', header: t('admin.console.transfer.history.colCreated'), hideBelow: 'lg', cell: (r) => formatDateTime(r.createdAt, intlLocale) },
                    { id: 'actions', header: t('admin.console.transfer.history.colActions'), cell: actions },
                ]}
            />
            {q.data && <Pagination page={q.data.page.page} pages={q.data.page.pages} total={q.data.page.total} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />}

            <DetailDrawer open={!!detail} onClose={() => setDetail(null)} title={t('admin.console.transfer.history.detailTitle')} subtitle={detail?.fileName ?? detail?.id}>
                {detail && <JobDetail job={detail} base={base} />}
            </DetailDrawer>

            <ConfirmDialog
                open={!!confirm}
                title={confirm?.kind === 'remove' ? t('admin.console.transfer.history.removeTitle') : t('admin.console.transfer.history.cancelTitle')}
                description={confirm?.kind === 'remove' ? t('admin.console.transfer.history.removeBody') : t('admin.console.transfer.history.cancelBody')}
                confirmLabel={confirm?.kind === 'remove' ? t('admin.console.transfer.history.removeConfirm') : t('admin.console.transfer.history.cancelConfirm')}
                cancelLabel={t('admin.console.transfer.history.keep')}
                destructive
                busy={busy}
                onCancel={() => setConfirm(null)}
                onConfirm={() => {
                    const c = confirm;
                    if (!c) return;
                    void act(() => (c.kind === 'remove' ? adminFetch(`${base}/jobs/${c.job.id}`, { method: 'DELETE' }) : adminFetch(`${base}/jobs/${c.job.id}/cancel`, { method: 'POST' }))).then(() => setConfirm(null));
                }}
            />
        </div>
    );
}

function JobDetail({ job, base }: { job: JobPublic; base: string }) {
    const { t, intlLocale } = useI18n();
    const [errors, setErrors] = React.useState<Array<{ mailbox: string; sourceKey: string; error: string | null }>>([]);
    React.useEffect(() => {
        let alive = true;
        adminFetch<{ errors: Array<{ mailbox: string; sourceKey: string; error: string | null }> }>(`${base}/jobs/${job.id}`).then((r) => { if (alive) setErrors(r.errors); }).catch((e) => { if (!(e instanceof ApiError)) throw e; });
        return () => { alive = false; };
    }, [base, job.id]);
    const err = jobErrorText(t, job.lastError);
    return (
        <div className="space-y-4">
            <DefinitionList items={[
                { label: t('admin.console.transfer.history.colType'), value: job.kind === 'import' ? t('admin.console.transfer.history.typeImport') : t('admin.console.transfer.history.typeExport') },
                { label: t('admin.console.transfer.history.colStatus'), value: t(`admin.console.transfer.status.${job.status}`) },
                { label: t('admin.console.transfer.history.colSize'), value: formatBytes(job.kind === 'export' ? job.outputBytes : job.totalBytes, intlLocale) },
                { label: t('admin.console.transfer.history.colProgress'), value: `${job.doneItems} / ${Math.max(job.totalItems, job.doneItems)}` },
                { label: t('admin.console.transfer.import.doneTitle'), value: t('admin.console.transfer.import.doneBody', { imported: job.importedItems, dup: job.duplicateItems, skipped: job.skippedItems, err: job.errorItems }) },
                { label: t('admin.console.transfer.history.colCreated'), value: formatDateTime(job.createdAt, intlLocale) },
                ...(job.outputSha256 ? [{ label: t('admin.console.transfer.export.sha256'), value: <code className="break-all font-mono text-xs">{job.outputSha256}</code> }] : []),
            ]} />
            {err && <ErrorState message={err} />}
            {errors.length > 0 && (
                <div>
                    <h3 className="text-sm font-medium text-foreground">{t('admin.console.transfer.history.errorsTitle')}</h3>
                    <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                        {errors.map((e, i) => <li key={i} className="break-all">{e.mailbox || '—'} · {e.sourceKey} · {jobErrorText(t, e.error) ?? e.error}</li>)}
                    </ul>
                </div>
            )}
        </div>
    );
}
