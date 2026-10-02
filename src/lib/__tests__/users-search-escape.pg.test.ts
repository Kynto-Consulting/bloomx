import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLocalPg, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';
import { handleUsers, usersRequest, type UsersDeps } from '../expansions/host-services/users';

// services.users.list: la busqueda trata % _ \ como texto literal (sin comodines LIKE), contra Postgres real.
beforeAll(() => assertLocalPg());
afterAll(async () => { await prisma.$disconnect(); });

const BS = String.fromCharCode(92);
const deps: UsersDeps = { db: prisma as any, rateLimit: async () => ({ ok: true, retryAfter: 0 }), audit: () => {} };
const list = async (search: string) =>
    ((await handleUsers(deps, usersRequest.parse({ userId: 'u1', extensionId: uid('ext'), op: 'list', args: { search } }) as any, { grant: { perms: ['READ_USERS'] } })) as any).users.map((u: any) => u.email as string);

describe('users.list search (Postgres)', () => {
    it('% _ y \ no actuan como comodines', async () => {
        const tag = uid('esc').replace(/_/g, '');
        const a = await createUser(prisma, `${tag}-ab@pg.test`);
        const b = await createUser(prisma, `${tag}-a_b@pg.test`);
        const c = await createUser(prisma, `${tag}-a%b@pg.test`);
        const d = await createUser(prisma, `${tag}-a${BS}b@pg.test`);
        expect((await list(`${tag}-a_b`)).sort()).toEqual([b.email]);
        expect((await list(`${tag}-a%b`)).sort()).toEqual([c.email]);
        expect((await list(`${tag}-a${BS}b`)).sort()).toEqual([d.email]);
        expect((await list('%')).filter((e: string) => !e.includes('%'))).toEqual([]);
        expect(a.email).toBeTruthy();
    });
});
