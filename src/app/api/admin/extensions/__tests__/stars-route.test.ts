import { beforeEach, describe, expect, it, vi } from 'vitest';

const guard = vi.hoisted(() => ({ result: { ok: true, actor: { kind: 'user', id: 'u1', email: 'a@b.c' } } as any }));
vi.mock('@/lib/admin-auth', () => {
    const guardFn = vi.fn(async () => guard.result);
    return { requireAdmin: guardFn, requireLevel: (_min: number, ...a: unknown[]) => (guardFn as (...x: unknown[]) => unknown)(...a) };
});
vi.mock('@/lib/security', () => ({ auditLog: vi.fn(), getClientIp: () => '1.2.3.4', rateLimitAsync: vi.fn(async () => ({ ok: true, retryAfter: 0 })) }));
const store = vi.hoisted(() => ({ lists: new Map<string, string[]>(), limit: false }));
vi.mock('@/lib/admin/extension-stars', async () => {
    const actual = await vi.importActual<typeof import('@/lib/admin/extension-stars')>('@/lib/admin/extension-stars');
    return {
        ...actual,
        listStars: async (user: string) => store.lists.get(user) ?? [],
        setStar: async (user: string, id: string, starred: boolean) => {
            if (store.limit && starred) throw new actual.StarLimitError();
            const cur = (store.lists.get(user) ?? []).filter((x) => x !== id);
            store.lists.set(user, starred ? [...cur, id] : cur);
            return store.lists.get(user)!;
        },
    };
});

import { GET, PUT } from '../stars/route';
import { SCOPE_LEVELS } from '@/lib/admin-levels';

const put = (body: unknown) => new Request('https://f.test/api/admin/extensions/stars', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = () => new Request('https://f.test/api/admin/extensions/stars');

beforeEach(() => {
    store.lists.clear();
    store.limit = false;
    guard.result = { ok: true, actor: { kind: 'user', id: 'u1', email: 'a@b.c' } };
});

describe('/api/admin/extensions/stars', () => {
    it('es una preferencia personal de nivel 1 (como el catalogo), no un cambio de la instancia', () => {
        expect(SCOPE_LEVELS['extensions.stars']).toBe(1);
        expect((GET as any).meta).toMatchObject({ scope: 'extensions.stars', minLevel: 1 });
    });

    it('marca y lista SOLO las del usuario de la sesion (el id no se toma del cuerpo)', async () => {
        const r = await PUT(put({ extensionId: 'core-dlp', starred: true, userId: 'otro' }) as any);
        expect(r.status).toBe(200);
        expect(await r.json()).toEqual({ stars: ['core-dlp'] });
        guard.result = { ok: true, actor: { kind: 'user', id: 'u2', email: 'x@y.z' } };
        expect(await (await GET(get() as any)).json()).toEqual({ stars: [] });
        guard.result = { ok: true, actor: { kind: 'user', id: 'u1', email: 'a@b.c' } };
        expect(await (await GET(get() as any)).json()).toEqual({ stars: ['core-dlp'] });
        expect(store.lists.has('otro')).toBe(false);
    });

    it('valida el cuerpo y el id de extension', async () => {
        expect((await PUT(put({ extensionId: '../x', starred: true }) as any)).status).toBe(400);
        expect((await PUT(put({ extensionId: 'core-dlp' }) as any)).status).toBe(400);
        expect((await PUT(put({ extensionId: 'core-dlp', starred: 'si' }) as any)).status).toBe(400);
    });

    it('tope por administrador => 409 star_limit', async () => {
        store.limit = true;
        const r = await PUT(put({ extensionId: 'core-dlp', starred: true }) as any);
        expect(r.status).toBe(409);
        expect((await r.json()).code).toBe('star_limit');
    });

    it('sin sesion de administracion, la guardia responde (no se llega al almacen)', async () => {
        const { NextResponse } = await import('next/server');
        guard.result = { ok: false, response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
        expect((await GET(get() as any)).status).toBe(401);
        expect((await PUT(put({ extensionId: 'core-dlp', starred: true }) as any)).status).toBe(401);
        expect(store.lists.size).toBe(0);
    });
});
