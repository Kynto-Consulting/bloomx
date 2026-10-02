'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import { Card, Field, inputClass, selectClass } from '@/components/admin/console';
import { useMoney } from '@/components/admin/billing/shared';
import { bpsToPercentText, estimateNet, isBps, validatePricing, type PricingDraft } from '@/lib/billing/revenue';
import { centsToInput, parseMoneyToCents } from '@/lib/billing/money';

export interface PriceForm { model: PricingDraft['model']; oneTime: string; month: string; year: string; trialDays: string }

export const emptyPriceForm = (): PriceForm => ({ model: 'free', oneTime: '', month: '', year: '', trialDays: '0' });

export function priceFormFrom(p: { model?: PricingDraft['model']; oneTimeCents?: number; monthCents?: number; yearCents?: number; trialDays?: number } | null | undefined): PriceForm {
    if (!p) return emptyPriceForm();
    return {
        model: p.model ?? 'free',
        oneTime: p.oneTimeCents ? centsToInput(p.oneTimeCents) : '',
        month: p.monthCents ? centsToInput(p.monthCents) : '',
        year: p.yearCents ? centsToInput(p.yearCents) : '',
        trialDays: String(p.trialDays ?? 0),
    };
}

/** Formulario -> borrador en centavos enteros (texto invalido => 0 y el campo se marca). */
export function toDraft(f: PriceForm): { draft: PricingDraft; invalid: Set<'oneTime' | 'month' | 'year' | 'trialDays'> } {
    const invalid = new Set<'oneTime' | 'month' | 'year' | 'trialDays'>();
    const cents = (key: 'oneTime' | 'month' | 'year') => {
        if (!f[key].trim()) return 0;
        const v = parseMoneyToCents(f[key]);
        if (v === null) invalid.add(key);
        return v ?? 0;
    };
    const trial = /^\d{1,3}$/.test(f.trialDays.trim()) ? Number(f.trialDays) : (invalid.add('trialDays'), 0);
    return { draft: { model: f.model, oneTimeCents: cents('oneTime'), monthCents: cents('month'), yearCents: cents('year'), trialDays: trial }, invalid };
}

export function draftToValue(d: PricingDraft) {
    return d.model === 'free'
        ? { model: 'free' as const }
        : d.model === 'one_time'
            ? { model: 'one_time' as const, oneTimeCents: d.oneTimeCents }
            : { model: 'subscription' as const, ...(d.monthCents > 0 ? { monthCents: d.monthCents } : {}), ...(d.yearCents > 0 ? { yearCents: d.yearCents } : {}), trialDays: d.trialDays };
}

