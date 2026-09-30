import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { assertLocalPg, createFreshDatabase, createUser } from '../../__tests__/helpers/pg';
import { prisma } from '../../prisma';
import { consume, createSealed, getMeta, type StoreDeps } from '../store';
import { createMetaStore, type RawDb } from '../meta-db';
import { sealMessage } from '../crypto';

beforeAll(() => { assertLocalPg(); });
afterAll(async () => { await prisma.$disconnect(); });

/** Almacen en memoria (S3/B2 no se puede probar aqui) + meta real en Postgres. */
function makeDeps(db: RawDb = prisma as any, over: { latencyMs?: number } = {}) {
    const files = new Map<string, string>();
    const deletes: string[] = [];
    let n = 0;
    const tick = () => (over.latencyMs ? new Promise((r) => setTimeout(r, Math.random() * over.latencyMs!)) : Promise.resolve());
    const deps: StoreDeps = {
        get: async (k) => { await tick(); return files.get(k) ?? null; },
        put: async (k, b) => { await tick(); files.set(k, b); },
        del: async (k) => { await tick(); deletes.push(k); files.delete(k); },
        wrap: (p) => p,
        unwrap: (c) => c,
        now: () => Date.now(),
        newId: () => `00000000-0000-4000-8000-${String(Date.now()).padStart(12, '0').slice(-8)}${String(++n).padStart(4, '0')}`,
        meta: createMetaStore(db),
    };
    return { deps, files, deletes };
}

const env = async () => (await sealMessage({ subject: 's', html: '<p>x</p>' })).envelope;

describe('SecureMessageMeta: conteo atomico contra Postgres real', () => {
    it('20 lecturas simultaneas con maxViews=3 dan EXACTAMENTE 3 exitos y borran el objeto', async () => {
        const u = await createUser(prisma);
        const { deps, files } = makeDeps(prisma as any, { latencyMs: 15 });
        const { id } = await createSealed(deps, { envelope: await env(), sender: u.email, ttlDays: 7, maxViews: 3, userId: u.id });
        const results = await Promise.all(Array.from({ length: 20 }, () => consume(deps, id)));
        const ok = results.filter(Boolean);
        expect(ok).toHaveLength(3);
        expect(ok.map((r: any) => r.remainingViews).sort()).toEqual([0, 1, 2]);
        const row: any[] = await prisma.$queryRaw`SELECT "views","maxViews" FROM "SecureMessageMeta" WHERE "id" = ${id}`;
        expect(Number(row[0].views)).toBe(3);
        expect(files.has(`secure/${id}.sealed`)).toBe(false);
        expect(await consume(deps, id)).toBeNull();
        expect(await getMeta(deps, id)).toBeNull();
    });

    it('sin depender de memoria del proceso: dos "instancias" (deps distintos, mismo almacen) comparten la cuenta', async () => {
        const u = await createUser(prisma);
        const a = makeDeps();
        const { id } = await createSealed(a.deps, { envelope: await env(), sender: u.email, ttlDays: 7, maxViews: 2, userId: u.id });
        // Segunda instancia: mismo "bucket" y misma BD, cerrojo en memoria distinto.
        const b = { ...a.deps, meta: createMetaStore(prisma as any) };
        const results = await Promise.all([consume(a.deps, id), consume(b, id), consume(a.deps, id), consume(b, id), consume(a.deps, id)]);
        expect(results.filter(Boolean)).toHaveLength(2);
    });

    it('getMeta no cuenta vistas y refleja las restantes desde la BD', async () => {
        const u = await createUser(prisma);
        const { deps } = makeDeps();
        const { id } = await createSealed(deps, { envelope: await env(), sender: u.email, ttlDays: 7, maxViews: 3, userId: u.id });
        expect((await getMeta(deps, id))?.remainingViews).toBe(3);
        expect((await getMeta(deps, id))?.remainingViews).toBe(3);
        await consume(deps, id);
        expect((await getMeta(deps, id))?.remainingViews).toBe(2);
    });

    it('caducidad por BD: expiresAt <= now() no entrega, borra el objeto', async () => {
        const u = await createUser(prisma);
        const { deps, files } = makeDeps();
        const { id } = await createSealed(deps, { envelope: await env(), sender: u.email, ttlDays: 7, maxViews: 5, userId: u.id });
        await prisma.$executeRaw`UPDATE "SecureMessageMeta" SET "expiresAt" = now() - interval '1 minute' WHERE "id" = ${id}`;
        expect(await getMeta(deps, id)).toBeNull();
        expect(files.has(`secure/${id}.sealed`)).toBe(false);

        const second = await createSealed(deps, { envelope: await env(), sender: u.email, ttlDays: 7, maxViews: null, userId: u.id });
        await prisma.$executeRaw`UPDATE "SecureMessageMeta" SET "expiresAt" = now() - interval '1 minute' WHERE "id" = ${second.id}`;
        expect(await consume(deps, second.id)).toBeNull();
        expect(files.has(`secure/${second.id}.sealed`)).toBe(false);
    });

    it('sin limite de vistas: entrega siempre, cuenta pero no borra ni reescribe el objeto', async () => {
        const u = await createUser(prisma);
        const { deps, files } = makeDeps();
        const { id } = await createSealed(deps, { envelope: await env(), sender: u.email, ttlDays: 7, maxViews: null, userId: u.id });
        const before = files.get(`secure/${id}.sealed`);
        const rs = await Promise.all(Array.from({ length: 8 }, () => consume(deps, id)));
        expect(rs.filter(Boolean)).toHaveLength(8);
        expect(rs.every((r: any) => r.remainingViews === null)).toBe(true);
        expect(files.get(`secure/${id}.sealed`)).toBe(before);
    });

    it('la fila cae con el usuario (ON DELETE CASCADE)', async () => {
        const u = await createUser(prisma);
        const { deps } = makeDeps();
        const { id } = await createSealed(deps, { envelope: await env(), sender: u.email, ttlDays: 7, maxViews: 1, userId: u.id });
        await prisma.user.delete({ where: { id: u.id } });
        const rows: any[] = await prisma.$queryRaw`SELECT 1 FROM "SecureMessageMeta" WHERE "id" = ${id}`;
        expect(rows).toHaveLength(0);
    });
});

describe('SecureMessageMeta ausente: cae al comportamiento anterior (conteo en el objeto)', () => {
    let pool: Pool;
    let db: RawDb;
    beforeAll(async () => {
        // BD vacia SIN la tabla (no se ejecuta db:ensure): la consulta falla con 42P01 real.
        const url = await createFreshDatabase();
        pool = new Pool({ connectionString: url, max: 2 });
        db = {
            $queryRaw: async (strings: TemplateStringsArray, ...values: any[]) => {
                const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '');
                return (await pool.query(text, values)).rows;
            },
        };
    });
    afterAll(async () => { await pool.end(); });

    it('la tabla no existe de verdad, y aun asi maxViews=1 con 5 lecturas simultaneas da 1 exito', async () => {
        await expect(pool.query('SELECT 1 FROM "SecureMessageMeta"')).rejects.toMatchObject({ code: '42P01' });
        const { deps, files } = makeDeps(db);
        const { id } = await createSealed(deps, { envelope: await env(), sender: 'a@x.test', ttlDays: 7, maxViews: 1, userId: 'no-importa' });
        const results = await Promise.all(Array.from({ length: 5 }, () => consume(deps, id)));
        expect(results.filter(Boolean)).toHaveLength(1);
        expect(files.has(`secure/${id}.sealed`)).toBe(false);
        expect(await getMeta(deps, id)).toBeNull();
    });
});
