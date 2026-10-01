import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Rutas del armazon de la consola: me, system, search, overview, logout. Con dobles (sin BD ni backend reales).
 * Comprueba auth (401/403 sin tocar la BD), validacion, SQL parametrizado y que no se devuelven secretos.
 */

const requireAdmin = vi.fn();
const queryMock = vi.fn();
const auditLog = vi.fn();

vi.mock('@/lib/admin-auth', () => {
    const guardFn = (...a: unknown[]) => requireAdmin(...a);
    // adminRoute usa requireLevel(n): en estas pruebas el nivel no se evalua (lo cubre admin-levels.test / admin-cli.pg.test)
    return { requireAdmin: guardFn, requireLevel: (_min: number, ...a: unknown[]) => (guardFn as (...x: unknown[]) => unknown)(...a) };
});
vi.mock('@/lib/security', () => ({
    auditLog: (...a: unknown[]) => auditLog(...a),
    rateLimitAsync: async () => ({ ok: true, retryAfter: 0, backend: 'memory' }),
    getClientIp: () => '1.2.3.4',
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/admin/sql', async () => {
    const actual = await vi.importActual<typeof import('@/lib/admin/sql')>('@/lib/admin/sql');
    return { ...actual, query: (...a: unknown[]) => queryMock(...a), execute: vi.fn() };
});
vi.mock('@/lib/mfa', () => ({ adminEmails: () => ['admin@acme.test', 'other@acme.test'] }));

import { NextRequest, NextResponse } from 'next/server';

const denied = (status: number) => ({ ok: false, response: NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }, { status }) });
const admin = { ok: true, actor: { kind: 'user', id: 'u-admin', email: 'admin@acme.test' } };
const get = (path: string) => new NextRequest(`http://localhost${path}`);

