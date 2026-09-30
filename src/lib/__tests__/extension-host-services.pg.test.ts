import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLocalPg, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';
import { getDbPool } from '../db/pool';
import { STORAGE_MAX_KEYS, STORAGE_QUOTA_BYTES, createPgStorageStore, handleStorage, storageRequest, type StorageRequest } from '../expansions/host-services/storage';
import { NOTIFY_MAX_PENDING, createPgNotifyStore, handleNotify, notifyRequest, type NotifyRequest } from '../expansions/host-services/notify';
import { BridgeError } from '../expansions/host-services/bridge-route';

// SQL real de services.storage / services.notify contra el Postgres embebido (cuota atomica, upsert, cascada).
beforeAll(() => assertLocalPg());
afterAll(async () => { await prisma.$disconnect(); });

const pool = () => getDbPool() as any;
const storage = createPgStorageStore(() => pool());
const notify = createPgNotifyStore(() => pool());
const st = (userId: string, extensionId: string, body: Record<string, unknown>) =>
    handleStorage(storage, storageRequest.parse({ userId, extensionId, ...body }) as StorageRequest) as Promise<any>;
const rows = async (sql: string, params: unknown[]) => (await pool().query(sql, params)).rows;

describe('ExtensionStorage (Postgres)', () => {
    it('upsert: set/get/list/delete, bytes de claves+valores y sobrescritura sin doble conteo', async () => {
        const u = await createUser(prisma);
        const r1 = await st(u.id, 'ext.a', { op: 'set', args: { key: 'cfg/theme', value: { dark: true } } });
        expect(r1.usedBytes).toBe(Buffer.byteLength('cfg/theme') + Buffer.byteLength('{"dark":true}'));
        const r2 = await st(u.id, 'ext.a', { op: 'set', args: { key: 'cfg/theme', value: 'é' } });
        expect(r2.usedBytes).toBe(Buffer.byteLength('cfg/theme') + Buffer.byteLength('"é"'));
        expect((await st(u.id, 'ext.a', { op: 'get', args: { key: 'cfg/theme' } })).value).toBe('é');
        await st(u.id, 'ext.a', { op: 'set', args: { key: 'cfg_x', value: 1 } });
        await st(u.id, 'ext.a', { op: 'set', args: { key: 'other', value: 1 } });
        // "_" en el prefijo es literal (no comodin de LIKE)
        expect((await st(u.id, 'ext.a', { op: 'list', args: { prefix: 'cfg_' } })).keys).toEqual(['cfg_x']);
        expect((await st(u.id, 'ext.a', { op: 'list', args: {} })).keys).toEqual(['cfg/theme', 'cfg_x', 'other']);
        expect(await st(u.id, 'ext.a', { op: 'delete', args: { key: 'other' } })).toEqual({ deleted: true });
        expect(await st(u.id, 'ext.a', { op: 'delete', args: { key: 'other' } })).toEqual({ deleted: false });
    });

    it('aislamiento por extension y por usuario', async () => {
        const u1 = await createUser(prisma), u2 = await createUser(prisma);
        await st(u1.id, 'ext.a', { op: 'set', args: { key: 'k', value: 'secreto' } });
        expect((await st(u1.id, 'ext.b', { op: 'get', args: { key: 'k' } })).value).toBeNull();
        expect((await st(u2.id, 'ext.a', { op: 'get', args: { key: 'k' } })).value).toBeNull();
        expect(await st(u2.id, 'ext.a', { op: 'delete', args: { key: 'k' } })).toEqual({ deleted: false });
        expect((await st(u1.id, 'ext.a', { op: 'get', args: { key: 'k' } })).value).toBe('secreto');
    });

    it('cuota ATOMICA: 12 escrituras concurrentes de 60 KB => exactamente 4 caben (413 el resto)', async () => {
        const u = await createUser(prisma);
        const value = 'x'.repeat(60 * 1024);
        const results = await Promise.all(Array.from({ length: 12 }, (_, i) => st(u.id, 'ext.q', { op: 'set', args: { key: `k${i}`, value } }).then(() => 'ok', (e) => (e instanceof BridgeError ? e.code : `err:${e.message}`))));
        expect(results.filter((r) => r === 'ok')).toHaveLength(4);
        expect(results.filter((r) => r === 'quota_exceeded')).toHaveLength(8);
        const [{ used }] = await rows('SELECT COALESCE(SUM("bytes"),0)::int AS used FROM "ExtensionStorage" WHERE "userId"=$1 AND "extensionId"=$2', [u.id, 'ext.q']);
        expect(used).toBeLessThanOrEqual(STORAGE_QUOTA_BYTES);
        // Otra extension del mismo usuario tiene su propia cuota
        await expect(st(u.id, 'ext.other', { op: 'set', args: { key: 'k', value } })).resolves.toMatchObject({ ok: true });
        // Sobrescribir una clave existente con algo mas pequeno siempre cabe
        const okKey = (await rows('SELECT "key" FROM "ExtensionStorage" WHERE "userId"=$1 AND "extensionId"=$2 LIMIT 1', [u.id, 'ext.q']))[0].key;
        await expect(st(u.id, 'ext.q', { op: 'set', args: { key: okKey, value: 'pequeno' } })).resolves.toMatchObject({ ok: true });
    });

    it('tope de claves por (usuario, extension)', async () => {
        const u = await createUser(prisma);
        await pool().query(
            `INSERT INTO "ExtensionStorage" ("userId","extensionId","key","value","bytes") SELECT $1, 'ext.m', 'k' || g, '1', 3 FROM generate_series(1, $2) g`,
            [u.id, STORAGE_MAX_KEYS],
        );
        expect(await st(u.id, 'ext.m', { op: 'set', args: { key: 'nueva', value: 1 } }).catch((e) => e.code)).toBe('quota_exceeded');
        await expect(st(u.id, 'ext.m', { op: 'set', args: { key: 'k1', value: 2 } })).resolves.toMatchObject({ ok: true }); // existente: permitido
    });

    it('borrar el usuario borra su almacenamiento y sus notificaciones (FK ON DELETE CASCADE)', async () => {
        const u = await createUser(prisma);
        await st(u.id, 'ext.a', { op: 'set', args: { key: 'k', value: 1 } });
        await notify.enqueue({ id: uid('n'), userId: u.id, extensionId: 'ext.a', level: 'info', title: null, message: 'm', url: null }, 20);
        await prisma.user.delete({ where: { id: u.id } });
        expect(await rows('SELECT 1 FROM "ExtensionStorage" WHERE "userId"=$1', [u.id])).toHaveLength(0);
        expect(await rows('SELECT 1 FROM "ExtensionNotification" WHERE "userId"=$1', [u.id])).toHaveLength(0);
    });

    it('no admite filas para un usuario inexistente (FK)', async () => {
        await expect(storage.set(uid('ghost'), 'ext.a', 'k', '1', 3)).rejects.toThrow();
    });
});

