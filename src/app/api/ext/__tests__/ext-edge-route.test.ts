import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const identity = vi.hoisted(() => ({ value: null as any }));
vi.mock('@/lib/ext-edge-identity', () => ({ resolveEdgeIdentity: vi.fn(async () => identity.value) }));
vi.mock('@/lib/security', () => ({
    getClientIp: (req: Request) => req.headers.get('x-forwarded-for') || 'unknown',
    rateLimitAsync: vi.fn(async () => ({ ok: true, retryAfter: 0 })),
}));

import { NextRequest } from 'next/server';
import { GET, POST, OPTIONS } from '../[extensionId]/[[...path]]/route';
import { rateLimitAsync } from '@/lib/security';
import {
    buildBackendRouteUrl, edgeRoutePath, forwardableHeaders, relayResponseHeaders, sanitizeEdgeQuery, sessionAllowed,
} from '@/lib/expansions/ext-edge';

const calls: Array<{ url: string; init: any }> = [];
let backend: (url: string, init: any) => Response;

function req(method: string, path: string, init: { headers?: Record<string, string>; body?: string } = {}) {
    return new NextRequest(`https://inst.test/api/ext/x-routes${path}`, { method, headers: { host: 'inst.test', 'x-forwarded-for': '203.0.113.7', ...(init.headers ?? {}) }, body: init.body });
}
const call = (r: NextRequest) => {
    const fn = ({ GET, POST, OPTIONS } as Record<string, any>)[r.method];
    return fn(r, { params: Promise.resolve({ extensionId: 'x-routes', path: [] }) }) as Promise<Response>;
};
const sent = () => new URL(calls[calls.length - 1].url);

beforeEach(() => {
    calls.length = 0;
    identity.value = null;
    backend = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'evil=1', 'x-internal': 'secreto', 'x-ext-id': '7' } });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => { calls.push({ url, init }); return backend(url, init); }));
    process.env.TOP_DOMAIN = 'inst.test';
    delete process.env.BLOOMX_DOMAIN_PRIVATE_KEY;
});
afterEach(() => vi.unstubAllGlobals());

describe('helpers puros', () => {
    it('edgeRoutePath rechaza codificaciones, //, . y ..', () => {
        expect(edgeRoutePath('/api/ext/x/a/b', 'x')).toBe('/a/b');
        expect(edgeRoutePath('/api/ext/x', 'x')).toBe('/');
        for (const p of ['/api/ext/x/%2e%2e/a', '/api/ext/x/a//b', '/api/ext/x/a/../b', '/api/ext/x/a\\b', '/api/ext/x/./a']) expect(edgeRoutePath(p, 'x'), p).toBeNull();
    });
    it('sanitizeEdgeQuery elimina TODOS los _bx_ (el llamador no fija la identidad firmada)', () => {
        const q = sanitizeEdgeQuery(new URLSearchParams('a=1&_bx_lvl=4&_BX_SRC=edge&_bx_su=1&b=2'));
        expect(q.toString()).toBe('a=1&b=2');
    });
    it('buildBackendRouteUrl anade los reservados y acota el nivel', () => {
        const u = new URL(buildBackendRouteUrl('https://b.test/', 'x', '/a', new URLSearchParams('q=1'), { level: 3, stepUp: true, clientIp: '203.0.113.7' }));
        expect(u.pathname).toBe('/api/ext/x/a');
        expect(Object.fromEntries(u.searchParams)).toEqual({ q: '1', _bx_src: 'edge', _bx_lvl: '3', _bx_su: '1', _bx_ip: '203.0.113.7' });
        const none = new URL(buildBackendRouteUrl('https://b.test', 'x', '/a', new URLSearchParams(), { level: 9, stepUp: false, clientIp: 'no es ip!' }));
        expect(Object.fromEntries(none.searchParams)).toEqual({ _bx_src: 'edge' });
    });
    it('sessionAllowed: GET siempre; escritura solo mismo origen (CSRF)', () => {
        const h = (o: Record<string, string>) => new Headers({ host: 'inst.test', ...o });
        expect(sessionAllowed('GET', h({ origin: 'https://evil.test' }))).toBe(true);
        expect(sessionAllowed('POST', h({ origin: 'https://inst.test' }))).toBe(true);
        expect(sessionAllowed('POST', h({ origin: 'https://evil.test' }))).toBe(false);
        expect(sessionAllowed('POST', h({ 'sec-fetch-site': 'cross-site' }))).toBe(false);
        expect(sessionAllowed('POST', h({ 'sec-fetch-site': 'same-origin' }))).toBe(true);
        expect(sessionAllowed('POST', h({ origin: 'null' }))).toBe(false);
        expect(sessionAllowed('POST', h({}))).toBe(true);
    });
    it('forwardableHeaders: sin cookies/authorization/reservadas y prefijo x-bloomx-fwd-', () => {
        const out = forwardableHeaders(new Headers({ cookie: 's=1', authorization: 'Bearer t', 'x-signature': 'abc', 'x-bloomx-domain': 'evil', 'sec-fetch-site': 'x', host: 'h', 'x-forwarded-for': '1.1.1.1' }));
        expect(out).toEqual({ 'x-bloomx-fwd-x-signature': 'abc' });
    });
    it('relayResponseHeaders: lista blanca, nunca set-cookie', () => {
        const out = relayResponseHeaders(new Headers({ 'set-cookie': 'a=b', 'content-type': 'application/json', 'x-internal': 'z', 'x-ext-id': '3', 'access-control-allow-origin': 'https://a.test' }));
        expect(out).toEqual({ 'content-type': 'application/json', 'x-ext-id': '3', 'access-control-allow-origin': 'https://a.test' });
    });
});

