import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DraftSaver, toDraftAttachments, isDraftEmpty, type DraftPayload } from '../draft-autosave';

const payload = (over: Partial<DraftPayload> = {}): DraftPayload => ({
    from: 'me@x.com', to: 'a@y.com', cc: '', bcc: '', subject: 'Hola', body: '<p>texto</p>', attachments: [], ...over,
});

type Call = { url: string; method: string; body: any };

function makeFetch(opts: { delayMs?: number; ids?: string[]; status?: (call: Call, n: number) => number } = {}) {
    const calls: Call[] = [];
    let n = 0;
    const ids = opts.ids ?? ['d1', 'd2', 'd3'];
    const impl = vi.fn(async (url: any, init: any = {}) => {
        const call: Call = { url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null };
        calls.push(call);
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
        const status = opts.status ? opts.status(call, n) : 200;
        n++;
        return {
            ok: status >= 200 && status < 300,
            status,
            json: async () => ({ draft: { id: call.body?.id ?? ids[calls.filter((c) => c.method === 'POST').length - 1] ?? 'dX' } }),
        } as any;
    });
    return { impl: impl as unknown as typeof fetch, calls };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('DraftSaver', () => {
    it('debounce: varios cambios seguidos producen un solo guardado', async () => {
        const { impl, calls } = makeFetch();
        const s = new DraftSaver({ fetchImpl: impl, debounceMs: 2000 });
        s.schedule(payload({ body: '<p>a</p>' }));
        s.schedule(payload({ body: '<p>ab</p>' }));
        s.schedule(payload({ body: '<p>abc</p>' }));
        await vi.advanceTimersByTimeAsync(1999);
        expect(calls.length).toBe(0);
        await vi.advanceTimersByTimeAsync(2);
        expect(calls.length).toBe(1);
        expect(calls[0].body.body).toBe('<p>abc</p>');
        expect(s.getDraftId()).toBe('d1');
    });

    it('flush guarda al instante (cierre de ventana) y el segundo guardado reutiliza el id', async () => {
        const { impl, calls } = makeFetch();
        const s = new DraftSaver({ fetchImpl: impl });
        s.schedule(payload());
        await s.flush();
        expect(calls.length).toBe(1);
        s.schedule(payload({ subject: 'Otro' }));
        await s.flush();
        expect(calls.length).toBe(2);
        expect(calls[1].body.id).toBe('d1'); // sin duplicar borradores
    });

    it('guardados en vuelo se serializan: no se crean dos borradores', async () => {
        const { impl, calls } = makeFetch({ delayMs: 500 });
        const s = new DraftSaver({ fetchImpl: impl, debounceMs: 100 });
        s.schedule(payload({ subject: 'uno' }));
        await vi.advanceTimersByTimeAsync(100); // POST 1 en vuelo
        s.schedule(payload({ subject: 'dos' }));
        const flushing = s.flush(); // pide guardar ya, mientras el primero no ha vuelto
        await vi.advanceTimersByTimeAsync(2000);
        await flushing;
        const posts = calls.filter((c) => c.method === 'POST');
        expect(posts.length).toBe(2);
        expect(posts[0].body.id).toBeUndefined();
        expect(posts[1].body.id).toBe('d1');
    });

    it('discard durante un POST en vuelo borra el borrador creado (sin resurreccion tras enviar)', async () => {
        const { impl, calls } = makeFetch({ delayMs: 500 });
        const s = new DraftSaver({ fetchImpl: impl, debounceMs: 10 });
        s.schedule(payload());
        await vi.advanceTimersByTimeAsync(10); // POST en vuelo
        const discarding = s.discard();
        await vi.advanceTimersByTimeAsync(2000);
        await discarding;
        expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/drafts/d1')).toBe(true);
        expect(s.getDraftId()).toBeUndefined();
        // despues de descartar no se guarda nada mas
        s.schedule(payload({ subject: 'tarde' }));
        await vi.advanceTimersByTimeAsync(5000);
        expect(calls.filter((c) => c.method === 'POST').length).toBe(1);
    });

    it('discard cancela el debounce pendiente y borra un borrador existente', async () => {
        const { impl, calls } = makeFetch();
        const s = new DraftSaver({ fetchImpl: impl, initialDraftId: 'old' });
        s.schedule(payload());
        await s.discard();
        await vi.advanceTimersByTimeAsync(5000);
        expect(calls.filter((c) => c.method === 'POST').length).toBe(0);
        expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual(['/api/drafts/old']);
    });

    it('no guarda si no cambio respecto al estado inicial (baseline)', async () => {
        const { impl, calls } = makeFetch();
        const s = new DraftSaver({ fetchImpl: impl, debounceMs: 10 });
        s.setBaseline(payload());
        s.schedule(payload());
        await vi.advanceTimersByTimeAsync(100);
        expect(calls.length).toBe(0);
        s.schedule(payload({ body: '<p>editado</p>' }));
        await vi.advanceTimersByTimeAsync(100);
        expect(calls.length).toBe(1);
    });

    it('si el borrador ya no existe (404) lo recrea una vez', async () => {
        const { impl, calls } = makeFetch({ status: (c) => (c.body?.id === 'gone' ? 404 : 200) });
        const s = new DraftSaver({ fetchImpl: impl, initialDraftId: 'gone' });
        s.schedule(payload());
        await s.flush();
        const posts = calls.filter((c) => c.method === 'POST');
        expect(posts.length).toBe(2);
        expect(posts[1].body.id).toBeUndefined();
        expect(s.getDraftId()).toBeDefined();
        expect(s.getDraftId()).not.toBe('gone');
    });

    it('errores del servidor: estado error y se reintenta con el mismo contenido', async () => {
        let fail = true;
        const { impl, calls } = makeFetch({ status: () => (fail ? 500 : 200) });
        const statuses: string[] = [];
        const s = new DraftSaver({ fetchImpl: impl, onStatus: (st) => statuses.push(st) });
        s.schedule(payload());
        await s.flush();
        expect(statuses).toContain('error');
        expect(s.hasPending()).toBe(true);
        fail = false;
        await s.flush();
        expect(calls.filter((c) => c.method === 'POST').length).toBe(2);
        expect(statuses.at(-1)).toBe('saved');
    });

    it('vaciar todo el contenido elimina el borrador existente en vez de dejarlo en blanco', async () => {
        const { impl, calls } = makeFetch();
        const s = new DraftSaver({ fetchImpl: impl, initialDraftId: 'd9' });
        s.schedule(payload({ to: '', subject: '', body: '<p></p>' }));
        await s.flush();
        expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['DELETE /api/drafts/d9']);
        expect(s.getDraftId()).toBeUndefined();
    });

    it('envia los adjuntos con su key', async () => {
        const { impl, calls } = makeFetch();
        const s = new DraftSaver({ fetchImpl: impl });
        s.schedule(payload({ attachments: [{ filename: 'a.pdf', key: 'attachments/me@x.com/1-a.pdf', size: 5 }] }));
        await s.flush();
        expect(calls[0].body.attachments).toEqual([{ filename: 'a.pdf', key: 'attachments/me@x.com/1-a.pdf', size: 5 }]);
    });

    it('flushOnUnload dispara POST con keepalive sin esperar', () => {
        const { impl, calls } = makeFetch();
        const spy = impl as unknown as ReturnType<typeof vi.fn>;
        const s = new DraftSaver({ fetchImpl: impl });
        s.schedule(payload());
        s.flushOnUnload();
        expect(calls.length).toBe(1);
        expect(spy.mock.calls[0][1].keepalive).toBe(true);
        expect(s.hasPending()).toBe(false);
    });
});

describe('helpers', () => {
    it('toDraftAttachments conserva solo adjuntos subidos', () => {
        expect(toDraftAttachments([
            { filename: 'a', key: 'k1', mimeType: 'text/plain', size: 3 },
            { name: 'b', key: 'k2' },
            { filename: 'sin-key' },
            { filename: 'c', key: 'PENDING' },
            { key: 'k3' },
            { filename: 'inline', contentBase64: 'AAAA' },
        ])).toEqual([
            { filename: 'a', key: 'k1', mimeType: 'text/plain', size: 3 },
            { filename: 'b', key: 'k2', mimeType: undefined, size: undefined },
        ]);
        expect(toDraftAttachments(undefined)).toEqual([]);
    });

    it('isDraftEmpty ignora HTML vacio', () => {
        expect(isDraftEmpty(payload({ to: '', subject: '', body: '<p><br></p>&nbsp;' }))).toBe(true);
        expect(isDraftEmpty(payload({ to: '', subject: '', body: '', attachments: [{ filename: 'a', key: 'k' }] }))).toBe(false);
    });
});
