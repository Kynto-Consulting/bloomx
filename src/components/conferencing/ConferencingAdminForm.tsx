'use client';

import React, { useCallback, useId, useMemo, useState } from 'react';
import { CheckCircle2, FileJson, Loader2, PlugZap, Trash2 } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { cn } from '@/lib/utils';
import { testProviderConnection } from '@/lib/conferencing/client';
import { PROVIDER_INFO, isConferencingError, type ConferencingProviderStatus } from '@/lib/conferencing/types';
import { credentialsHttpErrorKey } from '@/lib/extension-credentials';
import {
    ADMIN_HTTP_ERROR_KEY,
    GOOGLE_IMPERSONATE_KEY,
    GOOGLE_SA_KEY,
    MODES,
    SERVICE_ACCOUNT_ERROR_KEY,
    SERVICE_ACCOUNT_MAX_BYTES,
    ZOOM_S2S_KEYS,
    buildClearPayload,
    buildProviderPayload,
    initialMode,
    isKeyConfigured,
    planWrites,
    validateProviderDraft,
    validateServiceAccountJson,
    type AdminAuthMode,
    type AdminConferencingData,
    type AdminProviderId,
} from '@/lib/conferencing/admin-form';
import { ProviderIcon } from './ProviderIcon';
import { ERROR_KEY, MODE_KEY, SOURCE_KEY, errorPlan, safeConnectHref } from './picker-state';

const ENDPOINT = '/api/admin/extensions/settings';
const ORGANIZER_CONNECT_URL = '/api/auth/google-organizer';
const ORGANIZER_TOKEN_KEYS = ['GOOGLE_ORGANIZER_REFRESH_TOKEN', 'GOOGLE_MEET_ADMIN_REFRESH_TOKEN'];

const FIELD_LABEL_KEY: Record<string, string> = {
    ZOOM_ACCOUNT_ID: 'conferencing.admin.fields.ZOOM_ACCOUNT_ID',
    ZOOM_CLIENT_ID: 'conferencing.admin.fields.ZOOM_CLIENT_ID',
    ZOOM_CLIENT_SECRET: 'conferencing.admin.fields.ZOOM_CLIENT_SECRET',
    GOOGLE_IMPERSONATE_USER: 'conferencing.admin.fields.GOOGLE_IMPERSONATE_USER',
};

const MODE_HELP_KEY: Record<AdminAuthMode, string> = {
    'server-to-server': 'conferencing.admin.modeHelp.serverToServer',
    'user-oauth': 'conferencing.admin.modeHelp.userOauth',
    'service-account': 'conferencing.admin.modeHelp.serviceAccount',
    'google-account': 'conferencing.admin.modeHelp.googleAccount',
};

const FIELD_INPUT =
    'h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';
const BTN =
    'inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';

export interface ConferencingAdminFormProps {
    data: AdminConferencingData;
    /** Estado de los proveedores (modo/fuente activos). Opcional. */
    providers?: ConferencingProviderStatus[];
    /** Se invoca tras guardar/borrar para que el padre recargue el estado. */
    onChanged?: () => void;
    returnTo?: string;
    onNavigate?: (url: string) => void;
}

/** Credenciales de videoconferencia de la instancia: un bloque por proveedor (Zoom y Google Meet). */
export function ConferencingAdminForm({ data, providers, onChanged, returnTo, onNavigate }: ConferencingAdminFormProps) {
    return (
        <div className="space-y-4" data-testid="conferencing-admin-form">
            {(['zoom', 'google-meet'] as const).map((provider) => (
                <ProviderAdminSection
                    key={provider}
                    provider={provider}
                    data={data}
                    status={providers?.find((p) => p.id === provider) ?? null}
                    onChanged={onChanged}
                    returnTo={returnTo}
                    onNavigate={onNavigate}
                />
            ))}
        </div>
    );
}

