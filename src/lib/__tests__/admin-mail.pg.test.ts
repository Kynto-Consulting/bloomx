import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import { assertLocalPg, createFreshDatabase, createUser, createEmail, uid } from './helpers/pg';
import { prisma } from '../prisma';
import {
    getMailMetrics, getMailOverview, getScheduledQueue, getWebhookStatus, listSuppressions, removeSuppressions, resolveRange,
    MAX_SENDS_PER_HOUR,
} from '../admin/mail-store';
import { parsePaging } from '../admin/paging';

/**
 * SQL de la seccion Correo de la consola contra Postgres real embebido. Los datos se siembran en una ventana FIJA en el
 * futuro (2031) para que las filas de otros tests (hora real) no afecten a los conteos; lo global se compara por diferencia.
 */
const NOW = new Date('2031-06-15T12:30:00Z');
const at = (iso: string) => new Date(iso);
const minus = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

beforeAll(() => { assertLocalPg(); vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterAll(async () => { await prisma.$disconnect(); });

const tag = uid('t').replace(/_/g, '');
let u1: { id: string; email: string };
let u2: { id: string; email: string };
let seededEmails = 0;
let before: Awaited<ReturnType<typeof getMailOverview>>;

const mail = async (userId: string, over: Record<string, unknown>) => { seededEmails++; return createEmail(prisma, userId, over); };
const sent = (userId: string, createdAt: Date) => mail(userId, { folder: 'sent', status: 'sent', createdAt });
const event = (type: string, data: unknown, createdAt: Date) => prisma.emailEvent.create({ data: { type, data: data as any, createdAt } });

describe('siembra y metricas', () => {
    beforeAll(async () => {
        u1 = await createUser(prisma, `${tag}-a@pg.test`);
        u2 = await createUser(prisma, `${tag}-b@pg.test`);
        before = await getMailOverview(NOW);

        // u1: 3 enviados en la ultima hora + 2 programados (uno futuro, otro vencido) creados hace 30 min
        for (let i = 0; i < 3; i++) await sent(u1.id, minus(10 * MIN));
        await mail(u1.id, { folder: 'scheduled', status: 'scheduled', createdAt: minus(30 * MIN), scheduledAt: new Date(NOW.getTime() + DAY) });
        await mail(u1.id, { folder: 'scheduled', status: 'scheduled', createdAt: minus(30 * MIN), scheduledAt: minus(HOUR) });
        // Limites de dia en UTC: 23:59:30 del 13 y 00:00:30 del 14
        await sent(u1.id, at('2031-06-13T23:59:30Z'));
        await sent(u1.id, at('2031-06-14T00:00:30Z'));
        // Recibidos (3 h) + uno en spam (recibido)
        for (let i = 0; i < 4; i++) await mail(u1.id, { folder: 'inbox', status: 'received', createdAt: minus(3 * HOUR) });
        await mail(u1.id, { folder: 'spam', status: 'received', createdAt: minus(3 * HOUR) });
        // u2: un envio hace 20 dias (solo entra en 30d)
        await sent(u2.id, minus(20 * DAY));
        // Correo fuera del rango 30d
        await sent(u2.id, minus(45 * DAY));

        // Supresiones / eventos
        await event('unsubscribe', { sender: u1.id, recipient: `a@${tag}.test`, reason: 'bounce' }, minus(1 * DAY));
        await event('unsubscribe', { sender: u1.id, recipient: `b@${tag}.test`, reason: 'complaint' }, minus(2 * DAY));
        await event('unsubscribe', { sender: u2.id, recipient: `c@${tag}.test` }, minus(3 * DAY)); // sin motivo = baja
        await event('unsubscribe', { sender: u1.id, recipient: `d@${tag}.test`, reason: 'bounce' }, minus(10 * DAY)); // fuera de 7d
        await event('email.delivered', { recipient: `z@${tag}.test` }, minus(1 * DAY)); // otro tipo: ignorado

        // Adjuntos: uno bloqueado (hace 1 dia) y uno normal de 1000 bytes
        seededEmails++;
        await prisma.email.create({
            data: {
                userId: u1.id, messageId: uid('m'), from: 'a@x.test', to: 'b@x.test', createdAt: minus(DAY + HOUR), status: 'received',
                attachments: { create: [
                    { filename: 'x.exe', mimeType: 'application/octet-stream', size: 10, key: 'BLOCKED', createdAt: minus(DAY + HOUR) },
                    { filename: 'a.pdf', mimeType: 'application/pdf', size: 1000, key: `emails/${tag}/a.pdf`, createdAt: minus(DAY + HOUR) },
                ] },
            },
        });
    });

    it('resolveRange: cubos UTC deterministas', () => {
        const d = resolveRange('7d', NOW);
        expect(d.buckets[0]).toBe('2031-06-09');
        expect(d.buckets.at(-1)).toBe('2031-06-15');
        expect(d.buckets).toHaveLength(7);
        expect(resolveRange('30d', NOW).buckets).toHaveLength(30);
        const h = resolveRange('24h', NOW);
        expect(h.buckets).toHaveLength(24);
        expect(h.buckets[0]).toBe('2031-06-14T13');
        expect(h.buckets.at(-1)).toBe('2031-06-15T12');
    });

    it('7d: totales y serie diaria (limites de dia en UTC)', async () => {
        const m = await getMailMetrics('7d', NOW);
        expect(m.granularity).toBe('day');
        expect(m.totals).toMatchObject({ sent: 7, received: 6, spam: 1, bounces: 1, complaints: 1, unsubscribes: 1, blocked: 1 });
        expect(m.blockedAttachments.available).toBe(true);
        const day = (k: string) => m.series.find((p) => p.bucket === k)!;
        expect(day('2031-06-13').sent).toBe(1);
        expect(day('2031-06-14')).toMatchObject({ sent: 1, bounces: 1, blocked: 1, received: 1 });
        expect(day('2031-06-15')).toMatchObject({ sent: 5, received: 5, spam: 1 });
        expect(day('2031-06-13').complaints).toBe(1);
        expect(day('2031-06-12').unsubscribes).toBe(1);
        expect(m.series.reduce((a, p) => a + p.sent, 0)).toBe(m.totals.sent);
    });

    it('24h: serie por hora y ventana estricta', async () => {
        const m = await getMailMetrics('24h', NOW);
        expect(m.granularity).toBe('hour');
        expect(m.totals.sent).toBe(5);
        expect(m.series.find((p) => p.bucket === '2031-06-15T12')!.sent).toBe(5);
        expect(m.series.find((p) => p.bucket === '2031-06-15T09')).toMatchObject({ received: 5, spam: 1 });
        expect(m.totals.bounces).toBe(0); // el rebote (12:30 del 14) queda antes del inicio alineado (13:00 del 14)
    });

    it('30d incluye lo de hace 20 dias y el rebote de hace 10, no lo de hace 45', async () => {
        const m = await getMailMetrics('30d', NOW);
        expect(m.totals.sent).toBe(8);
        expect(m.totals.bounces).toBe(2);
    });

    it('cuota por hora: solo usuarios con envios en la ultima hora, con su correo y conteos', async () => {
        const m = await getMailMetrics('7d', NOW);
        expect(m.quota.limit).toBe(MAX_SENDS_PER_HOUR);
        expect(m.quota.topLastHour).toHaveLength(1);
        expect(m.quota.topLastHour[0]).toEqual({
            userId: u1.id, email: u1.email, sentLastHour: 5, limit: MAX_SENDS_PER_HOUR, percent: Math.round((5 / MAX_SENDS_PER_HOUR) * 100),
        });
        expect(m.quota.topRange[0]).toEqual({ userId: u1.id, email: u1.email, sent: 7, received: 6, total: 13 });
        expect(m.quota.topRange.some((r) => r.userId === u2.id)).toBe(false);
        const m30 = await getMailMetrics('30d', NOW);
        expect(m30.quota.topRange.find((r) => r.userId === u2.id)).toMatchObject({ sent: 1, received: 0, total: 1 });
    });

    it('no expone contenido: las filas devueltas solo tienen conteos y correos de usuario', async () => {
        const m = await getMailMetrics('30d', NOW);
        expect(JSON.stringify(m)).not.toMatch(/subject|snippet|htmlKey|filename|a@x\.test|b@x\.test/);
    });

    it('cola de programados', async () => {
        const q = await getScheduledQueue(NOW);
        expect(q.pending).toBeGreaterThanOrEqual(1);
        expect(q.overdue).toBeGreaterThanOrEqual(1);
        expect(q.oldest).not.toBeNull();
        const m = await getMailMetrics('7d', NOW);
        expect(m.scheduled.pending).toBe(q.pending);
    });

    it('getMailOverview: hoy = ultimas 24 h; almacenamiento y cola por diferencia', async () => {
        const after = await getMailOverview(NOW);
        expect(after.sentToday).toBe(5);
        expect(after.receivedToday).toBe(5 + 0);
        expect(after.bouncesWeek).toBe(1);
        expect(after.complaintsWeek).toBe(1);
        expect(after.scheduled.pending - before.scheduled.pending).toBe(1);
        expect(after.scheduled.overdue - before.scheduled.overdue).toBe(1);
        expect(after.storage.emailCount - before.storage.emailCount).toBe(seededEmails);
        // el adjunto BLOCKED no cuenta como almacenamiento
        expect(after.storage.attachmentCount - before.storage.attachmentCount).toBe(1);
        expect(after.storage.attachmentBytes - before.storage.attachmentBytes).toBe(1000);
        expect(after.elixir.available).toBe(true);
    });

    it('getMailOverview: cola de Elixir (campanas en ejecucion y filas pendientes)', async () => {
        const b = (await getMailOverview(NOW)).elixir;
        const cid = uid('camp');
        await prisma.$executeRaw`INSERT INTO "ElixirCampaign" ("id","userId","name","status","subject","template") VALUES (${cid}, ${u1.id}, 'c', 'running', 's', 't')`;
        const stat = ['pending', 'pending', 'sending', 'sent', 'error'];
        for (let i = 0; i < stat.length; i++) {
            await prisma.$executeRaw`INSERT INTO "ElixirCampaignRow" ("campaignId","idx","email","recipient","status") VALUES (${cid}, ${i}, ${`e${i}@x.test`}, ${`e${i}@x.test`}, ${stat[i]})`;
        }
        const a = (await getMailOverview(NOW)).elixir;
        expect(a.running - b.running).toBe(1);
        expect(a.pendingRows - b.pendingRows).toBe(3);
    });
});

describe('supresiones', () => {
    const paging = (size = 25, page = 1) => parsePaging(new URLSearchParams({ pageSize: String(size), page: String(page) }), { maxSize: 100 });
    // Usuarios y etiqueta PROPIOS: q=stag solo encuentra estas filas aunque otros tests hayan sembrado bajas.
    const stag = uid('s').replace(/_/g, '');
    let s1: { id: string; email: string };
    let s2: { id: string; email: string };
    let ids: Record<string, string>;

    beforeAll(async () => {
        s1 = await createUser(prisma, `${stag}-s1@pg.test`);
        s2 = await createUser(prisma, `${stag}-s2@pg.test`);
        const evs = {
            alice: await event('unsubscribe', { sender: s1.id, recipient: `alice@${stag}.test`, reason: 'unsubscribe' }, at('2031-01-01T00:00:00Z')),
            bob: await event('unsubscribe', { sender: s1.id, recipient: `bob_100%@${stag}.test`, reason: 'bounce' }, at('2031-01-02T00:00:00Z')),
            carl: await event('unsubscribe', { sender: s2.id, recipient: `carl@${stag}.test`, reason: 'complaint' }, at('2031-01-03T00:00:00Z')),
            ghost: await event('unsubscribe', { sender: 'usuario-eliminado', recipient: `ghost@${stag}.test` }, at('2031-01-04T00:00:00Z')),
            other: await event('email.delivered', { sender: s1.id, recipient: `other@${stag}.test` }, at('2031-01-05T00:00:00Z')),
            bobx: await event('unsubscribe', { sender: s1.id, recipient: `bobX100@${stag}.test`, reason: 'unsubscribe' }, at('2031-01-06T00:00:00Z')),
        };
        ids = Object.fromEntries(Object.entries(evs).map(([k, v]) => [k, v.id]));
    });

    it('lista con data->> (recipient, reason, sender) y une con User; orden fecha desc', async () => {
        const r = await listSuppressions({ q: stag, paging: paging() });
        expect(r.meta.total).toBe(5); // el evento de otro tipo no cuenta
        expect(r.items.map((i) => i.recipient)).toEqual([
            `bobX100@${stag}.test`, `ghost@${stag}.test`, `carl@${stag}.test`, `bob_100%@${stag}.test`, `alice@${stag}.test`,
        ]);
        const byRcpt = Object.fromEntries(r.items.map((i) => [i.recipient.split('@')[0], i]));
        expect(byRcpt.alice).toMatchObject({ reason: 'unsubscribe', senderEmail: s1.email });
        expect(byRcpt['bob_100%']).toMatchObject({ reason: 'bounce' });
        expect(byRcpt.carl).toMatchObject({ reason: 'complaint', senderEmail: s2.email });
        expect(byRcpt.ghost).toMatchObject({ reason: 'unsubscribe', senderEmail: null }); // sin motivo = baja; usuario borrado
        expect(Object.keys(r.items[0]).sort()).toEqual(['createdAt', 'id', 'reason', 'recipient', 'senderEmail']);
    });

    it('filtro por motivo (la baja sin motivo cuenta como unsubscribe)', async () => {
        const un = await listSuppressions({ q: stag, reason: 'unsubscribe', paging: paging() });
        expect(un.items.map((i) => i.recipient.split('@')[0]).sort()).toEqual(['alice', 'bobX100', 'ghost']);
        const bo = await listSuppressions({ q: stag, reason: 'bounce', paging: paging() });
        expect(bo.items.map((i) => i.recipient.split('@')[0])).toEqual(['bob_100%']);
        expect((await listSuppressions({ q: stag, reason: 'complaint', paging: paging() })).meta.total).toBe(1);
    });

    it('busqueda por destinatario o por correo del remitente; % y _ son literales', async () => {
        expect((await listSuppressions({ q: `alice@${stag}`, paging: paging() })).meta.total).toBe(1);
        expect((await listSuppressions({ q: s2.email, paging: paging() })).items.map((i) => i.recipient)).toEqual([`carl@${stag}.test`]);
        expect((await listSuppressions({ q: 'bob_100', paging: paging() })).items.map((i) => i.recipient)).toEqual([`bob_100%@${stag}.test`]); // _ no es comodin (bobX100 no entra)
        expect((await listSuppressions({ q: `%${stag}`, paging: paging() })).meta.total).toBe(0); // % no es comodin
        expect((await listSuppressions({ q: `alice@${stag}.test' OR 1=1 --`, paging: paging() })).meta.total).toBe(0);
    });

    it('paginacion', async () => {
        const p1 = await listSuppressions({ q: stag, paging: paging(3, 1) });
        const p2 = await listSuppressions({ q: stag, paging: paging(3, 2) });
        expect(p1.items).toHaveLength(3);
        expect(p2.items).toHaveLength(2);
        expect(p1.meta).toMatchObject({ total: 5, pages: 2, page: 1, pageSize: 3 });
        expect(new Set([...p1.items, ...p2.items].map((i) => i.id)).size).toBe(5);
    });

    it('borrado: solo filas de tipo unsubscribe; ids duplicados o inexistentes se ignoran', async () => {
        const removed = await removeSuppressions([ids.alice, ids.alice, 'no-existe', ids.other]);
        expect(removed).toEqual([{ id: ids.alice, recipient: `alice@${stag}.test`, reason: 'unsubscribe', sender: s1.id }]);
        expect(await prisma.emailEvent.findUnique({ where: { id: ids.alice } })).toBeNull();
        expect(await prisma.emailEvent.findUnique({ where: { id: ids.other } })).not.toBeNull(); // otro tipo: intacto
        expect(await removeSuppressions([])).toEqual([]);
        expect((await listSuppressions({ q: stag, paging: paging() })).meta.total).toBe(4);
        const bulk = await removeSuppressions([ids.bob, ids.carl, ids.ghost, ids.bobx]);
        expect(bulk).toHaveLength(4);
        expect((await listSuppressions({ q: stag, paging: paging() })).meta.total).toBe(0);
    });
});

describe('webhooks', () => {
    it('ultimas fechas de correo entrante y de evento de entrega; firma solo como booleano', async () => {
        const s = await getWebhookStatus({ NEXT_PUBLIC_APP_URL: 'https://x.test/', WEBHOOK_SECRET: 'whsec_abc', RESEND_WEBHOOK_SECRET: '' });
        expect(s.inbound).toMatchObject({ signatureConfigured: true, url: 'https://x.test/api/webhooks/resend' });
        expect(s.events).toMatchObject({ signatureConfigured: false, url: 'https://x.test/api/webhooks/resend-events' });
        // Las filas del 2031 son las mas recientes de la BD
        expect(s.inbound.lastReceivedAt).toBe(minus(3 * HOUR).toISOString());
        expect(s.events.lastEventAt).toBe(minus(1 * DAY).toISOString()); // rebote de la siembra (las bajas sin motivo no cuentan)
        expect(JSON.stringify(s)).not.toContain('whsec_abc');
    });
});

describe('tolerancia a tablas ausentes (BD sin db:ensure)', () => {
    async function withPool<T>(prepare: (pool: Pool) => Promise<void>, fn: (store: typeof import('../admin/mail-store')) => Promise<T>): Promise<T> {
        const url = await createFreshDatabase();
        const pool = new Pool({ connectionString: url, max: 2 });
        try {
            await prepare(pool);
            vi.resetModules();
            vi.doMock('@/lib/prisma', () => ({
                prisma: {
                    $queryRawUnsafe: async (sql: string, ...params: unknown[]) => (await pool.query(sql, params as any[])).rows,
                    $executeRawUnsafe: async () => 0,
                },
            }));
            const store = await import('../admin/mail-store');
            return await fn(store);
        } finally {
            vi.doUnmock('@/lib/prisma');
            vi.resetModules();
            await pool.end();
        }
    }

    it('BD vacia: todo degrada a ceros / available:false sin lanzar', async () => {
        await withPool(async () => undefined, async (store) => {
            const m = await store.getMailMetrics('7d', NOW);
            expect(m.totals).toEqual({ sent: 0, received: 0, bounces: 0, complaints: 0, unsubscribes: 0, spam: 0, blocked: 0 });
            expect(m.blockedAttachments.available).toBe(false);
            expect(m.quota.topLastHour).toEqual([]);
            expect(m.scheduled).toEqual({ pending: 0, overdue: 0, oldest: null });
            const o = await store.getMailOverview(NOW);
            expect(o).toEqual({
                sentToday: 0, receivedToday: 0, bouncesWeek: 0, complaintsWeek: 0,
                elixir: { running: 0, pendingRows: 0, available: false },
                storage: { attachmentBytes: 0, attachmentCount: 0, emailCount: 0 },
                scheduled: { pending: 0, overdue: 0 },
            });
            const l = await store.listSuppressions({ q: 'x', paging: parsePaging(new URLSearchParams()) });
            expect(l).toMatchObject({ items: [], meta: { total: 0 } });
            const w = await store.getWebhookStatus({});
            expect(w.inbound.lastReceivedAt).toBeNull();
        });
    });

    it('solo existe Email: las metricas de correo funcionan, adjuntos bloqueados no disponibles', async () => {
        await withPool(
            async (pool) => {
                await pool.query(`CREATE TABLE "Email" ("id" text, "userId" text, "folder" text, "status" text, "createdAt" timestamptz DEFAULT now(), "scheduledAt" timestamptz)`);
                await pool.query(`INSERT INTO "Email" ("id","userId","folder","status","createdAt") VALUES ('1','u','sent','sent','2031-06-15T10:00:00Z')`);
            },
            async (store) => {
                const m = await store.getMailMetrics('24h', NOW);
                expect(m.totals.sent).toBe(1);
                expect(m.blockedAttachments.available).toBe(false);
                expect(m.quota.topLastHour).toEqual([]); // falta User
            },
        );
    });
});
