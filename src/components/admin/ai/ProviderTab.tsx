'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import { Card, Field, StrongConfirmDialog, Switch, btnDangerOutline, btnOutline, btnPrimary, inputClass, selectClass, useUnsavedChanges } from '@/components/admin/console';
import { AI_PROVIDERS, PROVIDERS_NEED_BASE_URL, type AiProvider } from '@/lib/ai/types';
import { maskedKey, parseFloatField } from './logic';
import { Notice, Why, type TabProps } from './shared';
import { TestButton } from './SummaryTab';

type PriceDraft = Record<string, { inP: string; outP: string }>;

export function ProviderTab({ settings, save, caps, reasonFor }: TabProps) {
    const { t } = useI18n();
    const cfg = settings.config;
    const [provider, setProvider] = React.useState<string>(settings.provider ?? '');
    const [model, setModel] = React.useState(settings.model ?? '');
    const [baseUrl, setBaseUrl] = React.useState(settings.baseUrl ?? '');
    const [allowed, setAllowed] = React.useState(cfg.allowedModels.join('\n'));
    const [prices, setPrices] = React.useState<PriceDraft>(() => Object.fromEntries(Object.entries(cfg.pricing).map(([m, p]) => [m, { inP: String(p.inPer1k), outP: String(p.outPer1k) }])));
    const [newKey, setNewKey] = React.useState<string | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [msg, setMsg] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
    const [killOpen, setKillOpen] = React.useState(false);
    const [delOpen, setDelOpen] = React.useState(false);
    const [confirmError, setConfirmError] = React.useState<string | null>(null);
    const uid = React.useId();

    const sig = JSON.stringify([settings.provider, settings.model, settings.baseUrl, cfg.allowedModels, cfg.pricing, settings.updatedAt]);
    React.useEffect(() => {
        setProvider(settings.provider ?? ''); setModel(settings.model ?? ''); setBaseUrl(settings.baseUrl ?? ''); setAllowed(cfg.allowedModels.join('\n'));
        setPrices(Object.fromEntries(Object.entries(cfg.pricing).map(([m, p]) => [m, { inP: String(p.inPer1k), outP: String(p.outPer1k) }])));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sig]);

    const allowedList = allowed.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const needsBase = provider !== '' && PROVIDERS_NEED_BASE_URL.includes(provider as AiProvider);
    const priceModels = Array.from(new Set([...allowedList, ...(model ? [model] : []), ...Object.keys(prices)]));
    const priceErrors: Record<string, boolean> = {};
    for (const m of priceModels) { const p = prices[m]; if (p && (parseFloatField(p.inP, 0, 1000) === null || parseFloatField(p.outP, 0, 1000) === null)) priceErrors[m] = true; }
    const modelNotAllowed = allowedList.length > 0 && model !== '' && !allowedList.includes(model);
    const baseMissing = needsBase && !baseUrl.trim();
    const invalid = Object.keys(priceErrors).length > 0 || modelNotAllowed || baseMissing;

    const dirtyEdit = model !== (settings.model ?? '') || allowedList.join('\n') !== cfg.allowedModels.join('\n') || JSON.stringify(buildPricing()) !== JSON.stringify(cfg.pricing);
    const dirtyCritical = provider !== (settings.provider ?? '') || baseUrl.trim() !== (settings.baseUrl ?? '');
    useUnsavedChanges(dirtyEdit || dirtyCritical);

    function buildPricing() {
        const out: Record<string, { inPer1k: number; outPer1k: number }> = {};
        for (const [m, p] of Object.entries(prices)) {
            const i = parseFloatField(p.inP, 0, 1000); const o = parseFloatField(p.outP, 0, 1000);
            if (i !== null && o !== null && (i > 0 || o > 0 || cfg.pricing[m])) out[m] = { inPer1k: i, outPer1k: o };
        }
        return out;
    }

    const run = async (patch: Record<string, unknown>, okKey: string) => {
        setBusy(true); setMsg(null);
        const err = await save(patch);
        setMsg(err ? { kind: 'error', text: err } : { kind: 'ok', text: t(okKey) });
        setBusy(false);
        return err;
    };

    const onSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (invalid) return;
        if (dirtyCritical && caps.critical) {
            const err = await run({ provider: provider || null, baseUrl: baseUrl.trim() || null }, 'admin.ai.saved');
            if (err) return;
        }
        if (dirtyEdit && caps.edit) await run({ model: model || null, config: { allowedModels: allowedList, pricing: buildPricing() } }, 'admin.ai.saved');
    };

    const editReason = reasonFor('edit');
    const critReason = reasonFor('critical');
    const keyMask = maskedKey(settings.keyConfigured, settings.keyLast4);

    const toggleKill = async (next: boolean) => {
        setConfirmError(null); setBusy(true);
        const err = await save({ enabled: next });
        setBusy(false);
        if (err) { setConfirmError(err); return; }
        setKillOpen(false);
        setMsg({ kind: 'ok', text: t(next ? 'admin.ai.killswitch.enabledDone' : 'admin.ai.killswitch.disabledDone') });
    };

    return (
        <div className="space-y-4">
            <Card title={t('admin.ai.provider.title')} description={t('admin.ai.provider.description')}>
                <form onSubmit={(e) => void onSave(e)} className="space-y-4" noValidate>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label={t('admin.ai.provider.provider')} htmlFor={`${uid}-prov`} hint={critReason}>
                            <select id={`${uid}-prov`} className={selectClass} value={provider} disabled={!caps.critical} onChange={(e) => setProvider(e.target.value)}>
                                <option value="">{t('admin.ai.provider.none')}</option>
                                {AI_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                        </Field>
                        <Field label={t('admin.ai.provider.model')} htmlFor={`${uid}-model`} hint={editReason} error={modelNotAllowed ? t('admin.ai.errors.modelNotAllowed') : null}>
                            <input id={`${uid}-model`} className={inputClass} value={model} disabled={!caps.edit} onChange={(e) => setModel(e.target.value)} autoComplete="off" spellCheck={false} aria-invalid={modelNotAllowed || undefined} />
                        </Field>
                    </div>
                    {(needsBase || settings.baseUrl) && (
                        <Field label={t('admin.ai.provider.baseUrl')} htmlFor={`${uid}-base`} hint={critReason ?? t('admin.ai.provider.baseUrlHint')} error={baseMissing ? t('admin.ai.errors.baseUrlRequired') : null}>
                            <input id={`${uid}-base`} type="url" className={inputClass} value={baseUrl} disabled={!caps.critical} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://" autoComplete="off" aria-invalid={baseMissing || undefined} />
                        </Field>
                    )}
                    <Field label={t('admin.ai.provider.allowed')} htmlFor={`${uid}-allowed`} hint={editReason ?? t('admin.ai.provider.allowedHint')}>
                        <textarea id={`${uid}-allowed`} rows={3} className={inputClass} value={allowed} disabled={!caps.edit} onChange={(e) => setAllowed(e.target.value)} spellCheck={false} />
                    </Field>
                    {priceModels.length > 0 && (
                        <fieldset className="space-y-2" disabled={!caps.edit}>
                            <legend className="text-sm font-medium text-foreground">{t('admin.ai.provider.pricing')}</legend>
                            <p className="text-xs text-muted-foreground">{t('admin.ai.provider.pricingHint')}</p>
                            {priceModels.map((m, i) => {
                                const p = prices[m] ?? { inP: '0', outP: '0' };
                                return (
                                    <div key={m} className="grid items-end gap-2 sm:grid-cols-[1fr_8rem_8rem]">
                                        <span className="truncate text-sm text-foreground" title={m}>{m}</span>
                                        <Field label={t('admin.ai.provider.priceIn')} htmlFor={`${uid}-pi${i}`} error={priceErrors[m] ? t('admin.ai.errors.number') : null}>
                                            <input id={`${uid}-pi${i}`} inputMode="decimal" className={inputClass} value={p.inP} onChange={(e) => setPrices((s) => ({ ...s, [m]: { ...p, inP: e.target.value } }))} />
                                        </Field>
                                        <Field label={t('admin.ai.provider.priceOut')} htmlFor={`${uid}-po${i}`}>
                                            <input id={`${uid}-po${i}`} inputMode="decimal" className={inputClass} value={p.outP} onChange={(e) => setPrices((s) => ({ ...s, [m]: { ...p, outP: e.target.value } }))} />
                                        </Field>
                                    </div>
                                );
                            })}
                        </fieldset>
                    )}
                    <div className="flex flex-wrap items-center gap-3">
                        <button type="submit" className={btnPrimary} disabled={busy || invalid || (!dirtyEdit && !dirtyCritical) || (!caps.edit && !caps.critical)}>{t('admin.ai.save')}</button>
                        <Notice msg={msg} />
                    </div>
                    <Why reason={editReason} />
                </form>
            </Card>

            <Card title={t('admin.ai.provider.keyTitle')} description={t('admin.ai.provider.keyDesc')}>
                <div className="space-y-3">
                    <p className="text-sm text-foreground">
                        {keyMask ? t('admin.ai.provider.keyConfigured', { mask: keyMask }) : t('admin.ai.provider.keyMissing')}
                    </p>
                    {newKey === null ? (
                        <div className="flex flex-wrap gap-2">
                            <button type="button" className={btnOutline} disabled={!caps.critical || busy} onClick={() => { setNewKey(''); setMsg(null); }}>
                                {keyMask ? t('admin.ai.provider.replace') : t('admin.ai.provider.setKey')}
                            </button>
                            {keyMask && <button type="button" className={btnDangerOutline} disabled={!caps.critical || busy} onClick={() => { setConfirmError(null); setDelOpen(true); }}>{t('admin.ai.provider.deleteKey')}</button>}
                        </div>
                    ) : (
                        <form className="space-y-2" onSubmit={async (e) => {
                            e.preventDefault();
                            if (newKey.trim().length < 8) return;
                            const err = await run({ apiKey: newKey.trim() }, 'admin.ai.provider.keySaved');
                            if (!err) setNewKey(null);
                        }}>
                            <Field label={t('admin.ai.provider.newKey')} htmlFor={`${uid}-key`} hint={t('admin.ai.provider.newKeyHint')}>
                                <input id={`${uid}-key`} type="password" autoComplete="off" spellCheck={false} className={inputClass} value={newKey} onChange={(e) => setNewKey(e.target.value)} />
                            </Field>
                            <div className="flex flex-wrap items-center gap-2">
                                <button type="submit" className={btnPrimary} disabled={busy || newKey.trim().length < 8}>{t('admin.ai.provider.saveKey')}</button>
                                <TestButton body={{ provider: provider || undefined, model: model || undefined, baseUrl: baseUrl.trim() || undefined, apiKey: newKey.trim() || undefined }} disabled={newKey.trim().length < 8} />
                                <button type="button" className={btnOutline} onClick={() => setNewKey(null)}>{t('admin.ai.cancel')}</button>
                            </div>
                        </form>
                    )}
                    <Why reason={critReason} />
                    {newKey === null && <TestButton disabled={!settings.configured} />}
                </div>
            </Card>

            <Card title={t('admin.ai.killswitch.title')} description={t('admin.ai.killswitch.description')}>
                <div className="flex flex-wrap items-center gap-3">
                    <Switch
                        id={`${uid}-kill`}
                        checked={settings.enabled}
                        label={t('admin.ai.killswitch.label')}
                        disabled={!caps.critical || busy}
                        onChange={(v) => { setConfirmError(null); if (v) void toggleKill(true); else setKillOpen(true); }}
                    />
                    <label htmlFor={`${uid}-kill`} className="text-sm text-foreground">{settings.enabled ? t('admin.ai.summary.on') : t('admin.ai.summary.off')}</label>
                </div>
                <Why reason={critReason} />
            </Card>

            <StrongConfirmDialog
                open={killOpen} title={t('admin.ai.killswitch.confirmTitle')} description={t('admin.ai.killswitch.confirmBody')} phrase={t('admin.ai.killswitch.phrase')}
                confirmLabel={t('admin.ai.killswitch.confirm')} cancelLabel={t('admin.ai.cancel')} busy={busy} error={confirmError}
                onConfirm={() => void toggleKill(false)} onCancel={() => setKillOpen(false)}
            />
            <StrongConfirmDialog
                open={delOpen} title={t('admin.ai.provider.deleteKeyTitle')} description={t('admin.ai.provider.deleteKeyBody')} phrase={t('admin.ai.killswitch.phrase')}
                confirmLabel={t('admin.ai.provider.deleteKey')} cancelLabel={t('admin.ai.cancel')} busy={busy} error={confirmError}
                onConfirm={async () => {
                    setBusy(true); const err = await save({ apiKey: null }); setBusy(false);
                    if (err) setConfirmError(err); else { setDelOpen(false); setMsg({ kind: 'ok', text: t('admin.ai.provider.keyDeleted') }); }
                }}
                onCancel={() => setDelOpen(false)}
            />
        </div>
    );
}
