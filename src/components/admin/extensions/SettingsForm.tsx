'use client';

import { useId, useMemo, useState } from 'react';
import { KeyRound } from 'lucide-react';
import {
    Badge, ErrorState, Field, LoadingState, Switch, apiErrorKey, btnDangerOutline, btnOutline, btnPrimary, formatDateTime, inputClass, selectClass,
} from '@/components/admin/console';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useI18n } from '@/components/I18nProvider';
import {
    buildDiff, buildSecrets, changedKeys, describeFieldError, groupFields, initialForm, isLegacySource, listCount, mapServerErrors, secretSummary,
    validateForm, visibleFields, type ActionResult, type FormState, type FormValue, type ObjectItem, type ServerFieldError,
} from '@/lib/admin/extensions-config';
import { isDlpSchema } from '@/lib/admin/dlp-preview';
import type { ExtensionRow } from '@/lib/admin/extensions-view';
import { SETTINGS_LIMITS, localizedText, type SettingField, type SettingsAction } from '@/lib/expansions/settings-schema';
import { ObjectsEditor } from './ObjectsEditor';
import { DlpPreview } from './DlpPreview';
import { ConfigRequestError, useExtensionConfig } from './useExtensionConfig';

type Notice = { kind: 'ok' | 'error'; text: string } | null;
type ActionOutcome = { actionId: string; itemId?: string; label: string; data?: ActionResult; error?: string };

/** Resultado de una accion: estado, codigo HTTP, latencia, mensaje y lista de informe. Nunca incluye secretos. */
function ActionResultView({ outcome }: { outcome: ActionOutcome }) {
    const { t } = useI18n();
    const d = outcome.data;
    return (
        <div role="status" aria-live="polite" data-testid="action-result" className="space-y-1 rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                <span>{outcome.label}</span>
                {d && <Badge tone={d.status === 'ok' ? 'success' : 'danger'}>{d.status === 'ok' ? t('admin.console.extensions.config.actions.ok') : t('admin.console.extensions.config.actions.failed')}</Badge>}
            </p>
            {outcome.error && <p className="text-destructive">{outcome.error}</p>}
            {d && (
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {d.code !== undefined && <li>{t('admin.console.extensions.config.actions.httpCode', { code: d.code })}</li>}
                    {d.latencyMs !== undefined && <li>{t('admin.console.extensions.config.actions.latency', { ms: d.latencyMs })}</li>}
                    {d.message && <li className="break-words text-foreground">{d.message}</li>}
                </ul>
            )}
            {d?.report && d.report.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-foreground">
                    {d.report.map((line, i) => <li key={i} className="break-words">{line}</li>)}
                </ul>
            )}
        </div>
    );
}

export interface SettingsFormProps {
    row: ExtensionRow;
    domainId: string;
    /** Sin sesion de gestor del dominio (o dominio desconocido): el formulario no se puede guardar. */
    readOnly: boolean;
    onGoCredentials: () => void;
}

