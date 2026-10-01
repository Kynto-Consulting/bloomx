'use client';

import { useCallback, useState } from 'react';
import { ApiError, adminFetch, apiErrorKey } from '@/components/admin/console';
import { useI18n } from '@/components/I18nProvider';
import { normalizedOrders } from '@/lib/admin/extensions-manifest';
import { canActivate, canInstall, canUpdate } from '@/lib/admin/extensions-compat';
import type { ExtensionRow } from '@/lib/admin/extensions-view';

const BACKEND_CODES = new Set([
    'manager_session_required', 'domain_mismatch', 'instance_unavailable', 'PAYMENT_REQUIRED', 'not_installed',
    'extension_not_found', 'backend_unavailable', 'backend_error', 'rate_limited', 'EXTENSION_NOT_ENABLED', 'EXTENSION_INVALID',
    'client_incompatible', 'version_not_found',
]);

/** Clave i18n del error: codigo propio de la seccion si lo hay; si no, los errores comunes de la consola. */
export function extensionErrorKey(error: unknown): string {
    if (error instanceof ApiError && error.code && BACKEND_CODES.has(error.code)) return `admin.console.extensions.errors.${error.code}`;
    return apiErrorKey(error);
}

export type TestResult = { ok: true } | { ok: false; message: string } | { notSupported: string };

const PAYMENT_URL = () => `${(process.env.NEXT_PUBLIC_BACKEND_URL || 'https://backend.bloomx.arubik.dev').replace(/\/+$/, '')}/api/payments/create-preference`;

/** Solo se redirige a https (init_point de Mercado Pago). */
export function safePaymentUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    try {
        const u = new URL(value);
        return u.protocol === 'https:' ? u.toString() : null;
    } catch {
        return null;
    }
}

export interface ExtensionActions {
    busyId: string | null;
    /** Mensaje para la region aria-live (resultado de la ultima accion). */
    live: string;
    error: string | null;
    clearError: () => void;
    install: (row: ExtensionRow) => Promise<boolean>;
    /** Aplica la version del catalogo a una extension instalada (conserva credenciales, ajustes y estado). */
    update: (row: ExtensionRow) => Promise<boolean>;
    uninstall: (row: ExtensionRow) => Promise<boolean>;
    toggle: (row: ExtensionRow, enabled: boolean) => Promise<boolean>;
    /** Politica "obligatoria para todos" del dominio (el usuario no podra desactivarla; el servidor la ejecuta siempre). */
    setMandatory: (row: ExtensionRow, mandatory: boolean) => Promise<boolean>;
    reorder: (orderedIds: string[], movedName: string, position: number) => Promise<boolean>;
    test: (row: ExtensionRow) => Promise<TestResult>;
}

