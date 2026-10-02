import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLocalPg, uid } from './helpers/pg';
import { prisma } from '../prisma';
import { ensureDatabaseSchema, expectedSchemaTables } from '../db/schema';
import { MAX_STARS_PER_USER, StarLimitError, listStars, setStar } from '../admin/extension-stars';
import { execute, query } from '../admin/sql';

beforeAll(async () => {
    assertLocalPg();
    await ensureDatabaseSchema();
});
afterAll(async () => { await prisma.$disconnect(); });

describe('favoritas del marketplace (Postgres real)', () => {
    it('la tabla ExtensionStar es aditiva e idempotente (el DDL se puede repetir)', async () => {
        expect(expectedSchemaTables()).toContain('ExtensionStar');
        await ensureDatabaseSchema();
        const cols = await query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'ExtensionStar' ORDER BY column_name`);
        expect(cols.map((c) => c.column_name)).toEqual(['createdAt', 'extensionId', 'userId']);
        const pk = await query<{ conname: string }>(`SELECT conname FROM pg_constraint WHERE conname = 'ExtensionStar_pkey'`);
        expect(pk).toHaveLength(1);
    });

    it('marcar es idempotente, desmarcar quita y la lista conserva el orden de alta', async () => {
        const user = uid('u');
        expect(await listStars(user)).toEqual([]);
        expect(await setStar(user, 'core-dlp', true)).toEqual(['core-dlp']);
        expect(await setStar(user, 'core-dlp', true)).toEqual(['core-dlp']);
        expect(await setStar(user, 'core-zoom', true)).toEqual(['core-dlp', 'core-zoom']);
        expect(await setStar(user, 'core-dlp', false)).toEqual(['core-zoom']);
        expect(await setStar(user, 'nunca-marcada', false)).toEqual(['core-zoom']);
    });

    it('son POR administrador: otro usuario no ve ni afecta las estrellas ajenas', async () => {
        const a = uid('a');
        const b = uid('b');
        await setStar(a, 'core-dlp', true);
        await setStar(b, 'core-zoom', true);
        expect(await listStars(a)).toEqual(['core-dlp']);
        expect(await listStars(b)).toEqual(['core-zoom']);
        await setStar(b, 'core-dlp', false); // b nunca la marco: no toca la de a
        expect(await listStars(a)).toEqual(['core-dlp']);
    });

    it('rechaza ids invalidos y respeta el tope por administrador (sin inyeccion SQL)', async () => {
        const user = uid('lim');
        await expect(setStar(user, "x'; DROP TABLE \"ExtensionStar\";--", true)).rejects.toThrow('invalid_star');
        await expect(setStar('', 'core-dlp', true)).rejects.toThrow('invalid_star');
        // Llenar hasta el tope por SQL (rapido) y comprobar que una alta nueva se rechaza pero repetir una existente no.
        await execute(`INSERT INTO "ExtensionStar" ("userId","extensionId") SELECT $1, 'e-' || g FROM generate_series(1, ${MAX_STARS_PER_USER}) g`, user);
        await expect(setStar(user, 'una-mas', true)).rejects.toBeInstanceOf(StarLimitError);
        expect((await setStar(user, 'e-1', true)).length).toBe(MAX_STARS_PER_USER);
        expect((await setStar(user, 'e-1', false)).length).toBe(MAX_STARS_PER_USER - 1);
        expect((await setStar(user, 'una-mas', true)).length).toBe(MAX_STARS_PER_USER);
    });
});
