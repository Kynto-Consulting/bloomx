'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import type { Action } from '@/lib/rules/engine';
import type { LabelRow } from '@/lib/labels/model';
import { inputCls } from './ConditionInputs';

const BASE = ['addLabel', 'removeLabel', 'moveToLabelFolder', 'markRead', 'star', 'archive', 'moveToFolder', 'delete', 'markSpam', 'snooze', 'stopProcessing'] as const;
const FOLDERS = ['inbox', 'archive', 'trash', 'spam'] as const;
const MAX_ACTIONS = 12;

export interface ForwardInfo { enabled: boolean; targets: string[] }

interface Props {
    actions: Action[];
    onChange: (a: Action[]) => void;
    labels: LabelRow[];
    forward?: ForwardInfo;
    /** Etiqueta implicita de una regla de etiqueta (no se muestra como fila editable). */
    implicitLabelId?: string | null;
}

function blank(type: string, labels: LabelRow[]): Action {
    switch (type) {
        case 'addLabel': case 'removeLabel': case 'moveToLabelFolder': return { type, labelId: labels[0]?.id ?? '' } as Action;
        case 'moveToFolder': return { type: 'moveToFolder', folder: 'archive' };
        case 'snooze': return { type: 'snooze', hours: 24 };
        case 'forwardTo': return { type: 'forwardTo', address: '' };
        default: return { type } as Action;
    }
}

export function ActionsEditor({ actions, onChange, labels, forward, implicitLabelId }: Props) {
    const { t } = useI18n();
    const types = [...BASE, ...(forward?.enabled && forward.targets.length ? ['forwardTo' as const] : [])];
    const visible = actions.map((a, i) => ({ a, i })).filter(({ a }) => !(implicitLabelId && a.type === 'addLabel' && (a as any).labelId === implicitLabelId));
    const set = (i: number, a: Action) => onChange(actions.map((x, j) => (j === i ? a : x)));
    const sel = `${inputCls} pr-7`;
    return (
        <div>
            <ul className="space-y-2">
                {visible.map(({ a, i }) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-2">
                        <select aria-label={t('ruleBuilder.editor.actionType')} value={a.type} onChange={(e) => set(i, blank(e.target.value, labels))} className={sel}>
                            {types.map((x) => <option key={x} value={x}>{t(`ruleBuilder.editor.actions.${x}`)}</option>)}
                        </select>
                        {(a.type === 'addLabel' || a.type === 'removeLabel' || a.type === 'moveToLabelFolder') && (
                            <select aria-label={t('ruleBuilder.editor.label')} value={a.labelId} onChange={(e) => set(i, { ...a, labelId: e.target.value })} className={sel}>
                                {a.labelId === '' && <option value="" disabled>{t('ruleBuilder.editor.pickLabel')}</option>}
                                {labels.filter((l) => a.type !== 'moveToLabelFolder' || l.behavior === 'folder').map((l) => <option key={l.id} value={l.id}>{l.fullPath}</option>)}
                            </select>
                        )}
                        {a.type === 'moveToFolder' && (
                            <select aria-label={t('ruleBuilder.editor.folder')} value={a.folder} onChange={(e) => set(i, { type: 'moveToFolder', folder: e.target.value as (typeof FOLDERS)[number] })} className={sel}>
                                {FOLDERS.map((f) => <option key={f} value={f}>{t(`sidebar.folders.${f}`)}</option>)}
                            </select>
                        )}
                        {a.type === 'snooze' && (
                            <label className="flex items-center gap-2 text-sm text-foreground">
                                <input type="number" min={1} max={8760} value={a.hours} onChange={(e) => set(i, { type: 'snooze', hours: Math.max(1, Math.min(8760, Number(e.target.value) || 1)) })} className={`${inputCls} w-24`} aria-label={t('ruleBuilder.editor.hours')} />
                                {t('ruleBuilder.editor.hoursUnit')}
                            </label>
                        )}
                        {a.type === 'forwardTo' && (
                            <select aria-label={t('ruleBuilder.editor.address')} value={a.address} onChange={(e) => set(i, { type: 'forwardTo', address: e.target.value })} className={sel}>
                                <option value="" disabled>{t('ruleBuilder.editor.pickAddress')}</option>
                                {forward?.targets.map((x) => <option key={x} value={x}>{x}</option>)}
                            </select>
                        )}
                        <button type="button" aria-label={t('ruleBuilder.editor.removeAction')} onClick={() => onChange(actions.filter((_, j) => j !== i))} className="ml-auto rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                    </li>
                ))}
            </ul>
            <button type="button" disabled={actions.length >= MAX_ACTIONS} onClick={() => onChange([...actions, blank('markRead', labels)])} className="mt-2 inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-50">
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> {t('ruleBuilder.editor.addAction')}
            </button>
        </div>
    );
}
