import crypto from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

let level = 4;
let fresh = true;
const auditLog = vi.fn();
const fetchMock = vi.fn();

vi.mock('@/lib/admin-auth', () => ({
    requireLevel: async (min: number) => {
        if (level < min) return { ok: false, response: NextResponse.json({ error: 'Forbidden', code: 'INSUFFICIENT_LEVEL' }, { status: 403 }) };
        return { ok: true, actor: { kind: 'manager', id: 'mgr-1', email: 'owner@corp.com', level, levelSource: 'manager' } };
    },
}));
vi.mock('@/lib/security', () => ({
    auditLog: (...a: unknown[]) => auditLog(...a),
    rateLimitAsync: async () => ({ ok: true, retryAfter: 0, backend: 'memory' }),
    getClientIp: () => '9.9.9.9',
    safeEqual: () => false,
}));
vi.mock('@/lib/admin/stepup', async () => {
    const { HttpError } = await import('@/lib/admin/http');
    return { assertFreshMfa: async () => { if (!fresh) throw new HttpError(403, 'reauth_required', 'reauth_required'); } };
});

import { GET as billingGet, POST as billingPost } from '@/app/api/admin/billing/[[...path]]/route';
import { GET as devGet, POST as devPost } from '@/app/api/admin/developer/[[...path]]/route';
import { BILLING_ROUTES, DEVELOPER_ROUTES, matchRoute } from '../payments-proxy';
import { canonicalString, sha256Hex, verifyCanonical } from '@/lib/bloomx-signature';

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const ENV_KEYS = ['BLOOMX_DOMAIN_PRIVATE_KEY', 'TOP_DOMAIN', 'NEXT_PUBLIC_BACKEND_URL', 'NEXT_PUBLIC_APP_URL'] as const;
const saved: Record<string, string | undefined> = {};

