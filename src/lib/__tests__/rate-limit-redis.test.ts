import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRateLimitState, rateLimitAsync, rateLimitResetAsync } from '../security';

const ENV = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'RATE_LIMIT_ON_ERROR', 'RATE_LIMIT_REDIS_TIMEOUT_MS'];
let saved: Record<string, string | undefined> = {};

/** Redis simulado: INCR/PEXPIRE NX/PTTL sobre un Map, con reloj controlado. */
function fakeUpstash() {
    const store = new Map<string, { n: number; expiresAt: number | null }>();
    const calls: Array<{ url: string; body: unknown[][]; auth: string | null }> = [];
    const fn = vi.fn(async (url: string, init: any) => {
        const body = JSON.parse(init.body) as unknown[][];
        calls.push({ url, body, auth: init.headers.Authorization });
        const now = Date.now();
        const out = body.map(([cmd, key, arg, flag]: any) => {
            const cur = store.get(key);
            if (cur && cur.expiresAt !== null && cur.expiresAt <= now) store.delete(key);
            const e = store.get(key);
            if (cmd === 'INCR') {
                const next = { n: (e?.n ?? 0) + 1, expiresAt: e?.expiresAt ?? null };
                store.set(key, next);
                return { result: next.n };
            }
            if (cmd === 'PEXPIRE') {
                if (e && (flag !== 'NX' || e.expiresAt === null)) e.expiresAt = now + Number(arg);
                return { result: e ? 1 : 0 };
            }
            if (cmd === 'PTTL') return { result: e?.expiresAt ? e.expiresAt - now : -1 };
            if (cmd === 'DEL') return { result: store.delete(key) ? 1 : 0 };
            return { error: 'ERR unknown' };
        });
        return new Response(JSON.stringify(out), { status: 200 });
    });
    return { fn, store, calls };
}

beforeEach(() => {
    saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    for (const k of ENV) delete process.env[k];
    __resetRateLimitState();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const k of ENV) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
});

function configure() {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io/';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';
}

