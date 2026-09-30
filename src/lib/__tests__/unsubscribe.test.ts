import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

async function load(events: Array<{ data: unknown }> = [], fail = false) {
    vi.resetModules();
    vi.stubEnv('UNSUBSCRIBE_SECRET', 'test-secret');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com/');
    const created: any[] = [];
    vi.doMock('@/lib/prisma', () => ({
        prisma: {
            emailEvent: {
                findFirst: async ({ where }: any) => {
                    const rcpt = where.AND[1].data.equals;
                    return events.find(e => (e.data as any).recipient === rcpt) ? { id: '1' } : null;
                },
                findMany: async () => { if (fail) throw new Error('db down'); return events; },
                create: async (a: any) => { created.push(a); return {}; },
            },
        },
    }));
    const mod = await import('../unsubscribe');
    return { mod, created };
}

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
beforeEach(() => {});

describe('token de baja', () => {
    it('ida y vuelta, normaliza a minusculas y rechaza manipulacion', async () => {
        const { mod } = await load();
        const t = mod.createUnsubscribeToken('u1', ' Ana@X.com ')!;
        expect(mod.verifyUnsubscribeToken(t)).toEqual({ sender: 'u1', recipient: 'ana@x.com' });
        const [p, s] = t.split('.');
        expect(mod.verifyUnsubscribeToken(`${p}.${s}x`)).toBeNull();
        const forged = Buffer.from(JSON.stringify({ s: 'u2', r: 'ana@x.com' })).toString('base64url');
        expect(mod.verifyUnsubscribeToken(`${forged}.${s}`)).toBeNull();
        expect(mod.verifyUnsubscribeToken('basura')).toBeNull();
        expect(mod.verifyUnsubscribeToken('a'.repeat(2000))).toBeNull();
    });
    it('URLs y cabeceras RFC 8058 (solo https)', async () => {
        const { mod } = await load();
        const url = mod.buildAbsoluteUnsubscribeUrl('u1', 'a@x.com')!;
        expect(url.startsWith('https://app.example.com/api/webhooks/unsubscribe?t=')).toBe(true);
        const h = mod.buildUnsubscribeHeaders('u1', 'a@x.com', 'me@brand.com')!;
        expect(h['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
        expect(h['List-Unsubscribe']).toContain('mailto:me@brand.com');
    });
    it('sin base https no hay cabeceras ni URL absoluta', async () => {
        vi.resetModules();
        vi.stubEnv('UNSUBSCRIBE_SECRET', 's');
        vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://insegura.local');
        vi.doMock('@/lib/prisma', () => ({ prisma: {} }));
        const mod = await import('../unsubscribe');
        expect(mod.buildUnsubscribeHeaders('u', 'a@x.com', 'm@x.com')).toBeNull();
        expect(mod.buildAbsoluteUnsubscribeUrl('u', 'a@x.com')).toMatch(/^http:\/\//);
    });
});

describe('lista de supresion', () => {
    it('filterSuppressed separa permitidos y suprimidos (incluye formato "Nombre <mail>")', async () => {
        const { mod } = await load([{ data: { recipient: 'baja@x.com' } }]);
        const r = await mod.filterSuppressed('u1', ['ok@x.com', 'Baja <BAJA@x.com>', 'otro@x.com']);
        expect(r.allowed).toEqual(['ok@x.com', 'otro@x.com']);
        expect(r.suppressed).toEqual(['Baja <BAJA@x.com>']);
        expect(r.error).toBeUndefined();
    });
    it('si la consulta falla lo informa (el llamador decide: Elixir cierra en falso)', async () => {
        const { mod } = await load([], true);
        const r = await mod.filterSuppressed('u1', ['a@x.com']);
        expect(r.error).toBe('suppression_lookup_failed');
    });
    it('recordUnsubscribe es idempotente y guarda el motivo', async () => {
        const { mod, created } = await load([{ data: { recipient: 'ya@x.com' } }]);
        await mod.recordUnsubscribe('u1', 'YA@x.com');
        expect(created).toHaveLength(0);
        await mod.recordUnsubscribe('u1', 'Nuevo@X.com', 'complaint');
        expect(created[0].data.data).toEqual({ sender: 'u1', recipient: 'nuevo@x.com', reason: 'complaint' });
    });
});
