import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

async function load(opts: { valid?: boolean; recipient?: string; recordFails?: boolean } = {}) {
    vi.resetModules();
    const record = vi.fn(async () => { if (opts.recordFails) throw new Error('db'); });
    vi.doMock('@/lib/prisma', () => ({ prisma: { user: { findUnique: async () => ({ name: 'Acme <b>Corp</b>', email: 'me@acme.com' }) } } }));
    vi.doMock('@/lib/unsubscribe', () => ({
        recordUnsubscribe: record,
        verifyUnsubscribeToken: (t: string) => (opts.valid === false || t !== 'good' ? null : { sender: 'u1', recipient: opts.recipient ?? 'ana@x.com' }),
    }));
    vi.doMock('@/lib/security', () => ({ getClientIp: () => '1.1.1.1', rateLimit: () => ({ ok: true, retryAfter: 0 }) }));
    const mod = await import('./route');
    const { NextRequest } = await import('next/server');
    const req = (method: string, qs = 't=good', headers: Record<string, string> = {}) =>
        new NextRequest(`http://localhost/api/webhooks/unsubscribe?${qs}`, { method, headers });
    return { mod, req, record };
}

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

describe('/api/webhooks/unsubscribe', () => {
    it('GET muestra confirmacion y NO da de baja (los escaneres de enlaces no deben activarla)', async () => {
        const { mod, req, record } = await load();
        const res = await mod.GET(req('GET'));
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('<form method="POST"');
        expect(html).toContain('ana@x.com');
        expect(html).toContain('<html lang="en">');
        expect(record).not.toHaveBeenCalled();
        expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    });

    it('idioma: Accept-Language es / ?lang=', async () => {
        const { mod, req } = await load();
        const es = await (await mod.GET(req('GET', 't=good', { 'accept-language': 'es-PE,es;q=0.9' }))).text();
        expect(es).toContain('lang="es"');
        expect(es).toContain('Confirmar baja');
        const en = await (await mod.GET(req('GET', 't=good&lang=en', { 'accept-language': 'es' }))).text();
        expect(en).toContain('Confirm unsubscribe');
    });

    it('escapa el nombre del remitente y el email (sin XSS)', async () => {
        const { mod, req } = await load({ recipient: '"><img src=x onerror=alert(1)>@x.com' });
        const html = await (await mod.GET(req('GET'))).text();
        expect(html).not.toContain('<img');
        expect(html).not.toContain('<b>Corp');
        expect(html).toContain('&lt;b&gt;Corp&lt;/b&gt;');
    });

    it('enlace invalido -> 400 legible', async () => {
        const { mod, req } = await load();
        const res = await mod.GET(req('GET', 't=bad'));
        expect(res.status).toBe(400);
        expect(await res.text()).toContain('Invalid link');
        expect((await (await mod.POST(req('POST', 't=bad'))).text())).toContain('Invalid link');
    });

    it('POST registra la baja (one-click RFC 8058 y formulario) y confirma', async () => {
        const { mod, req, record } = await load();
        const res = await mod.POST(req('POST', 't=good&lang=es'));
        expect(res.status).toBe(200);
        expect(record).toHaveBeenCalledWith('u1', 'ana@x.com');
        const html = await res.text();
        expect(html).toContain('te has dado de baja');
    });

    it('fallo de BD -> 500 con mensaje, sin filtrar detalles', async () => {
        const { mod, req } = await load({ recordFails: true });
        const res = await mod.POST(req('POST'));
        expect(res.status).toBe(500);
        expect(await res.text()).not.toContain('db');
    });
});
