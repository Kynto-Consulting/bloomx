import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.setConfig({ testTimeout: 30_000 });

async function load() {
    vi.resetModules();
    const markRow = vi.fn(async () => {});
    const record = vi.fn(async () => {});
    vi.doMock('@/lib/prisma', () => ({ prisma: { emailEvent: { findFirst: async () => null }, email: { findUnique: async () => null } } }));
    vi.doMock('@/lib/unsubscribe', () => ({ recordUnsubscribe: record }));
    vi.doMock('@/lib/elixir-campaign-store', () => ({ findRowByResendId: async () => null, markRowDelivery: markRow }));
    const mod = await import('./route');
    const { NextRequest } = await import('next/server');
    const post = (body: unknown, headers: Record<string, string> = {}) =>
        new NextRequest('http://localhost/api/webhooks/resend-events', {
            method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
        });
    return { mod, post };
}

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetModules(); });

describe('/api/webhooks/resend-events: firma opcional por organizador', () => {
    it('sin RESEND_WEBHOOK_SECRET acepta eventos sin firmar (no responde 503)', async () => {
        vi.stubEnv('RESEND_WEBHOOK_SECRET', '');
        const { mod, post } = await load();
        const res = await mod.POST(post({ type: 'email.opened', data: { email_id: 'e1' } }));
        expect(res.status).toBe(200);
    });

    it('sin secreto y con JSON invalido responde 400', async () => {
        vi.stubEnv('RESEND_WEBHOOK_SECRET', '');
        const { mod, post } = await load();
        const res = await mod.POST(post('{not json'));
        expect(res.status).toBe(400);
    });

    it('con RESEND_WEBHOOK_SECRET exige firma valida: un evento sin firmar se rechaza', async () => {
        vi.stubEnv('RESEND_WEBHOOK_SECRET', 'whsec_' + Buffer.from('secret-for-tests-1234567890').toString('base64'));
        const { mod, post } = await load();
        const res = await mod.POST(post({ type: 'email.bounced', data: { email_id: 'e1' } }));
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).not.toBe(200);
    });
});