/** Precio: gratis / pago unico / suscripcion (mensual y/o anual, prueba 0-30 dias) con el reparto y el neto estimado. */
export function PricingPanel({
    form, onChange, limits, developerBps, trialMaxDays = 30, activeSubscribers = 0, paypalLinked, onSave, saving, saved, disabled,
}: {
    form: PriceForm; onChange: (f: PriceForm) => void; limits: { minPriceCents: number; maxPriceCents: number }; developerBps: number; trialMaxDays?: number;
    activeSubscribers?: number; paypalLinked: boolean; onSave?: () => void; saving?: boolean; saved?: boolean; disabled?: boolean;
}) {
    const { t, locale } = useI18n();
    const money = useMoney();
    const uid = React.useId();
    const { draft, invalid } = toDraft(form);
    const issues = validatePricing(draft, limits, trialMaxDays);
    const net = estimateNet(draft, developerBps);
    const sep = locale.startsWith('en') ? '.' : ',';
    const devPct = isBps(developerBps) ? bpsToPercentText(developerBps, sep) : '—';
    const platPct = isBps(developerBps) ? bpsToPercentText(10_000 - developerBps, sep) : '—';
    const hint = t('admin.console.developer.pricing.priceHint', { min: money(limits.minPriceCents), max: money(limits.maxPriceCents) });
    const err = (field: string): string | null => {
        const has = (k: string) => invalid.has(k as never);
        if (field === 'trialDays' && has('trialDays')) return t('admin.console.developer.pricing.err.trial', { max: trialMaxDays });
        const issue = issues.find((i) => i.field === field);
        if (field === 'oneTimeCents' && has('oneTime')) return t('admin.console.developer.pricing.err.invalid');
        if (field === 'monthCents' && has('month')) return t('admin.console.developer.pricing.err.invalid');
        if (field === 'yearCents' && has('year')) return t('admin.console.developer.pricing.err.invalid');
        if (!issue) return null;
        if (issue.code === 'min') return t('admin.console.developer.pricing.err.min', { min: money(limits.minPriceCents) });
        if (issue.code === 'max') return t('admin.console.developer.pricing.err.max', { max: money(limits.maxPriceCents) });
        if (issue.code === 'trial') return t('admin.console.developer.pricing.err.trial', { max: trialMaxDays });
        return null;
    };
    const plansErr = issues.some((i) => i.field === 'plans') ? t('admin.console.developer.pricing.err.required') : null;
    const set = (patch: Partial<PriceForm>) => onChange({ ...form, ...patch });
    const paid = form.model !== 'free';

    return (
        <Card title={t('admin.console.developer.pricing.title')}>
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('admin.console.developer.pricing.model')} htmlFor={`${uid}-model`}>
                    <select id={`${uid}-model`} className={selectClass} value={form.model} disabled={disabled} onChange={(e) => set({ model: e.target.value as PriceForm['model'] })}>
                        <option value="free">{t('admin.console.developer.pricing.models.free')}</option>
                        <option value="one_time">{t('admin.console.developer.pricing.models.one_time')}</option>
                        <option value="subscription">{t('admin.console.developer.pricing.models.subscription')}</option>
                    </select>
                </Field>
                {form.model === 'one_time' && (
                    <Field label={t('admin.console.developer.pricing.oneTime')} htmlFor={`${uid}-one`} hint={hint} error={err('oneTimeCents')}>
                        <input id={`${uid}-one`} inputMode="decimal" className={inputClass} value={form.oneTime} disabled={disabled} aria-invalid={!!err('oneTimeCents') || undefined} aria-describedby={`${uid}-one-${err('oneTimeCents') ? 'err' : 'hint'}`} onChange={(e) => set({ oneTime: e.target.value })} />
                    </Field>
                )}
                {form.model === 'subscription' && (
                    <>
                        <Field label={t('admin.console.developer.pricing.month')} htmlFor={`${uid}-month`} hint={hint} error={err('monthCents')}>
                            <input id={`${uid}-month`} inputMode="decimal" className={inputClass} value={form.month} disabled={disabled} aria-invalid={!!err('monthCents') || undefined} aria-describedby={`${uid}-month-${err('monthCents') ? 'err' : 'hint'}`} onChange={(e) => set({ month: e.target.value })} />
                        </Field>
                        <Field label={t('admin.console.developer.pricing.year')} htmlFor={`${uid}-year`} hint={hint} error={err('yearCents')}>
                            <input id={`${uid}-year`} inputMode="decimal" className={inputClass} value={form.year} disabled={disabled} aria-invalid={!!err('yearCents') || undefined} aria-describedby={`${uid}-year-${err('yearCents') ? 'err' : 'hint'}`} onChange={(e) => set({ year: e.target.value })} />
                        </Field>
                        <Field label={t('admin.console.developer.pricing.trial')} htmlFor={`${uid}-trial`} hint={t('admin.console.developer.pricing.trialHint', { max: trialMaxDays })} error={err('trialDays')}>
                            <input id={`${uid}-trial`} type="number" min={0} max={trialMaxDays} step={1} className={inputClass} value={form.trialDays} disabled={disabled} aria-invalid={!!err('trialDays') || undefined} aria-describedby={`${uid}-trial-${err('trialDays') ? 'err' : 'hint'}`} onChange={(e) => set({ trialDays: e.target.value })} />
                        </Field>
                        <p className="text-xs text-muted-foreground sm:col-span-2">{t('admin.console.developer.pricing.plansHint')}</p>
                        {plansErr && <p role="alert" className="text-xs text-destructive sm:col-span-2">{plansErr}</p>}
                    </>
                )}
            </div>

            {paid && (
                <div className="mt-5 space-y-3" aria-live="polite">
                    <h3 className="text-sm font-semibold text-foreground">{t('admin.console.developer.pricing.splitTitle')}</h3>
                    <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`${t('admin.console.developer.pricing.developerShare', { pct: devPct })}, ${t('admin.console.developer.pricing.platformShare', { pct: platPct })}`}>
                        <div className="h-full bg-primary" style={{ width: `${isBps(developerBps) ? developerBps / 100 : 0}%` }} />
                    </div>
                    <p className="text-sm text-muted-foreground">{t('admin.console.developer.pricing.developerShare', { pct: devPct })} · {t('admin.console.developer.pricing.platformShare', { pct: platPct })}</p>
                    <h3 className="text-sm font-semibold text-foreground">{t('admin.console.developer.pricing.net')} ({t('admin.console.developer.pricing.perCharge')})</h3>
                    <ul className="space-y-1 text-sm">
                        {net.oneTime && <li>{t('admin.console.developer.pricing.oneTimeNet')}: <strong>{money(net.oneTime.developerCents)}</strong> <span className="text-muted-foreground">/ {money(net.oneTime.grossCents)}</span></li>}
                        {net.month && <li>{t('admin.console.developer.pricing.perMonth')}: <strong>{money(net.month.developerCents)}</strong> <span className="text-muted-foreground">/ {money(net.month.grossCents)}</span></li>}
                        {net.year && <li>{t('admin.console.developer.pricing.perYear')}: <strong>{money(net.year.developerCents)}</strong> <span className="text-muted-foreground">/ {money(net.year.grossCents)}</span></li>}
                        {!net.oneTime && !net.month && !net.year && <li className="text-muted-foreground">—</li>}
                    </ul>
                    {(net.annualMonthlyPlan !== null || net.annualYearlyPlan !== null) && (
                        <div>
                            <h3 className="text-sm font-semibold text-foreground">{t('admin.console.developer.pricing.annualProjection')}</h3>
                            <ul className="mt-1 space-y-1 text-sm">
                                {net.annualMonthlyPlan !== null && <li>{t('admin.console.developer.pricing.annualFromMonthly')}: <strong>{money(net.annualMonthlyPlan)}</strong></li>}
                                {net.annualYearlyPlan !== null && <li>{t('admin.console.developer.pricing.annualFromYearly')}: <strong>{money(net.annualYearlyPlan)}</strong></li>}
                            </ul>
                        </div>
                    )}
                    <p className="text-xs text-muted-foreground">{t('admin.console.developer.pricing.estimateNote')}</p>
                    {!paypalLinked && <p role="status" className="text-sm text-warning">{t('admin.console.developer.pricing.paypalNeeded')}</p>}
                    {activeSubscribers > 0 && <p className="text-sm text-muted-foreground">{t('admin.console.developer.pricing.activeSubscribers', { count: activeSubscribers })}</p>}
                </div>
            )}
            {onSave && (
                <div className="mt-4 flex items-center gap-3">
                    <button type="button" className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" onClick={onSave} disabled={saving || disabled || issues.length > 0 || invalid.size > 0 || (paid && !paypalLinked)} aria-busy={saving || undefined}>
                        {t('admin.console.developer.pricing.save')}
                    </button>
                    {saved && <span role="status" className="text-sm text-success">{t('admin.console.developer.pricing.saved')}</span>}
                </div>
            )}
        </Card>
    );
}
