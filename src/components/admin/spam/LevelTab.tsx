'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
    Badge, Card, ErrorState, Field, LoadingState, adminFetch, apiErrorKey, btnDangerOutline, btnOutline, btnPrimary, formatDateTime, inputClass,
    selectClass, useAdminQuery, useDebounced, useUnsavedChanges,
} from '@/components/admin/console';
import { SwitchRow, parseDecimal, parseIntStrict } from './parts';
import {
    CONFIG_URL, ENGINE_KEYS, FAMILIES, LEVELS, SUSPICIOUS_MARGIN, type BandAction, type ConfigResponse, type EngineKey, type Family, type Level, type SimulationResponse, type SpamCfg,
} from './types';

const K = 'admin.console.spam.level';
const ACTIONS: BandAction[] = ['deliver', 'warn', 'spam'];

interface Draft {
    level: Level;
    threshold: string;
    suspicious: BandAction;
    spam: BandAction;
    weights: Record<Family, string>;
    engine: Record<EngineKey, boolean>;
    allowUserSensitivity: boolean;
    retention: string;
    logDelivered: boolean;
}

const fmtW = (n: number) => String(Math.round(n * 100) / 100);

function toDraft(c: SpamCfg): Draft {
    return {
        level: c.level,
        threshold: String(c.threshold),
        suspicious: c.actions.suspicious,
        spam: c.actions.spam,
        weights: Object.fromEntries(FAMILIES.map((f) => [f, fmtW(c.familyWeights[f])])) as Record<Family, string>,
        engine: { ...c.engine },
        allowUserSensitivity: c.allowUserSensitivity,
        retention: String(c.logRetentionDays),
        logDelivered: c.logDelivered,
    };
}

interface Checked { threshold: number; retention: number; weights: Record<Family, number>; errors: { threshold?: string; retention?: string; weights: Partial<Record<Family, string>> } }

function check(d: Draft, t: (k: string, p?: Record<string, string | number>) => string): Checked {
    const threshold = parseIntStrict(d.threshold);
    const retention = parseIntStrict(d.retention);
    const weights = {} as Record<Family, number>;
    const errors: Checked['errors'] = { weights: {} };
    if (!(threshold >= 1 && threshold <= 100)) errors.threshold = t(`${K}.errors.threshold`);
    if (!(retention >= 1 && retention <= 365)) errors.retention = t(`${K}.errors.retention`);
    for (const f of FAMILIES) {
        weights[f] = parseDecimal(d.weights[f]);
        if (!(weights[f] >= 0 && weights[f] <= 2)) errors.weights[f] = t(`${K}.errors.weight`);
    }
    return { threshold, retention, weights, errors };
}

const hasErrors = (c: Checked) => !!c.errors.threshold || !!c.errors.retention || Object.keys(c.errors.weights).length > 0;

/** Parche contra el guardado. `scoring` = solo lo que cambia el resultado de un correo (lo unico que tiene sentido simular). */
function buildPatch(saved: SpamCfg, d: Draft, c: Checked, scoring: boolean): Record<string, unknown> {
    const p: Record<string, unknown> = {};
    const thr = Number.isNaN(c.threshold) ? saved.threshold : c.threshold;
    if (d.level !== saved.level || thr !== saved.threshold) { p.level = d.level; p.threshold = thr; }
    if (d.suspicious !== saved.actions.suspicious || d.spam !== saved.actions.spam) p.actions = { suspicious: d.suspicious, spam: d.spam };
    if (FAMILIES.some((f) => c.weights[f] !== saved.familyWeights[f])) {
        p.familyWeights = Object.fromEntries(FAMILIES.map((f) => [f, Number.isNaN(c.weights[f]) ? saved.familyWeights[f] : c.weights[f]]));
    }
    if (ENGINE_KEYS.some((k) => d.engine[k] !== saved.engine[k])) p.engine = { ...d.engine };
    if (!scoring) {
        if (d.allowUserSensitivity !== saved.allowUserSensitivity) p.allowUserSensitivity = d.allowUserSensitivity;
        if (!Number.isNaN(c.retention) && c.retention !== saved.logRetentionDays) p.logRetentionDays = c.retention;
        if (d.logDelivered !== saved.logDelivered) p.logDelivered = d.logDelivered;
    }
    return p;
}

