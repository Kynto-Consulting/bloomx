/** Llamadas de la interfaz a /api/rules (nunca lanzan: { ok, data, error, status }). */
import type { ApiResult } from '@/lib/labels/client';

async function call<T>(url: string, method: string, body?: unknown): Promise<ApiResult<T>> {
    try {
        const res = await fetch(url, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
        const json = await res.json().catch(() => null);
        if (!res.ok) return { ok: false, error: json?.error, code: json?.code, status: res.status };
        return { ok: true, data: json as T, status: res.status };
    } catch {
        return { ok: false, error: 'network', code: 'network', status: 0 };
    }
}

export interface PreviewSample { id: string; from: string; subject: string; date: string | null; folder: string; state: 'match' | 'unknown' }
export interface PreviewData { limit: number; evaluated: number; matched: number; unknown: number; samples: PreviewSample[]; missingData: boolean }
export interface CountPage { processed: number; matched: number; unknown: number; nextCursor: string | null; done: boolean }
export interface ApplyPage { processed: number; changed: number; matched: number; batchId: string | null; nextCursor: string | null; done: boolean }

export const rulesApi = {
    list: (labelId?: string) => call<any[]>(`/api/rules${labelId ? `?labelId=${encodeURIComponent(labelId)}` : ''}`, 'GET'),
    create: (body: unknown) => call<any>('/api/rules', 'POST', body),
    update: (id: string, body: unknown) => call<any>(`/api/rules/${encodeURIComponent(id)}`, 'PATCH', body),
    remove: (id: string) => call<any>(`/api/rules/${encodeURIComponent(id)}`, 'DELETE'),
    reorder: (order: string[]) => call<any>('/api/rules/reorder', 'POST', { order }),
    preview: (conditions: unknown, limit: 50 | 200) => call<PreviewData>('/api/rules/preview', 'POST', { conditions, limit }),
    countPage: (conditions: unknown, cursor: string | null) => call<CountPage>('/api/rules/preview', 'POST', { conditions, mode: 'count', cursor }),
    applyPage: (body: { ruleId?: string; labelId?: string; cursor?: string | null; batchId?: string | null }) => call<ApplyPage>('/api/rules/apply', 'POST', body),
    undo: (batchId: string) => call<{ restored: number }>(`/api/rules/batches/${encodeURIComponent(batchId)}/undo`, 'POST'),
    batches: () => call<any[]>('/api/rules/batches', 'GET'),
};
