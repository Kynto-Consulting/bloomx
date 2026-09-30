import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { assertLocalPg, createEmail, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';
import {
    getFolderFilterCounts, getPreviousFolders, moveEmailsTracked, ownAddressesOf, restoreEmailsToPrevious, selectScopeIds,
} from '../mail-store';
import { buildScopeCountsSql, emptyScope } from '../mail-list-sql';
import { getSqlOptions } from '../mail-store';

// Lista del servidor (orden, filtros, cursor estable), conteos por filtro, carpeta de origen (previousFolder) y acciones por
// alcance contra Postgres REAL: `npm run test:pg`.

const STARTED_AT = new Date(Date.now() - 1000);
let sessionUser: { id: string; email: string; name: string } | null = null;
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => sessionUser }));
vi.mock('@/lib/resend', () => ({ resend: { emails: { send: vi.fn() } } }));
vi.mock('@/lib/storage', () => ({
    uploadToStorage: vi.fn(async () => undefined),
    getBufferFromStorage: vi.fn(async () => null),
    getFromStorage: vi.fn(async () => null),
    deleteManyFromStorage: vi.fn(async () => ({ deleted: 0, failed: [] })),
    listStorageObjects: vi.fn(async () => []),
    deleteStoragePrefix: vi.fn(async () => ({ deleted: 0, failed: [] })),
}));
vi.mock('@/lib/expansions/server-hooks', () => ({
    runEmailPreSendHooksForRequest: async () => ({ stop: false, modify: {}, warnings: [] }),
    buildEmailSentContext: () => ({}),
    buildEmailOpenedContext: () => ({}),
    shouldFireOnce: () => false,
    fireLifecycleHook: () => false,
}));

let me: { id: string; email: string; name: string };
let other: { id: string; email: string };

