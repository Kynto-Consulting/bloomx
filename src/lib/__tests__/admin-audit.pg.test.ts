import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { assertLocalPg } from './helpers/pg';
import { prisma } from '../prisma';
import { listAudit, listAuditForExport, listRecentEventTypes, type AuditFilters } from '../admin/audit-store';
import { parsePaging } from '../admin/paging';

beforeAll(() => assertLocalPg());
afterAll(async () => { await prisma.$disconnect(); });

// Prefijo unico por ejecucion: el cluster es compartido con otros archivos.
const P = `pgt${randomUUID().replace(/-/g, '').slice(0, 10)}`;
const ev = (s: string) => `${P}.${s}`;

async function put(id: string, event: string, tsSql: string, userId: string | null, ip: string | null, data: Record<string, unknown>) {
    await prisma.$executeRawUnsafe(
        `INSERT INTO "AuditEvent" ("id","ts","event","userId","ip","data") VALUES ($1, ${tsSql}, $2, $3, $4, $5::jsonb)`,
        `${P}_${id}`, event, userId, ip, JSON.stringify(data),
    );
}
const pg = (qs = '') => parsePaging(new URLSearchParams(qs), { defaultSize: 25, maxSize: 100 });
const ids = (r: { items: Array<{ id: string }> }) => r.items.map((i) => i.id.replace(`${P}_`, ''));

beforeAll(async () => {
    assertLocalPg();
    await put('a1', ev('auth.login.failure'), `date_trunc('milliseconds', NOW() - interval '1 hour')`, 'usr_A', '203.0.113.77', {
        email: 'victim@example.com', note: 'contact jane@corp.com', password: 'hunter2', apiKey: 'sk-1', clientIp: '198.51.100.9', nested: { token: 'tok', list: ['x@y.co'] },
    });
    await put('a2', ev('auth.login.success'), `date_trunc('milliseconds', NOW() - interval '2 hours')`, 'usr_A', '2001:db8:abcd::1', {});
    await put('a3', ev('admin.users.disabled'), `date_trunc('milliseconds', NOW() - interval '3 hours')`, 'usr_ADMIN', '10.0.0.1', { actorId: 'usr_ADMIN', targetUserId: 'usr_B' });
    await put('a4', ev('retention.run_manual'), `date_trunc('milliseconds', NOW() - interval '5 days')`, null, null, { actorId: 'usr_ADMIN' });
    await put('a5', ev('mail_sent.ok'), `date_trunc('milliseconds', NOW() - interval '400 days')`, null, null, {});
    // mismo milisegundo para probar el desempate por id
    await put('b1', ev('tie.event'), `TIMESTAMPTZ '2000-01-01 00:00:00+00'`, null, null, {});
    await put('b2', ev('tie.event'), `TIMESTAMPTZ '2000-01-01 00:00:00+00'`, null, null, {});
    await put('b3', ev('tie.event'), `TIMESTAMPTZ '2000-01-01 00:00:00+00'`, null, null, {});
});

const f = (over: Partial<AuditFilters> = {}): AuditFilters => ({ event: `${P}.*`, ...over });

