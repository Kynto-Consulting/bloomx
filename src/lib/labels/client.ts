/** Llamadas de la interfaz a /api/labels (devuelven { ok, data?, error?, code? }: nunca lanzan). */
export interface ApiResult<T = any> { ok: boolean; data?: T; error?: string; code?: string; status: number }

async function call<T = any>(url: string, method: string, body?: unknown): Promise<ApiResult<T>> {
    try {
        const res = await fetch(url, {
            method,
            headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) return { ok: false, error: json?.error, code: json?.code, status: res.status };
        return { ok: true, data: json as T, status: res.status };
    } catch {
        return { ok: false, error: 'network', code: 'network', status: 0 };
    }
}

export const labelsApi = {
    create: (body: Record<string, unknown>) => call('/api/labels', 'POST', body),
    patch: (id: string, body: Record<string, unknown>) => call(`/api/labels/${encodeURIComponent(id)}`, 'PATCH', body),
    remove: (id: string, children: 'reparent' | 'delete') => call(`/api/labels/${encodeURIComponent(id)}?children=${children}`, 'DELETE'),
    reorder: (items: Array<{ id: string; parentId?: string | null; sortOrder?: number }>) => call('/api/labels/reorder', 'POST', { items }),
    moveEmails: (id: string, ids: string[]) => call(`/api/labels/${encodeURIComponent(id)}/move-emails`, 'POST', { ids }),
};
