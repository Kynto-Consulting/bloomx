/**
 * elixir-client.ts — orquestacion (cliente) del envio masivo por lotes, con reanudacion.
 *
 * `runCampaign` envia lotes a `/api/elixir/send`, aplica backoff ante 429/5xx/red, vuelve a encolar las filas
 * `pending` que el servidor no pudo procesar y NO reenvia filas que ya tienen resultado final (reanudacion).
 * Es pura (fetch/sleep inyectables) para poder probarla sin navegador.
 */

import { compileTemplate, LiquidError, type RenderOptions } from './liquid';

export type Row = Record<string, string>;
export type RowStatus = 'sent' | 'skipped' | 'error' | 'unsubscribed';
export interface RowResult { index: number; email: string; status: RowStatus; message?: string; code?: string }

export interface BatchResponse {
    status: number;
    json: {
        results?: RowResult[];
        pending?: number[];
        retryAfterMs?: number;
        paused?: string;
        error?: string;
        code?: string;
        details?: unknown;
    } | null;
    retryAfterMs?: number;
}

export type CampaignStatus = 'done' | 'paused' | 'cancelled' | 'failed';

export interface CampaignState {
    total: number;
    results: Record<number, RowResult>;
    processed: number;
    sent: number;
    errors: number;
    skipped: number;
    unsubscribed: number;
    status: CampaignStatus | 'running';
    message?: string;
}

export interface RunCampaignOptions {
    rows: Row[];
    /** Resultados previos (reanudar): las filas con resultado final no se reenvian. */
    initial?: Record<number, RowResult>;
    /** Reintentar tambien las filas con estado 'error' de una ejecucion anterior. */
    retryErrors?: boolean;
    batchSize?: number;
    buildBody: (items: Array<{ index: number; row: Row }>) => unknown;
    fetchBatch: (body: unknown) => Promise<BatchResponse>;
    onProgress?: (state: CampaignState) => void;
    signal?: { aborted: boolean };
    sleep?: (ms: number) => Promise<void>;
    maxTransientRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    /** Lotes consecutivos sin ningun avance antes de pausar. */
    maxStalledBatches?: number;
}

function summarize(total: number, results: Record<number, RowResult>): Omit<CampaignState, 'status' | 'message'> {
    let sent = 0, errors = 0, skipped = 0, unsubscribed = 0, processed = 0;
    for (const r of Object.values(results)) {
        processed++;
        if (r.status === 'sent') sent++;
        else if (r.status === 'error') errors++;
        else if (r.status === 'skipped') skipped++;
        else if (r.status === 'unsubscribed') unsubscribed++;
    }
    return { total, results, processed, sent, errors, skipped, unsubscribed };
}

