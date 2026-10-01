import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// La primera peticion importa modulos pesados (Prisma, bridge): con la maquina cargada supera los 5 s por defecto.
vi.setConfig({ testTimeout: 30_000 });

// Las 5 rutas comparten createBridgeHandler: se prueba cada una con firma/clave/rate limit/usuario simulados.
const verify = vi.fn();
const rate = vi.fn();
const userFind = vi.fn();
vi.mock('@/lib/backend-auth', () => ({ verifyBackendRequest: (...a: unknown[]) => verify(...a) }));
vi.mock('@/lib/security', () => ({ rateLimitAsync: (...a: unknown[]) => rate(...a) }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: (...a: unknown[]) => userFind(...a) } } }));

import { POST as calendarPOST } from '@/app/api/internal/calendar/route';
import { POST as contactsPOST } from '@/app/api/internal/contacts/route';
import { POST as storagePOST } from '@/app/api/internal/storage/route';
import { POST as notifyPOST } from '@/app/api/internal/notify/route';
import { POST as formatsPOST } from '@/app/api/internal/formats/route';
import { MAX_BODY_BYTES, createBridgeHandler, BridgeError } from '../host-services/bridge-route';
import { z } from 'zod';

const ROUTES: Array<{ name: string; post: (r: NextRequest) => Promise<Response>; valid: { op: string; args: unknown } }> = [
    { name: 'calendar', post: calendarPOST as any, valid: { op: 'listEvents', args: { from: '2026-06-01T00:00:00Z', to: '2026-06-02T00:00:00Z' } } },
    { name: 'contacts', post: contactsPOST as any, valid: { op: 'search', args: { q: 'a' } } },
    { name: 'storage', post: storagePOST as any, valid: { op: 'get', args: { key: 'k' } } },
    { name: 'notify', post: notifyPOST as any, valid: { op: 'toast', args: { message: 'hola' } } },
    { name: 'formats', post: formatsPOST as any, valid: { op: 'sanitizeHtml', args: { html: '<b>x</b>' } } },
];

const req = (name: string, body: unknown, raw?: string) =>
    new NextRequest(`http://localhost/api/internal/${name}`, { method: 'POST', body: raw ?? JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const full = (r: { valid: { op: string; args: unknown } }, over: Record<string, unknown> = {}) => ({ ...r.valid, userId: 'u1', extensionId: 'ext.one', ...over });

beforeEach(() => {
    verify.mockReset().mockResolvedValue({ ok: true, userId: 'u1' });
    rate.mockReset().mockResolvedValue({ ok: true, retryAfter: 0 });
    userFind.mockReset().mockResolvedValue({ id: 'u1' });
});

describe.each(ROUTES)('puente /api/internal/$name', (route) => {
    it('firma invalida => 401', async () => {
        verify.mockResolvedValue({ ok: false, reason: 'invalid' });
        const res = await route.post(req(route.name, full(route)));
        expect(res.status).toBe(401);
        expect(res.headers.get('cache-control')).toBe('no-store');
    });
    it('sin clave publica del backend => 503', async () => {
        verify.mockResolvedValue({ ok: false, reason: 'unavailable' });
        const res = await route.post(req(route.name, full(route)));
        expect(res.status).toBe(503);
        expect(res.headers.get('retry-after')).toBe('30');
    });
    it('userId del cuerpo distinto del firmado (o firma sin usuario) => 401', async () => {
        verify.mockResolvedValue({ ok: true, userId: 'otro' });
        expect((await route.post(req(route.name, full(route)))).status).toBe(401);
        verify.mockResolvedValue({ ok: true, userId: null });
        expect((await route.post(req(route.name, full(route)))).status).toBe(401);
    });
    it('cuerpo con claves desconocidas, op invalida o JSON roto => 400 invalid_args', async () => {
        for (const body of [full(route, { extra: 1 }), full(route, { op: 'nope' }), { ...full(route), extensionId: undefined }]) {
            const res = await route.post(req(route.name, body));
            expect(res.status).toBe(400);
            expect(await res.json()).toEqual({ error: 'Invalid request', code: 'invalid_args' });
        }
        expect((await route.post(req(route.name, null, '{no json'))).status).toBe(400);
    });
    it('args con claves desconocidas => 400', async () => {
        const res = await route.post(req(route.name, full(route, { args: { ...(route.valid.args as object), inyectada: true } })));
        expect(res.status).toBe(400);
    });
    it('cuerpo > 256 KB => 413 (antes de verificar la firma)', async () => {
        const res = await route.post(req(route.name, null, 'x'.repeat(MAX_BODY_BYTES + 1)));
        expect(res.status).toBe(413);
        expect(verify).not.toHaveBeenCalled();
    });
    it('rate limit por usuario+servicio => 429 con Retry-After', async () => {
        rate.mockResolvedValue({ ok: false, retryAfter: 7 });
        const res = await route.post(req(route.name, full(route)));
        expect(res.status).toBe(429);
        expect(res.headers.get('retry-after')).toBe('7');
        expect((await res.json()).code).toBe('rate_limited');
        expect(rate.mock.calls[0][0]).toBe(`internal-${route.name}:u1`);
    });
    it('usuario inexistente => 404 not_found', async () => {
        userFind.mockResolvedValue(null);
        const res = await route.post(req(route.name, full(route)));
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'Not found', code: 'not_found' });
    });
});

describe('puente: ruta con servicio que funciona (formats no usa BD)', () => {
    it('200 { success, data } con Cache-Control no-store', async () => {
        const res = await formatsPOST(req('formats', { op: 'sanitizeHtml', userId: 'u1', extensionId: 'ext.one', args: { html: '<script>x</script>hola' } }) as any);
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('no-store');
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.data.html).not.toContain('<script');
    });
});

describe('createBridgeHandler: errores', () => {
    const schema = z.discriminatedUnion('op', [z.strictObject({ op: z.literal('x'), userId: z.string(), extensionId: z.string(), args: z.strictObject({}) })]);
    const body = { op: 'x', userId: 'u1', extensionId: 'e', args: {} };
    it('BridgeError se traduce a su estado y codigo; nunca filtra el mensaje', async () => {
        const table: Array<[any, number]> = [['forbidden', 403], ['read_only', 403], ['conflict', 409], ['quota_exceeded', 413], ['invalid_args', 400], ['not_found', 404]];
        for (const [code, status] of table) {
            const post = createBridgeHandler({ service: 't', schema, handle: async () => { throw new BridgeError(code); } });
            const res = await post(req('t', body));
            expect(res.status).toBe(status);
            expect((await res.json()).code).toBe(code);
        }
    });
    it('error inesperado => 500 generico sin detalles y con log sin PII', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const post = createBridgeHandler({ service: 't', schema, handle: async () => { throw new Error('select * from secret where password=hunter2'); } });
        const res = await post(req('t', body));
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: 'Internal error' });
        expect(spy.mock.calls[0].slice(0, 2)).toEqual(['[internal-t] failed:', 'x']);
        spy.mockRestore();
    });
});
