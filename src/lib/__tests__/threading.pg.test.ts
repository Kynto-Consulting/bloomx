import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { assertLocalPg, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';
import { getScopeCounts, getSqlOptions, resetSqlOptionsCache } from '../mail-store';
import { buildScopeCountsSql, emptyScope, readScopeCounts } from '../mail-list-sql';
import { groupEmailsByThread } from '../mail-list';
import { groupMatchesFilter, ownAddressSet } from '../mail-list-view';
import { assignThread, defaultThreadDb, headersOfInbound, loadStoredThreadHeaders, loadThreadMemberIds } from '../thread-store';
import { backfillThreadHeaders, ensureThreadHeaders } from '../thread-backfill';
import { threadInfoFromRawMime } from '../thread-headers';
import { rawEmlKey } from '../raw-mime';
import { FIXTURE_KEYS_A, FIXTURE_KEYS_B, OWNER, buildFixtureMessages, shuffled, type FixtureMsg } from './helpers/thread-fixtures';
import { ingestMessage } from '../mail-transfer/ingest';
import { memoryStorage } from '../mail-transfer/source';
import { parseMessage } from '../mail-transfer/mime-parse';

// Hilos por cabeceras contra Postgres real: ingesta en cualquier orden, fusion, respaldo, relleno perezoso, importacion, webhook y envio
// (Resend simulado). `npm run test:pg`.

const STARTED_AT = new Date(Date.now() - 1000);
const stored = new Map<string, Buffer>();
const sends: any[] = [];
let sendImpl: (payload: any) => Promise<{ data: any; error: any }> = async () => ({ data: { id: `re_${Math.random().toString(36).slice(2, 10)}` }, error: null });
let sessionUser: { id: string; email: string; name: string } | null = null;

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => sessionUser }));
vi.mock('@/lib/resend', () => ({ resend: { emails: { send: vi.fn(async (p: any) => { sends.push(p); return sendImpl(p); }) } } }));
vi.mock('@/lib/storage', () => ({
    uploadToStorage: vi.fn(async (k: string, b: any) => { stored.set(k, Buffer.isBuffer(b) ? b : Buffer.from(String(b))); }),
    getBufferFromStorage: vi.fn(async (k: string) => stored.get(k) ?? null),
    getFromStorage: vi.fn(async (k: string) => stored.get(k)?.toString('utf8') ?? null),
    deleteManyFromStorage: vi.fn(async () => ({ deleted: 0, failed: [] })),
    listStorageObjects: vi.fn(async () => []),
    deleteStoragePrefix: vi.fn(async () => ({ deleted: 0, failed: [] })),
}));
vi.mock('@/lib/notifications/web-push', () => ({ sendNewMessagePushNotification: vi.fn(async () => undefined) }));
vi.mock('@/lib/expansions/server-hooks', () => ({
    runEmailPreSendHooksForRequest: async () => ({ stop: false, modify: {}, warnings: [] }),
    runEmailReceivedHooks: async () => undefined,
    buildEmailSentContext: () => ({}),
    buildEmailOpenedContext: () => ({}),
    shouldFireOnce: () => false,
    fireLifecycleHook: () => false,
}));

