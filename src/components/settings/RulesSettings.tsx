'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Trash2, Plus, Check, X, Play } from 'lucide-react';
import { useCache } from '@/contexts/CacheContext';
import { validateUserRegex } from '@/lib/rules/regex-safety';

type Field = 'from' | 'to' | 'subject' | 'body' | 'hasAttachment' | 'label';
type Op = 'contains' | 'equals' | 'regex';

interface CondDraft { field: Field; op: Op; value: string }
interface ActDraft { type: string; labelId?: string; folder?: string }
interface RuleRow {
    id: string;
    name: string;
    enabled: boolean;
    priority: number;
    stopProcessing: boolean;
    conditions: { match: 'all' | 'any'; items: any[] };
    actions: any[];
}
interface Draft {
    id?: string;
    name: string;
    enabled: boolean;
    priority: number;
    stopProcessing: boolean;
    match: 'all' | 'any';
    conditions: CondDraft[];
    actions: ActDraft[];
}

const FIELD_LABEL: Record<Field, string> = {
    from: 'From', to: 'To', subject: 'Subject', body: 'Body', hasAttachment: 'Has attachment', label: 'Has label',
};
const ACTION_LABEL: Record<string, string> = {
    addLabel: 'Add label', markRead: 'Mark as read', star: 'Star', archive: 'Archive', delete: 'Move to trash', moveToFolder: 'Move to folder',
};
const EMPTY: Draft = {
    name: '', enabled: true, priority: 0, stopProcessing: false, match: 'all',
    conditions: [{ field: 'from', op: 'contains', value: '' }],
    actions: [{ type: 'archive' }],
};

function describeRule(r: RuleRow, labels: Record<string, string>) {
    const conds = (r.conditions?.items || []).map((c: any) =>
        c.field === 'hasAttachment' ? 'has attachment'
            : c.field === 'label' ? `label ${c.value}`
                : `${c.field} ${c.op} "${c.value}"`);
    const acts = (r.actions || []).map((a: any) =>
        a.type === 'addLabel' ? `label "${labels[a.labelId] || '?'}"`
            : a.type === 'moveToFolder' ? `move to ${a.folder}`
                : ACTION_LABEL[a.type] || a.type);
    return `If ${conds.join(r.conditions?.match === 'any' ? ' OR ' : ' AND ')} then ${acts.join(', ')}`;
}

