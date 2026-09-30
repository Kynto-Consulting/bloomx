import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

/**
 * Rutas de la fachada de conferencias: sesion, validacion, limite, idempotencia, errores tipados y acceso de admin.
 * El servicio y la sesion son dobles; sin BD, red ni servicios reales.
 */

vi.setConfig({ testTimeout: 60_000 });

const ME = { id: 'u1', email: 'me@brand.com' };
const calls: any = { create: [], del: [], test: [], statuses: [] };
let createImpl: (...a: any[]) => Promise<any>;
let admin: { ok: boolean; status?: number } = { ok: true };

async function setup(session = true) {
    vi.resetModules();
    calls.create = []; calls.del = []; calls.test = []; calls.statuses = [];
    createImpl = async (_a, provider) => ({ provider, providerName: 'Zoom', joinUrl: 'https://zoom.us/j/1', meetingId: '1' });
    vi.stubEnv('TOP_DOMAIN', 'brand.com');
    vi.doMock('@/lib/session', () => ({ getCurrentUser: async () => (session ? ME : null) }));
    vi.doMock('@/lib/conferencing/service', () => ({
        createMeeting: async (...a: any[]) => { calls.create.push(a); return createImpl(...a); },
        deleteMeeting: async (...a: any[]) => { calls.del.push(a); },
        testConnection: async (...a: any[]) => { calls.test.push(a); return { mode: 'server-to-server', detail: 'ok' }; },
    }));
    vi.doMock('@/lib/conferencing/status', () => ({
        listProviderStatuses: async (...a: any[]) => { calls.statuses.push(a); return [{ id: 'zoom', name: 'Zoom', configured: true }]; },
        invalidateStatusCache: () => undefined,
    }));
    vi.doMock('@/lib/admin-auth', () => ({
        requireAdmin: async () =>
            admin.ok
                ? { ok: true, actor: { kind: 'manager', id: 'mgr1', email: 'boss@brand.com' } }
                : { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: admin.status ?? 403 }) },
    }));
    vi.doMock('@/lib/security', async (orig) => ({ ...(await orig<any>()), auditLog: () => undefined }));
    const { NextRequest } = await import('next/server');
    const mk = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
        new NextRequest(`http://brand.com${path}`, {
            method,
            headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...headers },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    return { mk };
}

beforeEach(() => { admin = { ok: true }; vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules(); });

describe('GET /api/calendar/conferencing/providers', () => {
    it('sin sesion: 401 con error tipado', async () => {
        const { mk } = await setup(false);
        const { GET } = await import('@/app/api/calendar/conferencing/providers/route');
        const res = await GET(mk('/api/calendar/conferencing/providers') as any);
        expect(res.status).toBe(401);
        expect((await res.json()).error.code).toBe('unauthorized');
    });
    it('con sesion: lista solo del usuario de la sesion (dominio del servidor), sin cache del navegador', async () => {
        const { mk } = await setup();
        const { GET } = await import('@/app/api/calendar/conferencing/providers/route');
        const res = await GET(mk('/api/calendar/conferencing/providers?refresh=1', 'GET', undefined, { host: 'evil.test' }) as any);
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect((await res.json()).providers).toHaveLength(1);
        const [actor, opts] = calls.statuses[0];
        expect(actor).toEqual({ userId: 'u1', email: 'me@brand.com', domain: 'brand.com' }); // TOP_DOMAIN, no la cabecera Host
        expect(opts).toEqual({ force: true });
    });
});

describe('POST /api/calendar/conferencing/[provider]', () => {
    const post = async (provider: string, body: unknown, headers: Record<string, string> = {}, session = true) => {
        const { mk } = await setup(session);
        const { POST } = await import('@/app/api/calendar/conferencing/[provider]/route');
        return POST(mk(`/api/calendar/conferencing/${provider}`, 'POST', body, headers) as any, { params: Promise.resolve({ provider }) });
    };

    it('sin sesion: 401 y no llama al servicio', async () => {
        const res = await post('zoom', {}, {}, false);
        expect(res.status).toBe(401);
        expect(calls.create).toHaveLength(0);
    });
    it('proveedor desconocido y cuerpo invalido: 400 invalid_input', async () => {
        expect((await post('skype', {})).status).toBe(400);
        expect(calls.create).toHaveLength(0);
        const bad = await post('zoom', { topic: 'x', userId: 'otro-usuario' }); // campos no permitidos (strict)
        expect(bad.status).toBe(400);
        expect((await bad.json()).error.code).toBe('invalid_input');
        expect((await post('zoom', { attendees: Array.from({ length: 101 }, (_, i) => `a${i}@x.com`) })).status).toBe(400);
        expect((await post('zoom', { topic: 'x'.repeat(201) })).status).toBe(400);
    });
    it('Idempotency-Key invalida: 400; valida: se pasa al servicio junto al actor de la SESION', async () => {
        expect((await post('zoom', {}, { 'idempotency-key': 'corta' })).status).toBe(400);
        expect((await post('zoom', {}, { 'idempotency-key': 'con espacios y <raros>' })).status).toBe(400);
        const ok = await post('zoom', { topic: 'Sync', startsAt: '2030-01-01T10:00:00Z' }, { 'idempotency-key': 'key-abcdef123' });
        expect(ok.status).toBe(200);
        const [actor, provider, input, opts] = calls.create[0];
        expect(actor.userId).toBe('u1');
        expect(provider).toBe('zoom');
        expect(input.topic).toBe('Sync');
        expect(opts.idempotencyKey).toBe('key-abcdef123');
        expect((await ok.json()).meeting.joinUrl).toBe('https://zoom.us/j/1');
    });
    it('errores tipados -> HTTP: token_revoked 401 (+reconnect), not_connected 409, rate_limited 429 con Retry-After, invalid_credentials 424', async () => {
        const { ConferencingError } = await import('../types');
        const cases: Array<[any, number]> = [
            [new ConferencingError('token_revoked', 'r'), 401],
            [new ConferencingError('not_connected', 'n'), 409],
            [new ConferencingError('rate_limited', 'slow', { retryAfter: 12 }), 429],
            [new ConferencingError('invalid_credentials', 'c'), 424],
            [new ConferencingError('provider_error', 'p'), 502],
            [new Error('secreto interno'), 500],
        ];
        for (const [err, status] of cases) {
            const { mk } = await setup();
            createImpl = async () => { throw err; };
            const { POST } = await import('@/app/api/calendar/conferencing/[provider]/route');
            const res = await POST(mk('/api/calendar/conferencing/zoom', 'POST', {}) as any, { params: Promise.resolve({ provider: 'zoom' }) });
            expect(res.status).toBe(status);
            const body = await res.json();
            expect(body.error.code).toBeTruthy();
            expect(JSON.stringify(body)).not.toContain('secreto interno');
            if (status === 429) expect(res.headers.get('retry-after')).toBe('12');
            if (status === 401) expect(body.reconnect).toBe(true);
        }
    });
    it('rate limit: a la peticion 21 por minuto y usuario responde 429', async () => {
        const { mk } = await setup();
        const { POST } = await import('@/app/api/calendar/conferencing/[provider]/route');
        let last: Response | null = null;
        for (let i = 0; i < 21; i++) last = await POST(mk('/api/calendar/conferencing/zoom', 'POST', {}) as any, { params: Promise.resolve({ provider: 'zoom' }) });
        expect(last!.status).toBe(429);
        expect(calls.create).toHaveLength(20);
    });
});

