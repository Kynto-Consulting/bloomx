import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../..');

function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
    }
    return out;
}

describe('rate limit distribuido en las rutas', () => {
    it('ninguna ruta de src/app usa el rateLimit() sincrono (solo rateLimitAsync)', () => {
        const offenders = walk(path.join(SRC, 'app')).filter((f) => /\brateLimit\(/.test(fs.readFileSync(f, 'utf8')));
        expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
    });

    it('las rutas migradas conservan su clave y ventana (citas, elixir, upload, secure-message, molt, internal, unsubscribe)', () => {
        const expected: Array<[string, RegExp]> = [
            ['app/api/appointments/book/[scheduleId]/route.ts', /rateLimitAsync\(`book-ip:\$\{getClientIp\(req\)\}`, 10, 60 \* 60 \* 1000\)/],
            ['app/api/appointments/book/[scheduleId]/route.ts', /rateLimitAsync\(`book-mail:\$\{guestEmail\}`, 3, 60 \* 60 \* 1000\)/],
            ['app/api/appointments/book/[scheduleId]/cancel/route.ts', /rateLimitAsync\(`cancel-post-ip:/],
            ['app/api/appointments/schedules/[id]/slots/route.ts', /rateLimitAsync\(`slots-ip:\$\{getClientIp\(req\)\}`, 120, 60 \* 1000\)/],
            ['app/api/elixir/send/route.ts', /rateLimitAsync\(`elixir:\$\{sessionUser\.id\}`, 1200, 60 \* 60 \* 1000\)/],
            ['app/api/elixir/campaigns/[id]/tick/route.ts', /rateLimitAsync\(`elixir-tick:\$\{id\}`, 1, 10_000\)/],
            ['app/api/upload/route.ts', /rateLimitAsync\(`upload:\$\{user\.id\}`, 120, 10 \* 60_000\)/],
            ['app/api/secure-message/route.ts', /rateLimitAsync\(`secure-msg:\$\{user\.email\}`, 30, 60 \* 60 \* 1000\)/],
            ['app/api/secure-message/[id]/route.ts', /rateLimitAsync\(`secure-\$\{kind\}:ip:\$\{ip\}`/],
            ['app/api/internal/mail/route.ts', /rateLimitAsync\(`internal-mail:\$\{userId\}`, 300, 60_000\)/],
            ['app/api/webhooks/unsubscribe/route.ts', /rateLimitAsync\(`unsub:\$\{getClientIp\(req\)\}`, 30, 60_000\)/],
        ];
        for (const [file, re] of expected) {
            expect(fs.readFileSync(path.join(SRC, file), 'utf8'), file).toMatch(re);
        }
    });
});

describe('respuesta 429 + Retry-After de una ruta migrada', () => {
    afterEach(() => { vi.resetModules(); vi.restoreAllMocks(); });

    it('slots publicos: 429 con Retry-After cuando rateLimitAsync bloquea', async () => {
        vi.resetModules();
        const calls: string[] = [];
        vi.doMock('@/lib/prisma', () => ({ prisma: {} }));
        vi.doMock('@/lib/security', () => ({
            getClientIp: () => '9.9.9.9',
            rateLimitAsync: async (key: string) => { calls.push(key); return { ok: false, retryAfter: 42, backend: 'redis' }; },
        }));
        const { GET } = await import('@/app/api/appointments/schedules/[id]/slots/route');
        const { NextRequest } = await import('next/server');
        const res = await GET(new NextRequest('http://localhost/api/appointments/schedules/s1/slots'), { params: Promise.resolve({ id: 's1' }) });
        expect(res.status).toBe(429);
        expect(res.headers.get('retry-after')).toBe('42');
        expect(calls).toEqual(['slots-ip:9.9.9.9']);
    });

    it('secure-message meta: 429 + Retry-After tomando el mayor de los dos limites (IP e id)', async () => {
        vi.resetModules();
        let n = 0;
        vi.doMock('@/lib/sealed/store', () => ({ consume: async () => null, defaultDeps: async () => ({}), getMeta: async () => null }));
        vi.doMock('@/lib/security', () => ({
            getClientIp: () => '1.2.3.4',
            rateLimitAsync: async () => (++n === 1 ? { ok: false, retryAfter: 7, backend: 'memory' } : { ok: false, retryAfter: 30, backend: 'memory' }),
        }));
        const { GET } = await import('@/app/api/secure-message/[id]/route');
        const { NextRequest } = await import('next/server');
        const id = '123e4567-e89b-42d3-a456-426614174000';
        const res = await GET(new NextRequest(`http://localhost/api/secure-message/${id}`), { params: Promise.resolve({ id }) });
        expect(res.status).toBe(429);
        expect(res.headers.get('retry-after')).toBe('30');
    });
});
