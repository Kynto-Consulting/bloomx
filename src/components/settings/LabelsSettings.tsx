'use client';

import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { useCache } from '@/contexts/CacheContext';
import { useI18n } from '@/components/I18nProvider';
import { LABELS_CACHE_KEY, type LabelRef } from '@/lib/mail-list';
import { DEFAULT_LABEL_COLOR } from '@/lib/labels/palette';
import { labelsApi } from '@/lib/labels/client';
import type { LabelBehavior } from '@/lib/labels/model';
import { LabelTree } from '@/components/labels/LabelTree';
import { LabelEditor } from '@/components/labels/LabelEditor';
import { useRuleData } from '@/components/rules/useRuleData';
import { inputCls } from '@/components/rules/ConditionInputs';

/** Ajustes > Etiquetas: el mismo arbol que la barra lateral (arrastrar, menu, teclado) + editor completo con reglas. */
export function LabelsSettings() {
    const { t } = useI18n();
    const { invalidate } = useCache();
    const { labels, contacts, forward, loading, reloadLabels } = useRuleData();
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [focusRules, setFocusRules] = useState(false);
    const [newName, setNewName] = useState('');
    const [newBehavior, setNewBehavior] = useState<LabelBehavior>('tag');
    const [newParent, setNewParent] = useState('');
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const changed = async () => { await reloadLabels(); await invalidate(LABELS_CACHE_KEY); };
    const selected = labels.find((l) => l.id === selectedId) ?? null;

    const create = async () => {
        if (!newName.trim()) return;
        setCreating(true);
        setError(null);
        const r = await labelsApi.create({ name: newName.trim(), behavior: newBehavior, color: DEFAULT_LABEL_COLOR, parentId: newParent || null });
        setCreating(false);
        if (!r.ok) { setError(t(`labelTree.errors.${['cycle', 'depth', 'conflict', 'limit', 'network'].includes(r.code ?? '') ? r.code : 'generic'}`)); return; }
        setNewName('');
        setSelectedId(r.data?.id ?? null);
        await changed();
    };

    if (loading) return <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t('common.loading')}</div>;

    const refs = labels as unknown as LabelRef[];
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-lg font-semibold text-foreground">{t('labelTree.settings.title')}</h2>
                <p className="text-sm text-muted-foreground">{t('labelTree.settings.description')}</p>
            </div>

            <form className="grid gap-2 rounded-lg border border-border bg-card p-3 sm:grid-cols-[1fr_auto_auto_auto]" onSubmit={(e) => { e.preventDefault(); void create(); }}>
                <input aria-label={t('labelTree.settings.editor.name')} placeholder={t('labelTree.settings.namePlaceholder')} value={newName} maxLength={120} onChange={(e) => setNewName(e.target.value)} className={inputCls} />
                <select aria-label={t('labelTree.settings.editor.behavior')} value={newBehavior} onChange={(e) => setNewBehavior(e.target.value as LabelBehavior)} className={`${inputCls} pr-7`}>
                    <option value="tag">{t('labelTree.settings.editor.tag')}</option>
                    <option value="folder">{t('labelTree.settings.editor.folder')}</option>
                </select>
                <select aria-label={t('labelTree.settings.editor.parent')} value={newParent} onChange={(e) => setNewParent(e.target.value)} className={`${inputCls} pr-7`}>
                    <option value="">{t('labelTree.menu.moveToRoot')}</option>
                    {[...labels].sort((a, b) => a.fullPath.localeCompare(b.fullPath)).map((l) => <option key={l.id} value={l.id}>{l.fullPath}</option>)}
                </select>
                <button type="submit" disabled={creating || !newName.trim()} className="inline-flex items-center justify-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                    {creating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />} {t('labelTree.settings.create')}
                </button>
                {error && <p role="alert" className="text-sm text-destructive sm:col-span-4">{error}</p>}
            </form>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_1fr]">
                <div className="rounded-lg border border-border bg-sidebar p-2">
                    {labels.length === 0
                        ? <p className="p-4 text-center text-sm text-muted-foreground">{t('labelTree.settings.empty')}</p>
                        : <LabelTree mode="settings" labels={refs} selectedId={selectedId} onChanged={() => { void changed(); }}
                            onEdit={(l) => { setFocusRules(false); setSelectedId(l.id); }} />}
                </div>
                <div>
                    {selected
                        ? <LabelEditor key={`${selected.id}-${focusRules}`} label={selected} labels={labels} contacts={contacts} forward={forward} focusRules={focusRules} onChanged={() => { void changed(); }} />
                        : <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t('labelTree.settings.pick')}</p>}
                </div>
            </div>
        </div>
    );
}
