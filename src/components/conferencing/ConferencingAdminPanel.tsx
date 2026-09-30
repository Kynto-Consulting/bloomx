'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { parseAdminData, type AdminConferencingData } from '@/lib/conferencing/admin-form';
import type { ConferencingProviderStatus } from '@/lib/conferencing/types';
import { ConferencingAdminForm } from './ConferencingAdminForm';

type PanelState =
    | { kind: 'loading' }
    | { kind: 'hidden' }
    | { kind: 'managerRequired' }
    | { kind: 'error' }
    | { kind: 'ready'; data: AdminConferencingData };

/**
 * Bloque de administracion de la instancia. Carga GET /api/admin/conferencing:
 *  - 401 / 403 sin motivo de manager -> no es admin: no se pinta nada;
 *  - 403 `manager_required` -> es admin pero sin sesion de manager dueno del dominio: muestra el motivo;
 *  - 200 -> <ConferencingAdminForm>. Reutilizable desde el dashboard admin.
 */
export function ConferencingAdminPanel({
    providers,
    onChanged,
    returnTo,
    onNavigate,
}: {
    providers?: ConferencingProviderStatus[];
    onChanged?: () => void;
    returnTo?: string;
    onNavigate?: (url: string) => void;
}) {
    const { t } = useI18n();
    const [state, setState] = useState<PanelState>({ kind: 'loading' });
    const [tick, setTick] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        setState((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
        (async () => {
            try {
                const res = await fetch('/api/admin/conferencing', { cache: 'no-store', signal: controller.signal });
                const body = await res.json().catch(() => ({}));
                if (controller.signal.aborted) return;
                if (res.status === 401) return setState({ kind: 'hidden' });
                if (res.status === 403) return setState(body?.code === 'manager_required' ? { kind: 'managerRequired' } : { kind: 'hidden' });
                if (!res.ok) return setState({ kind: 'error' });
                const data = parseAdminData(body);
                setState(data && data.isAdmin ? { kind: 'ready', data } : { kind: 'hidden' });
            } catch (e) {
                if ((e as { name?: string })?.name === 'AbortError') return;
                setState({ kind: 'error' });
            }
        })();
        return () => controller.abort();
    }, [tick]);

    const changed = useCallback(() => {
        setTick((n) => n + 1);
        onChanged?.();
    }, [onChanged]);

    if (state.kind === 'hidden') return null;
    return (
        <section aria-labelledby="conferencing-admin-title" className="space-y-3">
            <h3 id="conferencing-admin-title" className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {t('conferencing.admin.title')}
            </h3>
            {state.kind === 'loading' && (
                <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    {t('conferencing.admin.loading')}
                </p>
            )}
            {state.kind === 'managerRequired' && (
                <p role="alert" className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    {t('conferencing.admin.managerRequired')}
                </p>
            )}
            {state.kind === 'error' && (
                <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    <span className="flex-1">{t('conferencing.admin.loadError')}</span>
                    <button type="button" onClick={() => setTick((n) => n + 1)} className="rounded-md border border-destructive/30 px-2 py-1 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {t('conferencing.picker.retry')}
                    </button>
                </div>
            )}
            {state.kind === 'ready' && <ConferencingAdminForm data={state.data} providers={providers} onChanged={changed} returnTo={returnTo} onNavigate={onNavigate} />}
        </section>
    );
}
