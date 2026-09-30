import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearSessionCookies,
    getSessionCookieName,
    legacyReadEnabled,
    readSessionCookie,
    sessionCookieOptions,
    writeSessionCookie,
} from '../session-cookie';

const LEGACY = 'next-auth.session-token';
const HOST = '__Host-next-auth.session-token';

function fakeStore(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial));
    const sets: Array<{ name: string; value: string; options: any }> = [];
    return {
        sets,
        get: (n: string) => (map.has(n) ? { value: map.get(n)! } : undefined),
        set: (name: string, value: string, options: any) => { sets.push({ name, value, options }); map.set(name, value); },
    };
}

function env(nodeEnv: string, extra: Record<string, string> = {}) {
    vi.stubEnv('NODE_ENV', nodeEnv);
    vi.stubEnv('SESSION_COOKIE_LEGACY_READ', '');
    vi.stubEnv('SESSION_COOKIE_HOST_PREFIX', '');
    for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v);
}

beforeEach(() => vi.unstubAllEnvs());
afterEach(() => vi.unstubAllEnvs());

describe('session-cookie: nombre y atributos', () => {
    it('desarrollo/HTTP mantiene el nombre actual (sin __Host-)', () => {
        env('development');
        expect(getSessionCookieName()).toBe(LEGACY);
        expect(legacyReadEnabled()).toBe(false);
        expect(sessionCookieOptions(60).secure).toBe(false);
    });

    it('produccion usa __Host-, Secure, Path=/ y jamas Domain', () => {
        env('production');
        expect(getSessionCookieName()).toBe(HOST);
        const o: any = sessionCookieOptions(123);
        expect(o).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 123 });
        expect('domain' in o).toBe(false);
    });

    it('SESSION_COOKIE_HOST_PREFIX=0 desactiva el prefijo incluso en produccion', () => {
        env('production', { SESSION_COOKIE_HOST_PREFIX: '0' });
        expect(getSessionCookieName()).toBe(LEGACY);
    });
});

describe('session-cookie: lectura dual', () => {
    it('prefiere la cookie nueva sobre la antigua', () => {
        env('production');
        expect(readSessionCookie(fakeStore({ [HOST]: 'new', [LEGACY]: 'old' }))).toEqual({ token: 'new', source: 'current' });
    });

    it('cae a la antigua (source=legacy) si no existe la nueva', () => {
        env('production');
        expect(readSessionCookie(fakeStore({ [LEGACY]: 'old' }))).toEqual({ token: 'old', source: 'legacy' });
    });

    it('SESSION_COOKIE_LEGACY_READ=0 ignora la antigua', () => {
        env('production', { SESSION_COOKIE_LEGACY_READ: '0' });
        expect(readSessionCookie(fakeStore({ [LEGACY]: 'old' }))).toEqual({ token: null, source: null });
        expect(legacyReadEnabled()).toBe(false);
    });

    it('en desarrollo lee el nombre normal y no hay fuente legacy', () => {
        env('development');
        expect(readSessionCookie(fakeStore({ [LEGACY]: 't' }))).toEqual({ token: 't', source: 'current' });
        expect(readSessionCookie(fakeStore())).toEqual({ token: null, source: null });
    });
});

describe('session-cookie: escritura y borrado', () => {
    it('produccion: escribe __Host- y expira la antigua con Path=/ y sin Domain', () => {
        env('production');
        const s = fakeStore();
        writeSessionCookie(s, 'tok', 500);
        expect(s.sets).toHaveLength(2);
        expect(s.sets[0]).toMatchObject({ name: HOST, value: 'tok', options: { maxAge: 500, secure: true, path: '/' } });
        expect(s.sets[1]).toMatchObject({ name: LEGACY, value: '', options: { maxAge: 0, path: '/' } });
        expect('domain' in s.sets[1].options).toBe(false);
    });

    it('desarrollo: solo escribe el nombre actual', () => {
        env('development');
        const s = fakeStore();
        writeSessionCookie(s, 'tok', 500);
        expect(s.sets.map((x) => x.name)).toEqual([LEGACY]);
        expect(s.sets[0].options.secure).toBe(false);
    });

    it('clearSessionCookies borra ambas en produccion y una en desarrollo', () => {
        env('production');
        const p = fakeStore({ [HOST]: 'a', [LEGACY]: 'b' });
        clearSessionCookies(p);
        expect(p.sets.map((x) => [x.name, x.value, x.options.maxAge])).toEqual([[HOST, '', 0], [LEGACY, '', 0]]);
        vi.unstubAllEnvs();
        env('development');
        const d = fakeStore({ [LEGACY]: 'b' });
        clearSessionCookies(d);
        expect(d.sets.map((x) => x.name)).toEqual([LEGACY]);
    });
});

describe('middleware con la cookie de sesion', () => {
    async function run(nodeEnv: string, cookieName: string | null, extra: Record<string, string> = {}) {
        env(nodeEnv, { NEXTAUTH_SECRET: 'test-secret-for-middleware-0123456789', ...extra });
        vi.resetModules();
        const { signSessionJWT } = await import('../jwt');
        const { middleware } = await import('../../middleware');
        const { NextRequest } = await import('next/server');
        const { token } = await signSessionJWT({ sub: 'u1', email: 'a@b.c' });
        const headers: Record<string, string> = {};
        if (cookieName) headers.cookie = `${cookieName}=${token}`;
        const res = await middleware(new NextRequest('http://localhost/inbox', { headers }));
        return res;
    }

    it('produccion: acepta la cookie __Host-', async () => {
        const res = await run('production', HOST);
        expect(res.status).toBe(200);
        expect(res.headers.get('location')).toBeNull();
    });

    it('produccion: acepta la antigua y la migra (nueva + expira antigua)', async () => {
        const res = await run('production', LEGACY);
        expect(res.status).toBe(200);
        const c = res.cookies;
        expect(c.get(HOST)?.value).toBeTruthy();
        expect(c.get(HOST)?.secure).toBe(true);
        expect(c.get(LEGACY)?.value).toBe('');
    });

    it('produccion con lectura antigua desactivada: redirige a /login', async () => {
        const res = await run('production', LEGACY, { SESSION_COOKIE_LEGACY_READ: '0' });
        expect(res.status).toBe(307);
        expect(res.headers.get('location')).toContain('/login');
    });

    it('desarrollo: acepta el nombre normal y sin cookie redirige', async () => {
        expect((await run('development', LEGACY)).status).toBe(200);
        const none = await run('development', null);
        expect(none.status).toBe(307);
    });
});
