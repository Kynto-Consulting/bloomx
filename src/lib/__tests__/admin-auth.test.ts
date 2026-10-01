import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * requireAdmin / verifyManagerOwnsInstance con dobles (sin backend, BD ni red reales).
 * Modelo: admin de ESTA instancia = manager DUENO del Domain cuyo name es TOP_DOMAIN, o usuario de ADMIN_EMAILS con MFA.
 */

type Backend = {
    me?: { id: string; email: string } | null;
    domains?: Array<{ id: string; name: string }> | null;
    down?: boolean;
    calls: string[];
};

let user: { id: string; email: string } | null = null;
let sessionMfa: boolean | undefined;
let backend: Backend;

function stubBackend() {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        const u = new URL(url);
        backend.calls.push(`${u.pathname}|${(init?.headers as any)?.Cookie ?? ''}`);
        if (backend.down) throw new Error('ECONNREFUSED');
        if (u.pathname === '/api/auth/me') return new Response(JSON.stringify({ user: backend.me ?? null }), { status: 200 });
        if (u.pathname === '/api/manager/domains') {
            if (!backend.me) return new Response('{}', { status: 401 });
            return new Response(JSON.stringify({ domains: backend.domains ?? [] }), { status: 200 });
        }
        return new Response('{}', { status: 404 });
    }));
}

async function load() {
    vi.resetModules();
    vi.doMock('../session', () => ({
        getCurrentUser: async () => user,
        getSessionCookie: async () => (user ? { mfa: sessionMfa } : null),
    }));
    vi.doMock('../mfa', () => ({
        isAdminEmail: (e: string) => String(process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).includes(String(e).toLowerCase()),
        mfaRequiredFor: () => process.env.MFA_ENFORCE_ADMIN !== 'false',
    }));
    vi.doMock('../security', () => ({ auditLog: vi.fn(), getClientIp: () => '1.1.1.1' }));
    const { NextRequest } = await import('next/server');
    const admin = await import('../admin-auth');
    const mgr = await import('../manager-auth');
    const req = (cookie?: string) =>
        new NextRequest('http://localhost/api/admin/users', { headers: cookie ? { cookie: `auth_session=${cookie}` } : {} });
    return { admin, mgr, req };
}

