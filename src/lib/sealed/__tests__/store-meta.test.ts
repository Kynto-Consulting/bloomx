import { describe, it, expect } from 'vitest';
import { consume, createSealed, getMeta, type StoreDeps } from '../store';
import type { MetaStore } from '../meta-db';
import { sealMessage } from '../crypto';

/** MetaStore en memoria con la MISMA semantica que el UPDATE atomico (para probar el flujo del almacen sin Postgres). */
function fakeMeta(now: () => number) {
    const rows = new Map<string, { views: number; maxViews: number | null; expiresAt: Date }>();
    const meta: MetaStore = {
        insert: async ({ id, maxViews, expiresAt }) => { rows.set(id, { views: 0, maxViews, expiresAt }); return 'ok'; },
        peek: async (id) => {
            const r = rows.get(id);
            return r ? { status: 'ok', row: { ...r, expired: r.expiresAt.getTime() <= now() } } : { status: 'none' };
        },
        consume: async (id) => {
            const r = rows.get(id);
            if (!r) return { status: 'none' };
            if ((r.maxViews !== null && r.views >= r.maxViews) || r.expiresAt.getTime() <= now()) return { status: 'exhausted' };
            r.views++;
            return { status: 'ok', views: r.views, maxViews: r.maxViews, expiresAt: r.expiresAt };
        },
    };
    return { meta, rows };
}

function makeDeps(makeMeta?: (now: () => number) => MetaStore) {
    const clock = { t: Date.parse('2026-09-29T12:00:00Z') };
    const files = new Map<string, string>();
    const order: string[] = [];
    let n = 0;
    const deps: StoreDeps = {
        get: async (k) => { order.push('get'); return files.get(k) ?? null; },
        put: async (k, b) => { files.set(k, b); },
        del: async (k) => { order.push('del'); files.delete(k); },
        wrap: (p) => p,
        unwrap: (c) => c,
        now: () => clock.t,
        newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    };
    if (makeMeta) deps.meta = makeMeta(deps.now);
    return { deps, files, clock, order };
}

const env = async () => (await sealMessage({ subject: 's', html: '<p>x</p>' })).envelope;

describe('almacen con contador en tabla (SecureMessageMeta)', () => {
    it('no reescribe el objeto al contar; la ultima vista lo borra', async () => {
        let fm!: ReturnType<typeof fakeMeta>;
        const { deps, files } = makeDeps((now) => { fm = fakeMeta(now); return fm.meta; });
        const { id } = await createSealed(deps, { envelope: await env(), sender: 'a@x.com', ttlDays: 7, maxViews: 2, userId: 'u1' });
        const before = files.get(`secure/${id}.sealed`);
        const r1: any = await consume(deps, id);
        expect(r1.remainingViews).toBe(1);
        expect(files.get(`secure/${id}.sealed`)).toBe(before); // sin lectura-modificacion-escritura sobre el objeto
        const r2: any = await consume(deps, id);
        expect(r2.remainingViews).toBe(0);
        expect(files.has(`secure/${id}.sealed`)).toBe(false);
        expect(await consume(deps, id)).toBeNull();
    });

    it('un GET (getMeta) nunca cuenta: escaner/prefetch no consumen vistas', async () => {
        let fm!: ReturnType<typeof fakeMeta>;
        const { deps } = makeDeps((now) => { fm = fakeMeta(now); return fm.meta; });
        const { id } = await createSealed(deps, { envelope: await env(), sender: 'a@x.com', ttlDays: 7, maxViews: 1, userId: 'u1' });
        for (let i = 0; i < 10; i++) expect((await getMeta(deps, id))?.remainingViews).toBe(1);
        expect(fm.rows.get(id)!.views).toBe(0);
        expect(await consume(deps, id)).not.toBeNull();
        expect(await consume(deps, id)).toBeNull();
    });

    it('lee el objeto ANTES de contar (quien gana una vista siempre tiene el contenido)', async () => {
        const { deps, order } = makeDeps((now) => fakeMeta(now).meta);
        const { id } = await createSealed(deps, { envelope: await env(), sender: 'a@x.com', ttlDays: 7, maxViews: 1, userId: 'u1' });
        order.length = 0;
        await consume(deps, id);
        expect(order).toEqual(['get', 'del']); // get antes; el borrado tras contar la ultima
    });

    it('sin userId no hay fila y se usa el conteo dentro del objeto', async () => {
        let fm!: ReturnType<typeof fakeMeta>;
        const { deps, files } = makeDeps((now) => { fm = fakeMeta(now); return fm.meta; });
        const { id } = await createSealed(deps, { envelope: await env(), sender: 'a@x.com', ttlDays: 7, maxViews: 1 });
        expect(fm.rows.size).toBe(0);
        expect(await consume(deps, id)).not.toBeNull();
        expect(files.has(`secure/${id}.sealed`)).toBe(false);
    });

    it('meta no disponible (tabla ausente/BD caida): respaldo en el objeto', async () => {
        const down: MetaStore = { insert: async () => 'unavailable', peek: async () => ({ status: 'unavailable' }), consume: async () => ({ status: 'unavailable' }) };
        const { deps } = makeDeps(() => down);
        const { id } = await createSealed(deps, { envelope: await env(), sender: 'a@x.com', ttlDays: 7, maxViews: 2, userId: 'u1' });
        const r1: any = await consume(deps, id);
        expect(r1.remainingViews).toBe(1);
        expect((await getMeta(deps, id))?.remainingViews).toBe(1);
        expect(await consume(deps, id)).not.toBeNull();
        expect(await consume(deps, id)).toBeNull();
    });

    it('la caducidad del objeto borra y no cuenta', async () => {
        let fm!: ReturnType<typeof fakeMeta>;
        const { deps, files, clock } = makeDeps((now) => { fm = fakeMeta(now); return fm.meta; });
        const { id } = await createSealed(deps, { envelope: await env(), sender: 'a@x.com', ttlDays: 1, maxViews: 3, userId: 'u1' });
        clock.t += 2 * 24 * 3600 * 1000;
        expect(await consume(deps, id)).toBeNull();
        expect(files.has(`secure/${id}.sealed`)).toBe(false);
        expect(fm.rows.get(id)!.views).toBe(0);
    });
});
