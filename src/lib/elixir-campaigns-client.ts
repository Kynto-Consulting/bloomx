/**
 * elixir-campaigns-client.ts — cliente (navegador) de las APIs de plantillas y campanas persistentes.
 * `fetch` inyectable para probar sin red. Todas las funciones lanzan `ElixirApiError` con status/code de la API.
 */

import type { CampaignAction, CampaignCounts, CampaignRowStatus, CampaignStatus } from './elixir-campaigns';

export class ElixirApiError extends Error {
    constructor(message: string, readonly status: number, readonly code?: string) {
        super(message);
        this.name = 'ElixirApiError';
    }
}

type FetchLike = typeof fetch;

async function call<T>(fetchImpl: FetchLike, url: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
        res = await fetchImpl(url, {
            ...init,
            headers: init?.body ? { 'Content-Type': 'application/json', ...(init.headers ?? {}) } : init?.headers,
        });
    } catch (e) {
        throw new ElixirApiError((e as Error)?.message || 'Network error', 0, 'network');
    }
    let json: any = null;
    try { json = await res.json(); } catch { /* sin cuerpo */ }
    if (!res.ok) throw new ElixirApiError(json?.error || `HTTP ${res.status}`, res.status, json?.code);
    return json as T;
}

// ── Plantillas ───────────────────────────────────────────────────────────────

export interface SenderConfig { fromName?: string; fromEmail?: string; cc?: string; bcc?: string }
export interface TemplateDto { id: string; name: string; subject: string; body: string; senderConfig: SenderConfig; createdAt: string; updatedAt: string }
export interface TemplateInputDto { name: string; subject: string; body: string; senderConfig: SenderConfig }

export const templatesApi = (f: FetchLike = fetch) => ({
    list: () => call<{ templates: TemplateDto[] }>(f, '/api/elixir/templates').then(r => r.templates),
    create: (input: TemplateInputDto) => call<{ template: TemplateDto }>(f, '/api/elixir/templates', { method: 'POST', body: JSON.stringify(input) }).then(r => r.template),
    update: (id: string, input: TemplateInputDto) => call<{ template: TemplateDto }>(f, `/api/elixir/templates/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }).then(r => r.template),
    remove: (id: string) => call<{ success: boolean }>(f, `/api/elixir/templates/${encodeURIComponent(id)}`, { method: 'DELETE' }),
});

// ── Campanas ─────────────────────────────────────────────────────────────────

export interface CampaignDto {
    id: string;
    name: string;
    status: CampaignStatus;
    subject: string;
    total: number;
    counts: CampaignCounts;
    progress: { total: number; processed: number; remaining: number; percent: number };
    lastError: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface CampaignRowDto {
    idx: number; email: string; status: CampaignRowStatus; attempts: number; message: string | null; code: string | null; sentAt: string | null; updatedAt: string;
}

export interface CreateCampaignInput {
    name: string;
    subject: string;
    template: string;
    recipientColumn: string;
    senderConfig: SenderConfig;
    systemVars?: Record<string, string>;
    timezone?: string;
    autoescape?: boolean;
    strictVariables?: boolean;
    unsubscribeFooter?: boolean;
}

export const campaignsApi = (f: FetchLike = fetch) => ({
    list: (limit = 30, offset = 0) => call<{ campaigns: CampaignDto[]; hasMore: boolean }>(f, `/api/elixir/campaigns?limit=${limit}&offset=${offset}`),
    get: (id: string, opts: { rows?: boolean; status?: CampaignRowStatus | null; limit?: number; offset?: number } = {}) => {
        const p = new URLSearchParams();
        if (opts.rows === false) p.set('rows', '0');
        if (opts.status) p.set('status', opts.status);
        if (opts.limit) p.set('limit', String(opts.limit));
        if (opts.offset) p.set('offset', String(opts.offset));
        const qs = p.toString();
        return call<{ campaign: CampaignDto; rows: CampaignRowDto[] }>(f, `/api/elixir/campaigns/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`);
    },
    action: (id: string, action: CampaignAction) =>
        call<{ campaign: CampaignDto }>(f, `/api/elixir/campaigns/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ action }) }).then(r => r.campaign),
    remove: (id: string) => call<{ success: boolean }>(f, `/api/elixir/campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    tick: (id: string) => call<{ ran: boolean; reason?: string }>(f, `/api/elixir/campaigns/${encodeURIComponent(id)}/tick`, { method: 'POST' }),
});

export const UPLOAD_CHUNK_ROWS = 250;

/**
 * Crea la campana (draft), sube las filas en trozos y la inicia. Si algo falla despues de crearla, intenta
 * borrar el borrador para no dejar basura. Devuelve la campana ya iniciada.
 */
export async function createBackgroundCampaign(
    input: CreateCampaignInput,
    rows: Array<Record<string, string>>,
    opts: { fetchImpl?: FetchLike; chunkSize?: number; onProgress?: (done: number, total: number) => void; signal?: { aborted: boolean } } = {},
): Promise<CampaignDto> {
    const f = opts.fetchImpl ?? fetch;
    const chunk = Math.max(1, opts.chunkSize ?? UPLOAD_CHUNK_ROWS);
    const api = campaignsApi(f);
    const { campaign } = await call<{ campaign: CampaignDto }>(f, '/api/elixir/campaigns', { method: 'POST', body: JSON.stringify(input) });
    try {
        for (let i = 0; i < rows.length; i += chunk) {
            if (opts.signal?.aborted) throw new ElixirApiError('Cancelled', 0, 'aborted');
            const items = rows.slice(i, i + chunk).map((row, j) => ({ index: i + j, row }));
            await call(f, `/api/elixir/campaigns/${encodeURIComponent(campaign.id)}/rows`, { method: 'POST', body: JSON.stringify({ items }) });
            opts.onProgress?.(Math.min(rows.length, i + chunk), rows.length);
        }
        return await api.action(campaign.id, 'start');
    } catch (e) {
        await api.remove(campaign.id).catch(() => undefined);
        throw e;
    }
}

// ── Presentacion (pura) ──────────────────────────────────────────────────────

/** Intervalo de polling: rapido mientras corre, lento en pausa, nulo en estados finales. */
export function pollIntervalMs(status: CampaignStatus | undefined, hidden = false): number | null {
    if (!status) return null;
    const base = status === 'running' ? 3_000 : status === 'draft' ? 5_000 : null;
    if (base === null) return null;
    return hidden ? base * 5 : base;
}

export function isCampaignActive(status: CampaignStatus): boolean {
    return status === 'running';
}