function ProviderAdminSection({
    provider,
    data,
    status,
    onChanged,
    returnTo,
    onNavigate,
}: {
    provider: AdminProviderId;
    data: AdminConferencingData;
    status: ConferencingProviderStatus | null;
    onChanged?: () => void;
    returnTo?: string;
    onNavigate?: (url: string) => void;
}) {
    const { t } = useI18n();
    const uid = useId();
    const info = PROVIDER_INFO[provider];
    const [mode, setMode] = useState<AdminAuthMode>(() => initialMode(provider, status?.mode));
    const [values, setValues] = useState<Record<string, string>>({});
    const [removals, setRemovals] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [confirmClear, setConfirmClear] = useState(false);
    const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
    const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
    const [fileError, setFileError] = useState<string | null>(null);

    const installed = isProviderInstalled(provider, data);
    const draft = useMemo(() => ({ provider, mode, values, removals }), [provider, mode, values, removals]);
    const errors = useMemo(() => validateProviderDraft(draft), [draft]);
    const errorFor = (key: string) => errors.find((e) => e.key === key)?.error;
    const saCheck = useMemo(() => (values[GOOGLE_SA_KEY] ? validateServiceAccountJson(values[GOOGLE_SA_KEY]) : null), [values]);
    const busy = saving || testing;

    const errorText = (code: string) => {
        if (code === 'invalidEmail') return t('conferencing.admin.errors.invalidEmail');
        if (code === 'empty' || code === 'tooLong' || code === 'control') return t(`conferencing.admin.errors.field.${code}`);
        return t(SERVICE_ACCOUNT_ERROR_KEY[code as keyof typeof SERVICE_ACCOUNT_ERROR_KEY] ?? 'conferencing.admin.errors.generic', { max: SERVICE_ACCOUNT_MAX_BYTES });
    };

    const setValue = (key: string, value: string) => {
        setNote(null);
        setTestResult(null);
        setValues((prev) => ({ ...prev, [key]: value }));
    };
    const toggleRemoval = (key: string) => {
        setNote(null);
        setValues((prev) => ({ ...prev, [key]: '' }));
        setRemovals((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
    };

    const writeAll = useCallback(
        async (credentials: Record<string, string | null>): Promise<boolean> => {
            const writes = planWrites(provider, credentials, data);
            if (writes.length === 0) {
                setNote({ kind: 'error', text: t('conferencing.admin.errors.notInstalled') });
                return false;
            }
            for (const w of writes) {
                let res: Response;
                try {
                    res = await fetch(ENDPOINT, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ domainId: data.domainId, extensionId: w.extensionId, credentials: w.credentials }),
                    });
                } catch {
                    setNote({ kind: 'error', text: t('conferencing.admin.errors.network') });
                    return false;
                }
                if (!res.ok) {
                    const key = ADMIN_HTTP_ERROR_KEY[credentialsHttpErrorKey(res.status)] ?? ADMIN_HTTP_ERROR_KEY.generic;
                    setNote({ kind: 'error', text: t(key) });
                    return false;
                }
            }
            return true;
        },
        [data, provider, t],
    );

    const save = async () => {
        setTestResult(null);
        if (errors.length > 0) {
            setNote({ kind: 'error', text: t('conferencing.admin.fixErrors') });
            return;
        }
        setSaving(true);
        setNote(null);
        const ok = await writeAll(buildProviderPayload(draft));
        setSaving(false);
        if (ok) {
            setValues({});
            setRemovals([]);
            setNote({ kind: 'ok', text: t('conferencing.admin.saved', { provider: info.name }) });
            onChanged?.();
        }
    };

    const clear = async () => {
        setSaving(true);
        setNote(null);
        setTestResult(null);
        const ok = await writeAll(buildClearPayload(provider));
        setSaving(false);
        setConfirmClear(false);
        if (ok) {
            setValues({});
            setRemovals([]);
            setNote({ kind: 'ok', text: t('conferencing.admin.cleared', { provider: info.name }) });
            onChanged?.();
        }
    };

    const runTest = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            const r = await testProviderConnection(provider);
            setTestResult({ ok: true, text: t('conferencing.admin.testOk', { provider: info.name }) + (r.detail ? ` ${r.detail}` : '') });
        } catch (e) {
            const plan = errorPlan(e);
            const code = isConferencingError(e) ? e.code : plan.code;
            setTestResult({ ok: false, text: `${t(ERROR_KEY[plan.code])} (${code})` });
        } finally {
            setTesting(false);
        }
    };

    const onFile = async (file: File | undefined) => {
        setFileError(null);
        if (!file) return;
        if (file.size > SERVICE_ACCOUNT_MAX_BYTES) {
            setFileError(t(SERVICE_ACCOUNT_ERROR_KEY.tooLarge, { max: SERVICE_ACCOUNT_MAX_BYTES }));
            return;
        }
        try {
            setValue(GOOGLE_SA_KEY, await file.text());
        } catch {
            setFileError(t(SERVICE_ACCOUNT_ERROR_KEY.notJson));
        }
    };

    const connectOrganizer = () => {
        const back = returnTo ?? (typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : undefined);
        const href = safeConnectHref(ORGANIZER_CONNECT_URL, back);
        if (!href) return;
        if (onNavigate) onNavigate(href);
        else window.location.assign(href);
    };

    const secretField = (key: string) => {
        const configured = isKeyConfigured(data, provider, key);
        const marked = removals.includes(key);
        const err = errorFor(key);
        const id = `${uid}-${key}`;
        return (
            <div key={key} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                    <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
                        {t(FIELD_LABEL_KEY[key])}
                    </label>
                    {configured && (
                        <span className={cn('inline-flex items-center gap-1 text-xs', marked ? 'text-destructive' : 'text-success')}>
                            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                            {marked ? t('conferencing.admin.willRemove') : t('conferencing.admin.configured')}
                        </span>
                    )}
                </div>
                <div className="flex gap-2">
                    <input
                        id={id}
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        value={values[key] ?? ''}
                        disabled={busy || marked}
                        onChange={(e) => setValue(key, e.target.value)}
                        placeholder={configured ? t('conferencing.admin.keepPlaceholder') : ''}
                        aria-invalid={err ? true : undefined}
                        aria-describedby={err ? `${id}-err` : undefined}
                        className={FIELD_INPUT}
                    />
                    {configured && (
                        <button type="button" onClick={() => toggleRemoval(key)} disabled={busy} aria-pressed={marked} className={BTN}>
                            {marked ? t('conferencing.admin.undoRemove') : t('conferencing.admin.removeValue')}
                        </button>
                    )}
                </div>
                {err && (
                    <p id={`${id}-err`} role="alert" className="text-xs text-destructive">
                        {errorText(err)}
                    </p>
                )}
            </div>
        );
    };

    const saConfigured = isKeyConfigured(data, provider, GOOGLE_SA_KEY);
    const saMarked = removals.includes(GOOGLE_SA_KEY);
    const organizerConnected = ORGANIZER_TOKEN_KEYS.some((k) => isKeyConfigured(data, provider, k));
    const headingId = `${uid}-h`;

    return (
        <section aria-labelledby={headingId} data-provider={provider} className="space-y-3 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
                <ProviderIcon icon={info.icon} className="h-5 w-5 text-primary" />
                <h4 id={headingId} className="text-sm font-semibold">
                    {info.name}
                </h4>
                {status && (
                    <span className="text-xs text-muted-foreground">
                        {status.mode ? `${t(MODE_KEY[status.mode] ?? 'conferencing.mode.unknown')} · ` : ''}
                        {t(SOURCE_KEY[status.source] ?? SOURCE_KEY.none)}
                    </span>
                )}
            </div>

            {!installed && (
                <p role="status" className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-xs text-warning">
                    {t('conferencing.admin.notInstalled', { provider: info.name })}
                </p>
            )}

            <fieldset disabled={!installed || busy} className="space-y-3">
                <legend className="text-xs font-medium text-muted-foreground">{t('conferencing.admin.modeLabel')}</legend>
                <div role="radiogroup" aria-label={t('conferencing.admin.modeLabel')} className="grid gap-2 sm:grid-cols-2">
                    {MODES[provider].map((m) => (
                        <label
                            key={m}
                            className={cn('flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', mode === m ? 'border-primary bg-primary/10' : 'border-border')}
                        >
                            <input
                                type="radio"
                                name={`${uid}-mode`}
                                value={m}
                                checked={mode === m}
                                onChange={() => {
                                    setMode(m);
                                    setNote(null);
                                    setTestResult(null);
                                }}
                                className="mt-0.5 h-4 w-4 accent-primary"
                            />
                            <span>
                                <span className="block font-medium">{t(MODE_KEY[m])}</span>
                                <span className="block text-xs text-muted-foreground">{t(MODE_HELP_KEY[m])}</span>
                            </span>
                        </label>
                    ))}
                </div>

                {provider === 'zoom' && mode === 'server-to-server' && <div className="space-y-3">{ZOOM_S2S_KEYS.map((k) => secretField(k))}</div>}

                {provider === 'google-meet' && mode === 'service-account' && (
                    <div className="space-y-3">
                        <div className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                                <label htmlFor={`${uid}-sa`} className="text-xs font-medium text-muted-foreground">
                                    {t('conferencing.admin.google.sa.label')}
                                </label>
                                {saConfigured && (
                                    <span className={cn('inline-flex items-center gap-1 text-xs', saMarked ? 'text-destructive' : 'text-success')}>
                                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                                        {saMarked ? t('conferencing.admin.willRemove') : t('conferencing.admin.configured')}
                                    </span>
                                )}
                            </div>
                            {saCheck?.ok ? (
                                <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-success/30 bg-success/10 px-2.5 py-2 text-xs">
                                    <FileJson className="h-4 w-4 text-success" aria-hidden="true" />
                                    <span className="flex-1 break-all">
                                        {t('conferencing.admin.google.sa.ready', { email: saCheck.clientEmail, project: saCheck.projectId })}
                                    </span>
                                    <button type="button" onClick={() => setValue(GOOGLE_SA_KEY, '')} className={BTN}>
                                        {t('conferencing.admin.google.sa.change')}
                                    </button>
                                </div>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    <input
                                        id={`${uid}-sa`}
                                        type="password"
                                        autoComplete="off"
                                        spellCheck={false}
                                        value={values[GOOGLE_SA_KEY] ?? ''}
                                        disabled={busy || saMarked}
                                        onChange={(e) => setValue(GOOGLE_SA_KEY, e.target.value)}
                                        onPaste={(e) => {
                                            const text = e.clipboardData?.getData('text');
                                            if (text) {
                                                e.preventDefault();
                                                setValue(GOOGLE_SA_KEY, text);
                                            }
                                        }}
                                        placeholder={saConfigured ? t('conferencing.admin.keepPlaceholder') : t('conferencing.admin.google.sa.placeholder')}
                                        aria-invalid={saCheck && !saCheck.ok ? true : undefined}
                                        aria-describedby={`${uid}-sa-help`}
                                        className={cn(FIELD_INPUT, 'min-w-0 flex-1')}
                                    />
                                    <label className={cn(BTN, 'cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring')}>
                                        <FileJson className="h-3.5 w-3.5" aria-hidden="true" />
                                        {t('conferencing.admin.google.sa.upload')}
                                        <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
                                    </label>
                                    {saConfigured && (
                                        <button type="button" onClick={() => toggleRemoval(GOOGLE_SA_KEY)} aria-pressed={saMarked} className={BTN}>
                                            {saMarked ? t('conferencing.admin.undoRemove') : t('conferencing.admin.removeValue')}
                                        </button>
                                    )}
                                </div>
                            )}
                            <p id={`${uid}-sa-help`} className="text-xs text-muted-foreground">
                                {t('conferencing.admin.google.sa.help', { max: SERVICE_ACCOUNT_MAX_BYTES })}
                            </p>
                            {saCheck && !saCheck.ok && (
                                <p role="alert" className="text-xs text-destructive">
                                    {errorText(saCheck.error)}
                                </p>
                            )}
                            {fileError && (
                                <p role="alert" className="text-xs text-destructive">
                                    {fileError}
                                </p>
                            )}
                        </div>
                        {secretField(GOOGLE_IMPERSONATE_KEY)}
                        <p className="text-xs text-muted-foreground">{t('conferencing.admin.google.impersonateHelp')}</p>
                    </div>
                )}

                {provider === 'google-meet' && mode === 'google-account' && (
                    <div className="space-y-2">
                        <p className={cn('flex items-center gap-1.5 text-xs', organizerConnected ? 'text-success' : 'text-muted-foreground')} role="status">
                            {organizerConnected && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
                            {organizerConnected ? t('conferencing.admin.google.organizerConnected') : t('conferencing.admin.google.organizerMissing')}
                        </p>
                        {data.oauth && data.oauth.googleOrganizer === false && (
                            <p role="status" className="text-xs text-warning">
                                {t('conferencing.admin.google.oauthMissing')}
                            </p>
                        )}
                        <button type="button" onClick={connectOrganizer} className={BTN}>
                            <PlugZap className="h-3.5 w-3.5" aria-hidden="true" />
                            {organizerConnected ? t('conferencing.admin.google.reconnectOrganizer') : t('conferencing.admin.google.connectOrganizer')}
                        </button>
                    </div>
                )}

                {provider === 'zoom' && mode === 'user-oauth' && data.oauth && data.oauth.zoom === false && (
                    <p role="status" className="text-xs text-warning">
                        {t('conferencing.admin.zoom.oauthMissing')}
                    </p>
                )}
            </fieldset>

            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    onClick={save}
                    disabled={!installed || busy}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                    {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                    {saving ? t('common.saving') : t('conferencing.admin.save')}
                </button>
                <button type="button" onClick={runTest} disabled={!installed || busy} className={BTN}>
                    {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <PlugZap className="h-3.5 w-3.5" aria-hidden="true" />}
                    {testing ? t('conferencing.admin.testing') : t('conferencing.admin.test')}
                </button>
                {!confirmClear ? (
                    <button type="button" onClick={() => setConfirmClear(true)} disabled={!installed || busy} className={cn(BTN, 'text-destructive')}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('conferencing.admin.clear')}
                    </button>
                ) : (
                    <span role="group" aria-label={t('conferencing.admin.clearConfirm', { provider: info.name })} className="inline-flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-xs">
                        <span>{t('conferencing.admin.clearConfirm', { provider: info.name })}</span>
                        <button type="button" onClick={clear} disabled={busy} className="rounded-md bg-destructive px-2 py-1 font-semibold text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
                            {t('conferencing.admin.clearYes')}
                        </button>
                        <button type="button" onClick={() => setConfirmClear(false)} className={BTN}>
                            {t('conferencing.picker.removeNo')}
                        </button>
                    </span>
                )}
            </div>

            <div aria-live="polite" className="space-y-1">
                {note && (
                    <p role={note.kind === 'error' ? 'alert' : 'status'} data-testid="admin-note" className={cn('rounded-md border px-2.5 py-2 text-xs', note.kind === 'error' ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-success/30 bg-success/10 text-success')}>
                        {note.text}
                    </p>
                )}
                {testResult && (
                    <p role={testResult.ok ? 'status' : 'alert'} data-testid="admin-test-result" className={cn('rounded-md border px-2.5 py-2 text-xs', testResult.ok ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/30 bg-destructive/10 text-destructive')}>
                        {testResult.text}
                    </p>
                )}
            </div>
        </section>
    );
}

function isProviderInstalled(provider: AdminProviderId, data: AdminConferencingData): boolean {
    // core-zoom para Zoom; core-google-meet para Google (core-calendar es opcional).
    return data.extensions[provider === 'zoom' ? 'core-zoom' : 'core-google-meet']?.installed === true;
}
