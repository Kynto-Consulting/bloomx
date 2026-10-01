'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import { Card, Field, btnPrimary, inputClass, selectClass, useUnsavedChanges } from '@/components/admin/console';
import { GUARDRAIL_MODES, type AiGuardrails, type GuardrailMode, type RedactionCategories } from '@/lib/ai/types';
import { parseIntField, validatePatterns } from './logic';
import { Notice, Why, type TabProps } from './shared';

const CATS: Array<keyof RedactionCategories> = ['card', 'iban', 'nationalId', 'secret', 'email', 'phone'];

function ModeSelect({ id, value, onChange, disabled, label }: { id: string; value: GuardrailMode; onChange: (m: GuardrailMode) => void; disabled: boolean; label: string }) {
    const { t } = useI18n();
    return (
        <Field label={label} htmlFor={id}>
            <select id={id} className={selectClass} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as GuardrailMode)}>
                {GUARDRAIL_MODES.map((m) => <option key={m} value={m}>{t(`admin.ai.guardrails.modes.${m}`)}</option>)}
            </select>
        </Field>
    );
}

export function GuardrailsTab({ settings, save, caps, reasonFor }: TabProps) {
    const { t } = useI18n();
    const g = settings.config.guardrails;
    const uid = React.useId();
    const [prefix, setPrefix] = React.useState(g.systemPrefix);
    const [redMode, setRedMode] = React.useState<GuardrailMode>(g.redaction.mode);
    const [cats, setCats] = React.useState<RedactionCategories>(g.redaction.categories);
    const [topicMode, setTopicMode] = React.useState<GuardrailMode>(g.blockedTopics.mode);
    const [topics, setTopics] = React.useState(g.blockedTopics.patterns.join('\n'));
    const [outMode, setOutMode] = React.useState<GuardrailMode>(g.output.mode);
    const [outMax, setOutMax] = React.useState(String(g.output.maxChars));
    const [outPatterns, setOutPatterns] = React.useState(g.output.patterns.join('\n'));
    const [bodyMode, setBodyMode] = React.useState<AiGuardrails['bodyPolicy']['mode']>(g.bodyPolicy.mode);
    const [snippet, setSnippet] = React.useState(String(g.bodyPolicy.snippetChars));
    const [msg, setMsg] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
    const [busy, setBusy] = React.useState(false);

    const sig = JSON.stringify([g, settings.updatedAt]);
    React.useEffect(() => {
        setPrefix(g.systemPrefix); setRedMode(g.redaction.mode); setCats(g.redaction.categories); setTopicMode(g.blockedTopics.mode); setTopics(g.blockedTopics.patterns.join('\n'));
        setOutMode(g.output.mode); setOutMax(String(g.output.maxChars)); setOutPatterns(g.output.patterns.join('\n')); setBodyMode(g.bodyPolicy.mode); setSnippet(String(g.bodyPolicy.snippetChars));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sig]);

    const topicsV = validatePatterns(topics);
    const outV = validatePatterns(outPatterns);
    const outMaxN = parseIntField(outMax, 100, 400000);
    const snippetN = parseIntField(snippet, 0, 20000);
    const issueText = (v: ReturnType<typeof validatePatterns>) => v.issues.map((i) => t(`admin.ai.guardrails.issues.${i.issue}`, { line: i.line })).join(' ');
    const invalid = topicsV.issues.length > 0 || outV.issues.length > 0 || outMaxN === null || snippetN === null || prefix.length > 4000;

    const next: AiGuardrails | null = invalid ? null : {
        systemPrefix: prefix, redaction: { mode: redMode, categories: cats }, blockedTopics: { mode: topicMode, patterns: topicsV.patterns },
        output: { mode: outMode, maxChars: outMaxN as number, patterns: outV.patterns }, bodyPolicy: { mode: bodyMode, snippetChars: snippetN as number },
    };
    const dirty = next !== null && JSON.stringify(next) !== JSON.stringify(g);
    useUnsavedChanges(dirty);
    const off = !caps.edit || busy;
    const reason = reasonFor('edit');

    const onSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!next) return;
        setBusy(true); setMsg(null);
        const err = await save({ config: { guardrails: next } });
        setMsg(err ? { kind: 'error', text: err } : { kind: 'ok', text: t('admin.ai.saved') });
        setBusy(false);
    };

    return (
        <form onSubmit={(e) => void onSave(e)} className="space-y-4" noValidate>
            <Card title={t('admin.ai.guardrails.systemTitle')} description={t('admin.ai.guardrails.systemDesc')}>
                <Field label={t('admin.ai.guardrails.systemPrefix')} htmlFor={`${uid}-sys`} hint={t('admin.ai.guardrails.systemHint')} error={prefix.length > 4000 ? t('admin.ai.errors.range', { min: 0, max: 4000 }) : null}>
                    <textarea id={`${uid}-sys`} rows={4} className={inputClass} value={prefix} disabled={off} onChange={(e) => setPrefix(e.target.value)} />
                </Field>
            </Card>

            <Card title={t('admin.ai.guardrails.redactionTitle')} description={t('admin.ai.guardrails.redactionDesc')}>
                <div className="space-y-3">
                    <ModeSelect id={`${uid}-red`} label={t('admin.ai.guardrails.mode')} value={redMode} disabled={off} onChange={setRedMode} />
                    <fieldset disabled={off} className="flex flex-wrap gap-x-5 gap-y-2">
                        <legend className="mb-1 text-sm font-medium text-foreground">{t('admin.ai.guardrails.categories')}</legend>
                        {CATS.map((c) => (
                            <label key={c} className="inline-flex items-center gap-2 text-sm text-foreground">
                                <input type="checkbox" checked={cats[c]} onChange={(e) => setCats((s) => ({ ...s, [c]: e.target.checked }))} className="h-4 w-4 rounded border-input accent-primary" />
                                {t(`admin.ai.guardrails.cats.${c}`)}
                            </label>
                        ))}
                    </fieldset>
                </div>
            </Card>

            <Card title={t('admin.ai.guardrails.topicsTitle')} description={t('admin.ai.guardrails.topicsDesc')}>
                <div className="space-y-3">
                    <ModeSelect id={`${uid}-tm`} label={t('admin.ai.guardrails.mode')} value={topicMode} disabled={off} onChange={setTopicMode} />
                    <Field label={t('admin.ai.guardrails.patterns')} htmlFor={`${uid}-tp`} hint={t('admin.ai.guardrails.patternsHint')} error={topicsV.issues.length ? issueText(topicsV) : null}>
                        <textarea id={`${uid}-tp`} rows={4} className={`${inputClass} font-mono`} value={topics} disabled={off} onChange={(e) => setTopics(e.target.value)} spellCheck={false} aria-invalid={topicsV.issues.length > 0 || undefined} />
                    </Field>
                </div>
            </Card>

            <Card title={t('admin.ai.guardrails.outputTitle')} description={t('admin.ai.guardrails.outputDesc')}>
                <div className="space-y-3">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <ModeSelect id={`${uid}-om`} label={t('admin.ai.guardrails.mode')} value={outMode} disabled={off} onChange={setOutMode} />
                        <Field label={t('admin.ai.guardrails.outMax')} htmlFor={`${uid}-omax`} error={outMaxN === null ? t('admin.ai.errors.range', { min: 100, max: 400000 }) : null}>
                            <input id={`${uid}-omax`} inputMode="numeric" className={inputClass} value={outMax} disabled={off} onChange={(e) => setOutMax(e.target.value)} />
                        </Field>
                    </div>
                    <Field label={t('admin.ai.guardrails.patterns')} htmlFor={`${uid}-op`} hint={t('admin.ai.guardrails.patternsHint')} error={outV.issues.length ? issueText(outV) : null}>
                        <textarea id={`${uid}-op`} rows={3} className={`${inputClass} font-mono`} value={outPatterns} disabled={off} onChange={(e) => setOutPatterns(e.target.value)} spellCheck={false} aria-invalid={outV.issues.length > 0 || undefined} />
                    </Field>
                </div>
            </Card>

            <Card title={t('admin.ai.guardrails.bodyTitle')} description={t('admin.ai.guardrails.bodyDesc')}>
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t('admin.ai.guardrails.bodyMode')} htmlFor={`${uid}-bm`}>
                        <select id={`${uid}-bm`} className={selectClass} value={bodyMode} disabled={off} onChange={(e) => setBodyMode(e.target.value as AiGuardrails['bodyPolicy']['mode'])}>
                            {(['full', 'subject-only', 'snippet'] as const).map((m) => <option key={m} value={m}>{t(`admin.ai.guardrails.body.${m}`)}</option>)}
                        </select>
                    </Field>
                    {bodyMode === 'snippet' && (
                        <Field label={t('admin.ai.guardrails.snippetChars')} htmlFor={`${uid}-sn`} error={snippetN === null ? t('admin.ai.errors.range', { min: 0, max: 20000 }) : null}>
                            <input id={`${uid}-sn`} inputMode="numeric" className={inputClass} value={snippet} disabled={off} onChange={(e) => setSnippet(e.target.value)} />
                        </Field>
                    )}
                </div>
            </Card>

            <div className="flex flex-wrap items-center gap-3">
                <button type="submit" className={btnPrimary} disabled={off || !dirty}>{t('admin.ai.save')}</button>
                <Notice msg={msg} />
            </div>
            <Why reason={reason} />
        </form>
    );
}
