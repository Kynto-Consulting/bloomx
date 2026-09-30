import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { assertLocalPg, createUser } from './helpers/pg';
import { prisma } from '../prisma';

// Cuota de buzon POR USUARIO desde la consola (PUT /api/admin/users/[id]/quota) contra Postgres REAL y publicacion del cambio
// a otras instancias (version en BD, comprobada como mucho cada 5 s). `npm run test:pg`.

const audits: Array<{ event: string; data: Record<string, unknown> }> = [];
let adminGuard: { ok: true; actor: { kind: 'user'; id: string; email: string } } | { ok: false; response: Response } = {
    ok: true, actor: { kind: 'user', id: 'admin-1', email: 'admin@pg.test' },
};
vi.mock('@/lib/admin-auth', () => ({ requireAdmin: vi.fn(async () => adminGuard) }));
vi.mock('@/lib/security', async (orig) => {
    const actual = await orig<typeof import('@/lib/security')>();
    return {
        ...actual,
        auditLog: vi.fn((event: string, data: Record<string, unknown>) => { audits.push({ event, data }); }),
        rateLimitAsync: vi.fn(async () => ({ ok: true, remaining: 10, retryAfter: 0 })),
        getClientIp: () => '203.0.113.9',
    };
});

const STARTED_AT = new Date(Date.now() - 1000);
const clear = () => prisma.$executeRawUnsafe(`DELETE FROM "AdminSetting" WHERE "key" IN ('mailQuotaMb','enforceMailQuota','mailQuotaVersion') OR "key" LIKE 'mailQuotaMb:user:%'`);
let user: { id: string; email: string };
let other: { id: string; email: string };

