'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, FileUp, Info, Loader2, X } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { Badge, Card, Field, adminFetch, btnOutline, btnPrimary, inputClass, useDebounced, type Tone } from '@/components/admin/console';
import { useStepUp } from '@/components/admin/permissions/useStepUp';
import { useFinError } from '@/components/admin/billing/shared';
import { compareSemver, parseSemver, validatePricing } from '@/lib/billing/revenue';
import { PricingPanel, draftToValue, toDraft, type PriceForm } from './PricingPanel';
import { SLOTS, formatBytesShort, limitFor, manifestHints, readSlot, slotForFileName, toPayload, withinLimit, type FileState, type SlotId } from './files';
import type { DevOverview, Risk, ValidateResult } from './types';

const RISK_TONE: Record<Risk, Tone> = { low: 'success', medium: 'warning', high: 'danger' };
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const VALIDATE_DEBOUNCE_MS = 700;

export interface EditorSeed { extensionId: string; price: PriceForm; activeSubscribers?: number }

export function Editor({
    overview, seed, priceForm, onPriceForm, onDone,
}: {
    overview: DevOverview; seed: EditorSeed | null; priceForm: PriceForm; onPriceForm: (f: PriceForm) => void; onDone: (message: string) => void;
}) {
    const { t } = useI18n();
    const uid = React.useId();
    const finError = useFinError('developer');
    const { guard, dialog } = useStepUp();

    const [extensionId, setExtensionId] = React.useState(seed?.extensionId ?? '');
    const [version, setVersion] = React.useState('');
    const [changelog, setChangelog] = React.useState('');
    const [files, setFiles] = React.useState<FileState>({});
    const [fileErrors, setFileErrors] = React.useState<string[]>([]);
    const [dragging, setDragging] = React.useState(false);
    const [result, setResult] = React.useState<ValidateResult | null>(null);
    const [running, setRunning] = React.useState(false);
    const [valError, setValError] = React.useState<string | null>(null);
    const [busy, setBusy] = React.useState<'draft' | 'submit' | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const fileInput = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => { if (seed) setExtensionId(seed.extensionId); }, [seed]);

    const payload = React.useMemo(() => toPayload(files), [files]);
    const { draft } = toDraft(priceForm);
    const pricingValue = React.useMemo(() => draftToValue(draft), [draft.model, draft.oneTimeCents, draft.monthCents, draft.yearCents, draft.trialDays]); // eslint-disable-line react-hooks/exhaustive-deps
    const validateBody = React.useMemo(
        () => (payload && ID_RE.test(extensionId)
            ? { extensionId, ...(version ? { version } : {}), ...(changelog.trim() ? { changelog: changelog.trim() } : {}), pricing: pricingValue, files: payload }
            : null),
        [payload, extensionId, version, changelog, pricingValue],
    );
    const debounced = useDebounced(validateBody, VALIDATE_DEBOUNCE_MS);

    // Validacion en vivo (POST validate) con debounce; cada cambio cancela la anterior.
    React.useEffect(() => {
        if (!debounced) { setResult(null); setValError(null); setRunning(false); return; }
        const ac = new AbortController();
        setRunning(true);
        adminFetch<ValidateResult>('/api/admin/developer/validate', { body: debounced, signal: ac.signal })
            .then((r) => { setResult(r); setValError(null); })
            .catch((e) => { if ((e as { name?: string })?.name !== 'AbortError') { setResult(null); setValError(finError(e) || t('admin.console.developer.validation.failed')); } })
            .finally(() => { if (!ac.signal.aborted) setRunning(false); });
        return () => ac.abort();
    }, [debounced, finError, t]);

    const ingest = async (list: FileList | File[]) => {
        const next: FileState = { ...files };
        const errors: string[] = [];
        for (const file of Array.from(list)) {
            const slot = slotForFileName(file.name);
            if (!slot) { errors.push(t('admin.console.developer.editor.badType', { name: file.name })); continue; }
            if (!withinLimit(file.size, slot, overview.limits)) { errors.push(t('admin.console.developer.editor.tooLarge', { name: file.name, limit: formatBytesShort(limitFor(slot, overview.limits)) })); continue; }
            try {
                next[slot] = { name: file.name, bytes: file.size, content: await readSlot(file, slot) };
                if (slot === 'manifest') {
                    const hints = manifestHints(next[slot]!.content);
                    if (hints.id && !extensionId) setExtensionId(hints.id);
                    if (hints.version && !version) setVersion(hints.version);
                }
            } catch {
                errors.push(t('admin.console.developer.editor.badType', { name: file.name }));
            }
        }
        setFiles(next);
        setFileErrors(errors);
    };
    const remove = (slot: SlotId) => setFiles((f) => { const n = { ...f }; delete n[slot]; return n; });

    // --- reglas para enviar ---
    const termsOk = overview.terms.acceptedVersion === overview.terms.requiredVersion;
    const prefixOk = extensionId.startsWith(overview.idPrefix);
    const semverOk = !!parseSemver(version);
    const last = result?.versioning.lastVersion ?? null;
    const increases = result ? result.versioning.increases : semverOk;
    const changelogOk = changelog.trim().length > 0;
    const priceIssues = validatePricing(draft, overview.limits);
    const paidNeedsPaypal = draft.model !== 'free' && overview.paypal.status !== 'linked';
    const hasErrors = !result || result.issues.some((i) => i.severity === 'error') || !result.ok;
    const canSubmit = !!payload && termsOk && prefixOk && semverOk && increases && changelogOk && priceIssues.length === 0 && !paidNeedsPaypal && !hasErrors && !running;
    const submitHint = !termsOk ? t('admin.console.developer.editor.needsTerms') : hasErrors && payload ? t('admin.console.developer.editor.needsValid') : null;

    const send = (submit: boolean) => {
        if (!payload) return;
        setError(null);
        setBusy(submit ? 'submit' : 'draft');
        void guard(async () => {
            await adminFetch('/api/admin/developer/submissions', { body: { extensionId, version, changelog: changelog.trim(), pricing: pricingValue, files: payload, submit } });
            onDone(submit ? t('admin.console.developer.editor.submittedOk') : t('admin.console.developer.editor.savedDraft'));
        })
            .catch((e) => setError(finError(e)))
            .finally(() => setBusy(null));
    };

    const errors = result?.issues.filter((i) => i.severity === 'error') ?? [];
    const warnings = result?.issues.filter((i) => i.severity === 'warning') ?? [];
    const slotLabel: Record<SlotId, string> = {
        manifest: t('admin.console.developer.editor.manifest'), serverJs: t('admin.console.developer.editor.server'),
        readme: t('admin.console.developer.editor.readme'), icon: t('admin.console.developer.editor.icon'),
    };

    return (
        <div className="space-y-5">
            <Card title={t('admin.console.developer.editor.title')}>
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t('admin.console.developer.editor.extensionId')} htmlFor={`${uid}-id`} hint={t('admin.console.developer.editor.extensionIdHint', { slug: overview.slug })} required error={extensionId && !prefixOk ? t('admin.console.developer.overview.idHint', { prefix: overview.idPrefix }) : null}>
                        <input id={`${uid}-id`} className={inputClass} value={extensionId} onChange={(e) => setExtensionId(e.target.value.trim())} spellCheck={false} autoComplete="off" placeholder={`${overview.idPrefix}mi-extension`} aria-invalid={(extensionId && !prefixOk) || undefined} aria-describedby={`${uid}-id-${extensionId && !prefixOk ? 'err' : 'hint'}`} />
                    </Field>
                    <Field label={t('admin.console.developer.editor.version')} htmlFor={`${uid}-ver`} hint={t('admin.console.developer.editor.versionHint')} required error={version && !semverOk ? t('admin.console.developer.editor.versionHint') : last && semverOk && compareSemver(version, last) !== null && (compareSemver(version, last) ?? 0) <= 0 ? t('admin.console.developer.versioning.mustIncrease', { version: last }) : null}>
                        <input id={`${uid}-ver`} className={inputClass} value={version} onChange={(e) => setVersion(e.target.value.trim())} spellCheck={false} autoComplete="off" placeholder="1.0.0" aria-describedby={`${uid}-ver-hint`} />
                    </Field>
                    <Field className="sm:col-span-2" label={t('admin.console.developer.editor.changelog')} htmlFor={`${uid}-log`} hint={t('admin.console.developer.editor.changelogHint')} required error={null}>
                        <textarea id={`${uid}-log`} className={`${inputClass} h-24 py-2`} value={changelog} maxLength={8000} onChange={(e) => setChangelog(e.target.value)} aria-describedby={`${uid}-log-hint`} />
                    </Field>
                </div>

                <div className="mt-5">
                    <h3 className="text-sm font-semibold text-foreground">{t('admin.console.developer.editor.files')}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{t('admin.console.developer.editor.filesHint')}</p>
                    <div
                        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={(e) => { e.preventDefault(); setDragging(false); void ingest(e.dataTransfer.files); }}
                        className={`mt-2 flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center text-sm ${dragging ? 'border-primary bg-primary/5' : 'border-border bg-muted/30'}`}
                    >
                        <FileUp className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                        <p className="text-muted-foreground">{t('admin.console.developer.editor.drop')}</p>
                        <input ref={fileInput} id={`${uid}-files`} type="file" multiple className="sr-only" accept=".json,.js,.md,.png,.svg,.webp" onChange={(e) => { if (e.target.files) void ingest(e.target.files); e.target.value = ''; }} />
                        <button type="button" className={btnOutline} onClick={() => fileInput.current?.click()}>{t('admin.console.developer.editor.choose')}</button>
                    </div>
                    {fileErrors.length > 0 && <ul role="alert" className="mt-2 space-y-1 text-sm text-destructive">{fileErrors.map((m) => <li key={m}>{m}</li>)}</ul>}
                    <ul className="mt-3 divide-y divide-border/60 rounded-lg border border-border">
                        {SLOTS.map((slot) => {
                            const f = files[slot];
                            return (
                                <li key={slot} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                                    <span className="font-medium text-foreground">{slotLabel[slot]}</span>
                                    {f ? (
                                        <span className="flex items-center gap-2 text-muted-foreground">
                                            <Badge tone="success">{t('admin.console.developer.editor.loaded')}</Badge>
                                            {t('admin.console.developer.editor.sizeOf', { size: formatBytesShort(f.bytes), limit: formatBytesShort(limitFor(slot, overview.limits)) })}
                                            <button type="button" onClick={() => remove(slot)} aria-label={t('admin.console.developer.editor.remove', { name: f.name })} className="rounded p-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-4 w-4" aria-hidden="true" /></button>
                                        </span>
                                    ) : <Badge tone={slot === 'manifest' ? 'warning' : 'neutral'}>{t('admin.console.developer.editor.missing')}</Badge>}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </Card>

            <Card title={t('admin.console.developer.validation.title')}>
                <div aria-live="polite" aria-busy={running || undefined}>
                    {!payload && <p className="text-sm text-muted-foreground">{t('admin.console.developer.validation.idle')}</p>}
                    {payload && running && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t('admin.console.developer.validation.running')}</p>}
                    {valError && <p role="alert" className="text-sm text-destructive">{valError}</p>}
                    {result && !running && (
                        <div className="space-y-4">
                            <p className={`flex items-center gap-2 text-sm font-medium ${errors.length ? 'text-destructive' : 'text-success'}`}>
                                {errors.length ? <AlertTriangle className="h-4 w-4" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                                {errors.length ? t('admin.console.developer.validation.errors', { count: errors.length }) : t('admin.console.developer.validation.ok')}
                                {warnings.length > 0 && <span className="text-muted-foreground">· {t('admin.console.developer.validation.warnings', { count: warnings.length })}</span>}
                            </p>
                            {result.issues.length > 0 && (
                                <ul className="space-y-2">
                                    {result.issues.map((i, idx) => (
                                        <li key={`${i.path}-${idx}`} className={`rounded-lg border p-3 text-sm ${i.severity === 'error' ? 'border-destructive/30 bg-destructive/10' : 'border-warning/40 bg-warning/10'}`}>
                                            <span className="font-medium">{i.severity === 'error' ? t('admin.console.developer.validation.error') : t('admin.console.developer.validation.warning')}</span>
                                            {' · '}<span className="text-muted-foreground">{t('admin.console.developer.validation.path')}:</span> <code className="break-all rounded bg-muted px-1 py-0.5 text-xs">{i.path || '(root)'}</code>
                                            <p className="mt-1">{i.message}</p>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <div>
                                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">{t('admin.console.developer.validation.riskTitle')} <Badge tone={RISK_TONE[result.analysis.risk] ?? 'neutral'}>{t(`admin.console.developer.validation.risk.${result.analysis.risk}`)}</Badge></h3>
                                {result.analysis.findings.length === 0
                                    ? <p className="mt-1 text-sm text-muted-foreground">{t('admin.console.developer.validation.noFindings')}</p>
                                    : <ul className="mt-2 space-y-1 text-sm">{result.analysis.findings.map((f) => <li key={f.id} className="flex items-start gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span>{f.message}{f.path ? <code className="ml-1 break-all rounded bg-muted px-1 py-0.5 text-xs">{f.path}</code> : null}</span></li>)}</ul>}
                            </div>
                        </div>
                    )}
                </div>
            </Card>

            {result && (
                <Card title={t('admin.console.developer.versioning.title')}>
                    <div className="space-y-3 text-sm">
                        <p>{last ? t('admin.console.developer.versioning.last', { version: last }) : t('admin.console.developer.versioning.none')}</p>
                        <div>
                            <p className="mb-1 font-medium text-foreground">{t('admin.console.developer.versioning.suggested')}</p>
                            <div className="flex flex-wrap gap-2">
                                {(['patch', 'minor', 'major'] as const).map((k) => (
                                    <button key={k} type="button" className={btnOutline} onClick={() => setVersion(result.versioning.suggested[k])} aria-label={`${t('admin.console.developer.versioning.use', { version: result.versioning.suggested[k] })} (${t(`admin.console.developer.versioning.${k}`)})`}>
                                        {result.versioning.suggested[k]} <span className="text-xs text-muted-foreground">{t(`admin.console.developer.versioning.${k}`)}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                        {version && (result.versioning.increases
                            ? <p className="text-success">{t('admin.console.developer.versioning.increases')}</p>
                            : last ? <p role="alert" className="text-destructive">{t('admin.console.developer.versioning.mustIncrease', { version: last })}</p> : null)}
                        {!changelogOk && <p className="text-warning">{t('admin.console.developer.versioning.changelogRequired')}</p>}
                        <div>
                            <h3 className="font-semibold text-foreground">{t('admin.console.developer.versioning.permsTitle')}</h3>
                            <PermList label={t('admin.console.developer.versioning.added')} items={result.permissionsDiff.added} tone="warning" none={t('admin.console.developer.versioning.noPerms')} />
                            <PermList label={t('admin.console.developer.versioning.removed')} items={result.permissionsDiff.removed} tone="info" none={t('admin.console.developer.versioning.noPerms')} />
                            <PermList label={t('admin.console.developer.versioning.unchanged')} items={result.permissionsDiff.unchanged} tone="neutral" none={t('admin.console.developer.versioning.noPerms')} />
                        </div>
                    </div>
                </Card>
            )}

            <PricingPanel
                form={priceForm}
                onChange={onPriceForm}
                limits={overview.limits}
                developerBps={overview.shares.developerBps}
                paypalLinked={overview.paypal.status === 'linked'}
                activeSubscribers={seed?.activeSubscribers}
            />

            <div className="flex flex-wrap items-center gap-3">
                <button type="button" className={btnOutline} onClick={() => send(false)} disabled={!payload || !prefixOk || !semverOk || !changelogOk || busy !== null} aria-busy={busy === 'draft' || undefined}>{t('admin.console.developer.editor.draft')}</button>
                <button type="button" className={btnPrimary} onClick={() => send(true)} disabled={!canSubmit || busy !== null} aria-busy={busy === 'submit' || undefined}>{busy === 'submit' ? t('admin.console.developer.editor.submitting') : t('admin.console.developer.editor.submit')}</button>
                {submitHint && <span className="text-sm text-muted-foreground">{submitHint}</span>}
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {dialog}
        </div>
    );
}

function PermList({ label, items, tone, none }: { label: string; items: string[]; tone: Tone; none: string }) {
    return (
        <div className="mt-2">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            {items.length === 0 ? <p className="text-xs text-muted-foreground">{none}</p> : <div className="mt-1 flex flex-wrap gap-1">{items.map((p) => <Badge key={p} tone={tone}>{p}</Badge>)}</div>}
        </div>
    );
}

