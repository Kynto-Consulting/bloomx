import { describe, it, expect, vi } from 'vitest';
import { runCampaign, preflight, type BatchResponse, type RowResult, type Row } from '../elixir-client';

const rows: Row[] = Array.from({ length: 10 }, (_, i) => ({ email: `u${i}@x.com`, n: String(i) }));
const sleepFn = () => vi.fn(async (_ms: number) => {});

/** Servidor falso: procesa todo lo que llega, o lo que le indique `plan`. */
function okServer(seen: number[][] = []) {
    return async (body: unknown): Promise<BatchResponse> => {
        const items = (body as { items: Array<{ index: number; row: Row }> }).items;
        seen.push(items.map(i => i.index));
        const results: RowResult[] = items.map(i => ({ index: i.index, email: i.row.email, status: 'sent' as const }));
        return { status: 200, json: { results, pending: [] } };
    };
}
const buildBody = (items: Array<{ index: number; row: Row }>) => ({ items });

describe('runCampaign', () => {
    it('envia por lotes y termina con done', async () => {
        const seen: number[][] = [];
        const st = await runCampaign({ rows, batchSize: 4, buildBody, fetchBatch: okServer(seen), sleep: sleepFn() });
        expect(st.status).toBe('done');
        expect(seen).toEqual([[0, 1, 2, 3], [4, 5, 6, 7], [8, 9]]);
        expect(st.sent).toBe(10);
        expect(st.processed).toBe(10);
    });

    it('informa progreso tras cada lote', async () => {
        const progress: number[] = [];
        await runCampaign({ rows, batchSize: 5, buildBody, fetchBatch: okServer(), sleep: sleepFn(), onProgress: s => progress.push(s.processed) });
        expect(progress).toEqual([0, 5, 10, 10]);
    });

    it('cuenta estados sent/skipped/error/unsubscribed', async () => {
        const fetchBatch = async (body: unknown): Promise<BatchResponse> => {
            const items = (body as { items: Array<{ index: number; row: Row }> }).items;
            const status = (i: number) => (['sent', 'skipped', 'error', 'unsubscribed'] as const)[i % 4];
            return { status: 200, json: { results: items.map(it => ({ index: it.index, email: it.row.email, status: status(it.index) })) } };
        };
        const st = await runCampaign({ rows: rows.slice(0, 8), buildBody, fetchBatch, sleep: sleepFn() });
        expect(st).toMatchObject({ sent: 2, skipped: 2, errors: 2, unsubscribed: 2, status: 'done' });
    });

    it('reencola las filas pending del servidor y respeta retryAfterMs', async () => {
        const sleep = sleepFn();
        let call = 0;
        const seen: number[][] = [];
        const fetchBatch = async (body: unknown): Promise<BatchResponse> => {
            const items = (body as { items: Array<{ index: number; row: Row }> }).items;
            seen.push(items.map(i => i.index));
            call++;
            if (call === 1) { // procesa solo 2 y deja 2 pendientes por falta de tiempo
                return { status: 200, json: { results: items.slice(0, 2).map(i => ({ index: i.index, email: i.row.email, status: 'sent' as const })), pending: items.slice(2).map(i => i.index), retryAfterMs: 2000 } };
            }
            return okServer()(body);
        };
        const st = await runCampaign({ rows: rows.slice(0, 4), batchSize: 4, buildBody, fetchBatch, sleep });
        expect(st.status).toBe('done');
        expect(seen).toEqual([[0, 1, 2, 3], [2, 3]]);
        expect(sleep).toHaveBeenCalledWith(2000);
        expect(st.sent).toBe(4);
    });

    it('429 del endpoint: backoff exponencial y reintenta el MISMO lote (sin duplicar)', async () => {
        const sleep = sleepFn();
        let call = 0;
        const seen: number[][] = [];
        const fetchBatch = async (body: unknown): Promise<BatchResponse> => {
            const items = (body as { items: Array<{ index: number; row: Row }> }).items;
            seen.push(items.map(i => i.index));
            if (call++ < 2) return { status: 429, json: { error: 'busy' } };
            return okServer()(body);
        };
        const st = await runCampaign({ rows: rows.slice(0, 3), batchSize: 3, buildBody, fetchBatch, sleep, baseDelayMs: 100, maxDelayMs: 1000 });
        expect(st.status).toBe('done');
        expect(seen).toEqual([[0, 1, 2], [0, 1, 2], [0, 1, 2]]);
        expect(sleep.mock.calls.map(c => c[0])).toEqual([100, 200]);
        expect(st.sent).toBe(3);
    });

    it('Retry-After del 429 tiene prioridad si es mayor', async () => {
        const sleep = sleepFn();
        let call = 0;
        const fetchBatch = async (body: unknown): Promise<BatchResponse> => (call++ === 0 ? { status: 429, json: null, retryAfterMs: 7000 } : okServer()(body));
        await runCampaign({ rows: rows.slice(0, 2), buildBody, fetchBatch, sleep, baseDelayMs: 100 });
        expect(sleep.mock.calls[0][0]).toBe(7000);
    });

    it('error de red (excepcion) se reintenta; tras agotar reintentos pausa y conserva el estado', async () => {
        const sleep = sleepFn();
        let call = 0;
        const fetchBatch = async (body: unknown): Promise<BatchResponse> => {
            call++;
            if (call === 1) return okServer()(body); // primer lote OK
            throw new Error('Failed to fetch');
        };
        const st = await runCampaign({ rows, batchSize: 5, buildBody, fetchBatch, sleep, maxTransientRetries: 2, baseDelayMs: 10 });
        expect(st.status).toBe('paused');
        expect(st.sent).toBe(5);
        expect(st.processed).toBe(5);
        expect(sleep).toHaveBeenCalledTimes(2);
    });

    it('REANUDAR: con los resultados previos no reenvia lo ya procesado', async () => {
        const first: number[][] = [];
        let call = 0;
        const flaky = async (body: unknown): Promise<BatchResponse> => (call++ === 0 ? okServer(first)(body) : { status: 503, json: null });
        const paused = await runCampaign({ rows, batchSize: 4, buildBody, fetchBatch: flaky, sleep: sleepFn(), maxTransientRetries: 1, baseDelayMs: 1 });
        expect(paused.status).toBe('paused');
        expect(paused.processed).toBe(4);

        const second: number[][] = [];
        const resumed = await runCampaign({ rows, batchSize: 4, initial: paused.results, buildBody, fetchBatch: okServer(second), sleep: sleepFn() });
        expect(resumed.status).toBe('done');
        expect(second.flat()).toEqual([4, 5, 6, 7, 8, 9]); // 0..3 NO se reenvian
        expect(resumed.sent).toBe(10);
    });

    it('retryErrors reenvia solo las filas con error', async () => {
        const initial: Record<number, RowResult> = {};
        rows.forEach((r, i) => { initial[i] = { index: i, email: r.email, status: i === 3 || i === 7 ? 'error' : 'sent' }; });
        const seen: number[][] = [];
        const st = await runCampaign({ rows, initial, retryErrors: true, buildBody, fetchBatch: okServer(seen), sleep: sleepFn() });
        expect(seen.flat()).toEqual([3, 7]);
        expect(st.errors).toBe(0);
        expect(st.sent).toBe(10);
        // sin retryErrors no se reenvia nada
        const seen2: number[][] = [];
        const st2 = await runCampaign({ rows, initial, buildBody, fetchBatch: okServer(seen2), sleep: sleepFn() });
        expect(seen2).toEqual([]);
        expect(st2.errors).toBe(2);
    });

    it('perdida de respuesta tras enviar: el reintento del mismo lote es seguro (el servidor responde already_sent)', async () => {
        // Simula el caso: 1ª respuesta perdida (red), el servidor ya envió; el 2º intento devuelve sent/already_sent.
        let call = 0;
        const delivered = new Set<number>();
        const fetchBatch = async (body: unknown): Promise<BatchResponse> => {
            const items = (body as { items: Array<{ index: number; row: Row }> }).items;
            const results: RowResult[] = items.map(i => {
                const dup = delivered.has(i.index);
                delivered.add(i.index);
                return { index: i.index, email: i.row.email, status: 'sent', code: dup ? 'already_sent' : undefined };
            });
            if (call++ === 0) throw new Error('network dropped');
            return { status: 200, json: { results } };
        };
        const st = await runCampaign({ rows: rows.slice(0, 3), buildBody, fetchBatch, sleep: sleepFn(), baseDelayMs: 1 });
        expect(st.status).toBe('done');
        expect(st.sent).toBe(3);
        expect([...delivered]).toEqual([0, 1, 2]);
        expect(Object.values(st.results).every(r => r.code === 'already_sent')).toBe(true);
    });

    it('cancelar entre lotes', async () => {
        const signal = { aborted: false };
        const st = await runCampaign({
            rows, batchSize: 3, buildBody, sleep: sleepFn(), signal,
            fetchBatch: async b => { const r = await okServer()(b); signal.aborted = true; return r; },
        });
        expect(st.status).toBe('cancelled');
        expect(st.processed).toBe(3);
    });

    it('401 -> failed; 422 (plantilla) -> failed con el mensaje del servidor; el lote no se marca como procesado', async () => {
        const s1 = await runCampaign({ rows, buildBody, sleep: sleepFn(), fetchBatch: async () => ({ status: 401, json: { error: 'Unauthorized' } }) });
        expect(s1.status).toBe('failed');
        const s2 = await runCampaign({ rows, buildBody, sleep: sleepFn(), fetchBatch: async () => ({ status: 422, json: { error: 'Error en template: bloque sin cerrar', code: 'template_error' } }) });
        expect(s2).toMatchObject({ status: 'failed', message: 'Error en template: bloque sin cerrar', processed: 0 });
    });

    it('cuota agotada (paused: quota) -> pausa con mensaje y las filas siguen pendientes', async () => {
        const fetchBatch = async (body: unknown): Promise<BatchResponse> => {
            const items = (body as { items: Array<{ index: number; row: Row }> }).items;
            return { status: 200, json: { results: [{ index: items[0].index, email: 'a', status: 'sent' }], pending: items.slice(1).map(i => i.index), paused: 'quota', retryAfterMs: 3_600_000 } };
        };
        const st = await runCampaign({ rows, batchSize: 4, buildBody, fetchBatch, sleep: sleepFn() });
        expect(st.status).toBe('paused');
        expect(st.message).toMatch(/cuota/i);
        expect(st.processed).toBe(1);
    });

    it('servidor que nunca avanza (todo pending) -> pausa por estancamiento, sin bucle infinito', async () => {
        const fetchBatch = async (body: unknown): Promise<BatchResponse> => {
            const items = (body as { items: Array<{ index: number; row: Row }> }).items;
            return { status: 200, json: { results: [], pending: items.map(i => i.index), retryAfterMs: 10 } };
        };
        const sleep = sleepFn();
        const st = await runCampaign({ rows: rows.slice(0, 3), buildBody, fetchBatch, sleep, maxStalledBatches: 3 });
        expect(st.status).toBe('paused');
        expect(st.processed).toBe(0);
    });

    it('filas devueltas ni como resultado ni como pending se reencolan (defensivo)', async () => {
        let call = 0;
        const seen: number[][] = [];
        const fetchBatch = async (body: unknown): Promise<BatchResponse> => {
            const items = (body as { items: Array<{ index: number; row: Row }> }).items;
            seen.push(items.map(i => i.index));
            if (call++ === 0) return { status: 200, json: { results: [{ index: items[0].index, email: 'a', status: 'sent' }] } };
            return okServer()(body);
        };
        const st = await runCampaign({ rows: rows.slice(0, 3), batchSize: 3, buildBody, fetchBatch, sleep: sleepFn() });
        expect(seen).toEqual([[0, 1, 2], [1, 2]]);
        expect(st.status).toBe('done');
    });

    it('sin filas', async () => {
        expect((await runCampaign({ rows: [], buildBody, fetchBatch: okServer(), sleep: sleepFn() })).status).toBe('done');
    });
});

