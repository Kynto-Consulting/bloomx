'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, Loader2, Pause, Play, RefreshCw, RotateCcw, Trash2, XCircle, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useI18n } from '@/components/I18nProvider';
import { cn } from '@/lib/utils';
import type { CampaignAction, CampaignRowStatus, CampaignStatus } from '@/lib/elixir-campaigns';
import { campaignsApi, ElixirApiError, pollIntervalMs, type CampaignDto, type CampaignRowDto } from '@/lib/elixir-campaigns-client';

const ROW_PAGE = 100;
const FILTERS: Array<'all' | CampaignRowStatus> = ['all', 'sent', 'pending', 'error', 'skipped', 'unsubscribed', 'bounced', 'complained'];

const STATUS_KEY: Record<CampaignStatus, string> = {
    draft: 'elixir.statusDraft', running: 'elixir.statusRunning', paused: 'elixir.statusPaused',
    done: 'elixir.statusDone', cancelled: 'elixir.statusCancelled', failed: 'elixir.statusFailed',
};
const ROW_KEY: Record<CampaignRowStatus, string> = {
    pending: 'elixir.rowPending', sending: 'elixir.rowSending', sent: 'elixir.rowSent', error: 'elixir.rowError',
    skipped: 'elixir.rowSkipped', unsubscribed: 'elixir.rowUnsubscribed', bounced: 'elixir.rowBounced', complained: 'elixir.rowComplained',
};

function statusTone(s: CampaignStatus) {
    return s === 'done' ? 'bg-success/15 text-success' : s === 'running' ? 'bg-primary/10 text-primary'
        : s === 'failed' ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground';
}
function rowTone(s: CampaignRowStatus) {
    return s === 'sent' ? 'bg-success/15 text-success' : s === 'error' || s === 'bounced' || s === 'complained' ? 'bg-destructive/15 text-destructive'
        : s === 'pending' || s === 'sending' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground';
}

/** Visibilidad de la pestana del navegador (para espaciar el polling). */
function useDocumentHidden() {
    const [hidden, setHidden] = useState(false);
    useEffect(() => {
        const on = () => setHidden(document.visibilityState === 'hidden');
        on();
        document.addEventListener('visibilitychange', on);
        return () => document.removeEventListener('visibilitychange', on);
    }, []);
    return hidden;
}

