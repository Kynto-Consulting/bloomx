import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { assertLocalPg, createUser, createEmail, uid } from './helpers/pg';
import { prisma } from '../prisma';
import { insertRule } from '../rules/store';
import { decryptObject } from '../encryption';

// Cron real (SQL crudo LEFT JOIN "RuleRun", DISTINCT ... LIMIT $n) + capa pg de suscripciones push y VAPID.
const pushSent: Array<{ userId: string; title: string }> = [];
vi.mock('@/lib/notifications/web-push', () => ({
    sendPushNotification: vi.fn(async (userId: string, p: { title: string }) => { pushSent.push({ userId, title: p.title }); }),
}));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => null }));

beforeAll(() => {
    assertLocalPg();
    vi.stubEnv('CRON_SECRET', 'cron-secret-test');
    for (const m of ['log', 'error', 'warn'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});
afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
    const g = globalThis as any;
    await g.__bloomxCustomPool?.end?.();
});

const cron = async (auth?: string) => {
    const { GET } = await import('../../app/api/cron/run/route');
    const res = await GET(new NextRequest('http://localhost/api/cron/run', { headers: auth ? { authorization: auth } : {} }));
    return { status: res.status, body: await res.json() };
};

describe('GET /api/cron/run contra Postgres', () => {
    it('401 sin secreto o con secreto incorrecto', async () => {
        expect((await cron()).status).toBe(401);
        expect((await cron('Bearer nope')).status).toBe(401);
    });

    it('catch-up de reglas: solo correos recientes de la bandeja aun no procesados; idempotente', async () => {
        const u = await createUser(prisma);
        await insertRule(u.id, {
            name: 'leer', enabled: true, priority: 1, stopProcessing: false,
            conditions: { match: 'all', items: [{ field: 'from', op: 'contains', value: 'promo@' }] }, actions: [{ type: 'markRead' }],
        });
        const fresh1 = await createEmail(prisma, u.id, { from: 'promo@x.test' });
        const fresh2 = await createEmail(prisma, u.id, { from: 'promo@y.test' });
        const already = await createEmail(prisma, u.id, { from: 'promo@z.test' });
        const old = await createEmail(prisma, u.id, { from: 'promo@old.test', createdAt: new Date(Date.now() - 5 * 24 * 3600_000) });
        const inSent = await createEmail(prisma, u.id, { from: 'promo@sent.test', folder: 'sent' });
        await prisma.$executeRaw`INSERT INTO "RuleRun" ("emailId","userId") VALUES (${already.id}, ${u.id})`;

        const r1 = await cron('Bearer cron-secret-test');
        expect(r1.status).toBe(200);
        expect(r1.body.mode).toBe('global');
        expect(r1.body.results[u.id].rules).toMatchObject({ processed: 2, changed: 2, matched: 2 });
        const read = async (id: string) => (await prisma.email.findUnique({ where: { id } }))!.read;
        expect([await read(fresh1.id), await read(fresh2.id)]).toEqual([true, true]);
        expect([await read(already.id), await read(old.id), await read(inSent.id)]).toEqual([false, false, false]);

        const r2 = await cron('Bearer cron-secret-test');
        expect(r2.body.results[u.id].rules).toEqual({ processed: 0, changed: 0 });
    });

    it('recordatorios de eventos proximos: envia push una vez y persiste el registro cifrado en expansionSettings (jsonb)', async () => {
        pushSent.length = 0;
        const u = await createUser(prisma);
        const cal = await prisma.calendar.create({ data: { userId: u.id, name: 'c', source: 'local' } });
        const startsAt = new Date(Date.now() + 8 * 60_000);
        const ev = await prisma.calendarEvent.create({ data: { userId: u.id, calendarId: cal.id, title: 'Reunion pronto', startsAt, endsAt: new Date(startsAt.getTime() + 1800_000) } });
        await cron('Bearer cron-secret-test');
        expect(pushSent.filter((p) => p.userId === u.id).map((p) => p.title)).toEqual(['Reunion pronto']);
        const stored = (await prisma.user.findUnique({ where: { id: u.id } }))!.expansionSettings as any;
        const settings: any = decryptObject(stored);
        expect(settings.eventReminderLog[ev.id]).toBe(startsAt.toISOString());
        expect(typeof settings.lastCronRun).toBe('string');
        // Segunda pasada dentro del intervalo: no repite
        await cron('Bearer cron-secret-test');
        expect(pushSent.filter((p) => p.userId === u.id)).toHaveLength(1);
    });
});

describe('capa pg de push_subscriptions / push_vapid_config', () => {
    it('upsert por endpoint, listado, marca de exito y borrado (ANY($1::text[]))', async () => {
        const push = await import('../db/push-subscriptions');
        const u = await createUser(prisma);
        const other = await createUser(prisma);
        const ep = `https://push.test/${uid('ep')}`;
        const a = await push.savePushSubscription(u.id, { endpoint: ep, keys: { p256dh: 'k1', auth: 'a1' }, expirationTime: 1750000000000, userAgent: 'UA' });
        expect(a).toMatchObject({ user_id: u.id, endpoint: ep, p256dh: 'k1' });
        expect(a.created_at).toBeInstanceOf(Date);
        expect(Number(a.expiration_time)).toBe(1750000000000); // BIGINT llega como string/number segun el driver
        // mismo endpoint desde otro usuario (reasignacion): ON CONFLICT DO UPDATE
        const b = await push.savePushSubscription(other.id, { endpoint: ep, keys: { p256dh: 'k2', auth: 'a2' } });
        expect(b.id).toBe(a.id);
        expect(b).toMatchObject({ user_id: other.id, p256dh: 'k2', expiration_time: null });
        expect(await push.listPushSubscriptions(u.id)).toHaveLength(0);
        expect(await push.listPushSubscriptions(other.id)).toHaveLength(1);

        await push.markPushSubscriptionSuccess(ep);
        expect((await push.listPushSubscriptions(other.id))[0].last_success_at).toBeInstanceOf(Date);

        const ep2 = `https://push.test/${uid('ep2')}`;
        await push.savePushSubscription(other.id, { endpoint: ep2, keys: { p256dh: 'k', auth: 'a' } });
        await push.deletePushSubscription(u.id, ep); // usuario incorrecto: no borra
        expect(await push.listPushSubscriptions(other.id)).toHaveLength(2);
        await push.deletePushSubscriptionsByEndpoints([ep, ep2, 'https://no.existe']);
        expect(await push.listPushSubscriptions(other.id)).toHaveLength(0);
        await push.deletePushSubscriptionsByEndpoints([]);
    });

    it('VAPID persistente: se crea una vez y es estable; la creacion concurrente converge', async () => {
        vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', '');
        vi.stubEnv('VAPID_PRIVATE_KEY', '');
        // dos "instancias" (modulos distintos, cada uno con su promesa cacheada) creando la configuracion a la vez
        vi.resetModules();
        const cfg1 = await import('../notifications/web-push-config');
        vi.resetModules();
        const cfg2 = await import('../notifications/web-push-config');
        const results = await Promise.all([cfg1.getOrCreateVapidConfig(), cfg2.getOrCreateVapidConfig()]);
        expect(results[0].publicKey).toBeTruthy();
        expect(results[0].publicKey).toBe(results[1].publicKey);
        vi.resetModules();
        const again = await (await import('../notifications/web-push-config')).getOrCreateVapidConfig();
        expect(again.publicKey).toBe(results[0].publicKey);
    });
});
