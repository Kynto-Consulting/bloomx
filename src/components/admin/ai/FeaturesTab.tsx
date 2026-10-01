'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import { Badge, Card, Switch, btnPrimary, inputClass, selectClass } from '@/components/admin/console';
import type { ExtensionAiPolicy } from '@/lib/ai/types';
import { extensionsForFeature, parseIntField } from './logic';
import { FEATURE_KEYS, Notice, Why, type TabProps } from './shared';

type Draft = { enabled: boolean; maxTokens: string; model: string };

function toDraft(p: ExtensionAiPolicy | undefined): Draft {
    return { enabled: p?.enabled !== false, maxTokens: p?.maxTokens ? String(p.maxTokens) : '', model: p?.model ?? '' };
}

export function FeaturesTab({ settings, extensions, save, caps, reasonFor }: TabProps) {
    const { t } = useI18n();
    const cfg = settings.config;
    const [msg, setMsg] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
    const [busy, setBusy] = React.useState(false);
    const ids = Array.from(new Set([...extensions.map((e) => e.id), ...Object.keys(cfg.extensions)]));
    const [drafts, setDrafts] = React.useState<Record<string, Draft>>({});
    const sig = JSON.stringify([cfg.extensions, settings.updatedAt]);
    React.useEffect(() => { setDrafts({}); }, [sig]);
    const draftOf = (id: string): Draft => drafts[id] ?? toDraft(cfg.extensions[id]);
    const editReason = reasonFor('edit');

    const run = async (patch: Record<string, unknown>, ok: string) => {
        setBusy(true); setMsg(null);
        const err = await save(patch);
        setMsg(err ? { kind: 'error', text: err } : { kind: 'ok', text: ok });
        setBusy(false);
    };

    const tokenErr = (id: string) => { const d = draftOf(id); return d.maxTokens.trim() !== '' && parseIntField(d.maxTokens, 16, 32000) === null; };
    const anyErr = ids.some(tokenErr);
    const changedIds = ids.filter((id) => drafts[id]);

    const saveExt = () => {
        const out: Record<string, ExtensionAiPolicy> = {};
        for (const id of ids) {
            const d = draftOf(id);
            const p: ExtensionAiPolicy = {};
            if (!d.enabled) p.enabled = false;
            const n = d.maxTokens.trim() ? parseIntField(d.maxTokens, 16, 32000) : null;
            if (n) p.maxTokens = n;
            if (d.model) p.model = d.model;
            if (Object.keys(p).length) out[id] = p;
        }
        void run({ config: { extensions: out } }, t('admin.ai.saved'));
    };

    return (
        <div className="space-y-4">
            <Card title={t('admin.ai.features.title')} description={t('admin.ai.features.description')}>
                <ul className="divide-y divide-border/60">
                    {FEATURE_KEYS.map((f) => {
                        const users = extensionsForFeature(extensions, f);
                        return (
                            <li key={f} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-foreground">{t(`admin.ai.features.names.${f}`)}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {users.length ? t('admin.ai.features.usedBy', { list: users.map((u) => u.name).join(', ') }) : t('admin.ai.features.noUsers')}
                                    </p>
                                </div>
                                <Switch
                                    checked={cfg.features[f]} label={t(`admin.ai.features.names.${f}`)} disabled={!caps.edit || busy}
                                    onChange={(v) => void run({ config: { features: { [f]: v } } }, t('admin.ai.saved'))}
                                />
                            </li>
                        );
                    })}
                </ul>
                <Why reason={editReason} />
            </Card>

            <Card title={t('admin.ai.features.extTitle')} description={t('admin.ai.features.extDescription')}>
                {ids.length === 0 ? <p className="text-sm text-muted-foreground">{t('admin.ai.summary.noExtensions')}</p> : (
                    <div className="space-y-3">
                        {ids.map((id) => {
                            const info = extensions.find((e) => e.id === id);
                            const d = draftOf(id);
                            const set = (patch: Partial<Draft>) => setDrafts((s) => ({ ...s, [id]: { ...d, ...patch } }));
                            const err = tokenErr(id);
                            return (
                                <div key={id} className="grid items-start gap-3 rounded-lg border border-border/60 p-3 sm:grid-cols-[1fr_auto_8rem_12rem]">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-foreground">{info?.name ?? id}</p>
                                        <div className="mt-1 flex flex-wrap gap-1">{(info?.features ?? []).map((f) => <Badge key={f}>{t(`admin.ai.features.names.${f}`)}</Badge>)}</div>
                                    </div>
                                    <Switch checked={d.enabled} label={t('admin.ai.features.extEnabled', { name: info?.name ?? id })} disabled={!caps.edit || busy} onChange={(v) => set({ enabled: v })} />
                                    <div>
                                        <label className="sr-only" htmlFor={`tok-${id}`}>{t('admin.ai.features.maxTokens')}</label>
                                        <input id={`tok-${id}`} inputMode="numeric" placeholder={t('admin.ai.features.maxTokens')} className={inputClass} value={d.maxTokens} disabled={!caps.edit || busy} onChange={(e) => set({ maxTokens: e.target.value })} aria-invalid={err || undefined} />
                                        {err && <p role="alert" className="mt-1 text-xs text-destructive">{t('admin.ai.errors.range', { min: 16, max: 32000 })}</p>}
                                    </div>
                                    <div>
                                        <label className="sr-only" htmlFor={`mod-${id}`}>{t('admin.ai.features.preferredModel')}</label>
                                        <select id={`mod-${id}`} className={selectClass} value={d.model} disabled={!caps.edit || busy} onChange={(e) => set({ model: e.target.value })}>
                                            <option value="">{t('admin.ai.features.defaultModel')}</option>
                                            {cfg.allowedModels.map((m) => <option key={m} value={m}>{m}</option>)}
                                            {d.model && !cfg.allowedModels.includes(d.model) && <option value={d.model}>{d.model}</option>}
                                        </select>
                                    </div>
                                </div>
                            );
                        })}
                        <div className="flex flex-wrap items-center gap-3">
                            <button type="button" className={btnPrimary} disabled={!caps.edit || busy || anyErr || changedIds.length === 0} onClick={saveExt}>{t('admin.ai.save')}</button>
                            <Notice msg={msg} />
                        </div>
                        <Why reason={editReason} />
                    </div>
                )}
            </Card>
        </div>
    );
}