/** Acciones de administracion de extensiones (proxies /api/admin/extensions/**) con estado de ocupado, error y anuncio en vivo. */
export function useExtensionActions(domainId: string | undefined, refresh: () => Promise<void>): ExtensionActions {
    const { t } = useI18n();
    const [busyId, setBusyId] = useState<string | null>(null);
    const [live, setLive] = useState('');
    const [error, setError] = useState<string | null>(null);

    const run = useCallback(
        async (id: string, job: () => Promise<string | null>): Promise<boolean> => {
            setBusyId(id);
            setError(null);
            try {
                const message = await job();
                if (message !== null) setLive(message);
                await refresh();
                return message !== null;
            } catch (e) {
                setError(t(extensionErrorKey(e)));
                return false;
            } finally {
                setBusyId(null);
            }
        },
        [refresh, t],
    );

    const install = useCallback(
        (row: ExtensionRow) =>
            run(row.id, async () => {
                if (!domainId) return null;
                if (!canInstall(row)) throw new ApiError(409, 'client_incompatible');
                if (row.isPaid && !row.installed) {
                    // Pago: igual que la pantalla antigua (create-preference del backend -> init_point de Mercado Pago).
                    let pref: any = null;
                    try {
                        const res = await fetch(PAYMENT_URL(), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ domainId, extensionId: row.id, redirectUrl: window.location.href }),
                        });
                        pref = await res.json().catch(() => null);
                    } catch {
                        pref = null;
                    }
                    const url = safePaymentUrl(pref?.init_point);
                    if (!url) {
                        setError(t('admin.console.extensions.errors.paymentFailed'));
                        return null;
                    }
                    setLive(t('admin.console.extensions.live.redirectingPayment', { name: row.name }));
                    window.location.href = url;
                    return null;
                }
                await adminFetch('/api/admin/extensions/install', { body: { domainId, extensionId: row.id } });
                return row.installed
                    ? t('admin.console.extensions.live.updated', { name: row.name, version: row.version ?? '' })
                    : t('admin.console.extensions.live.installed', { name: row.name });
            }),
        [domainId, run, t],
    );

    const update = useCallback(
        (row: ExtensionRow) =>
            run(row.id, async () => {
                if (!domainId) return null;
                if (!canUpdate(row)) throw new ApiError(409, 'client_incompatible');
                await adminFetch('/api/admin/extensions/update', { body: { domainId, extensionId: row.id } });
                return t('admin.console.extensions.live.updated', { name: row.name, version: row.version ?? '' });
            }),
        [domainId, run, t],
    );

    const uninstall = useCallback(
        (row: ExtensionRow) =>
            run(row.id, async () => {
                if (!domainId) return null;
                await adminFetch('/api/admin/extensions/uninstall', { body: { domainId, extensionId: row.id } });
                return t('admin.console.extensions.live.uninstalled', { name: row.name });
            }),
        [domainId, run, t],
    );

    const toggle = useCallback(
        (row: ExtensionRow, enabled: boolean) =>
            run(row.id, async () => {
                if (!domainId) return null;
                if (enabled && !canActivate(row)) throw new ApiError(409, 'client_incompatible');
                await adminFetch('/api/admin/extensions/toggle', { body: { domainId, extensionId: row.id, enabled } });
                return t(enabled ? 'admin.console.extensions.live.enabled' : 'admin.console.extensions.live.disabled', { name: row.name });
            }),
        [domainId, run, t],
    );

    const setMandatory = useCallback(
        (row: ExtensionRow, mandatory: boolean) =>
            run(row.id, async () => {
                if (!domainId) return null;
                await adminFetch('/api/admin/extensions/mandatory', { body: { domainId, extensionId: row.id, mandatory } });
                return t(mandatory ? 'admin.console.extensions.live.mandatoryOn' : 'admin.console.extensions.live.mandatoryOff', { name: row.name });
            }),
        [domainId, run, t],
    );

    const reorder = useCallback(
        (orderedIds: string[], movedName: string, position: number) =>
            run('order', async () => {
                if (!domainId) return null;
                await adminFetch('/api/admin/extensions/order', { body: { domainId, items: normalizedOrders(orderedIds) } });
                return t('admin.console.extensions.live.reordered', { name: movedName, position, total: orderedIds.length });
            }),
        [domainId, run, t],
    );

    const test = useCallback(async (row: ExtensionRow): Promise<TestResult> => {
        try {
            const data = await adminFetch<{ ok: boolean; message?: string }>('/api/admin/extensions/test', { body: { extensionId: row.id } });
            return data.ok ? { ok: true } : { ok: false, message: data.message || 'failed' };
        } catch (e) {
            if (e instanceof ApiError && e.status === 501) return { notSupported: 'generic' };
            if (e instanceof ApiError && e.status === 429) return { ok: false, message: 'rate_limited' };
            return { ok: false, message: 'failed' };
        }
    }, []);

    return { busyId, live, error, clearError: () => setError(null), install, update, uninstall, toggle, setMandatory, reorder, test };
}
