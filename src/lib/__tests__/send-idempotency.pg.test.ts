import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { assertLocalPg, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';

// Idempotencia de envios contra Postgres real: POST /api/emails (Idempotency-Key -> EmailEvent send_idem:*),
// Elixir (elixir_send + Idempotency-Key hacia Resend) y lista de bajas (EmailEvent unsubscribe, consultas jsonb path).

let sessionUser: { id: string; email: string; name: string } | null = null;
const resendSend = vi.fn();
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => sessionUser }));
vi.mock('@/lib/resend', () => ({ resend: { emails: { send: (...a: unknown[]) => resendSend(...a) } } }));
vi.mock('@/lib/storage', () => ({ uploadToStorage: vi.fn(async () => undefined), getBufferFromStorage: vi.fn(async () => null) }));
vi.mock('@/lib/expansions/server-hooks', () => ({
    runEmailPreSendHooksForRequest: async () => ({ stop: false, modify: {}, warnings: [] }),
}));

let me: { id: string; email: string; name: string };

beforeAll(async () => {
    assertLocalPg();
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret-for-unsubscribe-tokens');
    for (const m of ['log', 'error', 'warn'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
    const u = await createUser(prisma);
    me = { id: u.id, email: u.email, name: 'Yo' };
});
beforeEach(() => {
    sessionUser = me;
    resendSend.mockReset();
    let n = 0;
    resendSend.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 60)); // latencia de red: ventana para la carrera
        return { data: { id: `re_${uid('r')}_${++n}` }, error: null };
    });
});
afterAll(async () => { vi.unstubAllEnvs(); await prisma.$disconnect(); });

const postEmail = async (idemKey: string | null, over: Record<string, unknown> = {}) => {
    const { POST } = await import('../../app/api/emails/route');
    const res = await POST(new NextRequest('http://localhost/api/emails', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(idemKey ? { 'idempotency-key': idemKey } : {}) },
        body: JSON.stringify({ to: 'dest@ext.test', subject: 'Hola', html: '<p>hola</p>', text: 'hola', ...over }),
    }));
    return { status: res.status, body: await res.json() };
};

describe('POST /api/emails con Idempotency-Key', () => {
    it('reintento secuencial: no reenvia y devuelve el id original con duplicate=true', async () => {
        const key = `k-${uid('seq')}`;
        const a = await postEmail(key);
        expect(a.status).toBe(200);
        const b = await postEmail(key);
        expect(b.body).toMatchObject({ success: true, duplicate: true, id: a.body.id });
        expect(resendSend).toHaveBeenCalledTimes(1);
        const ev = await prisma.emailEvent.findMany({ where: { type: `send_idem:${me.id}:${key}` } });
        expect(ev).toHaveLength(1);
        expect(ev[0].resendEmailId).toBe(a.body.id);
        expect(ev[0].emailId).toBeTruthy();
    });

    it('claves distintas o sin clave envian cada vez', async () => {
        await postEmail(`k-${uid('a')}`);
        await postEmail(`k-${uid('b')}`);
        await postEmail(null);
        await postEmail(null);
        expect(resendSend).toHaveBeenCalledTimes(4);
    });

    it('la misma clave en usuarios distintos no colisiona', async () => {
        const other = await createUser(prisma);
        const key = `k-${uid('shared')}`;
        await postEmail(key);
        sessionUser = { id: other.id, email: other.email, name: 'Otro' };
        const r = await postEmail(key);
        expect(r.body.duplicate).toBeUndefined();
        expect(resendSend).toHaveBeenCalledTimes(2);
    });

    it('CARRERA: dos peticiones simultaneas con la misma clave envian UN solo correo', async () => {
        const key = `k-${uid('race')}`;
        const results = await Promise.all([postEmail(key), postEmail(key), postEmail(key)]);
        expect(resendSend).toHaveBeenCalledTimes(1);
        for (const r of results) expect([200, 425]).toContain(r.status);
        expect(results.filter((r) => r.status === 200 && !r.body.duplicate)).toHaveLength(1);
        expect(await prisma.emailEvent.count({ where: { type: `send_idem:${me.id}:${key}` } })).toBe(1);
        expect(await prisma.email.count({ where: { userId: me.id, subject: 'Hola', messageId: { in: results.map((r) => r.body.id).filter(Boolean) } } })).toBe(1);
    });

    it('si Resend falla, la clave queda libre y el reintento SI envia', async () => {
        const key = `k-${uid('fail')}`;
        resendSend.mockReset();
        resendSend.mockResolvedValueOnce({ data: null, error: { name: 'application_error', message: 'boom' } });
        expect((await postEmail(key)).status).toBe(400);
        resendSend.mockResolvedValue({ data: { id: 're_ok' }, error: null });
        const retry = await postEmail(key);
        expect(retry.status).toBe(200);
        expect(retry.body.id).toBe('re_ok');
        expect(retry.body.duplicate).toBeUndefined();
    });
});