const put = async (id: string, body: unknown) => {
    const { PUT } = await import('../../app/api/admin/users/[id]/quota/route');
    const res = await PUT(new NextRequest(`http://localhost/api/admin/users/${id}/quota`, { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body) }), { params: Promise.resolve({ id }) });
    return { status: res.status, body: await res.json() };
};
const getQ = async (id: string) => {
    const { GET } = await import('../../app/api/admin/users/[id]/quota/route');
    const res = await GET(new NextRequest(`http://localhost/api/admin/users/${id}/quota`), { params: Promise.resolve({ id }) });
    return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
    assertLocalPg();
    for (const m of ['log', 'error', 'warn'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
    user = await createUser(prisma);
    other = await createUser(prisma);
});
beforeEach(async () => {
    adminGuard = { ok: true, actor: { kind: 'user', id: 'admin-1', email: 'admin@pg.test' } };
    audits.length = 0;
    vi.unstubAllEnvs();
    vi.stubEnv('MAIL_QUOTA_MB', '');
    await clear();
    const q = await import('../mail-quota');
    q.invalidateQuotaCache();
});
afterAll(async () => {
    await clear();
    vi.unstubAllEnvs();
    await prisma.$executeRawUnsafe('DELETE FROM "User" WHERE "createdAt" >= $1', STARTED_AT);
    await prisma.$disconnect();
});

describe('PUT/GET /api/admin/users/[id]/quota', () => {
    it('fija la cuota SOLO de ese usuario; el valor efectivo y su origen cambian; el resto sigue con la del dominio', async () => {
        await prisma.$executeRawUnsafe(`INSERT INTO "AdminSetting" ("key","value","updatedBy") VALUES ('mailQuotaMb','2000'::jsonb,'test')`);
        const before = await getQ(user.id);
        expect(before.body).toMatchObject({ userMb: null, domainMb: 2000, effectiveMb: 2000, source: 'domain' });

        const r = await put(user.id, { mailQuotaMb: 50 });
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ userMb: 50, domainMb: 2000, effectiveMb: 50, source: 'user', approximate: true });
        expect((await getQ(other.id)).body).toMatchObject({ userMb: null, effectiveMb: 2000, source: 'domain' });
        const status = (await import('../mail-quota'));
        expect((await status.loadPolicy(user.id)).limitBytes).toBe(50 * 1024 * 1024);
        expect(audits).toEqual([expect.objectContaining({ event: 'admin.users.quota_changed', data: expect.objectContaining({ targetUserId: user.id, scope: 'user', mailQuotaMb: 50, actorId: 'admin-1' }) })]);
    });

    it('0 = sin limite para ese usuario (aunque el dominio tenga limite); null restablece a la del dominio y lo audita', async () => {
        await prisma.$executeRawUnsafe(`INSERT INTO "AdminSetting" ("key","value","updatedBy") VALUES ('mailQuotaMb','300'::jsonb,'test')`);
        const zero = await put(user.id, { mailQuotaMb: 0 });
        expect(zero.body).toMatchObject({ userMb: 0, effectiveMb: null, source: 'user' });
        const reset = await put(user.id, { mailQuotaMb: null });
        expect(reset.status).toBe(200);
        expect(reset.body).toMatchObject({ userMb: null, effectiveMb: 300, source: 'domain' });
        const rows = (await prisma.$queryRawUnsafe(`SELECT "key" FROM "AdminSetting" WHERE "key" = $1`, `mailQuotaMb:user:${user.id}`)) as unknown[];
        expect(rows).toHaveLength(0);
        expect(audits.map((a) => a.event)).toEqual(['admin.users.quota_changed', 'admin.users.quota_changed']);
        expect(audits[1].data).toMatchObject({ reset: true, targetUserId: user.id });
        expect(audits[1].data).not.toHaveProperty('mailQuotaMb');
    });

    it('cadena de origen: usuario > dominio > entorno > sin limite', async () => {
        expect((await getQ(user.id)).body).toMatchObject({ effectiveMb: null, source: 'none' });
        vi.stubEnv('MAIL_QUOTA_MB', '750');
        expect((await getQ(user.id)).body).toMatchObject({ effectiveMb: 750, source: 'env', envMb: 750 });
        await prisma.$executeRawUnsafe(`INSERT INTO "AdminSetting" ("key","value","updatedBy") VALUES ('mailQuotaMb','120'::jsonb,'test')`);
        expect((await getQ(user.id)).body).toMatchObject({ effectiveMb: 120, source: 'domain' });
        expect((await put(user.id, { mailQuotaMb: 9 })).body).toMatchObject({ effectiveMb: 9, source: 'user' });
    });

    it('validacion: solo enteros 0..max o null; cuerpos raros -> 400 sin tocar la BD', async () => {
        for (const bad of [{ mailQuotaMb: -1 }, { mailQuotaMb: 1.5 }, { mailQuotaMb: '5' }, { mailQuotaMb: 10_000_001 }, {}, { mailQuotaMb: 5, extra: 1 }, { mailQuotaMb: true }, '{no json', [], null]) {
            const r = await put(user.id, bad as any);
            expect(r.status, JSON.stringify(bad)).toBe(400);
        }
        const rows = (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "AdminSetting" WHERE "key" LIKE 'mailQuotaMb:user:%'`)) as any[];
        expect(rows[0].n).toBe(0);
        expect(audits).toEqual([]);
    });

    it('usuario inexistente: 404 (PUT y GET) y no se crea ninguna fila', async () => {
        expect((await put('no-existe', { mailQuotaMb: 5 })).status).toBe(404);
        expect((await getQ('no-existe')).status).toBe(404);
        const rows = (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "AdminSetting" WHERE "key" LIKE 'mailQuotaMb:user:%'`)) as any[];
        expect(rows[0].n).toBe(0);
    });

    it('requireAdmin: sin sesion 401 y sin rol 403 -> no cambia nada ni audita', async () => {
        for (const status of [401, 403]) {
            adminGuard = { ok: false, get response() { return NextResponse.json({ error: 'x' }, { status }); } };
            expect((await put(user.id, { mailQuotaMb: 5 })).status).toBe(status);
            expect((await getQ(user.id)).status).toBe(status);
        }
        const rows = (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "AdminSetting" WHERE "key" LIKE 'mailQuotaMb:user:%'`)) as any[];
        expect(rows[0].n).toBe(0);
        expect(audits).toEqual([]);
    });

    it('el detalle de usuario incluye la cuota y la lista de usuarios su limite efectivo y origen', async () => {
        await put(user.id, { mailQuotaMb: 77 });
        const { GET } = await import('../../app/api/admin/users/[id]/route');
        const res = await GET(new NextRequest(`http://localhost/api/admin/users/${user.id}`), { params: Promise.resolve({ id: user.id }) });
        const detail = await res.json();
        expect(detail.quota).toMatchObject({ userMb: 77, effectiveMb: 77, source: 'user' });
        const { listUsers } = await import('../admin/users-store');
        const list = await listUsers({ q: user.email }, { limit: 10, offset: 0 });
        expect(list.rows[0]).toMatchObject({ id: user.id, quotaMb: 77, quotaSource: 'user' });
        const others = await listUsers({ q: other.email }, { limit: 10, offset: 0 });
        expect(others.rows[0]).toMatchObject({ quotaMb: null, quotaSource: 'none' });
    });
});