describe('DELETE /api/calendar/conferencing/[provider]', () => {
    it('sin sesion 401; con sesion pasa meetingId y actor de la sesion al servicio (la propiedad la impone el servicio)', async () => {
        let { mk } = await setup(false);
        let route = await import('@/app/api/calendar/conferencing/[provider]/route');
        expect((await route.DELETE(mk('/api/calendar/conferencing/zoom?meetingId=1', 'DELETE') as any, { params: Promise.resolve({ provider: 'zoom' }) })).status).toBe(401);
        ({ mk } = await setup());
        route = await import('@/app/api/calendar/conferencing/[provider]/route');
        const res = await route.DELETE(mk('/api/calendar/conferencing/zoom?meetingId=555', 'DELETE') as any, { params: Promise.resolve({ provider: 'zoom' }) });
        expect(res.status).toBe(200);
        expect(calls.del[0][0].userId).toBe('u1');
        expect(calls.del[0][2]).toBe('555');
    });
});

describe('POST .../[provider]/test (solo admin)', () => {
    const run = async (provider = 'zoom') => {
        const { mk } = await setup();
        const { POST } = await import('@/app/api/calendar/conferencing/[provider]/test/route');
        return POST(mk(`/api/calendar/conferencing/${provider}/test`, 'POST') as any, { params: Promise.resolve({ provider }) });
    };
    it('no admin: 403/401 y NO ejecuta testConnection', async () => {
        admin = { ok: false, status: 403 };
        expect((await run()).status).toBe(403);
        admin = { ok: false, status: 401 };
        expect((await run()).status).toBe(401);
        expect(calls.test).toHaveLength(0);
    });
    it('admin: ejecuta testConnection y devuelve modo/detalle; custom no se prueba', async () => {
        const res = await run();
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true, mode: 'server-to-server', detail: 'ok' });
        expect(calls.test[0][1]).toBe('zoom');
        expect((await run('custom')).status).toBe(400);
    });
});

describe('alias POST /api/calendar/conferencing/meet (compatibilidad)', () => {
    it('conserva { meetUrl } y delega en google-meet; errores con { error: texto, code }', async () => {
        let { mk } = await setup();
        createImpl = async (_a, provider) => ({ provider, providerName: 'Google Meet', joinUrl: 'https://meet.google.com/abc-defg-hij', meetingId: 'abc-defg-hij' });
        let route = await import('@/app/api/calendar/conferencing/meet/route');
        const ok = await route.POST(mk('/api/calendar/conferencing/meet', 'POST', { title: 'Reunion', startsAt: '2030-01-01T10:00:00Z', endsAt: '2030-01-01T11:00:00Z' }) as any);
        expect(ok.status).toBe(200);
        const body = await ok.json();
        expect(body.meetUrl).toBe('https://meet.google.com/abc-defg-hij');
        expect(calls.create[0][1]).toBe('google-meet');
        expect(calls.create[0][2].topic).toBe('Reunion');

        ({ mk } = await setup());
        const { ConferencingError } = await import('../types');
        createImpl = async () => { throw new ConferencingError('not_connected', 'Google account is not linked'); };
        route = await import('@/app/api/calendar/conferencing/meet/route');
        const bad = await route.POST(mk('/api/calendar/conferencing/meet', 'POST', {}) as any);
        expect(bad.status).toBe(409);
        expect(await bad.json()).toEqual({ error: 'Google account is not linked', code: 'not_connected' });

        ({ mk } = await setup(false));
        route = await import('@/app/api/calendar/conferencing/meet/route');
        expect((await route.POST(mk('/api/calendar/conferencing/meet', 'POST', {}) as any)).status).toBe(401);
    });
});
