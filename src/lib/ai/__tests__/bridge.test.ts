import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createAiBridgeHandler, type AiBridgeDeps } from '../bridge';
import { AI_ERROR_CODES, AI_ERROR_MESSAGES, AI_ERROR_STATUS, AiError } from '../types';

const state = { enabled: true, configured: true, source: 'ui', features: {}, extensions: {} };
const deps = (over: Partial<AiBridgeDeps> = {}): AiBridgeDeps => ({
    verify: vi.fn(async () => ({ ok: true as const, userId: 'u1' })),
    rateLimit: vi.fn(async () => ({ ok: true, retryAfter: 0 })),
    userExists: vi.fn(async () => true),
    run: vi.fn(async () => ({ text: 'hi', usage: { tokensIn: 1, tokensOut: 2 }, model: 'm', warnings: [] })) as any,
    status: vi.fn(async () => ({ enabled: true, available: true })) as any,
    state: vi.fn(async () => state) as any,
    ...over,
});
const post = async (d: AiBridgeDeps, body: unknown) => {
    const res = await createAiBridgeHandler(d)(new NextRequest('http://localhost/api/internal/host/ai', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));
    return { status: res.status, body: await res.json(), headers: res.headers };
};
const gen = (over: Record<string, unknown> = {}) => ({ op: 'generate', userId: 'u1', extensionId: 'ext.a', args: { feature: 'composer', prompt: 'hola' }, ...over });

describe('autenticacion', () => {
    it('firma invalida -> 401 y no ejecuta nada', async () => {
        const d = deps({ verify: vi.fn(async () => ({ ok: false as const, reason: 'invalid' as const })) });
        expect((await post(d, gen())).status).toBe(401);
        expect(d.run).not.toHaveBeenCalled();
    });
    it('clave publica del backend ausente -> 503 con Retry-After', async () => {
        const d = deps({ verify: vi.fn(async () => ({ ok: false as const, reason: 'unavailable' as const })) });
        const r = await post(d, gen());
        expect(r.status).toBe(503);
        expect(r.headers.get('retry-after')).toBe('30');
    });
    it('userId del cuerpo distinto del firmado (o sin firmar) -> 401', async () => {
        const d = deps({ verify: vi.fn(async () => ({ ok: true as const, userId: 'otro' })) });
        expect((await post(d, gen())).status).toBe(401);
        const d2 = deps({ verify: vi.fn(async () => ({ ok: true as const, userId: null })) });
        expect((await post(d2, gen())).status).toBe(401);
        expect(d.run).not.toHaveBeenCalled();
        expect(d2.run).not.toHaveBeenCalled();
    });
    it('rate limit -> 429 con Retry-After', async () => {
        const d = deps({ rateLimit: vi.fn(async () => ({ ok: false, retryAfter: 17 })) });
        const r = await post(d, gen());
        expect(r.status).toBe(429);
        expect(r.headers.get('retry-after')).toBe('17');
        expect(d.run).not.toHaveBeenCalled();
    });
    it('usuario inexistente -> 404', async () => {
        expect((await post(deps({ userExists: vi.fn(async () => false) }), gen())).status).toBe(404);
    });
    it('cuerpo demasiado grande -> 413', async () => {
        expect((await post(deps(), 'x'.repeat(1024 * 1024 + 10))).status).toBe(413);
    });
});

describe('validacion estricta', () => {
    it('claves extra, op desconocida, JSON roto -> 400 invalid_args tipado', async () => {
        const d = deps();
        for (const b of [
            gen({ extra: 1 }),
            gen({ args: { feature: 'composer', prompt: 'x', apiKey: 'robada' } }),
            gen({ args: { feature: 'composer' } }),
            gen({ op: 'delete' }),
            gen({ userId: 'a b' }),
            gen({ args: { feature: 'composer', prompt: 'x', maxTokens: 5 } }),
            gen({ args: { feature: 'composer', prompt: 'x', retries: 3 } }),
            '{roto',
        ]) {
            const r = await post(d, b);
            expect(r.status, JSON.stringify(b)).toBe(400);
            expect(r.body).toMatchObject({ success: false, code: 'invalid_args', error: 'invalid_args', message: AI_ERROR_MESSAGES.invalid_args });
        }
        expect(d.run).not.toHaveBeenCalled();
    });
});

describe('operaciones', () => {
    it('generate / chat / json pasan userId y extensionId del host y no del args', async () => {
        const d = deps();
        const r = await post(d, gen());
        expect(r.body).toMatchObject({ success: true, data: { text: 'hi' } });
        expect((d.run as any).mock.calls[0][0]).toMatchObject({ userId: 'u1', extensionId: 'ext.a', feature: 'composer', prompt: 'hola' });
        await post(d, { op: 'json', userId: 'u1', extensionId: 'ext.a', args: { feature: 'other', prompt: 'p', schema: { type: 'object' } } });
        expect((d.run as any).mock.calls[1][0]).toMatchObject({ responseFormat: 'json', schema: { type: 'object' } });
        await post(d, { op: 'chat', userId: 'u1', extensionId: 'ext.a', args: { feature: 'other', messages: [{ role: 'user', content: 'a' }] } });
        expect((d.run as any).mock.calls[2][0].messages).toHaveLength(1);
    });
    it('status devuelve el estado y usa feature "other" por defecto', async () => {
        const d = deps();
        const r = await post(d, { op: 'status', userId: 'u1', extensionId: 'ext.a' });
        expect(r.status).toBe(200);
        expect(r.body.data).toMatchObject({ enabled: true, available: true, state });
        expect((d.status as any).mock.calls[0]).toEqual(['u1', 'other', 'ext.a']);
        expect(d.run).not.toHaveBeenCalled();
    });
});

describe('errores tipados', () => {
    for (const code of AI_ERROR_CODES) {
        it(`${code} -> ${AI_ERROR_STATUS[code]} con message es/en`, async () => {
            const d = deps({ run: vi.fn(async () => { throw new AiError(code, 'detalle', code === 'quota_exceeded' ? 60 : undefined); }) as any });
            const r = await post(d, gen());
            expect(r.status).toBe(AI_ERROR_STATUS[code]);
            expect(r.body).toMatchObject({ success: false, code, error: code, detail: 'detalle' });
            expect(r.body.message.es).toBeTruthy();
            expect(r.body.message.en).toBeTruthy();
            expect(r.body.message).toEqual(AI_ERROR_MESSAGES[code]);
            if (code === 'quota_exceeded') { expect(r.body.retryAfter).toBe(60); expect(r.headers.get('retry-after')).toBe('60'); }
        });
    }
    it('error inesperado -> 500 generico, sin filtrar el mensaje', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const d = deps({ run: vi.fn(async () => { throw new Error('clave sk-123 filtrada'); }) as any });
        const r = await post(d, gen());
        expect(r.status).toBe(500);
        expect(JSON.stringify(r.body)).not.toContain('sk-123');
        spy.mockRestore();
    });
    it('respuestas sin cache', async () => {
        expect((await post(deps(), gen())).headers.get('cache-control')).toBe('no-store');
    });
});
