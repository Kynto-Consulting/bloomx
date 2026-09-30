'use client';

import React, { useState } from 'react';
import { Loader2, PlugZap, Unplug } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { cn } from '@/lib/utils';
import { PROVIDER_INFO, type ConferencingProviderId, type ConferencingProviderStatus } from '@/lib/conferencing/types';
import { ProviderIcon } from '@/components/conferencing/ProviderIcon';
import { ConferencingAdminPanel } from '@/components/conferencing/ConferencingAdminPanel';
import { useConferencingProviders } from '@/components/conferencing/useConferencingProviders';
import { MODE_KEY, SOURCE_KEY, STATE_LABEL_KEY, providerReasonKey, providerState, resolveConnectHref } from '@/components/conferencing/picker-state';

const SHOWN: readonly ConferencingProviderId[] = ['zoom', 'google-meet'];

const BTN =
    'inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';

/** Endpoint para desvincular la cuenta del usuario (solo existe para Google). */
const UNLINK_URL: Partial<Record<ConferencingProviderId, string>> = { 'google-meet': '/api/auth/unlink/google', zoom: '/api/auth/unlink/zoom' };

export interface IntegrationsSettingsProps {
    /** Sustituye a window.location.assign (pruebas). */
    onNavigate?: (url: string) => void;
    /** Oculta el bloque de administracion (pruebas / contextos sin admin). */
    hideAdmin?: boolean;
}

/** Ajustes -> Integraciones: estado, fuente y modo de Zoom / Google Meet y (solo admin) credenciales de la instancia. */
export function IntegrationsSettings({ onNavigate, hideAdmin = false }: IntegrationsSettingsProps) {
    const { t } = useI18n();
    const { providers, loading, error, refresh } = useConferencingProviders();
    const visible = SHOWN.map((id) => providers.find((p) => p.id === id)).filter((p): p is ConferencingProviderStatus => Boolean(p));

    return (
        <div className="space-y-8 animate-in fade-in duration-300" data-testid="integrations-settings">
            <section aria-labelledby="integrations-title" className="space-y-3">
                <div>
                    <h3 id="integrations-title" className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('conferencing.settings.title')}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">{t('conferencing.settings.intro')}</p>
                </div>

                {loading && (
                    <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        {t('conferencing.picker.loading')}
                    </p>
                )}
                {!loading && error && (
                    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                        <span className="flex-1">{t('conferencing.picker.loadError')}</span>
                        <button type="button" onClick={refresh} className="rounded-md border border-destructive/30 px-2 py-1 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            {t('conferencing.picker.retry')}
                        </button>
                    </div>
                )}
                {!loading && !error && visible.length === 0 && <p className="text-sm text-muted-foreground">{t('conferencing.picker.none')}</p>}

                <div className="grid gap-3">
                    {visible.map((status) => (
                        <ProviderCard key={status.id} status={status} onNavigate={onNavigate} onChanged={refresh} />
                    ))}
                </div>
            </section>

            {!hideAdmin && <ConferencingAdminPanel providers={providers} onChanged={refresh} onNavigate={onNavigate} />}
        </div>
    );
}

function ProviderCard({ status, onNavigate, onChanged }: { status: ConferencingProviderStatus; onNavigate?: (url: string) => void; onChanged: () => void }) {
    const { t } = useI18n();
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);
    const info = PROVIDER_INFO[status.id];
    const state = providerState(status);
    const reasonKey = providerReasonKey(status);
    const canUnlink = Boolean(UNLINK_URL[status.id]) && status.source === 'user-oauth' && status.connected;
    const href = state === 'connect' || state === 'reconnect' ? resolveConnectHref(status, status.id, '/') : null;
    const managedByOrg = state === 'ready' && (status.source === 'instance' || status.source === 'extension');

    const connect = () => {
        const back = typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : '/';
        const target = resolveConnectHref(status, status.id, back);
        if (!target) return;
        if (onNavigate) onNavigate(target);
        else window.location.assign(target);
    };

    const unlink = async () => {
        const url = UNLINK_URL[status.id];
        if (!url) return;
        setBusy(true);
        setFailed(false);
        try {
            const res = await fetch(url, { method: 'DELETE' });
            if (!res.ok) throw new Error(String(res.status));
            setConfirming(false);
            onChanged();
        } catch {
            setFailed(true);
        } finally {
            setBusy(false);
        }
    };

    return (
        <article data-provider={status.id} data-state={state} aria-label={info.name} className="space-y-2 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
                <ProviderIcon icon={status.icon || info.icon} className="h-5 w-5 text-primary" />
                <h4 className="text-sm font-semibold">{status.name || info.name}</h4>
                <span
                    className={cn(
                        'rounded-full border px-2 py-0.5 text-xs',
                        state === 'ready' ? 'border-success/30 bg-success/10 text-success' : state === 'unavailable' || state === 'admin' ? 'border-border bg-muted/50 text-muted-foreground' : 'border-warning/30 bg-warning/10 text-warning',
                    )}
                >
                    {t(STATE_LABEL_KEY[state])}
                </span>
            </div>

            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                <dt className="text-muted-foreground">{t('conferencing.settings.source')}</dt>
                <dd>{t(SOURCE_KEY[status.source] ?? SOURCE_KEY.none)}</dd>
                <dt className="text-muted-foreground">{t('conferencing.settings.mode')}</dt>
                <dd>{status.mode ? t(MODE_KEY[status.mode] ?? 'conferencing.mode.unknown') : t('conferencing.settings.modeNone')}</dd>
                {status.account && (
                    <>
                        <dt className="text-muted-foreground">{t('conferencing.settings.account')}</dt>
                        <dd className="break-all">{status.account}</dd>
                    </>
                )}
            </dl>

            {reasonKey && <p className="text-xs text-muted-foreground">{t(reasonKey)}</p>}
            {managedByOrg && <p className="text-xs text-muted-foreground">{t('conferencing.settings.managedByOrg')}</p>}

            <div className="flex flex-wrap items-center gap-2">
                {(state === 'connect' || state === 'reconnect') && href && (
                    <button type="button" onClick={connect} className={cn(BTN, 'border-primary/30 bg-primary/10 text-primary')} aria-label={t(state === 'reconnect' ? 'conferencing.picker.reconnectProvider' : 'conferencing.picker.connectProvider', { provider: status.name || info.name })}>
                        <PlugZap className="h-3.5 w-3.5" aria-hidden="true" />
                        {t(state === 'reconnect' ? 'conferencing.picker.reconnect' : 'conferencing.picker.connect')}
                    </button>
                )}
                {canUnlink && !confirming && (
                    <button type="button" onClick={() => setConfirming(true)} className={cn(BTN, 'text-destructive')} aria-label={t('conferencing.settings.disconnectProvider', { provider: status.name || info.name })}>
                        <Unplug className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('conferencing.settings.disconnect')}
                    </button>
                )}
                {canUnlink && confirming && (
                    <span role="group" aria-label={t('conferencing.settings.disconnectConfirm')} className="inline-flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-xs">
                        <span>{t('conferencing.settings.disconnectConfirm')}</span>
                        <button type="button" onClick={unlink} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-destructive px-2 py-1 font-semibold text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
                            {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                            {t('conferencing.settings.disconnectYes')}
                        </button>
                        <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={BTN}>
                            {t('conferencing.picker.removeNo')}
                        </button>
                    </span>
                )}
            </div>
            {failed && (
                <p role="alert" className="text-xs text-destructive">
                    {t('conferencing.settings.disconnectFailed')}
                </p>
            )}
        </article>
    );
}
