import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { assertLocalPg, uid } from './helpers/pg';
import { prisma } from '../prisma';
import { __defaultAuditSink, __setAuditSink, auditLog, type AuditRecord } from '../audit';

beforeAll(() => { assertLocalPg(); });
afterAll(async () => { __setAuditSink(null); await prisma.$disconnect(); });
beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => undefined); vi.spyOn(console, 'warn').mockImplementation(() => undefined); });

async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, ms = 5000): Promise<T> {
    const t0 = Date.now();
    for (;;) {
        const v = await fn();
        if (v) return v as T;
        if (Date.now() - t0 > ms) throw new Error('timeout esperando la fila de auditoria');
        await new Promise((r) => setTimeout(r, 25));
    }
}

const find = (id: string) => prisma.$queryRaw<any[]>`SELECT * FROM "AuditEvent" WHERE "userId" = ${id}`;

describe('lib/audit.ts contra Postgres', () => {
    it('persiste el evento con tipos correctos (timestamptz, jsonb) y redacta secretos', async () => {
        __setAuditSink(__defaultAuditSink);
        const userId = uid('audit');
        auditLog('login.ok', { userId, ip: '10.1.2.3', email: 'persona@example.com', password: 'nope', token: 'nope', keyId: 'k1', nested: { a: [1, 2] }, note: 'ñandú ✓' });
        const rows = await waitFor(async () => { const r = await find(userId); return r.length ? r : null; });
        expect(rows).toHaveLength(1);
        const r = rows[0];
        expect(r.event).toBe('login.ok');
        expect(r.ip).toBe('10.1.2.3');
        expect(r.ts).toBeInstanceOf(Date);
        expect(Math.abs(r.ts.getTime() - Date.now())).toBeLessThan(10_000);
        expect(r.data).toMatchObject({ email: 'p***@example.com', keyId: 'k1', nested: { a: [1, 2] }, note: 'ñandú ✓' });
        expect(r.data).not.toHaveProperty('password');
        expect(r.data).not.toHaveProperty('token');
        // jsonb consultable con operadores
        const q = await prisma.$queryRaw<any[]>`SELECT 1 FROM "AuditEvent" WHERE "userId" = ${userId} AND "data" @> '{"keyId":"k1"}'::jsonb`;
        expect(q).toHaveLength(1);
    });

    it('evento sin userId/ip se guarda con NULL', async () => {
        __setAuditSink(__defaultAuditSink);
        const marker = uid('ev');
        auditLog(`anon.${marker}`, {});
        const rows = await waitFor(async () => {
            const r = await prisma.$queryRaw<any[]>`SELECT * FROM "AuditEvent" WHERE "event" = ${`anon.${marker}`}`;
            return r.length ? r : null;
        });
        expect(rows[0].userId).toBeNull();
        expect(rows[0].ip).toBeNull();
        expect(rows[0].data).toEqual({});
    });

    it('circuit breaker: 5 fallos reales (tabla ausente) abren el circuito y no se reintenta en cada evento', async () => {
        let calls = 0;
        __setAuditSink(async (rec: AuditRecord) => { calls++; return __defaultAuditSink(rec); });
        await prisma.$executeRawUnsafe('ALTER TABLE "AuditEvent" RENAME TO "AuditEvent_off"');
        try {
            for (let i = 0; i < 5; i++) auditLog('breaker.fail', { userId: uid('b') });
            await waitFor(async () => calls >= 5);
            await waitFor(async () => (console.warn as any).mock.calls.length > 0);
            expect(calls).toBe(5);
            expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[AUDIT] Persistencia'), expect.anything());
            // Circuito abierto: 10 eventos mas no llaman al sumidero
            for (let i = 0; i < 10; i++) auditLog('breaker.skipped', { userId: uid('b') });
            await new Promise((r) => setTimeout(r, 150));
            expect(calls).toBe(5);
        } finally {
            await prisma.$executeRawUnsafe('ALTER TABLE "AuditEvent_off" RENAME TO "AuditEvent"');
        }
    });

    it('un fallo de BD nunca rompe auditLog (fire-and-forget)', async () => {
        __setAuditSink(async () => { throw Object.assign(new Error('boom'), { code: 'X' }); });
        expect(() => auditLog('boom', { userId: 'x' })).not.toThrow();
        await new Promise((r) => setTimeout(r, 50));
    });
});
