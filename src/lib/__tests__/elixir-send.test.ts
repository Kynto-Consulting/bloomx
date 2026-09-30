import { describe, it, expect, vi } from 'vitest';
import {
    sendWithRetry, isRetryable, parseRetryAfter, idempotencyKey, createResendSender, htmlToText,
    appendUnsubscribeFooter, templateHasUnsubscribe, type SendOutcome,
} from '../elixir-send';

const noSleep = () => vi.fn(async (_ms: number) => {});
const fixedRandom = () => 0.5; // jitter neutro: factor 1.0

function scripted(outcomes: Array<SendOutcome | Error>) {
    let i = 0;
    return vi.fn(async (): Promise<SendOutcome> => {
        const o = outcomes[Math.min(i++, outcomes.length - 1)];
        if (o instanceof Error) throw o;
        return o;
    });
}

describe('sendWithRetry', () => {
    it('exito a la primera', async () => {
        const fn = scripted([{ ok: true, id: 'e1' }]);
        const sleep = noSleep();
        expect(await sendWithRetry(fn, { sleep })).toEqual({ kind: 'sent', id: 'e1', attempts: 1 });
        expect(sleep).not.toHaveBeenCalled();
    });

    it('reintenta ante 429 con backoff exponencial y termina enviando', async () => {
        const fn = scripted([
            { ok: false, message: 'rate', statusCode: 429, name: 'rate_limit_exceeded' },
            { ok: false, message: 'rate', statusCode: 429 },
            { ok: true, id: 'e2' },
        ]);
        const sleep = noSleep();
        const r = await sendWithRetry(fn, { sleep, random: fixedRandom, baseDelayMs: 100 });
        expect(r).toEqual({ kind: 'sent', id: 'e2', attempts: 3 });
        expect(sleep.mock.calls.map(c => c[0])).toEqual([100, 200]);
    });

    it('respeta Retry-After cuando es mayor que el backoff', async () => {
        const fn = scripted([{ ok: false, message: 'x', statusCode: 429, retryAfterMs: 5000 }, { ok: true }]);
        const sleep = noSleep();
        await sendWithRetry(fn, { sleep, random: fixedRandom, baseDelayMs: 100 });
        expect(sleep.mock.calls[0][0]).toBe(5000);
    });

    it('el backoff se acota a maxDelayMs', async () => {
        const fn = scripted([
            { ok: false, message: 'x', statusCode: 503 }, { ok: false, message: 'x', statusCode: 503 },
            { ok: false, message: 'x', statusCode: 503 }, { ok: true },
        ]);
        const sleep = noSleep();
        await sendWithRetry(fn, { sleep, random: fixedRandom, baseDelayMs: 1000, maxDelayMs: 1500, maxAttempts: 5 });
        expect(sleep.mock.calls.map(c => c[0])).toEqual([1000, 1500, 1500]);
    });

    it('errores no reintentables (400/422/403) fallan de inmediato', async () => {
        for (const statusCode of [400, 401, 403, 422]) {
            const fn = scripted([{ ok: false, message: 'malo', statusCode, name: 'validation_error' }]);
            const sleep = noSleep();
            expect(await sendWithRetry(fn, { sleep })).toEqual({ kind: 'error', message: 'malo', attempts: 1, retryable: false });
            expect(fn).toHaveBeenCalledTimes(1);
            expect(sleep).not.toHaveBeenCalled();
        }
    });

    it('errores de red (excepcion) se reintentan', async () => {
        const fn = scripted([new Error('ECONNRESET'), { ok: true, id: 'e3' }]);
        const r = await sendWithRetry(fn, { sleep: noSleep(), random: fixedRandom });
        expect(r).toMatchObject({ kind: 'sent', attempts: 2 });
    });

    it('agota intentos -> defer (no error definitivo), con retryAfterMs', async () => {
        const fn = scripted([{ ok: false, message: 'saturado', statusCode: 429 }]);
        const r = await sendWithRetry(fn, { sleep: noSleep(), random: fixedRandom, baseDelayMs: 100, maxAttempts: 3 });
        expect(r.kind).toBe('defer');
        expect(fn).toHaveBeenCalledTimes(3);
        if (r.kind === 'defer') { expect(r.message).toBe('saturado'); expect(r.retryAfterMs).toBeGreaterThan(0); }
    });

    it('si el reintento no cabe antes del deadline -> defer sin dormir', async () => {
        let t = 1000;
        const fn = scripted([{ ok: false, message: 'x', statusCode: 429, retryAfterMs: 10_000 }, { ok: true }]);
        const sleep = noSleep();
        const r = await sendWithRetry(fn, { sleep, now: () => t, deadline: 5000, random: fixedRandom });
        expect(r.kind).toBe('defer');
        expect(sleep).not.toHaveBeenCalled();
        expect(fn).toHaveBeenCalledTimes(1);
        if (r.kind === 'defer') expect(r.retryAfterMs).toBeGreaterThanOrEqual(10_000);
        t += 1;
    });

    it('409 concurrent_idempotent_requests es reintentable; invalid_idempotent_request no', () => {
        expect(isRetryable({ ok: false, message: '', statusCode: 409, name: 'concurrent_idempotent_requests' })).toBe(true);
        expect(isRetryable({ ok: false, message: '', statusCode: 409, name: 'invalid_idempotent_request' })).toBe(false);
        expect(isRetryable({ ok: false, message: '', statusCode: 500 })).toBe(true);
        expect(isRetryable({ ok: false, message: '', statusCode: 404 })).toBe(false);
        expect(isRetryable({ ok: false, message: '' })).toBe(false);
    });
});

