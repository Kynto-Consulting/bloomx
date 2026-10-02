import { describe, expect, it } from 'vitest';
import { BridgeError } from '../host-services/bridge-route';
import { SHARED_MAX_LIMIT, handleStorage, storageRequest, type StorageRequest, type StorageStore } from '../host-services/storage';
import { issueExecutionGrant, verifyExecutionGrant } from '@/lib/exec-grant';
import { generateEd25519KeyPair } from '@/lib/bloomx-signature';

const code = async (p: Promise<unknown>) => { try { await p; return 'no-error'; } catch (e) { return e instanceof BridgeError ? e.code : `other:${(e as Error).message}`; } };

/** Almacen en memoria con la misma semantica que el SQL: filas por (usuario, extension, clave). */
function memoryStore() {
    const rows: Array<{ u: string; e: string; key: string; value: string }> = [];
    const store: StorageStore = {
        get: async (u, e, key) => rows.find((r) => r.u === u && r.e === e && r.key === key)?.value ?? null,
        set: async (u, e, key, value) => {
            const at = rows.findIndex((r) => r.u === u && r.e === e && r.key === key);
            if (at >= 0) rows[at].value = value; else rows.push({ u, e, key, value });
            return { ok: true, usedBytes: 0 };
        },
        delete: async (u, e, key) => { const at = rows.findIndex((r) => r.u === u && r.e === e && r.key === key); if (at >= 0) rows.splice(at, 1); return at >= 0; },
        list: async (u, e, prefix, limit) => ({ keys: rows.filter((r) => r.u === u && r.e === e && r.key.startsWith(prefix)).map((r) => r.key).slice(0, limit), usedBytes: 0 }),
        listShared: async (e, prefix, limit) => rows.filter((r) => r.e === e && r.key.startsWith(prefix)).map((r) => ({ key: r.key, value: r.value })).slice(0, limit),
    };
    return { store, rows };
}
const call = (store: StorageStore, who: { userId: string; extensionId: string }, op: string, args: Record<string, unknown>, grant?: { evt?: string }) =>
    handleStorage(store, storageRequest.parse({ ...who, op, args }) as StorageRequest, { grant }) as Promise<any>;

describe('services.storage: claves compartidas (shared/)', () => {
    it('esquema: listShared exige prefijo shared/ y limite 1..200; sin claves extra', () => {
        const who = { userId: 'u1', extensionId: 'ext' };
        expect(storageRequest.safeParse({ ...who, op: 'listShared', args: { prefix: 'shared/auto/' } }).success).toBe(true);
        for (const bad of [{ prefix: 'auto/' }, { prefix: '' }, { prefix: 'shared' }, { prefix: 'shared/ x' }, { prefix: 'shared/a', limit: 0 }, { prefix: 'shared/a', limit: SHARED_MAX_LIMIT + 1 }, { prefix: 'shared/a', userId: 'x' }]) {
            expect(storageRequest.safeParse({ ...who, op: 'listShared', args: bad }).success, JSON.stringify(bad)).toBe(false);
        }
    });

    it('escribir shared/ SIN evento de hook en la concesion => forbidden; con evento => ok; claves normales no cambian', async () => {
        const { store, rows } = memoryStore();
        const me = { userId: 'u1', extensionId: 'ext' };
        expect(await code(call(store, me, 'set', { key: 'shared/auto/soporte/m', value: { email: 'a@x.com' } }))).toBe('forbidden');
        expect(await code(call(store, me, 'set', { key: 'shared/auto/soporte/m', value: 1 }, {}))).toBe('forbidden');
        expect(await code(call(store, me, 'delete', { key: 'shared/auto/soporte/m' }))).toBe('forbidden');
        expect(rows).toHaveLength(0);
        expect((await call(store, me, 'set', { key: 'shared/auto/soporte/m', value: { email: 'a@x.com' } }, { evt: 'USER_CREATED' })).ok).toBe(true);
        expect(rows).toHaveLength(1);
        // claves no compartidas: sin cambios de comportamiento (no exigen evento)
        expect((await call(store, me, 'set', { key: 'note:1', value: 1 })).ok).toBe(true);
        expect((await call(store, me, 'delete', { key: 'shared/auto/soporte/m' }, { evt: 'USER_DISABLED' })).deleted).toBe(true);
    });

    it('listShared devuelve los valores de TODOS los usuarios de ESA extension, sin identidad, y no mezcla extensiones ni prefijos', async () => {
        const { store } = memoryStore();
        const ev = { evt: 'USER_CREATED' };
        await call(store, { userId: 'u1', extensionId: 'ext' }, 'set', { key: 'shared/auto/soporte/m', value: { email: 'a@x.com' } }, ev);
        await call(store, { userId: 'u2', extensionId: 'ext' }, 'set', { key: 'shared/auto/soporte/m', value: { email: 'b@x.com' } }, ev);
        await call(store, { userId: 'u3', extensionId: 'ext' }, 'set', { key: 'shared/auto/ventas/m', value: { email: 'c@x.com' } }, ev);
        await call(store, { userId: 'u4', extensionId: 'otra' }, 'set', { key: 'shared/auto/soporte/m', value: { email: 'd@x.com' } }, ev);
        const out = await call(store, { userId: 'cualquiera', extensionId: 'ext' }, 'listShared', { prefix: 'shared/auto/soporte/' });
        expect(out.items.map((i: any) => i.value.email).sort()).toEqual(['a@x.com', 'b@x.com']);
        expect(JSON.stringify(out)).not.toMatch(/u1|u2|userId/);
        const limited = await call(store, { userId: 'u9', extensionId: 'ext' }, 'listShared', { prefix: 'shared/auto/', limit: 1 });
        expect(limited.items).toHaveLength(1);
    });

    it('un valor corrupto se omite sin romper la lectura', async () => {
        const { store, rows } = memoryStore();
        rows.push({ u: 'u1', e: 'ext', key: 'shared/x/1', value: '{no json' }, { u: 'u2', e: 'ext', key: 'shared/x/2', value: '{"ok":true}' });
        const out = await call(store, { userId: 'u1', extensionId: 'ext' }, 'listShared', { prefix: 'shared/x/' });
        expect(out.items).toEqual([{ key: 'shared/x/2', value: { ok: true } }]);
    });
});

describe('executionGrant: claim evt (procedencia de hook)', () => {
    const env = () => ({ BLOOMX_DOMAIN_PRIVATE_KEY: generateEd25519KeyPair().privatePem, TOP_DOMAIN: 'acme.com' }) as Record<string, string>;
    it('se firma, se verifica y solo acepta nombres de evento validos', () => {
        const e = env();
        const withEvt = issueExecutionGrant({ domain: 'acme.com', extensionId: 'ext', version: '1.0.0', userId: 'u1', permissions: ['STORAGE'], event: 'USER_CREATED' }, e)!;
        const v = verifyExecutionGrant(withEvt, e);
        expect(v.ok && v.claims.evt).toBe('USER_CREATED');
        const without = issueExecutionGrant({ domain: 'acme.com', extensionId: 'ext', version: '1.0.0', userId: 'u1', permissions: ['STORAGE'] }, e)!;
        const v2 = verifyExecutionGrant(without, e);
        expect(v2.ok && v2.claims.evt).toBeUndefined();
        const junk = issueExecutionGrant({ domain: 'acme.com', extensionId: 'ext', version: '1.0.0', userId: 'u1', permissions: [], event: 'not valid!' }, e)!;
        const v3 = verifyExecutionGrant(junk, e);
        expect(v3.ok && v3.claims.evt).toBeUndefined();
    });
});