beforeAll(() => {
    assertLocalPg();
    vi.stubEnv('WEBHOOK_SECRET', '');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    if (!process.env.DEBUG_PG) for (const m of ['log', 'error', 'warn'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});
afterAll(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM "User" WHERE "createdAt" >= $1', STARTED_AT);
    vi.unstubAllEnvs(); vi.unstubAllGlobals();
    await prisma.$disconnect();
});
beforeEach(() => { sends.length = 0; });

const msgs = buildFixtureMessages();
const byKey = (k: string) => msgs.find((m) => m.key === k)!;

async function insertFixture(userId: string, m: FixtureMsg, opts: { assign: boolean }) {
    const row = await prisma.email.create({
        data: {
            userId, messageId: uid('m'), from: m.from, to: m.to, cc: m.cc ?? null, subject: m.subject, folder: m.direction === 'out' ? 'sent' : 'inbox',
            status: m.direction === 'out' ? 'sent' : 'received', createdAt: m.date, read: true, snippet: m.text.slice(0, 100),
            cleanTo: (m.to.match(/<([^>]+)>/g) ?? []).map((x) => x.slice(1, -1)).join(', '),
        },
    });
    if (opts.assign) {
        const info = threadInfoFromRawMime(Buffer.from(m.mime, 'utf8'));
        await assignThread({ userId, emailId: row.id, headers: headersOfInbound(info), date: m.date.getTime(), subject: m.subject, from: m.from, to: m.to, cc: m.cc, own: [OWNER], noFallback: info.autoSubmitted || info.bulk || Boolean(info.listId) });
    }
    return row;
}

const keysOf = async (userId: string) =>
    new Map(((await prisma.$queryRawUnsafe('SELECT "id", "threadKey" FROM "Email" WHERE "userId" = $1', userId)) as Array<{ id: string; threadKey: string | null }>).map((r) => [r.id, r.threadKey]));

async function threadsOf(userId: string, idToKey: Map<string, string>) {
    const keys = await keysOf(userId);
    const groups = new Map<string, string[]>();
    for (const [id, k] of keys) (groups.get(k ?? `null:${id}`) ?? groups.set(k ?? `null:${id}`, []).get(k ?? `null:${id}`)!).push(idToKey.get(id)!);
    return [...groups.values()].map((g) => g.sort());
}

describe('DDL aditivo', () => {
    it('las columnas y los indices de hilos existen tras ensureDatabaseSchema', async () => {
        const cols = (await prisma.$queryRawUnsafe(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Email' AND column_name IN ('rfcMessageId','inReplyTo','refs','threadKey')`)) as Array<{ column_name: string; data_type: string }>;
        expect(cols.map((c) => c.column_name).sort()).toEqual(['inReplyTo', 'refs', 'rfcMessageId', 'threadKey']);
        expect(cols.every((c) => c.data_type === 'text')).toBe(true);
        const idx = ((await prisma.$queryRawUnsafe(`SELECT indexname FROM pg_indexes WHERE tablename = 'Email'`)) as Array<{ indexname: string }>).map((r) => r.indexname);
        for (const n of ['Email_userId_threadKey_idx', 'Email_userId_rfcMessageId_idx', 'Email_userId_inReplyTo_idx']) expect(idx).toContain(n);
        resetSqlOptionsCache();
        expect((await getSqlOptions()).threadKey).toBe(true);
    });
});

describe('ingesta de la conversacion mixta (13 mensajes, 12 clientes): exactamente 2 hilos en cualquier orden de llegada', () => {
    it('20 ordenes distintas dan la misma particion, con la clave = Message-ID de la raiz', async () => {
        for (let seed = 1; seed <= 20; seed++) {
            const u = await createUser(prisma);
            const idToKey = new Map<string, string>();
            for (const m of shuffled(msgs, seed)) { const row = await insertFixture(u.id, m, { assign: true }); idToKey.set(row.id, m.key); }
            const groups = (await threadsOf(u.id, idToKey)).sort((a, b) => (a[0] < b[0] ? -1 : 1));
            expect(groups, `seed ${seed}`).toEqual([[...FIXTURE_KEYS_A].sort(), [...FIXTURE_KEYS_B].sort()]);
            const keys = new Set((await keysOf(u.id)).values());
            expect(keys.size).toBe(2);
            if (seed === 1) {
                const a1 = threadInfoFromRawMime(Buffer.from(byKey('A1').mime));
                expect([...keys]).toContain(`m:${a1.messageId}`);
                // los conteos por HILO del SQL coinciden
                const counts = await getScopeCounts(emptyScope([u.id], null), [OWNER]);
                expect(counts.threads.all).toBe(2);
                expect(counts.messages.all).toBe(13);
            }
        }
    }, 120_000);

    it('la interfaz (groupEmailsByThread con threadKey) da los mismos 2 hilos que el servidor', async () => {
        const u = await createUser(prisma);
        for (const m of shuffled(msgs, 7)) await insertFixture(u.id, m, { assign: true });
        const rows = (await prisma.email.findMany({ where: { userId: u.id } })).map((e) => ({ ...e, createdAt: e.createdAt.toISOString() }));
        const withKey = ((await prisma.$queryRawUnsafe('SELECT "id", "threadKey" FROM "Email" WHERE "userId" = $1', u.id)) as Array<{ id: string; threadKey: string }>);
        const km = new Map(withKey.map((r) => [r.id, r.threadKey]));
        const groups = groupEmailsByThread(rows.map((r) => ({ ...r, threadKey: km.get(r.id) })) as any);
        expect(groups).toHaveLength(2);
        expect(groups.map((g) => g.count).sort()).toEqual([5, 8]);
        // sin threadKey (correos antiguos) la heuristica heredada NO acierta: el asunto cambiado separa la conversacion A
        const legacy = groupEmailsByThread(rows as any);
        expect(legacy.length).toBeGreaterThan(2);
    });

    it('el lector (GET /api/emails/[id]?thread=true) trae los 8 mensajes de la conversacion A aunque el asunto cambie', async () => {
        const u = await createUser(prisma);
        sessionUser = { id: u.id, email: u.email, name: 'T' };
        const ids = new Map<string, string>();
        for (const m of msgs) ids.set(m.key, (await insertFixture(u.id, m, { assign: true })).id);
        const { GET } = await import('../../app/api/emails/[id]/route');
        const res = await GET(new NextRequest(`http://localhost/api/emails/${ids.get('A6')}?thread=true`), { params: Promise.resolve({ id: ids.get('A6')! }) });
        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body.thread.map((t: any) => t.email.id).sort()).toEqual(FIXTURE_KEYS_A.map((k) => ids.get(k)!).sort());
        const b = await GET(new NextRequest(`http://localhost/api/emails/${ids.get('B1')}?thread=true`), { params: Promise.resolve({ id: ids.get('B1')! }) });
        expect((await b.json()).thread).toHaveLength(5);
    });
});

describe('fusion, respaldo y tope en BD', () => {
    it('un mensaje que une dos hilos actualiza por SQL la clave de todos los miembros', async () => {
        const u = await createUser(prisma);
        const mk = async (mid: string, irt: string | null, refs: string[], minute: number, subject = 'Tema de prueba') => {
            const row = await prisma.email.create({ data: { userId: u.id, messageId: uid('m'), from: 'x@ext.test', to: u.email, subject, createdAt: new Date(Date.UTC(2035, 0, 1, 0, minute)) } });
            const r = await assignThread({ userId: u.id, emailId: row.id, headers: { messageId: mid, inReplyTo: irt, refs, hints: [] }, date: row.createdAt.getTime(), subject, from: 'x@ext.test', to: u.email, own: [u.email], noFallback: true });
            return { id: row.id, key: r.key!, merged: r.merged };
        };
        const a = await mk('a@x.test', null, [], 0);
        const c = await mk('c@x.test', 'b@x.test', ['b@x.test'], 2);
        const d = await mk('d@x.test', 'c@x.test', ['c@x.test'], 3);
        expect(a.key).toBe('m:a@x.test');
        expect(c.key).toBe('m:b@x.test');
        expect(d.key).toBe('m:b@x.test');
        const b = await mk('b@x.test', 'a@x.test', ['a@x.test'], 1); // une {a} con {c, d}
        expect(b.key).toBe('m:a@x.test');
        expect(b.merged).toBe(2);
        const keys = await keysOf(u.id);
        expect([...keys.values()]).toEqual(Array(4).fill('m:a@x.test'));
        expect(await loadThreadMemberIds(u.id, 'm:a@x.test')).toHaveLength(4);
    });

    it('respuesta con padre desconocido (el proveedor cambio nuestro Message-ID): se une por asunto y participantes; "Reunion" ajeno no', async () => {
        const u = await createUser(prisma);
        const sent = await prisma.email.create({ data: { userId: u.id, messageId: uid('m'), from: u.email, to: 'ana@ext.test', subject: 'Reunión de equipo', folder: 'sent', createdAt: new Date(Date.UTC(2035, 1, 1)) } });
        await assignThread({ userId: u.id, emailId: sent.id, headers: { messageId: 'nuestro@bloomx.test', inReplyTo: null, refs: [], hints: [] }, date: sent.createdAt.getTime(), subject: 'Reunión de equipo', from: u.email, to: 'ana@ext.test', own: [u.email] });
        const mkReply = async (from: string, irt: string, subject: string, day: number) => {
            const row = await prisma.email.create({ data: { userId: u.id, messageId: uid('m'), from, to: u.email, subject, createdAt: new Date(Date.UTC(2035, 1, day)) } });
            return assignThread({ userId: u.id, emailId: row.id, headers: { messageId: `${uid('r')}@ext.test`, inReplyTo: irt, refs: [irt], hints: [] }, date: row.createdAt.getTime(), subject, from, to: u.email, own: [u.email] });
        };
        const ok = await mkReply('Ana <ana@ext.test>', 'id-real-del-proveedor@resend.test', 'Re: Reunión de equipo', 2);
        expect(ok.link).toBe('fallback');
        const sentKey = (await keysOf(u.id)).get(sent.id);
        expect(ok.key).toBe(sentKey);
        const other = await mkReply('Luis <luis@otro.test>', 'x-desconocido@ext.test', 'Re: Reunión de equipo', 3);
        expect(other.key).not.toBe(sentKey);
    });

    it('correos antiguos (sin threadKey) conservan la heuristica; un mensaje nuevo que cae en su grupo hereda la clave heredada y no lo parte', async () => {
        const u = await createUser(prisma);
        sessionUser = { id: u.id, email: u.email, name: 'T' };
        const old1 = await prisma.email.create({ data: { userId: u.id, messageId: uid('m'), from: 'ana@ext.test', to: u.email, cleanTo: u.email, subject: 'Informe anual', createdAt: new Date(Date.UTC(2035, 2, 1)) } });
        const old2 = await prisma.email.create({ data: { userId: u.id, messageId: uid('m'), from: 'ana@ext.test', to: u.email, cleanTo: u.email, subject: 'Re: Informe anual', createdAt: new Date(Date.UTC(2035, 2, 2)) } });
        const fresh = await prisma.email.create({ data: { userId: u.id, messageId: uid('m'), from: 'ana@ext.test', to: u.email, cleanTo: u.email, subject: 'AW: Informe anual', createdAt: new Date(Date.UTC(2035, 2, 3)) } });
        const res = await assignThread({ userId: u.id, emailId: fresh.id, headers: { messageId: 'nuevo@ext.test', inReplyTo: 'desconocido@ext.test', refs: ['desconocido@ext.test'], hints: [] }, date: fresh.createdAt.getTime(), subject: 'AW: Informe anual', from: 'ana@ext.test', to: u.email, own: [u.email] });
        expect(res.link).toBe('fallback');
        expect(res.key).toMatch(/^h:/);
        const counts = await getScopeCounts(emptyScope([u.id], null), [u.email]);
        expect(counts.threads.all).toBe(1); // los tres siguen siendo UN hilo (2 heredados + 1 con clave heredada)
        expect(counts.messages.all).toBe(3);
        void old1; void old2;
    });

    it('sin las columnas (BD sin db:ensure) assignThread devuelve "sin cambios" y no lanza', async () => {
        const missing = Object.assign(new Error('column "rfcMessageId" of relation "Email" does not exist'), { code: '42703' });
        const res = await assignThread({ userId: 'u', emailId: 'e', headers: { messageId: 'a@x.test', inReplyTo: null, refs: [], hints: [] }, date: 0, subject: 'x', own: [] }, {
            query: async () => { throw missing; }, execute: async () => { throw missing; },
        });
        expect(res).toEqual({ key: null, merged: 0, link: 'none' });
        expect(await loadStoredThreadHeaders('e', { query: async () => { throw missing; }, execute: async () => 0 })).toBeNull();
        expect(await loadThreadMemberIds('u', 'k', { query: async () => { throw missing; }, execute: async () => 0 })).toEqual([]);
    });

    it('SQL en modo heredado (threadKey:false) ignora la columna: mismos conteos que la heuristica de la interfaz', async () => {
        const u = await createUser(prisma);
        for (const m of msgs) await insertFixture(u.id, m, { assign: true });
        const opt = await getSqlOptions();
        const q = buildScopeCountsSql(emptyScope([u.id], null), [OWNER], { ...opt, threadKey: false });
        const legacy = readScopeCounts(((await prisma.$queryRawUnsafe(q.sql, ...q.values)) as any[])[0]);
        const rows = (await prisma.email.findMany({ where: { userId: u.id } })).map((e) => ({ ...e, createdAt: e.createdAt.toISOString() }));
        expect(legacy.threads.all).toBe(groupEmailsByThread(rows as any).length);
        const modern = await getScopeCounts(emptyScope([u.id], null), [OWNER]);
        expect(modern.threads.all).toBe(2);
        expect(legacy.threads.all).toBeGreaterThan(2);
    });
});

describe('espejo UI <-> SQL: con y sin threadKey (220 correos aleatorios)', () => {
    let user: { id: string; email: string };
    let rows: Array<Record<string, any>> = [];
    const SUBJECTS = ['Hola', 'Re: Hola', 'RE: re: Hola', 'Fwd: Hola', 'AW: Angebot', 'Angebot', 'WG: AW: Angebot', 'SV: Tilbud', 'Tilbud', 'Antw: Offerte', 'Offerte', 'TR: Devis', 'Re[2]: Devis', 'Devis',
        '回复: 报价', '答复：报价', '报价', 'Rif: Preventivo', 'Preventivo', 'Odp: Oferta', 'PD: Oferta', 'Oferta', 'Invitación: Reunión', 'Accepted: Reunión', 'ab', 'Re: ab', '', '(No Subject)', ' Re: Espacios ', 'Espacios', 'Re: Factura 2033', 'Factura 2033'];
    const TOS = ['a@x.test', 'A@X.test', 'Ana <a@x.test>', '"B, Bee" <b@x.test>, c@x.test', 'sin-arroba', ''];
    const KEYS = ['m:k1@x.test', 'm:k2@x.test', 'm:k3@x.test', 'e:solo', 'h:a@x.test::Hola', 'x'];

    beforeAll(async () => {
        const u = await createUser(prisma);
        user = { id: u.id, email: u.email };
        let seed = 99;
        const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
        const pick = <T,>(l: T[]) => l[Math.floor(rand() * l.length)];
        for (let i = 0; i < 220; i++) {
            const subject = pick(SUBJECTS);
            const threadKey = rand() < 0.5 ? pick(KEYS) : null;
            const e = await prisma.email.create({ data: { userId: user.id, messageId: uid('m'), from: pick(['Ana <ana@x.test>', 'bob@x.test']), to: pick(TOS), cleanTo: pick([null, '', 'a@x.test', 'b@x.test']), subject, folder: 'inbox', read: rand() < 0.5, starred: rand() < 0.2, createdAt: new Date(Date.UTC(2036, 0, 1, 0, 0, i)) } });
            if (threadKey) await prisma.$executeRawUnsafe('UPDATE "Email" SET "threadKey" = $2 WHERE "id" = $1', e.id, threadKey);
            rows.push({ id: e.id, from: e.from, to: e.to, cleanTo: e.cleanTo, subject, threadKey, createdAt: e.createdAt.toISOString(), read: e.read, starred: e.starred, attachments: [] });
        }
    });

    const ui = (list: typeof rows) => {
        const own = ownAddressSet([user.email]);
        const groups = groupEmailsByThread(list as any);
        const n = (f: 'all' | 'unread' | 'starred') => groups.filter((g) => groupMatchesFilter(g as any, f, own)).length;
        return { all: n('all'), unread: n('unread'), starred: n('starred') };
    };
    const server = async (threadKeyMode: boolean) => {
        const opt = await getSqlOptions();
        const q = buildScopeCountsSql(emptyScope([user.id], 'inbox'), [user.email], { ...opt, threadKey: threadKeyMode });
        const t = readScopeCounts(((await prisma.$queryRawUnsafe(q.sql, ...q.values)) as any[])[0]).threads;
        return { all: t.all, unread: t.unread, starred: t.starred };
    };

    it('modo mixto (la mitad con threadKey): los hilos del SQL == los grupos de la interfaz', async () => {
        expect(await server(true)).toEqual(ui(rows));
    });
    it('modo heredado (threadKey ignorado en ambos lados): coinciden, con normalizacion multilingue', async () => {
        expect(await server(false)).toEqual(ui(rows.map((r) => ({ ...r, threadKey: null }))));
    });
    it('todos con threadKey: coinciden', async () => {
        const all = rows.map((r, i) => ({ ...r, threadKey: `m:g${i % 17}@x.test` }));
        await prisma.$executeRawUnsafe(`UPDATE "Email" SET "threadKey" = 'm:g' || ((SELECT count(*) FROM "Email" o WHERE o."userId" = "Email"."userId" AND o."createdAt" < "Email"."createdAt")::int % 17) || '@x.test' WHERE "userId" = $1`, user.id);
        expect(await server(true)).toEqual(ui(all));
    });
    it('la normalizacion del asunto es la misma en JS y en Postgres para cada prefijo', async () => {
        const { normalizeSubject } = await import('../threading');
        for (const s of SUBJECTS) {
            const r = (await prisma.$queryRawUnsafe(`SELECT btrim(regexp_replace($1::text, $2::text, '', 'i'), E' \\t\\r\\n') AS n`, s, (await import('../threading')).SUBJECT_PREFIX_SOURCE)) as Array<{ n: string }>;
            expect(r[0].n, s).toBe(normalizeSubject(s));
        }
    });
});

describe('relleno perezoso de correos antiguos (raw.eml / raw.json)', () => {
    it('lee raw.eml, asigna los 2 hilos y marca los correos sin cabeceras; es idempotente y por lotes', async () => {
        const u = await createUser(prisma);
        const emlByEmail = new Map<string, Buffer>();
        const idToKey = new Map<string, string>();
        for (const m of msgs) {
            const rawKey = `emails/2036-01-01/${uid('r')}/raw.json`;
            const row = await insertFixture(u.id, m, { assign: false });
            await prisma.email.update({ where: { id: row.id }, data: { rawKey } });
            emlByEmail.set(rawEmlKey(rawKey)!, Buffer.from(m.mime, 'utf8'));
            idToKey.set(row.id, m.key);
        }
        // un correo antiguo sin ningun objeto crudo
        const bare = await prisma.email.create({ data: { userId: u.id, messageId: uid('m'), from: 'z@ext.test', to: u.email, subject: 'Sin cabeceras', createdAt: new Date(Date.UTC(2036, 0, 9)) } });
        const deps = { ownOf: async () => [OWNER], getBuffer: async (k: string) => emlByEmail.get(k) ?? null, getText: async () => null };
        let assigned = 0;
        let last = { remaining: 99 } as any;
        for (let i = 0; i < 10 && last.remaining > 0; i++) {
            last = await backfillThreadHeaders(u.id, 4, { remote: false, deps });
            assigned += last.assigned;
        }
        expect(assigned).toBe(13);
        expect(last.remaining).toBe(0);
        const groups = (await threadsOf(u.id, new Map([...idToKey, [bare.id, 'BARE']]))).sort((a, b) => (a[0] < b[0] ? -1 : 1));
        expect(groups).toEqual([[...FIXTURE_KEYS_A].sort(), [...FIXTURE_KEYS_B].sort(), ['BARE']].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
        // el correo sin cabeceras queda con threadKey NULL (heuristica heredada) y marcado
        const stored = await loadStoredThreadHeaders(bare.id);
        expect(stored).toMatchObject({ threadKey: null, rfcMessageId: null });
        const again = await backfillThreadHeaders(u.id, 50, { remote: false, deps });
        expect(again).toMatchObject({ scanned: 0, assigned: 0, remaining: 0 });
    });

    it('con raw.json de Resend (data.headers + message_id) y ensureThreadHeaders para responder', async () => {
        const u = await createUser(prisma);
        const rawKey = `emails/2036-02-01/${uid('r')}/raw.json`;
        stored.set(rawKey, Buffer.from(JSON.stringify({ type: 'email.received', data: { message_id: '<Payload-1@Ext.Test>', headers: { 'In-Reply-To': '<padre@ext.test>', References: '<raiz@ext.test> <padre@ext.test>' } } })));
        const row = await prisma.email.create({ data: { userId: u.id, messageId: uid('m'), from: 'a@ext.test', to: u.email, subject: 'Re: X largo', rawKey, createdAt: new Date(Date.UTC(2036, 1, 1)) } });
        const h = await ensureThreadHeaders(row.id, { remote: false, deps: { ownOf: async () => [u.email] } });
        expect(h).toMatchObject({ rfcMessageId: 'Payload-1@ext.test', inReplyTo: 'padre@ext.test', refs: ['raiz@ext.test', 'padre@ext.test'], threadKey: 'm:raiz@ext.test' });
    });
});

describe('importacion (mail-transfer/ingest) asigna threadKey', () => {
    it('importar los 13 MIME en cualquier orden deja 2 hilos, con la fecha original', async () => {
        const u = await createUser(prisma);
        const ctx = { storage: memoryStorage(), labelCache: new Map<string, string>() };
        for (const m of shuffled(msgs, 11)) {
            const parsed = parseMessage(Buffer.from(m.mime, 'utf8'));
            const r = await ingestMessage(ctx, {
                userId: u.id, userEmail: OWNER, parsed, rawHash: uid('h').padEnd(64, '0'),
                placement: { folder: m.direction === 'out' ? 'sent' : 'inbox', labels: [], read: true, starred: false, previousFolder: null, source: 'default', draft: false },
            });
            expect(r.status).toBe('imported');
        }
        const keys = new Set((await keysOf(u.id)).values());
        expect(keys.size).toBe(2);
        const counts = await getScopeCounts(emptyScope([u.id], null), [OWNER]);
        expect(counts.threads.all).toBe(2);
        const a1 = (await prisma.$queryRawUnsafe('SELECT "rfcMessageId", "threadKey", "refs" FROM "Email" WHERE "userId" = $1 AND "subject" = $2', u.id, 'Presupuesto 2027')) as any[];
        expect(a1).toHaveLength(2);
        expect(a1.every((r) => typeof r.rfcMessageId === 'string' && r.threadKey.startsWith('m:'))).toBe(true);
    });
});

describe('webhook de Resend (route real): cabeceras del payload y del correo completo', () => {
    const deliver = async (data: Record<string, unknown>) => {
        const { POST } = await import('../../app/api/webhooks/resend/route');
        const res = await POST(new NextRequest('http://localhost/api/webhooks/resend', { method: 'POST', body: JSON.stringify({ type: 'email.received', data }) }));
        return res.status;
    };
    it('agrupa respuestas de distintos clientes con el original (headers del payload) y guarda Message-ID / In-Reply-To / References', async () => {
        const u = await createUser(prisma);
        for (const m of msgs.filter((x) => x.thread === 'A' && x.direction === 'in')) {
            const status = await deliver({
                email_id: uid('em'), message_id: `<${m.mid}>`, from: m.from, to: [u.email], subject: m.subject, text: m.text, html: m.html || undefined,
                headers: {
                    ...(m.inReplyTo ? { 'In-Reply-To': `<${m.inReplyTo}>` } : {}), ...(m.refs.length ? { References: m.refs.map((r) => `<${r}>`).join(' ') } : {}),
                },
            });
            expect(status).toBe(200);
        }
        const rows = (await prisma.$queryRawUnsafe('SELECT "subject", "rfcMessageId", "inReplyTo", "refs", "threadKey" FROM "Email" WHERE "userId" = $1', u.id)) as any[];
        expect(rows).toHaveLength(7);
        expect(new Set(rows.map((r) => r.threadKey)).size).toBe(1);
        expect(rows.every((r) => r.rfcMessageId)).toBe(true);
        const reply = rows.find((r) => r.subject === 'Re: Presupuesto 2027 - versión final');
        expect(reply.inReplyTo).toBe(threadInfoFromRawMime(Buffer.from(byKey('A5').mime)).inReplyTo);
        expect(reply.refs.split(' ').length).toBeGreaterThanOrEqual(4);
    });

    it('un correo sin cabeceras utiles (solo message_id) se guarda con su Message-ID y queda como hilo propio', async () => {
        const u = await createUser(prisma);
        await deliver({ email_id: uid('em'), message_id: '<Solo-Id@Ext.Test>', from: 'x@ext.test', to: [u.email], subject: 'Aviso importante', text: 't', html: '<p>t</p>' });
        const r = (await prisma.$queryRawUnsafe('SELECT "rfcMessageId", "threadKey", "refs" FROM "Email" WHERE "userId" = $1', u.id)) as any[];
        expect(r[0]).toMatchObject({ rfcMessageId: 'Solo-Id@ext.test', threadKey: 'm:Solo-Id@ext.test', refs: '' });
    });

    it('Auto-Submitted / List-Id no se unen por asunto', async () => {
        const u = await createUser(prisma);
        const base = { from: 'lista@ext.test', to: [u.email], subject: 'Boletin semanal', text: 't', html: '<p>t</p>' };
        await deliver({ ...base, email_id: uid('em'), message_id: '<b1@ext.test>', headers: { 'List-Id': '<l.ext.test>' } });
        await deliver({ ...base, email_id: uid('em'), message_id: '<b2@ext.test>', subject: 'Re: Boletin semanal', headers: { 'List-Id': '<l.ext.test>', 'In-Reply-To': '<zzz@ext.test>' } });
        const keys = new Set((await keysOf(u.id)).values());
        expect(keys.size).toBe(2);
    });
});

describe('envio: cabeceras In-Reply-To / References / Message-ID con Resend simulado', () => {
    let owner: { id: string; email: string };
    let original: { id: string; threadKey: string | null };
    const post = async (body: Record<string, unknown>, headers: Record<string, string> = {}) => {
        const { POST } = await import('../../app/api/emails/route');
        const res = await POST(new NextRequest('http://localhost/api/emails', { method: 'POST', headers, body: JSON.stringify(body) }));
        return { status: res.status, body: await res.json() };
    };

    beforeAll(async () => {
        const u = await createUser(prisma);
        owner = { id: u.id, email: u.email };
        // El original (A2 de Outlook.com, con Thread-Index) y su padre A1 ya estan en el buzon
        const a1 = await insertFixture(u.id, byKey('A1'), { assign: true });
        const a2 = await insertFixture(u.id, byKey('A2'), { assign: true });
        void a1;
        const k = (await keysOf(u.id)).get(a2.id) ?? null;
        original = { id: a2.id, threadKey: k };
    });
    beforeEach(() => { sessionUser = { id: owner.id, email: owner.email, name: 'Yo' }; sendImpl = async () => ({ data: { id: `re_${Math.random().toString(36).slice(2, 10)}` }, error: null }); });

    it('responder: In-Reply-To = Message-ID del original, References = su cadena + el original, Message-ID propio, Re: sin acumular y texto+HTML', async () => {
        const a2 = threadInfoFromRawMime(Buffer.from(byKey('A2').mime));
        const { status, body } = await post({
            to: 'alice@gmail.test', subject: 'Re: RE: Re: Presupuesto 2027', inReplyToEmailId: original.id, replyMode: 'reply',
            html: '<p>De acuerdo.</p><div class="gmail_quote"><div dir="ltr" class="gmail_attr">El lunes, Bob escribió:<br></div><blockquote class="gmail_quote"><p>Gracias Alice</p></blockquote></div>',
        });
        expect(status).toBe(200);
        expect(sends).toHaveLength(1);
        const p = sends[0];
        expect(p.subject).toBe('Re: Presupuesto 2027');
        expect(p.headers['In-Reply-To']).toBe(`<${a2.messageId}>`);
        expect(p.headers['References']).toBe(`<${a2.refs.join('> <')}> <${a2.messageId}>`);
        expect(p.headers['Message-ID']).toMatch(/^<[0-9a-f-]{36}@[a-z0-9.-]+>$/);
        expect(body.messageId).toBe(p.headers['Message-ID'].slice(1, -1));
        // multipart/alternative coherente: texto generado desde el HTML con la cita como "> "
        expect(p.text).toContain('De acuerdo.');
        expect(p.text).toMatch(/^> .*Gracias Alice/m);
        expect(p.html).toContain('gmail_quote');
        // el correo enviado queda en el MISMO hilo que el original, con su rfcMessageId / In-Reply-To / refs
        const sent = (await prisma.$queryRawUnsafe('SELECT "rfcMessageId", "inReplyTo", "refs", "threadKey" FROM "Email" WHERE "id" = $1', body.emailId)) as any[];
        expect(sent[0]).toMatchObject({ rfcMessageId: body.messageId, inReplyTo: a2.messageId, threadKey: original.threadKey });
        expect(sent[0].refs.split(' ')).toEqual([...a2.refs, a2.messageId]);
    });

    it('la respuesta del otro extremo (cita nuestro Message-ID) se agrupa con el hilo; si el proveedor cambio el id, se agrupa por respaldo', async () => {
        const sentRows = (await prisma.$queryRawUnsafe(`SELECT "id", "rfcMessageId", "threadKey" FROM "Email" WHERE "userId" = $1 AND "folder" = 'sent' ORDER BY "createdAt" DESC LIMIT 1`, owner.id)) as any[];
        const { POST } = await import('../../app/api/webhooks/resend/route');
        const reply = (irt: string, refs: string[], subject: string) => POST(new NextRequest('http://localhost/api/webhooks/resend', {
            method: 'POST', body: JSON.stringify({ type: 'email.received', data: { email_id: uid('em'), message_id: `<${uid('rep')}@gmail.test>`, from: 'Alice <alice@gmail.test>', to: [owner.email], subject, text: 't', html: '<p>t</p>', headers: { 'In-Reply-To': `<${irt}>`, References: refs.map((r) => `<${r}>`).join(' ') } } }),
        }));
        await reply(sentRows[0].rfcMessageId, ['x1@gmail.test', sentRows[0].rfcMessageId], 'Cambio de titulo total');
        const real = (await prisma.$queryRawUnsafe(`SELECT "threadKey" FROM "Email" WHERE "userId" = $1 AND "subject" = 'Cambio de titulo total'`, owner.id)) as any[];
        expect(real[0].threadKey).toBe(sentRows[0].threadKey);
        await reply('id-real-asignado-por-resend@resend.test', ['id-real-asignado-por-resend@resend.test'], 'Re: Presupuesto 2027');
        const fb = (await prisma.$queryRawUnsafe(`SELECT "threadKey" FROM "Email" WHERE "userId" = $1 AND "subject" = 'Re: Presupuesto 2027' AND "from" LIKE '%alice@gmail.test%' ORDER BY "createdAt" DESC LIMIT 1`, owner.id)) as any[];
        expect(fb[0].threadKey).toBe(sentRows[0].threadKey);
    });

    it('propiedad estricta: el correo de OTRO usuario no se usa (404, no se envia nada) ni se filtra su Message-ID', async () => {
        const victim = await createUser(prisma);
        const row = await insertFixture(victim.id, byKey('B1'), { assign: true });
        const r = await post({ to: 'alice@gmail.test', subject: 'Re: Presupuesto 2027', inReplyToEmailId: row.id, html: '<p>hola</p>' });
        expect(r.status).toBe(404);
        expect(sends).toHaveLength(0);
        const bad = await post({ to: 'alice@gmail.test', subject: 'Re: x', inReplyToEmailId: '../../etc', html: '<p>hola</p>' });
        expect(bad.status).toBe(400);
        const missing = await post({ to: 'alice@gmail.test', subject: 'Re: x', inReplyToEmailId: 'noexiste', html: '<p>hola</p>' });
        expect(missing.status).toBe(404);
        expect(sends).toHaveLength(0);
    });

    it('reenviar: sin In-Reply-To ni References (como Gmail/Apple/Thunderbird), asunto Fwd: unico y agrupado localmente con el original', async () => {
        const { status, body } = await post({ to: 'zoe@ext.test', subject: 'Fwd: RE: Fwd: Presupuesto 2027', inReplyToEmailId: original.id, replyMode: 'forward', html: '<p>fyi</p>' });
        expect(status).toBe(200);
        const p = sends[0];
        expect(p.subject).toBe('Fwd: Presupuesto 2027');
        expect(p.headers['In-Reply-To']).toBeUndefined();
        expect(p.headers['References']).toBeUndefined();
        expect(p.headers['Message-ID']).toBeTruthy();
        const sent = (await prisma.$queryRawUnsafe('SELECT "threadKey" FROM "Email" WHERE "id" = $1', body.emailId)) as any[];
        expect(sent[0].threadKey).toBe(original.threadKey);
    });

    it('mensaje nuevo: Message-ID propio + X-Entity-Ref-ID y nunca In-Reply-To; un asunto sin prefijo se respeta', async () => {
        const { status } = await post({ to: 'zoe@ext.test', subject: 'Otro tema', html: '<p>hola</p>', text: 'hola' });
        expect(status).toBe(200);
        const p = sends[0];
        expect(p.subject).toBe('Otro tema');
        expect(p.headers['In-Reply-To']).toBeUndefined();
        expect(p.headers['X-Entity-Ref-ID']).toBeTruthy();
        expect(p.headers['Message-ID']).toBeTruthy();
        expect(p.text).toBe('hola');
    });

    it('si el proveedor rechaza el Message-ID propio se reintenta UNA vez sin esa cabecera y se conservan In-Reply-To / References', async () => {
        let calls = 0;
        sendImpl = async (payload) => {
            calls++;
            if (payload.headers?.['Message-ID']) return { data: null, error: { name: 'validation_error', message: 'The header Message-ID is not allowed' } };
            return { data: { id: 're_ok' }, error: null };
        };
        const { status } = await post({ to: 'alice@gmail.test', subject: 'Re: Presupuesto 2027', inReplyToEmailId: original.id, replyMode: 'reply', html: '<p>ok</p>' });
        expect(status).toBe(200);
        expect(calls).toBe(2);
        expect(sends[1].headers['Message-ID']).toBeUndefined();
        expect(sends[1].headers['In-Reply-To']).toBeTruthy();
        expect(sends[1].headers['References']).toBeTruthy();
    });

    it('imagenes data: del HTML viajan como partes inline con Content-ID (cid:) y la copia guardada conserva el original', async () => {
        const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
        const { body } = await post({ to: 'alice@gmail.test', subject: 'Con imagen', html: `<p>mira</p><img src="data:image/png;base64,${png}" data-bx-inline="1">` });
        const p = sends[0];
        expect(p.html).toMatch(/<img src="cid:img-1-[0-9a-f]{8}@/);
        expect(p.html).not.toContain('data:image');
        const inline = p.attachments.find((a: any) => a.content_id);
        expect(inline).toMatchObject({ content_type: 'image/png', filename: 'image-1.png', content: png });
        expect(p.html).toContain(`cid:${inline.content_id}`);
        const row = await prisma.email.findUnique({ where: { id: body.emailId } });
        expect(stored.get(row!.htmlKey!)!.toString()).toContain('data:image/png;base64');
    });

    it('reenviar como adjunto: el .eml del original (acceso estricto) viaja como message/rfc822 y solo si es tuyo', async () => {
        const { status } = await post({ to: 'zoe@ext.test', subject: 'Fwd: Presupuesto 2027', inReplyToEmailId: original.id, replyMode: 'forward', attachOriginalEmlOf: original.id, html: '<p>adjunto</p>' });
        expect(status).toBe(200);
        const att = sends[0].attachments.find((a: any) => /\.eml$/.test(a.filename));
        expect(att).toBeTruthy();
        const eml = Buffer.from(att.content, 'base64').toString('utf8');
        expect(eml).toMatch(/^Message-ID: <.+>/m);
        const victim = await createUser(prisma);
        const other = await insertFixture(victim.id, byKey('B1'), { assign: true });
        sends.length = 0;
        const r = await post({ to: 'zoe@ext.test', subject: 'Fwd: x', attachOriginalEmlOf: other.id, html: '<p>x</p>' });
        expect(r.status).toBe(404);
        expect(sends).toHaveLength(0);
    });
});

describe('borradores de respuesta conservan el vinculo con el original', () => {
    it('POST /api/drafts guarda inReplyToEmailId + replyMode y GET los devuelve; valores invalidos se descartan', async () => {
        const u = await createUser(prisma);
        sessionUser = { id: u.id, email: u.email, name: 'D' };
        const { POST, GET } = await import('../../app/api/drafts/route');
        const post = async (body: Record<string, unknown>) => (await POST(new NextRequest('http://localhost/api/drafts', { method: 'POST', body: JSON.stringify({ from: u.email, to: 'a@x.test', subject: 'Re: X', body: '<p>hola</p>', ...body }) }))).json();
        const created = await post({ inReplyToEmailId: 'orig_123', replyMode: 'replyAll' });
        expect(created.draft).toMatchObject({ inReplyToEmailId: 'orig_123', replyMode: 'replyAll' });
        // una edicion posterior sin el contexto no lo borra; con el contexto vacio si
        const kept = await post({ id: created.draft.id, body: '<p>editado</p>' });
        expect(kept.draft.inReplyToEmailId).toBeUndefined();
        const list = await (await GET()).json();
        expect(list.drafts.find((d: any) => d.id === created.draft.id)).toMatchObject({ inReplyToEmailId: 'orig_123', replyMode: 'replyAll' });
        const bad = await post({ inReplyToEmailId: '../../x y', replyMode: 'hack' });
        expect(bad.draft).toMatchObject({ inReplyToEmailId: null, replyMode: null });
        const cleared = await post({ id: created.draft.id, inReplyToEmailId: null, replyMode: null });
        expect(cleared.draft).toMatchObject({ inReplyToEmailId: null, replyMode: null });
        const after = await (await GET()).json();
        expect(after.drafts.find((d: any) => d.id === created.draft.id).inReplyToEmailId).toBeUndefined();
    });
});