beforeEach(() => {
    user = null;
    sessionMfa = undefined;
    backend = { calls: [] };
    vi.stubEnv('TOP_DOMAIN', 'mail.acme.com:3000');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    vi.stubEnv('NEXT_PUBLIC_BACKEND_URL', 'https://backend.test');
    vi.stubEnv('ADMIN_EMAILS', '');
    stubBackend();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

describe('requireAdmin: via manager', () => {
    it('manager DUENO del dominio de la instancia -> ok', async () => {
        backend.me = { id: 'm1', email: 'owner@acme.com' };
        backend.domains = [{ id: 'd1', name: 'mail.acme.com' }, { id: 'd2', name: 'otro.com' }];
        const { admin, req } = await load();
        const r = await admin.requireAdmin(req('s1'));
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.actor).toMatchObject({ kind: 'manager', id: 'm1', email: 'owner@acme.com', level: 4, levelSource: 'manager' });
        // la cookie del manager viaja al backend; nada de secretos compartidos
        expect(backend.calls.every((c) => c.endsWith('|auth_session=s1'))).toBe(true);
    });

    it('manager AJENO (registro abierto) -> 403', async () => {
        backend.me = { id: 'm2', email: 'intruso@evil.com' };
        backend.domains = [{ id: 'd9', name: 'evil.com' }];
        const { admin, req } = await load();
        const r = await admin.requireAdmin(req('s2'));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.response.status).toBe(403);
    });

    it('manager sin dominios -> 403', async () => {
        backend.me = { id: 'm3', email: 'nuevo@x.com' };
        backend.domains = [];
        const { admin, req } = await load();
        const r = await admin.requireAdmin(req('s3'));
        expect(!r.ok && r.response.status).toBe(403);
    });

    it('backend caido -> falla cerrado (403), nunca concede', async () => {
        backend.down = true;
        const { admin, req } = await load();
        const r = await admin.requireAdmin(req('s4'));
        expect(!r.ok && r.response.status).toBe(403);
    });

    it('respuesta invalida del backend (sin domains) -> 403', async () => {
        backend.me = { id: 'm1', email: 'o@a.com' };
        backend.domains = null;
        vi.stubGlobal('fetch', vi.fn(async (url: string) =>
            new URL(url).pathname === '/api/auth/me'
                ? new Response(JSON.stringify({ user: backend.me }), { status: 200 })
                : new Response(JSON.stringify({ nope: true }), { status: 200 })));
        const { admin, req } = await load();
        const r = await admin.requireAdmin(req('s5'));
        expect(!r.ok && r.response.status).toBe(403);
    });

    it('sin TOP_DOMAIN ni NEXT_PUBLIC_APP_URL no hay dominio activo -> 403 (no se confia en cabeceras del cliente)', async () => {
        vi.stubEnv('TOP_DOMAIN', '');
        backend.me = { id: 'm1', email: 'o@a.com' };
        backend.domains = [{ id: 'd1', name: 'mail.acme.com' }];
        const { admin, NextRequest } = { ...(await load()), NextRequest: (await import('next/server')).NextRequest };
        const r = await admin.requireAdmin(new NextRequest('http://mail.acme.com/api/admin/users', { headers: { cookie: 'auth_session=s6', host: 'mail.acme.com', 'x-forwarded-host': 'mail.acme.com' } }));
        expect(!r.ok && r.response.status).toBe(403);
        expect(backend.calls.length).toBe(0);
    });

    it('sin cookie ni usuario -> 401', async () => {
        const { admin, req } = await load();
        const r = await admin.requireAdmin(req());
        expect(!r.ok && r.response.status).toBe(401);
    });

    it('cache: segunda peticion de la misma sesion no vuelve a llamar al backend; expira a los 45 s', async () => {
        backend.me = { id: 'm1', email: 'o@a.com' };
        backend.domains = [{ id: 'd1', name: 'mail.acme.com' }];
        const { mgr, req } = await load();
        const t0 = 1_000_000;
        expect((await mgr.verifyManagerOwnsInstance(req('sc'), { now: t0 })).ok).toBe(true);
        const n = backend.calls.length;
        expect((await mgr.verifyManagerOwnsInstance(req('sc'), { now: t0 + 30_000 })).ok).toBe(true);
        expect(backend.calls.length).toBe(n);
        // cambia la propiedad en el backend: tras la expiracion se refleja
        backend.domains = [];
        expect((await mgr.verifyManagerOwnsInstance(req('sc'), { now: t0 + 50_000 })).ok).toBe(false);
        expect(backend.calls.length).toBeGreaterThan(n);
    });

    it('cache: otra sesion no hereda el permiso; los fallos de red no se cachean', async () => {
        backend.me = { id: 'm1', email: 'o@a.com' };
        backend.domains = [{ id: 'd1', name: 'mail.acme.com' }];
        const { mgr, req } = await load();
        expect((await mgr.verifyManagerOwnsInstance(req('sa'), { now: 1 })).ok).toBe(true);
        backend.me = null; // la sesion 'sb' no es valida
        expect((await mgr.verifyManagerOwnsInstance(req('sb'), { now: 2 })).ok).toBe(false);
        backend.down = true;
        expect((await mgr.verifyManagerOwnsInstance(req('sc2'), { now: 3 })).ok).toBe(false);
        backend.down = false;
        backend.me = { id: 'm1', email: 'o@a.com' };
        expect((await mgr.verifyManagerOwnsInstance(req('sc2'), { now: 4 })).ok).toBe(true);
    });
});

