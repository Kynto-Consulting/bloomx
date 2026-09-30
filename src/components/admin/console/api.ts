'use client';

import useSWR, { type SWRConfiguration } from 'swr';

/**
 * Cliente de las rutas /api/admin/** para la consola.
 *  - `adminFetch`: JSON in/out, lanza ApiError con status y code (la ruta nunca devuelve secretos ni stacks).
 *  - `useAdminQuery`: lectura con SWR (sin revalidar al enfocar: son listas administrativas, se refrescan a mano).
 *  - `apiErrorKey`: clave i18n (admin.console.common.errors.*) para mostrar el error al admin.
 */

export class ApiError extends Error {
    constructor(public status: number, public code?: string, message?: string) {
        super(message || `HTTP ${status}`);
        this.name = 'ApiError';
    }
}

export interface AdminFetchInit {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    signal?: AbortSignal;
}

export async function adminFetch<T = unknown>(url: string, init: AdminFetchInit = {}): Promise<T> {
    let res: Response;
    try {
        res = await fetch(url, {
            method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
            headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
            body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
            cache: 'no-store',
            credentials: 'same-origin',
            signal: init.signal,
        });
    } catch (error) {
        if ((error as { name?: string })?.name === 'AbortError') throw error;
        throw new ApiError(0, 'network');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, typeof data?.code === 'string' ? data.code : undefined, typeof data?.error === 'string' ? data.error : undefined);
    return data as T;
}

export function apiErrorKey(error: unknown): string {
    const status = error instanceof ApiError ? error.status : -1;
    const base = 'admin.console.common.errors.';
    switch (status) {
        case 0: return base + 'network';
        case 400: return base + 'invalid';
        case 401: return base + 'unauthorized';
        case 403: return base + 'forbidden';
        case 404: return base + 'notFound';
        case 409: return base + 'conflict';
        case 413: return base + 'tooLarge';
        case 429: return base + 'tooMany';
        default: return status >= 500 ? base + 'server' : base + 'generic';
    }
}

const fetcher = <T,>(url: string) => adminFetch<T>(url);

export function useAdminQuery<T = unknown>(url: string | null, config: SWRConfiguration<T, ApiError> = {}) {
    return useSWR<T, ApiError>(url, fetcher as (u: string) => Promise<T>, {
        revalidateOnFocus: false,
        keepPreviousData: true,
        shouldRetryOnError: false,
        ...config,
    });
}

/** ?a=1&b=x solo con los valores definidos (vacios fuera). */
export function buildQuery(params: Record<string, string | number | boolean | null | undefined>): string {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null || v === '' || v === false) continue;
        sp.set(k, String(v));
    }
    const s = sp.toString();
    return s ? `?${s}` : '';
}

/** Descarga un CSV ya generado por el servidor (la ruta responde text/csv con Content-Disposition). */
export async function downloadCsv(url: string, fallbackName: string): Promise<void> {
    const res = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) throw new ApiError(res.status);
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    try {
        const a = document.createElement('a');
        a.href = href;
        a.download = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || fallbackName;
        document.body.appendChild(a);
        a.click();
        a.remove();
    } finally {
        setTimeout(() => URL.revokeObjectURL(href), 1000);
    }
}
