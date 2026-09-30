'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useCache } from '@/contexts/CacheContext';
import { useI18n } from '@/components/I18nProvider';
import { LABELS_CACHE_KEY } from '@/lib/mail-list';
import { rulesApi } from '@/lib/rules/client';
import { describeRule } from '@/lib/rules/describe';
import { RuleEditor, type EditableRule } from '@/components/rules/RuleEditor';
import { useRuleData } from '@/components/rules/useRuleData';

type Row = EditableRule & { id: string; labelId?: string | null };

/** Ajustes > Reglas: todas las reglas del motor (las de etiquetas incluidas), ordenables por prioridad, con constructor visual. */
export function RulesSettings() {
    const { t, locale } = useI18n();
    const { invalidate } = useCache();
    const { labels, contacts, forward, loading: dataLoading } = useRuleData();
    const [rules, setRules] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<Row | 'new' | null>(null);
    const [dragId, setDragId] = useState<string | null>(null);
    const [announce, setAnnounce] = useState('');

    const load = useCallback(async () => {
        const r = await rulesApi.list();
        if (r.ok && Array.isArray(r.data)) setRules(r.data as Row[]);
        setLoading(false);
    }, []);
    useEffect(() => { void load(); }, [load]);

    const nameOf = (id: string) => labels.find((l) => l.id === id)?.fullPath;
    const persistOrder = async (next: Row[], movedName: string) => {
        setRules(next);
        const r = await rulesApi.reorder(next.map((x) => x.id));
        if (!r.ok) { toast.error(t('labelTree.errors.generic')); void load(); return; }
        setAnnounce(t('ruleBuilder.page.moved', { name: movedName, pos: next.findIndex((x) => x.name === movedName) + 1 }));
    };
    const move = (id: string, to: number) => {
        const from = rules.findIndex((r) => r.id === id);
        if (from < 0 || to < 0 || to >= rules.length || from === to) return;
        const next = [...rules];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
        void persistOrder(next, item.name);
    };
    const toggle = async (r: Row) => {
        const res = await rulesApi.update(r.id, { ...r, enabled: !r.enabled });
        if (res.ok) void load(); else toast.error(res.error || t('labelTree.errors.generic'));
    };
    const remove = async (r: Row) => {
        if (!window.confirm(t('ruleBuilder.page.confirmDelete', { name: r.name }))) return;
        const res = await rulesApi.remove(r.id);
        if (res.ok) void load(); else toast.error(t('labelTree.errors.generic'));
    };

    if (loading || dataLoading) return <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t('common.loading')}</div>;

    if (editing) {
        return (
            <div className="space-y-4">
                <h2 className="text-lg font-semibold text-foreground">{editing === 'new' ? t('ruleBuilder.page.new') : t('ruleBuilder.page.edit')}</h2>
                <RuleEditor
                    rule={editing === 'new' ? null : editing}
                    labelId={editing === 'new' ? null : editing.labelId ?? null}
                    labels={labels} contacts={contacts} forward={forward}
                    onSaved={(saved) => { void load(); void invalidate(LABELS_CACHE_KEY); if (!saved?.refresh) setEditing(null); }}
                    onCancel={() => setEditing(null)}
                />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold text-foreground">{t('ruleBuilder.page.title')}</h2>
                    <p className="text-sm text-muted-foreground">{t('ruleBuilder.page.description')}</p>
                </div>
                <button type="button" onClick={() => setEditing('new')} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                    <Plus className="h-4 w-4" aria-hidden="true" /> {t('ruleBuilder.page.new')}
                </button>
            </div>
            {rules.length === 0 && <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t('ruleBuilder.page.empty')}</p>}
            <ol className="space-y-2" aria-label={t('ruleBuilder.page.title')}>
                {rules.map((r, i) => (
                    <li key={r.id} draggable onDragStart={() => setDragId(r.id)} onDragEnd={() => setDragId(null)}
                        onDragOver={(e) => { if (dragId) e.preventDefault(); }}
                        onDrop={(e) => { e.preventDefault(); if (dragId) move(dragId, i); setDragId(null); }}
                        className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
                        <GripVertical className="mt-1 h-4 w-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-foreground">{r.name}</span>
                                {r.labelId && <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">{nameOf(r.labelId) ?? ''}</span>}
                                {!r.enabled && <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">{t('ruleBuilder.page.disabled')}</span>}
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">{describeRule(r.conditions, r.actions, nameOf, locale === 'en' ? 'en' : 'es')}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            <button type="button" disabled={i === 0} aria-label={t('ruleBuilder.page.moveUp', { name: r.name })} onClick={() => move(r.id, i - 1)} className="rounded-md p-2 text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
                            <button type="button" disabled={i === rules.length - 1} aria-label={t('ruleBuilder.page.moveDown', { name: r.name })} onClick={() => move(r.id, i + 1)} className="rounded-md p-2 text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
                            <input type="checkbox" role="switch" checked={r.enabled} aria-label={t('ruleBuilder.editor.enabled')} onChange={() => { void toggle(r); }} className="mx-1" />
                            <button type="button" aria-label={t('ruleBuilder.page.editRule', { name: r.name })} onClick={() => setEditing(r)} className="rounded-md p-2 text-muted-foreground hover:bg-muted"><Pencil className="h-4 w-4" aria-hidden="true" /></button>
                            <button type="button" aria-label={t('ruleBuilder.page.deleteRule', { name: r.name })} onClick={() => { void remove(r); }} className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-destructive"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                        </div>
                    </li>
                ))}
            </ol>
            <div role="status" aria-live="polite" className="sr-only">{announce}</div>
        </div>
    );
}