describe('cambios visibles en otras instancias en <= 5 s (version en BD)', () => {
    it('la instancia A ve el cambio hecho por B como mucho 5 s despues, con UNA consulta de version por ventana y sin recalcular el uso', async () => {
        vi.resetModules();
        const A = await import('../mail-quota');
        const prismaA = (await import('../prisma')).prisma;
        const spy = vi.spyOn(prismaA, '$queryRawUnsafe');
        const versionQueries = () => spy.mock.calls.filter((c) => String(c[0]).includes('"AdminSetting" WHERE "key" = $1') && c[1] === A.QUOTA_VERSION_KEY).length;
        const usageQueries = () => spy.mock.calls.filter((c) => String(c[0]).includes('"attachmentsBytes"')).length;

        vi.resetModules();
        const B = await import('../mail-quota');
        const BS = await import('../admin/quota-settings');
        const prismaB = (await import('../prisma')).prisma;
        expect(B).not.toBe(A); // instancias distintas = caches distintas

        await prisma.$executeRawUnsafe(`INSERT INTO "AdminSetting" ("key","value","updatedBy") VALUES ('mailQuotaMb','100'::jsonb,'test')`);
        const T = 1_800_000_000_000;
        expect((await A.getQuotaStatus(user.id, { now: T })).limitBytes).toBe(100 * A.MB);
        expect(versionQueries()).toBe(1);
        const usageAfterFirst = usageQueries();

        // B publica un cambio de cuota del usuario
        await BS.saveQuotaSettings({ userId: user.id, mailQuotaMb: 5 }, 'admin@pg.test');

        // Dentro de la ventana de 5 s A puede seguir viendo lo anterior y NO consulta la version otra vez
        expect((await A.getQuotaStatus(user.id, { now: T + 1000 })).limitBytes).toBe(100 * A.MB);
        expect((await A.getQuotaStatus(user.id, { now: T + 4999 })).limitBytes).toBe(100 * A.MB);
        expect(versionQueries()).toBe(1);

        // Pasados 5 s: una consulta de version, la politica nueva, y el uso NO se vuelve a calcular
        const s = await A.getQuotaStatus(user.id, { now: T + 5001 });
        expect(s.limitBytes).toBe(5 * A.MB);
        expect(s.source).toBe('user');
        expect(versionQueries()).toBe(2);
        expect(usageQueries()).toBe(usageAfterFirst);

        // Restablecer en B (borra la fila del usuario): A vuelve al dominio en la siguiente ventana
        await BS.saveQuotaSettings({ userId: user.id, mailQuotaMb: null }, 'admin@pg.test');
        expect((await A.getQuotaStatus(user.id, { now: T + 5500 })).limitBytes).toBe(5 * A.MB);
        const back = await A.getQuotaStatus(user.id, { now: T + 10_100 });
        expect(back.limitBytes).toBe(100 * A.MB);
        expect(back.source).toBe('domain');

        // Y la propia instancia que escribe lo ve al instante (invalida su cache)
        expect((await B.getQuotaStatus(user.id, { now: T + 10_200 })).source).toBe('domain');
        await BS.saveQuotaSettings({ userId: user.id, mailQuotaMb: 3 }, 'admin@pg.test');
        expect((await B.getQuotaStatus(user.id, { now: T + 10_201 })).limitBytes).toBe(3 * B.MB);

        spy.mockRestore();
        await prismaA.$disconnect();
        await prismaB.$disconnect();
    });

    it('cada escritura de cuota cambia el updatedAt de la fila de version (incluso en el mismo milisegundo)', async () => {
        const q = await import('../mail-quota');
        const read = async () => ((await prisma.$queryRawUnsafe(`SELECT ("updatedAt")::text AS v FROM "AdminSetting" WHERE "key" = $1`, q.QUOTA_VERSION_KEY)) as any[])[0]?.v as string;
        await q.bumpQuotaVersion('t');
        const v1 = await read();
        await q.bumpQuotaVersion('t');
        const v2 = await read();
        await q.bumpQuotaVersion('t');
        const v3 = await read();
        expect(new Set([v1, v2, v3]).size).toBe(3);
    });

    it('sin la tabla / sin fila de version la cache sigue funcionando con su TTL (sin fallar)', async () => {
        const q = await import('../mail-quota');
        q.invalidateQuotaCache();
        const s = await q.getQuotaStatus(user.id, { now: 5_000 });
        expect(s.source).toBe('none');
        expect(await q.getQuotaStatus(user.id, { now: 5_100 })).toBe(s); // misma referencia = cache
    });
});