beforeAll(async () => {
    assertLocalPg();
    for (const m of ['log', 'error', 'warn'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
    const u = await createUser(prisma);
    me = { id: u.id, email: u.email, name: 'Yo' };
    const o = await createUser(prisma);
    other = { id: o.id, email: o.email };
});
beforeEach(() => { sessionUser = me; });
// Los datos globales (usuarios, correos, eventos, borradores) que crea este archivo se borran al terminar: otras suites (metricas de admin)
// hacen agregados sobre toda la base y no deben verlos.
afterAll(async () => { await 
    await prisma.$executeRawUnsafe('DELETE FROM "EmailEvent" WHERE "createdAt" >= $1', STARTED_AT);
    await prisma.$executeRawUnsafe('DELETE FROM "Draft" WHERE "createdAt" >= $1', STARTED_AT);
    await prisma.$executeRawUnsafe('DELETE FROM "User" WHERE "createdAt" >= $1', STARTED_AT);
    await prisma.$disconnect();
});

const get = async (path: string) => {
    const { GET } = await import('../../app/api/emails/route');
    const res = await GET(new NextRequest(`http://localhost${path}`));
    return { status: res.status, body: await res.json() };
};
const batch = async (method: 'PATCH' | 'DELETE', body: unknown) => {
    const route = await import('../../app/api/emails/batch/route');
    const res = await route[method](new NextRequest('http://localhost/api/emails/batch', { method, body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
};
const folderOf = async (id: string) => (await prisma.email.findUnique({ where: { id }, select: { folder: true } }))!.folder;
const prev = async (id: string) => (await getPreviousFolders([id], [me.id, other.id]))[id];

describe('DDL aditivo', () => {
    it('Email.previousFolder (TEXT NULL) y el indice parcial de destacados existen', async () => {
        const col = await prisma.$queryRawUnsafe(`SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'Email' AND column_name = 'previousFolder'`) as any[];
        expect(col).toEqual([{ data_type: 'text', is_nullable: 'YES' }]);
        const idx = await prisma.$queryRawUnsafe(`SELECT indexdef FROM pg_indexes WHERE indexname = 'Email_userId_folder_starred_idx'`) as any[];
        expect(idx[0].indexdef).toContain('WHERE');
        expect(idx[0].indexdef).toContain('starred');
    });
});

describe('previousFolder: lo fija el servidor al mover a archive/trash/spam', () => {
    it('inbox -> archive -> trash encadena el origen; volver a inbox lo limpia; mismo destino no lo pisa', async () => {
        const e = await createEmail(prisma, me.id, { folder: 'inbox' });
        expect(await prev(e.id)).toBeNull();
        await moveEmailsTracked({ ids: [e.id], userIds: [me.id], folder: 'archive' });
        expect(await prev(e.id)).toBe('inbox');
        await moveEmailsTracked({ ids: [e.id], userIds: [me.id], folder: 'trash' });
        expect(await folderOf(e.id)).toBe('trash');
        expect(await prev(e.id)).toBe('archive');
        await moveEmailsTracked({ ids: [e.id], userIds: [me.id], folder: 'trash' }); // ya esta ahi: el origen no se pierde
        expect(await prev(e.id)).toBe('archive');
        await moveEmailsTracked({ ids: [e.id], userIds: [me.id], folder: 'inbox' });
        expect(await prev(e.id)).toBeNull();
    });

    it('solo toca correos de los buzones permitidos y actualiza leido/destacado en la misma sentencia', async () => {
        const mine = await createEmail(prisma, me.id, { read: false });
        const theirs = await createEmail(prisma, other.id, { read: false });
        const n = await moveEmailsTracked({ ids: [mine.id, theirs.id], userIds: [me.id], folder: 'spam', read: true, starred: true });
        expect(n).toBe(1);
        expect(await prisma.email.findUnique({ where: { id: mine.id } })).toMatchObject({ folder: 'spam', read: true, starred: true });
        expect(await prisma.email.findUnique({ where: { id: theirs.id } })).toMatchObject({ folder: 'inbox', read: false, starred: false });
        expect(await prev(theirs.id)).toBeNull();
    });

    it('PATCH /api/emails/[id] y PATCH batch por ids registran el origen; restore lo usa', async () => {
        const { PATCH } = await import('../../app/api/emails/[id]/route');
        const a = await createEmail(prisma, me.id, { folder: 'archive' });
        const b = await createEmail(prisma, me.id, { folder: 'inbox' });
        const c = await createEmail(prisma, me.id, { folder: 'spam' });
        const one = await PATCH(new NextRequest(`http://localhost/api/emails/${a.id}`, { method: 'PATCH', body: JSON.stringify({ folder: 'trash' }) }), { params: Promise.resolve({ id: a.id }) });
        expect(one.status).toBe(200);
        expect((await one.json()).folder).toBe('trash');
        expect(await prev(a.id)).toBe('archive');

        const many = await batch('PATCH', { ids: [b.id, c.id], updates: { folder: 'trash' } });
        expect(many.body.count).toBe(2);
        expect(await prev(b.id)).toBe('inbox');
        expect(await prev(c.id)).toBe('spam');

        const restored = await batch('PATCH', { ids: [a.id, b.id, c.id], updates: { restore: true } });
        expect(restored.body).toMatchObject({ count: 3, targets: { [a.id]: 'archive', [b.id]: 'inbox', [c.id]: 'spam' } });
        expect(await folderOf(a.id)).toBe('archive');
        expect(await folderOf(b.id)).toBe('inbox');
        expect(await folderOf(c.id)).toBe('spam');
        // Restaurar desde la papelera y volver a mandarla deja de nuevo el origen correcto
        expect(await prev(b.id)).toBeNull();
    });

    it('restore: sin dato cae a la bandeja, respaldo legado valido se usa, carpetas invalidas se ignoran, solo trash/spam', async () => {
        const noData = await createEmail(prisma, me.id, { folder: 'trash' });
        const legacy = await createEmail(prisma, me.id, { folder: 'trash' });
        const junk = await createEmail(prisma, me.id, { folder: 'trash' });
        const notInTrash = await createEmail(prisma, me.id, { folder: 'archive' });
        const r = await batch('PATCH', {
            ids: [noData.id, legacy.id, junk.id, notInTrash.id], updates: { restore: true },
            fallbacks: { [legacy.id]: 'archive', [junk.id]: 'snoozed', [notInTrash.id]: 'spam' },
        });
        expect(r.body.count).toBe(3);
        expect(await folderOf(noData.id)).toBe('inbox');
        expect(await folderOf(legacy.id)).toBe('archive');
        expect(await folderOf(junk.id)).toBe('inbox');
        expect(await folderOf(notInTrash.id)).toBe('archive'); // no estaba en la papelera: intacto
    });

    it('restore nunca actua sobre correos de otro usuario (IDOR)', async () => {
        const theirs = await createEmail(prisma, other.id, { folder: 'trash' });
        const r = await batch('PATCH', { ids: [theirs.id], updates: { restore: true } });
        expect(r.body.count).toBe(0);
        expect(await folderOf(theirs.id)).toBe('trash');
        expect((await restoreEmailsToPrevious([theirs.id], [me.id])).count).toBe(0);
    });

    it('folder + restore a la vez: 400', async () => {
        const e = await createEmail(prisma, me.id, { folder: 'trash' });
        expect((await batch('PATCH', { ids: [e.id], updates: { restore: true, folder: 'inbox' } })).status).toBe(400);
    });

    it('sin la columna (despliegue sin db:ensure) mover sigue funcionando y restaurar cae a la bandeja', async () => {
        const e = await createEmail(prisma, me.id, { folder: 'archive' });
        await prisma.$executeRawUnsafe(`ALTER TABLE "Email" RENAME COLUMN "previousFolder" TO "previousFolder_off"`);
        try {
            expect(await moveEmailsTracked({ ids: [e.id], userIds: [me.id], folder: 'trash' })).toBe(1);
            expect(await folderOf(e.id)).toBe('trash');
            expect(await getPreviousFolders([e.id], [me.id])).toEqual({});
            const r = await restoreEmailsToPrevious([e.id], [me.id]);
            expect(r.targets[e.id]).toBe('inbox');
            expect(await folderOf(e.id)).toBe('inbox');
        } finally {
            await prisma.$executeRawUnsafe(`ALTER TABLE "Email" RENAME COLUMN "previousFolder_off" TO "previousFolder"`);
        }
    });
});

describe('lista del servidor: orden, filtros y cursor estable', () => {
    let user: { id: string; email: string; name: string };
    const ids: string[] = [];
    const base = Date.UTC(2031, 0, 1, 12, 0, 0);

    beforeAll(async () => {
        const u = await createUser(prisma);
        user = { id: u.id, email: u.email, name: 'Lista' };
        const senders = ['Alfa <alfa@x.test>', 'beta <beta@x.test>', 'Zeta <zeta@x.test>', '"Omega" <omega@x.test>'];
        for (let i = 0; i < 47; i++) {
            const tie = i >= 10 && i <= 16; // varios con la MISMA fecha: el desempate por id debe ser estable
            const from = i % 9 === 0 ? `Yo <${user.email}>` : senders[i % senders.length];
            const e = await createEmail(prisma, user.id, {
                from, subject: `Asunto ${i}`, folder: 'inbox',
                createdAt: new Date(tie ? base + 10 * 1000 : base + i * 1000),
                read: i % 3 !== 0, starred: i % 5 === 0,
                ...(i % 7 === 0 ? { attachments: { create: [{ filename: `f${i}.txt`, mimeType: 'text/plain', size: 10, key: `k/${i}` }] } } : {}),
            });
            ids.push(e.id);
        }
        for (let i = 0; i < 5; i++) await createEmail(prisma, user.id, { folder: 'archive', subject: `Arch ${i}` });
        for (let i = 0; i < 4; i++) await createEmail(prisma, other.id, { folder: 'inbox', subject: `Ajeno ${i}` });
    });

    async function pageAll(query: string) {
        const seen: string[] = [];
        let cursor: string | null = null;
        let total = -1;
        for (let guard = 0; guard < 20; guard++) {
            const q: string = `/api/emails?folder=inbox${query}${cursor ? `&cursor=${cursor}` : ''}`;
            const { status, body } = await get(q);
            expect(status).toBe(200);
            seen.push(...body.emails.map((e: any) => e.id));
            total = body.total;
            if (!body.hasMore) { expect(body.nextCursor).toBeNull(); break; }
            expect(body.nextCursor).toEqual(expect.any(String));
            cursor = body.nextCursor;
        }
        return { seen, total };
    }
    const sqlOrder = async (orderBy: string, where = '') =>
        ((await prisma.$queryRawUnsafe(`SELECT "id" FROM "Email" WHERE "userId" = $1 AND "folder" = 'inbox' ${where} ORDER BY ${orderBy}`, user.id)) as any[]).map((r) => r.id);

    beforeEach(() => { sessionUser = user; });

    it.each([
        ['newest', '&sort=newest', `"createdAt" DESC, "id" DESC`],
        ['oldest', '&sort=oldest', `"createdAt" ASC, "id" ASC`],
        ['sender', '&sort=sender', `bloomx_sender_key("from") COLLATE "C" ASC, "createdAt" DESC, "id" DESC`],
    ])('orden %s: recorre todas las paginas sin repetir ni saltar y en el orden de la base', async (_n, query, orderBy) => {
        const { seen, total } = await pageAll(query);
        expect(total).toBe(47);
        expect(new Set(seen).size).toBe(seen.length);
        expect(seen).toEqual(await sqlOrder(orderBy));
    });

    it('sin sort ni cursor (cliente antiguo): pagina 1..n por `page` sigue funcionando', async () => {
        const p1 = await get('/api/emails?folder=inbox&page=1');
        const p2 = await get('/api/emails?folder=inbox&page=2');
        expect(p1.body.emails).toHaveLength(20);
        expect(p1.body).toMatchObject({ total: 47, pages: 3, page: 1, hasMore: true });
        expect(new Set([...p1.body.emails, ...p2.body.emails].map((e: any) => e.id)).size).toBe(40);
    });

    it.each([
        ['unread', 'AND "read" = FALSE'],
        ['starred', 'AND "starred" = TRUE'],
        ['attachments', 'AND EXISTS (SELECT 1 FROM "Attachment" a WHERE a."emailId" = "Email"."id")'],
    ])('filtro %s: total exacto y solo devuelve correos que lo cumplen', async (filter, where) => {
        const expected = await sqlOrder(`"createdAt" DESC, "id" DESC`, where);
        const { seen, total } = await pageAll(`&filter=${filter}`);
        expect(total).toBe(expected.length);
        expect(seen).toEqual(expected);
        expect(expected.length).toBeGreaterThan(0);
    });

    it('filtro from_me: remitente = direccion propia (sin distinguir mayusculas)', async () => {
        const expected = await sqlOrder(`"createdAt" DESC, "id" DESC`, `AND lower(btrim(coalesce(substring("from" from '<([^>]+)>'), "from"))) = lower('${user.email}')`);
        const { seen, total } = await pageAll('&filter=from_me');
        expect(total).toBe(expected.length);
        expect(seen).toEqual(expected);
        expect(expected.length).toBe(6); // i = 0, 9, 18, 27, 36, 45
    });

    it('filtro + orden + cursor juntos', async () => {
        const expected = await sqlOrder(`"createdAt" ASC, "id" ASC`, 'AND "read" = FALSE');
        const { seen } = await pageAll('&filter=unread&sort=oldest');
        expect(seen).toEqual(expected);
    });

    it('estable con cambios entre paginas: un correo nuevo arriba y otro borrado no duplican ni saltan', async () => {
        const first = await get('/api/emails?folder=inbox&sort=newest');
        const seenFirst: string[] = first.body.emails.map((e: any) => e.id);
        const removedId = seenFirst[3];
        const fresh = await createEmail(prisma, user.id, { folder: 'inbox', subject: 'Nuevo', createdAt: new Date(base + 999_000_000) });
        await prisma.email.delete({ where: { id: removedId } });
        const rest: string[] = [];
        let cursor: string | null = first.body.nextCursor;
        while (cursor) {
            const r: { body: any } = await get(`/api/emails?folder=inbox&sort=newest&cursor=${cursor}`);
            rest.push(...r.body.emails.map((e: any) => e.id));
            cursor = r.body.hasMore ? r.body.nextCursor : null;
        }
        expect(rest.filter((id) => seenFirst.includes(id))).toEqual([]); // ninguno repetido
        expect(rest).not.toContain(fresh.id); // el nuevo esta "arriba": no aparece en paginas siguientes
        const expectedTail = (await sqlOrder(`"createdAt" DESC, "id" DESC`)).filter((id) => id !== fresh.id && !seenFirst.includes(id));
        expect(rest).toEqual(expectedTail); // ninguno saltado
        await prisma.email.delete({ where: { id: fresh.id } });
        // el correo borrado se repone para no afectar a otras pruebas
        await createEmail(prisma, user.id, { folder: 'inbox', subject: 'Repuesto', createdAt: new Date(base - 5000) });
    });

    it('cursor invalido o de otro orden: 400; parametros desconocidos de orden/filtro caen a los valores por defecto', async () => {
        expect((await get('/api/emails?folder=inbox&cursor=%%%')).status).toBe(400);
        const first = await get('/api/emails?folder=inbox&sort=newest');
        expect((await get(`/api/emails?folder=inbox&sort=oldest&cursor=${first.body.nextCursor}`)).status).toBe(400);
        const dflt = await get('/api/emails?folder=inbox&sort=hax&filter=nope');
        expect(dflt.body).toMatchObject({ sort: 'newest', filter: 'all' });
    });

    it('aislamiento: nunca devuelve correos de otro usuario ni de otra carpeta', async () => {
        const { seen } = await pageAll('');
        const rows = await prisma.email.findMany({ where: { id: { in: seen } }, select: { userId: true, folder: true } });
        expect(rows.every((r) => r.userId === user.id && r.folder === 'inbox')).toBe(true);
    });
});

describe('conteos por filtro de la carpeta (GET /api/counts?folder=)', () => {
    let user: { id: string; email: string; name: string };
    beforeAll(async () => {
        const u = await createUser(prisma);
        user = { id: u.id, email: u.email, name: 'Cuenta' };
        await createEmail(prisma, user.id, { folder: 'inbox', read: false, starred: true });
        await createEmail(prisma, user.id, { folder: 'inbox', read: false, from: `Yo <${user.email.toUpperCase()}>` });
        await createEmail(prisma, user.id, { folder: 'inbox', read: true, attachments: { create: [{ filename: 'a', mimeType: 'text/plain', size: 1, key: 'k/a' }, { filename: 'b', mimeType: 'text/plain', size: 1, key: 'k/b' }] } });
        await createEmail(prisma, user.id, { folder: 'archive', read: false, starred: true });
        await createEmail(prisma, other.id, { folder: 'inbox', read: false });
    });

    it('exactos, sin "+", solo de la carpeta pedida y del usuario (un adjunto doble cuenta una vez)', async () => {
        sessionUser = user;
        const { GET } = await import('../../app/api/counts/route');
        const res = await GET(new NextRequest('http://localhost/api/counts?folder=inbox'));
        const body = await res.json();
        expect(body.filters).toEqual({ all: 3, unread: 2, starred: 1, attachments: 1, from_me: 1 });
        const arch = await (await GET(new NextRequest('http://localhost/api/counts?folder=archive'))).json();
        expect(arch.filters).toEqual({ all: 1, unread: 1, starred: 1, attachments: 0, from_me: 0 });
        // sin ?folder no hay filtros (compatibilidad); carpeta con caracteres raros se ignora
        expect((await (await GET(new NextRequest('http://localhost/api/counts'))).json()).filters).toBeUndefined();
        expect((await (await GET(new NextRequest(`http://localhost/api/counts?folder=${encodeURIComponent("inbox' OR 1=1 --")}`))).json()).filters).toBeUndefined();
        expect((await (await GET(new NextRequest('http://localhost/api/counts?folder=drafts'))).json()).filters).toBeUndefined();
    });

    it('la libreria da los mismos conteos; direcciones propias con % _ no son comodines (comparacion exacta)', async () => {
        const tricky = await createUser(prisma, `ana_%x${uid('a')}@pg.test`);
        await createEmail(prisma, tricky.id, { folder: 'inbox', from: `Otra <anaZZZxq@pg.test>`, subject: 'Uno' });
        await createEmail(prisma, tricky.id, { folder: 'inbox', from: `Yo <${tricky.email}>`, subject: 'Dos' });
        const c = await getFolderFilterCounts([tricky.id], 'inbox', ownAddressesOf(tricky));
        expect(c.from_me).toBe(1);
        expect(c.all).toBe(2);
    });

    it('usa los indices existentes (con seqscan desactivado el plan recorre un indice Email_userId_*)', async () => {
        const opt = await getSqlOptions();
        const q = buildScopeCountsSql(emptyScope([user.id], 'inbox'), [user.email], opt);
        const plan = await prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
            const rows = await tx.$queryRawUnsafe(`EXPLAIN ${q.sql}`, ...q.values) as Array<Record<string, string>>;
            return rows.map((r) => Object.values(r)[0]).join(String.fromCharCode(10));
        });
        expect(plan).toMatch(/Index (Only )?Scan using "?Email_/); // recorrido por un indice de Email (nunca Seq Scan de toda la tabla)
        expect(plan).not.toContain('Seq Scan on "Email"');
    });
});

describe('acciones por alcance (carpeta + filtro) en el servidor', () => {
    let user: { id: string; email: string; name: string };
    beforeEach(async () => {
        const u = await createUser(prisma);
        user = { id: u.id, email: u.email, name: 'Alcance' };
        sessionUser = user;
        for (let i = 0; i < 12; i++) await createEmail(prisma, user.id, { folder: 'inbox', read: i % 2 === 0, starred: i < 3, createdAt: new Date(Date.UTC(2032, 0, 1, 0, 0, i)) });
        for (let i = 0; i < 4; i++) await createEmail(prisma, user.id, { folder: 'trash' });
        for (let i = 0; i < 3; i++) await createEmail(prisma, other.id, { folder: 'inbox' });
    });

    it('marcar como leido solo los NO leidos del alcance; devuelve count e ids; no toca a otros usuarios', async () => {
        const r = await batch('PATCH', { scope: { folder: 'inbox', filter: 'unread' }, updates: { read: true } });
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ count: 6, capped: false });
        expect(r.body.ids).toHaveLength(6);
        expect(await prisma.email.count({ where: { userId: user.id, folder: 'inbox', read: false } })).toBe(0);
        expect(await prisma.email.count({ where: { userId: other.id, read: false } })).toBeGreaterThanOrEqual(3);
    });

    it('mover el alcance registra previousFolder y se puede restaurar por alcance', async () => {
        const moved = await batch('PATCH', { scope: { folder: 'inbox', filter: 'starred' }, updates: { folder: 'trash' } });
        expect(moved.body.count).toBe(3);
        expect(await prisma.email.count({ where: { userId: user.id, folder: 'trash' } })).toBe(7);
        const previous = await getPreviousFolders(moved.body.ids, [user.id]);
        expect(Object.values(previous)).toEqual(['inbox', 'inbox', 'inbox']);
        const restored = await batch('PATCH', { scope: { folder: 'trash', filter: 'starred' }, updates: { restore: true } });
        expect(restored.body.count).toBe(3);
        expect(await prisma.email.count({ where: { userId: user.id, folder: 'inbox' } })).toBe(12);
    });

    it('selectScopeIds devuelve TODO el alcance (sin tope) del mas reciente al mas antiguo', async () => {
        const all = await selectScopeIds(emptyScope([user.id], 'inbox'), 'all', [user.email]);
        expect(all).toHaveLength(12);
        const unread = await selectScopeIds(emptyScope([user.id], 'inbox'), 'unread', [user.email]);
        expect(unread).toHaveLength(6);
    });

    it('validacion: scope invalido, borradores, ids+scope a la vez y carpeta desconocida -> 400', async () => {
        for (const scope of [{ folder: 'drafts', filter: 'all' }, { folder: 'nope', filter: 'all' }, { folder: 'inbox', filter: 'x' }, 'inbox', null, []]) {
            expect((await batch('PATCH', { scope, updates: { read: true } })).status).toBe(400);
        }
        expect((await batch('PATCH', { ids: ['a'], scope: { folder: 'inbox', filter: 'all' }, updates: { read: true } })).status).toBe(400);
    });

    it('eliminar definitivamente por alcance solo en papelera y spam', async () => {
        expect((await batch('DELETE', { scope: { folder: 'inbox', filter: 'all' } })).status).toBe(400);
        const r = await batch('DELETE', { scope: { folder: 'trash', filter: 'all' } });
        expect(r.status).toBe(200);
        expect(r.body.count).toBe(4);
        expect(await prisma.email.count({ where: { userId: user.id, folder: 'trash' } })).toBe(0);
        expect(await prisma.email.count({ where: { userId: user.id, folder: 'inbox' } })).toBe(12);
    });

    it('sin sesion: 401', async () => {
        sessionUser = null;
        expect((await batch('PATCH', { scope: { folder: 'inbox', filter: 'all' }, updates: { read: true } })).status).toBe(401);
        expect((await batch('DELETE', { scope: { folder: 'trash', filter: 'all' } })).status).toBe(401);
    });
});
