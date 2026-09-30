import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getTestPrisma } from './helpers/testdb';

vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./helpers/testdb')).getTestPrisma() }));

const db = getTestPrisma();

import { getAccessibleMailboxUserIds, canAccessEmail } from '../mailbox-access';

let alice: string, bob: string;

beforeAll(async () => {
    await db.email.deleteMany();
    await db.user.deleteMany();
    alice = (await db.user.create({ data: { email: 'alice@test.local', password: 'x' } as any })).id;
    bob = (await db.user.create({ data: { email: 'bob@test.local', password: 'x' } as any })).id;
});
afterAll(async () => { await db.$disconnect(); });

describe('aislamiento de buzones (IDOR)', () => {
    it('un usuario solo accede a su propio buzon', async () => {
        expect(await getAccessibleMailboxUserIds(alice)).toEqual([alice]);
        expect(await canAccessEmail(alice, bob)).toBe(false);
        expect(await canAccessEmail(alice, alice)).toBe(true);
    });

    it('updateMany filtrado por buzones accesibles no toca correos ajenos', async () => {
        await db.email.create({ data: { userId: bob, messageId: 'm-bob', from: 'a@a', to: 'bob@test.local' } });
        const mine = await db.email.create({ data: { userId: alice, messageId: 'm-alice', from: 'a@a', to: 'alice@test.local' } });
        const ids = await getAccessibleMailboxUserIds(alice);
        const all = await db.email.findMany();
        const r = await db.email.updateMany({ where: { id: { in: all.map((e) => e.id) }, userId: { in: ids } }, data: { read: true } });
        expect(r.count).toBe(1);
        expect((await db.email.findUnique({ where: { id: mine.id } }))!.read).toBe(true);
        expect((await db.email.findFirst({ where: { userId: bob } }))!.read).toBe(false);
    });
});