describe('rateLimitAsync', () => {
    it('sin Upstash configurado usa memoria (ventana fija)', async () => {
        const f = vi.fn();
        vi.stubGlobal('fetch', f);
        expect((await rateLimitAsync('k', 2, 1000)).ok).toBe(true);
        expect((await rateLimitAsync('k', 2, 1000)).ok).toBe(true);
        const r = await rateLimitAsync('k', 2, 1000);
        expect(r).toMatchObject({ ok: false, backend: 'memory' });
        expect(r.retryAfter).toBeGreaterThanOrEqual(1);
        expect(f).not.toHaveBeenCalled();
    });

    it('con Redis: INCR+PEXPIRE NX+PTTL en una transaccion multi-exec, con Bearer y clave hasheada', async () => {
        configure();
        const up = fakeUpstash();
        vi.stubGlobal('fetch', up.fn);
        const r = await rateLimitAsync('login:acct:alice@example.com', 3, 60_000);
        expect(r).toEqual({ ok: true, retryAfter: 0, backend: 'redis' });
        const call = up.calls[0];
        expect(call.url).toBe('https://example.upstash.io/multi-exec');
        expect(call.auth).toBe('Bearer tok');
        expect(call.body.map((c) => c[0])).toEqual(['INCR', 'PEXPIRE', 'PTTL']);
        expect(call.body[1][3]).toBe('NX');
        expect(String(call.body[0][1])).toMatch(/^bloomx:rl:[0-9a-f]{40}$/);
        expect(JSON.stringify(call.body)).not.toContain('alice');
    });

    it('bloquea al superar el limite y calcula Retry-After con el PTTL; la ventana no se estira', async () => {
        configure();
        vi.stubGlobal('fetch', fakeUpstash().fn);
        for (let i = 0; i < 3; i++) expect((await rateLimitAsync('a', 3, 60_000)).ok).toBe(true);
        vi.setSystemTime(Date.now() + 20_000);
        const blocked = await rateLimitAsync('a', 3, 60_000);
        expect(blocked.ok).toBe(false);
        expect(blocked.retryAfter).toBe(40);
        vi.setSystemTime(Date.now() + 41_000);
        expect((await rateLimitAsync('a', 3, 60_000)).ok).toBe(true); // ventana nueva
    });

    it('claves distintas no comparten contador; reset borra en Redis', async () => {
        configure();
        const up = fakeUpstash();
        vi.stubGlobal('fetch', up.fn);
        await rateLimitAsync('x', 1, 1000);
        expect((await rateLimitAsync('x', 1, 1000)).ok).toBe(false);
        expect((await rateLimitAsync('y', 1, 1000)).ok).toBe(true);
        await rateLimitResetAsync('x');
        expect((await rateLimitAsync('x', 1, 1000)).ok).toBe(true);
    });

    it('si Redis falla cae a memoria (y sigue limitando), nunca bloquea por el fallo', async () => {
        configure();
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
        expect((await rateLimitAsync('k', 2, 1000)).backend).toBe('memory');
        expect((await rateLimitAsync('k', 2, 1000)).ok).toBe(true);
        expect((await rateLimitAsync('k', 2, 1000)).ok).toBe(false); // limite en memoria
        expect((await rateLimitAsync('otro', 2, 1000)).ok).toBe(true); // otros usuarios no se ven afectados
    });

    it('HTTP 500 y respuestas con error de comando cuentan como fallo', async () => {
        configure();
        vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
        expect((await rateLimitAsync('k', 5, 1000)).backend).toBe('memory');
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ error: 'WRONGTYPE' }]), { status: 200 })));
        expect((await rateLimitAsync('k2', 5, 1000)).backend).toBe('memory');
    });

    it('RATE_LIMIT_ON_ERROR=open deja pasar cuando Redis falla', async () => {
        configure();
        process.env.RATE_LIMIT_ON_ERROR = 'open';
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
        for (let i = 0; i < 10; i++) expect(await rateLimitAsync('k', 1, 1000)).toMatchObject({ ok: true, backend: 'open' });
    });

    it('circuit breaker: tras 3 fallos deja de llamar a Redis 30 s y se recupera despues', async () => {
        configure();
        const failing = vi.fn(async () => { throw new Error('down'); });
        vi.stubGlobal('fetch', failing);
        for (let i = 0; i < 3; i++) await rateLimitAsync('k' + i, 5, 1000);
        expect(failing).toHaveBeenCalledTimes(3);
        await rateLimitAsync('k9', 5, 1000);
        await rateLimitAsync('k9', 5, 1000);
        expect(failing).toHaveBeenCalledTimes(3); // circuito abierto: sin llamadas

        vi.setSystemTime(Date.now() + 31_000);
        const up = fakeUpstash();
        vi.stubGlobal('fetch', up.fn);
        expect((await rateLimitAsync('k', 5, 1000)).backend).toBe('redis');
    });

    it('timeout de Redis (fetch abortado) no cuelga: cae a memoria', async () => {
        configure();
        process.env.RATE_LIMIT_REDIS_TIMEOUT_MS = '100';
        vi.useRealTimers();
        vi.stubGlobal('fetch', vi.fn((_u: string, init: any) => new Promise((_res, rej) => {
            init.signal.addEventListener('abort', () => rej(new Error('aborted')));
        })));
        const t0 = Date.now();
        const r = await rateLimitAsync('k', 5, 1000);
        expect(r.backend).toBe('memory');
        expect(Date.now() - t0).toBeLessThan(1500);
    });

    it('URL de Upstash invalida se ignora (usa memoria)', async () => {
        process.env.UPSTASH_REDIS_REST_URL = 'javascript:alert(1)';
        process.env.UPSTASH_REDIS_REST_TOKEN = 't';
        const f = vi.fn();
        vi.stubGlobal('fetch', f);
        expect((await rateLimitAsync('k', 5, 1000)).backend).toBe('memory');
        expect(f).not.toHaveBeenCalled();
    });
});