beforeEach(() => {
    requireAdmin.mockReset();
    queryMock.mockReset();
    auditLog.mockReset();
    vi.stubEnv('TOP_DOMAIN', 'mail.acme.test:3000');
    vi.stubEnv('NEXT_PUBLIC_BACKEND_URL', 'https://backend.test');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('autorizacion de todas las rutas del armazon', () => {
    const routes: Array<[string, () => Promise<{ GET: (r: NextRequest, c?: any) => Promise<Response> }>, string]> = [
        ['me', () => import('../me/route'), '/api/admin/me'],
        ['system', () => import('../system/route'), '/api/admin/system'],
        ['search', () => import('../search/route'), '/api/admin/search?q=ana'],
        ['overview', () => import('../overview/route'), '/api/admin/overview'],
    ];
    for (const [name, load, url] of routes) {
        it(`${name}: 401 sin sesion y 403 a no-duenos, sin consultar la BD`, async () => {
            const { GET } = await load();
            requireAdmin.mockResolvedValue(denied(401));
            expect((await GET(get(url))).status).toBe(401);
            requireAdmin.mockResolvedValue(denied(403));
            expect((await GET(get(url))).status).toBe(403);
            expect(queryMock).not.toHaveBeenCalled();
        });
    }
});

describe('GET /api/admin/me', () => {
    it('devuelve el actor y el dominio de la instancia (sin secretos)', async () => {
        requireAdmin.mockResolvedValue(admin);
        const { GET } = await import('../me/route');
        const res = await GET(get('/api/admin/me'));
        expect(await res.json()).toMatchObject({ me: { kind: 'user', id: 'u-admin', email: 'admin@acme.test', userId: 'u-admin', instanceDomain: 'mail.acme.test' } });
    });
    it('manager: userId null', async () => {
        requireAdmin.mockResolvedValue({ ok: true, actor: { kind: 'manager', id: 'm1', email: 'o@acme.test' } });
        const { GET } = await import('../me/route');
        expect((await (await GET(get('/api/admin/me'))).json()).me.userId).toBeNull();
    });
});

describe('GET /api/admin/search', () => {
    it('exige q de al menos 2 caracteres', async () => {
        requireAdmin.mockResolvedValue(admin);
        const { GET } = await import('../search/route');
        expect((await GET(get('/api/admin/search?q=a'))).status).toBe(400);
        expect((await GET(get('/api/admin/search'))).status).toBe(400);
        expect((await GET(get(`/api/admin/search?q=${'x'.repeat(81)}`))).status).toBe(400);
        expect(queryMock).not.toHaveBeenCalled();
    });
    it('consulta parametrizada con escape de comodines y limite 8; devuelve solo id/nombre/correo', async () => {
        requireAdmin.mockResolvedValue(admin);
        queryMock.mockResolvedValue([{ id: 'u1', name: 'Ana', email: 'ana@x.com' }]);
        const { GET } = await import('../search/route');
        const res = await GET(get('/api/admin/search?q=' + encodeURIComponent("a%_'; DROP TABLE x;--")));
        expect(res.status).toBe(200);
        const [sql, like] = queryMock.mock.calls[0];
        expect(sql).toContain('$1');
        expect(sql).not.toContain('DROP');
        expect(sql).toContain('LIMIT 8');
        expect(like).toContain('\\%');
        expect(like).toContain('\\_');
        expect(await res.json()).toEqual({ users: [{ id: 'u1', name: 'Ana', email: 'ana@x.com' }] });
    });
});

describe('GET /api/admin/system', () => {
    it('degradado si el backend falla; nunca expone secretos ni la clave privada', async () => {
        requireAdmin.mockResolvedValue(admin);
        queryMock.mockResolvedValue([{ ok: 1 }]);
        vi.stubEnv('BLOOMX_DOMAIN_PRIVATE_KEY', 'SUPER-SECRET-PRIVATE');
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
        const { GET } = await import('../system/route');
        const body = await (await GET(get('/api/admin/system'))).json();
        expect(body.status).toBe('degraded');
        expect(body.db.ok).toBe(true);
        expect(body.backend.ok).toBe(false);
        expect(body.rateLimit).toBe('memory');
        expect(typeof body.legacy).toBe('boolean');
        expect(JSON.stringify(body)).not.toContain('SUPER-SECRET');
    });
    it('down si la BD falla', async () => {
        requireAdmin.mockResolvedValue(admin);
        queryMock.mockRejectedValue(new Error('db down'));
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
        const { GET } = await import('../system/route');
        expect((await (await GET(get('/api/admin/system'))).json()).status).toBe('down');
    });
});

describe('GET /api/admin/overview', () => {
    it('agrega bloques con SQL parametrizado y tolera tablas ausentes', async () => {
        requireAdmin.mockResolvedValue(admin);
        queryMock.mockImplementation(async (sql: string) => {
            if (/FROM "User"\s*$|FROM "User"$/.test(sql.trim()) && sql.includes('COUNT(*) AS total')) return [{ total: BigInt(12), new7d: BigInt(3) }];
            if (sql.includes('ORDER BY "createdAt" DESC LIMIT 5')) return [{ id: 'u1', name: null, email: 'a@x.com', createdAt: new Date('2026-01-01T00:00:00Z') }];
            if (sql.includes('"UserMfa"')) return [{ email: 'admin@acme.test', enabled: true }, { email: 'other@acme.test', enabled: null }];
            if (sql.includes('"UserAdminState"')) throw Object.assign(new Error('relation "UserAdminState" does not exist'), { code: '42P01' });
            if (sql.includes('"ElixirCampaign"')) throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
            return [{}];
        });
        const { GET } = await import('../overview/route');
        const res = await GET(get('/api/admin/overview'));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.users.total).toBe(12);
        expect(body.users.new7d).toBe(3);
        expect(body.users.active30d).toBe(0);
        expect(body.users.recent[0].email).toBe('a@x.com');
        expect(body.elixir.available).toBe(false);
        expect(body.adminMfa).toMatchObject({ total: 2, withMfa: 1, missing: ['other@acme.test'] });
        // solo agregados: nada de asuntos, cuerpos ni hashes
        const text = JSON.stringify(body);
        expect(text).not.toMatch(/subject|password|token|htmlKey/i);
        // toda consulta con datos va parametrizada (ADMIN_EMAILS como parametro, no interpolado)
        const mfaCall = queryMock.mock.calls.find((c) => String(c[0]).includes('"UserMfa"'))!;
        expect(mfaCall[0]).toContain('$1');
        expect(mfaCall[0]).not.toContain('admin@acme.test');
    });
});

describe('POST /api/admin/logout', () => {
    it('avisa al backend con la cookie, borra la cookie local y no exige admin', async () => {
        const fetchMock = vi.fn(async (..._a: any[]) => new Response('{}', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const { POST } = await import('../logout/route');
        const res = await POST(new NextRequest('http://localhost/api/admin/logout', { method: 'POST', headers: { cookie: 'auth_session=abc' } }));
        expect(res.status).toBe(200);
        expect(requireAdmin).not.toHaveBeenCalled();
        expect(String(fetchMock.mock.calls[0][0])).toBe('https://backend.test/api/auth/logout');
        expect((fetchMock.mock.calls[0][1] as any).headers.Cookie).toBe('auth_session=abc');
        expect(res.headers.get('set-cookie')).toMatch(/auth_session=;/);
    });
    it('si el backend cae igualmente borra la cookie', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
        const { POST } = await import('../logout/route');
        const res = await POST(new NextRequest('http://localhost/api/admin/logout', { method: 'POST', headers: { cookie: 'auth_session=abc' } }));
        expect(res.status).toBe(200);
        expect(res.headers.get('set-cookie')).toMatch(/auth_session=;/);
    });
});