describe('parseRetryAfter', () => {
    it('segundos, fecha HTTP y valores invalidos', () => {
        expect(parseRetryAfter('2')).toBe(2000);
        expect(parseRetryAfter('0')).toBe(0);
        expect(parseRetryAfter(null)).toBeUndefined();
        expect(parseRetryAfter('abc')).toBeUndefined();
        const now = Date.parse('2025-01-01T00:00:00Z');
        expect(parseRetryAfter('Wed, 01 Jan 2025 00:00:10 GMT', now)).toBe(10_000);
        expect(parseRetryAfter('Tue, 31 Dec 2024 00:00:00 GMT', now)).toBe(0);
    });
});

describe('idempotencyKey', () => {
    it('es estable, insensible a mayusculas/espacios y distinta por campana y destinatario', () => {
        const a = idempotencyKey('camp-12345678', 'Ana@X.com');
        expect(a).toBe(idempotencyKey('camp-12345678', ' ana@x.com '));
        expect(a).not.toBe(idempotencyKey('camp-12345678', 'luis@x.com'));
        expect(a).not.toBe(idempotencyKey('camp-87654321', 'ana@x.com'));
        expect(a.length).toBeLessThanOrEqual(256);
        expect(a).toMatch(/^elixir-camp-12345678-[0-9a-f]{40}$/);
    });
});