/** Historial de campanas en segundo plano con progreso por polling y estado por fila. */
export function CampaignHistory({ initialId, refreshKey }: { initialId?: string | null; refreshKey?: number }) {
    const { t, intlLocale } = useI18n();
    const [selected, setSelected] = useState<string | null>(initialId ?? null);
    const [list, setList] = useState<CampaignDto[] | null>(null);
    const [listError, setListError] = useState<string | null>(null);
    const [detail, setDetail] = useState<CampaignDto | null>(null);
    const [rows, setRows] = useState<CampaignRowDto[]>([]);
    const [rowsHasMore, setRowsHasMore] = useState(false);
    const [loadingRows, setLoadingRows] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);
    const [filter, setFilter] = useState<'all' | CampaignRowStatus>('all');
    const [busy, setBusy] = useState<string | null>(null);
    const [confirm, setConfirm] = useState<null | { kind: 'cancel' | 'delete'; id: string }>(null);
    const [confirmBusy, setConfirmBusy] = useState(false);
    const [confirmError, setConfirmError] = useState<string | null>(null);
    const hidden = useDocumentHidden();
    const api = useMemo(() => campaignsApi(), []);
    const seq = useRef(0);
    const rowsLen = useRef(0);
    rowsLen.current = rows.length;
    const lastNudge = useRef(0);
    const hasList = useRef(false);

    useEffect(() => { if (initialId) setSelected(initialId); }, [initialId]);

    const err = useCallback((e: unknown, fallback: string) => {
        if (e instanceof ElixirApiError) {
            if (e.code === 'elixir_tables_missing') return t('elixir.tablesMissing');
            if (e.status === 0) return t('common.networkError');
        }
        return fallback;
    }, [t]);

    // ── Lista ──
    const loadList = useCallback(async (silent = false) => {
        try {
            const r = await api.list(50, 0);
            hasList.current = true; setList(r.campaigns); setListError(null);
        } catch (e) {
            if (!silent || !hasList.current) setListError(err(e, t('elixir.historyError')));
            setList(prev => prev ?? []);
        }
    }, [api, err, t]);

    // ── Detalle (recarga la primera pagina de filas; conserva las ya cargadas si el estado no cambio) ──
    const loadDetail = useCallback(async (id: string, status: 'all' | CampaignRowStatus, silent = false) => {
        const my = ++seq.current;
        try {
            const keep = silent ? Math.min(Math.max(rowsLen.current, ROW_PAGE), 1000) : ROW_PAGE;
            const r = await api.get(id, { status: status === 'all' ? null : status, limit: Math.min(200, keep) });
            if (my !== seq.current) return;
            setDetail(r.campaign); setRows(r.rows); setRowsHasMore(r.rows.length >= Math.min(200, keep)); setDetailError(null);
        } catch (e) {
            if (my !== seq.current) return;
            if (e instanceof ElixirApiError && e.status === 404) { setSelected(null); return; }
            setDetailError(err(e, t('elixir.historyError')));
        }
    }, [api, err, t]);

    useEffect(() => { void loadList(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!selected) { setDetail(null); setRows([]); return; }
        setDetail(null); setRows([]);
        void loadDetail(selected, filter);
    }, [selected, filter]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Polling: solo mientras haya campanas en curso; mas lento con la pestana oculta ──
    const activeStatus: CampaignStatus | undefined = selected ? detail?.status : list?.some(c => c.status === 'running') ? 'running' : undefined;
    const pollMs = pollIntervalMs(activeStatus, hidden);
    useEffect(() => {
        if (pollMs === null) return;
        const id = window.setInterval(() => {
            if (selected) void loadDetail(selected, filter, true); else void loadList(true);
        }, pollMs);
        return () => window.clearInterval(id);
    }, [pollMs, selected, filter, loadDetail, loadList]);

    // Si el cron no avanza (p. ej. cron diario), empuja un lote desde el navegador abierto, como maximo cada 30 s.
    const stuckTicks = useRef(0);
    const lastProcessed = useRef(-1);
    useEffect(() => {
        if (!detail || detail.status !== 'running') { stuckTicks.current = 0; lastProcessed.current = -1; return; }
        if (detail.progress.processed === lastProcessed.current) stuckTicks.current++; else { stuckTicks.current = 0; lastProcessed.current = detail.progress.processed; }
        if (stuckTicks.current >= 4 && Date.now() - lastNudge.current > 30_000) {
            lastNudge.current = Date.now(); stuckTicks.current = 0;
            void api.tick(detail.id).catch(() => undefined);
        }
    }, [detail, api]);

    const loadMoreRows = async () => {
        if (!selected || loadingRows) return;
        setLoadingRows(true);
        try {
            const r = await api.get(selected, { status: filter === 'all' ? null : filter, limit: ROW_PAGE, offset: rows.length });
            setRows(prev => { const seen = new Set(prev.map(x => x.idx)); return [...prev, ...r.rows.filter(x => !seen.has(x.idx))]; });
            setRowsHasMore(r.rows.length >= ROW_PAGE);
        } catch (e) { toast.error(err(e, t('elixir.historyError'))); }
        finally { setLoadingRows(false); }
    };

    const act = async (id: string, action: CampaignAction) => {
        setBusy(`${id}:${action}`);
        try {
            const c = await api.action(id, action);
            setDetail(prev => (prev && prev.id === id ? c : prev));
            setList(prev => prev?.map(x => (x.id === id ? c : x)) ?? prev);
            if (selected === id) void loadDetail(id, filter, true);
        } catch (e) {
            const msg = e instanceof ElixirApiError && e.status !== 0 && e.status < 500 ? e.message : err(e, t('elixir.actionFailed'));
            toast.error(msg);
        } finally { setBusy(null); }
    };

    const runConfirm = async () => {
        if (!confirm) return;
        setConfirmBusy(true); setConfirmError(null);
        try {
            if (confirm.kind === 'cancel') {
                await api.action(confirm.id, 'cancel');
                if (selected === confirm.id) void loadDetail(confirm.id, filter, true); else void loadList(true);
            } else {
                await api.remove(confirm.id);
                setList(prev => prev?.filter(x => x.id !== confirm.id) ?? prev);
                if (selected === confirm.id) setSelected(null);
            }
            setConfirm(null);
        } catch (e) { setConfirmError(e instanceof ElixirApiError && e.status === 409 ? e.message : err(e, t('elixir.actionFailed'))); }
        finally { setConfirmBusy(false); }
    };

    const fmt = (iso: string | null) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString(intlLocale, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; } };

    const ProgressBar = ({ c }: { c: CampaignDto }) => (
        <div>
            <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground tabular-nums">{t('elixir.progress', { processed: c.progress.processed, total: c.progress.total, percent: c.progress.percent })}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={c.progress.percent} aria-valuemin={0} aria-valuemax={100} aria-label={c.name}>
                <div className={cn('h-full transition-all', c.status === 'failed' ? 'bg-destructive' : 'bg-primary')} style={{ width: `${c.progress.percent}%` }} />
            </div>
        </div>
    );

    const Counts = ({ c }: { c: CampaignDto }) => (
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
            <span>{t('elixir.rowSent')} {c.counts.sent}</span>
            {c.counts.pending + c.counts.sending > 0 && <span>{t('elixir.rowPending')} {c.counts.pending + c.counts.sending}</span>}
            {c.counts.error > 0 && <span className="text-destructive">{t('elixir.rowError')} {c.counts.error}</span>}
            {c.counts.bounced + c.counts.complained > 0 && <span className="text-destructive">{t('elixir.rowBounced')} {c.counts.bounced + c.counts.complained}</span>}
            {c.counts.unsubscribed > 0 && <span>{t('elixir.rowUnsubscribed')} {c.counts.unsubscribed}</span>}
            {c.counts.skipped > 0 && <span>{t('elixir.rowSkipped')} {c.counts.skipped}</span>}
        </p>
    );

    const StatusBadge = ({ s }: { s: CampaignStatus }) => (
        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', statusTone(s))}>
            {s === 'running' && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}{t(STATUS_KEY[s])}
        </span>
    );

    const actionBtn = 'inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50';

    // ── Detalle ──
    if (selected) {
        const c = detail;
        return (
            <div className="flex h-full min-h-0 flex-col">
                <div className="shrink-0 space-y-3 border-b border-border p-4">
                    <button type="button" onClick={() => setSelected(null)} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />{t('elixir.back')}</button>
                    {!c && !detailError && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t('elixir.historyLoading')}</p>}
                    {detailError && <p role="alert" className="flex items-center gap-2 text-sm text-destructive"><AlertCircle className="h-4 w-4" aria-hidden="true" />{detailError}<button type="button" onClick={() => void loadDetail(selected, filter)} className="underline">{t('contacts.retry')}</button></p>}
                    {c && (
                        <>
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className="min-w-0 truncate text-base font-semibold">{c.name || t('elixir.untitled')}</h2>
                                <StatusBadge s={c.status} />
                                {c.status === 'running' && <span className="text-xs text-muted-foreground">{t('elixir.polling')}</span>}
                            </div>
                            <p className="truncate text-xs text-muted-foreground">{c.subject} · {fmt(c.createdAt)}</p>
                            <ProgressBar c={c} />
                            <Counts c={c} />
                            {c.lastError && c.status !== 'done' && <p role="alert" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">{t('elixir.lastError')}: {c.lastError}</p>}
                            <div className="flex flex-wrap gap-2">
                                {c.status === 'running' && <button type="button" className={actionBtn} disabled={!!busy} onClick={() => void act(c.id, 'pause')}><Pause className="h-3.5 w-3.5" aria-hidden="true" />{t('elixir.pause')}</button>}
                                {(c.status === 'paused' || c.status === 'cancelled' || c.status === 'failed') && <button type="button" className={cn(actionBtn, 'bg-primary text-primary-foreground hover:bg-primary/90 border-primary')} disabled={!!busy} onClick={() => void act(c.id, 'resume')}><Play className="h-3.5 w-3.5" aria-hidden="true" />{t('elixir.resume')}</button>}
                                {(c.status === 'running' || c.status === 'paused') && <button type="button" className={actionBtn} disabled={!!busy} onClick={() => { setConfirmError(null); setConfirm({ kind: 'cancel', id: c.id }); }}><XCircle className="h-3.5 w-3.5" aria-hidden="true" />{t('elixir.cancel')}</button>}
                                {c.counts.error > 0 && c.status !== 'running' && <button type="button" className={actionBtn} disabled={!!busy} onClick={() => void act(c.id, 'retry_errors')}><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />{t('elixir.retryErrors')}</button>}
                                {c.status === 'running' && <button type="button" className={actionBtn} title={t('elixir.nudgeHelp')} onClick={() => { void api.tick(c.id).then(() => loadDetail(c.id, filter, true)).catch(() => undefined); }}><Zap className="h-3.5 w-3.5" aria-hidden="true" />{t('elixir.nudge')}</button>}
                                {c.status !== 'running' && <button type="button" className={cn(actionBtn, 'text-destructive')} disabled={!!busy} onClick={() => { setConfirmError(null); setConfirm({ kind: 'delete', id: c.id }); }}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{t('elixir.deleteCampaign')}</button>}
                            </div>
                            <div className="flex flex-wrap gap-2 text-xs" role="group" aria-label={t('elixir.colStatus')}>
                                {FILTERS.map(k => (
                                    <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
                                        className={cn('rounded-full border px-2.5 py-1 transition-colors', filter === k ? 'border-primary/40 bg-primary/10 font-medium text-primary' : 'border-border text-muted-foreground hover:bg-muted')}>
                                        {k === 'all' ? t('elixir.filterAll') : t(ROW_KEY[k])}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                    <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                            <tr>
                                <th scope="col" className="border-b border-border px-4 py-2 text-left font-semibold text-muted-foreground">{t('elixir.colRow')}</th>
                                <th scope="col" className="border-b border-border px-4 py-2 text-left font-semibold text-muted-foreground">{t('elixir.colEmail')}</th>
                                <th scope="col" className="border-b border-border px-4 py-2 text-left font-semibold text-muted-foreground">{t('elixir.colStatus')}</th>
                                <th scope="col" className="hidden border-b border-border px-4 py-2 text-left font-semibold text-muted-foreground sm:table-cell">{t('elixir.colMessage')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(r => (
                                <tr key={r.idx} className="border-b border-border/50 hover:bg-muted/20">
                                    <td className="px-4 py-2 tabular-nums text-muted-foreground">{r.idx + 1}</td>
                                    <td className="max-w-[16rem] truncate px-4 py-2 font-mono">{r.email}</td>
                                    <td className="px-4 py-2"><span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', rowTone(r.status))}>{t(ROW_KEY[r.status])}</span></td>
                                    <td className="hidden px-4 py-2 text-muted-foreground sm:table-cell">{r.message || '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {rowsHasMore && (
                        <div className="py-3 text-center">
                            <button type="button" onClick={() => void loadMoreRows()} disabled={loadingRows} className={actionBtn}>{loadingRows ? t('contacts.loadingMore') : t('elixir.loadMoreRows')}</button>
                        </div>
                    )}
                </div>
                {renderConfirm()}
            </div>
        );
    }

    // ── Lista ──
    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border p-4">
                <h2 className="text-sm font-semibold">{t('elixir.historyTitle')}</h2>
                <button type="button" onClick={() => void loadList()} className={actionBtn}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />{t('elixir.refresh')}</button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
                {list === null && <p role="status" className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t('elixir.historyLoading')}</p>}
                {listError && <p role="alert" className="mb-3 flex items-center gap-2 text-sm text-destructive"><AlertCircle className="h-4 w-4" aria-hidden="true" />{listError}</p>}
                {list && list.length === 0 && !listError && <p className="p-8 text-center text-sm text-muted-foreground">{t('elixir.historyEmpty')}</p>}
                <ul className="space-y-3">
                    {list?.map(c => (
                        <li key={c.id}>
                            <button type="button" onClick={() => { setFilter('all'); setSelected(c.id); }} className="block w-full space-y-2 rounded-xl border border-border bg-background p-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                <span className="flex flex-wrap items-center gap-2">
                                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name || t('elixir.untitled')}</span>
                                    <StatusBadge s={c.status} />
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">{c.subject} · {fmt(c.createdAt)}</span>
                                <ProgressBar c={c} />
                                <Counts c={c} />
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
            {renderConfirm()}
        </div>
    );

    function renderConfirm() {
        return (
            <ConfirmDialog
                open={!!confirm} destructive busy={confirmBusy} error={confirmError}
                title={confirm?.kind === 'delete' ? t('elixir.deleteCampaign') : t('elixir.cancel')}
                description={confirm?.kind === 'delete' ? t('elixir.deleteCampaignConfirm') : t('elixir.cancelConfirm')}
                confirmLabel={confirm?.kind === 'delete' ? t('elixir.deleteCampaign') : t('elixir.cancel')}
                cancelLabel={t('elixir.keepGoing')}
                onConfirm={() => void runConfirm()} onCancel={() => setConfirm(null)}
            />
        );
    }
}