export function LevelTab() {
    const { t, intlLocale } = useI18n();
    const { data, error, isLoading, mutate } = useAdminQuery<ConfigResponse>(CONFIG_URL);
    const [draft, setDraft] = React.useState<Draft | null>(null);
    const [busy, setBusy] = React.useState<'save' | 'reset' | null>(null);
    const [msg, setMsg] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
    const [resetOpen, setResetOpen] = React.useState(false);
    const [resetError, setResetError] = React.useState<string | null>(null);

    // La politica de externos se edita en otra pestana con la misma consulta: no debe pisar lo que se esta editando aqui.
    const signature = data ? JSON.stringify({ ...data.config, external: null, rev: 0 }) : '';
    React.useEffect(() => {
        if (data) setDraft(toDraft(data.config));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signature]);

    const checked = React.useMemo(() => (draft ? check(draft, t) : null), [draft, t]);
    const invalid = checked ? hasErrors(checked) : false;
    const patch = React.useMemo(() => (data && draft && checked ? buildPatch(data.config, draft, checked, false) : {}), [data, draft, checked]);
    const dirty = Object.keys(patch).length > 0;
    useUnsavedChanges(dirty);

    // --- vista previa (debounce) ---
    const simPatch = React.useMemo(() => (data && draft && checked && !hasErrors(checked) ? buildPatch(data.config, draft, checked, true) : null), [data, draft, checked]);
    const simKey = useDebounced(simPatch ? JSON.stringify(simPatch) : '', 600);
    const [sim, setSim] = React.useState<{ state: 'idle' | 'loading' | 'ready' | 'error'; data?: SimulationResponse }>({ state: 'idle' });
    const simSeq = React.useRef(0);
    React.useEffect(() => {
        if (!simKey || simKey === '{}') { simSeq.current++; setSim({ state: 'idle' }); return; }
        const seq = ++simSeq.current;
        setSim((s) => ({ state: 'loading', data: s.data }));
        adminFetch<SimulationResponse>('/api/admin/spam/simulate', { method: 'POST', body: { config: JSON.parse(simKey) } })
            .then((r) => { if (seq === simSeq.current) setSim({ state: 'ready', data: r }); })
            .catch(() => { if (seq === simSeq.current) setSim({ state: 'error' }); });
    }, [simKey]);

    if (error && !data) return <ErrorState message={t(apiErrorKey(error))} onRetry={() => void mutate()} />;
    if (isLoading || !data || !draft || !checked) return <LoadingState />;

    const cfg = data.config;
    const set = (p: Partial<Draft>) => setDraft({ ...draft, ...p });
    const pickLevel = (l: Level) => {
        if (l === 'off' || l === 'custom') set({ level: l });
        else set({ level: l, threshold: String(data.presets[l]) });
    };
    const thr = checked.threshold;
    const thrOk = !checked.errors.threshold;

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        if (invalid || !dirty) return;
        setBusy('save'); setMsg(null);
        try {
            const next = await adminFetch<ConfigResponse>(CONFIG_URL, { method: 'PUT', body: patch });
            await mutate(next, { revalidate: false });
            setDraft(toDraft(next.config));
            setMsg({ kind: 'ok', text: t(`${K}.saved`) });
        } catch (err) { setMsg({ kind: 'error', text: t(apiErrorKey(err)) }); } finally { setBusy(null); }
    };
    const reset = async () => {
        setBusy('reset'); setResetError(null);
        try {
            const next = await adminFetch<ConfigResponse>(CONFIG_URL, { method: 'DELETE' });
            await mutate(next, { revalidate: false });
            setDraft(toDraft(next.config));
            setResetOpen(false);
            setMsg({ kind: 'ok', text: t(`${K}.resetDone`) });
        } catch (err) { setResetError(t(apiErrorKey(err))); } finally { setBusy(null); }
    };

    const nf = new Intl.NumberFormat(intlLocale);
    const s = sim.data;

    return (
        <form onSubmit={(e) => void save(e)} noValidate className="space-y-6">
            <Card title={t(`${K}.presets.title`)} description={t(`${K}.presets.description`)}>
                <fieldset className="space-y-2">
                    <legend className="sr-only">{t(`${K}.presets.legend`)}</legend>
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {LEVELS.map((l) => (
                            <label key={l} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                                <input type="radio" name="spam-level" value={l} checked={draft.level === l} onChange={() => pickLevel(l)} className="mt-1 h-4 w-4 accent-primary" />
                                <span className="min-w-0">
                                    <span className="block text-sm font-medium text-foreground">
                                        {t(`${K}.presets.${l}.label`)}
                                        {l !== 'off' && l !== 'custom' && <span className="ml-2 text-xs font-normal text-muted-foreground">{t(`${K}.presets.thresholdShort`, { value: data.presets[l] })}</span>}
                                    </span>
                                    <span className="block text-xs text-muted-foreground">{t(`${K}.presets.${l}.hint`)}</span>
                                </span>
                            </label>
                        ))}
                    </div>
                </fieldset>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <Field label={t(`${K}.threshold.label`)} htmlFor="spam-threshold" hint={t(`${K}.threshold.hint`)} error={checked.errors.threshold ?? null}>
                        <input
                            id="spam-threshold"
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={100}
                            step={1}
                            value={draft.threshold}
                            disabled={draft.level === 'off'}
                            onChange={(e) => set({ threshold: e.target.value, level: 'custom' })}
                            aria-invalid={!!checked.errors.threshold || undefined}
                            aria-describedby={checked.errors.threshold ? 'spam-threshold-err' : 'spam-threshold-hint'}
                            className={inputClass}
                        />
                    </Field>
                    <div className="text-sm" aria-live="polite" data-testid="spam-bands">
                        <p className="font-medium text-foreground">{t(`${K}.bands.title`)}</p>
                        {draft.level === 'off' ? (
                            <p className="mt-1 text-muted-foreground">{t(`${K}.bands.off`)}</p>
                        ) : thrOk ? (
                            <ul className="mt-1 space-y-1 text-muted-foreground">
                                <li><Badge tone="success">{t(`${K}.bands.clean`)}</Badge> {t(`${K}.bands.cleanRange`, { max: thr - SUSPICIOUS_MARGIN })}</li>
                                <li><Badge tone="warning">{t(`${K}.bands.suspicious`)}</Badge> {t(`${K}.bands.suspiciousRange`, { min: thr - SUSPICIOUS_MARGIN, max: thr })}</li>
                                <li><Badge tone="danger">{t(`${K}.bands.spam`)}</Badge> {t(`${K}.bands.spamRange`, { min: thr })}</li>
                            </ul>
                        ) : null}
                    </div>
                </div>
            </Card>

            <Card title={t(`${K}.actions.title`)} description={t(`${K}.actions.description`)}>
                <div className="grid gap-4 md:grid-cols-2">
                    {(['suspicious', 'spam'] as const).map((band) => (
                        <Field key={band} label={t(`${K}.actions.${band}`)} htmlFor={`spam-action-${band}`}>
                            <select id={`spam-action-${band}`} value={draft[band]} onChange={(e) => set({ [band]: e.target.value as BandAction } as Partial<Draft>)} className={selectClass}>
                                {ACTIONS.map((a) => <option key={a} value={a}>{t(`${K}.actions.options.${a}`)}</option>)}
                            </select>
                        </Field>
                    ))}
                </div>
                <p className="mt-3 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-foreground" role="note">{t(`${K}.actions.noReject`)}</p>
            </Card>

            <Card title={t(`${K}.weights.title`)} description={t(`${K}.weights.description`)}>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {FAMILIES.map((f) => (
                        <Field key={f} label={t(`${K}.weights.families.${f}.label`)} htmlFor={`spam-weight-${f}`} hint={t(`${K}.weights.families.${f}.hint`)} error={checked.errors.weights[f] ?? null}>
                            <input
                                id={`spam-weight-${f}`}
                                type="number"
                                inputMode="decimal"
                                min={0}
                                max={2}
                                step={0.05}
                                value={draft.weights[f]}
                                onChange={(e) => set({ weights: { ...draft.weights, [f]: e.target.value } })}
                                aria-invalid={!!checked.errors.weights[f] || undefined}
                                aria-describedby={checked.errors.weights[f] ? `spam-weight-${f}-err` : `spam-weight-${f}-hint`}
                                className={inputClass}
                            />
                        </Field>
                    ))}
                </div>
            </Card>

            <Card title={t(`${K}.engine.title`)} description={t(`${K}.engine.description`)}>
                <div className="grid gap-3 md:grid-cols-2">
                    {ENGINE_KEYS.map((k) => (
                        <SwitchRow key={k} id={`spam-engine-${k}`} label={t(`${K}.engine.${k}.label`)} hint={t(`${K}.engine.${k}.hint`)} checked={draft.engine[k]} onChange={(v) => set({ engine: { ...draft.engine, [k]: v } })} />
                    ))}
                    <SwitchRow id="spam-user-sensitivity" label={t(`${K}.userSensitivity.label`)} hint={t(`${K}.userSensitivity.hint`)} checked={draft.allowUserSensitivity} onChange={(v) => set({ allowUserSensitivity: v })} />
                </div>
            </Card>

            <Card title={t(`${K}.log.title`)} description={t(`${K}.log.description`)}>
                <div className="grid gap-4 md:grid-cols-2">
                    <Field label={t(`${K}.log.retention`)} htmlFor="spam-retention" hint={t(`${K}.log.retentionHint`)} error={checked.errors.retention ?? null}>
                        <input
                            id="spam-retention"
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={365}
                            step={1}
                            value={draft.retention}
                            onChange={(e) => set({ retention: e.target.value })}
                            aria-invalid={!!checked.errors.retention || undefined}
                            aria-describedby={checked.errors.retention ? 'spam-retention-err' : 'spam-retention-hint'}
                            className={inputClass}
                        />
                    </Field>
                    <SwitchRow id="spam-log-delivered" label={t(`${K}.log.delivered`)} hint={t(`${K}.log.deliveredHint`)} checked={draft.logDelivered} onChange={(v) => set({ logDelivered: v })} />
                </div>
            </Card>

            <Card title={t(`${K}.sim.title`)} description={t(`${K}.sim.description`)}>
                <div role="status" aria-live="polite" aria-busy={sim.state === 'loading' || undefined} data-testid="spam-sim" className="space-y-1 text-sm">
                    {sim.state === 'idle' && <p className="text-muted-foreground">{t(`${K}.sim.idle`)}</p>}
                    {sim.state === 'loading' && !s && <p className="text-muted-foreground">{t(`${K}.sim.loading`)}</p>}
                    {sim.state === 'error' && <p className="text-destructive">{t(`${K}.sim.error`)}</p>}
                    {(sim.state === 'ready' || sim.state === 'loading') && s && (
                        s.analyzed === 0 ? (
                            <p className="text-muted-foreground">{t(`${K}.sim.none`)}</p>
                        ) : (
                            <>
                                <p className="text-foreground">
                                    {t(s.scope === 'mine' ? `${K}.sim.summaryMine` : `${K}.sim.summaryDomain`, { analyzed: nf.format(s.analyzed), proposed: nf.format(s.proposed.spam), current: nf.format(s.current.spam) })}
                                </p>
                                <p className="text-muted-foreground">
                                    {t(`${K}.sim.changes`, { toSpam: s.changed.toSpam, fromSpam: s.changed.fromSpam, toWarned: s.changed.toWarned, fromWarned: s.changed.fromWarned })}
                                </p>
                                {s.skipped > 0 && <p className="text-xs text-muted-foreground">{t(`${K}.sim.skipped`, { skipped: s.skipped })}</p>}
                            </>
                        )
                    )}
                </div>
            </Card>

            <div className="flex flex-wrap items-center gap-3">
                <button type="submit" className={btnPrimary} disabled={!dirty || invalid || busy !== null} aria-busy={busy === 'save' || undefined}>{t(`${K}.save`)}</button>
                <button type="button" className={btnOutline} disabled={!dirty || busy !== null} onClick={() => setDraft(toDraft(cfg))}>{t(`${K}.discard`)}</button>
                <button type="button" className={btnDangerOutline} disabled={busy !== null} onClick={() => { setResetError(null); setResetOpen(true); }}>{t(`${K}.reset`)}</button>
                <p className="text-xs text-muted-foreground">
                    {data.updatedAt ? t(`${K}.updated`, { date: formatDateTime(data.updatedAt, intlLocale), by: data.updatedBy ?? '—' }) : t(`${K}.neverUpdated`)}
                </p>
            </div>
            <div role="status" aria-live="polite" className="min-h-[1.25rem] text-sm">
                {msg && <p className={msg.kind === 'error' ? 'text-destructive' : 'text-success'} role={msg.kind === 'error' ? 'alert' : undefined}>{msg.text}</p>}
            </div>

            <ConfirmDialog
                open={resetOpen}
                destructive
                title={t(`${K}.resetDialog.title`)}
                description={t(`${K}.resetDialog.body`)}
                confirmLabel={t(`${K}.resetDialog.confirm`)}
                cancelLabel={t('admin.console.common.cancel')}
                busy={busy === 'reset'}
                error={resetError}
                onConfirm={() => void reset()}
                onCancel={() => setResetOpen(false)}
            />
        </form>
    );
}