describe('createResendSender', () => {
    const payload = { from: 'a@x.com', to: ['b@y.com'], subject: 's', html: '<p>h</p>' };
    const mkRes = (status: number, body: unknown, headers: Record<string, string> = {}) =>
        new Response(JSON.stringify(body), { status, headers });

    it('envia Authorization e Idempotency-Key y devuelve el id', async () => {
        const f = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => mkRes(200, { id: 'abc' }));
        const out = await createResendSender('re_test', f as unknown as typeof fetch)(payload, 'KEY1');
        expect(out).toEqual({ ok: true, id: 'abc' });
        const [url, init] = f.mock.calls[0];
        expect(String(url)).toBe('https://api.resend.com/emails');
        const h = (init as RequestInit).headers as Record<string, string>;
        expect(h.Authorization).toBe('Bearer re_test');
        expect(h['Idempotency-Key']).toBe('KEY1');
        expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ subject: 's' });
    });

    it('429 con Retry-After -> outcome reintentable', async () => {
        const f = vi.fn(async () => mkRes(429, { name: 'rate_limit_exceeded', message: 'Too many' }, { 'retry-after': '3' }));
        const out = await createResendSender('k', f as unknown as typeof fetch)(payload, 'K');
        expect(out).toMatchObject({ ok: false, statusCode: 429, name: 'rate_limit_exceeded', retryAfterMs: 3000, message: 'Too many' });
        expect(isRetryable(out as Extract<SendOutcome, { ok: false }>)).toBe(true);
    });

    it('cuerpo de error no JSON y fallo de red', async () => {
        const f1 = vi.fn(async () => new Response('boom', { status: 502 }));
        expect(await createResendSender('k', f1 as unknown as typeof fetch)(payload, 'K')).toMatchObject({ ok: false, statusCode: 502, message: 'Resend respondió 502' });
        const f2 = vi.fn(async () => { throw new Error('socket hang up'); });
        expect(await createResendSender('k', f2 as unknown as typeof fetch)(payload, 'K')).toMatchObject({ ok: false, network: true, message: 'socket hang up' });
    });

    it('sin API key', async () => {
        expect(await createResendSender(undefined)(payload, 'K')).toMatchObject({ ok: false, statusCode: 500 });
    });

    it('integracion: un 429 seguido de 200 termina en sent con la MISMA clave de idempotencia', async () => {
        const keys: string[] = [];
        let n = 0;
        const f = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
            keys.push(((init?.headers ?? {}) as Record<string, string>)['Idempotency-Key']);
            return n++ === 0 ? mkRes(429, { name: 'rate_limit_exceeded', message: 'slow' }, { 'retry-after': '1' }) : mkRes(200, { id: 'ok1' });
        });
        const send = createResendSender('k', f as unknown as typeof fetch);
        const sleep = noSleep();
        const r = await sendWithRetry(() => send(payload, 'STABLE'), { sleep, random: fixedRandom });
        expect(r).toMatchObject({ kind: 'sent', id: 'ok1', attempts: 2 });
        expect(keys).toEqual(['STABLE', 'STABLE']);
        expect(sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(1000);
    });
});

describe('contenido', () => {
    it('htmlToText', () => {
        const t = htmlToText('<style>p{}</style><h1>Hola</h1><p>Uno &amp; dos<br>tres</p><a href="https://x.com/a">Ver</a><ul><li>a</li><li>b</li></ul>');
        expect(t).toContain('Hola');
        expect(t).toContain('Uno & dos\ntres');
        expect(t).toContain('Ver (https://x.com/a)');
        expect(t).toContain('- a');
        expect(t).not.toContain('p{}');
        expect(t).not.toMatch(/<[^>]+>/);
    });
    it('htmlToText con enlace cuyo texto es la URL', () => {
        expect(htmlToText('<a href="https://x.com">https://x.com</a>')).toBe('https://x.com');
    });
    it('appendUnsubscribeFooter inserta antes de </body> y escapa la URL', () => {
        const out = appendUnsubscribeFooter('<html><body><p>x</p></body></html>', 'https://a.com/u?t=1&x="2"', 'es');
        expect(out.indexOf('darte de baja')).toBeLessThan(out.indexOf('</body>'));
        expect(out).toContain('href="https://a.com/u?t=1&amp;x=&quot;2&quot;"');
        expect(appendUnsubscribeFooter('<p>x</p>', 'https://a.com', 'en')).toMatch(/unsubscribe here/);
    });
    it('templateHasUnsubscribe', () => {
        expect(templateHasUnsubscribe('<a href="{{ unsubscribe_url }}">baja</a>')).toBe(true);
        expect(templateHasUnsubscribe('hola')).toBe(false);
    });
});
