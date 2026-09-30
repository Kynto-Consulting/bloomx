'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/I18nProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SpamListEditor } from './SpamListEditor';
import { spamFetch } from './spam-api';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background';
const SECTION = 'space-y-3 rounded-xl border border-border bg-card p-4 text-card-foreground';

export interface SpamSettingsData {
    prefs: { learn: boolean; sensitivity: -1 | 0 | 1 };
    domain: { level: string; allowUserSensitivity: boolean; learningAllowed: boolean; externalEnabled: boolean };
    effectiveThreshold: number | null;
    baseThreshold: number | null;
    model: { spamMessages: number; hamMessages: number; tokens: number; minMessages: number; active: boolean };
}

/** Lee GET/PUT/DELETE /api/spam/settings con tolerancia: cualquier forma inesperada -> null. */
export function parseSettings(raw: any): SpamSettingsData | null {
    if (!raw || typeof raw !== 'object' || !raw.prefs || !raw.domain || !raw.model) return null;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const s = raw.prefs.sensitivity;
    return {
        prefs: { learn: raw.prefs.learn !== false, sensitivity: s === -1 || s === 1 ? s : 0 },
        domain: {
            level: String(raw.domain.level ?? ''),
            allowUserSensitivity: raw.domain.allowUserSensitivity === true,
            learningAllowed: raw.domain.learningAllowed !== false,
            externalEnabled: raw.domain.externalEnabled === true,
        },
        effectiveThreshold: typeof raw.effectiveThreshold === 'number' ? raw.effectiveThreshold : null,
        baseThreshold: typeof raw.baseThreshold === 'number' ? raw.baseThreshold : null,
        model: { spamMessages: n(raw.model.spamMessages), hamMessages: n(raw.model.hamMessages), tokens: n(raw.model.tokens), minMessages: n(raw.model.minMessages), active: raw.model.active === true },
    };
}

