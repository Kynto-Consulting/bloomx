import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { assertLocalPg, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';
import { campaigns, findRowByResendId, markRowDelivery, pgCampaignStore, rows, templates } from '../elixir-campaign-store';

// SQL crudo de plantillas/campanas de Elixir (FOR UPDATE SKIP LOCKED, jsonb_to_recordset, FILTER, ANY/IN dinamicos).
beforeAll(() => { assertLocalPg(); vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterAll(async () => { await prisma.$disconnect(); });

const sender = { fromName: 'Yo', fromEmail: 'yo@x.test' };
const opts = { recipientColumn: 'email' };

async function newCampaign(userId?: string) {
    const uidv = userId ?? (await createUser(prisma)).id;
    const c = await campaigns.create(uidv, { name: 'c', subject: 's', template: '<p>t</p>', senderConfig: sender, options: opts });
    return { userId: uidv, c: c! };
}
const chunk = (n: number, prefix = 'r') => Array.from({ length: n }, (_, i) => ({
    index: i, email: `${prefix}${i}@x.test`, recipient: `${prefix}${i}@x.test`, status: 'pending' as const, message: null, code: null, data: { email: `${prefix}${i}@x.test`, nombre: `N${i}` },
}));

describe('plantillas', () => {
    it('CRUD con jsonb, nombre unico por usuario (ON CONFLICT DO NOTHING) y aislamiento', async () => {
        const u = await createUser(prisma);
        const other = await createUser(prisma);
        const t = (await templates.create(u.id, { name: 'A', subject: 's', body: '<p>b</p>', senderConfig: sender }))!;
        expect(t).toMatchObject({ name: 'A', senderConfig: sender, userId: u.id });
        expect(t.createdAt).toBeInstanceOf(Date);
        expect(await templates.create(u.id, { name: 'A', subject: 'x', body: 'y', senderConfig: {} })).toBeNull();
        expect(await templates.create(other.id, { name: 'A', subject: 'x', body: 'y', senderConfig: {} })).not.toBeNull();
        const b = (await templates.create(u.id, { name: 'B', subject: 's', body: 'b', senderConfig: {} }))!;
        expect(await templates.update(u.id, b.id, { name: 'A', subject: 's', body: 'b', senderConfig: {} })).toBe('duplicate');
        const up = await templates.update(u.id, b.id, { name: 'B2', subject: 's2', body: 'b2', senderConfig: { cc: 'c@x.test' } });
        expect(up).toMatchObject({ name: 'B2', subject: 's2', senderConfig: { cc: 'c@x.test' } });
        expect(await templates.update(other.id, b.id, { name: 'Z', subject: 's', body: 'b', senderConfig: {} })).toBeNull();
        expect((await templates.list(u.id)).map((x) => x.name).sort()).toEqual(['A', 'B2']);
        expect(await templates.count(u.id)).toBe(2);
        expect(await templates.get(u.id, t.id)).toMatchObject({ id: t.id });
        expect(await templates.get(other.id, t.id)).toBeNull();
        expect(await templates.remove(other.id, t.id)).toBe(false);
        expect(await templates.remove(u.id, t.id)).toBe(true);
    });
});

describe('campanas y filas', () => {
    it('create/get/list y transiciones de estado condicionadas (Prisma.join / Prisma.sql)', async () => {
        const { userId, c } = await newCampaign();
        expect(c).toMatchObject({ status: 'draft', total: 0, options: opts, senderConfig: sender, lockedUntil: null });
        expect(await campaigns.get(userId, c.id)).toMatchObject({ id: c.id });
        expect((await campaigns.list(userId, 10, 0)).map((x) => x.id)).toEqual([c.id]);
        expect(await campaigns.transition(userId, c.id, ['paused'], 'running')).toBe(false); // desde otro estado
        expect(await campaigns.transition(userId, c.id, ['draft'], 'running')).toBe(true);
        const running = (await campaigns.get(userId, c.id))!;
        expect(running.status).toBe('running');
        expect(running.startedAt).toBeInstanceOf(Date);
        expect(await campaigns.transition(userId, c.id, ['running', 'paused'], 'cancelled')).toBe(true);
        expect((await campaigns.get(userId, c.id))!.finishedAt).toBeInstanceOf(Date);
        expect(await campaigns.transition((await createUser(prisma)).id, c.id, ['cancelled'], 'running')).toBe(false); // ajena
    });

    it('insertChunk (jsonb_to_recordset) es idempotente; existingRecipients, page, counts y syncTotal', async () => {
        const { userId, c } = await newCampaign();
        const items = [...chunk(5), { index: 5, email: 'malo', recipient: null, status: 'skipped' as const, message: 'Email inválido', code: 'invalid_email', data: { email: 'malo' } }];
        expect(await rows.insertChunk(c.id, items)).toBe(6);
        expect(await rows.insertChunk(c.id, items)).toBe(0); // reintento del mismo trozo: ON CONFLICT DO NOTHING
        // Mismo destinatario con otro idx: el indice unico (campaignId, recipient) lo rechaza en silencio
        expect(await rows.insertChunk(c.id, [{ ...chunk(1)[0], index: 99 }])).toBe(0);
        // recipient NULL no participa del indice unico: varias filas no enviables conviven
        expect(await rows.insertChunk(c.id, [
            { index: 6, email: '', recipient: null, status: 'skipped', message: 'x', code: 'invalid_email', data: {} },
            { index: 7, email: '', recipient: null, status: 'skipped', message: 'x', code: 'invalid_email', data: {} },
        ])).toBe(2);
        const ex = await rows.existingRecipients(c.id, ['r0@x.test', 'r3@x.test', 'zzz@x.test']);
        expect(ex).toEqual(new Set(['r0@x.test', 'r3@x.test']));
        expect(await rows.existingRecipients(c.id, [])).toEqual(new Set());
        const page = await rows.page(c.id, null, 3, 2);
        expect(page.map((r) => r.idx)).toEqual([2, 3, 4]);
        expect((await rows.page(c.id, 'skipped', 10, 0)).map((r) => r.idx)).toEqual([5, 6, 7]);
        expect(await campaigns.counts(c.id)).toMatchObject({ pending: 5, skipped: 3, sent: 0 });
        await campaigns.syncTotal(c.id);
        expect((await campaigns.get(userId, c.id))!.total).toBe(8);
        const other = await newCampaign(userId);
        await rows.insertChunk(other.c.id, chunk(2, 'o'));
        const many = await campaigns.countsFor([c.id, other.c.id, 'inexistente']);
        expect(many[c.id].pending).toBe(5);
        expect(many[other.c.id].pending).toBe(2);
        expect(many['inexistente'].pending).toBe(0);
        expect(await campaigns.countsFor([])).toEqual({});
    });

    it('claimRows: FOR UPDATE SKIP LOCKED reparte sin solapes entre workers concurrentes', async () => {
        const { c } = await newCampaign();
        await rows.insertChunk(c.id, chunk(30));
        const now = new Date(Date.now() + 1000);
        const claims = await Promise.all([1, 2, 3, 4].map(() => pgCampaignStore.claimRows(c.id, 10, now)));
        const all = claims.flat().map((r) => r.idx);
        expect(all.length).toBe(30);
        expect(new Set(all).size).toBe(30); // ninguna fila reclamada dos veces
        expect(claims.every((cl) => cl.every((r, i, a) => i === 0 || a[i - 1].idx < r.idx))).toBe(true);
        const first = claims.flat()[0];
        expect(first).toMatchObject({ attempts: 1 });
        expect(first.data).toHaveProperty('nombre');
        expect(await campaigns.counts(c.id)).toMatchObject({ pending: 0, sending: 30 });
        expect(await pgCampaignStore.countRemaining(c.id, now)).toEqual({ ready: 0, pending: 0, sending: 30 });
    });

    it('markRow / releaseRows / reclaimStaleRows / countSentSince / countRemaining', async () => {
        const { userId, c } = await newCampaign();
        await rows.insertChunk(c.id, chunk(4));
        const past = new Date(Date.now() + 5000);
        const claimed = await pgCampaignStore.claimRows(c.id, 4, past);
        expect(claimed).toHaveLength(4);
        const sentAt = new Date();
        await pgCampaignStore.markRow(c.id, 0, { status: 'sent', resendEmailId: 're_abc', sentAt });
        await pgCampaignStore.markRow(c.id, 1, { status: 'pending', message: 'retry', code: 'x', nextAttemptAt: new Date(Date.now() + 3_600_000) });
        await pgCampaignStore.releaseRows(c.id, [2]); // vuelve a pending sin consumir intento
        await pgCampaignStore.releaseRows(c.id, []);
        const page = await rows.page(c.id, null, 10, 0);
        expect(page[0]).toMatchObject({ status: 'sent' });
        expect(page[0].sentAt!.getTime()).toBe(sentAt.getTime());
        expect(page[1]).toMatchObject({ status: 'pending', message: 'retry', code: 'x' });
        expect(page[2]).toMatchObject({ status: 'pending', attempts: 0 });
        expect(page[3]).toMatchObject({ status: 'sending', attempts: 1 });
        expect(await pgCampaignStore.countSentSince(userId, new Date(Date.now() - 60_000))).toBe(1);
        expect(await pgCampaignStore.countSentSince(userId, new Date(Date.now() + 60_000))).toBe(0);
        expect(await pgCampaignStore.countRemaining(c.id, past)).toEqual({ ready: 1, pending: 2, sending: 1 }); // idx 1 espera su backoff
        expect(await pgCampaignStore.reclaimStaleRows(c.id, new Date(Date.now() + 60_000))).toBe(1);
        expect(await pgCampaignStore.reclaimStaleRows(c.id, new Date(Date.now() + 60_000))).toBe(0);
        // markRow con resendEmailId nulo no borra el existente (COALESCE)
        await pgCampaignStore.markRow(c.id, 0, { status: 'sent' });
        expect((await findRowByResendId('re_abc'))).toMatchObject({ campaignId: c.id, idx: 0, userId, status: 'sent' });
    });

    it('lock/unlock de campana, finishCampaign, setLastError, runnable y requeueErrors', async () => {
        const { userId, c } = await newCampaign();
        await rows.insertChunk(c.id, chunk(3));
        const now = new Date();
        expect(await pgCampaignStore.lockCampaign(c.id, new Date(now.getTime() + 60_000), now)).toBeNull(); // draft: no bloqueable
        await campaigns.transition(userId, c.id, ['draft'], 'running');
        expect(await campaigns.runnable(50)).toContain(c.id);
        const locked = await pgCampaignStore.lockCampaign(c.id, new Date(now.getTime() + 60_000), now);
        expect(locked).toMatchObject({ id: c.id, status: 'running' });
        expect(locked!.lockedUntil).toBeInstanceOf(Date);
        expect(await pgCampaignStore.lockCampaign(c.id, new Date(now.getTime() + 60_000), now)).toBeNull(); // ya bloqueada
        expect(await campaigns.runnable(50)).not.toContain(c.id);
        await pgCampaignStore.unlockCampaign(c.id);
        expect(await pgCampaignStore.getStatus(c.id)).toBe('running');
        await pgCampaignStore.setLastError(c.id, 'algo');
        // Carreras de bloqueo: solo un worker gana
        const wins = await Promise.all(Array.from({ length: 5 }, () => pgCampaignStore.lockCampaign(c.id, new Date(Date.now() + 60_000), new Date())));
        expect(wins.filter(Boolean)).toHaveLength(1);
        await pgCampaignStore.unlockCampaign(c.id);

        const claimed = await pgCampaignStore.claimRows(c.id, 3, new Date(Date.now() + 1000));
        await pgCampaignStore.markRow(c.id, claimed[0].idx, { status: 'error', message: 'fallo', code: 'send_failed' });
        expect(await campaigns.requeueErrors(c.id)).toBe(1);
        expect((await rows.page(c.id, 'pending', 10, 0)).map((r) => r.idx)).toEqual([claimed[0].idx]);
        await pgCampaignStore.finishCampaign(c.id, 'done', null);
        const done = (await campaigns.get(userId, c.id))!;
        expect(done).toMatchObject({ status: 'done', lastError: null });
        expect(done.finishedAt).toBeInstanceOf(Date);
        expect(await campaigns.runnable(50)).not.toContain(c.id);
        expect(await campaigns.remove(userId, c.id)).toBe(true);
        expect(await rows.page(c.id, null, 10, 0)).toEqual([]); // filas en cascada
    });

    it('remove no borra campanas en curso; runnable recupera filas sending caducadas', async () => {
        const { userId, c } = await newCampaign();
        await rows.insertChunk(c.id, chunk(1));
        await campaigns.transition(userId, c.id, ['draft'], 'running');
        expect(await campaigns.remove(userId, c.id)).toBe(false);
        await pgCampaignStore.claimRows(c.id, 1, new Date(Date.now() + 1000));
        expect(await campaigns.runnable(50)).not.toContain(c.id); // fila sending reciente
        await prisma.$executeRaw`UPDATE "ElixirCampaignRow" SET "updatedAt" = NOW() - interval '10 minutes' WHERE "campaignId" = ${c.id}`;
        expect(await campaigns.runnable(50)).toContain(c.id);
    });

    it('markRowDelivery: rebotes/quejas solo degradan filas enviadas; delayed solo anota', async () => {
        const { c } = await newCampaign();
        await rows.insertChunk(c.id, chunk(3));
        const claimed = await pgCampaignStore.claimRows(c.id, 3, new Date(Date.now() + 1000));
        await pgCampaignStore.markRow(c.id, claimed[0].idx, { status: 'sent', resendEmailId: uid('re') });
        await pgCampaignStore.markRow(c.id, claimed[1].idx, { status: 'error', message: 'e', code: 'send_failed' });
        await markRowDelivery(c.id, claimed[0].idx, 'bounced', 'rebote', 'bounce');
        await markRowDelivery(c.id, claimed[1].idx, 'bounced', 'rebote', 'bounce'); // error: no se pisa
        await markRowDelivery(c.id, claimed[2].idx, null, 'retraso', 'delayed'); // sending: no se anota
        const page = await rows.page(c.id, null, 10, 0);
        expect(page.map((r) => r.status)).toEqual(['bounced', 'error', 'sending']);
        expect(page[0]).toMatchObject({ message: 'rebote', code: 'bounce' });
        expect(page[2].code).toBeNull();
    });
});