describe('audit-store contra Postgres', () => {
    it('orden ts DESC, id DESC, total y enmascarado de la fila sembrada', async () => {
        const r = await listAudit(f(), pg('pageSize=50'));
        expect(r.available).toBe(true);
        expect(ids(r)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'b3', 'b2', 'b1']);
        expect(r.total).toBe(8);
        const text = JSON.stringify(r.items);
        for (const leak of ['victim@example.com', 'jane@corp.com', 'hunter2', 'sk-1', '198.51.100.9', '203.0.113.77', '"tok"', 'x@y.co', '2001:db8:abcd::1']) expect(text).not.toContain(leak);
        const a1 = r.items.find((i) => i.id.endsWith('_a1'))!;
        expect(a1.ip).toBe('203.0.x.x');
        expect(a1.data.clientIp).toBe('198.51.x.x');
        expect(r.items.find((i) => i.id.endsWith('_a2'))!.ip).toBe('2001:db8:x:x:x:x:x:x');
    });

    it('evento exacto, prefijo con * y q (contiene, con comodines escapados)', async () => {
        expect(ids(await listAudit({ event: ev('auth.login.failure') }, pg()))).toEqual(['a1']);
        expect(ids(await listAudit({ event: ev('auth.*') }, pg())).sort()).toEqual(['a1', 'a2']);
        expect(ids(await listAudit({ event: `${P}.*`, q: 'LOGIN' }, pg())).sort()).toEqual(['a1', 'a2']);
        // "_" es literal: mail_sent coincide, mailXsent no existe; y % no actua de comodin
        expect(ids(await listAudit({ event: `${P}.*`, q: 'mail_sent' }, pg()))).toEqual(['a5']);
        expect(ids(await listAudit({ event: `${P}.*`, q: 'mail%sent' }, pg()))).toEqual([]);
        expect(ids(await listAudit({ event: `${P}.*`, q: '_' }, pg())).sort()).toEqual(['a4', 'a5']); // run_manual, mail_sent
    });

    it('usuario: coincide userId, actorId y targetUserId', async () => {
        expect(ids(await listAudit(f({ user: 'usr_A' }), pg())).sort()).toEqual(['a1', 'a2']);
        expect(ids(await listAudit(f({ user: 'usr_B' }), pg()))).toEqual(['a3']); // targetUserId
        expect(ids(await listAudit(f({ user: 'usr_ADMIN' }), pg())).sort()).toEqual(['a3', 'a4']); // userId y actorId
        expect(ids(await listAudit(f({ user: "x' OR '1'='1" }), pg()))).toEqual([]); // parametrizado
    });

    it('rango de fechas from/to (ISO)', async () => {
        const from = new Date(Date.now() - 6 * 24 * 3600_000).toISOString();
        const to = new Date(Date.now() - 4 * 3600_000).toISOString();
        expect(ids(await listAudit(f({ from, to }), pg())).sort()).toEqual(['a4']);
        expect(ids(await listAudit(f({ from }), pg())).sort()).toEqual(['a1', 'a2', 'a3', 'a4']);
        // "to" solo fecha incluye todo el dia
        expect(ids(await listAudit(f({ from: '2000-01-01', to: '2000-01-01' }), pg())).sort()).toEqual(['b1', 'b2', 'b3']);
    });

    it('offset y cursor recorren todo sin repetir ni saltar, incluso con ts iguales', async () => {
        const offsetSeen: string[] = [];
        for (let page = 1; page <= 4; page++) offsetSeen.push(...ids(await listAudit(f(), pg(`pageSize=3&page=${page}`))));
        const all = ids(await listAudit(f(), pg('pageSize=50')));
        expect(offsetSeen).toEqual(all);

        const cursorSeen: string[] = [];
        let cursor: string | undefined;
        for (let i = 0; i < 10; i++) {
            const r = await listAudit(f({ cursor }), pg('pageSize=3'));
            cursorSeen.push(...ids(r));
            if (!r.nextCursor) break;
            cursor = r.nextCursor;
        }
        expect(cursorSeen).toEqual(all);
        expect(new Set(cursorSeen).size).toBe(8);
    });

    it('tipos de evento distintos recientes incluye los sembrados', async () => {
        const types = await listRecentEventTypes();
        expect(types).toEqual(expect.arrayContaining([ev('auth.login.failure'), ev('admin.users.disabled')]));
        expect(types.length).toBeLessThanOrEqual(200);
    });

    it('exportacion: mismas filas, enmascaradas, maximo 10 000', async () => {
        const rows = (await listAuditForExport(f({ user: 'usr_A' })))!;
        expect(rows.map((r) => r.id.replace(`${P}_`, '')).sort()).toEqual(['a1', 'a2']);
        expect(JSON.stringify(rows)).not.toContain('victim@example.com');
    });

    it('sin tabla AuditEvent: available false y exportacion null (tolerante)', async () => {
        await prisma.$executeRawUnsafe('ALTER TABLE "AuditEvent" RENAME TO "AuditEvent_off"');
        try {
            const r = await listAudit(f(), pg());
            expect(r).toMatchObject({ available: false, items: [], total: 0 });
            expect(await listAuditForExport(f())).toBeNull();
            expect(await listRecentEventTypes()).toEqual([]);
        } finally {
            await prisma.$executeRawUnsafe('ALTER TABLE "AuditEvent_off" RENAME TO "AuditEvent"');
        }
    });
});