describe('requireAdmin: via ADMIN_EMAILS', () => {
    it('admin con MFA verificado -> ok', async () => {
        vi.stubEnv('ADMIN_EMAILS', 'boss@acme.com');
        user = { id: 'u1', email: 'boss@acme.com' };
        sessionMfa = true;
        const { admin, req } = await load();
        const r = await admin.requireAdmin(req());
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.actor.kind).toBe('user');
    });

    it('admin SIN MFA -> 403 MFA_REQUIRED', async () => {
        vi.stubEnv('ADMIN_EMAILS', 'boss@acme.com');
        user = { id: 'u1', email: 'boss@acme.com' };
        sessionMfa = false;
        const { admin, req } = await load();
        const r = await admin.requireAdmin(req());
        expect(!r.ok && r.response.status).toBe(403);
        if (!r.ok) expect((await r.response.json()).code).toBe('MFA_REQUIRED');
    });

    it('usuario normal -> 403; un manager ajeno no lo convierte en admin', async () => {
        user = { id: 'u2', email: 'pepe@acme.com' };
        backend.me = { id: 'm2', email: 'x@evil.com' };
        backend.domains = [{ id: 'd9', name: 'evil.com' }];
        const { admin, req } = await load();
        const r = await admin.requireAdmin(req('s9'));
        expect(!r.ok && r.response.status).toBe(403);
    });

    it('manager ajeno + ADMIN_EMAILS con MFA sigue entrando por la via (b)', async () => {
        vi.stubEnv('ADMIN_EMAILS', 'boss@acme.com');
        user = { id: 'u1', email: 'boss@acme.com' };
        sessionMfa = true;
        backend.me = { id: 'm2', email: 'x@evil.com' };
        backend.domains = [];
        const { admin, req } = await load();
        const r = await admin.requireAdmin(req('s9'));
        expect(r.ok).toBe(true);
    });
});

describe('POST /api/admin/login', () => {
    async function loginWith(ownsDomain: boolean, down = false) {
        vi.resetModules();
        vi.doMock('@/lib/security', () => ({ auditLog: vi.fn(), getClientIp: () => '9.9.9.9', rateLimitAsync: async () => ({ ok: true, retryAfter: 0 }) }));
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            const p = new URL(url).pathname;
            if (p === '/api/auth/login') return new Response(JSON.stringify({ user: { id: 'mX' } }), { status: 200, headers: { 'set-cookie': 'auth_session=abc123; Path=/; HttpOnly' } });
            if (down) throw new Error('down');
            if (p === '/api/auth/me') return new Response(JSON.stringify({ user: { id: 'mX', email: 'm@x.com' } }), { status: 200 });
            return new Response(JSON.stringify({ domains: ownsDomain ? [{ id: 'd', name: 'mail.acme.com' }] : [{ id: 'e', name: 'otra.com' }] }), { status: 200 });
        }));
        const route = await import('@/app/api/admin/login/route');
        return route.POST(new Request('http://localhost/api/admin/login', { method: 'POST', body: JSON.stringify({ email: 'm@x.com', password: 'pw' }) }));
    }

    it('manager dueno: 200 y se reenvia la cookie', async () => {
        const res = await loginWith(true);
        expect(res.status).toBe(200);
        expect(res.headers.get('set-cookie')).toContain('auth_session=abc123');
    });

    it('manager ajeno: 403 y NO se le da la cookie de sesion', async () => {
        const res = await loginWith(false);
        expect(res.status).toBe(403);
        expect(res.headers.get('set-cookie')).toBeNull();
    });

    it('backend caido tras el login: 503 sin cookie (falla cerrado)', async () => {
        const res = await loginWith(true, true);
        expect(res.status).toBe(503);
        expect(res.headers.get('set-cookie')).toBeNull();
    });
});

import { isInstanceOwned } from '../manager-auth';

describe('isInstanceOwned: dominio exacto o padre con 2+ etiquetas', () => {
    it('exacto', () => expect(isInstanceOwned(['ulima.dev'], new Set(['ulima.dev']))).toBe(true));
    it('dueno de ulima.dev administra mail.ulima.dev', () => expect(isInstanceOwned(['mail.ulima.dev'], new Set(['ulima.dev']))).toBe(true));
    it('subdominios profundos', () => expect(isInstanceOwned(['a.b.ulima.dev'], new Set(['ulima.dev']))).toBe(true));
    it('un dominio hermano NO', () => expect(isInstanceOwned(['mail.ulima.dev'], new Set(['tumi-ai.com']))).toBe(false));
    it('un TLD NO cuenta (no se puede reclamar "dev")', () => expect(isInstanceOwned(['mail.ulima.dev'], new Set(['dev']))).toBe(false));
    it('el dominio padre ajeno no hereda hacia abajo al reves', () => expect(isInstanceOwned(['ulima.dev'], new Set(['mail.ulima.dev']))).toBe(false));
    it('varios nombres de instancia: basta uno', () => expect(isInstanceOwned(['x.other.org', 'mail.tumi-ai.com'], new Set(['tumi-ai.com']))).toBe(true));
    it('sin dominios -> false', () => expect(isInstanceOwned([], new Set(['ulima.dev']))).toBe(false));
});