describe('route del borde', () => {
    it('reenvia sin cookies ni Authorization, con _bx_src=edge firmado en la URL y sin set-cookie en la respuesta', async () => {
        const res = await call(req('GET', '/me?a=1', { headers: { cookie: 'auth_session=abc', authorization: 'Bearer zzz' } }));
        expect(res.status).toBe(200);
        expect(res.headers.get('set-cookie')).toBeNull();
        expect(res.headers.get('x-internal')).toBeNull();
        expect(res.headers.get('x-ext-id')).toBe('7');
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
        const u = sent();
        expect(u.host + u.pathname).toBe('backend.bloomx.arubik.dev/api/ext/x-routes/me');
        expect(u.searchParams.get('_bx_src')).toBe('edge');
        expect(u.searchParams.get('_bx_ip')).toBe('203.0.113.7');
        const h = Object.fromEntries(Object.entries(calls[0].init.headers).map(([k, v]) => [k.toLowerCase(), v]));
        expect(h.cookie).toBeUndefined(); expect(h.authorization).toBeUndefined();
        expect(h['x-user-id']).toBeUndefined();
    });
    it('el llamador no puede suplantar la identidad: _bx_lvl/_bx_src enviados se descartan', async () => {
        await call(req('GET', '/adm?_bx_lvl=4&_bx_su=1&_bx_src=direct'));
        const u = sent();
        expect(u.searchParams.getAll('_bx_lvl')).toEqual([]);
        expect(u.searchParams.get('_bx_su')).toBeNull();
        expect(u.searchParams.getAll('_bx_src')).toEqual(['edge']);
    });
    it('con sesion de mismo origen: reenvia usuario y nivel; cross-site POST => anonimo', async () => {
        identity.value = { id: 'u1', email: 'u1@inst.test', level: 3, stepUp: true };
        await call(req('POST', '/x', { headers: { origin: 'https://inst.test', 'content-type': 'application/json' }, body: '{"a":1}' }));
        let h = Object.fromEntries(Object.entries(calls[0].init.headers).map(([k, v]) => [k.toLowerCase(), v]));
        expect(h['x-user-id']).toBe('u1'); // sin clave de dominio (modo legado) la identidad viaja por X-User-ID; el backend rechaza el modo legado
        expect(sent().searchParams.get('_bx_lvl')).toBe('3');
        expect(sent().searchParams.get('_bx_su')).toBe('1');
        calls.length = 0;
        await call(req('POST', '/x', { headers: { origin: 'https://evil.test', 'content-type': 'application/json' }, body: '{"a":1}' }));
        expect(sent().searchParams.get('_bx_lvl')).toBeNull();
        h = Object.fromEntries(Object.entries(calls[0].init.headers).map(([k, v]) => [k.toLowerCase(), v]));
        expect(h['x-user-id']).toBeUndefined();
    });
    it('con clave de dominio la identidad va FIRMADA (X-User-ID + firma sobre la URL con _bx_*)', async () => {
        const { privateKey } = generateKeyPairSync('ed25519');
        process.env.BLOOMX_DOMAIN_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
        identity.value = { id: 'u9', email: 'u9@inst.test', level: 2, stepUp: false };
        await call(req('GET', '/adm'));
        const h = Object.fromEntries(Object.entries(calls[0].init.headers).map(([k, v]) => [k.toLowerCase(), v]));
        expect(h['x-user-id']).toBe('u9');
        expect(h['x-bloomx-signature']).toBeTruthy();
        expect(sent().searchParams.get('_bx_lvl')).toBe('2');
    });
    it('cabeceras del tercero (HMAC) viajan como x-bloomx-fwd-*; Origin se reenvia para CORS', async () => {
        await call(req('POST', '/hook', { headers: { 'x-signature': 'sha256=abc', 'x-ts': '1', origin: 'https://app.example.com', 'content-type': 'application/json' }, body: '{}' }));
        const h = calls[0].init.headers;
        expect(h['x-bloomx-fwd-x-signature']).toBe('sha256=abc');
        expect(h['x-bloomx-fwd-x-ts']).toBe('1');
        expect(h.Origin).toBe('https://app.example.com');
    });
    it('cuerpo > 1 MiB => 413 sin llamar al backend; HEAD => 405; rutas con .. => 404', async () => {
        const big = 'x'.repeat(1_048_577);
        expect((await call(req('POST', '/x', { body: big, headers: { 'content-type': 'text/plain' } }))).status).toBe(413);
        expect(calls.length).toBe(0);
        const head = new NextRequest('https://inst.test/api/ext/x-routes/me', { method: 'HEAD' });
        expect((await (GET as any)(head, { params: Promise.resolve({ extensionId: 'x-routes', path: ['me'] }) })).status).toBe(405);
        // %2e%2e lo normaliza el parser de URL ANTES de llegar aqui (queda /b); lo que sobreviva con '%' o '\' se rechaza.
        const bad = new NextRequest('https://inst.test/api/ext/x-routes/a%2fb', { method: 'GET' });
        expect((await (GET as any)(bad, { params: Promise.resolve({ extensionId: 'x-routes', path: ['a%2fb'] }) })).status).toBe(404);
        expect(calls.length).toBe(0);
    });
    it('rate limit del borde => 429 con Retry-After', async () => {
        (rateLimitAsync as any).mockResolvedValueOnce({ ok: false, retryAfter: 12 });
        const res = await call(req('GET', '/me'));
        expect(res.status).toBe(429);
        expect(res.headers.get('retry-after')).toBe('12');
        expect(calls.length).toBe(0);
    });
    it('backend caido => 502 generico; las redirecciones del backend no se siguen', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED secreto-interno'); }));
        const res = await call(req('GET', '/me'));
        expect(res.status).toBe(502);
        expect(JSON.stringify(await res.json())).not.toContain('secreto-interno');
        expect((vi.mocked(fetch) as any).mock.calls.length).toBe(1);
    });
    it('204 sin cuerpo y el error del backend se relevan tal cual (estado y codigo)', async () => {
        backend = () => new Response(JSON.stringify({ error: 'INSUFFICIENT_LEVEL' }), { status: 403, headers: { 'content-type': 'application/json' } });
        const res = await call(req('GET', '/adm'));
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: 'INSUFFICIENT_LEVEL' });
        backend = () => new Response(null, { status: 204 });
        expect((await call(req('GET', '/me'))).status).toBe(204);
    });
});

describe('B3: el borde firma Sec-Fetch-Site para que el backend rechace GET con efectos venidos de otro sitio', () => {
    it('_bx_fs solo con valores validos, dentro de la URL', () => {
        const q = new URLSearchParams();
        const url = (fs: string | null) => buildBackendRouteUrl('https://b.test', 'x-ext', '/do', q, { level: null, stepUp: false, clientIp: null, fetchSite: fs });
        expect(url('cross-site')).toContain('_bx_fs=cross-site');
        expect(url('same-origin')).toContain('_bx_fs=same-origin');
        expect(url('raro')).not.toContain('_bx_fs');
        expect(url(null)).not.toContain('_bx_fs');
    });
});
