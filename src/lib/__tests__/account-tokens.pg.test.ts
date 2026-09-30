import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { assertLocalPg, createUser, uid } from './helpers/pg';
import { withAccountTokenEncryption } from '../account-tokens';
import { encrypt, isEncrypted } from '../encryption';

// Extension de Prisma que cifra tokens OAuth: contra columnas reales de Postgres y con migracion perezosa.
const base = new PrismaClient();
const prisma = withAccountTokenEncryption(base);

beforeAll(() => assertLocalPg());
afterAll(async () => { await base.$disconnect(); });

const raw = async (id: string) => (await base.$queryRaw<any[]>`SELECT "access_token","refresh_token","id_token" FROM "Account" WHERE "id" = ${id}`)[0];
const waitUntil = async (fn: () => Promise<boolean>, ms = 5000) => {
    const t0 = Date.now();
    while (!(await fn())) {
        if (Date.now() - t0 > ms) throw new Error('timeout');
        await new Promise((r) => setTimeout(r, 25));
    }
};

async function newAccount(data: Record<string, unknown> = {}) {
    const u = await createUser(base);
    return prisma.account.create({
        data: { userId: u.id, type: 'oauth', provider: 'google', providerAccountId: uid('pa'), ...data } as any,
    });
}

describe('cifrado en reposo de tokens de Account (Postgres real)', () => {
    it('create cifra en BD y devuelve texto plano; findUnique/findMany descifran', async () => {
        const acc = await newAccount({ access_token: 'AT-plain', refresh_token: 'RT-plain', id_token: 'IT-plain', scope: 'mail' });
        expect(acc).toMatchObject({ access_token: 'AT-plain', refresh_token: 'RT-plain', id_token: 'IT-plain' });
        const r = await raw(acc.id);
        for (const k of ['access_token', 'refresh_token', 'id_token']) {
            expect(isEncrypted(r[k])).toBe(true);
            expect(r[k]).not.toContain('plain');
        }
        expect((await prisma.account.findUnique({ where: { id: acc.id } }))!.refresh_token).toBe('RT-plain');
        const many = await prisma.account.findMany({ where: { userId: acc.userId } });
        expect(many[0].access_token).toBe('AT-plain');
        // consulta por campos no cifrados y select parcial
        const sel = await prisma.account.findFirst({ where: { provider: 'google', userId: acc.userId }, select: { id: true, refresh_token: true } });
        expect(sel!.refresh_token).toBe('RT-plain');
    });

    it('update / update con {set} / updateMany / upsert cifran; nulos se conservan', async () => {
        const acc = await newAccount({ access_token: 'a1' });
        await prisma.account.update({ where: { id: acc.id }, data: { access_token: 'a2', refresh_token: { set: 'r2' } } });
        let r = await raw(acc.id);
        expect(isEncrypted(r.access_token)).toBe(true);
        expect(isEncrypted(r.refresh_token)).toBe(true);
        expect(r.id_token).toBeNull();
        expect((await prisma.account.findUnique({ where: { id: acc.id } }))).toMatchObject({ access_token: 'a2', refresh_token: 'r2', id_token: null });

        await prisma.account.updateMany({ where: { id: acc.id }, data: { id_token: 'i3' } });
        r = await raw(acc.id);
        expect(isEncrypted(r.id_token)).toBe(true);

        const pa = uid('up');
        const up = await prisma.account.upsert({
            where: { provider_providerAccountId: { provider: 'zoom', providerAccountId: pa } },
            create: { userId: acc.userId, type: 'oauth', provider: 'zoom', providerAccountId: pa, access_token: 'up-create' } as any,
            update: { access_token: 'up-update' },
        });
        expect(up.access_token).toBe('up-create');
        expect(isEncrypted((await raw(up.id)).access_token)).toBe(true);
        const up2 = await prisma.account.upsert({
            where: { provider_providerAccountId: { provider: 'zoom', providerAccountId: pa } },
            create: { userId: acc.userId, type: 'oauth', provider: 'zoom', providerAccountId: pa } as any,
            update: { access_token: 'up-update' },
        });
        expect(up2.access_token).toBe('up-update');
    });

    it('createMany cifra cada fila', async () => {
        const u = await createUser(base);
        await prisma.account.createMany({
            data: [
                { userId: u.id, type: 'o', provider: 'g1', providerAccountId: uid('m'), access_token: 'm1' },
                { userId: u.id, type: 'o', provider: 'g2', providerAccountId: uid('m'), access_token: 'm2' },
            ],
        });
        const rows = await base.account.findMany({ where: { userId: u.id } });
        expect(rows.every((r) => isEncrypted(r.access_token!))).toBe(true);
        expect((await prisma.account.findMany({ where: { userId: u.id }, orderBy: { provider: 'asc' } })).map((r) => r.access_token)).toEqual(['m1', 'm2']);
    });

    it('migracion perezosa: fila en texto plano se lee bien y se re-cifra en segundo plano', async () => {
        const u = await createUser(base);
        const legacy = await base.account.create({
            data: { userId: u.id, type: 'oauth', provider: 'google', providerAccountId: uid('leg'), access_token: 'LEGACY-AT', refresh_token: 'LEGACY-RT' },
        });
        expect((await raw(legacy.id)).access_token).toBe('LEGACY-AT');
        const read = await prisma.account.findUnique({ where: { id: legacy.id } });
        expect(read).toMatchObject({ access_token: 'LEGACY-AT', refresh_token: 'LEGACY-RT' });
        await waitUntil(async () => isEncrypted((await raw(legacy.id)).access_token));
        const after = await raw(legacy.id);
        expect(isEncrypted(after.refresh_token)).toBe(true);
        expect((await prisma.account.findUnique({ where: { id: legacy.id } }))!.access_token).toBe('LEGACY-AT');
    });

    it('token cifrado con otra clave => null (no rompe la lectura)', async () => {
        const u = await createUser(base);
        const prev = process.env.DATA_ENCRYPTION_KEY;
        const prevId = process.env.DATA_ENCRYPTION_KEY_ID;
        process.env.DATA_ENCRYPTION_KEY = 'otra-clave-distinta-de-32-caracteres!!';
        process.env.DATA_ENCRYPTION_KEY_ID = 'zz';
        const foreign = encrypt('secreto-ajeno');
        if (prev === undefined) delete process.env.DATA_ENCRYPTION_KEY; else process.env.DATA_ENCRYPTION_KEY = prev;
        if (prevId === undefined) delete process.env.DATA_ENCRYPTION_KEY_ID; else process.env.DATA_ENCRYPTION_KEY_ID = prevId;
        const acc = await base.account.create({ data: { userId: u.id, type: 'o', provider: 'g', providerAccountId: uid('f'), access_token: foreign } });
        const read = await prisma.account.findUnique({ where: { id: acc.id } });
        expect(read!.access_token).toBeNull();
    });

    it('la relacion user -> accounts NO descifra (limitacion documentada)', async () => {
        const acc = await newAccount({ access_token: 'rel-token' });
        const u = await prisma.user.findUnique({ where: { id: acc.userId }, include: { accounts: true } });
        expect(isEncrypted(u!.accounts[0].access_token!)).toBe(true);
    });
});
