'use client';

import { useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { cn } from '@/lib/utils';
import { countLeaves, isGroup, type ConditionsV2, type Group, type Leaf, type Node } from '@/lib/rules/conditions';
import type { LabelRow } from '@/lib/labels/model';
import { MAX_DEPTH, MAX_LEAVES, canAddGroup, canAddLeaf, defaultLeaf, updateAt, type Path } from './conditionMeta';
import { LeafEditor } from './LeafEditor';
import { inputCls } from './ConditionInputs';

export interface ConditionBuilderProps {
    value: ConditionsV2;
    onChange: (v: ConditionsV2) => void;
    labels?: LabelRow[];
    /** Direcciones de contactos para autocompletar remitente / destinatarios. */
    contacts?: string[];
    disabled?: boolean;
}

/**
 * Constructor visual de condiciones v2: arbol de grupos (todas / alguna / ninguna) con hasta 4 niveles y 30 condiciones.
 * Totalmente controlado; accesible por teclado (cada control es un elemento nativo con nombre accesible).
 */
export function ConditionBuilder({ value, onChange, labels = [], contacts, disabled }: ConditionBuilderProps) {
    const { t } = useI18n();
    const uid = useId();
    const root = value.root;
    const commit = (path: Path, fn: (n: Node) => Node | null) => onChange({ v: 2, root: updateAt(root, path, fn) });
    const leafCount = countLeaves(root);

    const renderNode = (node: Node, path: Path, depth: number) => {
        if (isGroup(node)) return renderGroup(node, path, depth);
        return (
            <li key={path.join('.')} className="flex items-start gap-2 rounded-md border border-border bg-card p-2">
                <LeafEditor leaf={node as Leaf} labels={labels} contacts={contacts} idPrefix={`${uid}-${path.join('-')}`} onChange={(l) => commit(path, () => l)} />
                <button type="button" disabled={disabled} aria-label={t('ruleBuilder.removeCondition')} onClick={() => commit(path, () => null)}
                    className="mt-0.5 rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
            </li>
        );
    };

    const renderGroup = (g: Group, path: Path, depth: number) => {
        const isRoot = path.length === 0;
        return (
            <li key={path.join('.') || 'root'} className={cn(!isRoot && 'rounded-lg border border-dashed border-border bg-muted/30 p-2')}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-sm text-foreground">
                        <span className={isRoot ? '' : 'sr-only'}>{t('ruleBuilder.match')}</span>
                        <select value={g.op} disabled={disabled} aria-label={t('ruleBuilder.groupOp', { level: depth })} onChange={(e) => commit(path, (n) => ({ ...(n as Group), op: e.target.value as Group['op'] }))} className={`${inputCls} pr-7`}>
                            <option value="and">{t('ruleBuilder.op.and')}</option>
                            <option value="or">{t('ruleBuilder.op.or')}</option>
                            <option value="not">{t('ruleBuilder.op.not')}</option>
                        </select>
                    </label>
                    {!isRoot && (
                        <button type="button" disabled={disabled} onClick={() => commit(path, () => null)} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> {t('ruleBuilder.removeGroup')}
                        </button>
                    )}
                </div>
                <ul className="space-y-2" aria-label={t('ruleBuilder.groupLabel', { level: depth })}>
                    {g.children.map((c, i) => renderNode(c, [...path, i], depth + 1))}
                </ul>
                <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" disabled={disabled || !canAddLeaf(root)} onClick={() => commit(path, (n) => ({ ...(n as Group), children: [...(n as Group).children, defaultLeaf('subject')] }))}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" /> {t('ruleBuilder.addCondition')}
                    </button>
                    <button type="button" disabled={disabled || !canAddGroup(depth, root)} onClick={() => commit(path, (n) => ({ ...(n as Group), children: [...(n as Group).children, { type: 'group', op: 'or', children: [defaultLeaf('subject')] }] }))}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" /> {t('ruleBuilder.addGroup')}
                    </button>
                </div>
            </li>
        );
    };

    return (
        <div data-testid="condition-builder">
            <ul className="space-y-2">{renderGroup(root, [], 1)}</ul>
            <p className="mt-2 text-xs text-muted-foreground" role="status">
                {t('ruleBuilder.limits', { n: leafCount, max: MAX_LEAVES, depth: MAX_DEPTH })}
            </p>
        </div>
    );
}
