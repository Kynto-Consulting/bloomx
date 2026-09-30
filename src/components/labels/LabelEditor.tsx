'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '@/components/I18nProvider';
import { descendantsOf, type LabelRow } from '@/lib/labels/model';
import { LABEL_PALETTE } from '@/lib/labels/palette';
import { labelsApi } from '@/lib/labels/client';
import { rulesApi } from '@/lib/rules/client';
import { RuleEditor, type EditableRule } from '@/components/rules/RuleEditor';
import { inputCls } from '@/components/rules/ConditionInputs';
import type { ForwardInfo } from '@/components/rules/ActionsEditor';

interface Props {
    label: LabelRow;
    labels: LabelRow[];
    contacts: string[];
    forward: ForwardInfo;
    onChanged: () => void;
    /** Abre directamente la seccion de reglas. */
    focusRules?: boolean;
}

/** Editor completo de una etiqueta: datos, comportamiento (etiqueta / carpeta) y "Asignar automaticamente" (reglas). */
export function LabelEditor({ label, labels, contacts, forward, onChanged, focusRules }: Props) {
    const { t } = useI18n();
    const [name, setName] = useState(label.name);
    const [color, setColor] = useState(label.color);
    const [behavior, setBehavior] = useState(label.behavior);
    const [parentId, setParentId] = useState<string | null>(label.parentId);
    const [showInSidebar, setShow] = useState(label.showInSidebar);
    const [showUnread, setUnread] = useState(label.showUnread);
    const [moveExisting, setMoveExisting] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [rules, setRules] = useState<EditableRule[]>([]);
    const [editing, setEditing] = useState<EditableRule | 'new' | null>(focusRules ? 'new' : null);

    useEffect(() => {
        setName(label.name); setColor(label.color); setBehavior(label.behavior); setParentId(label.parentId); setShow(label.showInSidebar); setUnread(label.showUnread); setMoveExisting(false); setError(null); setEditing(focusRules ? 'new' : null);
    }, [label, focusRules]);

    const loadRules = async () => { const r = await rulesApi.list(label.id); if (r.ok && r.data) setRules(r.data as EditableRule[]); };
    useEffect(() => { void loadRules(); }, [label.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const blocked = new Set([label.id, ...descendantsOf(label.id, labels)]);
    const save = async () => {
        setSaving(true);
        setError(null);
        const r = await labelsApi.patch(label.id, { name, color, behavior, parentId, showInSidebar, showUnread, ...(moveExisting ? { moveExisting: true } : {}) });
        setSaving(false);
        if (!r.ok) { setError(t(`labelTree.errors.${['cycle', 'depth', 'conflict', 'limit', 'network'].includes(r.code ?? '') ? r.code : 'generic'}`)); return; }
        toast.success(t('labelTree.settings.editor.saved'));
        onChanged();
    };

    return (
        <div className="space-y-6">
            <section aria-label={t('labelTree.settings.editor.title')} className="space-y-4">
                <h3 className="text-base font-semibold text-foreground">{label.fullPath}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm text-foreground">{t('labelTree.settings.editor.name')}
                        <input value={name} maxLength={50} onChange={(e) => setName(e.target.value)} className={`${inputCls} mt-1 w-full`} />
                    </label>
                    <label className="block text-sm text-foreground">{t('labelTree.settings.editor.parent')}
                        <select value={parentId ?? ''} onChange={(e) => setParentId(e.target.value || null)} className={`${inputCls} mt-1 w-full`}>
                            <option value="">{t('labelTree.menu.moveToRoot')}</option>
                            {labels.filter((l) => !blocked.has(l.id)).sort((a, b) => a.fullPath.localeCompare(b.fullPath)).map((l) => <option key={l.id} value={l.id}>{l.fullPath}</option>)}
                        </select>
                    </label>
                </div>
                <fieldset>
                    <legend className="text-sm text-foreground">{t('labelTree.settings.editor.color')}</legend>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                        {LABEL_PALETTE.map((c) => (
                            <button key={c} type="button" aria-label={c} aria-pressed={color.toLowerCase() === c} onClick={() => setColor(c)} style={{ backgroundColor: c }}
                                className={`h-7 w-7 rounded-full ring-1 ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${color.toLowerCase() === c ? 'ring-2 ring-foreground' : ''}`} />
                        ))}
                        <input type="color" aria-label={t('labelTree.settings.editor.customColor')} value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : LABEL_PALETTE[7]} onChange={(e) => setColor(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-input bg-background" />
                    </div>
                </fieldset>
                <fieldset className="space-y-2">
                    <legend className="text-sm text-foreground">{t('labelTree.settings.editor.behavior')}</legend>
                    <label className="flex items-start gap-2 text-sm text-foreground"><input type="radio" name={`beh-${label.id}`} checked={behavior === 'tag'} onChange={() => setBehavior('tag')} className="mt-1" />
                        <span><strong>{t('labelTree.settings.editor.tag')}</strong><span className="block text-xs text-muted-foreground">{t('labelTree.settings.editor.tagHelp')}</span></span></label>
                    <label className="flex items-start gap-2 text-sm text-foreground"><input type="radio" name={`beh-${label.id}`} checked={behavior === 'folder'} onChange={() => setBehavior('folder')} className="mt-1" />
                        <span><strong>{t('labelTree.settings.editor.folder')}</strong><span className="block text-xs text-muted-foreground">{t('labelTree.settings.editor.folderHelp')}</span></span></label>
                    {behavior === 'folder' && label.behavior !== 'folder' && (
                        <label className="ml-6 flex items-center gap-2 text-xs text-foreground"><input type="checkbox" checked={moveExisting} onChange={(e) => setMoveExisting(e.target.checked)} /> {t('labelTree.settings.editor.moveExisting')}</label>
                    )}
                    {behavior === 'tag' && label.behavior === 'folder' && <p className="ml-6 text-xs text-muted-foreground">{t('labelTree.settings.editor.releaseNote')}</p>}
                </fieldset>
                <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={showInSidebar} onChange={(e) => setShow(e.target.checked)} /> {t('labelTree.settings.editor.showInSidebar')}</label>
                    <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={showUnread} onChange={(e) => setUnread(e.target.checked)} /> {t('labelTree.settings.editor.showUnread')}</label>
                </div>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <button type="button" onClick={() => { void save(); }} disabled={saving} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                    {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} {t('labelTree.settings.editor.save')}
                </button>
            </section>

            <section aria-label={t('labelTree.settings.auto.title')} className="space-y-3 border-t border-border pt-4">
                <h3 className="text-base font-semibold text-foreground">{t('labelTree.settings.auto.title')}</h3>
                <p className="text-sm text-muted-foreground">{t(behavior === 'folder' ? 'labelTree.settings.auto.helpFolder' : 'labelTree.settings.auto.help')}</p>
                {editing ? (
                    <div className="rounded-lg border border-border bg-card p-4">
                        <RuleEditor
                            key={editing === 'new' ? 'new' : editing.id}
                            rule={editing === 'new' ? null : editing}
                            labelId={label.id}
                            defaultName={label.fullPath}
                            labels={labels}
                            contacts={contacts}
                            forward={forward}
                            onSaved={() => { void loadRules(); onChanged(); }}
                            onCancel={() => setEditing(null)}
                        />
                    </div>
                ) : (
                    <>
                        {rules.length === 0 && <p className="text-sm text-muted-foreground">{t('labelTree.settings.auto.none')}</p>}
                        <ul className="space-y-2">
                            {rules.map((r) => (
                                <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
                                    <button type="button" onClick={() => setEditing(r)} className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground hover:underline">{r.name}</button>
                                    <span className="text-xs text-muted-foreground">{t('labelTree.settings.auto.count', { n: r.matchedCount ?? 0 })}</span>
                                    <label className="flex items-center gap-2 text-xs text-foreground">
                                        <input type="checkbox" role="switch" checked={r.enabled} aria-label={t('ruleBuilder.editor.enabled')} onChange={async (e) => {
                                            const res = await rulesApi.update(r.id!, { ...r, enabled: e.target.checked, labelId: label.id });
                                            if (res.ok) void loadRules();
                                        }} /> {t('ruleBuilder.editor.enabled')}
                                    </label>
                                </li>
                            ))}
                        </ul>
                        <button type="button" onClick={() => setEditing('new')} className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted">
                            <Plus className="h-4 w-4" aria-hidden="true" /> {t('labelTree.settings.auto.add')}
                        </button>
                    </>
                )}
            </section>
        </div>
    );
}
