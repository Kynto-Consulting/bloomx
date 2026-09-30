'use client';

import * as React from 'react';
import { Info, ShieldAlert, X } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import {
    Badge, Card, ErrorState, Field, LoadingState, adminFetch, apiErrorKey, btnOutline, btnPrimary, formatDateTime, inputClass, useAdminQuery, useUnsavedChanges,
} from '@/components/admin/console';
import { SpamListEditor } from '@/components/spam/SpamListEditor';
import { MAX_EXTERNAL_TEXT, MAX_INTERNAL_DOMAINS, normalizeDomain } from '@/lib/spam/config-core';
import { EXTERNAL_TAG, EXTERNAL_TAG_EN, externalNotice } from '@/lib/spam/external';
import { SwitchRow } from './parts';
import { CONFIG_URL, LISTS_BASE, type ConfigResponse, type ExternalCfg } from './types';

const K = 'admin.console.spam.external';
const FLAGS = ['subjectTag', 'colleagueSpoof', 'firstTime', 'hardenLinks', 'hardenAttachments'] as const;

const cloneExt = (e: ExternalCfg): ExternalCfg => ({ ...e, text: { ...e.text }, internalDomains: [...e.internalDomains] });
const norm = (e: ExternalCfg): ExternalCfg => ({ ...e, text: { es: e.text.es.trim(), en: e.text.en.trim() }, internalDomains: [...e.internalDomains] });

