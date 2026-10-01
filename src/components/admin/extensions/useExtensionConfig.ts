'use client';

import { useCallback, useState } from 'react';
import { ApiError, notifySessionEnded, useAdminQuery } from '@/components/admin/console';
import type { ConfigData } from '@/lib/admin/extensions-config';
import type { SettingIssue } from '@/lib/expansions/settings-schema';

export const configUrl = (domainId: string, extensionId: string) =>
    `/api/admin/extensions/config?domainId=${encodeURIComponent(domainId)}&extensionId=${encodeURIComponent(extensionId)}`;

export class ConfigRequestError extends ApiError {
    constructor(status: number, message?: string, public issues: SettingIssue[] = []) {
        super(status, undefined, message);
        this.name = 'ConfigRequestError';
    }
}

async function send(method: 'PUT' | 'POST', body: Record<string, unknown>): Promise<ConfigData> {
    let res: Response;
    try {
        res = await fetch('/api/admin/extensions/config', {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            cache: 'no-store',
            credentials: 'same-origin',
        });
    } catch {
        throw new ConfigRequestError(0);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
        if (res.status === 401 || res.status === 403) notifySessionEnded(data);
        throw new ConfigRequestError(res.status, typeof data?.error === 'string' ? data.error : undefined, Array.isArray(data?.errors) ? data.errors : []);
    }
    return data as ConfigData;
}

/**
 * Ajustes por dominio de una extension: lectura (SWR) y mutaciones (guardar, restablecer, importar del entorno).
 * Las mutaciones devuelven la forma del GET y actualizan la cache; un 422 lanza ConfigRequestError con `issues` por ruta.
 */
export function useExtensionConfig(domainId: string | undefined, extensionId: string | undefined, enabled = true) {
    const url = enabled && domainId && extensionId ? configUrl(domainId, extensionId) : null;
    const query = useAdminQuery<ConfigData>(url);
    const [saving, setSaving] = useState(false);
    const { mutate } = query;

    const run = useCallback(async (req: () => Promise<ConfigData>) => {
        setSaving(true);
        try {
            const next = await req();
            await mutate(next, { revalidate: false });
            return next;
        } finally {
            setSaving(false);
        }
    }, [mutate]);

    const save = useCallback((values: Record<string, unknown>, secrets?: Record<string, string | null>) => run(() => send('PUT', {
        domainId, extensionId,
        ...(Object.keys(values).length > 0 ? { values } : {}),
        ...(secrets && Object.keys(secrets).length > 0 ? { secrets } : {}),
    })), [run, domainId, extensionId]);
    const reset = useCallback(() => run(() => send('PUT', { domainId, extensionId, reset: true })), [run, domainId, extensionId]);
    const importEnv = useCallback((keys?: string[]) => run(() => send('POST', { domainId, extensionId, action: 'import-env', ...(keys ? { keys } : {}) })), [run, domainId, extensionId]);

    /** Ejecuta una accion del esquema. Devuelve { ok, result, runLog }; el registro se actualiza en la cache. */
    const runAction = useCallback(async (actionId: string, itemId?: string) => {
        const out = await send('POST', { domainId, extensionId, action: 'run-action', actionId, ...(itemId ? { itemId } : {}) });
        await mutate((current) => (current ? { ...current, runLog: out.runLog } : current), { revalidate: false });
        return out;
    }, [mutate, domainId, extensionId]);

    return {
        data: query.data,
        error: query.error,
        isLoading: query.isLoading,
        retry: () => void mutate(),
        saving,
        save,
        reset,
        importEnv,
        runAction,
    };
}
