'use client';

import React from 'react';
import { CheckCircle2, AlertTriangle, Link2Off } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { cn } from '@/lib/utils';
import type { ConferencingProviderId, ConferencingProviderStatus } from '@/lib/conferencing/types';
import { ProviderIcon } from './ProviderIcon';
import { STATE_LABEL_KEY, providerReasonKey, providerState } from './picker-state';

export interface ProviderListProps {
    providers: ConferencingProviderStatus[];
    selectedId: ConferencingProviderId | null;
    onSelect: (id: ConferencingProviderId) => void;
    onConnect: (status: ConferencingProviderStatus) => void;
    disabled?: boolean;
    compact?: boolean;
    idPrefix: string;
}

/** Lista de proveedores con su estado y el boton Conectar / Reconectar cuando hace falta. */
export function ProviderList({ providers, selectedId, onSelect, onConnect, disabled, compact, idPrefix }: ProviderListProps) {
    const { t } = useI18n();
    return (
        <ul role="radiogroup" aria-label={t('conferencing.picker.providersLabel')} className={cn('flex gap-2', compact ? 'flex-wrap' : 'flex-col')}>
            {providers.map((p) => {
                const state = providerState(p);
                const ready = state === 'ready';
                const selected = selectedId === p.id;
                const reasonKey = providerReasonKey(p);
                const reasonId = `${idPrefix}-${p.id}-reason`;
                const needsConnect = state === 'connect' || state === 'reconnect';
                return (
                    <li
                        key={p.id}
                        data-provider={p.id}
                        data-state={state}
                        className={cn(
                            'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-2.5 py-2 text-sm',
                            selected && ready ? 'border-primary bg-primary/10' : 'border-border bg-card',
                            !compact && 'w-full',
                        )}
                    >
                        <button
                            type="button"
                            role="radio"
                            aria-checked={selected && ready}
                            aria-disabled={!ready || disabled || undefined}
                            aria-describedby={reasonKey ? reasonId : undefined}
                            disabled={disabled}
                            onClick={() => ready && onSelect(p.id)}
                            className={cn(
                                'flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                !ready && 'cursor-not-allowed text-muted-foreground',
                            )}
                        >
                            <ProviderIcon icon={p.icon} className="h-4 w-4 shrink-0" />
                            <span className="truncate font-medium">{p.name}</span>
                            <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs', ready ? 'border-success/30 bg-success/10 text-success' : state === 'unavailable' || state === 'admin' ? 'border-border bg-muted/50 text-muted-foreground' : 'border-warning/30 bg-warning/10 text-warning')}>
                                {ready ? <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> : state === 'unavailable' ? <Link2Off className="h-3 w-3" aria-hidden="true" /> : <AlertTriangle className="h-3 w-3" aria-hidden="true" />}
                                {t(STATE_LABEL_KEY[state])}
                            </span>
                        </button>
                        {needsConnect && (
                            <button
                                type="button"
                                onClick={() => onConnect(p)}
                                disabled={disabled}
                                aria-label={t(state === 'reconnect' ? 'conferencing.picker.reconnectProvider' : 'conferencing.picker.connectProvider', { provider: p.name })}
                                className="shrink-0 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                            >
                                {t(state === 'reconnect' ? 'conferencing.picker.reconnect' : 'conferencing.picker.connect')}
                            </button>
                        )}
                        {reasonKey && (
                            <span id={reasonId} className={compact ? 'sr-only' : 'basis-full text-xs text-muted-foreground'}>
                                {t(reasonKey)}
                            </span>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
