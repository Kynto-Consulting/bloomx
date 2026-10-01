'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import { Card, Field, btnPrimary, inputClass, useUnsavedChanges } from '@/components/admin/console';
import type { QuotaSet } from '@/lib/ai/types';
import { parseFloatField, parseIntField } from './logic';
import { Notice, Why, type TabProps } from './shared';

const QKEYS: Array<keyof QuotaSet> = ['requestsDay', 'requestsMonth', 'tokensDay', 'tokensMonth'];
const QMAX: Record<keyof QuotaSet, number> = { requestsDay: 1e9, requestsMonth: 1e9, tokensDay: 1e10, tokensMonth: 1e10 };
type QDraft = Record<keyof QuotaSet, string>;
const qd = (q: QuotaSet): QDraft => ({ requestsDay: String(q.requestsDay), requestsMonth: String(q.requestsMonth), tokensDay: String(q.tokensDay), tokensMonth: String(q.tokensMonth) });

export function QuotasTab({ settings, save, caps, reasonFor }: TabProps) {
    const { t } = useI18n();
    const c = settings.config;
    const uid = React.useId();
    const [user, setUser] = React.useState<QDraft>(qd(c.quotas.perUser));
    const [glob, setGlob] = React.useState<QDraft>(qd(c.quotas.global));
    const [lim, setLim] = React.useState({ maxOutputTokens: String(c.limits.maxOutputTokens), maxInputChars: String(c.limits.maxInputChars), maxTemperature: String(c.limits.maxTemperature), timeoutMs: String(c.limits.timeoutMs) });
    const [ret, setRet] = React.useState(String(c.retentionDays));
    const [msg, setMsg] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
    const [busy, setBusy] = React.useState(false);

    const sig = JSON.stringify([c.quotas, c.limits, c.retentionDays, settings.updatedAt]);
    React.useEffect(() => {
        setUser(qd(c.quotas.perUser)); setGlob(qd(c.quotas.global)); setRet(String(c.retentionDays));
        setLim({ maxOutputTokens: String(c.limits.maxOutputTokens), maxInputChars: String(c.limits.maxInputChars), maxTemperature: String(c.limits.maxTemperature), timeoutMs: String(c.limits.timeoutMs) });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sig]);

    const parseQ = (d: QDraft): QuotaSet | null => {
        const o = {} as QuotaSet;
        for (const k of QKEYS) { const n = parseIntField(d[k], 0, QMAX[k]); if (n === null) return null; o[k] = n; }
        return o;
    };
    const qUser = parseQ(user); const qGlob = parseQ(glob);
    const out = parseIntField(lim.maxOutputTokens, 16, 32000); const inp = parseIntField(lim.maxInputChars, 100, 400000);
    const temp = parseFloatField(lim.maxTemperature, 0, 2); const to = parseIntField(lim.timeoutMs, 1000, 120000); const rd = parseIntField(ret, 1, 3650);
    const invalid = !qUser || !qGlob || out === null || inp === null || temp === null || to === null || rd === null;

    const next = invalid ? null : {
        quotas: { perUser: qUser, global: qGlob }, limits: { maxOutputTokens: out, maxInputChars: inp, maxTemperature: temp, timeoutMs: to }, retentionDays: rd,
    };
    const cur = { quotas: c.quotas, limits: c.limits, retentionDays: c.retentionDays };
    const dirty = next !== null && JSON.stringify(next) !== JSON.stringify(cur);
    useUnsavedChanges(dirty);
    const off = !caps.edit || busy;
    const errFor = (raw: string, min: number, max: number) => (parseIntField(raw, min, max) === null ? t('admin.ai.errors.range', { min, max }) : null);

    const onSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!next) return;
        setBusy(true); setMsg(null);
        const err = await save({ config: next });
        setMsg(err ? { kind: 'error', text: err } : { kind: 'ok', text: t('admin.ai.saved') });
        setBusy(false);
    };

    const quotaFields = (scope: 'user' | 'global', d: QDraft, set: (d: QDraft) => void) => (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {QKEYS.map((k) => (
                <Field key={k} label={t(`admin.ai.quotas.${k}`)} htmlFor={`${uid}-${scope}-${k}`} error={errFor(d[k], 0, QMAX[k])}>
                    <input id={`${uid}-${scope}-${k}`} inputMode="numeric" className={inputClass} value={d[k]} disabled={off} onChange={(e) => set({ ...d, [k]: e.target.value })} />
                </Field>
            ))}
        </div>
    );

    return (
        <form onSubmit={(e) => void onSave(e)} className="space-y-4" noValidate>
            <Card title={t('admin.ai.quotas.userTitle')} description={t('admin.ai.quotas.zeroUnlimited')}>{quotaFields('user', user, setUser)}</Card>
            <Card title={t('admin.ai.quotas.globalTitle')} description={t('admin.ai.quotas.zeroUnlimited')}>{quotaFields('global', glob, setGlob)}</Card>
            <Card title={t('admin.ai.quotas.limitsTitle')}>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label={t('admin.ai.quotas.maxOutputTokens')} htmlFor={`${uid}-l1`} error={errFor(lim.maxOutputTokens, 16, 32000)}>
                        <input id={`${uid}-l1`} inputMode="numeric" className={inputClass} value={lim.maxOutputTokens} disabled={off} onChange={(e) => setLim({ ...lim, maxOutputTokens: e.target.value })} />
                    </Field>
                    <Field label={t('admin.ai.quotas.maxInputChars')} htmlFor={`${uid}-l2`} error={errFor(lim.maxInputChars, 100, 400000)}>
                        <input id={`${uid}-l2`} inputMode="numeric" className={inputClass} value={lim.maxInputChars} disabled={off} onChange={(e) => setLim({ ...lim, maxInputChars: e.target.value })} />
                    </Field>
                    <Field label={t('admin.ai.quotas.maxTemperature')} htmlFor={`${uid}-l3`} error={temp === null ? t('admin.ai.errors.range', { min: 0, max: 2 }) : null}>
                        <input id={`${uid}-l3`} inputMode="decimal" className={inputClass} value={lim.maxTemperature} disabled={off} onChange={(e) => setLim({ ...lim, maxTemperature: e.target.value })} />
                    </Field>
                    <Field label={t('admin.ai.quotas.timeoutMs')} htmlFor={`${uid}-l4`} error={errFor(lim.timeoutMs, 1000, 120000)}>
                        <input id={`${uid}-l4`} inputMode="numeric" className={inputClass} value={lim.timeoutMs} disabled={off} onChange={(e) => setLim({ ...lim, timeoutMs: e.target.value })} />
                    </Field>
                    <Field label={t('admin.ai.quotas.retentionDays')} htmlFor={`${uid}-l5`} hint={t('admin.ai.quotas.retentionHint')} error={errFor(ret, 1, 3650)}>
                        <input id={`${uid}-l5`} inputMode="numeric" className={inputClass} value={ret} disabled={off} onChange={(e) => setRet(e.target.value)} />
                    </Field>
                </div>
            </Card>
            <div className="flex flex-wrap items-center gap-3">
                <button type="submit" className={btnPrimary} disabled={off || !dirty}>{t('admin.ai.save')}</button>
                <Notice msg={msg} />
            </div>
            <Why reason={reasonFor('edit')} />
        </form>
    );
}