export function RulesSettings() {
    const { invalidate } = useCache();
    const [rules, setRules] = useState<RuleRow[]>([]);
    const [labels, setLabels] = useState<Array<{ id: string; name: string }>>([]);
    const [loading, setLoading] = useState(true);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [r, l] = await Promise.all([fetch('/api/rules'), fetch('/api/labels')]);
            if (r.ok) setRules(await r.json());
            if (l.ok) setLabels(await l.json());
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const labelNames = Object.fromEntries(labels.map((l) => [l.id, l.name]));

    const draftProblem = (d: Draft): string | null => {
        if (!d.name.trim()) return 'Name is required';
        for (const c of d.conditions) {
            if (c.field === 'hasAttachment') continue;
            if (!c.value.trim()) return 'Every condition needs a value';
            if (c.op === 'regex' && c.field !== 'label') {
                const v = validateUserRegex(c.value.trim());
                if (!v.ok) return `Regex: ${v.error}`;
            }
        }
        for (const a of d.actions) {
            if (a.type === 'addLabel' && !a.labelId) return 'Choose a label for the "Add label" action';
        }
        return null;
    };

    const save = async () => {
        if (!draft) return;
        const problem = draftProblem(draft);
        if (problem) { setError(problem); return; }
        setSaving(true);
        setError(null);
        try {
            const payload = {
                name: draft.name,
                enabled: draft.enabled,
                priority: draft.priority,
                stopProcessing: draft.stopProcessing,
                conditions: {
                    match: draft.match,
                    items: draft.conditions.map((c) =>
                        c.field === 'hasAttachment' ? { field: 'hasAttachment', value: true }
                            : c.field === 'label' ? { field: 'label', value: c.value.trim() }
                                : { field: c.field, op: c.op, value: c.value.trim() }),
                },
                actions: draft.actions.map((a) =>
                    a.type === 'addLabel' ? { type: 'addLabel', labelId: a.labelId }
                        : a.type === 'moveToFolder' ? { type: 'moveToFolder', folder: a.folder || 'archive' }
                            : { type: a.type }),
            };
            const res = await fetch(draft.id ? `/api/rules/${draft.id}` : '/api/rules', {
                method: draft.id ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setError(body?.error || `Error ${res.status}`);
                return;
            }
            setDraft(null);
            await load();
        } finally {
            setSaving(false);
        }
    };

    const remove = async (r: RuleRow) => {
        if (!window.confirm(`Delete rule "${r.name}"?`)) return;
        const res = await fetch(`/api/rules/${r.id}`, { method: 'DELETE' });
        if (!res.ok) { setError('Could not delete the rule'); return; }
        await load();
    };

    const toggle = async (r: RuleRow) => {
        const res = await fetch(`/api/rules/${r.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...r, enabled: !r.enabled }),
        });
        if (res.ok) await load(); else setError('Could not update the rule');
    };

    const applyNow = async () => {
        setError(null);
        setInfo(null);
        const res = await fetch('/api/rules/apply', { method: 'POST' });
        if (!res.ok) { setError('Could not apply the rules'); return; }
        const body = await res.json();
        setInfo(`Checked ${body.processed} emails, changed ${body.changed}.`);
        await invalidate(/^emails-/);
        await invalidate('stats-counts');
    };

    const editRule = (r: RuleRow) => {
        setError(null);
        setDraft({
            id: r.id, name: r.name, enabled: r.enabled, priority: r.priority, stopProcessing: r.stopProcessing,
            match: r.conditions?.match === 'any' ? 'any' : 'all',
            conditions: (r.conditions?.items || []).map((c: any) => ({
                field: c.field, op: c.op || 'contains', value: c.field === 'hasAttachment' ? '' : String(c.value ?? ''),
            })),
            actions: (r.actions || []).map((a: any) => ({ type: a.type, labelId: a.labelId, folder: a.folder })),
        });
    };

    const input = 'rounded-md border bg-background px-2 py-1.5 text-sm';

    return (
        <div className="space-y-4 animate-in fade-in duration-300">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h3 className="text-lg font-medium">Rules</h3>
                    <p className="text-sm text-muted-foreground">
                        Rules run on every incoming email, lowest priority number first. Deleting moves to Trash.
                    </p>
                </div>
                <div className="flex gap-2">
                    <button onClick={applyNow} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium">
                        <Play className="h-3.5 w-3.5" /> Apply to recent mail
                    </button>
                    {!draft && (
                        <button
                            onClick={() => { setError(null); setDraft(structuredClone(EMPTY)); }}
                            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                        >
                            <Plus className="h-3.5 w-3.5" /> New rule
                        </button>
                    )}
                </div>
            </div>

            {error && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
            {info && <div role="status" className="rounded-md border bg-muted px-3 py-2 text-sm">{info}</div>}

            {draft && (
                <div className="space-y-4 rounded-lg border bg-card p-4">
                    <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
                        <label className="text-xs font-medium">
                            Name
                            <input value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={`mt-1 w-full ${input}`} />
                        </label>
                        <label className="text-xs font-medium">
                            Priority
                            <input type="number" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) || 0 })} className={`mt-1 w-full ${input}`} />
                        </label>
                    </div>

                    <fieldset className="space-y-2">
                        <legend className="text-xs font-medium">
                            When{' '}
                            <select value={draft.match} onChange={(e) => setDraft({ ...draft, match: e.target.value as 'all' | 'any' })} className={input}>
                                <option value="all">all conditions match</option>
                                <option value="any">any condition matches</option>
                            </select>
                        </legend>
                        {draft.conditions.map((c, i) => (
                            <div key={i} className="flex flex-wrap items-center gap-2">
                                <select
                                    aria-label="Field"
                                    value={c.field}
                                    onChange={(e) => {
                                        const conditions = [...draft.conditions];
                                        conditions[i] = { ...c, field: e.target.value as Field };
                                        setDraft({ ...draft, conditions });
                                    }}
                                    className={input}
                                >
                                    {(Object.keys(FIELD_LABEL) as Field[]).map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
                                </select>
                                {c.field !== 'hasAttachment' && c.field !== 'label' && (
                                    <select
                                        aria-label="Operator"
                                        value={c.op}
                                        onChange={(e) => {
                                            const conditions = [...draft.conditions];
                                            conditions[i] = { ...c, op: e.target.value as Op };
                                            setDraft({ ...draft, conditions });
                                        }}
                                        className={input}
                                    >
                                        <option value="contains">contains</option>
                                        <option value="equals">equals</option>
                                        <option value="regex">matches regex</option>
                                    </select>
                                )}
                                {c.field === 'label' ? (
                                    <select
                                        aria-label="Label"
                                        value={c.value}
                                        onChange={(e) => {
                                            const conditions = [...draft.conditions];
                                            conditions[i] = { ...c, value: e.target.value };
                                            setDraft({ ...draft, conditions });
                                        }}
                                        className={input}
                                    >
                                        <option value="">Choose...</option>
                                        {labels.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
                                    </select>
                                ) : c.field !== 'hasAttachment' && (
                                    <input
                                        aria-label="Value"
                                        value={c.value}
                                        maxLength={500}
                                        onChange={(e) => {
                                            const conditions = [...draft.conditions];
                                            conditions[i] = { ...c, value: e.target.value };
                                            setDraft({ ...draft, conditions });
                                        }}
                                        className={`min-w-0 flex-1 ${input}`}
                                    />
                                )}
                                <button
                                    aria-label="Remove condition"
                                    disabled={draft.conditions.length <= 1}
                                    onClick={() => setDraft({ ...draft, conditions: draft.conditions.filter((_, j) => j !== i) })}
                                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        ))}
                        <button
                            onClick={() => setDraft({ ...draft, conditions: [...draft.conditions, { field: 'subject', op: 'contains', value: '' }] })}
                            disabled={draft.conditions.length >= 20}
                            className="text-xs font-medium text-primary"
                        >
                            + Add condition
                        </button>
                    </fieldset>

                    <fieldset className="space-y-2">
                        <legend className="text-xs font-medium">Then</legend>
                        {draft.actions.map((a, i) => (
                            <div key={i} className="flex flex-wrap items-center gap-2">
                                <select
                                    aria-label="Action"
                                    value={a.type}
                                    onChange={(e) => {
                                        const actions = [...draft.actions];
                                        actions[i] = { type: e.target.value, folder: e.target.value === 'moveToFolder' ? 'archive' : undefined };
                                        setDraft({ ...draft, actions });
                                    }}
                                    className={input}
                                >
                                    {Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                </select>
                                {a.type === 'addLabel' && (
                                    <select
                                        aria-label="Label to add"
                                        value={a.labelId || ''}
                                        onChange={(e) => {
                                            const actions = [...draft.actions];
                                            actions[i] = { ...a, labelId: e.target.value };
                                            setDraft({ ...draft, actions });
                                        }}
                                        className={input}
                                    >
                                        <option value="">Choose...</option>
                                        {labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                                    </select>
                                )}
                                {a.type === 'moveToFolder' && (
                                    <select
                                        aria-label="Folder"
                                        value={a.folder || 'archive'}
                                        onChange={(e) => {
                                            const actions = [...draft.actions];
                                            actions[i] = { ...a, folder: e.target.value };
                                            setDraft({ ...draft, actions });
                                        }}
                                        className={input}
                                    >
                                        {['inbox', 'archive', 'trash', 'spam'].map((f) => <option key={f} value={f}>{f}</option>)}
                                    </select>
                                )}
                                <button
                                    aria-label="Remove action"
                                    disabled={draft.actions.length <= 1}
                                    onClick={() => setDraft({ ...draft, actions: draft.actions.filter((_, j) => j !== i) })}
                                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        ))}
                        <button
                            onClick={() => setDraft({ ...draft, actions: [...draft.actions, { type: 'markRead' }] })}
                            disabled={draft.actions.length >= 10}
                            className="text-xs font-medium text-primary"
                        >
                            + Add action
                        </button>
                    </fieldset>

                    <div className="flex flex-wrap gap-4 text-xs">
                        <label className="inline-flex items-center gap-1.5">
                            <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /> Enabled
                        </label>
                        <label className="inline-flex items-center gap-1.5">
                            <input type="checkbox" checked={draft.stopProcessing} onChange={(e) => setDraft({ ...draft, stopProcessing: e.target.checked })} /> Stop processing other rules
                        </label>
                    </div>

                    <div className="flex gap-2">
                        <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
                            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
                        </button>
                        <button onClick={() => { setDraft(null); setError(null); }} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium">
                            <X className="h-3.5 w-3.5" /> Cancel
                        </button>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : rules.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No rules yet.</p>
            ) : (
                <ul className="divide-y rounded-lg border">
                    {rules.map((r) => (
                        <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                            <input type="checkbox" aria-label={`Enable ${r.name}`} checked={r.enabled} onChange={() => toggle(r)} />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium">
                                    {r.name} <span className="text-xs font-normal text-muted-foreground">priority {r.priority}{r.stopProcessing ? ', stops' : ''}</span>
                                </div>
                                <div className="truncate text-xs text-muted-foreground">{describeRule(r, labelNames)}</div>
                            </div>
                            <button aria-label={`Edit ${r.name}`} onClick={() => editRule(r)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted">
                                <Pencil className="h-4 w-4" />
                            </button>
                            <button aria-label={`Delete ${r.name}`} onClick={() => remove(r)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive">
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