const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function runCampaign(opts: RunCampaignOptions): Promise<CampaignState> {
    const {
        rows, batchSize = 25, buildBody, fetchBatch, onProgress, signal,
        sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms)),
        maxTransientRetries = 5, baseDelayMs = 1500, maxDelayMs = 30_000, maxStalledBatches = 5,
    } = opts;
    const results: Record<number, RowResult> = { ...(opts.initial ?? {}) };
    const isFinal = (i: number) => {
        const r = results[i];
        return !!r && !(opts.retryErrors && r.status === 'error');
    };
    const todo: number[] = [];
    for (let i = 0; i < rows.length; i++) if (!isFinal(i)) todo.push(i);
    if (opts.retryErrors) for (const i of todo) if (results[i]?.status === 'error') delete results[i];

    const state = (status: CampaignState['status'], message?: string): CampaignState => ({ ...summarize(rows.length, results), status, message });
    const emit = (st: CampaignState) => { onProgress?.(st); return st; };

    let stalled = 0;
    let transient = 0;
    emit(state('running'));

    while (todo.length > 0) {
        if (signal?.aborted) return emit(state('cancelled'));
        const batchIdx = todo.splice(0, batchSize);
        const items = batchIdx.map(index => ({ index, row: rows[index] }));

        let resp: BatchResponse;
        try {
            resp = await fetchBatch(buildBody(items));
        } catch (e) {
            resp = { status: 0, json: { error: (e as Error)?.message || 'Error de red' } };
        }

        if (resp.status === 200 && resp.json) {
            transient = 0;
            const got = resp.json.results ?? [];
            for (const r of got) results[r.index] = r;
            const pend = (resp.json.pending ?? []).filter(i => batchIdx.includes(i) && !results[i]);
            // Cualquier indice del lote que no volvio ni como resultado ni como pendiente se reencola (defensivo).
            const unseen = batchIdx.filter(i => !results[i] && !pend.includes(i));
            const back = [...pend, ...unseen].sort((a, b) => a - b);
            todo.unshift(...back);
            if (resp.json.paused) return emit(state('paused', resp.json.paused === 'quota' ? 'Se alcanzó la cuota horaria de envío. Reanude más tarde.' : 'Pausado por el servidor'));
            if (got.length === 0 && back.length > 0) {
                if (++stalled >= maxStalledBatches) return emit(state('paused', 'El servidor no pudo procesar filas; reanude en unos minutos.'));
            } else stalled = 0;
            emit(state('running'));
            const wait = resp.json.retryAfterMs ?? resp.retryAfterMs;
            if (back.length > 0 && wait) await sleep(Math.min(wait, maxDelayMs * 2));
            continue;
        }

        // Errores fatales: no tiene sentido reintentar.
        if (resp.status === 401 || resp.status === 403) return emit(state('failed', 'Sesión no válida o sin permiso. Inicie sesión y reanude.'));
        if (resp.status >= 400 && resp.status < 500 && !TRANSIENT.has(resp.status)) {
            todo.unshift(...batchIdx);
            return emit(state('failed', resp.json?.error || `Error ${resp.status}`));
        }

        // Transitorio: 0 (red), 408/425/429/5xx.
        todo.unshift(...batchIdx);
        if (++transient > maxTransientRetries) {
            return emit(state('paused', resp.json?.error || 'Sin conexión con el servidor; reanude cuando vuelva.'));
        }
        const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (transient - 1));
        const wait = Math.max(resp.json?.retryAfterMs ?? 0, resp.retryAfterMs ?? 0, backoff);
        if (signal?.aborted) return emit(state('cancelled'));
        await sleep(wait);
    }
    return emit(state('done'));
}

/** Implementacion de `fetchBatch` sobre `fetch` del navegador. */
export function fetchBatchFromApi(url = '/api/elixir/send', fetchImpl: typeof fetch = fetch) {
    return async (body: unknown): Promise<BatchResponse> => {
        const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        let json: BatchResponse['json'] = null;
        try { json = await res.json(); } catch { /* cuerpo no JSON */ }
        const ra = res.headers.get('retry-after');
        const retryAfterMs = ra && Number.isFinite(Number(ra)) ? Number(ra) * 1000 : undefined;
        return { status: res.status, json, retryAfterMs };
    };
}

// ── Pre-vuelo (mismo motor que el servidor) ──────────────────────────────────

export interface PreflightIssue { index: number; field: string; message: string }

/**
 * Renderiza localmente todas las filas con las mismas opciones que el servidor y devuelve los problemas.
 * `fields` son las cadenas Liquid a validar (asunto, cuerpo, remitente...).
 */
export function preflight(
    rows: Row[],
    fields: Record<string, { source: string; autoescape?: boolean }>,
    extraVars: Record<string, string>,
    render: RenderOptions,
    maxIssues = 50,
): { compileError?: { field: string; message: string }; issues: PreflightIssue[]; issueCount: number } {
    const compiled: Record<string, ReturnType<typeof compileTemplate>> = {};
    for (const [name, f] of Object.entries(fields)) {
        if (!f.source.trim()) continue;
        try { compiled[name] = compileTemplate(f.source); }
        catch (e) { return { compileError: { field: name, message: (e as LiquidError).message }, issues: [], issueCount: 0 }; }
    }
    const issues: PreflightIssue[] = [];
    let count = 0;
    rows.forEach((row, index) => {
        const data = { ...extraVars, ...row, unsubscribe_url: 'https://example.invalid/unsubscribe' };
        for (const [name, c] of Object.entries(compiled)) {
            try { c.render(data, { ...render, autoescape: fields[name].autoescape }); }
            catch (e) {
                count++;
                if (issues.length < maxIssues) issues.push({ index, field: name, message: (e as Error).message });
            }
        }
    });
    return { issues, issueCount: count };
}
