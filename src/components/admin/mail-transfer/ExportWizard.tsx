'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import {
    ApiError, Card, DataTable, ErrorState, Field, Pagination, SearchInput, Switch, adminFetch, btnOutline, btnPrimary, formatBytes, formatDateTime, inputClass,
    useAdminQuery, useDebounced,
} from '@/components/admin/console';
import { ProgressBar } from './Progress';
import { ReauthDialog } from './ReauthDialog';
import { errorText, jobErrorText, transferBase, type JobPublic, type TransferConfig, type TransferMode } from './api';
import { useJob } from './useJob';

const FOLDERS = ['inbox', 'sent', 'archive', 'spam', 'trash'] as const;
type Scope = 'domain' | 'selected' | 'one';

interface MailboxesResponse {
    mailboxes: Array<{ email: string; name: string | null; emails: number }>;
    page: { page: number; pageSize: number; total: number; pages: number };
    totalMailboxes: number;
}

/** Asistente de exportacion: alcance, filtros, formato, cifrado, confirmacion escribiendo el dominio, progreso y descarga. */
export function ExportWizard({ mode, config, resumeJobId, onJobChange }: { mode: TransferMode; config: TransferConfig; resumeJobId?: string | null; onJobChange?: () => void }) {
    const { t, intlLocale } = useI18n();
    const uid = React.useId();
    const base = transferBase(mode);
    const isAdmin = mode === 'admin';

    const [scope, setScope] = React.useState<Scope>(isAdmin ? 'domain' : 'one');
    const [picked, setPicked] = React.useState<string[]>([]);
    const [q, setQ] = React.useState('');
    const dq = useDebounced(q, 300);
    const [page, setPage] = React.useState(1);
    const [folders, setFolders] = React.useState<string[]>([]);
    const [from, setFrom] = React.useState('');
    const [to, setTo] = React.useState('');
    const [attachments, setAttachments] = React.useState(true);
    const [format, setFormat] = React.useState<'mbox' | 'eml'>('mbox');
    const [encrypt, setEncrypt] = React.useState(false);
    const [password, setPassword] = React.useState('');
    const [oneTime, setOneTime] = React.useState(true);
    const [notify, setNotify] = React.useState(false);
    const [typed, setTyped] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [jobId, setJobId] = React.useState<string | null>(resumeJobId ?? null);
    const [reauthOpen, setReauthOpen] = React.useState(false);
    const pending = React.useRef<null | (() => Promise<void>)>(null);
    const [linkInfo, setLinkInfo] = React.useState<string | null>(null);

    const list = useAdminQuery<MailboxesResponse>(isAdmin && scope !== 'domain' ? `${base}/mailboxes?page=${page}&pageSize=10&q=${encodeURIComponent(dq)}` : isAdmin ? `${base}/mailboxes?page=1&pageSize=1` : null);
    const { job, error: pollError, refresh } = useJob(base, jobId);

    React.useEffect(() => { setPage(1); }, [dq, scope]);

    const withReauth = async (fn: () => Promise<void>) => {
        try {
            await fn();
        } catch (e) {
            if (e instanceof ApiError && e.code === 'reauth_required') { pending.current = fn; setReauthOpen(true); return; }
            throw e;
        }
    };

    const valid =
        (!isAdmin || scope === 'domain' || picked.length > 0) &&
        (!encrypt || password.length >= 12) &&
        (!isAdmin || typed.trim().toLowerCase() === config.domain.toLowerCase()) &&
        (!from || !to || new Date(from) <= new Date(to));

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (busy || !valid) return;
        setBusy(true);
        setError(null);
        const run = async () => {
            const r = await adminFetch<{ job: JobPublic }>(`${base}/export`, {
                method: 'POST',
                body: {
                    scopeMode: isAdmin ? scope : 'one',
                    mailboxes: isAdmin && scope !== 'domain' ? picked : undefined,
                    folders,
                    from: from ? new Date(`${from}T00:00:00`).toISOString() : null,
                    to: to ? new Date(`${to}T23:59:59`).toISOString() : null,
                    includeAttachments: attachments,
                    format,
                    password: encrypt ? password : undefined,
                    oneTime,
                    notifyUsers: notify,
                    confirmDomain: isAdmin ? typed : undefined,
                },
            });
            setJobId(r.job.id);
            setPassword('');
            onJobChange?.();
        };
        try {
            await withReauth(run);
        } catch (err) {
            setError(errorText(t, err));
        } finally {
            setBusy(false);
        }
    };

    const download = async () => {
        if (!job) return;
        setError(null);
        const run = async () => {
            const r = await adminFetch<{ url: string; sha256: string | null }>(`${base}/jobs/${job.id}/download-link`, { method: 'POST' });
            setLinkInfo(t('admin.console.transfer.export.downloadStarted'));
            window.location.assign(r.url);
            setTimeout(() => { void refresh(); onJobChange?.(); }, 4000);
        };
        try {
            await withReauth(run);
        } catch (err) {
            setError(err instanceof ApiError && (err.code === 'already_downloaded' || err.code === 'expired') ? errorText(t, err) : errorText(t, err, 'admin.console.transfer.export.linkFailed'));
        }
    };

    const reset = () => { setJobId(null); setTyped(''); setError(null); setLinkInfo(null); };

    // ---- progreso / descarga ------------------------------------------------------------------------------------------
    if (jobId) {
        const total = Math.max(job?.totalItems ?? 0, job?.doneItems ?? 0);
        const pct = job ? (job.status === 'done' ? 100 : total > 0 ? (job.doneItems / total) * 100 : null) : null;
        return (
            <div className="space-y-4">
                <Card title={job?.status === 'done' ? t('admin.console.transfer.export.readyTitle') : t('admin.console.transfer.export.progressTitle')}>
                    {!job && <p role="status" className="text-sm text-muted-foreground">{t('admin.console.transfer.common.working')}</p>}
                    {job && job.status !== 'done' && job.status !== 'failed' && job.status !== 'canceled' && job.status !== 'expired' && (
                        <>
                            <p aria-live="polite" className="text-sm text-foreground">{t(`admin.console.transfer.status.${job.status}`)}: {job.doneItems} / {total}</p>
                            <ProgressBar className="mt-2" value={pct} label={t('admin.console.transfer.export.progressTitle')} />
                            <div className="mt-4">
                                <button type="button" className={btnOutline} onClick={() => void adminFetch(`${base}/jobs/${job.id}/cancel`, { method: 'POST' }).then(refresh)}>{t('admin.console.transfer.common.cancel')}</button>
                            </div>
                        </>
                    )}
                    {job?.status === 'done' && (
                        <div className="space-y-3">
                            <p className="text-sm text-foreground">
                                {t('admin.console.transfer.export.readyBody', { size: formatBytes(job.outputBytes, intlLocale), expires: formatDateTime(job.expiresAt, intlLocale) })}
                            </p>
                            {job.options.oneTime !== false && <p className="text-xs text-muted-foreground">{t('admin.console.transfer.export.downloadOnce')}</p>}
                            {job.outputSha256 && <p className="break-all text-xs text-muted-foreground">{t('admin.console.transfer.export.sha256')}: <code className="font-mono">{job.outputSha256}</code></p>}
                            {Number(job.summary?.warnings) > 0 && <p className="text-xs text-warning">{t('admin.console.transfer.export.warnings', { count: Number(job.summary.warnings) })}</p>}
                            {job.options.encrypted && <p className="text-xs text-muted-foreground">{t('admin.console.transfer.export.decryptHelp')}</p>}
                            <div className="flex flex-wrap gap-2">
                                {job.downloadable && <button type="button" className={btnPrimary} onClick={() => void download()}>{t('admin.console.transfer.export.download')}</button>}
                                <button type="button" className={btnOutline} onClick={reset}>{t('admin.console.transfer.export.newExport')}</button>
                            </div>
                            {linkInfo && <p role="status" className="text-xs text-muted-foreground">{linkInfo}</p>}
                        </div>
                    )}
                    {job && (job.status === 'failed' || job.status === 'canceled' || job.status === 'expired') && (
                        <div className="space-y-3">
                            <ErrorState message={jobErrorText(t, job.lastError) ?? t(`admin.console.transfer.status.${job.status}`)} />
                            <button type="button" className={btnOutline} onClick={reset}>{t('admin.console.transfer.export.newExport')}</button>
                        </div>
                    )}
                    {(error || pollError != null) && <div className="mt-3"><ErrorState message={error ?? errorText(t, pollError)} /></div>}
                </Card>
                <ReauthDialog
                    open={reauthOpen} base={base} mfaEnrolled={config.reauth.mfaEnrolled} canUsePassword={config.reauth.canUsePassword} isAdmin={isAdmin}
                    onClose={() => { setReauthOpen(false); pending.current = null; }}
                    onVerified={() => { setReauthOpen(false); const fn = pending.current; pending.current = null; if (fn) void fn().catch((e) => setError(errorText(t, e))); }}
                />
            </div>
        );
    }

    // ---- formulario ---------------------------------------------------------------------------------------------------
    const total = list.data?.totalMailboxes ?? 0;
    return (
        <form onSubmit={submit} className="space-y-4" aria-label={t('admin.console.transfer.export.title')}>
            <Card title={t('admin.console.transfer.export.title')} description={t('admin.console.transfer.export.intro', { hours: config.limits.exportTtlHours })}>
                <div className="space-y-6">
                    {isAdmin ? (
                        <fieldset className="space-y-2">
                            <legend className="text-sm font-medium text-foreground">{t('admin.console.transfer.export.scopeLegend')}</legend>
                            {([['domain', t('admin.console.transfer.export.scopeDomain', { count: total })], ['selected', t('admin.console.transfer.export.scopeSelected')], ['one', t('admin.console.transfer.export.scopeOne')]] as Array<[Scope, string]>).map(([id, label]) => (
                                <label key={id} className="flex items-center gap-2 text-sm text-foreground">
                                    <input type="radio" name={`${uid}-scope`} checked={scope === id} onChange={() => { setScope(id); if (id === 'one') setPicked((p) => p.slice(0, 1)); }} className="h-4 w-4 accent-primary" />
                                    {label}
                                </label>
                            ))}
                        </fieldset>
                    ) : (
                        <p className="text-sm text-foreground">{t('admin.console.transfer.export.scopeSelf')}: <span className="font-medium">{config.selfEmail}</span></p>
                    )}

                    {isAdmin && scope !== 'domain' && (
                        <div className="space-y-2">
                            <SearchInput value={q} onChange={setQ} label={t('admin.console.transfer.export.searchMailboxes')} placeholder={t('admin.console.transfer.export.searchPlaceholder')} />
                            <p aria-live="polite" className="text-xs text-muted-foreground">{t('admin.console.transfer.export.pickedCount', { count: picked.length })}</p>
                            <DataTable
                                caption={t('admin.console.transfer.export.searchMailboxes')}
                                rows={list.data?.mailboxes ?? []}
                                getRowId={(r) => r.email}
                                rowLabel={(r) => r.email}
                                selectable
                                selected={picked}
                                onSelectedChange={(ids) => setPicked(scope === 'one' ? ids.slice(-1) : ids)}
                                loading={list.isLoading}
                                empty={<p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('admin.console.transfer.export.noMailboxes')}</p>}
                                minWidth={420}
                                columns={[
                                    { id: 'email', header: t('admin.console.transfer.export.mailboxesCol'), cell: (r) => r.email, isRowHeader: true },
                                    { id: 'n', header: t('admin.console.transfer.export.emailsCol'), cell: (r) => r.emails, className: 'text-right tabular-nums' },
                                ]}
                            />
                            {list.data && <Pagination page={list.data.page.page} pages={list.data.page.pages} total={list.data.page.total} pageSize={list.data.page.pageSize} onPage={setPage} />}
                        </div>
                    )}

                    <fieldset className="space-y-3">
                        <legend className="text-sm font-medium text-foreground">{t('admin.console.transfer.export.filtersLegend')}</legend>
                        <div>
                            <p className="text-xs font-medium text-muted-foreground">{t('admin.console.transfer.export.folders')}</p>
                            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                                {FOLDERS.map((f) => (
                                    <label key={f} className="flex items-center gap-1.5 text-sm text-foreground">
                                        <input type="checkbox" className="h-4 w-4 rounded border-input accent-primary" checked={folders.includes(f)} onChange={(e) => setFolders((p) => (e.target.checked ? [...p, f] : p.filter((x) => x !== f)))} />
                                        {t(`admin.console.transfer.export.folderNames.${f}`)}
                                    </label>
                                ))}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{folders.length === 0 ? t('admin.console.transfer.export.allFolders') : ''}</p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Field label={t('admin.console.transfer.export.dateFrom')} htmlFor={`${uid}-from`}>
                                <input id={`${uid}-from`} type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
                            </Field>
                            <Field label={t('admin.console.transfer.export.dateTo')} htmlFor={`${uid}-to`}>
                                <input id={`${uid}-to`} type="date" className={inputClass} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
                            </Field>
                        </div>
                        <label className="flex items-center gap-2 text-sm text-foreground">
                            <input type="checkbox" className="h-4 w-4 rounded border-input accent-primary" checked={attachments} onChange={(e) => setAttachments(e.target.checked)} />
                            {t('admin.console.transfer.export.includeAttachments')}
                        </label>
                    </fieldset>

                    <fieldset className="space-y-2">
                        <legend className="text-sm font-medium text-foreground">{t('admin.console.transfer.export.formatLegend')}</legend>
                        <label className="flex items-start gap-2 text-sm text-foreground">
                            <input type="radio" name={`${uid}-fmt`} className="mt-0.5 h-4 w-4 accent-primary" checked={format === 'mbox'} onChange={() => setFormat('mbox')} />
                            {t('admin.console.transfer.export.formatMbox')}
                        </label>
                        <label className="flex items-start gap-2 text-sm text-foreground">
                            <input type="radio" name={`${uid}-fmt`} className="mt-0.5 h-4 w-4 accent-primary" checked={format === 'eml'} onChange={() => setFormat('eml')} />
                            {t('admin.console.transfer.export.formatEml')}
                        </label>
                    </fieldset>

                    <fieldset className="space-y-3">
                        <legend className="text-sm font-medium text-foreground">{t('admin.console.transfer.export.securityLegend')}</legend>
                        <div className="flex items-center gap-3">
                            <Switch checked={encrypt} onChange={setEncrypt} label={t('admin.console.transfer.export.encrypt')} />
                            <span className="text-sm text-foreground">{t('admin.console.transfer.export.encrypt')}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{t('admin.console.transfer.export.encryptHint')}</p>
                        {encrypt && (
                            <Field label={t('admin.console.transfer.export.packagePassword')} htmlFor={`${uid}-pw`} hint={t('admin.console.transfer.export.decryptHelp')}>
                                <input id={`${uid}-pw`} type="password" autoComplete="new-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={password.length > 0 && password.length < 12 ? true : undefined} />
                            </Field>
                        )}
                        <div className="flex items-center gap-3">
                            <Switch checked={oneTime} onChange={setOneTime} label={t('admin.console.transfer.export.oneTime')} />
                            <span className="text-sm text-foreground">{t('admin.console.transfer.export.oneTime')}</span>
                        </div>
                        {isAdmin && (
                            <div className="flex items-center gap-3">
                                <Switch checked={notify} onChange={setNotify} label={t('admin.console.transfer.export.notifyUsers')} />
                                <span className="text-sm text-foreground">{t('admin.console.transfer.export.notifyUsers')}</span>
                            </div>
                        )}
                    </fieldset>

                    {isAdmin && (
                        <fieldset className="space-y-2">
                            <legend className="text-sm font-medium text-foreground">{t('admin.console.transfer.export.confirmLegend')}</legend>
                            <p className="text-sm text-muted-foreground">
                                {t('admin.console.transfer.export.summary', {
                                    mailboxes: scope === 'domain' ? total : picked.length, format: format.toUpperCase(), encrypted: encrypt ? t('admin.console.transfer.export.summaryEncrypted') : '',
                                })}
                            </p>
                            <div className="max-w-sm">
                                <Field label={t('admin.console.transfer.export.typeDomain', { domain: config.domain })} htmlFor={`${uid}-dom`}>
                                    <input id={`${uid}-dom`} className={inputClass} autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t('admin.console.transfer.export.domainPlaceholder')} />
                                </Field>
                            </div>
                        </fieldset>
                    )}

                    {error && <ErrorState message={error} />}
                    <div className="flex justify-end">
                        <button type="submit" className={btnPrimary} disabled={busy || !valid} aria-busy={busy || undefined}>
                            {busy ? t('admin.console.transfer.export.starting') : t('admin.console.transfer.export.startBtn')}
                        </button>
                    </div>
                </div>
            </Card>
            <ReauthDialog
                open={reauthOpen} base={base} mfaEnrolled={config.reauth.mfaEnrolled} canUsePassword={config.reauth.canUsePassword} isAdmin={isAdmin}
                onClose={() => { setReauthOpen(false); pending.current = null; setBusy(false); }}
                onVerified={() => { setReauthOpen(false); const fn = pending.current; pending.current = null; if (fn) { setBusy(true); void fn().catch((e) => setError(errorText(t, e))).finally(() => setBusy(false)); } }}
            />
        </form>
    );
}
