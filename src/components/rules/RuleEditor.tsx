'use client';

import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { rulesApi } from '@/lib/rules/client';
import { validateConditionsV2, toV2, type ConditionsV2 } from '@/lib/rules/conditions';
import { describeRule } from '@/lib/rules/describe';
import type { Action } from '@/lib/rules/engine';
import type { LabelRow } from '@/lib/labels/model';
import { ConditionBuilder } from './ConditionBuilder';
import { ActionsEditor, type ForwardInfo } from './ActionsEditor';
import { RuleTester } from './RuleTester';
import { RuleApplyPanel } from './RuleApplyPanel';
import { emptyConditions } from './conditionMeta';
import { TEMPLATE_IDS, templateConditions } from './ruleTemplates';
import { inputCls } from './ConditionInputs';

export interface EditableRule { id?: string; name: string; enabled: boolean; stopProcessing: boolean; conditions: unknown; actions: Action[]; priority?: number; matchedCount?: number; lastMatchedAt?: string | null }

interface Props {
    rule: EditableRule | null;
    /** Regla de "Asignar automaticamente" de esta etiqueta: la accion "etiquetar" es implicita. */
    labelId?: string | null;
    defaultName?: string;
    labels: LabelRow[];
    contacts?: string[];
    forward?: ForwardInfo;
    onSaved: (rule: any) => void;
    onCancel?: () => void;
}

type Tab = 'conditions' | 'test' | 'apply';