describe('ExtensionNotification (Postgres)', () => {
    const toast = (userId: string, extensionId: string, args: Record<string, unknown>) =>
        handleNotify({ store: notify, rateLimit: async () => ({ ok: true, retryAfter: 0 }) }, notifyRequest.parse({ userId, extensionId, op: 'toast', args }) as NotifyRequest) as Promise<any>;

    it('tope ATOMICO de 20 pendientes: 30 toasts concurrentes => 20 guardados', async () => {
        const u = await createUser(prisma);
        const results = await Promise.all(Array.from({ length: 30 }, (_, i) => toast(u.id, 'ext.n', { message: `m${i}` }).then(() => 'ok', (e) => (e instanceof BridgeError ? e.code : `err:${e.message}`))));
        expect(results.filter((r) => r === 'ok')).toHaveLength(NOTIFY_MAX_PENDING);
        expect(results.filter((r) => r === 'rate_limited')).toHaveLength(10);
        // Otra extension: su propio cupo
        await expect(toast(u.id, 'ext.other', { message: 'hola' })).resolves.toEqual({ delivered: true });
    });

    it('takePending devuelve max N mas antiguas primero, las marca entregadas y libera cupo', async () => {
        const u = await createUser(prisma), other = await createUser(prisma);
        for (let i = 0; i < 25; i++) {
            const ext = i < 15 ? 'ext.a' : 'ext.b';
            await toast(u.id, ext, { message: `m${i}`, level: i === 0 ? 'error' : 'info', title: i === 0 ? 'T' : undefined, url: i === 0 ? '/calendar' : undefined });
            await pool().query('UPDATE "ExtensionNotification" SET "createdAt" = NOW() + ($3 || \' milliseconds\')::interval WHERE "userId"=$1 AND "message"=$2', [u.id, `m${i}`, String(i)]);
        }
        await toast(other.id, 'ext.a', { message: 'ajena' });

        const first = await notify.takePending(u.id, 20);
        expect(first).toHaveLength(20);
        expect(first.map((n) => n.message)).toEqual(Array.from({ length: 20 }, (_, i) => `m${i}`));
        expect(first[0]).toMatchObject({ level: 'error', title: 'T', url: '/calendar', extensionId: 'ext.a' });
        expect(Object.keys(first[0]).sort()).toEqual(['createdAt', 'extensionId', 'id', 'level', 'message', 'title', 'url']);
        const second = await notify.takePending(u.id, 20);
        expect(second.map((n) => n.message)).toEqual(['m20', 'm21', 'm22', 'm23', 'm24']);
        expect(await notify.takePending(u.id, 20)).toEqual([]);
        // Las de otro usuario siguen pendientes para el (y no se mezclan)
        expect((await notify.takePending(other.id, 20)).map((n) => n.message)).toEqual(['ajena']);
        // Entregadas => ya no cuentan para el tope
        await expect(toast(u.id, 'ext.a', { message: 'de nuevo' })).resolves.toEqual({ delivered: true });
    });

    it('dos lecturas concurrentes no entregan la misma notificacion dos veces', async () => {
        const u = await createUser(prisma);
        for (let i = 0; i < 10; i++) await toast(u.id, 'ext.c', { message: `m${i}` });
        const [a, b] = await Promise.all([notify.takePending(u.id, 20), notify.takePending(u.id, 20)]);
        const ids = [...a, ...b].map((n) => n.id);
        expect(ids).toHaveLength(10);
        expect(new Set(ids).size).toBe(10);
    });
});