const ctxOf = (path: string[]) => ({ params: Promise.resolve({ path }) });
const get = (path: string, qs = '') => billingGet(new NextRequest(`https://acme.test/api/admin/billing/${path}${qs}`), ctxOf(path.split('/')));
const post = (path: string, body: unknown, handler = billingPost, base = 'billing') =>
    handler(new NextRequest(`https://acme.test/api/admin/${base}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }), ctxOf(path.split('/')));
const backendOk = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });

beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.BLOOMX_DOMAIN_PRIVATE_KEY = PRIVATE_PEM;
    process.env.TOP_DOMAIN = 'acme.test';
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://backend.example.test';
    delete process.env.NEXT_PUBLIC_APP_URL;
    level = 4; fresh = true;
    fetchMock.mockReset(); auditLog.mockReset();
    fetchMock.mockImplementation(async () => backendOk({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe('nivel y step-up', () => {
    it('nivel < 4 => 403 en todas las rutas y no se llama al backend', async () => {
        for (const l of [0, 1, 2, 3]) {
            level = l;
            const rs = [await get('summary'), await post('orders', { extensionId: 'x' }), await devGet(new NextRequest('https://acme.test/api/admin/developer/overview'), ctxOf(['overview'])), await post('validate', {}, devPost, 'developer')];
            for (const r of rs) expect(r.status, `nivel ${l}`).toBe(403);
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('sin step-up reciente => 403 reauth_required en finanzas, compra, vinculacion PayPal y publicacion; sin llamar al backend', async () => {
        fresh = false;
        const cases = [
            await get('summary'), await get('purchases'), await get('sales'), await get('payouts'), await get('ledger'), await get('export', '?kind=sales'), await get('receipt', '?orderId=o1'), await get('subscriptions'),
            await post('orders', { extensionId: 'ext' }), await post('orders/capture', { orderId: 'o1' }), await post('subscriptions/s1/cancel', {}), await post('paypal/link/start', {}),
            await post('submissions', { extensionId: 'dev.a.b', version: '1.0.0', changelog: 'x', files: { manifest: '{}' } }, devPost, 'developer'),
            await post('extensions/dev.a.b/yank', {}, devPost, 'developer'),
        ];
        for (const r of cases) {
            expect(r.status).toBe(403);
            expect((await r.json()).code).toBe('reauth_required');
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('configuracion publica y validacion en vivo no piden step-up', async () => {
        fresh = false;
        expect((await get('status')).status).toBe(200);
        expect((await get('paypal/account')).status).toBe(200);
        expect((await post('validate', { extensionId: 'dev.a.b', files: { manifest: '{}' } }, devPost, 'developer')).status).toBe(200);
    });
});

describe('modo legado', () => {
    it('sin BLOOMX_DOMAIN_PRIVATE_KEY => 403 signature_required sin llamar al backend (ni pedir step-up)', async () => {
        delete process.env.BLOOMX_DOMAIN_PRIVATE_KEY;
        fresh = false;
        const rs = [await get('status'), await get('summary'), await post('orders', { extensionId: 'x' }), await post('terms', { version: '1' }, devPost, 'developer')];
        for (const r of rs) {
            expect(r.status).toBe(403);
            expect((await r.json()).code).toBe('signature_required');
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('una clave invalida tambien es modo legado', async () => {
        process.env.BLOOMX_DOMAIN_PRIVATE_KEY = 'basura';
        expect((await get('status')).status).toBe(403);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('lista blanca de rutas', () => {
    it('rutas y metodos fuera de la tabla => 404/405 sin llamar al backend', async () => {
        expect((await get('admin/secret')).status).toBe(404);
        expect((await get('')).status).toBe(404);
        expect((await get('../../etc/passwd')).status).toBe(404);
        expect((await post('summary', {})).status).toBe(405);
        expect((await get('orders/capture')).status).toBe(405);
        expect((await post('subscriptions/s1/refund', {})).status).toBe(404);
        expect((await post('webhook', {})).status).toBe(404);
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('segmentos :id con caracteres raros se rechazan (no hay traversal hacia otras rutas del backend)', () => {
        for (const bad of ['..', 'a b', '%2e%2e', '', 'x?y=1', 'x#y']) {
            expect(() => matchRoute('billing', 'GET', ['orders', bad]), bad).toThrow();
        }
        expect(matchRoute('billing', 'GET', ['orders', 'ORD-123']).params).toEqual(['ORD-123']);
        expect(matchRoute('developer', 'POST', ['extensions', 'dev.acme-test.demo', 'yank']).params).toEqual(['dev.acme-test.demo']);
    });
    it('la tabla solo apunta a /api/payments/** y /api/developer/** y nunca expone callbacks ni webhooks', () => {
        for (const r of BILLING_ROUTES) expect(r.be).toMatch(/^\/api\/payments\//);
        for (const r of DEVELOPER_ROUTES) expect(r.be).toMatch(/^\/api\/developer\//);
        for (const r of [...BILLING_ROUTES, ...DEVELOPER_ROUTES]) expect(r.be).not.toMatch(/webhook|callback|create-preference/);
    });
    it('query: solo claves permitidas con su formato', async () => {
        expect((await get('summary', '?from=2026-01-01&to=2026-01-31')).status).toBe(200);
        expect((await get('summary', '?from=2026-01-01&evil=1')).status).toBe(400);
        expect((await get('summary', '?from=ayer')).status).toBe(400);
        expect((await get('export', '?kind=users')).status).toBe(400);
        expect((await get('purchases', '?limit=999999')).status).toBe(400);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe('firma hacia el backend', () => {
    it('firma con la clave de dominio; dominio, usuario y ruta salen de la instancia/sesion, no del cuerpo', async () => {
        const res = await post('orders', { extensionId: 'ext-1', plan: 'month', domain: 'evil.test', domainId: 'x', userId: 'attacker', email: 'a@evil.test' });
        expect(res.status).toBe(200);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://backend.example.test/api/payments/orders');
        expect(init.method).toBe('POST');
        // el cuerpo reenviado solo lleva los campos del esquema
        expect(JSON.parse(init.body)).toEqual({ extensionId: 'ext-1', plan: 'month' });
        const h = init.headers as Record<string, string>;
        expect(h['X-BloomX-Domain']).toBe('acme.test');
        expect(h['X-User-ID']).toBe('mgr-1');
        expect(h['X-User-Email']).toBe('owner@corp.com');
        expect(h.Cookie).toBeUndefined();
        expect(h.Authorization).toBeUndefined();
        const canonical = canonicalString({
            method: 'POST', pathAndQuery: '/api/payments/orders', bodySha256Hex: sha256Hex(init.body), domain: 'acme.test', timestamp: h['X-BloomX-Timestamp'], nonce: h['X-BloomX-Nonce'],
            userId: 'mgr-1', userEmail: 'owner@corp.com', callback: h['X-BloomX-Callback'] ?? '', clientApi: h['X-BloomX-Client-Api'], clientCaps: h['X-BloomX-Client-Caps'],
        });
        expect(verifyCanonical(publicKey, canonical, h['X-BloomX-Signature'])).toBe(true);
    });
    it('la query forma parte de la ruta firmada', async () => {
        await get('summary', '?from=2026-01-01&to=2026-01-31');
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://backend.example.test/api/payments/billing/summary?from=2026-01-01&to=2026-01-31');
        const h = init.headers as Record<string, string>;
        const canonical = canonicalString({
            method: 'GET', pathAndQuery: '/api/payments/billing/summary?from=2026-01-01&to=2026-01-31', bodySha256Hex: sha256Hex(''), domain: 'acme.test', timestamp: h['X-BloomX-Timestamp'], nonce: h['X-BloomX-Nonce'],
            userId: 'mgr-1', userEmail: 'owner@corp.com', callback: h['X-BloomX-Callback'] ?? '', clientApi: h['X-BloomX-Client-Api'], clientCaps: h['X-BloomX-Client-Caps'],
        });
        expect(verifyCanonical(publicKey, canonical, h['X-BloomX-Signature'])).toBe(true);
    });
    it('el id de la ruta llega a la ruta correcta del backend', async () => {
        await post('subscriptions/I-ABC123/cancel', {});
        expect(fetchMock.mock.calls[0][0]).toBe('https://backend.example.test/api/payments/subscriptions/I-ABC123/cancel');
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({});
    });
    it('cancelar nunca puede ser inmediato desde el navegador', async () => {
        expect((await post('subscriptions/s1/cancel', { immediate: true })).status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('cuerpos', () => {
    it('JSON invalido, campos que faltan y tipo de contenido incorrecto', async () => {
        expect((await post('orders', '{no json')).status).toBe(400);
        expect((await post('orders', {})).status).toBe(400);
        expect((await post('orders/capture', {})).status).toBe(400);
        expect((await post('orders', { extensionId: 'a/b' })).status).toBe(400);
        expect((await post('orders', { extensionId: 'x', plan: 'weekly' })).status).toBe(400);
        const wrongType = await billingPost(new NextRequest('https://acme.test/api/admin/billing/orders', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"extensionId":"x"}' }), ctxOf(['orders']));
        expect(wrongType.status).toBe(415);
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('tope de tamano: 16 KB en general, 4 MB con archivos', async () => {
        const big = await post('orders', { extensionId: 'x', pad: 'a'.repeat(20_000) });
        expect(big.status).toBe(413);
        const files = { extensionId: 'dev.a.b', version: '1.0.0', changelog: 'c', files: { manifest: 'm'.repeat(100_000) } };
        expect((await post('validate', files, devPost, 'developer')).status).toBe(200);
        const huge = await post('validate', { ...files, files: { manifest: 'm'.repeat(5 * 1024 * 1024) } }, devPost, 'developer');
        expect(huge.status).toBe(413);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it('el esquema de precio rechaza importes no enteros, negativos y pruebas > 30 dias', async () => {
        const base = { extensionId: 'dev.a.b' };
        expect((await post('pricing', { ...base, pricing: { model: 'subscription', monthCents: 9.5 } }, devPost, 'developer')).status).toBe(400);
        expect((await post('pricing', { ...base, pricing: { model: 'one_time', oneTimeCents: -1 } }, devPost, 'developer')).status).toBe(400);
        expect((await post('pricing', { ...base, pricing: { model: 'subscription', monthCents: 500, trialDays: 31 } }, devPost, 'developer')).status).toBe(400);
        expect((await post('pricing', { ...base, pricing: { model: 'subscription', monthCents: 500, yearCents: 5000, trialDays: 14 } }, devPost, 'developer')).status).toBe(200);
    });
});

describe('respuestas del backend', () => {
    it('503 payments_not_configured llega con su codigo (estado informativo)', async () => {
        fetchMock.mockResolvedValueOnce(backendOk({ error: 'payments_not_configured' }, 503));
        const r = await get('summary');
        expect(r.status).toBe(503);
        expect((await r.json()).code).toBe('payments_not_configured');
    });
    it('errores de negocio conservan su codigo y estado', async () => {
        fetchMock.mockResolvedValueOnce(backendOk({ error: 'already_owned' }, 409));
        const r = await post('orders', { extensionId: 'x' });
        expect(r.status).toBe(409);
        expect(await r.json()).toMatchObject({ error: 'already_owned', code: 'already_owned' });
    });
    it('401/403 del backend se normalizan y signature_required se conserva', async () => {
        fetchMock.mockResolvedValueOnce(backendOk({ error: 'signature_required' }, 403));
        expect((await (await get('status')).json()).code).toBe('signature_required');
        fetchMock.mockResolvedValueOnce(backendOk({ error: 'whatever' }, 401));
        const r = await get('status');
        expect(r.status).toBe(403);
        expect((await r.json()).code).toBe('backend_denied');
    });
    it('5xx y red caida => 502 con codigo estable, sin filtrar el texto del backend', async () => {
        fetchMock.mockResolvedValueOnce(new Response('<html>stack trace secret</html>', { status: 500 }));
        const r = await get('status');
        expect(r.status).toBe(502);
        expect(JSON.stringify(await r.json())).not.toContain('secret');
        fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
        const r2 = await get('status');
        expect(r2.status).toBe(502);
        expect((await r2.json()).code).toBe('backend_unavailable');
    });
    it('timeout => 504', async () => {
        fetchMock.mockRejectedValueOnce(Object.assign(new Error('t'), { name: 'TimeoutError' }));
        expect((await get('status')).status).toBe(504);
    });
    it('un 200 que no es un objeto JSON se trata como error del backend', async () => {
        fetchMock.mockResolvedValueOnce(new Response('hola', { status: 200 }));
        expect((await get('status')).status).toBe(502);
    });
    it('CSV: se reenvia tal cual con Content-Disposition seguro y sin cache', async () => {
        const csv = "orderId,amount\r\no1,500\r\n'=cmd|x,1\r\n";
        fetchMock.mockResolvedValueOnce(new Response(csv, { status: 200, headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="sales-2026.csv"' } }));
        const r = await get('export', '?kind=sales&from=2026-01-01&to=2026-01-31');
        expect(r.status).toBe(200);
        expect(r.headers.get('content-type')).toContain('text/csv');
        expect(r.headers.get('content-disposition')).toBe('attachment; filename="sales-2026.csv"');
        expect(r.headers.get('cache-control')).toBe('no-store');
        expect(r.headers.get('x-content-type-options')).toBe('nosniff');
        expect(await r.text()).toBe(csv);
        // un nombre de archivo raro del backend no se refleja
        fetchMock.mockResolvedValueOnce(new Response('a', { status: 200, headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="../../x.csv"' } }));
        const r2 = await get('export', '?kind=ledger');
        expect(r2.headers.get('content-disposition')).toBe('attachment; filename="bloomx-ledger.csv"');
    });
    it('toda respuesta lleva Cache-Control: no-store', async () => {
        expect((await get('status')).headers.get('cache-control')).toBe('no-store');
        fetchMock.mockResolvedValueOnce(backendOk({ error: 'not_for_sale' }, 400));
        expect((await post('orders', { extensionId: 'x' })).headers.get('cache-control')).toBe('no-store');
    });
});

describe('auditoria', () => {
    it('las escrituras se auditan con ids y estado; nunca con el cuerpo ni secretos', async () => {
        await post('orders', { extensionId: 'ext-1', plan: 'year' });
        await get('export', '?kind=sales');
        const events = auditLog.mock.calls.map((c) => c[0]);
        expect(events).toContain('admin.billing.orders');
        expect(events).toContain('admin.billing.export');
        const payload = JSON.stringify(auditLog.mock.calls);
        expect(payload).not.toContain('PRIVATE KEY');
        expect(payload).not.toContain('"plan"');
        expect(auditLog.mock.calls.find((c) => c[0] === 'admin.billing.orders')![1]).toMatchObject({ status: 200, outcome: 'ok' });
    });
    it('las lecturas normales no llenan el registro', async () => {
        await get('summary');
        await get('payouts');
        expect(auditLog).not.toHaveBeenCalled();
    });
});
