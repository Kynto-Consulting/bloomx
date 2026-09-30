'use client';

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Loader2, Video } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { cn } from '@/lib/utils';
import { createMeeting, deleteMeeting, newIdempotencyKey } from '@/lib/conferencing/client';
import type { ConferencingProviderId, ConferencingProviderStatus } from '@/lib/conferencing/types';
import { MeetingCard } from './MeetingCard';
import { CustomLinkInput } from './CustomLinkInput';
import { ProviderList } from './ProviderList';
import { useConferencingProviders } from './useConferencingProviders';
import { copyToClipboard } from './clipboard';
import {
    buildCreateInput,
    canDeleteRemote,
    contextSignature,
    createIdempotencyKeeper,
    defaultProviderId,
    errorPlan,
    orderProviders,
    providerState,
    remainingSeconds,
    resolveConnectHref,
    type ErrorPlan,
    type PickerContext,
    type PickerMeeting,
} from './picker-state';

export type { PickerContext, PickerMeeting } from './picker-state';

/** Evento global que abre Ajustes en la pestana indicada (lo escucha la barra lateral). */
export const OPEN_SETTINGS_EVENT = 'bloomx:open-settings';

export function openIntegrationsSettings() {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { tab: 'integrations' } }));
}

export interface ConferencingPickerProps {
    value: PickerMeeting | null;
    onChange: (meeting: PickerMeeting | null) => void;
    context: PickerContext;
    /** Ruta interna a la que vuelve el OAuth (por defecto, la pagina actual). */
    returnTo?: string;
    allowed?: ConferencingProviderId[];
    allowCustom?: boolean;
    compact?: boolean;
    disabled?: boolean;
    /** Sustituye a window.location.assign (pruebas / integraciones). */
    onNavigate?: (url: string) => void;
    /** Sustituye a la apertura de Ajustes -> Integraciones. */
    onOpenSettings?: () => void;
}