function defaultText(field: SettingField, locale: string): string | null {
    const d = field.default;
    if (d === undefined || d === null) return null;
    let text: string;
    if (field.type === 'multienum' && Array.isArray(d)) {
        text = d.map((v) => localizedText(field.options?.find((o) => o.value === v)?.label, locale, String(v))).join(', ');
    } else if (field.type === 'enum') {
        text = localizedText(field.options?.find((o) => o.value === d)?.label, locale, String(d));
    } else if (Array.isArray(d)) text = d.join(', ');
    else if (typeof d === 'object') { try { text = JSON.stringify(d); } catch { return null; } } else text = String(d);
    return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

export function SettingsForm({ row, domainId, readOnly, onGoCredentials }: SettingsFormProps) {
    const { t, locale, intlLocale } = useI18n();
    const uid = useId();
    const schema = row.template!.settingsSchema!;
    const config = useExtensionConfig(domainId, row.id, row.installed);
    const data = config.data;

    const editable = !readOnly && row.installed;
    const baseline = useMemo(() => initialForm(schema, data?.values ?? {}), [schema, data?.values]);
    const [draft, setDraft] = useState<FormState | null>(null);
    const form = draft ?? baseline;
    const [serverErrors, setServerErrors] = useState<Record<string, ServerFieldError>>({});
    const [secretErrors, setSecretErrors] = useState<Record<string, string>>({});
    const [actionBusy, setActionBusy] = useState<string | null>(null);
    const [outcome, setOutcome] = useState<ActionOutcome | null>(null);
    const [confirmAction, setConfirmAction] = useState<{ action: SettingsAction; itemId?: string } | null>(null);
    const [notice, setNotice] = useState<Notice>(null);
    const [confirmReset, setConfirmReset] = useState(false);
    const [importing, setImporting] = useState(false);
    const [dialogError, setDialogError] = useState<string | null>(null);

    const sources = data?.sources ?? {};
    const changed = useMemo(() => changedKeys(schema, baseline, form), [schema, baseline, form]);
    const secretsSet = useMemo(() => new Set(data?.secretsSet ?? []), [data?.secretsSet]);
    const errors = useMemo(() => validateForm(schema, form, sources, secretsSet), [schema, form, sources, secretsSet]);
    const visible = useMemo(() => new Set(visibleFields(schema, form).map((f) => f.key)), [schema, form]);
    const blocking = changed.filter((k) => errors[k] && visible.has(k));
    const dirty = changed.length > 0;
    const busy = config.saving || importing;
    const canSave = editable && dirty && blocking.length === 0 && !busy;
    const sections = useMemo(() => groupFields(schema), [schema]);
    const secrets = secretSummary(schema, data?.secrets ?? []);
    const legacyKeys = (data?.envLegacy ?? []).filter((k) => sources[k] && isLegacySource(sources[k]));
    const importable = data?.importable ?? [];

    const setValue = (key: string, value: FormValue) => {
        setDraft({ ...form, [key]: value });
        setNotice(null);
        if (serverErrors[key]) setServerErrors(({ [key]: _drop, ...rest }) => rest);
        if (Object.keys(secretErrors).length) setSecretErrors({});
    };

    const failure = (error: unknown): string => {
        if (error instanceof ConfigRequestError && error.status === 422) {
            const { byKey, bySecret, general } = mapServerErrors(error.issues);
            setServerErrors(byKey);
            setSecretErrors(Object.fromEntries(Object.entries(bySecret).map(([name, e]) => [name, describeFieldError(t, e)])));
            if (general.length > 0 && Object.keys(byKey).length + Object.keys(bySecret).length === 0) return describeFieldError(t, general[0]);
            return t('admin.console.extensions.config.validationFix');
        }
        return t(apiErrorKey(error));
    };

    const save = async () => {
        setNotice(null);
        try {
            const values = buildDiff(schema, baseline, form);
            const secrets = buildSecrets(schema, form);
            if (Object.keys(values).length > 0 || Object.keys(secrets).length > 0) await config.save(values, secrets);
            setDraft(null);
            setServerErrors({});
            setSecretErrors({});
            setNotice({ kind: 'ok', text: t('admin.console.extensions.config.saved') });
        } catch (error) {
            setNotice({ kind: 'error', text: failure(error) });
        }
    };

    const doReset = async () => {
        setDialogError(null);
        try {
            await config.reset();
            setDraft(null);
            setServerErrors({});
            setConfirmReset(false);
            setNotice({ kind: 'ok', text: t('admin.console.extensions.config.resetDone') });
        } catch (error) {
            setDialogError(t(apiErrorKey(error)));
        }
    };

    const execute = async (action: SettingsAction, itemId?: string) => {
        const label = localizedText(action.label, locale, action.id);
        setActionBusy(`${action.id}:${itemId ?? ''}`);
        setOutcome(null);
        try {
            const out = await config.runAction(action.id, itemId);
            setOutcome({ actionId: action.id, itemId, label, data: out.result });
        } catch (error) {
            const status = error instanceof ConfigRequestError ? error.status : -1;
            const text = status === 404 ? t('admin.console.extensions.config.actions.err404')
                : status === 422 ? t('admin.console.extensions.config.actions.err422')
                : status === 429 ? t('admin.console.extensions.config.actions.err429')
                : t(apiErrorKey(error));
            setOutcome({ actionId: action.id, itemId, label, error: text });
        } finally {
            setActionBusy(null);
        }
    };
    const requestAction = (action: SettingsAction, itemId?: string) => {
        if (action.confirm) setConfirmAction({ action, itemId });
        else void execute(action, itemId);
    };
    const globalActions = schema.actions.filter((a) => a.scope === 'global');
    const firstObjects = schema.fields.find((f) => f.type === 'objects')?.key;

    const doImport = async () => {
        setNotice(null);
        setImporting(true);
        try {
            const next = await config.importEnv();
            setDraft(null);
            setNotice({ kind: 'ok', text: t('admin.console.extensions.config.importDone', { count: next.imported?.length ?? 0 }) });
        } catch (error) {
            setNotice({ kind: 'error', text: t(apiErrorKey(error)) });
        } finally {
            setImporting(false);
        }
    };

    const fieldError = (field: SettingField): string | null => {
        if (serverErrors[field.key]) return describeFieldError(t, serverErrors[field.key]);
        const e = errors[field.key];
        if (!e || !changed.includes(field.key)) return null;
        if (e.code === 'itemField' && typeof e.params?.count === 'number') return t('admin.console.extensions.config.objects.fixItems', { count: e.params.count });
        return describeFieldError(t, e);
    };

    const renderControl = (field: SettingField, inputId: string, error: string | null, hasHint: boolean) => {
        const value = form[field.key];
        const disabled = !editable || busy;
        const described = error ? `${inputId}-err` : hasHint ? `${inputId}-hint` : undefined;
        const common = { id: inputId, disabled, 'aria-invalid': error ? true : undefined, 'aria-describedby': described, 'aria-required': field.required || undefined } as const;
        const placeholder = field.placeholder;
        switch (field.type) {
            case 'boolean':
                return null; // se pinta con su propia fila (switch)
            case 'enum':
                return (
                    <select {...common} className={selectClass} value={typeof value === 'string' ? value : ''} onChange={(e) => setValue(field.key, e.target.value)}>
                        <option value="">{t('admin.console.extensions.config.selectPlaceholder')}</option>
                        {(field.options ?? []).map((o) => (
                            <option key={o.value} value={o.value}>{localizedText(o.label, locale, o.value)}</option>
                        ))}
                    </select>
                );
            case 'multiline':
            case 'json':
            case 'list': {
                const text = typeof value === 'string' ? value : '';
                return (
                    <textarea
                        {...common}
                        rows={field.type === 'multiline' ? 4 : 5}
                        value={text}
                        placeholder={placeholder}
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(e) => setValue(field.key, e.target.value)}
                        className={`${inputClass} h-auto py-2 ${field.type === 'multiline' ? '' : 'font-mono'}`}
                    />
                );
            }
            case 'number':
                return (
                    <input
                        {...common}
                        type="number"
                        inputMode={field.integer ? 'numeric' : 'decimal'}
                        min={field.min}
                        max={field.max}
                        step={field.integer ? 1 : 'any'}
                        value={typeof value === 'string' ? value : ''}
                        placeholder={placeholder}
                        autoComplete="off"
                        onChange={(e) => setValue(field.key, e.target.value)}
                        className={inputClass}
                    />
                );
            default:
                return (
                    <input
                        {...common}
                        type="text"
                        value={typeof value === 'string' ? value : ''}
                        placeholder={placeholder}
                        maxLength={field.maxLength ?? SETTINGS_LIMITS.maxStringLength}
                        autoComplete="off"
                        onChange={(e) => setValue(field.key, e.target.value)}
                        className={inputClass}
                    />
                );
        }
    };

    const renderField = (field: SettingField) => {
        const inputId = `${uid}-${field.key}`;
        const label = localizedText(field.label, locale, field.key);
        const description = localizedText(field.description, locale);
        const error = fieldError(field);
        const dflt = defaultText(field, locale);
        const value = form[field.key];
        const legacy = isLegacySource(sources[field.key]);

        const extras: React.ReactNode[] = [];
        if (description) extras.push(<span key="d">{description}</span>);
        if (field.type === 'list') {
            const max = Math.min(field.maxItems ?? SETTINGS_LIMITS.maxListItems, SETTINGS_LIMITS.maxListItems);
            extras.push(<span key="l">{t('admin.console.extensions.config.listHint', { count: listCount(typeof value === 'string' ? value : ''), max })}</span>);
        }
        if (field.type === 'json') extras.push(<span key="j">{t('admin.console.extensions.config.jsonHint')}</span>);
        if (dflt) extras.push(<span key="f">{t('admin.console.extensions.config.defaultValue', { value: dflt })}</span>);
        const hint = extras.length ? <span className="flex flex-col gap-0.5">{extras}</span> : undefined;

        const legacyNote = legacy ? (
            <p key="legacy" className="mt-1 flex flex-wrap items-center gap-2 text-xs text-foreground" data-testid={`legacy-${field.key}`}>
                <Badge tone="warning">{t('admin.console.extensions.config.legacyBadge')}</Badge>
                <span>{t('admin.console.extensions.config.legacyField', { name: field.legacyEnv ? ` (${field.legacyEnv})` : '' })}</span>
            </p>
        ) : null;

        if (field.type === 'boolean') {
            return (
                <div key={field.key} className="space-y-1">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <span id={`${inputId}-label`} className="block text-sm font-medium text-foreground">
                                {label}{field.required && <span aria-hidden="true" className="text-destructive"> *</span>}
                            </span>
                            {(description || dflt) && <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">{[description, dflt ? t('admin.console.extensions.config.defaultValue', { value: dflt }) : ''].filter(Boolean).join(' · ')}</p>}
                        </div>
                        <Switch id={inputId} checked={value === true} label={label} disabled={!editable || busy} onChange={(v) => setValue(field.key, v)} />
                    </div>
                    {legacyNote}
                    {error && <p id={`${inputId}-err`} role="alert" className="text-xs text-destructive">{error}</p>}
                </div>
            );
        }

        if (field.type === 'objects') {
            const items = Array.isArray(value) ? (value as ObjectItem[]) : [];
            return (
                <ObjectsEditor
                    key={field.key}
                    field={field}
                    items={items}
                    initialItems={baseline[field.key]}
                    onChange={(next) => setValue(field.key, next)}
                    secretsSet={secretsSet}
                    editable={editable && !busy}
                    error={error}
                    secretErrors={secretErrors}
                    itemActions={schema.actions.filter((a) => a.scope === 'item' && (a.itemsKey ? a.itemsKey === field.key : field.key === firstObjects))}
                    actionBusy={actionBusy}
                    onRunAction={(action, itemId) => requestAction(action, itemId)}
                    renderResult={(itemId) => (outcome && outcome.itemId === itemId ? <ActionResultView outcome={outcome} /> : null)}
                />
            );
        }

        if (field.type === 'multienum') {
            const selected = Array.isArray(value) ? (value as string[]) : [];
            return (
                <fieldset key={field.key} className="space-y-2" aria-invalid={error ? true : undefined} aria-describedby={error ? `${inputId}-err` : hint ? `${inputId}-hint` : undefined} disabled={!editable || busy}>
                    <legend className="text-sm font-medium text-foreground">
                        {label}{field.required && <span aria-hidden="true" className="text-destructive"> *</span>}
                    </legend>
                    {hint && !error && <div id={`${inputId}-hint`} className="text-xs text-muted-foreground">{hint}</div>}
                    <ul className="space-y-2">
                        {(field.options ?? []).map((o, i) => {
                            const optId = `${inputId}-o${i}`;
                            const checked = selected.includes(o.value);
                            const optDescription = localizedText(o.description, locale);
                            return (
                                <li key={o.value} className="flex items-start gap-2">
                                    <input
                                        id={optId}
                                        type="checkbox"
                                        checked={checked}
                                        aria-describedby={optDescription || o.example ? `${optId}-d` : undefined}
                                        onChange={() => setValue(field.key, checked ? selected.filter((v) => v !== o.value) : [...selected, o.value])}
                                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    />
                                    <div className="min-w-0">
                                        <label htmlFor={optId} className="text-sm text-foreground">{localizedText(o.label, locale, o.value)}</label>
                                        {(optDescription || o.example) && (
                                            <p id={`${optId}-d`} className="text-xs text-muted-foreground">
                                                {optDescription}
                                                {o.example && <> {t('admin.console.extensions.config.optionExample')} <code className="break-all">{o.example}</code></>}
                                            </p>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                    {legacyNote}
                    {error && <p id={`${inputId}-err`} role="alert" className="text-xs text-destructive">{error}</p>}
                </fieldset>
            );
        }

        return (
            <div key={field.key}>
                <Field label={label} htmlFor={inputId} hint={hint} error={error} required={field.required}>
                    {renderControl(field, inputId, error, !!hint)}
                </Field>
                {legacyNote}
            </div>
        );
    };

    const dlp = isDlpSchema(row.id, schema.fields.map((f) => f.key));

    return (
        <div className="space-y-4" data-testid="settings-form">
            <h3 className="text-sm font-semibold text-foreground">{t('admin.console.extensions.config.title')}</h3>
            <p className="text-sm text-muted-foreground">{t('admin.console.extensions.config.intro')}</p>

            {!row.installed ? (
                <p role="note" className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">{t('admin.console.extensions.config.notInstalled')}</p>
            ) : readOnly ? (
                <p role="note" className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">{t('admin.console.extensions.config.readOnly')}</p>
            ) : null}

            {row.installed && config.isLoading && !data ? (
                <LoadingState />
            ) : row.installed && config.error && !data ? (
                <ErrorState message={t(apiErrorKey(config.error))} onRetry={config.retry} />
            ) : (
                <>
                    {legacyKeys.length > 0 && (
                        <div role="note" data-testid="legacy-global" className="space-y-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-foreground">
                            <p>{t('admin.console.extensions.config.legacyGlobal', { count: legacyKeys.length })}</p>
                            {importable.length > 0 && editable && (
                                <div className="space-y-1">
                                    <button type="button" className={btnOutline} disabled={busy} onClick={() => void doImport()}>
                                        {importing ? t('admin.console.extensions.config.importing') : t('admin.console.extensions.config.importButton')}
                                    </button>
                                    <p className="text-xs text-muted-foreground">{t('admin.console.extensions.config.importHelp', { count: importable.length })}</p>
                                </div>
                            )}
                        </div>
                    )}

                    {globalActions.length > 0 && (
                        <div className="space-y-2" data-testid="global-actions">
                            <div className="flex flex-wrap gap-2">
                                {globalActions.map((action) => (
                                    <button key={action.id} type="button" className={btnOutline} disabled={!editable || actionBusy !== null || busy} title={localizedText(action.description, locale) || undefined} onClick={() => requestAction(action)}>
                                        {actionBusy === `${action.id}:` ? t('admin.console.extensions.config.actions.running') : localizedText(action.label, locale, action.id)}
                                    </button>
                                ))}
                            </div>
                            {actionBusy !== null && actionBusy.endsWith(':') && <p role="status" className="text-xs text-muted-foreground">{t('admin.console.extensions.config.actions.running')}</p>}
                            {outcome && !outcome.itemId && <ActionResultView outcome={outcome} />}
                        </div>
                    )}

                    <form
                        className="space-y-5"
                        noValidate
                        onSubmit={(e) => { e.preventDefault(); if (canSave) void save(); }}
                        aria-label={t('admin.console.extensions.config.title')}
                    >
                        {sections.map((section) => (
                            <section key={section.id || 'general'} aria-labelledby={section.label ? `${uid}-g-${section.id}` : undefined} className="space-y-4">
                                {section.label && (
                                    <h4 id={`${uid}-g-${section.id}`} className="border-b border-border/60 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                        {localizedText(section.label, locale)}
                                    </h4>
                                )}
                                {section.fields.filter((f) => visible.has(f.key)).map(renderField)}
                            </section>
                        ))}
                        {schema.fields.some((f) => !f.secret && f.required) && <p className="text-xs text-muted-foreground">{t('admin.console.extensions.config.requiredLegend')}</p>}

                        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                            <button type="submit" className={btnPrimary} disabled={!canSave}>
                                {config.saving ? t('admin.console.extensions.config.saving') : t('admin.console.extensions.config.save')}
                            </button>
                            {editable && (
                                <button type="button" className={btnDangerOutline} disabled={busy} onClick={() => { setDialogError(null); setConfirmReset(true); }}>
                                    {t('admin.console.extensions.config.reset')}
                                </button>
                            )}
                            {editable && dirty && !notice && <span className="text-xs text-muted-foreground">{blocking.length > 0 ? t('admin.console.extensions.config.validationFix') : t('admin.console.extensions.config.unsaved')}</span>}
                        </div>
                        <div role="status" aria-live="polite" className="min-h-5 text-sm">
                            {notice && <span className={notice.kind === 'ok' ? 'text-success' : 'text-destructive'}>{notice.text}</span>}
                        </div>
                    </form>

                    {data?.meta.updatedAt && (
                        <p className="text-xs text-muted-foreground">
                            {t('admin.console.extensions.config.updatedAt', { date: formatDateTime(data.meta.updatedAt, intlLocale) })}
                        </p>
                    )}

                    {secrets.total > 0 && (
                        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-sm" data-testid="secrets-note">
                            <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <p className="min-w-0 flex-1 text-foreground">
                                {t('admin.console.extensions.config.secretsNote', { configured: secrets.configured, total: secrets.total })}{' '}
                                <span className="text-muted-foreground">{t('admin.console.extensions.config.secretsHelp')}</span>
                            </p>
                            {row.hasCredentialKeys && (
                                <button type="button" className={btnOutline} onClick={onGoCredentials}>{t('admin.console.extensions.config.goCredentials')}</button>
                            )}
                        </div>
                    )}

                    {dlp && <DlpPreview form={form} />}
                </>
            )}

            <ConfirmDialog
                open={!!confirmAction}
                title={confirmAction ? localizedText(confirmAction.action.label, locale, confirmAction.action.id) : ''}
                description={confirmAction ? localizedText(confirmAction.action.confirm, locale) : ''}
                confirmLabel={t('admin.console.extensions.config.actions.run')}
                cancelLabel={t('admin.console.extensions.config.cancel')}
                onConfirm={() => { const c = confirmAction; setConfirmAction(null); if (c) void execute(c.action, c.itemId); }}
                onCancel={() => setConfirmAction(null)}
            />

            <ConfirmDialog
                open={confirmReset}
                title={t('admin.console.extensions.config.resetTitle')}
                description={t('admin.console.extensions.config.resetBody')}
                confirmLabel={t('admin.console.extensions.config.resetConfirm')}
                cancelLabel={t('admin.console.extensions.config.cancel')}
                destructive
                busy={config.saving}
                error={dialogError}
                onConfirm={() => void doReset()}
                onCancel={() => setConfirmReset(false)}
            />
        </div>
    );
}
