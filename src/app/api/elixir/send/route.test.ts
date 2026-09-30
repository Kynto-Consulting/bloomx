import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Pruebas del endpoint de envio por lotes con TODO mockeado (sin BD ni Resend reales):
 * sesion, prisma, lista de bajas y `fetch` hacia Resend.
 */

type FetchCall = { url: string; init: RequestInit; body: Record<string, any> };

const USER = { id: 'u1', email: 'me@brand.com', name: 'Me', accounts: [] as Array<{ providerAccountId: string }> };

async function loadRoute(opts: {
    env?: Record<string, string>;
    session?: boolean;
    suppressed?: string[];
    alreadySent?: string[];
    resend?: (call: FetchCall, n: number) => Response;
} = {}) {
    vi.resetModules();
    for (const [k, v] of Object.entries({ RESEND_API_KEY: 're_test', ELIXIR_SEND_INTERVAL_MS: '1', ...(opts.env ?? {}) })) vi.stubEnv(k, v);
    const calls: FetchCall[] = [];
    const created: any[] = [];
    vi.doMock('@/lib/session', () => ({ getCurrentUser: async () => (opts.session === false ? null : { id: USER.id }) }));
    vi.doMock('@/lib/prisma', () => ({
        prisma: {
            user: { findUnique: async () => USER },
            emailEvent: {
                findMany: async () => (opts.alreadySent ?? []).map(r => ({ data: { recipient: r } })),
                create: async (a: any) => { created.push(a); return {}; },
            },
        },
    }));
    vi.doMock('@/lib/unsubscribe', () => ({
        getSuppressedRecipients: async () => new Set((opts.suppressed ?? []).map(s => s.toLowerCase())),
        buildAbsoluteUnsubscribeUrl: (_s: string, r: string) => `https://app.test/unsub?r=${encodeURIComponent(r)}`,
        buildUnsubscribeHeaders: (_s: string, r: string) => ({ 'List-Unsubscribe': `<https://app.test/unsub?r=${r}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }),
    }));
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
        const call = { url, init, body: JSON.parse(String(init.body)) } as FetchCall;
        calls.push(call);
        return opts.resend ? opts.resend(call, n++) : new Response(JSON.stringify({ id: `id${n++}` }), { status: 200 });
    }));
    const mod = await import('./route');
    const { NextRequest } = await import('next/server');
    const post = (body: unknown) => mod.POST(new NextRequest('http://localhost/api/elixir/send', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));
    return { post, calls, created };
}

const base = {
    campaignId: 'camp-12345678',
    template: '<p>Hola {{ nombre }}</p>',
    subject: 'Hola {{ nombre }}',
    recipientColumn: 'email',
};
const items = (rows: Array<Record<string, string>>) => rows.map((row, index) => ({ index, row }));

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

describe('POST /api/elixir/send', () => {
    it('401 sin sesion y 400 con JSON/payload invalido', async () => {
        expect((await (await loadRoute({ session: false })).post(base)).status).toBe(401);
        const { post } = await loadRoute();
        expect((await post('{no json')).status).toBe(400);
        const r = await post({ ...base, items: [] });
        expect(r.status).toBe(400);
        expect((await r.json()).code).toBe('invalid_payload');
        expect((await post({ ...base, campaignId: 'x', items: items([{ email: 'a@b.co', nombre: 'A' }]) })).status).toBe(400);
    });

    it('envia, con Idempotency-Key, cabeceras de baja, texto plano, pie de baja y HTML escapado', async () => {
        const { post, calls, created } = await loadRoute();
        const res = await post({ ...base, items: items([{ email: 'ana@x.com', nombre: '<script>x</script>' }]) });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.results).toEqual([{ index: 0, email: 'ana@x.com', status: 'sent' }]);
        expect(json.pending).toEqual([]);
        expect(calls).toHaveLength(1);
        const h = calls[0].init.headers as Record<string, string>;
        expect(h['Idempotency-Key']).toMatch(/^elixir-camp-12345678-/);
        expect(h.Authorization).toBe('Bearer re_test');
        const b = calls[0].body;
        expect(b.to).toEqual(['ana@x.com']);
        expect(b.from).toBe('Me <me@brand.com>');
        expect(b.html).toContain('&lt;script&gt;x&lt;/script&gt;');
        expect(b.html).not.toContain('<script>');
        expect(b.html).toContain('https://app.test/unsub?r=ana%40x.com'); // pie de baja automatico
        expect(b.text).toContain('Hola');
        expect(b.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
        expect(created).toHaveLength(1);
        expect(created[0].data.type).toBe('elixir_send');
    });

    it('unsubscribe_url en la plantilla evita el pie automatico', async () => {
        const { post, calls } = await loadRoute();
        await post({ ...base, template: '<a href="{{ unsubscribe_url }}">baja</a>', items: items([{ email: 'ana@x.com', nombre: 'A' }]) });
        expect((calls[0].body.html.match(/unsub\?r=/g) ?? []).length).toBe(1);
    });

    it('resultado por fila: invalido, duplicado, dado de baja, ya enviado', async () => {
        const { post, calls } = await loadRoute({ suppressed: ['Baja@x.com'], alreadySent: ['ya@x.com'] });
        const res = await post({
            ...base,
            items: items([
                { email: 'ok@x.com', nombre: 'Ok' },
                { email: 'no-es-email', nombre: 'N' },
                { email: 'OK@x.com', nombre: 'Dup' },
                { email: 'baja@x.com', nombre: 'B' },
                { email: 'ya@x.com', nombre: 'Y' },
            ]),
        });
        const { results } = await res.json();
        expect(results.map((r: any) => [r.index, r.status, r.code])).toEqual([
            [0, 'sent', undefined],
            [1, 'skipped', 'invalid_email'],
            [2, 'skipped', 'duplicate'],
            [3, 'unsubscribed', 'unsubscribed'],
            [4, 'sent', 'already_sent'],
        ]);
        expect(calls).toHaveLength(1); // solo ok@x.com llega a Resend
    });

    it('error de sintaxis de plantilla -> 422 y NO se envia nada', async () => {
        const { post, calls } = await loadRoute();
        const res = await post({ ...base, template: '{% if nombre %}sin cerrar', items: items([{ email: 'a@x.com', nombre: 'A' }]) });
        expect(res.status).toBe(422);
        const j = await res.json();
        expect(j.code).toBe('template_error');
        expect(j.field).toBe('template');
        expect(j.details.code).toBe('syntax');
        expect(calls).toHaveLength(0);
        const res2 = await post({ ...base, subject: '{{ a | filtro_inexistente }}', items: items([{ email: 'a@x.com', nombre: 'A' }]) });
        expect(res2.status).toBe(422);
        expect((await res2.json()).field).toBe('subject');
    });

    it('fallo de render por fila (variable inexistente) -> fila en error, NUNCA se envia plantilla cruda', async () => {
        const { post, calls } = await loadRoute();
        const res = await post({
            ...base,
            template: '<p>{{ nombre }} {{ apellido }}</p>',
            items: items([{ email: 'a@x.com', nombre: 'A', apellido: 'P' }, { email: 'b@x.com', nombre: 'B' }]),
        });
        const { results } = await res.json();
        expect(results[0].status).toBe('sent');
        expect(results[1]).toMatchObject({ status: 'error', code: 'liquid_undefined_variable' });
        expect(results[1].message).toMatch(/apellido/);
        expect(calls).toHaveLength(1);
        expect(JSON.stringify(calls[0].body)).not.toContain('{{');
    });

    it('sender no autorizado por fila (remitente renderizado desde datos)', async () => {
        const { post, calls } = await loadRoute();
        const res = await post({
            ...base,
            senderConfig: { fromEmail: '{{ remitente }}' },
            items: items([{ email: 'a@x.com', nombre: 'A', remitente: 'ceo@otra.com' }, { email: 'b@x.com', nombre: 'B', remitente: 'me@brand.com' }]),
        });
        const { results } = await res.json();
        expect(results[0]).toMatchObject({ status: 'error', code: 'unauthorized_sender' });
        expect(results[1].status).toBe('sent');
        expect(calls).toHaveLength(1);
    });

    it('fromEmail literal ajeno -> 401', async () => {
        const { post } = await loadRoute();
        const res = await post({ ...base, senderConfig: { fromEmail: 'ceo@otra.com' }, items: items([{ email: 'a@x.com', nombre: 'A' }]) });
        expect(res.status).toBe(401);
    });

    it('429 de Resend: reintenta con backoff y termina enviando con la misma Idempotency-Key', async () => {
        const { post, calls } = await loadRoute({
            resend: (_c, n) => (n === 0
                ? new Response(JSON.stringify({ name: 'rate_limit_exceeded', message: 'slow down' }), { status: 429, headers: { 'retry-after': '0' } })
                : new Response(JSON.stringify({ id: 'ok' }), { status: 200 })),
        });
        const res = await post({ ...base, items: items([{ email: 'a@x.com', nombre: 'A' }]) });
        const j = await res.json();
        expect(j.results[0].status).toBe('sent');
        expect(calls).toHaveLength(2);
        const keys = calls.map(c => (c.init.headers as Record<string, string>)['Idempotency-Key']);
        expect(keys[0]).toBe(keys[1]);
    }, 15_000);

    it('error de validacion de Resend (422) -> fila error con el mensaje, sin reintentos', async () => {
        const { post, calls } = await loadRoute({ resend: () => new Response(JSON.stringify({ name: 'validation_error', message: 'Dominio no verificado' }), { status: 403 }) });
        const j = await (await post({ ...base, items: items([{ email: 'a@x.com', nombre: 'A' }]) })).json();
        expect(j.results[0]).toMatchObject({ status: 'error', code: 'send_failed', message: 'Dominio no verificado' });
        expect(calls).toHaveLength(1);
    });

    it('sin presupuesto de tiempo: las filas quedan en pending (nada se pierde ni se marca error)', async () => {
        const { post, calls } = await loadRoute({ env: { ELIXIR_BATCH_BUDGET_MS: '1' } });
        const j = await (await post({ ...base, items: items([{ email: 'a@x.com', nombre: 'A' }, { email: 'b@x.com', nombre: 'B' }]) })).json();
        expect(j.results).toEqual([]);
        expect(j.pending).toEqual([0, 1]);
        expect(calls).toHaveLength(0);
    });

    it('cuota horaria agotada: pausa con pending y retryAfterMs', async () => {
        const { post, calls } = await loadRoute({ env: { ELIXIR_MAX_ROWS_PER_HOUR: '1' } });
        const j = await (await post({ ...base, items: items([{ email: 'a@x.com', nombre: 'A' }, { email: 'b@x.com', nombre: 'B' }, { email: 'c@x.com', nombre: 'C' }]) })).json();
        expect(j.results).toHaveLength(1);
        expect(j.pending).toEqual([1, 2]);
        expect(j.paused).toBe('quota');
        expect(j.retryAfterMs).toBeGreaterThan(0);
        expect(calls).toHaveLength(1);
    });

    it('rate limit persistente de Resend agota intentos -> pending con retryAfterMs (no error definitivo)', async () => {
        const { post } = await loadRoute({
            env: { ELIXIR_BATCH_BUDGET_MS: '5000' },
            resend: () => new Response(JSON.stringify({ name: 'rate_limit_exceeded', message: 'x' }), { status: 429, headers: { 'retry-after': '60' } }),
        });
        const j = await (await post({ ...base, items: items([{ email: 'a@x.com', nombre: 'A' }, { email: 'b@x.com', nombre: 'B' }]) })).json();
        expect(j.results).toEqual([]);
        expect(j.pending).toEqual([0, 1]);
        expect(j.retryAfterMs).toBeGreaterThanOrEqual(60_000);
    });

    it('cc/bcc excluyen destinatarios dados de baja', async () => {
        const { post, calls } = await loadRoute({ suppressed: ['nocc@x.com'] });
        await post({ ...base, senderConfig: { cc: 'nocc@x.com, ok@x.com' }, items: items([{ email: 'a@x.com', nombre: 'A' }]) });
        expect(calls[0].body.cc).toEqual(['ok@x.com']);
    });
});