export function ConferencingPicker({
    value,
    onChange,
    context,
    returnTo,
    allowed,
    allowCustom = false,
    compact = false,
    disabled = false,
    onNavigate,
    onOpenSettings,
}: ConferencingPickerProps) {
    const { t } = useI18n();
    const uid = useId();
    const { providers: rawProviders, loading, error: loadError, refresh } = useConferencingProviders();
    const providers = useMemo(() => orderProviders(rawProviders, { allowed, allowCustom }), [rawProviders, allowed, allowCustom]);

    const [selectedId, setSelectedId] = useState<ConferencingProviderId | null>(null);
    const [creating, setCreating] = useState(false);
    const [plan, setPlan] = useState<ErrorPlan | null>(null);
    const [waitUntil, setWaitUntil] = useState<number | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const [announce, setAnnounce] = useState('');
    const [copied, setCopied] = useState(false);
    const [confirmingRemove, setConfirmingRemove] = useState(false);
    const [removeBusy, setRemoveBusy] = useState(false);

    const keeper = useRef(createIdempotencyKeeper(newIdempotencyKey));
    const mounted = useRef(true);
    const abort = useRef<AbortController | null>(null);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            abort.current?.abort();
        };
    }, []);

    // Proveedor seleccionado: el de la reunion actual o el primero listo; se corrige si desaparece de la lista.
    useEffect(() => {
        if (providers.length === 0) return;
        if (selectedId && providers.some((p) => p.id === selectedId)) return;
        setSelectedId(defaultProviderId(providers, value?.provider));
    }, [providers, selectedId, value?.provider]);

    // Cuenta atras de "demasiadas peticiones".
    useEffect(() => {
        if (waitUntil === null) return;
        const timer = window.setInterval(() => {
            const current = Date.now();
            setNow(current);
            if (current >= waitUntil) {
                window.clearInterval(timer);
                setWaitUntil(null);
                setAnnounce(t('conferencing.picker.waitReady'));
            }
        }, 1000);
        return () => window.clearInterval(timer);
    }, [waitUntil, t]);

    const waitLeft = waitUntil === null ? 0 : remainingSeconds(waitUntil, now);
    const selected: ConferencingProviderStatus | null = providers.find((p) => p.id === selectedId) ?? null;

    const navigate = useCallback(
        (url: string) => {
            if (onNavigate) onNavigate(url);
            else window.location.assign(url);
        },
        [onNavigate],
    );

    const connect = useCallback(
        (status: ConferencingProviderStatus | null, providerId?: ConferencingProviderId) => {
            const info = status?.connect;
            const current = typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : undefined;
            const back = returnTo ?? current;
            if (info?.type === 'settings') {
                (onOpenSettings ?? openIntegrationsSettings)();
                return;
            }
            const href = resolveConnectHref(status, providerId, back);
            if (!href) {
                setPlan(errorPlan({ name: 'ConferencingError', code: 'unavailable' }));
                return;
            }
            navigate(href);
        },
        [navigate, onOpenSettings, returnTo],
    );

    const create = useCallback(
        async (providerId: ConferencingProviderId) => {
            if (providerId === 'custom' || creating) return;
            const status = providers.find((p) => p.id === providerId);
            const name = status?.name ?? providerId;
            // Misma clave mientras no cambien proveedor ni contexto: un reintento no duplica la reunion.
            const key = keeper.current.keyFor(contextSignature(providerId, context));
            const controller = new AbortController();
            abort.current = controller;
            setCreating(true);
            setPlan(null);
            setWaitUntil(null);
            setAnnounce(t('conferencing.picker.creating', { provider: name }));
            try {
                const meeting = await createMeeting(providerId, buildCreateInput(context, t('conferencing.picker.defaultTopic')), {
                    idempotencyKey: key,
                    signal: controller.signal,
                });
                if (!mounted.current) return;
                keeper.current.renew();
                setAnnounce(t('conferencing.picker.created', { provider: meeting.providerName || name }));
                onChange(meeting);
            } catch (e) {
                if (!mounted.current || (e as { name?: string })?.name === 'AbortError') return;
                const next = errorPlan(e);
                setPlan(next);
                setAnnounce(t(next.messageKey));
                if (next.action === 'wait' && next.waitSeconds) {
                    const current = Date.now();
                    setNow(current);
                    setWaitUntil(current + next.waitSeconds * 1000);
                }
            } finally {
                if (mounted.current) setCreating(false);
            }
        },
        [context, creating, onChange, providers, t],
    );

    const doCopy = async () => {
        if (!value) return;
        const ok = await copyToClipboard(value.joinUrl);
        if (!mounted.current) return;
        setCopied(ok);
        setAnnounce(ok ? t('conferencing.picker.copied') : t('conferencing.picker.copyFailed'));
        if (ok) window.setTimeout(() => mounted.current && setCopied(false), 2500);
    };

    const removeRemote = async () => {
        if (value && canDeleteRemote(value)) {
            try {
                await deleteMeeting(value.provider, value.meetingId);
            } catch {
                /* mejor esfuerzo: el enlace se quita igualmente */
            }
        }
    };

    const confirmRemove = async () => {
        setRemoveBusy(true);
        await removeRemote();
        if (!mounted.current) return;
        setRemoveBusy(false);
        setConfirmingRemove(false);
        setPlan(null);
        keeper.current.renew();
        setAnnounce(t('conferencing.picker.removed'));
        onChange(null);
    };

    const regenerate = async () => {
        if (!value || value.provider === 'custom') return;
        const providerId = value.provider;
        setRemoveBusy(true);
        await removeRemote();
        if (!mounted.current) return;
        setRemoveBusy(false);
        keeper.current.renew();
        onChange(null);
        await create(providerId);
    };

    const retryPlanAction = () => {
        if (!plan) return;
        if (plan.action === 'connect' || plan.action === 'reconnect') connect(selected, selectedId ?? undefined);
        else if (selectedId) void create(selectedId);
    };

    // -------------------------------------------------------------------- render
    const liveRegion = (
        <div aria-live="polite" role="status" className="sr-only" data-testid="conferencing-live">
            {announce}
        </div>
    );

    if (value) {
        return (
            <div className={cn('space-y-2', compact && 'text-sm')} data-testid="conferencing-picker">
                <MeetingCard
                    meeting={value}
                    disabled={disabled}
                    busy={removeBusy || creating}
                    copied={copied}
                    confirmingRemove={confirmingRemove}
                    canRegenerate={value.provider !== 'custom'}
                    compact={compact}
                    onCopy={doCopy}
                    onRegenerate={regenerate}
                    onAskRemove={() => setConfirmingRemove(true)}
                    onConfirmRemove={confirmRemove}
                    onCancelRemove={() => setConfirmingRemove(false)}
                />
                {plan && <PlanAlert plan={plan} waitLeft={waitLeft} creating={creating} onAction={retryPlanAction} t={t} />}
                {liveRegion}
            </div>
        );
    }

    const selectedState = selected ? providerState(selected) : null;
    const canCreate = Boolean(selected && selectedState === 'ready' && selected.id !== 'custom' && !disabled && !creating && waitLeft === 0);

    return (
        <div className={cn('space-y-2', compact ? 'text-sm' : 'rounded-xl border border-border bg-muted/20 p-3')} data-testid="conferencing-picker">
            {!compact && (
                <div className="flex items-center gap-2 text-sm font-semibold">
                    <Video className="h-4 w-4 text-primary" aria-hidden="true" />
                    <span id={`${uid}-title`}>{t('conferencing.picker.label')}</span>
                </div>
            )}

            {loading && (
                <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    {t('conferencing.picker.loading')}
                </p>
            )}

            {!loading && loadError && (
                <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
                    <span className="flex-1">{t('conferencing.picker.loadError')}</span>
                    <button type="button" onClick={refresh} className="rounded-md border border-destructive/30 px-2 py-1 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {t('conferencing.picker.retry')}
                    </button>
                </div>
            )}

            {!loading && !loadError && providers.length === 0 && <p className="text-xs text-muted-foreground">{t('conferencing.picker.none')}</p>}

            {!loading && providers.length > 0 && (
                <>
                    <ProviderList
                        providers={providers}
                        selectedId={selectedId}
                        onSelect={(id) => {
                            setSelectedId(id);
                            setPlan(null);
                            setWaitUntil(null);
                        }}
                        onConnect={(status) => connect(status, status.id)}
                        disabled={disabled || creating}
                        compact={compact}
                        idPrefix={uid}
                    />

                    {selected && selectedState === 'ready' && selected.id !== 'custom' && (
                        <p className="text-xs text-muted-foreground">{t('conferencing.picker.preview', { provider: selected.name })}</p>
                    )}

                    {selected?.id === 'custom' ? (
                        <CustomLinkInput
                            disabled={disabled}
                            compact={compact}
                            onUse={(meeting) => {
                                setPlan(null);
                                setAnnounce(t('conferencing.picker.created', { provider: meeting.providerName }));
                                onChange(meeting);
                            }}
                        />
                    ) : (
                        <button
                            type="button"
                            onClick={() => selectedId && void create(selectedId)}
                            disabled={!canCreate}
                            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                        >
                            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Video className="h-3.5 w-3.5" aria-hidden="true" />}
                            {creating ? t('conferencing.picker.creating', { provider: selected?.name ?? '' }) : t('conferencing.picker.create')}
                        </button>
                    )}
                </>
            )}

            {plan && <PlanAlert plan={plan} waitLeft={waitLeft} creating={creating} onAction={retryPlanAction} t={t} />}
            {liveRegion}
        </div>
    );
}

