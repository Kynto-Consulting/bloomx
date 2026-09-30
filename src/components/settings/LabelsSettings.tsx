'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Trash2, Plus, Check, X } from 'lucide-react';
import { useCache } from '@/contexts/CacheContext';
import { LABELS_CACHE_KEY } from '@/lib/mail-list';
import { validateUserRegex } from '@/lib/rules/regex-safety';

interface LabelRow {
    id: string;
    name: string;
    color: string;
    aliasSuffix?: string | null;
    filterRegex?: string | null;
}

interface Draft {
    id?: string;
    name: string;
    color: string;
    aliasSuffix: string;
    filterRegex: string;
}

const EMPTY: Draft = { name: '', color: '#6366f1', aliasSuffix: '', filterRegex: '' };

export function LabelsSettings() {
    const { invalidate } = useCache();
    const [labels, setLabels] = useState<LabelRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/labels');
            if (res.ok) setLabels(await res.json());
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const regexError = draft?.filterRegex.trim()
        ? (() => { const r = validateUserRegex(draft.filterRegex.trim()); return r.ok ? null : r.error; })()
        : null;

    const save = async () => {
        if (!draft) return;
        setSaving(true);
        setError(null);
        try {
            const payload = {
                name: draft.name,
                color: draft.color,
                aliasSuffix: draft.aliasSuffix,
                filterRegex: draft.filterRegex,
            };
            const res = await fetch(draft.id ? `/api/labels/${draft.id}` : '/api/labels', {
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
            await invalidate(LABELS_CACHE_KEY);
        } finally {
            setSaving(false);
        }
    };

    const remove = async (label: LabelRow) => {
        if (!window.confirm(`Delete label "${label.name}"? It will be removed from all emails.`)) return;
        const res = await fetch(`/api/labels/${label.id}`, { method: 'DELETE' });
        if (!res.ok) {
            setError('Could not delete the label');
            return;
        }
        await load();
        await invalidate(LABELS_CACHE_KEY);
        await invalidate(/^emails-/);
    };

    return (
        <div className="space-y-4 animate-in fade-in duration-300">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-medium">Labels</h3>
                    <p className="text-sm text-muted-foreground">
                        Rename, recolor or delete labels. An alias (you+alias@) or a regex on subject/body applies the label automatically.
                    </p>
                </div>
                {!draft && (
                    <button
                        onClick={() => { setError(null); setDraft({ ...EMPTY }); }}
                        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                    >
                        <Plus className="h-3.5 w-3.5" /> New label
                    </button>
                )}
            </div>

            {error && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

            {draft && (
                <div className="space-y-3 rounded-lg border bg-card p-4">
                    <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                        <label className="text-xs font-medium">
                            Name
                            <input
                                value={draft.name}
                                maxLength={50}
                                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                            />
                        </label>
                        <label className="text-xs font-medium">
                            Color
                            <input
                                type="color"
                                value={/^#[0-9a-fA-F]{6}$/.test(draft.color) ? draft.color : '#6366f1'}
                                onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                                className="mt-1 block h-8 w-14 cursor-pointer rounded-md border bg-background"
                            />
                        </label>
                    </div>
                    <label className="block text-xs font-medium">
                        Alias suffix (optional)
                        <input
                            value={draft.aliasSuffix}
                            maxLength={40}
                            placeholder="news  (matches you+news@your-domain)"
                            onChange={(e) => setDraft({ ...draft, aliasSuffix: e.target.value })}
                            className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                        />
                    </label>
                    <label className="block text-xs font-medium">
                        Regex on subject/body (optional, case-insensitive)
                        <input
                            value={draft.filterRegex}
                            maxLength={200}
                            placeholder="invoice|factura"
                            onChange={(e) => setDraft({ ...draft, filterRegex: e.target.value })}
                            className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 font-mono text-sm"
                        />
                        {regexError && <span className="mt-1 block text-destructive">{regexError}</span>}
                    </label>
                    <div className="flex gap-2">
                        <button
                            onClick={save}
                            disabled={saving || !draft.name.trim() || !!regexError}
                            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                        >
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
            ) : labels.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No labels yet.</p>
            ) : (
                <ul className="divide-y rounded-lg border">
                    {labels.map((l) => (
                        <li key={l.id} className="flex items-center gap-3 px-3 py-2">
                            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: l.color }} aria-hidden />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium">{l.name}</div>
                                {(l.aliasSuffix || l.filterRegex) && (
                                    <div className="truncate text-xs text-muted-foreground">
                                        {l.aliasSuffix && <span>+{l.aliasSuffix} </span>}
                                        {l.filterRegex && <span className="font-mono">/{l.filterRegex}/i</span>}
                                    </div>
                                )}
                            </div>
                            <button
                                aria-label={`Edit ${l.name}`}
                                onClick={() => { setError(null); setDraft({ id: l.id, name: l.name, color: l.color, aliasSuffix: l.aliasSuffix || '', filterRegex: l.filterRegex || '' }); }}
                                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                            >
                                <Pencil className="h-4 w-4" />
                            </button>
                            <button
                                aria-label={`Delete ${l.name}`}
                                onClick={() => remove(l)}
                                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