export function RuleEditor({ rule, labelId, defaultName, labels, contacts, forward, onSaved, onCancel }: Props) {
    const { t, locale } = useI18n();
    const [name, setName] = useState(rule?.name ?? defaultName ?? '');
    const [enabled, setEnabled] = useState(rule?.enabled ?? true);
    const [stop, setStop] = useState(rule?.stopProcessing ?? false);
    const [cond, setCond] = useState<ConditionsV2>(() => (rule ? toV2(rule.conditions) : emptyConditions()));
    const [actions, setActions] = useState<Action[]>(() => rule?.actions ?? (labelId ? [{ type: 'addLabel', labelId }] : [{ type: 'archive' }]));
    const [tab, setTab] = useState<Tab>('conditions');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [savedId, setSavedId] = useState<string | null>(rule?.id ?? null);
    const loc = locale === 'en' ? 'en' : 'es';
    const nameOf = (id: string) => labels.find((l) => l.id === id)?.fullPath;
    const summary = useMemo(() => describeRule(cond, labelId && !actions.some((a) => a.type === 'addLabel' && a.labelId === labelId) ? [{ type: 'addLabel', labelId }, ...actions] : actions, nameOf, loc), [cond, actions, labels, labelId, loc]); // eslint-disable-line react-hooks/exhaustive-deps

    const save = async () => {
        setError(null);
        const v = validateConditionsV2(cond);
        if (!v.ok) { setError(v.error); return; }
        if (!name.trim()) { setError(t('ruleBuilder.editor.nameRequired')); return; }
        if (actions.some((a) => 'labelId' in a && !a.labelId)) { setError(t('ruleBuilder.editor.pickLabel')); return; }
        setSaving(true);
        const body = { name: name.trim(), enabled, stopProcessing: stop, conditions: v.value, actions, ...(labelId ? { labelId } : {}), ...(rule?.priority !== undefined ? { priority: rule.priority } : {}) };
        const r = savedId ? await rulesApi.update(savedId, body) : await rulesApi.create(body);
        setSaving(false);
        if (!r.ok) { setError(r.error || t('ruleBuilder.editor.saveFailed')); return; }
        setSavedId(r.data.id);
        onSaved(r.data);
    };

    const tabBtn = (id: Tab, label: string) => (
        <button type="button" role="tab" id={`rt-${id}`} aria-selected={tab === id} aria-controls={`rp-${id}`} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)}
            onKeyDown={(e) => { const ids: Tab[] = ['conditions', 'test', 'apply']; const i = ids.indexOf(tab); if (e.key === 'ArrowRight') setTab(ids[(i + 1) % 3]); if (e.key === 'ArrowLeft') setTab(ids[(i + 2) % 3]); }}
            className={`rounded-t-md border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{label}</button>
    );

    return (
        <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
                <label className="block text-sm text-foreground">
                    {t('ruleBuilder.editor.name')}
                    <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className={`${inputCls} mt-1 w-full`} />
                </label>
                <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} role="switch" aria-label={t('ruleBuilder.editor.enabled')} /> {t('ruleBuilder.editor.enabled')}</label>
                <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={stop} onChange={(e) => setStop(e.target.checked)} /> {t('ruleBuilder.editor.stop')}</label>
            </div>

            <div role="tablist" aria-label={t('ruleBuilder.editor.tabs')} className="flex gap-1 border-b border-border">
                {tabBtn('conditions', t('ruleBuilder.editor.tabConditions'))}
                {tabBtn('test', t('ruleBuilder.editor.tabTest'))}
                {tabBtn('apply', t('ruleBuilder.editor.tabApply'))}
            </div>

            <div role="tabpanel" id="rp-conditions" aria-labelledby="rt-conditions" hidden={tab !== 'conditions'} className="space-y-4">
                <label className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                    {t('ruleBuilder.templates.title')}
                    <select value="" aria-label={t('ruleBuilder.templates.title')} onChange={(e) => { if (e.target.value) setCond(templateConditions(e.target.value as (typeof TEMPLATE_IDS)[number])); }} className={`${inputCls} pr-7`}>
                        <option value="">{t('ruleBuilder.templates.pick')}</option>
                        {TEMPLATE_IDS.map((id) => <option key={id} value={id}>{t(`ruleBuilder.templates.${id}`)}</option>)}
                    </select>
                </label>
                <ConditionBuilder value={cond} onChange={setCond} labels={labels} contacts={contacts} />
                <div>
                    <h4 className="mb-2 text-sm font-medium text-foreground">{t('ruleBuilder.editor.thenDo')}</h4>
                    {labelId && <p className="mb-2 text-xs text-muted-foreground">{t('ruleBuilder.editor.implicitLabel', { name: nameOf(labelId) ?? '' })}</p>}
                    <ActionsEditor actions={actions} onChange={setActions} labels={labels} forward={forward} implicitLabelId={labelId} />
                </div>
                <p className="rounded-md bg-muted/50 p-3 text-sm text-foreground" aria-live="polite" data-testid="rule-summary">{summary}</p>
            </div>
            <div role="tabpanel" id="rp-test" aria-labelledby="rt-test" hidden={tab !== 'test'}>{tab === 'test' && <RuleTester conditions={cond} />}</div>
            <div role="tabpanel" id="rp-apply" aria-labelledby="rt-apply" hidden={tab !== 'apply'}>
                {tab === 'apply' && (savedId
                    ? <RuleApplyPanel conditions={cond} ruleId={savedId} labelId={labelId} onApplied={() => onSaved({ id: savedId, refresh: true })} />
                    : <p className="text-sm text-muted-foreground">{t('ruleBuilder.apply.saveFirst')}</p>)}
            </div>

            {rule?.matchedCount !== undefined && (
                <p className="text-xs text-muted-foreground">{rule.lastMatchedAt ? t('ruleBuilder.editor.stats', { n: rule.matchedCount, when: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(rule.lastMatchedAt)) }) : t('ruleBuilder.editor.statsNever', { n: rule.matchedCount })}</p>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
                {onCancel && <button type="button" onClick={onCancel} className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-muted">{t('labelTree.cancel')}</button>}
                <button type="button" onClick={() => { void save(); }} disabled={saving} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                    {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} {t('ruleBuilder.editor.save')}
                </button>
            </div>
        </div>
    );
}