describe('lista de bajas (EmailEvent unsubscribe, consultas jsonb path)', () => {
    it('recordUnsubscribe es idempotente y getSuppressedRecipients/isSuppressed leen por jsonb path', async () => {
        const { recordUnsubscribe, getSuppressedRecipients, isSuppressed, filterSuppressed } = await import('../unsubscribe');
        const s = uid('sender');
        await recordUnsubscribe(s, ' Baja@Ext.Test ');
        await recordUnsubscribe(s, 'baja@ext.test');
        await recordUnsubscribe(s, 'otra@ext.test', 'bounce');
        await recordUnsubscribe(uid('otro-remitente'), 'ajena@ext.test');
        expect(await prisma.emailEvent.count({ where: { type: 'unsubscribe', data: { path: ['sender'], equals: s } } })).toBe(2);
        expect(await getSuppressedRecipients(s)).toEqual(new Set(['baja@ext.test', 'otra@ext.test']));
        expect(await isSuppressed(s, 'BAJA@ext.test')).toBe(true);
        expect(await isSuppressed(s, 'ajena@ext.test')).toBe(false);
        expect(await filterSuppressed(s, ['Baja <baja@ext.test>', 'ok@ext.test'])).toEqual({ allowed: ['ok@ext.test'], suppressed: ['Baja <baja@ext.test>'] });
    });
});

describe('POST /api/elixir/send contra Postgres', () => {
    const fetchCalls: Array<{ headers: Record<string, string>; body: any }> = [];
    beforeEach(() => {
        fetchCalls.length = 0;
        vi.stubEnv('RESEND_API_KEY', 're_test');
        vi.stubEnv('ELIXIR_SEND_INTERVAL_MS', '1');
        vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
            fetchCalls.push({ headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
            return new Response(JSON.stringify({ id: `el_${fetchCalls.length}_${uid('x')}` }), { status: 200 });
        }));
    });

    const postElixir = async (campaignId: string, emails: string[]) => {
        const { POST } = await import('../../app/api/elixir/send/route');
        const res = await POST(new NextRequest('http://localhost/api/elixir/send', {
            method: 'POST',
            headers: { 'x-forwarded-for': `10.7.${Math.floor(Math.random() * 250)}.1` },
            body: JSON.stringify({
                campaignId, template: '<p>Hola {{ nombre }}</p>', subject: 'Hola {{ nombre }}', recipientColumn: 'email',
                items: emails.map((email, index) => ({ index, row: { email, nombre: 'N' } })),
            }),
        }));
        return { status: res.status, body: await res.json() };
    };

    it('registra EmailEvent elixir_send (jsonb) y un reintento de la campana no reenvia', async () => {
        const campaign = `camp-${uid('c')}`.slice(0, 40);
        const first = await postElixir(campaign, ['uno@x.test', 'dos@x.test']);
        expect(first.body.results.map((r: any) => r.status)).toEqual(['sent', 'sent']);
        expect(fetchCalls).toHaveLength(2);
        expect(fetchCalls[0].headers['Idempotency-Key']).toMatch(new RegExp(`^elixir-${campaign}-`));
        const evs = await prisma.emailEvent.findMany({ where: { type: 'elixir_send', data: { path: ['campaign'], equals: campaign } } });
        expect(evs.map((e) => (e.data as any).recipient).sort()).toEqual(['dos@x.test', 'uno@x.test']);
        expect(evs.every((e) => (e.data as any).sender === me.id && e.resendEmailId)).toBe(true);

        // Reintento tras un corte: mismos destinatarios + uno nuevo
        fetchCalls.length = 0;
        const again = await postElixir(campaign, ['uno@x.test', 'dos@x.test', 'tres@x.test']);
        expect(again.body.results.map((r: any) => [r.email, r.status, r.code])).toEqual([
            ['uno@x.test', 'sent', 'already_sent'], ['dos@x.test', 'sent', 'already_sent'], ['tres@x.test', 'sent', undefined],
        ]);
        expect(fetchCalls).toHaveLength(1);
        expect(fetchCalls[0].body.to).toEqual(['tres@x.test']);
    });

    it('otra campana o otro remitente no se considera ya-enviado', async () => {
        const c1 = `camp-${uid('a')}`.slice(0, 40);
        const c2 = `camp-${uid('b')}`.slice(0, 40);
        await postElixir(c1, ['mismo@x.test']);
        fetchCalls.length = 0;
        await postElixir(c2, ['mismo@x.test']);
        expect(fetchCalls).toHaveLength(1);
        // mismo campaignId pero otro usuario
        const other = await createUser(prisma);
        sessionUser = { id: other.id, email: other.email, name: 'Otro' };
        fetchCalls.length = 0;
        await postElixir(c1, ['mismo@x.test']);
        expect(fetchCalls).toHaveLength(1);
    });

    it('respeta la lista de bajas real (status unsubscribed, sin llamada a Resend)', async () => {
        const { recordUnsubscribe } = await import('../unsubscribe');
        await recordUnsubscribe(me.id, 'baja2@x.test');
        const r = await postElixir(`camp-${uid('u')}`.slice(0, 40), ['baja2@x.test', 'ok2@x.test']);
        expect(r.body.results.map((x: any) => x.status)).toEqual(['unsubscribed', 'sent']);
        expect(fetchCalls.map((c) => c.body.to[0])).toEqual(['ok2@x.test']);
    });
});
