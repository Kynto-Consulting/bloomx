import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertLocalPg, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';
import { findUserByEmail } from '../user-lookup';

// Postgres embebido real: npm run test:pg
beforeAll(() => { assertLocalPg(); });
afterAll(async () => { await prisma.$disconnect(); });

describe('findUserByEmail (Postgres real)', () => {
    it('coincidencia exacta', async () => {
        const email = `${uid('u')}@lookup.test`;
        await createUser(prisma, email);
        expect((await findUserByEmail(email))?.email).toBe(email);
    });

    it('sin distinguir mayusculas ni espacios (mode insensitive)', async () => {
        const email = `${uid('u')}@lookup.test`;
        await createUser(prisma, email);
        expect((await findUserByEmail(`  ${email.toUpperCase()} `))?.email).toBe(email);
    });

    it('un usuario guardado con mayusculas se encuentra tambien en minusculas', async () => {
        const stored = `${uid('U')}@Lookup.Test`;
        await createUser(prisma, stored);
        expect((await findUserByEmail(stored.toLowerCase()))?.email).toBe(stored);
    });

    it('inexistente o vacio -> null', async () => {
        expect(await findUserByEmail(`${uid('nadie')}@lookup.test`)).toBeNull();
        expect(await findUserByEmail('')).toBeNull();
        expect(await findUserByEmail('   ')).toBeNull();
    });
});
