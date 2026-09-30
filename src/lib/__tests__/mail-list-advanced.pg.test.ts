import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { assertLocalPg, createEmail, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';
import { getBadges, getScopeCounts, getSqlOptions, resetSqlOptionsCache, selectPageRows, selectScopeIds, type PageRow } from '../mail-store';
import { decodeCursor, encodeCursor, type MailCursor } from '../mail-query';
import { parseSearchQuery } from '../rules/search';
import { emptyScope } from '../mail-list-sql';
import { groupEmailsByThread, senderSortKey } from '../mail-list';
import { groupMatchesFilter, ownAddressSet } from '../mail-list-view';
import { CREATED_MS_TRIGGER_DDL, CREATED_MS_TRIGGER, SENDER_KEY_INDEX } from '../db/mail-sql';

// Orden por remitente normalizado e indexado, conteos por HILO alineados con la interfaz, varios buzones (IDOR) y cursor
// (createdAt, id) exacto con empates: `npm run test:pg`.

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

beforeAll(() => {
    assertLocalPg();
    if (!process.env.DEBUG_PG) for (const m of ['log', 'error', 'warn'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});
afterAll(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM "User" WHERE "createdAt" >= $1', STARTED_AT);
    await prisma.$disconnect();
});

const get = async (path: string) => {
    const { GET } = await import('../../app/api/emails/route');
    const res = await GET(new NextRequest(`http://localhost${path}`));
    return { status: res.status, body: await res.json() };
};
const counts = async (path: string) => {
    const { GET } = await import('../../app/api/counts/route');
    const res = await GET(new NextRequest(`http://localhost${path}`));
    return { status: res.status, body: await res.json() };
};
const batch = async (method: 'PATCH' | 'DELETE', body: unknown) => {
    const route = await import('../../app/api/emails/batch/route');
    const res = await route[method](new NextRequest('http://localhost/api/emails/batch', { method, body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
};
async function pageAll(path: string) {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 400; guard++) {
        const { status, body }: { status: number; body: any } = await get(`${path}${cursor ? `&cursor=${cursor}` : ''}`);
        expect(status).toBe(200);
        seen.push(...body.emails.map((e: any) => e.id));
        if (!body.hasMore) break;
        cursor = body.nextCursor;
    }
    return seen;
}

// ---------------------------------------------------------------------------
// 1. Orden por remitente
// ---------------------------------------------------------------------------

/** Implementacion independiente (JS) de la clave de orden: nombre visible o direccion, minusculas, sin acentos. */
function expectedSenderKey(from: string): string {
    const bare = from.replace(/<[^>]*>/g, '').replace(/^[\s"'<>]+|[\s"'<>]+$/g, '');
    const addr = (from.match(/<([^>]*)>/)?.[1] ?? '').trim();
    const folded = (bare || addr || from.trim()).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return folded.replace(/ł/g, 'l').replace(/ø/g, 'o').replace(/đ/g, 'd').replace(/ħ/g, 'h').replace(/ı/g, 'i');
}

describe('orden por remitente: nombre visible o direccion, sin acentos ni mayusculas, indexado y con keyset estable', () => {
    const FROMS = [
        '"Álvaro Núñez" <alvaro@x.test>', 'alvaro.b@x.test', '"ángel" <angel@x.test>', 'Ana <ana@x.test>', '"ANA María" <ana2@x.test>',
        '"Pérez, Ana" <perez@x.test>', "'Óscar' <oscar@x.test>", 'Zoe <zoe@x.test>', '<zulu@x.test>', 'ÉMILE <emile@x.test>',
        'emile.b@x.test', '"Ñandú" <nandu@x.test>', 'Bob <BOB@X.test>', '"  Carlos  " <carlos@x.test>', 'Çelik <celik@x.test>',
        'Ünal <unal@x.test>', 'beta <beta@x.test>', 'Alfa <alfa@x.test>', '"Omega" <omega@x.test>', 'delta@x.test',
        'Ånge <ange@x.test>', 'Łukasz <lukasz@x.test>', 'Šárka <sarka@x.test>', '  spaced@x.test  ',
    ];
    let user: { id: string; email: string; name: string };
    const ids = new Map<string, string>(); // id -> from

    beforeAll(async () => {
        const u = await createUser(prisma);
        user = { id: u.id, email: u.email, name: 'Orden' };
        // 24 remitentes x 2 mensajes (48 filas = 3 paginas) con fechas distintas
        for (let round = 0; round < 2; round++) {
            for (let i = 0; i < FROMS.length; i++) {
                const e = await createEmail(prisma, user.id, { from: FROMS[i], subject: `Asunto ${round}-${i}`, createdAt: new Date(Date.UTC(2033, 0, 1, 0, round, i)) });
                ids.set(e.id, FROMS[i]);
            }
        }
    });
    beforeEach(() => { sessionUser = user; });

    it('la funcion SQL coincide con la implementacion independiente para nombres con acentos, comillas y mayusculas', async () => {
        for (const from of FROMS) {
            const rows = (await prisma.$queryRawUnsafe('SELECT bloomx_sender_key($1) AS k', from)) as Array<{ k: string }>;
            expect(rows[0].k, from).toBe(expectedSenderKey(from));
            expect(senderSortKey(from), from).toBe(rows[0].k); // el gemelo del cliente (mezcla entre sesiones) ordena igual que el servidor
        }
        expect(expectedSenderKey('"Pérez, Ana" <perez@x.test>')).toBe('perez, ana');
        expect(expectedSenderKey('<Zulu@x.test>')).toBe('zulu@x.test');
    });

    it('recorre las paginas en el orden (clave, fecha desc, id desc) sin saltar ni repetir', async () => {
        const seen = await pageAll('/api/emails?folder=inbox&sort=sender');
        expect(seen).toHaveLength(48);
        expect(new Set(seen).size).toBe(48);
        const createdAt = new Map((await prisma.email.findMany({ where: { userId: user.id }, select: { id: true, createdAt: true } })).map((e) => [e.id, e.createdAt.getTime()]));
        const expected = [...ids.keys()].sort((a, b) => {
            const ka = expectedSenderKey(ids.get(a)!);
            const kb = expectedSenderKey(ids.get(b)!);
            if (ka !== kb) return ka < kb ? -1 : 1;
            const dt = createdAt.get(b)! - createdAt.get(a)!;
            return dt !== 0 ? dt : (a < b ? 1 : -1);
        });
        expect(seen).toEqual(expected);
        // Spot-check legible: sin acentos "Álvaro" (alvaro) va antes que "Ana"; "Ñandú" (nandu) entre "Łukasz" y "Óscar"
        const names = seen.map((id) => expectedSenderKey(ids.get(id)!));
        expect(names.indexOf('alvaro nunez')).toBeLessThan(names.indexOf('ana'));
        expect(names.indexOf('nandu')).toBeGreaterThan(names.indexOf('lukasz'));
    });

    it('el plan usa el indice de expresion con seqscan desactivado y no ordena en memoria', async () => {
        const plan = await prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
            await tx.$executeRawUnsafe('SET LOCAL enable_bitmapscan = off');
            const rows = (await tx.$queryRawUnsafe(
                `EXPLAIN SELECT e."id" FROM "Email" e WHERE e."userId" = $1 AND e."folder" = 'inbox'
                 ORDER BY (bloomx_sender_key(e."from") COLLATE "C") ASC, e."createdAt" DESC, e."id" DESC LIMIT 21`, user.id,
            )) as Array<Record<string, string>>;
            return rows.map((r) => Object.values(r)[0]).join(String.fromCharCode(10));
        });
        expect(plan).toContain(SENDER_KEY_INDEX);
        expect(plan).not.toContain('Sort');
    });

    it('DDL: el indice existe y es de expresion sobre (userId, folder, clave, createdAt DESC, id DESC)', async () => {
        const rows = (await prisma.$queryRawUnsafe(`SELECT indexdef FROM pg_indexes WHERE indexname = $1`, SENDER_KEY_INDEX)) as Array<{ indexdef: string }>;
        expect(rows).toHaveLength(1);
        expect(rows[0].indexdef).toContain('bloomx_sender_key');
        expect(rows[0].indexdef).toContain('COLLATE "C"');
        expect(rows[0].indexdef).toContain('"createdAt" DESC');
    });

    it('sin la funcion en la BD (despliegue sin db:ensure) sigue ordenando con la misma expresion en linea', async () => {
        const client = prisma as any;
        await client.$executeRawUnsafe(`DROP INDEX IF EXISTS "${SENDER_KEY_INDEX}"`);
        await client.$executeRawUnsafe('ALTER FUNCTION bloomx_sender_key(text) RENAME TO bloomx_sender_key_off');
        resetSqlOptionsCache();
        try {
            const seen = await pageAll('/api/emails?folder=inbox&sort=sender');
            expect(seen).toHaveLength(48);
            expect(new Set(seen).size).toBe(48);
        } finally {
            await client.$executeRawUnsafe('ALTER FUNCTION bloomx_sender_key_off(text) RENAME TO bloomx_sender_key');
            const { SENDER_KEY_INDEX_DDL } = await import('../db/mail-sql');
            await client.$executeRawUnsafe(SENDER_KEY_INDEX_DDL);
            resetSqlOptionsCache();
        }
    });
});

// ---------------------------------------------------------------------------
// 2. Conteos por hilo == filas de la interfaz
// ---------------------------------------------------------------------------

function rng(seed: number) {
    let s = seed >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

describe('conteos por HILO: coinciden con lo que la interfaz dibuja (groupEmailsByThread)', () => {
    let user: { id: string; email: string; name: string };
    const SUBJECTS = ['Hola', 'Re: Hola', 'RE: re: Hola', 'Fwd: Hola', 'Hola ', 'hola', 'Invitación: Reunión', 'Invitación actualizada: Reunión', 'Accepted: Reunión',
        'ab', 'Re: ab', '', '(No Subject)', 'Re: (No Subject)', 'Ñandú', 'Cancelado: Ñandú', 'Factura 2033', 'Re: Factura 2033', 'Updated: Factura 2033'];
    const TOS = ['a@x.test', 'A@X.test', 'Ana <a@x.test>', '"B, Bee" <b@x.test>, c@x.test', 'c@x.test, "B, Bee" <b@x.test>', 'sin-arroba', ''];
    const CLEAN = [null, '', 'a@x.test', 'b@x.test'];
    let rows: Array<{ id: string; from: string; to: string; cleanTo: string | null; subject: string; createdAt: string; read: boolean; starred: boolean; folder: string; hasAtt: boolean; labelled: boolean }> = [];
    let labelId = '';

    beforeAll(async () => {
        const u = await createUser(prisma);
        user = { id: u.id, email: u.email, name: 'Hilos' };
        const label = await prisma.label.create({ data: { userId: user.id, name: 'Facturas', color: '#123456' } });
        labelId = label.id;
        const rand = rng(42);
        const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];
        for (let i = 0; i < 220; i++) {
            const folder = i % 11 === 0 ? 'archive' : i % 13 === 0 ? 'trash' : 'inbox';
            const subject = pick(SUBJECTS);
            const from = rand() < 0.2 ? `Yo <${user.email}>` : pick(['Ana <ana@x.test>', 'bob@x.test', '"Z, Zed" <zed@x.test>']);
            const hasAtt = rand() < 0.25;
            const labelled = rand() < 0.3;
            const e = await prisma.email.create({
                data: {
                    userId: user.id, messageId: uid('m'), from, to: pick(TOS), cleanTo: pick(CLEAN), subject, folder,
                    read: rand() < 0.55, starred: rand() < 0.2, createdAt: new Date(Date.UTC(2034, 0, 1, 0, 0, i)),
                    ...(hasAtt ? { attachments: { create: [{ filename: `f${i}.pdf`, mimeType: 'application/pdf', size: 5, key: `k/${i}` }] } } : {}),
                    ...(labelled ? { labels: { connect: [{ id: labelId }] } } : {}),
                },
            });
            rows.push({ id: e.id, from, to: e.to, cleanTo: e.cleanTo, subject, createdAt: e.createdAt.toISOString(), read: e.read, starred: e.starred, folder, hasAtt, labelled });
        }
    });
    beforeEach(() => { sessionUser = user; });

    const uiCounts = (list: typeof rows) => {
        const own = ownAddressSet([user.email]);
        const mapped = list.map((r) => ({ ...r, attachments: r.hasAtt ? [{ filename: 'x' }] : [] }));
        const groups = groupEmailsByThread(mapped as any);
        const n = (f: 'all' | 'unread' | 'starred' | 'attachments' | 'fromMe') => groups.filter((g) => groupMatchesFilter(g as any, f, own)).length;
        return { all: n('all'), unread: n('unread'), starred: n('starred'), attachments: n('attachments'), from_me: n('fromMe') };
    };

    it('carpeta: los chips del servidor (hilos) == los grupos de la interfaz para cada filtro', async () => {
        const server = await getScopeCounts(emptyScope([user.id], 'inbox'), [user.email]);
        const ui = uiCounts(rows.filter((r) => r.folder === 'inbox'));
        expect(server.threads).toEqual(ui);
        // y los mensajes son estrictamente mas (hay hilos de varios mensajes)
        expect(server.messages.all).toBe(rows.filter((r) => r.folder === 'inbox').length);
        expect(server.messages.all).toBeGreaterThan(server.threads.all);
        expect(server.messages.unread).toBeGreaterThanOrEqual(server.threads.unread);
    });

    it('etiqueta: hilos con algun mensaje etiquetado (sin papelera) == interfaz; /api/emails devuelve total y filters con el mismo criterio', async () => {
        const inLabel = rows.filter((r) => r.labelled && r.folder !== 'trash');
        const ui = uiCounts(inLabel);
        const { status, body } = await get('/api/emails?label=Facturas');
        expect(status).toBe(200);
        expect(body.filters).toEqual(ui);
        expect(body.total).toBe(inLabel.length);
        expect(body.totalThreads).toBe(ui.all);
        const unread = await get('/api/emails?label=Facturas&filter=unread');
        expect(unread.body.totalThreads).toBe(ui.unread);
        expect(unread.body.total).toBe(inLabel.filter((r) => !r.read).length);
    });

    it('busqueda: total y filters con el mismo criterio (sin papelera ni spam), operadores y texto', async () => {
        const matches = rows.filter((r) => r.folder !== 'trash' && /factura/i.test(r.subject));
        const { body } = await get('/api/emails?q=factura');
        expect(body.total).toBe(matches.length);
        expect(body.filters).toEqual(uiCounts(matches));
        const starred = await get('/api/emails?q=' + encodeURIComponent('factura is:starred'));
        const starredRows = matches.filter((r) => r.starred);
        expect(starred.body.total).toBe(starredRows.length);
        expect(starred.body.filters.all).toBe(uiCounts(starredRows).all);
        // paginado completo: ningun mensaje se pierde por el limite del full-text (antes 1000)
        const seen = await pageAll('/api/emails?q=factura&sort=oldest');
        expect(seen).toHaveLength(matches.length);
    });

    it('/api/emails filter=unread: total = mensajes sin leer, totalThreads = hilos con alguno sin leer; la pagina lista esos mensajes', async () => {
        const inbox = rows.filter((r) => r.folder === 'inbox');
        const { body } = await get('/api/emails?folder=inbox&filter=unread');
        expect(body.total).toBe(inbox.filter((r) => !r.read).length);
        expect(body.totalThreads).toBe(uiCounts(inbox).unread);
        const seen = await pageAll('/api/emails?folder=inbox&filter=unread');
        expect(seen).toHaveLength(body.total);
        const grouped = groupEmailsByThread((await prisma.email.findMany({ where: { id: { in: seen } } })).map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })) as any);
        expect(grouped.length).toBe(body.totalThreads); // las filas que dibuja la interfaz == el conteo del chip
    });

    it('/api/counts: no leidos por carpeta y por etiqueta en HILOS (con los mensajes aparte) y totales por hilo', async () => {
        const { body } = await counts('/api/counts?folder=inbox');
        const inbox = rows.filter((r) => r.folder === 'inbox');
        expect(body.filters).toEqual(uiCounts(inbox));
        expect(body.counts.inbox).toBe(uiCounts(inbox).unread);
        expect(body.messageCounts.inbox).toBe(inbox.filter((r) => !r.read).length);
        expect(body.totals.inbox).toBe(uiCounts(inbox).all);
        expect(body.messageTotals.inbox).toBe(inbox.length);
        const archive = rows.filter((r) => r.folder === 'archive');
        expect(body.counts.archive).toBe(uiCounts(archive).unread);
        const lab = body.labels.find((l: any) => l.id === labelId);
        const inLabel = rows.filter((r) => r.labelled && r.folder !== 'trash' && r.folder !== 'spam');
        expect(lab.count).toBe(uiCounts(inLabel).unread);
        expect(lab.total).toBe(uiCounts(inLabel).all);
        expect(lab.messageTotal).toBe(inLabel.length);
        // consistencia de las insignias sin totales (solo recorre las no leidas)
        const cheap = await getBadges([user.id], false);
        expect(cheap.folders.inbox.unreadThreads).toBe(body.counts.inbox);
    });

    it('scope de "toda la carpeta" actua sobre exactamente los mensajes que el filtro lista', async () => {
        const ids = await selectScopeIds(emptyScope([user.id], 'inbox'), 'unread', [user.email]);
        const listed = await pageAll('/api/emails?folder=inbox&filter=unread');
        expect(new Set(ids)).toEqual(new Set(listed));
    });
});

// ---------------------------------------------------------------------------
// 3. Varias cuentas conectadas (ambito multi-buzon) e IDOR
// ---------------------------------------------------------------------------

describe('ambito multi-buzon: mailboxes=<ids|all> validado con getAccessibleMailboxUserIds', () => {
    let a: { id: string; email: string; name: string };
    let b: { id: string; email: string };
    let c: { id: string; email: string };

    beforeAll(async () => {
        const ua = await createUser(prisma);
        const ub = await createUser(prisma);
        const uc = await createUser(prisma);
        a = { id: ua.id, email: ua.email, name: 'A' };
        b = { id: ub.id, email: ub.email };
        c = { id: uc.id, email: uc.email };
        // A tiene conectada la cuenta de B (misma logica que el selector de cuentas); C es ajeno.
        await prisma.account.create({ data: { userId: a.id, type: 'oauth', provider: `bloomx-${uid('p')}`, providerAccountId: b.email } });
    });
    let seeded = 0;
    beforeEach(async () => {
        sessionUser = a;
        if (seeded++ > 0) return;
    });

    async function seed(prefix: string) {
        const out: Record<string, string[]> = { a: [], b: [], c: [] };
        const t0 = Date.UTC(2035, 0, 1, 0, 0, 0);
        for (let i = 0; i < 12; i++) {
            for (const [key, owner] of [['a', a], ['b', b], ['c', c]] as const) {
                const e = await createEmail(prisma, owner.id, {
                    folder: 'inbox', subject: `${prefix}-${key}-${i}`, read: i % 2 === 0, from: `${key.toUpperCase()}${i} <${key}${i}@x.test>`,
                    createdAt: new Date(t0 + (i * 3 + (key === 'b' ? 1 : key === 'c' ? 2 : 0)) * 1000),
                });
                out[key].push(e.id);
            }
        }
        return out;
    }

    it('lista la UNION de A y B con orden, cursor y conteos correctos; nunca incluye a C', async () => {
        const made = await seed('u1');
        const path = `/api/emails?folder=inbox&mailboxes=${a.id},${b.id}&q=u1-`;
        const seenNewest = await pageAll(`${path}&sort=newest`);
        const expected = (await prisma.email.findMany({ where: { id: { in: [...made.a, ...made.b] } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true } })).map((e) => e.id);
        // con q la busqueda es global; se compara solo lo de este lote
        expect(seenNewest).toEqual(expected);
        const seenOldest = await pageAll(`${path}&sort=oldest`);
        expect(seenOldest).toEqual([...expected].reverse());
        expect(seenNewest.some((id) => made.c.includes(id))).toBe(false);
        const first = await get(`${path}&sort=sender`);
        expect(first.body.mailboxes.sort()).toEqual([a.id, b.id].sort());
        expect(first.body.total).toBe(24);
        expect(first.body.filters.all).toBe(24);
        expect(first.body.filters.unread).toBe(12);
    });

    it('all = todos los accesibles (A y B), sin C; sin el parametro solo A', async () => {
        await seed('u2');
        const all = await get('/api/emails?folder=inbox&mailboxes=all&q=u2-&sort=oldest');
        expect(all.body.total).toBe(24);
        const own = await get('/api/emails?folder=inbox&q=u2-&sort=oldest');
        expect(own.body.total).toBe(12);
        const onlyB = await get(`/api/emails?folder=inbox&mailboxes=${b.id}&q=u2-`);
        expect(onlyB.body.total).toBe(12);
        expect(onlyB.body.emails.every((e: any) => e.userId === b.id)).toBe(true);
    });

    it('conteos de carpeta: la union de buzones, en hilos y mensajes', async () => {
        const inboxA = await prisma.email.count({ where: { userId: a.id, folder: 'inbox' } });
        const inboxB = await prisma.email.count({ where: { userId: b.id, folder: 'inbox' } });
        const { status, body } = await counts(`/api/counts?folder=inbox&mailboxes=${a.id},${b.id}`);
        expect(status).toBe(200);
        expect(body.messageFilters.all).toBe(inboxA + inboxB);
        const solo = await counts('/api/counts?folder=inbox');
        expect(solo.body.messageFilters.all).toBe(inboxA);
    });

    it('IDOR: un buzon ajeno (o vinculado al reves) da 403 en lista, conteos y acciones por scope, sin tocar nada', async () => {
        const made = await seed('u3');
        for (const ids of [c.id, `${a.id},${c.id}`, `${b.id},${c.id}`]) {
            expect((await get(`/api/emails?folder=inbox&mailboxes=${ids}`)).status).toBe(403);
            expect((await counts(`/api/counts?folder=inbox&mailboxes=${ids}`)).status).toBe(403);
            const mark = await batch('PATCH', { scope: { folder: 'inbox', filter: 'unread', mailboxes: ids.split(',') }, updates: { read: true } });
            expect(mark.status).toBe(403);
            const del = await batch('DELETE', { scope: { folder: 'trash', filter: 'all', mailboxes: ids.split(',') } });
            expect(del.status).toBe(403);
        }
        expect(await prisma.email.count({ where: { id: { in: made.c }, read: false } })).toBe(6);
        // B no puede ver a A (la vinculacion es unidireccional)
        sessionUser = { id: b.id, email: b.email, name: 'B' };
        expect((await get(`/api/emails?folder=inbox&mailboxes=${a.id}`)).status).toBe(403);
        expect((await get(`/api/emails?folder=inbox&mailboxes=${a.id},${b.id}`)).status).toBe(403);
        expect((await get(`/api/emails?folder=inbox&mailboxes=${b.id}`)).status).toBe(200);
    });

    it('parametro invalido: 400 (vacio, con caracteres raros o demasiados ids)', async () => {
        for (const v of ['', ';drop', `${'x'.repeat(300)}`, Array.from({ length: 60 }, (_, i) => `i${i}`).join(',')]) {
            expect((await get(`/api/emails?folder=inbox&mailboxes=${encodeURIComponent(v)}`)).status).toBe(400);
            expect((await counts(`/api/counts?mailboxes=${encodeURIComponent(v)}`)).status).toBe(400);
        }
    });

    it('accion por scope sobre A y B: "toda la carpeta" marca leidos los de ambos (y solo los de ambos), en una sentencia', async () => {
        await seed('u4');
        const cUnreadBefore = await prisma.email.count({ where: { userId: c.id, read: false } });
        const r = await batch('PATCH', { scope: { folder: 'inbox', filter: 'unread', mailboxes: [a.id, b.id] }, updates: { read: true } });
        expect(r.status).toBe(200);
        expect(r.body.capped).toBe(false);
        expect(await prisma.email.count({ where: { userId: { in: [a.id, b.id] }, folder: 'inbox', read: false } })).toBe(0);
        expect(await prisma.email.count({ where: { userId: c.id, read: false } })).toBe(cUnreadBefore);
        // mover a papelera con previousFolder, y borrar definitivamente todo el scope de la papelera de ambos
        const moved = await batch('PATCH', { scope: { folder: 'inbox', filter: 'all', mailboxes: 'all' }, updates: { folder: 'trash' } });
        expect(moved.body.count).toBeGreaterThan(0);
        const prev = (await prisma.$queryRawUnsafe(`SELECT DISTINCT "previousFolder" FROM "Email" WHERE "id" = ANY($1::text[])`, moved.body.ids)) as any[];
        expect(prev).toEqual([{ previousFolder: 'inbox' }]);
        const deleted = await batch('DELETE', { scope: { folder: 'trash', filter: 'all', mailboxes: [a.id, b.id] } });
        expect(deleted.body.count).toBe(moved.body.count);
        expect(await prisma.email.count({ where: { userId: c.id, folder: 'inbox' } })).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// 4. Precision de createdAt y cursor (createdAt, id) con empates
// ---------------------------------------------------------------------------

describe('createdAt: tipo real, milisegundos garantizados y cursor por tupla con empates', () => {
    let user: { id: string; email: string; name: string };
    beforeAll(async () => {
        const u = await createUser(prisma);
        user = { id: u.id, email: u.email, name: 'Empates' };
    });
    beforeEach(() => { sessionUser = user; });

    const rawInsert = (n: number, tsExpr: string, prefix: string) => prisma.$executeRawUnsafe(
        `INSERT INTO "Email" ("id", "userId", "messageId", "from", "to", "subject", "folder", "createdAt")
         SELECT $2 || '_' || lpad(g::text, 5, '0'), $1, $2 || '_m' || g, 'Ana <ana@x.test>', 'yo@x.test', $2 || ' ' || g, 'inbox', ${tsExpr}
         FROM generate_series(1, ${n}) AS g`, user.id, prefix,
    );

    it('el tipo de columna se detecta (timestamptz en el DDL de ensure-schema) y la consulta se adapta', async () => {
        resetSqlOptionsCache();
        const opt = await getSqlOptions();
        const kind = ((await prisma.$queryRawUnsafe(`SELECT data_type FROM information_schema.columns WHERE table_name = 'Email' AND column_name = 'createdAt'`)) as any[])[0].data_type;
        expect(kind).toBe('timestamp with time zone');
        expect(opt.createdAtKind).toBe('timestamptz');
        expect(opt.senderKeyFn).toBe(true);
    });

    it('disparador: una insercion cruda con microsegundos queda en milisegundos; el DDL lo crea una sola vez y rellena las filas antiguas', async () => {
        await rawInsert(1, `timestamptz '2036-01-01 10:00:00.123456+00'`, 'trg');
        const row = (await prisma.$queryRawUnsafe(`SELECT to_char("createdAt" AT TIME ZONE 'UTC', 'HH24:MI:SS.US') AS t FROM "Email" WHERE "id" = 'trg_00001'`)) as any[];
        expect(row[0].t).toBe('10:00:00.123000');
        // filas antiguas con microsegundos: sin disparador se conservan; al (re)crear el disparador se igualan a ms
        await prisma.$executeRawUnsafe(`ALTER TABLE "Email" DISABLE TRIGGER "${CREATED_MS_TRIGGER}"`);
        await prisma.$executeRawUnsafe(`INSERT INTO "Email" ("id","userId","messageId","from","to","createdAt") VALUES ('old_1', $1, 'old_1', 'a@x.test', 'b@x.test', timestamptz '2036-01-02 10:00:00.654321+00')`, user.id);
        const before = (await prisma.$queryRawUnsafe(`SELECT to_char("createdAt" AT TIME ZONE 'UTC', 'US') AS t FROM "Email" WHERE "id" = 'old_1'`)) as any[];
        expect(before[0].t).toBe('654321');
        await prisma.$executeRawUnsafe(`DROP TRIGGER "${CREATED_MS_TRIGGER}" ON "Email"`);
        await prisma.$executeRawUnsafe(CREATED_MS_TRIGGER_DDL);
        const after = (await prisma.$queryRawUnsafe(`SELECT to_char("createdAt" AT TIME ZONE 'UTC', 'US') AS t FROM "Email" WHERE "id" = 'old_1'`)) as any[];
        expect(after[0].t).toBe('654000');
        // idempotente: ejecutarlo otra vez no falla ni rehace nada
        await prisma.$executeRawUnsafe(CREATED_MS_TRIGGER_DDL);
        const trg = (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = $1`, CREATED_MS_TRIGGER)) as any[];
        expect(trg[0].n).toBe(1);
    });

    it('1000 filas con el MISMO milisegundo (y microsegundos distintos): ni se salta ni se repite ninguna, en los tres ordenes', async () => {
        await rawInsert(1000, `timestamptz '2037-05-05 10:00:00.123456+00' + (g % 7) * interval '13 microseconds'`, 'tie');
        const distinct = (await prisma.$queryRawUnsafe(`SELECT count(DISTINCT "createdAt")::int AS n FROM "Email" WHERE "userId" = $1 AND "id" LIKE 'tie_%'`, user.id)) as any[];
        expect(distinct[0].n).toBe(1); // todas empatan en la misma marca de tiempo
        const expectedNewest = ((await prisma.$queryRawUnsafe(`SELECT "id" FROM "Email" WHERE "userId" = $1 AND "id" LIKE 'tie_%' ORDER BY "createdAt" DESC, "id" DESC`, user.id)) as any[]).map((r) => r.id);
        const newest = await pageAll('/api/emails?folder=inbox&q=tie&sort=newest');
        expect(newest).toHaveLength(1000);
        expect(new Set(newest).size).toBe(1000);
        expect(newest).toEqual(expectedNewest);
        const oldest = await pageAll('/api/emails?folder=inbox&q=tie&sort=oldest');
        expect(oldest).toEqual([...expectedNewest].reverse());
        const sender = await pageAll('/api/emails?folder=inbox&q=tie&sort=sender');
        expect(sender).toEqual(expectedNewest); // mismo remitente: desempate por fecha desc, id desc
    });

    it('aunque el disparador no exista (BD sin db:ensure), el cursor conserva los microsegundos: sin saltos ni repeticiones', async () => {
        await prisma.$executeRawUnsafe(`ALTER TABLE "Email" DISABLE TRIGGER "${CREATED_MS_TRIGGER}"`);
        try {
            await rawInsert(300, `timestamptz '2038-05-05 10:00:00.123000+00' + (g % 3) * interval '250 microseconds'`, 'mic');
            const distinct = (await prisma.$queryRawUnsafe(`SELECT count(DISTINCT "createdAt")::int AS n FROM "Email" WHERE "userId" = $1 AND "id" LIKE 'mic_%'`, user.id)) as any[];
            expect(distinct[0].n).toBe(3);
            const expected = ((await prisma.$queryRawUnsafe(`SELECT "id" FROM "Email" WHERE "userId" = $1 AND "id" LIKE 'mic_%' ORDER BY "createdAt" DESC, "id" DESC`, user.id)) as any[]).map((r) => r.id);
            const seen = await pageAll('/api/emails?folder=inbox&q=mic&sort=newest');
            expect(seen).toEqual(expected);
            const oldest = await pageAll('/api/emails?folder=inbox&q=mic&sort=oldest');
            const expectedOld = ((await prisma.$queryRawUnsafe(`SELECT "id" FROM "Email" WHERE "userId" = $1 AND "id" LIKE 'mic_%' ORDER BY "createdAt" ASC, "id" ASC`, user.id)) as any[]).map((r) => r.id);
            expect(oldest).toEqual(expectedOld);
        } finally {
            await prisma.$executeRawUnsafe(`ALTER TABLE "Email" ENABLE TRIGGER "${CREATED_MS_TRIGGER}"`);
        }
    });

    it('con la columna como timestamp(3) sin zona (esquema de Prisma db push) la misma consulta pagina igual', async () => {
        const expected = ((await prisma.$queryRawUnsafe(`SELECT "id" FROM "Email" WHERE "userId" = $1 AND "id" LIKE 'tie_%' ORDER BY "createdAt" DESC, "id" DESC`, user.id)) as any[]).map((r) => r.id);
        await prisma.$executeRawUnsafe(`DROP TRIGGER "${CREATED_MS_TRIGGER}" ON "Email"`);
        await prisma.$executeRawUnsafe(`ALTER TABLE "Email" ALTER COLUMN "createdAt" TYPE timestamp(3) USING ("createdAt" AT TIME ZONE 'UTC')`);
        resetSqlOptionsCache();
        try {
            expect((await getSqlOptions()).createdAtKind).toBe('timestamp');
            // Solo SQL crudo mientras la columna cambia de tipo (Prisma cachea los planes de sus consultas de modelo)
            const scope = { ...emptyScope([user.id], 'inbox'), search: parseSearchQuery('tie'), useFts: false };
            const seen: string[] = [];
            let cursor: MailCursor | null = null;
            for (let guard = 0; guard < 100; guard++) {
                const rows: PageRow[] = await selectPageRows({ scope, sort: 'newest', filter: 'all', own: [], cursor, take: 21, offset: 0 });
                const page = rows.slice(0, 20);
                seen.push(...page.map((r) => r.id));
                if (rows.length <= 20) break;
                const last = page[page.length - 1];
                cursor = decodeCursor(encodeCursor('newest', last), 'newest');
            }
            expect(seen).toEqual(expected);
            const since = await getScopeCounts({ ...scope, since: '2037-05-05T10:00:00.122Z' }, []);
            expect(since.messages.all).toBe(1000);
            const until = await getScopeCounts({ ...scope, until: '2037-05-05T10:00:00.122Z' }, []);
            expect(until.messages.all).toBe(0);
        } finally {
            await prisma.$executeRawUnsafe(`ALTER TABLE "Email" ALTER COLUMN "createdAt" TYPE timestamptz USING ("createdAt" AT TIME ZONE 'UTC')`);
            await prisma.$executeRawUnsafe(CREATED_MS_TRIGGER_DDL);
            resetSqlOptionsCache();
        }
        expect((await getSqlOptions()).createdAtKind).toBe('timestamptz');
    });
});

// ---------------------------------------------------------------------------
// 5. Coste de los conteos por hilo en un buzon grande (informativo)
// ---------------------------------------------------------------------------

describe('coste de los conteos por hilo', () => {
    it('20.000 mensajes de una carpeta: conteos por filtro e insignias del Sidebar en tiempo razonable', async () => {
        const u = await createUser(prisma);
        sessionUser = { id: u.id, email: u.email, name: 'Grande' };
        await prisma.$executeRawUnsafe(
            `INSERT INTO "Email" ("id","userId","messageId","from","to","subject","folder","read","createdAt")
             SELECT 'big_' || g, $1, 'big_m' || g, 'Ana <ana@x.test>', 'dest' || (g % 40) || '@x.test', CASE WHEN g % 3 = 0 THEN 'Re: Tema ' || (g % 900) ELSE 'Tema ' || (g % 900) END, 'inbox', g % 4 = 0,
                    timestamptz '2039-01-01 00:00:00+00' + g * interval '1 second' FROM generate_series(1, 20000) g`, u.id);
        const t0 = performance.now();
        const c = await getScopeCounts(emptyScope([u.id], 'inbox'), [u.email]);
        const t1 = performance.now();
        const badgesCheap = await getBadges([u.id], false);
        const t2 = performance.now();
        const badgesFull = await getBadges([u.id], true);
        const t3 = performance.now();
        process.stderr.write(`[perf] scope-counts=${Math.round(t1 - t0)}ms badges(unread)=${Math.round(t2 - t1)}ms badges(totals)=${Math.round(t3 - t2)}ms threads=${c.threads.all} messages=${c.messages.all}\n`);
        expect(c.messages.all).toBe(20000);
        expect(c.threads.all).toBeLessThan(20000);
        expect(badgesCheap.folders.inbox.unreadThreads).toBe(badgesFull.folders.inbox.unreadThreads);
        expect(t1 - t0).toBeLessThan(8000);
        expect(t3 - t2).toBeLessThan(8000);
    });
});
