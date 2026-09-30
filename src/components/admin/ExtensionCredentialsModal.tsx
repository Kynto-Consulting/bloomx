'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useI18n } from '@/components/I18nProvider';
import {
    MAX_CREDENTIAL_LENGTH,
    buildCredentialPayload,
    credentialsHttpErrorKey,
    validateDraft,
    type CredentialKeyStatus,
} from '@/lib/extension-credentials';

/**
 * Credenciales por dominio de una extension (admin del dominio).
 *
 * - Los campos vienen del servidor (GET), que los deriva de los ENV_READ del manifest.
 * - Los valores guardados NUNCA llegan al navegador: solo "configurada / sin configurar". Para rotar se escribe el
 *   valor nuevo; para borrar se marca "Eliminar". Nada se envia hasta pulsar "Guardar credenciales".
 * - Accesible: Modal (role=dialog, foco atrapado, Escape), etiquetas, aria-invalid/aria-describedby,
 *   regiones role="status"/role="alert".
 */

export interface ExtensionCredentialsModalProps {
    open: boolean;
    onClose: () => void;
    domainId?: string;
    extension: { id: string; name: string } | null;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

const ENDPOINT = '/api/admin/extensions/settings';

export function ExtensionCredentialsModal({ open, onClose, domainId, extension }: ExtensionCredentialsModalProps) {
    const { t } = useI18n();
    const uid = useId();
    const extensionId = extension?.id;

    const [load, setLoad] = useState<LoadState>('idle');
    const [keys, setKeys] = useState<CredentialKeyStatus[]>([]);
    const [values, setValues] = useState<Record<string, string>>({});
    const [removals, setRemovals] = useState<string[]>([]);
    const [revealed, setRevealed] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [savedNote, setSavedNote] = useState<string | null>(null);
    const [attempted, setAttempted] = useState(false);

    const reset = useCallback(() => {
        setValues({});
        setRemovals([]);
        setRevealed([]);
        setFormError(null);
        setAttempted(false);
    }, []);

    const fetchStatus = useCallback(async (signal?: AbortSignal) => {
        if (!domainId || !extensionId) {
            setLoad('error');
            return;
        }
        setLoad('loading');
        try {
            const query = new URLSearchParams({ domainId, extensionId });
            const res = await fetch(`${ENDPOINT}?${query}`, { cache: 'no-store', signal });
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            setKeys(Array.isArray(data?.keys) ? data.keys.filter((k: any) => k && typeof k.name === 'string') : []);
            setLoad('ready');
        } catch (error: any) {
            if (error?.name === 'AbortError') return;
            setLoad('error');
        }
    }, [domainId, extensionId]);

    useEffect(() => {
        if (!open) return;
        reset();
        setSavedNote(null);
        setKeys([]);
        const controller = new AbortController();
        void fetchStatus(controller.signal);
        return () => controller.abort();
    }, [open, fetchStatus, reset]);

    const fieldErrors = useMemo(() => validateDraft({ values, removals }), [values, removals]);
    const payload = useMemo(() => buildCredentialPayload({ values, removals }), [values, removals]);
    const pendingCount = Object.keys(payload).length;
    const hasErrors = Object.keys(fieldErrors).length > 0;

    const errorText = (code: string) => t(`admin.extensions.credentials.errors.${code}`, { max: MAX_CREDENTIAL_LENGTH });

    const setValue = (name: string, value: string) => {
        setSavedNote(null);
        setFormError(null);
        setValues((prev) => ({ ...prev, [name]: value }));
    };

    const toggle = (list: string[], setList: (next: string[]) => void, name: string) => {
        setSavedNote(null);
        setFormError(null);
        setList(list.includes(name) ? list.filter((n) => n !== name) : [...list, name]);
    };

    const markRemoval = (name: string) => {
        setValues((prev) => ({ ...prev, [name]: '' }));
        toggle(removals, setRemovals, name);
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setAttempted(true);
        setSavedNote(null);
        if (hasErrors) {
            setFormError(t('admin.extensions.credentials.fixErrors'));
            return;
        }
        if (pendingCount === 0) {
            setFormError(t('admin.extensions.credentials.noChanges'));
            return;
        }
        if (!domainId || !extensionId) return;

        setSaving(true);
        setFormError(null);
        try {
            const res = await fetch(ENDPOINT, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ domainId, extensionId, credentials: payload }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setFormError(errorText(credentialsHttpErrorKey(res.status)));
                return;
            }
            setKeys(Array.isArray(data?.keys) ? data.keys : keys);
            reset();
            const message = t('admin.extensions.credentials.saved');
            setSavedNote(message);
            toast.success(message);
        } catch {
            setFormError(errorText('generic'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            open={open && !!extension}
            onClose={saving ? () => { } : onClose}
            panelClassName="w-full max-w-xl rounded-2xl border border-border bg-card shadow-2xl"
        >
            {({ titleId, descriptionId }) => extension && (
                <form onSubmit={handleSubmit} noValidate aria-busy={saving || load === 'loading'}>
                    <div className="flex items-start justify-between gap-3 border-b border-border/60 px-6 py-5">
                        <div className="flex min-w-0 items-start gap-3">
                            <div className="rounded-lg bg-primary/10 p-2.5 text-primary">
                                <KeyRound className="h-5 w-5" aria-hidden="true" />
                            </div>
                            <div className="min-w-0">
                                <h3 id={titleId} className="text-lg font-semibold text-foreground">
                                    {t('admin.extensions.credentials.title', { name: extension.name })}
                                </h3>
                                <p className="mt-0.5 break-all text-xs text-muted-foreground">{extension.id}</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={saving}
                            aria-label={t('common.close')}
                            className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                        >
                            <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                    </div>

                    <div className="max-h-[65vh] space-y-4 overflow-y-auto px-6 py-5">
                        <p id={descriptionId} className="text-sm text-muted-foreground">
                            {t('admin.extensions.credentials.intro')}
                        </p>

                        {load === 'loading' && (
                            <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                {t('admin.extensions.credentials.loading')}
                            </div>
                        )}

                        {load === 'error' && (
                            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                                <span>{t('admin.extensions.credentials.loadFailed')}</span>
                                <button
                                    type="button"
                                    onClick={() => void fetchStatus()}
                                    className="ml-auto rounded-md border border-destructive/40 px-3 py-1 font-medium hover:bg-destructive/10"
                                >
                                    {t('admin.extensions.retry')}
                                </button>
                            </div>
                        )}

                        {load === 'ready' && keys.length === 0 && (
                            <div className="rounded-lg border border-dashed border-input bg-muted/50 p-3 text-sm text-muted-foreground">
                                {t('admin.extensions.credentials.none')}
                            </div>
                        )}

                        {load === 'ready' && keys.length > 0 && (
                            <ul className="space-y-4">
                                {keys.map((key) => {
                                    const inputId = `${uid}-${key.name}`;
                                    const helpId = `${inputId}-help`;
                                    const removing = removals.includes(key.name);
                                    const shown = revealed.includes(key.name);
                                    const typed = values[key.name] ?? '';
                                    const error = fieldErrors[key.name];
                                    const showError = !!error && (attempted || typed.length > 0);
                                    const label = t('admin.extensions.credentials.newValue', { key: key.name });
                                    return (
                                        <li key={key.name} className="rounded-xl border border-border bg-background p-4">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <label htmlFor={inputId} className="font-mono text-sm font-medium text-foreground">
                                                    {key.name}
                                                    <span className="sr-only"> — {label}</span>
                                                </label>
                                                {key.configured && !removing ? (
                                                    <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                                                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                                                        {t('admin.extensions.credentials.configured')}
                                                    </span>
                                                ) : (
                                                    <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                                        {removing ? t('admin.extensions.credentials.willRemove') : t('admin.extensions.credentials.notConfigured')}
                                                    </span>
                                                )}
                                            </div>

                                            {key.configured && !removing && (
                                                <p className="mt-1 font-mono text-xs text-muted-foreground" aria-hidden="true">
                                                    {t('admin.extensions.credentials.storedMasked')}
                                                </p>
                                            )}

                                            <div className="mt-3 flex items-center gap-2">
                                                <input
                                                    id={inputId}
                                                    type={shown ? 'text' : 'password'}
                                                    value={typed}
                                                    disabled={removing || saving}
                                                    onChange={(e) => setValue(key.name, e.target.value)}
                                                    placeholder={key.configured ? t('admin.extensions.credentials.placeholderRotate') : t('admin.extensions.credentials.placeholderNew')}
                                                    autoComplete="off"
                                                    autoCapitalize="off"
                                                    autoCorrect="off"
                                                    spellCheck={false}
                                                    aria-invalid={showError || undefined}
                                                    aria-describedby={helpId}
                                                    className={`min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60 ${showError ? 'border-destructive' : 'border-input'}`}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => toggle(revealed, setRevealed, key.name)}
                                                    aria-pressed={shown}
                                                    aria-label={shown ? t('admin.extensions.credentials.hide', { key: key.name }) : t('admin.extensions.credentials.show', { key: key.name })}
                                                    disabled={removing}
                                                    className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                                                >
                                                    {shown ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                                                </button>
                                                {key.configured && (
                                                    <button
                                                        type="button"
                                                        onClick={() => markRemoval(key.name)}
                                                        disabled={saving}
                                                        aria-label={removing ? t('admin.extensions.credentials.undoRemove', { key: key.name }) : t('admin.extensions.credentials.remove', { key: key.name })}
                                                        className={`rounded-md p-2 disabled:opacity-50 ${removing ? 'text-foreground hover:bg-accent' : 'text-destructive hover:bg-destructive/10'}`}
                                                    >
                                                        {removing ? <RotateCcw className="h-4 w-4" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                                                    </button>
                                                )}
                                            </div>

                                            <p id={helpId} className="mt-1.5 min-h-[1rem] text-xs">
                                                {showError ? (
                                                    <span role="alert" className="text-destructive">{errorText(error!)}</span>
                                                ) : removing ? (
                                                    <span className="text-muted-foreground">{t('admin.extensions.credentials.willRemove')}</span>
                                                ) : typed ? (
                                                    <span className="text-muted-foreground">{t('admin.extensions.credentials.willSet')}</span>
                                                ) : null}
                                            </p>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}

                        <p className="text-xs text-muted-foreground">{t('admin.extensions.uninstallWipes')}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 border-t border-border/60 px-6 py-4">
                        <div className="min-w-0 flex-1 text-sm" aria-live="polite">
                            {formError ? (
                                <span role="alert" className="text-destructive">{formError}</span>
                            ) : savedNote ? (
                                <span role="status" className="text-success">{savedNote}</span>
                            ) : pendingCount > 0 ? (
                                <span className="text-muted-foreground">{t('admin.extensions.credentials.pending', { count: pendingCount })}</span>
                            ) : null}
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={saving}
                            className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                        >
                            {t('common.close')}
                        </button>
                        <button
                            type="submit"
                            disabled={saving || load !== 'ready' || keys.length === 0 || pendingCount === 0}
                            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                        >
                            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                            {saving ? t('admin.extensions.credentials.saving') : t('admin.extensions.credentials.save')}
                        </button>
                    </div>
                </form>
            )}
        </Modal>
    );
}
