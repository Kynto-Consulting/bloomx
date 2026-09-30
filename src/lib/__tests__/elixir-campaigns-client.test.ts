import { describe, expect, it, vi } from 'vitest';
import { createBackgroundCampaign, ElixirApiError, pollIntervalMs, templatesApi } from '../elixir-campaigns-client';

function res(status: number, body: unknown): Response {
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const input = { name: 'n', subject: 's', template: 't', recipientColumn: 'email', senderConfig: {} };
const camp = (status = 'draft') => ({ id: 'ecp_1', status, total: 0 });

describe('createBackgroundCampaign', () => {
    it('crea, sube en trozos con indices globales e inicia', async () => {
        const calls: Array<{ url: string; method?: string; body?: any }> = [];
        const f = vi.fn(async (url: string, init?: RequestInit) => {
            calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
            if (url === '/api/elixir/campaigns') return res(201, { campaign: camp() });
            if (url.endsWith('/rows')) return res(200, { received: 1 });
            return res(200, { campaign: camp('running') });
        }) as unknown as typeof fetch;
        const progress: number[] = [];
        const rows = Array.from({ length: 5 }, (_, i) => ({ email: `u${i}@x.com` }));
        const out = await createBackgroundCampaign(input, rows, { fetchImpl: f, chunkSize: 2, onProgress: d => progress.push(d) });
        expect(out.status).toBe('running');
        const uploads = calls.filter(c => c.url.endsWith('/rows'));
        expect(uploads.map(u => u.body.items.map((x: any) => x.index))).toEqual([[0, 1], [2, 3], [4]]);
        expect(progress).toEqual([2, 4, 5]);
        expect(calls.at(-1)).toMatchObject({ method: 'PATCH', body: { action: 'start' } });
    });

    it('si falla una subida borra el borrador y propaga el error de la API', async () => {
        const calls: string[] = [];
        const f = vi.fn(async (url: string, init?: RequestInit) => {
            calls.push(`${init?.method ?? 'GET'} ${url}`);
            if (url === '/api/elixir/campaigns') return res(201, { campaign: camp() });
            if (url.endsWith('/rows')) return res(413, { error: 'Máximo', code: 'limit_reached' });
            return res(200, { success: true });
        }) as unknown as typeof fetch;
        await expect(createBackgroundCampaign(input, [{ email: 'a@x.com' }], { fetchImpl: f })).rejects.toMatchObject({ status: 413, code: 'limit_reached' });
        expect(calls).toContain('DELETE /api/elixir/campaigns/ecp_1');
    });

    it('un 422 de plantilla al crear no sube nada', async () => {
        const f = vi.fn(async () => res(422, { error: 'Error en template', code: 'template_error' })) as unknown as typeof fetch;
        await expect(createBackgroundCampaign(input, [{ email: 'a@x.com' }], { fetchImpl: f })).rejects.toBeInstanceOf(ElixirApiError);
        expect(f).toHaveBeenCalledTimes(1);
    });

    it('abortar detiene la subida y limpia', async () => {
        const signal = { aborted: false };
        const f = vi.fn(async (url: string) => {
            if (url === '/api/elixir/campaigns') return res(201, { campaign: camp() });
            if (url.endsWith('/rows')) { signal.aborted = true; return res(200, {}); }
            return res(200, { success: true });
        }) as unknown as typeof fetch;
        await expect(createBackgroundCampaign(input, [{ email: 'a@x.com' }, { email: 'b@x.com' }], { fetchImpl: f, chunkSize: 1, signal })).rejects.toMatchObject({ code: 'aborted' });
    });
});

describe('templatesApi / polling', () => {
    it('mapea errores de red a status 0', async () => {
        const f = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
        await expect(templatesApi(f).list()).rejects.toMatchObject({ status: 0, code: 'network' });
    });
    it('propaga code 409 duplicate_name', async () => {
        const f = vi.fn(async () => res(409, { error: 'dup', code: 'duplicate_name' })) as unknown as typeof fetch;
        await expect(templatesApi(f).create({ name: 'a', subject: '', body: '', senderConfig: {} })).rejects.toMatchObject({ status: 409, code: 'duplicate_name' });
    });
    it('polling solo mientras corre; mas lento con la pestana oculta', () => {
        expect(pollIntervalMs('running')).toBe(3000);
        expect(pollIntervalMs('running', true)).toBe(15000);
        expect(pollIntervalMs('done')).toBeNull();
        expect(pollIntervalMs('paused')).toBeNull();
        expect(pollIntervalMs(undefined)).toBeNull();
    });
});