/** Vista previa EN VIVO del aviso: mismo texto (propio o por defecto) y estilo que vera quien recibe un correo externo. */
function NoticePreview({ style, text, lang, label }: { style: 'info' | 'warning'; text: { es: string; en: string }; lang: 'es' | 'en'; label: string }) {
    const Icon = style === 'warning' ? ShieldAlert : Info;
    return (
        <div data-testid={`spam-external-preview-${lang}`}>
            <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
            <div
                role="note"
                lang={lang}
                className={`flex items-start gap-2 rounded-md border p-3 text-sm ${style === 'warning' ? 'border-warning/40 bg-warning/10 text-foreground' : 'border-info/40 bg-info/10 text-foreground'}`}
            >
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style === 'warning' ? 'text-warning' : 'text-info'}`} aria-hidden="true" />
                <p>{externalNotice(text, lang)}</p>
            </div>
        </div>
    );
}

export function ExternalTab() {
    const { t, locale, intlLocale } = useI18n();
    const { data, error, isLoading, mutate } = useAdminQuery<ConfigResponse>(CONFIG_URL);
    const [draft, setDraft] = React.useState<ExternalCfg | null>(null);
    const [domainInput, setDomainInput] = React.useState('');
    const [domainError, setDomainError] = React.useState<string | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [msg, setMsg] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

    // Solo depende de la politica externa: guardar el nivel de filtrado (otra pestana, misma consulta) no debe pisar esta edicion.
    const signature = data ? JSON.stringify(data.config.external) : '';
    React.useEffect(() => {
        if (data) setDraft(cloneExt(data.config.external));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signature]);

    const dirty = !!data && !!draft && JSON.stringify(norm(draft)) !== JSON.stringify(norm(data.config.external));
    useUnsavedChanges(dirty);

    if (error && !data) return <ErrorState message={t(apiErrorKey(error))} onRetry={() => void mutate()} />;
    if (isLoading || !data || !draft) return <LoadingState />;

    const set = (p: Partial<ExternalCfg>) => setDraft({ ...draft, ...p });
    const addDomain = () => {
        const raw = domainInput.trim();
        if (!raw) return;
        const d = normalizeDomain(raw);
        if (!d) { setDomainError(t(`${K}.domains.invalid`)); return; }
        if (draft.internalDomains.includes(d) || data.ownDomains.includes(d)) { setDomainError(t(`${K}.domains.duplicate`)); return; }
        if (draft.internalDomains.length >= MAX_INTERNAL_DOMAINS) { setDomainError(t(`${K}.domains.max`, { max: MAX_INTERNAL_DOMAINS })); return; }
        set({ internalDomains: [...draft.internalDomains, d] });
        setDomainInput('');
        setDomainError(null);
    };

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!dirty) return;
        setBusy(true); setMsg(null);
        try {
            const next = await adminFetch<ConfigResponse>(CONFIG_URL, { method: 'PUT', body: { external: norm(draft) } });
            await mutate(next, { revalidate: false });
            setDraft(cloneExt(next.config.external));
            setMsg({ kind: 'ok', text: t(`${K}.saved`) });
        } catch (err) { setMsg({ kind: 'error', text: t(apiErrorKey(err)) }); } finally { setBusy(false); }
    };

    const tag = locale === 'en' ? EXTERNAL_TAG_EN : EXTERNAL_TAG;

    return (
        <div className="space-y-6">
            <form onSubmit={(e) => void save(e)} noValidate className="space-y-6">
                <Card title={t(`${K}.policy.title`)} description={t(`${K}.policy.description`)}>
                    <div className="space-y-4">
                        <SwitchRow id="spam-external-enabled" label={t(`${K}.enabled.label`)} hint={t(`${K}.enabled.hint`)} checked={draft.enabled} onChange={(v) => set({ enabled: v })} />
                        <fieldset>
                            <legend className="text-sm font-medium text-foreground">{t(`${K}.style.legend`)}</legend>
                            <div className="mt-2 flex flex-wrap gap-3">
                                {(['info', 'warning'] as const).map((s) => (
                                    <label key={s} className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm has-[:checked]:border-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                                        <input type="radio" name="spam-external-style" value={s} checked={draft.style === s} onChange={() => set({ style: s })} className="h-4 w-4 accent-primary" />
                                        {t(`${K}.style.${s}`)}
                                    </label>
                                ))}
                            </div>
                        </fieldset>
                        <div className="grid gap-6 lg:grid-cols-2">
                            {(['es', 'en'] as const).map((lang) => {
                                const id = `spam-external-text-${lang}`;
                                const len = draft.text[lang].length;
                                return (
                                    <div key={lang} className="space-y-2">
                                        <Field label={t(`${K}.text.label.${lang}`)} htmlFor={id} hint={t(`${K}.text.hint`)}>
                                            <textarea
                                                id={id}
                                                rows={4}
                                                maxLength={MAX_EXTERNAL_TEXT}
                                                value={draft.text[lang]}
                                                placeholder={externalNotice({ es: '', en: '' }, lang)}
                                                onChange={(e) => set({ text: { ...draft.text, [lang]: e.target.value } })}
                                                aria-describedby={`${id}-count ${id}-hint`}
                                                className={`${inputClass} h-auto py-2`}
                                            />
                                        </Field>
                                        <p id={`${id}-count`} className={`text-xs tabular-nums ${len >= MAX_EXTERNAL_TEXT ? 'text-warning' : 'text-muted-foreground'}`}>
                                            {t(`${K}.text.counter`, { count: len, max: MAX_EXTERNAL_TEXT })}
                                        </p>
                                        <NoticePreview style={draft.style} text={draft.text} lang={lang} label={t(`${K}.preview.${lang}`)} />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </Card>

                <Card title={t(`${K}.options.title`)} description={t(`${K}.options.description`)}>
                    <div className="grid gap-3 md:grid-cols-2">
                        {FLAGS.map((f) => (
                            <SwitchRow key={f} id={`spam-external-${f}`} label={t(`${K}.options.${f}.label`)} hint={t(`${K}.options.${f}.hint`)} checked={draft[f]} onChange={(v) => set({ [f]: v } as Partial<ExternalCfg>)} />
                        ))}
                    </div>
                    {draft.subjectTag && (
                        <p className="mt-3 text-sm text-muted-foreground" data-testid="spam-external-tag-example">
                            {t(`${K}.options.tagExample`)} <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{tag} {t(`${K}.options.tagSubject`)}</span>
                        </p>
                    )}
                </Card>

                <Card title={t(`${K}.domains.title`)} description={t(`${K}.domains.description`)}>
                    <div className="space-y-4">
                        <div>
                            <p className="text-sm font-medium text-foreground" id="spam-own-domains-label">{t(`${K}.domains.own`)}</p>
                            {data.ownDomains.length === 0 ? (
                                <p className="mt-1 text-sm text-muted-foreground">{t(`${K}.domains.ownNone`)}</p>
                            ) : (
                                <ul aria-labelledby="spam-own-domains-label" className="mt-1 flex flex-wrap gap-2">
                                    {data.ownDomains.map((d) => <li key={d}><Badge tone="neutral"><span translate="no">{d}</span></Badge></li>)}
                                </ul>
                            )}
                        </div>
                        <div>
                            <Field label={t(`${K}.domains.addLabel`)} htmlFor="spam-internal-domain" hint={t(`${K}.domains.addHint`, { count: draft.internalDomains.length, max: MAX_INTERNAL_DOMAINS })} error={domainError}>
                                <div className="flex gap-2">
                                    <input
                                        id="spam-internal-domain"
                                        value={domainInput}
                                        onChange={(e) => { setDomainInput(e.target.value); setDomainError(null); }}
                                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDomain(); } }}
                                        placeholder={t(`${K}.domains.placeholder`)}
                                        autoComplete="off"
                                        spellCheck={false}
                                        aria-invalid={!!domainError || undefined}
                                        aria-describedby={domainError ? 'spam-internal-domain-err' : 'spam-internal-domain-hint'}
                                        className={inputClass}
                                    />
                                    <button type="button" className={btnOutline} onClick={addDomain}>{t(`${K}.domains.add`)}</button>
                                </div>
                            </Field>
                            {draft.internalDomains.length > 0 && (
                                <ul aria-label={t(`${K}.domains.listLabel`)} className="mt-3 flex flex-wrap gap-2">
                                    {draft.internalDomains.map((d) => (
                                        <li key={d} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted py-0.5 pl-3 pr-1 text-sm text-foreground">
                                            <span translate="no">{d}</span>
                                            <button
                                                type="button"
                                                onClick={() => set({ internalDomains: draft.internalDomains.filter((x) => x !== d) })}
                                                aria-label={t(`${K}.domains.remove`, { domain: d })}
                                                className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                            >
                                                <X className="h-3 w-3" aria-hidden="true" />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                </Card>

                <div className="flex flex-wrap items-center gap-3">
                    <button type="submit" className={btnPrimary} disabled={!dirty || busy} aria-busy={busy || undefined}>{t(`${K}.save`)}</button>
                    <button
                        type="button"
                        className={btnOutline}
                        disabled={!dirty || busy}
                        onClick={() => setDraft(cloneExt(data.config.external))}
                    >
                        {t(`${K}.discard`)}
                    </button>
                    <p className="text-xs text-muted-foreground">{data.updatedAt ? t(`${K}.updated`, { date: formatDateTime(data.updatedAt, intlLocale), by: data.updatedBy ?? '—' }) : t(`${K}.neverUpdated`)}</p>
                </div>
                <div role="status" aria-live="polite" className="min-h-[1.25rem] text-sm">
                    {msg && <p className={msg.kind === 'error' ? 'text-destructive' : 'text-success'} role={msg.kind === 'error' ? 'alert' : undefined}>{msg.text}</p>}
                </div>
            </form>

            <SpamListEditor apiBase={LISTS_BASE} kind="external" variant="admin" idPrefix="spam-external" />
        </div>
    );
}
