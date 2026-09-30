'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import { ApiError, Badge, Card, Field, adminFetch, apiErrorKey, btnOutline, btnPrimary, inputClass, type Tone } from '@/components/admin/console';
import type { ProbeResponse } from './types';

const K = 'admin.console.spam.test';
const BAND_TONE: Record<string, Tone> = { clean: 'success', suspicious: 'warning', spam: 'danger' };
const DECISION_TONE: Record<string, Tone> = { delivered: 'success', warned: 'warning', spam: 'danger', blocked: 'danger' };

export function TestTab() {
    const { t, locale } = useI18n();
    const [rawHeaders, setRawHeaders] = React.useState('');
    const [from, setFrom] = React.useState('');
    const [subject, setSubject] = React.useState('');
    const [text, setText] = React.useState('');
    const [files, setFiles] = React.useState('');
    const [emailId, setEmailId] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [result, setResult] = React.useState<ProbeResponse | null>(null);
    const lang: 'es' | 'en' = locale === 'en' ? 'en' : 'es';

    const errorText = (e: unknown) => {
        if (e instanceof ApiError && e.code) {
            const key = `${K}.errors.${e.code}`;
            const s = t(key);
            if (s !== key) return s;
        }
        return t(apiErrorKey(e));
    };

    const run = async (e: React.FormEvent) => {
        e.preventDefault();
        if (busy) return;
        const body: Record<string, unknown> = {};
        if (emailId.trim()) body.emailId = emailId.trim();
        else {
            if (rawHeaders.trim()) body.rawHeaders = rawHeaders;
            if (from.trim()) body.from = from.trim();
            if (subject.trim()) body.subject = subject;
            if (text.trim()) body.text = text;
            const names = files.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 20);
            if (names.length) body.attachments = names.map((filename) => ({ filename }));
            if (Object.keys(body).length === 0) { setError(t(`${K}.errors.empty_input`)); setResult(null); return; }
        }
        setBusy(true); setError(null);
        try {
            setResult(await adminFetch<ProbeResponse>('/api/admin/spam/test', { method: 'POST', body }));
        } catch (err) { setError(errorText(err)); setResult(null); } finally { setBusy(false); }
    };

    const clear = () => { setRawHeaders(''); setFrom(''); setSubject(''); setText(''); setFiles(''); setEmailId(''); setResult(null); setError(null); };
    const signals = result ? [...result.signals].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)) : [];
    const maxAbs = Math.max(1, ...signals.map((s) => Math.abs(s.weight)));
    const fmtW = (w: number) => (w > 0 ? `+${w}` : String(w));

    return (
        <div className="space-y-6">
            <Card title={t(`${K}.form.title`)} description={t(`${K}.form.description`)}>
                <form onSubmit={(e) => void run(e)} noValidate className="grid gap-4 md:grid-cols-2">
                    <Field label={t(`${K}.form.rawHeaders`)} htmlFor="spam-test-headers" hint={t(`${K}.form.rawHeadersHint`)} className="md:col-span-2">
                        <textarea id="spam-test-headers" rows={6} value={rawHeaders} onChange={(e) => setRawHeaders(e.target.value)} spellCheck={false} disabled={!!emailId.trim()} className={`${inputClass} h-auto py-2 font-mono`} />
                    </Field>
                    <Field label={t(`${K}.form.from`)} htmlFor="spam-test-from">
                        <input id="spam-test-from" value={from} onChange={(e) => setFrom(e.target.value)} autoComplete="off" disabled={!!emailId.trim()} className={inputClass} />
                    </Field>
                    <Field label={t(`${K}.form.subject`)} htmlFor="spam-test-subject">
                        <input id="spam-test-subject" value={subject} onChange={(e) => setSubject(e.target.value)} autoComplete="off" disabled={!!emailId.trim()} className={inputClass} />
                    </Field>
                    <Field label={t(`${K}.form.text`)} htmlFor="spam-test-text" className="md:col-span-2">
                        <textarea id="spam-test-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} disabled={!!emailId.trim()} className={`${inputClass} h-auto py-2`} />
                    </Field>
                    <Field label={t(`${K}.form.attachments`)} htmlFor="spam-test-files" hint={t(`${K}.form.attachmentsHint`)}>
                        <textarea id="spam-test-files" rows={3} value={files} onChange={(e) => setFiles(e.target.value)} spellCheck={false} disabled={!!emailId.trim()} className={`${inputClass} h-auto py-2`} />
                    </Field>
                    <Field label={t(`${K}.form.emailId`)} htmlFor="spam-test-email-id" hint={t(`${K}.form.emailIdHint`)}>
                        <input id="spam-test-email-id" value={emailId} onChange={(e) => setEmailId(e.target.value)} autoComplete="off" spellCheck={false} className={inputClass} />
                    </Field>
                    <div className="flex flex-wrap items-center gap-3 md:col-span-2">
                        <button type="submit" className={btnPrimary} disabled={busy} aria-busy={busy || undefined}>{t(busy ? `${K}.form.running` : `${K}.form.run`)}</button>
                        <button type="button" className={btnOutline} onClick={clear} disabled={busy}>{t('admin.console.common.clear')}</button>
                        <p className="text-xs text-muted-foreground">{t(`${K}.form.nothingSaved`)}</p>
                    </div>
                </form>
            </Card>

            <div role="status" aria-live="polite" aria-busy={busy || undefined}>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            </div>

            {result && (
                <Card title={t(`${K}.result.title`)}>
                    <div className="space-y-5" data-testid="spam-test-result">
                        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <div>
                                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(`${K}.result.score`)}</dt>
                                <dd className="mt-1 text-3xl font-bold tabular-nums text-foreground" data-testid="spam-test-score">{result.score}<span className="text-base font-normal text-muted-foreground"> / 100</span></dd>
                            </div>
                            <div>
                                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(`${K}.result.threshold`)}</dt>
                                <dd className="mt-1 text-lg tabular-nums text-foreground">{result.threshold ?? t(`${K}.result.thresholdOff`)}</dd>
                            </div>
                            <div>
                                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(`${K}.result.band`)}</dt>
                                <dd className="mt-1"><Badge tone={BAND_TONE[result.band] ?? 'neutral'}>{t(`${K}.bands.${result.band}`)}</Badge></dd>
                            </div>
                            <div>
                                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(`${K}.result.decision`)}</dt>
                                <dd className="mt-1"><Badge tone={DECISION_TONE[result.decision] ?? 'neutral'}>{t(`${K}.decisions.${result.decision}`)}</Badge></dd>
                            </div>
                        </dl>
                        <ul className="space-y-1 text-sm text-muted-foreground">
                            {result.blockedByList && <li>{t(`${K}.result.blockedByList`)}</li>}
                            {result.allowedByList && <li>{t(`${K}.result.allowedByList`)}</li>}
                            {result.authFailed && <li>{t(`${K}.result.authFailed`)}</li>}
                        </ul>

                        {signals.length === 0 ? (
                            <p className="text-sm text-muted-foreground">{t(`${K}.result.noSignals`)}</p>
                        ) : (
                            <div className="overflow-x-auto rounded-lg border border-border">
                                <table className="w-full text-sm" style={{ minWidth: 560 }}>
                                    <caption className="sr-only">{t(`${K}.result.caption`)}</caption>
                                    <thead className="bg-muted/60 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                        <tr>
                                            <th scope="col" className="px-3 py-2.5">{t(`${K}.result.signal`)}</th>
                                            <th scope="col" className="px-3 py-2.5">{t(`${K}.result.family`)}</th>
                                            <th scope="col" className="px-3 py-2.5">{t(`${K}.result.weight`)}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/60">
                                        {signals.map((s, i) => (
                                            <tr key={`${s.id}-${i}`} className="align-top">
                                                <th scope="row" className="px-3 py-3 text-left font-normal">
                                                    <span className="text-foreground">{s[lang]}</span>
                                                    {s.critical && <Badge tone="danger" className="ml-2">{t(`${K}.result.critical`)}</Badge>}
                                                    <span className="mt-0.5 block font-mono text-xs text-muted-foreground" translate="no">{s.id}</span>
                                                </th>
                                                <td className="px-3 py-3 text-muted-foreground">{s.family}</td>
                                                <td className="w-56 px-3 py-3">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`w-10 shrink-0 text-right font-medium tabular-nums ${s.weight > 0 ? 'text-destructive' : s.weight < 0 ? 'text-success' : 'text-muted-foreground'}`}>{fmtW(s.weight)}</span>
                                                        <div className="h-2 flex-1 rounded bg-muted" aria-hidden="true">
                                                            <div className={`h-2 rounded ${s.weight >= 0 ? 'bg-destructive' : 'bg-success'}`} style={{ width: `${Math.max(4, Math.round((Math.abs(s.weight) / maxAbs) * 100))}%` }} />
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </Card>
            )}
        </div>
    );
}