/** Ajustes -> Spam: aprendizaje, sensibilidad, estado del modelo con borrado y las tres listas personales. */
export function SpamSettings() {
    const { t } = useI18n();
    const uid = useId();
    const [data, setData] = useState<SpamSettingsData | null>(null);
    const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
    const [confirmClear, setConfirmClear] = useState(false);
    const [clearing, setClearing] = useState(false);

    const load = useCallback(async () => {
        setState('loading');
        const r = await spamFetch('/api/spam/settings');
        const parsed = r.ok ? parseSettings(r.data) : null;
        if (!parsed) { setState('error'); return; }
        setData(parsed);
        setState('ready');
    }, []);
    useEffect(() => { void load(); }, [load]);

    const save = async (patch: { learn?: boolean; sensitivity?: -1 | 0 | 1 }) => {
        setSaving(true);
        setMessage(null);
        const r = await spamFetch('/api/spam/settings', { method: 'PUT', body: patch });
        setSaving(false);
        const parsed = r.ok ? parseSettings(r.data) : null;
        if (!parsed) { setMessage({ kind: 'error', text: t('spamUser.settings.saveFailed') }); return; }
        setData(parsed);
    };

    const clearModel = async () => {
        setClearing(true);
        const r = await spamFetch('/api/spam/settings', { method: 'DELETE' });
        setClearing(false);
        setConfirmClear(false);
        const parsed = r.ok ? parseSettings(r.data) : null;
        if (!parsed) { setMessage({ kind: 'error', text: t('spamUser.settings.saveFailed') }); return; }
        setData(parsed);
        setMessage({ kind: 'ok', text: t('spamUser.settings.clearDone') });
    };

    if (state === 'loading' && !data) return <p role="status" className="text-sm text-muted-foreground">{t('spamUser.settings.loading')}</p>;
    if (!data) {
        return (
            <div role="alert" className="space-y-2 text-sm">
                <p className="text-destructive">{t('spamUser.settings.failed')}</p>
                <button type="button" onClick={() => void load()} className={cn('rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted', FOCUS)}>{t('spamUser.settings.retry')}</button>
            </div>
        );
    }

    const { prefs, domain, model } = data;
    const off = domain.level === 'off';
    const learnLocked = !domain.learningAllowed;
    const sensLocked = off || !domain.allowUserSensitivity;
    const sensReason = off ? t('spamUser.settings.sensitivityLockedOff') : !domain.allowUserSensitivity ? t('spamUser.settings.sensitivityLockedDomain') : '';
    const learnId = `${uid}-learn`;
    const learnDescId = `${uid}-learn-desc`;
    const sensDescId = `${uid}-sens-desc`;
    const trained = model.spamMessages + model.hamMessages;

    return (
        <div className="space-y-5" data-spam-settings>
            <div className="space-y-1">
                <h3 className="text-lg font-medium">{t('spamUser.settings.title')}</h3>
                <p className="text-sm text-muted-foreground">{t('spamUser.settings.intro')}</p>
            </div>

            {message && <p role={message.kind === 'error' ? 'alert' : 'status'} data-spam-message className={cn('text-sm', message.kind === 'error' ? 'text-destructive' : 'text-foreground')}>{message.text}</p>}

            <section aria-labelledby={`${uid}-learn-title`} className={SECTION}>
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                        <h4 id={`${uid}-learn-title`} className="text-base font-semibold">{t('spamUser.settings.learnTitle')}</h4>
                        <p id={learnDescId} className="text-sm text-muted-foreground">{learnLocked ? t('spamUser.settings.learnDisabledByDomain') : t('spamUser.settings.learnHelp')}</p>
                    </div>
                    <button
                        type="button"
                        id={learnId}
                        role="switch"
                        aria-checked={prefs.learn}
                        aria-labelledby={`${uid}-learn-title`}
                        aria-describedby={learnDescId}
                        disabled={learnLocked || saving}
                        onClick={() => void save({ learn: !prefs.learn })}
                        className={cn('relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border transition-colors disabled:opacity-50', prefs.learn ? 'bg-primary' : 'bg-muted', FOCUS)}
                    >
                        <span aria-hidden="true" className={cn('inline-block h-4 w-4 rounded-full bg-background shadow transition-transform', prefs.learn ? 'translate-x-6' : 'translate-x-1')} />
                    </button>
                </div>
            </section>

            <section aria-labelledby={`${uid}-sens-title`} className={SECTION}>
                <h4 id={`${uid}-sens-title`} className="text-base font-semibold">{t('spamUser.settings.sensitivityTitle')}</h4>
                <p className="text-sm text-muted-foreground">{t('spamUser.settings.sensitivityHelp')}</p>
                <fieldset disabled={sensLocked || saving} aria-describedby={sensLocked ? sensDescId : undefined} className="space-y-2">
                    <legend className="sr-only">{t('spamUser.settings.sensitivityLegend')}</legend>
                    {([[-1, 'lenient'], [0, 'same'], [1, 'strict']] as const).map(([value, key]) => (
                        <label key={value} className={cn('flex items-center gap-2 text-sm', sensLocked && 'opacity-60')}>
                            <input
                                type="radio"
                                name={`${uid}-sensitivity`}
                                value={value}
                                checked={prefs.sensitivity === value}
                                onChange={() => void save({ sensitivity: value })}
                                className={FOCUS}
                            />
                            {t(`spamUser.settings.${key}`)}
                        </label>
                    ))}
                </fieldset>
                {sensLocked && <p id={sensDescId} data-sensitivity-locked className="text-sm text-muted-foreground">{sensReason}</p>}
                {!off && data.effectiveThreshold !== null && data.baseThreshold !== null && (
                    <p className="text-xs text-muted-foreground">{t('spamUser.settings.threshold', { threshold: data.effectiveThreshold, base: data.baseThreshold })}</p>
                )}
            </section>

            <section aria-labelledby={`${uid}-model-title`} className={SECTION}>
                <h4 id={`${uid}-model-title`} className="text-base font-semibold">{t('spamUser.settings.modelTitle')}</h4>
                {trained > 0 || model.tokens > 0 ? (
                    <>
                        <p data-model-stats className="text-sm">{t('spamUser.settings.modelStats', { spam: model.spamMessages, ham: model.hamMessages, tokens: model.tokens })}</p>
                        <p className="text-xs text-muted-foreground">{model.active ? t('spamUser.settings.modelActive') : t('spamUser.settings.modelInactive', { min: model.minMessages })}</p>
                    </>
                ) : <p className="text-sm text-muted-foreground">{t('spamUser.settings.modelEmpty')}</p>}
                <button
                    type="button"
                    data-clear-model
                    disabled={trained === 0 && model.tokens === 0}
                    onClick={() => setConfirmClear(true)}
                    className={cn('rounded-md border border-destructive/50 bg-background px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50', FOCUS)}
                >
                    {t('spamUser.settings.clear')}
                </button>
            </section>

            <section aria-labelledby={`${uid}-lists-title`} className="space-y-4">
                <h4 id={`${uid}-lists-title`} className="text-base font-semibold">{t('spamUser.settings.listsTitle')}</h4>
                <SpamListEditor apiBase="/api/spam/lists" kind="block" variant="user" idPrefix={`${uid}-block`} headingLevel={3} />
                <SpamListEditor apiBase="/api/spam/lists" kind="allow" variant="user" idPrefix={`${uid}-allow`} headingLevel={3} />
                {domain.externalEnabled
                    ? <SpamListEditor apiBase="/api/spam/lists" kind="external" variant="user" idPrefix={`${uid}-external`} headingLevel={3} />
                    : <p className="text-sm text-muted-foreground">{t('spamUser.settings.listExternalOff')}</p>}
            </section>

            <ConfirmDialog
                open={confirmClear}
                destructive
                busy={clearing}
                title={t('spamUser.settings.clearTitle')}
                description={t('spamUser.settings.clearBody')}
                confirmLabel={t('spamUser.settings.clearConfirm')}
                cancelLabel={t('spamUser.settings.clearCancel')}
                onConfirm={() => void clearModel()}
                onCancel={() => setConfirmClear(false)}
            />
        </div>
    );
}