describe('preflight', () => {
    const data: Row[] = [{ nombre: 'Ana', email: 'a@x.com' }, { nombre: 'Luis', email: 'l@x.com' }];
    const render = { strictVariables: true, autoescape: undefined };

    it('sin problemas', () => {
        const r = preflight(data, { subject: { source: 'Hola {{ nombre }}' }, body: { source: '<p>{{ nombre }}</p>', autoescape: true } }, {}, render);
        expect(r).toEqual({ issues: [], issueCount: 0 });
    });
    it('error de sintaxis se reporta como compileError (nada que enviar)', () => {
        const r = preflight(data, { body: { source: '{% if nombre %}' } }, {}, render);
        expect(r.compileError?.field).toBe('body');
        expect(r.compileError?.message).toMatch(/if/);
    });
    it('variable inexistente en modo estricto se reporta por fila', () => {
        const r = preflight(data, { subject: { source: 'Hola {{ apellido }}' } }, {}, render);
        expect(r.issueCount).toBe(2);
        expect(r.issues[0]).toMatchObject({ index: 0, field: 'subject' });
    });
    it('variables de sistema y unsubscribe_url estan disponibles', () => {
        const r = preflight(data, { body: { source: '{{ brand_name }} {{ unsubscribe_url }}' } }, { brand_name: 'ACME' }, render);
        expect(r.issueCount).toBe(0);
    });
    it('limita la cantidad de issues devueltos pero cuenta todos', () => {
        const many = Array.from({ length: 100 }, () => ({ nombre: 'x' }));
        const r = preflight(many, { s: { source: '{{ nope }}' } }, {}, render, 10);
        expect(r.issues).toHaveLength(10);
        expect(r.issueCount).toBe(100);
    });
});
