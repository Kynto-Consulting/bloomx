'use client';

import * as React from 'react';
import { Loader2, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '@/components/I18nProvider';
import {
    ApiError, Badge, Card, ErrorState, Field, Switch, adminFetch, btnOutline, btnPrimary, downloadCsv, formatBytes, formatDate, formatNumber, inputClass,
} from '@/components/admin/console';
import { ProviderGuide } from './ProviderGuide';
import { ProgressBar } from './Progress';
import { ReauthDialog } from './ReauthDialog';
import {
    MissingMailboxesDialog, defaultDecision, type MissingDecision, type MissingItem, type MissingResult, type PasswordConfig,
} from './MissingMailboxesDialog';
import { credentialsToCsv, downloadTextFile, type Credential } from './credentials';
import { TERMINAL, errorText, jobErrorText, transferBase, uploadInChunks, type JobPublic, type PreviewResponse, type TransferConfig, type TransferMode } from './api';
import { useJob } from './useJob';

type Phase = 'pick' | 'uploading' | 'analyzing' | 'preview' | 'summary' | 'working' | 'done';

const ACCEPT = '.mbox,.mbx,.eml,.zip,.gz,.tgz,.tar,.pst,.ost,.txt';
const EMAIL_SHAPE = /^[^\s@,;<>"()]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** Asistente de importacion: subida por trozos, analisis, vista previa, buzones faltantes, confirmacion y avance. */
export function ImportWizard({ mode, config, resumeJobId, onJobChange }: { mode: TransferMode; config: TransferConfig; resumeJobId?: string | null; onJobChange?: () => void }) {
    const { t, intlLocale } = useI18n();
    const uid = React.useId();
    const base = transferBase(mode);
    const isAdmin = mode === 'admin';

    const [phase, setPhase] = React.useState<Phase>('pick');
    const [jobId, setJobId] = React.useState<string | null>(resumeJobId ?? null);
    const [file, setFile] = React.useState<File | null>(null);
    const [uploaded, setUploaded] = React.useState(0);
    const [uploadError, setUploadError] = React.useState<string | null>(null);
    const [uploadRetry, setUploadRetry] = React.useState<number | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const abort = React.useRef<AbortController | null>(null);

    const [preview, setPreview] = React.useState<PreviewResponse | null>(null);
    const [decisions, setDecisions] = React.useState<Record<string, MissingDecision>>({});
    const [pwConfig, setPwConfig] = React.useState<PasswordConfig>({ mode: 'random', generic: '', mustChange: true });
    const [targetMode, setTargetMode] = React.useState<'auto' | 'single'>('auto');
    const [single, setSingle] = React.useState('');
    const [notify, setNotify] = React.useState(false);
    const [dialogOpen, setDialogOpen] = React.useState(false);
    const [typed, setTyped] = React.useState('');
    const [creating, setCreating] = React.useState<{ done: number; total: number } | null>(null);
    const [credentials, setCredentials] = React.useState<Credential[]>([]);
    const [credsDownloaded, setCredsDownloaded] = React.useState(false);
    const [reauthOpen, setReauthOpen] = React.useState(false);
    const pending = React.useRef<null | (() => Promise<void>)>(null);
    const existsCache = React.useRef(new Map<string, boolean | undefined>());

    const { job, error: pollError, refresh } = useJob(base, phase === 'analyzing' || phase === 'working' || phase === 'done' ? jobId : null);

    // ---- utilidades -------------------------------------------------------------------------------------------------
    const withReauth = React.useCallback(async (fn: () => Promise<void>) => {
        try {
            await fn();
        } catch (e) {
            if (isAdmin && e instanceof ApiError && e.code === 'reauth_required') {
                pending.current = fn;
                setReauthOpen(true);
                return;
            }
            throw e;
        }
    }, [isAdmin]);

    const checkExists = React.useCallback(async (address: string): Promise<boolean | undefined> => {
        const k = address.toLowerCase();
        if (existsCache.current.has(k)) return existsCache.current.get(k);
        if (!isAdmin) return undefined;
        try {
            const r = await adminFetch<{ mailboxes: Array<{ email: string }> }>(`${base}/mailboxes?q=${encodeURIComponent(k)}&pageSize=5`);
            const ok = r.mailboxes.some((m) => m.email.toLowerCase() === k);
            existsCache.current.set(k, ok);
            return ok;
        } catch {
            return undefined;
        }
    }, [base, isAdmin]);

    // ---- subida -------------------------------------------------------------------------------------------------------
    const runUpload = React.useCallback(async (id: string, f: File, chunkBytes: number, totalChunks: number) => {
        setPhase('uploading');
        setUploadError(null);
        const ctrl = new AbortController();
        abort.current = ctrl;
        try {
            await uploadInChunks({
                base, jobId: id, file: f, chunkBytes, totalChunks, signal: ctrl.signal,
                onProgress: (n) => { setUploaded(n); setUploadRetry(null); },
                onRetry: (n) => setUploadRetry(n + 1),
            });
            await adminFetch(`${base}/jobs/${id}/complete`, { method: 'POST' });
            setPhase('analyzing');
            onJobChange?.();
        } catch (e) {
            if ((e as { name?: string })?.name === 'AbortError') return;
            setUploadError(errorText(t, e));
        }
    }, [base, onJobChange, t]);

    const startFile = React.useCallback(async (f: File) => {
        setFile(f);
        setError(null);
        setUploaded(0);
        const go = async () => {
            if (f.size > config.limits.maxUploadBytes) { setError(t('admin.console.transfer.errors.file_too_large')); return; }
            if (jobId && resumeJobId) {
                // Reanudar una subida existente: mismo tamano
                const j = await adminFetch<{ job: JobPublic }>(`${base}/jobs/${jobId}`);
                if (j.job.totalBytes !== f.size) { setError(t('admin.console.transfer.errors.upload_incomplete')); return; }
                await runUpload(jobId, f, config.chunkBytes, Math.ceil(f.size / config.chunkBytes));
                return;
            }
            const r = await adminFetch<{ job: JobPublic; chunkBytes: number; totalChunks: number }>(`${base}/import`, { method: 'POST', body: { fileName: f.name, size: f.size } });
            setJobId(r.job.id);
            onJobChange?.();
            await runUpload(r.job.id, f, r.chunkBytes, r.totalChunks);
        };
        try {
            await withReauth(go);
        } catch (e) {
            setError(errorText(t, e));
        }
    }, [base, config.chunkBytes, config.limits.maxUploadBytes, jobId, onJobChange, resumeJobId, runUpload, t, withReauth]);

    // Trabajo abierto desde el historial
    React.useEffect(() => {
        if (!resumeJobId) return;
        setJobId(resumeJobId);
        void (async () => {
            try {
                const r = await adminFetch<{ job: JobPublic }>(`${base}/jobs/${resumeJobId}`);
                const s = r.job.status;
                setPhase(s === 'uploading' || s === 'created' ? 'pick' : s === 'analyzing' || s === 'uploaded' ? 'analyzing' : s === 'ready' ? 'preview' : 'working');
            } catch (e) { setError(errorText(t, e)); }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resumeJobId]);

    // analisis terminado -> vista previa
    React.useEffect(() => {
        if (phase === 'analyzing' && job?.status === 'ready') {
            void (async () => {
                try {
                    const p = await adminFetch<PreviewResponse>(`${base}/jobs/${job.id}/preview`);
                    setPreview(p);
                    const init: Record<string, MissingDecision> = {};
                    const items = missingItems(p);
                    for (const it of items) init[it.address] = defaultDecision(it, p.allowedDomains);
                    setDecisions(init);
                    setPhase('preview');
                    if (isAdmin && items.length > 0) setDialogOpen(true);
                } catch (e) { setError(errorText(t, e)); }
            })();
        }
        if (phase === 'preview' && !preview && jobId) {
            void adminFetch<PreviewResponse>(`${base}/jobs/${jobId}/preview`).then((p) => {
                setPreview(p);
                const init: Record<string, MissingDecision> = {};
                for (const it of missingItems(p)) init[it.address] = defaultDecision(it, p.allowedDomains);
                setDecisions(init);
            }).catch((e) => setError(errorText(t, e)));
        }
        if ((phase === 'working') && job && TERMINAL.includes(job.status)) setPhase('done');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [job?.status, phase]);

    // Aviso al salir si quedan credenciales sin descargar
    const credsPending = credentials.length > 0 && !credsDownloaded;
    React.useEffect(() => {
        if (!credsPending) return;
        const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', h);
        return () => window.removeEventListener('beforeunload', h);
    }, [credsPending]);

    const reset = () => {
        abort.current?.abort();
        setPhase('pick'); setJobId(null); setFile(null); setPreview(null); setDecisions({}); setError(null); setUploadError(null); setUploaded(0);
        setTyped(''); setSingle(''); setTargetMode('auto'); setNotify(false); setCreating(null);
    };

    const cancelJob = async () => {
        abort.current?.abort();
        if (jobId) await adminFetch(`${base}/jobs/${jobId}/cancel`, { method: 'POST' }).catch(() => undefined);
        onJobChange?.();
        reset();
    };

    // ---- decisiones ---------------------------------------------------------------------------------------------------
    const items = preview ? missingItems(preview) : [];
    const mailboxMap = React.useMemo(() => {
        const m: Record<string, string | null> = {};
        for (const [addr, d] of Object.entries(decisions)) {
            if (d.action === 'discard') m[addr] = null;
            else if (EMAIL_SHAPE.test(d.target.trim())) m[addr] = d.target.trim().toLowerCase();
        }
        return m;
    }, [decisions]);
    const unresolved = items.filter((it) => !(it.address in mailboxMap)).length;
    const toCreate = React.useMemo(() => {
        const set = new Set<string>();
        for (const d of Object.values(decisions)) if (d.action === 'create' && EMAIL_SHAPE.test(d.target.trim())) set.add(d.target.trim().toLowerCase());
        if (targetMode === 'single' && EMAIL_SHAPE.test(single.trim()) && isAdmin) {
            const s = single.trim().toLowerCase();
            const known = preview?.mailboxes.some((m) => m.address === s && m.status === 'exists');
            if (!known && existsCache.current.get(s) !== true && config.allowedDomains.includes(s.split('@')[1])) set.add(s);
        }
        return [...set];
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [decisions, targetMode, single, preview, dialogOpen]);

    const messages = Number(preview?.summary.messages ?? 0);
    const detectedTargets = targetMode === 'single' ? 1 : new Set([...preview?.mailboxes.filter((m) => m.status === 'exists').map((m) => m.address) ?? [], ...Object.values(mailboxMap).filter(Boolean) as string[]]).size;

    const confirm = async () => {
        if (!preview || !jobId || busy) return;
        setBusy(true);
        setError(null);
        const run = async () => {
            // 1) crear los buzones faltantes (por lotes; las credenciales solo viven en memoria)
            const batch = config.limits.maxCreatePerCall;
            const all = [...toCreate];
            if (isAdmin && all.length) {
                setCreating({ done: 0, total: all.length });
                const got: Credential[] = [];
                for (let i = 0; i < all.length; i += batch) {
                    const slice = all.slice(i, i + batch);
                    try {
                        const r = await adminFetch<{ created: Credential[]; failed: Array<{ email: string; code: string }> }>(`${base}/jobs/${jobId}/mailboxes`, {
                            method: 'POST',
                            body: { addresses: slice, passwordMode: pwConfig.mode, genericPassword: pwConfig.mode === 'generic' ? pwConfig.generic : undefined, mustChange: pwConfig.mustChange, confirmDomain: typed },
                        });
                        got.push(...r.created);
                        setCredentials((prev) => [...prev, ...r.created]);
                        if (r.failed.length) throw new ApiError(400, 'invalid_addresses');
                    } finally {
                        setCreating({ done: Math.min(all.length, i + batch), total: all.length });
                    }
                }
                setCreating(null);
            }
            // 2) confirmar la importacion
            await adminFetch(`${base}/jobs/${jobId}/confirm`, {
                method: 'POST',
                body: isAdmin
                    ? { confirmDomain: typed, targetMode, singleMailbox: targetMode === 'single' ? single.trim().toLowerCase() : undefined, mailboxMap, notifyUsers: notify }
                    : { targetMode: 'auto', mailboxMap: {} },
            });
            setPhase('working');
            onJobChange?.();
            void refresh();
        };
        try {
            await withReauth(run);
        } catch (e) {
            setCreating(null);
            setError(errorText(t, e));
        } finally {
            setBusy(false);
        }
    };

    // ---- render -------------------------------------------------------------------------------------------------------
    const pctUp = file ? Math.min(100, (uploaded / Math.max(1, file.size)) * 100) : 0;
    const analysisLabel = job?.phase === 'gunzip' || job?.phase === 'expand' ? t('admin.console.transfer.import.expanding') : job?.phase === 'pst' ? t('admin.console.transfer.import.converting') : t('admin.console.transfer.import.analyzing');
    const s = preview?.summary ?? {};

    return (
        <div className="space-y-4">
            {credsPending && phase !== 'pick' && (
                <Card title={t('admin.console.transfer.import.credentialsTitle')} description={t('admin.console.transfer.import.credentialsBody')}>
                    <button
                        type="button"
                        className={btnPrimary}
                        onClick={() => {
                            downloadTextFile(`bloomx-credenciales-${new Date().toISOString().slice(0, 10)}.csv`, credentialsToCsv(credentials));
                            setCredsDownloaded(true);
                            setCredentials([]);
                            toast.success(t('admin.console.transfer.import.credentialsDone'));
                        }}
                    >
                        {t('admin.console.transfer.import.credentialsDownload')} ({credentials.length})
                    </button>
                    <p className="mt-2 text-xs text-muted-foreground">{t('admin.console.transfer.import.credentialsLeave')}</p>
                </Card>
            )}

            {phase === 'pick' && (
                <>
                    <Card title={t('admin.console.transfer.import.title')} description={mode === 'self' ? t('admin.console.transfer.import.selfBody') : t('admin.console.transfer.import.intro')}>
                        {mode === 'self' && config.selfEmail && <p className="mb-3 text-sm text-foreground">{t('admin.console.transfer.import.selfLockNote', { email: config.selfEmail })}</p>}
                        <label
                            htmlFor={`${uid}-file`}
                            className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-accent/40"
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void startFile(f); }}
                        >
                            <UploadCloud className="h-8 w-8" aria-hidden="true" />
                            <span className="font-medium text-foreground">{t('admin.console.transfer.import.dropHere')}</span>
                            <span>{t('admin.console.transfer.import.fileLimit', { max: formatBytes(config.limits.maxUploadBytes, intlLocale) })}</span>
                            <input
                                id={`${uid}-file`}
                                type="file"
                                accept={ACCEPT}
                                aria-label={t('admin.console.transfer.import.fileInputLabel')}
                                className="sr-only"
                                onChange={(e) => { const f = e.target.files?.[0]; if (f) void startFile(f); e.target.value = ''; }}
                            />
                        </label>
                        {error && <div className="mt-3"><ErrorState message={error} /></div>}
                    </Card>
                    <ProviderGuide pstMaxBytes={config.limits.maxPstBytes} />
                </>
            )}

            {phase === 'uploading' && file && (
                <Card title={t('admin.console.transfer.import.title')} description={file.name}>
                    <p aria-live="polite" className="text-sm text-foreground">
                        {t('admin.console.transfer.import.uploading', { done: formatBytes(uploaded, intlLocale), total: formatBytes(file.size, intlLocale), percent: Math.round(pctUp) })}
                    </p>
                    <ProgressBar className="mt-2" value={pctUp} label={t('admin.console.transfer.import.uploading', { done: formatBytes(uploaded, intlLocale), total: formatBytes(file.size, intlLocale), percent: Math.round(pctUp) })} />
                    {uploadRetry !== null && <p className="mt-2 text-xs text-warning">{t('admin.console.transfer.import.chunkRetry', { n: uploadRetry })}</p>}
                    {uploadError && (
                        <div className="mt-3 space-y-2">
                            <ErrorState message={uploadError} />
                            <p className="text-xs text-muted-foreground">{t('admin.console.transfer.import.uploadPaused')}</p>
                            <div className="flex gap-2">
                                <button type="button" className={btnPrimary} onClick={() => jobId && file && void runUpload(jobId, file, config.chunkBytes, Math.ceil(file.size / config.chunkBytes))}>
                                    {t('admin.console.transfer.import.resumeUpload')}
                                </button>
                            </div>
                        </div>
                    )}
                    <div className="mt-4"><button type="button" className={btnOutline} onClick={() => void cancelJob()}>{t('admin.console.transfer.import.cancelUpload')}</button></div>
                </Card>
            )}

            {phase === 'analyzing' && (
                <Card title={t('admin.console.transfer.import.title')} description={job?.fileName ?? undefined}>
                    {job?.status === 'failed' ? (
                        <>
                            <ErrorState message={jobErrorText(t, job.lastError) ?? t('admin.console.transfer.errors.generic')} />
                            <div className="mt-3"><button type="button" className={btnOutline} onClick={reset}>{t('admin.console.transfer.import.newImport')}</button></div>
                        </>
                    ) : (
                        <>
                            <p aria-live="polite" className="flex items-center gap-2 text-sm text-foreground"><Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />{analysisLabel}</p>
                            {job && job.totalItems > 0 && <p className="mt-1 text-xs text-muted-foreground">{t('admin.console.transfer.import.analyzingDetail', { messages: formatNumber(job.totalItems, intlLocale) })}</p>}
                            <ProgressBar className="mt-3" value={null} label={analysisLabel} />
                            {pollError != null && <div className="mt-3"><ErrorState message={errorText(t, pollError)} onRetry={() => void refresh()} /></div>}
                            <div className="mt-4"><button type="button" className={btnOutline} onClick={() => void cancelJob()}>{t('admin.console.transfer.import.cancelJob')}</button></div>
                        </>
                    )}
                </Card>
            )}

            {phase === 'preview' && preview && (
                <Card title={t('admin.console.transfer.import.previewTitle')} description={t('admin.console.transfer.import.previewBody', { format: String(s.format ?? ''), messages: formatNumber(messages, intlLocale), count: preview.mailboxes.length })}>
                    <div className="space-y-4">
                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                            {s.dateMin && <span>{t('admin.console.transfer.import.range', { from: formatDate(String(s.dateMin), intlLocale), to: formatDate(String(s.dateMax), intlLocale) })}</span>}
                            {Number(s.oversize) > 0 && <span className="text-warning">{t('admin.console.transfer.import.oversize', { count: Number(s.oversize) })}</span>}
                            {Number(s.unknownMailbox) > 0 && <span>{t('admin.console.transfer.import.unknownMailbox', { count: Number(s.unknownMailbox) })}</span>}
                            {Object.values((s.skippedEntries ?? {}) as Record<string, number>).reduce((a, b) => a + b, 0) > 0 && <span>{t('admin.console.transfer.import.skippedEntries', { count: Object.values(s.skippedEntries as Record<string, number>).reduce((a, b) => a + b, 0) })}</span>}
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                                <h4 className="text-sm font-medium text-foreground">{t('admin.console.transfer.import.foldersTitle')}</h4>
                                <ul className="mt-1 flex flex-wrap gap-1.5">
                                    {Object.entries((s.folders ?? {}) as Record<string, number>).map(([f, n]) => <li key={f}><Badge>{f}: {formatNumber(n, intlLocale)}</Badge></li>)}
                                </ul>
                            </div>
                            <div>
                                <h4 className="text-sm font-medium text-foreground">{t('admin.console.transfer.import.labelsTitle')}</h4>
                                <ul className="mt-1 flex flex-wrap gap-1.5">
                                    {((s.labels ?? []) as Array<{ name: string; count: number }>).slice(0, 20).map((l) => <li key={l.name}><Badge tone="info">{l.name}: {formatNumber(l.count, intlLocale)}</Badge></li>)}
                                    {((s.labels ?? []) as unknown[]).length === 0 && <li className="text-xs text-muted-foreground">—</li>}
                                </ul>
                            </div>
                        </div>

                        {isAdmin && (
                            <fieldset className="space-y-2">
                                <legend className="text-sm font-medium text-foreground">{t('admin.console.transfer.import.mapTitle')}</legend>
                                <label className="flex items-center gap-2 text-sm text-foreground">
                                    <input type="radio" name={`${uid}-tm`} checked={targetMode === 'auto'} onChange={() => setTargetMode('auto')} className="h-4 w-4 accent-primary" />
                                    {t('admin.console.transfer.import.modeAuto')}
                                </label>
                                <label className="flex items-center gap-2 text-sm text-foreground">
                                    <input type="radio" name={`${uid}-tm`} checked={targetMode === 'single'} onChange={() => setTargetMode('single')} className="h-4 w-4 accent-primary" />
                                    {t('admin.console.transfer.import.modeSingle')}
                                </label>
                                {targetMode === 'single' && (
                                    <Field label={t('admin.console.transfer.import.singleLabel')} htmlFor={`${uid}-single`}>
                                        <input
                                            id={`${uid}-single`} type="email" autoComplete="off" className={inputClass} value={single}
                                            placeholder={t('admin.console.transfer.import.singlePlaceholder', { domain: preview.domain })}
                                            onChange={(e) => setSingle(e.target.value)}
                                            onBlur={() => { const v = single.trim().toLowerCase(); if (EMAIL_SHAPE.test(v)) void checkExists(v); }}
                                        />
                                    </Field>
                                )}
                            </fieldset>
                        )}

                        {(targetMode === 'auto' || !isAdmin) && (
                            <div className="overflow-x-auto rounded-lg border border-border">
                                <table className="w-full min-w-[32rem] text-sm">
                                    <caption className="sr-only">{t('admin.console.transfer.import.mapTitle')}</caption>
                                    <thead className="bg-muted/60 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                        <tr>
                                            <th scope="col" className="px-3 py-2">{t('admin.console.transfer.import.colDetected')}</th>
                                            <th scope="col" className="px-3 py-2 text-right">{t('admin.console.transfer.import.colCount')}</th>
                                            <th scope="col" className="px-3 py-2">{t('admin.console.transfer.import.colStatus')}</th>
                                            <th scope="col" className="px-3 py-2">{t('admin.console.transfer.import.colTarget')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {[...preview.mailboxes, ...(preview.unknown > 0 ? [{ address: '', count: preview.unknown, status: 'foreign_domain' as const }] : [])].map((m) => {
                                            const d = decisions[m.address];
                                            const target = !isAdmin ? config.selfEmail : d ? (d.action === 'discard' ? t('admin.console.transfer.import.targetDiscard') : d.target || t('admin.console.transfer.import.targetPick')) : m.status === 'exists' ? t('admin.console.transfer.import.targetSame') : '—';
                                            return (
                                                <tr key={m.address || 'unknown'}>
                                                    <th scope="row" className="max-w-[16rem] break-all px-3 py-2 text-left font-normal text-foreground">{m.address || t('admin.console.transfer.import.notDetected')}</th>
                                                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatNumber(m.count, intlLocale)}</td>
                                                    <td className="px-3 py-2">
                                                        <Badge tone={m.status === 'exists' ? 'success' : m.status === 'missing' ? 'warning' : 'neutral'}>
                                                            {m.status === 'exists' ? t('admin.console.transfer.import.statusExists') : m.status === 'missing' ? t('admin.console.transfer.import.statusMissing') : t('admin.console.transfer.import.statusForeign')}
                                                        </Badge>
                                                    </td>
                                                    <td className="break-all px-3 py-2 text-muted-foreground">{target}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {isAdmin && targetMode === 'auto' && items.length > 0 && (
                            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
                                <span className="min-w-0 flex-1">{t('admin.console.transfer.import.missingFound', { count: items.length })}</span>
                                <button type="button" className={btnOutline} onClick={() => setDialogOpen(true)}>{t('admin.console.transfer.import.resolveMissing')}</button>
                            </div>
                        )}
                        {isAdmin && targetMode === 'auto' && unresolved > 0 && <p role="status" className="text-xs text-warning">{t('admin.console.transfer.import.unresolved', { count: unresolved })}</p>}

                        {isAdmin && (
                            <div className="flex items-center gap-3">
                                <Switch checked={notify} onChange={setNotify} label={t('admin.console.transfer.import.notify')} />
                                <span className="text-sm text-foreground">{t('admin.console.transfer.import.notify')}</span>
                            </div>
                        )}
                        {error && <ErrorState message={error} />}
                        <div className="flex flex-wrap justify-end gap-2">
                            <button type="button" className={btnOutline} onClick={() => void cancelJob()}>{t('admin.console.transfer.import.cancelJob')}</button>
                            <button
                                type="button" className={btnPrimary}
                                disabled={isAdmin && targetMode === 'single' && !EMAIL_SHAPE.test(single.trim())}
                                onClick={() => { setPhase('summary'); setError(null); }}
                            >
                                {t('admin.console.transfer.import.continueBtn')}
                            </button>
                        </div>
                    </div>
                </Card>
            )}

            {phase === 'summary' && preview && (
                <Card title={t('admin.console.transfer.import.summaryTitle')}>
                    <p className="text-sm text-foreground">
                        {mode === 'self'
                            ? t('admin.console.transfer.import.selfBody')
                            : t('admin.console.transfer.import.summaryBody', { messages: formatNumber(messages, intlLocale), mailboxes: detectedTargets })}
                    </p>
                    {toCreate.length > 0 && <p className="mt-2 text-sm text-warning">{t('admin.console.transfer.import.summaryCreate', { count: toCreate.length })}</p>}
                    {isAdmin && targetMode === 'auto' && unresolved > 0 && <p role="status" className="mt-2 text-sm text-warning">{t('admin.console.transfer.import.unresolved', { count: unresolved })}</p>}
                    {isAdmin && (
                        <div className="mt-4 max-w-sm">
                            <Field label={t('admin.console.transfer.import.typeDomain', { domain: config.domain })} htmlFor={`${uid}-dom`}>
                                <input id={`${uid}-dom`} className={inputClass} autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={config.domain} />
                            </Field>
                        </div>
                    )}
                    {creating && <p aria-live="polite" className="mt-3 text-sm text-muted-foreground">{t('admin.console.transfer.import.creating', creating)}</p>}
                    {error && <div className="mt-3"><ErrorState message={error} /></div>}
                    <div className="mt-5 flex flex-wrap justify-end gap-2">
                        <button type="button" className={btnOutline} disabled={busy} onClick={() => setPhase('preview')}>{t('admin.console.transfer.common.back')}</button>
                        <button
                            type="button" className={btnPrimary} aria-busy={busy || undefined}
                            disabled={busy || (isAdmin && typed.trim().toLowerCase() !== config.domain.toLowerCase())}
                            onClick={() => void confirm()}
                        >
                            {busy ? t('admin.console.transfer.import.confirming') : t('admin.console.transfer.import.confirmBtn')}
                        </button>
                    </div>
                </Card>
            )}

            {(phase === 'working' || phase === 'done') && (
                <Card title={phase === 'done' ? t('admin.console.transfer.import.doneTitle') : t('admin.console.transfer.import.runningTitle')} description={job?.fileName ?? undefined}>
                    {job ? <ImportProgress job={job} done={phase === 'done'} onReset={reset} base={base} /> : <p role="status" className="text-sm text-muted-foreground">{t('admin.console.transfer.common.working')}</p>}
                    {phase === 'working' && (
                        <div className="mt-4"><button type="button" className={btnOutline} onClick={() => void cancelJob()}>{t('admin.console.transfer.import.cancelJob')}</button></div>
                    )}
                </Card>
            )}

            <MissingMailboxesDialog
                open={dialogOpen}
                items={items}
                domains={config.allowedDomains}
                initial={decisions}
                initialPassword={pwConfig}
                checkExists={checkExists}
                onClose={() => setDialogOpen(false)}
                onSave={(r: MissingResult) => { setDecisions(r.decisions); setPwConfig(r.password); setDialogOpen(false); }}
            />
            <ReauthDialog
                open={reauthOpen}
                base={base}
                mfaEnrolled={config.reauth.mfaEnrolled}
                canUsePassword={config.reauth.canUsePassword}
                isAdmin={isAdmin}
                onClose={() => { setReauthOpen(false); pending.current = null; setBusy(false); }}
                onVerified={() => {
                    setReauthOpen(false);
                    const fn = pending.current;
                    pending.current = null;
                    if (fn) void fn().catch((e) => { setError(errorText(t, e)); setBusy(false); });
                }}
            />
        </div>
    );
}

function ImportProgress({ job, done, onReset, base }: { job: JobPublic; done: boolean; onReset: () => void; base: string }) {
    const { t, intlLocale } = useI18n();
    const total = Math.max(job.totalItems, job.doneItems);
    const pct = total > 0 ? (job.doneItems / total) * 100 : job.status === 'done' ? 100 : null;
    const msg = jobErrorText(t, job.lastError);
    return (
        <div>
            <p aria-live="polite" className="text-sm text-foreground">
                {done
                    ? t('admin.console.transfer.import.doneBody', { imported: job.importedItems, dup: job.duplicateItems, skipped: job.skippedItems, err: job.errorItems })
                    : t('admin.console.transfer.import.runningDetail', { done: formatNumber(job.doneItems, intlLocale), total: formatNumber(total, intlLocale), imported: job.importedItems, dup: job.duplicateItems, err: job.errorItems })}
            </p>
            <ProgressBar className="mt-2" value={pct} label={t('admin.console.transfer.import.runningTitle')} />
            {job.status === 'failed' && msg && <div className="mt-3"><ErrorState message={msg} /></div>}
            {job.status === 'canceled' && <p className="mt-2 text-sm text-muted-foreground">{t(`admin.console.transfer.status.canceled`)}</p>}
            {done && (
                <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" className={btnOutline} onClick={() => void downloadCsv(`${base}/jobs/${job.id}/report`, 'bloomx-import-report.csv')}>{t('admin.console.transfer.import.report')}</button>
                    <button type="button" className={btnPrimary} onClick={onReset}>{t('admin.console.transfer.import.newImport')}</button>
                </div>
            )}
        </div>
    );
}

function missingItems(p: PreviewResponse): MissingItem[] {
    const out: MissingItem[] = p.mailboxes.filter((m) => m.status !== 'exists').map((m) => ({ address: m.address, count: m.count, status: m.status as 'missing' | 'foreign_domain' }));
    if (p.unknown > 0) out.push({ address: '', count: p.unknown, status: 'unknown' });
    return out;
}