function PlanAlert({
    plan,
    waitLeft,
    creating,
    onAction,
    t,
}: {
    plan: ErrorPlan;
    waitLeft: number;
    creating: boolean;
    onAction: () => void;
    t: (key: string, params?: Record<string, string | number>) => string;
}) {
    const message = plan.action === 'wait' && waitLeft > 0 ? t('conferencing.picker.waitSeconds', { n: waitLeft }) : t(plan.messageKey);
    let label: string | null = null;
    let disabled = creating;
    if (plan.action === 'connect') label = t('conferencing.picker.connect');
    else if (plan.action === 'reconnect') label = t('conferencing.picker.reconnect');
    else if (plan.action === 'retry') label = t('conferencing.picker.retry');
    else if (plan.action === 'wait') {
        label = waitLeft > 0 ? t('conferencing.picker.retryIn', { n: waitLeft }) : t('conferencing.picker.retry');
        disabled = disabled || waitLeft > 0;
    }
    return (
        <div role="alert" data-error-code={plan.code} className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
            <span className="flex-1">{message}</span>
            {label && (
                <button
                    type="button"
                    onClick={onAction}
                    disabled={disabled}
                    className="rounded-md border border-destructive/30 bg-background px-2 py-1 font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                    {label}
                </button>
            )}
        </div>
    );
}
