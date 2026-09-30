import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertLocalPg, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';
import { ensureDatabaseSchema } from '../db/schema';
import { addEntries, bumpListVersion, clearList, deleteEntry, exportEntries, getCompiledList, invalidateListCache, limitFor, listEntries, recordHits, DOMAIN_OWNER } from '../spam/lists-store';
import { identityOf, MAX_LIST_ENTRIES } from '../spam/lists-core';
import { MAX_TOKENS_PER_USER, COUNTER_TOKEN, tokenize } from '../spam/bayes';
import { bumpSender, classifyForUser, deleteModel, getUserPrefs, loadModel, modelStats, saveUserPrefs, senderCounts, train } from '../spam/learning-store';
import { getSpamConfig, getSpamConfigInfo, invalidateSpamConfigCache, resetSpamConfig, saveSpamConfig } from '../spam/config-store';
import { listEvents, purgeEvents, recordEvent, spamStats } from '../spam/events-store';

// Tablas del filtro de spam contra Postgres REAL: DDL, indices, listas (dedupe, tope, concurrencia), modelo bayesiano (tope LRU,
// concurrencia, borrado), configuracion con version entre instancias y registro de eventos. `npm run test:pg`.

const q = <T = Record<string, unknown>>(sql: string, ...p: unknown[]) => prisma.$queryRawUnsafe(sql, ...p) as Promise<T[]>;
const STARTED_AT = new Date(Date.now() - 1000);
let user: { id: string; email: string };

beforeAll(async () => {
    assertLocalPg();
    for (const m of ['log', 'error', 'warn'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
    user = await createUser(prisma);
});
beforeEach(async () => {
    invalidateListCache();
    invalidateSpamConfigCache();
    await prisma.$executeRawUnsafe(`DELETE FROM "SpamList"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "AdminSetting" WHERE "key" LIKE 'spam%'`);
});
afterAll(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM "SpamList"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "SpamEvent"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "AdminSetting" WHERE "key" LIKE 'spam%'`);
    await prisma.$executeRawUnsafe('DELETE FROM "User" WHERE "createdAt" >= $1', STARTED_AT);
    await prisma.$disconnect();
});

describe('DDL: tablas, columnas, indices y restricciones', () => {
    it('crea las tablas aditivas, los indices y las columnas de Email', async () => {
        const tables = (await q<{ t: string }>(`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('SpamList','SpamToken','SpamSender','SpamEvent')`)).map((r) => r.t).sort();
        expect(tables).toEqual(['SpamEvent', 'SpamList', 'SpamSender', 'SpamToken']);
        const idx = (await q<{ i: string }>(`SELECT indexname AS i FROM pg_indexes WHERE schemaname = current_schema() AND tablename LIKE 'Spam%'`)).map((r) => r.i);
        for (const i of ['SpamList_unique_idx', 'SpamList_owner_kind_idx', 'SpamList_expiresAt_idx', 'SpamToken_user_updated_idx', 'SpamEvent_ts_idx', 'SpamEvent_decision_ts_idx', 'SpamEvent_domain_ts_idx', 'SpamList_pkey', 'SpamToken_pkey', 'SpamSender_pkey']) expect(idx).toContain(i);
        const cols = (await q<{ c: string; t: string }>(`SELECT column_name AS c, data_type AS t FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Email' AND column_name IN ('spamScore','spamReasons','isExternal')`));
        expect(Object.fromEntries(cols.map((c) => [c.c, c.t]))).toEqual({ spamScore: 'integer', spamReasons: 'jsonb', isExternal: 'boolean' });
    });
    it('es idempotente: ejecutar el DDL dos veces no falla ni duplica', async () => {
        await ensureDatabaseSchema();
        await expect(ensureDatabaseSchema()).resolves.not.toThrow();
        const n = (await q<{ n: bigint }>(`SELECT COUNT(*) AS n FROM pg_indexes WHERE indexname = 'SpamList_unique_idx'`))[0].n;
        expect(Number(n)).toBe(1);
    });
    it('las restricciones CHECK rechazan valores fuera de dominio', async () => {
        const ins = (scope: string, kind: string, mt: string) => prisma.$executeRawUnsafe(`INSERT INTO "SpamList" ("id","scope","ownerKey","kind","matchType","value") VALUES ($1,$2,'o',$3,$4,'x.com')`, uid('l'), scope, kind, mt);
        await expect(ins('weird', 'block', 'domain')).rejects.toThrow();
        await expect(ins('domain', 'reject', 'domain')).rejects.toThrow();
        await expect(ins('domain', 'block', 'glob')).rejects.toThrow();
        await expect(ins('domain', 'block', 'domain')).resolves.toBeDefined();
    });
    it('borrar el usuario borra su modelo y sus contadores (ON DELETE CASCADE)', async () => {
        const u = await createUser(prisma);
        await train(u.id, { subject: 'oferta exclusiva', body: 'compra ahora premio', fromDomain: 'x.test' }, 'spam');
        await bumpSender(u.id, 'A <a@x.test>', 'spam');
        expect(Number((await q<{ n: bigint }>(`SELECT COUNT(*) AS n FROM "SpamToken" WHERE "userId" = $1`, u.id))[0].n)).toBeGreaterThan(0);
        await prisma.user.delete({ where: { id: u.id } });
        expect(Number((await q<{ n: bigint }>(`SELECT COUNT(*) AS n FROM "SpamToken" WHERE "userId" = $1`, u.id))[0].n)).toBe(0);
        expect(Number((await q<{ n: bigint }>(`SELECT COUNT(*) AS n FROM "SpamSender" WHERE "userId" = $1`, u.id))[0].n)).toBe(0);
    });
});

describe('listas: alta, dedupe, propiedad y tope', () => {
    const owner = { scope: 'domain' as const, ownerKey: DOMAIN_OWNER, kind: 'block' as const, actor: 'admin@pg.test' };
    it('alta validada, deduplicada dentro del lote y contra la BD', async () => {
        const r = await addEntries([
            { matchType: 'domain', value: 'malo.com', includeSubdomains: true },
            { matchType: 'domain', value: 'MALO.com', includeSubdomains: true }, // duplicado del lote
            { matchType: 'email', value: 'x@y.com', reason: '<b>spam</b>' },
            { matchType: 'email', value: 'no-es-correo' },
            { matchType: 'regex', value: '(a+)+$' },
        ], owner);
        expect(r).toMatchObject({ added: 2, duplicates: 1, limitReached: false });
        expect(r.invalid.map((i) => i.error).sort()).toEqual(['invalid_email', 'unsafe_regex']);
        const again = await addEntries([{ matchType: 'domain', value: 'malo.com', includeSubdomains: true }], owner);
        expect(again).toMatchObject({ added: 0, duplicates: 1 });
        // "con subdominios" es otra regla distinta
        expect((await addEntries([{ matchType: 'domain', value: 'malo.com', includeSubdomains: false }], owner)).added).toBe(1);
        const list = await listEntries({ scope: 'domain', ownerKey: DOMAIN_OWNER, kind: 'block' });
        expect(list.total).toBe(3);
        expect(list.rows.find((x) => x.value === 'x@y.com')?.reason).not.toMatch(/[<>]/);
    });
    it('guardas: el propio dominio y los administradores no se bloquean', async () => {
        const r = await addEntries([{ matchType: 'domain', value: 'mail.acme.test' }, { matchType: 'email', value: 'jefe@gmail.com' }, { matchType: 'domain', value: 'spam.example' }], {
            ...owner, guard: { ownDomains: ['mail.acme.test'], adminEmails: ['jefe@gmail.com'] },
        });
        expect(r.added).toBe(1);
        expect(r.invalid.map((i) => i.error).sort()).toEqual(['protected_admin', 'protected_own_domain']);
    });
    it('aislamiento: el dominio y cada usuario tienen listas independientes; no se borra lo ajeno', async () => {
        const other = await createUser(prisma);
        await addEntries([{ matchType: 'domain', value: 'a.com' }], owner);
        await addEntries([{ matchType: 'domain', value: 'b.com' }], { scope: 'user', ownerKey: user.id, kind: 'block', actor: user.id });
        await addEntries([{ matchType: 'domain', value: 'c.com' }], { scope: 'user', ownerKey: other.id, kind: 'block', actor: other.id });
        const mine = (await listEntries({ scope: 'user', ownerKey: user.id, kind: 'block' })).rows;
        expect(mine.map((r) => r.value)).toEqual(['b.com']);
        const theirs = (await listEntries({ scope: 'user', ownerKey: other.id, kind: 'block' })).rows[0];
        expect(await deleteEntry(theirs.id, 'user', user.id)).toBe(false); // IDOR: otro usuario no puede borrarla
        expect(await deleteEntry(theirs.id, 'domain', DOMAIN_OWNER)).toBe(false);
        expect((await listEntries({ scope: 'user', ownerKey: other.id, kind: 'block' })).total).toBe(1);
        expect(await deleteEntry(theirs.id, 'user', other.id)).toBe(true);
        expect((await getCompiledList('user', user.id, 'block')).match(identityOf('x@b.com'))).not.toBeNull();
        expect((await getCompiledList('user', user.id, 'block')).match(identityOf('x@c.com'))).toBeNull();
    });
    it('caducidad en BD y aciertos', async () => {
        await addEntries([{ matchType: 'domain', value: 'temp.com' }], owner);
        await prisma.$executeRawUnsafe(`UPDATE "SpamList" SET "expiresAt" = NOW() - INTERVAL '1 minute' WHERE "value" = 'temp.com'`);
        invalidateListCache();
        expect((await getCompiledList('domain', DOMAIN_OWNER, 'block')).match(identityOf('x@temp.com'))).toBeNull();
        expect((await listEntries({ scope: 'domain', ownerKey: DOMAIN_OWNER, kind: 'block', status: 'expired' })).total).toBe(1);
        await addEntries([{ matchType: 'email', value: 'h@hit.com' }], owner);
        const id = (await listEntries({ scope: 'domain', ownerKey: DOMAIN_OWNER, kind: 'block', q: 'hit.com' })).rows[0].id;
        await Promise.all([recordHits([id]), recordHits([id]), recordHits([id])]);
        const row = (await listEntries({ scope: 'domain', ownerKey: DOMAIN_OWNER, kind: 'block', q: 'hit.com' })).rows[0];
        expect(row.hits).toBe(3);
        expect(row.lastHitAt).not.toBeNull();
    });
    it('TOPE de 10 000 por lista, tambien con altas concurrentes', async () => {
        expect(limitFor('block')).toBe(MAX_LIST_ENTRIES);
        await prisma.$executeRawUnsafe(
            `INSERT INTO "SpamList" ("id","scope","ownerKey","kind","matchType","value") SELECT 'seed' || g, 'domain', 'domain', 'block', 'domain', 'seed' || g || '.example' FROM generate_series(1, 9990) g`,
        );
        const batch = (p: string) => Array.from({ length: 10 }, (_, i) => ({ matchType: 'domain' as const, value: `${p}${i}.example` }));
        const results = await Promise.all(['aa', 'bb', 'cc'].map((p) => addEntries(batch(p), owner)));
        const total = Number((await q<{ n: bigint }>(`SELECT COUNT(*) AS n FROM "SpamList" WHERE "scope" = 'domain' AND "kind" = 'block'`))[0].n);
        expect(total).toBe(10_000);
        expect(results.reduce((a, r) => a + r.added, 0)).toBe(10);
        expect(results.some((r) => r.limitReached)).toBe(true);
        // una vez llena, no entra nada mas
        expect((await addEntries([{ matchType: 'domain', value: 'extra.example' }], owner)).limitReached).toBe(true);
        // el tope es por lista: otra lista del mismo propietario sigue libre
        expect((await addEntries([{ matchType: 'domain', value: 'ok.example' }], { ...owner, kind: 'allow' })).added).toBe(1);
        expect(await clearList('domain', DOMAIN_OWNER, 'block')).toBe(10_000);
    });
    it('la whitelist de externos no admite regex y exporta todo', async () => {
        const ext = { ...owner, kind: 'external' as const };
        const r = await addEntries([{ matchType: 'regex', value: '^a@' }, { matchType: 'domain', value: 'socio.com' }], ext);
        expect(r.added).toBe(1);
        expect(r.invalid[0].error).toBe('regex_not_allowed');
        expect((await exportEntries('domain', DOMAIN_OWNER, 'external')).map((e) => e.value)).toEqual(['socio.com']);
    });
    it('la version en BD invalida la cache de otra instancia', async () => {
        await addEntries([{ matchType: 'domain', value: 'v1.com' }], owner);
        const l1 = await getCompiledList('domain', DOMAIN_OWNER, 'block');
        expect(l1.match(identityOf('a@v1.com'))).not.toBeNull();
        // "otra instancia" inserta directamente y publica la version
        await prisma.$executeRawUnsafe(`INSERT INTO "SpamList" ("id","scope","ownerKey","kind","matchType","value") VALUES ('x1','domain','domain','block','domain','v2.com')`);
        await bumpListVersion('otra-instancia');
        // bumpListVersion invalida la local; fuerza el caso real: cache vigente + version cambiada en BD
        const l2 = await getCompiledList('domain', DOMAIN_OWNER, 'block', Date.now() + 6_000);
        expect(l2.match(identityOf('a@v2.com'))).not.toBeNull();
    });
});

describe('modelo bayesiano: persistencia, tope y concurrencia', () => {
    const msg = (n: number) => ({ subject: `oferta exclusiva numero${n}`, body: `compra ahora premio${n} ganador${n} dinero${n}`, fromDomain: `d${n}.test` });
    it('entrena, cuenta mensajes y clasifica con las marcas', async () => {
        const u = await createUser(prisma);
        for (let i = 0; i < 6; i++) await train(u.id, { subject: 'oferta premio ganador', body: `compra ahora dinero facil cripto inversion ${i}`, fromDomain: 'promo.test' }, 'spam');
        for (let i = 0; i < 6; i++) await train(u.id, { subject: 'reunion proyecto', body: `adjunto informe revision calendario equipo semana ${i}`, fromDomain: 'trabajo.test' }, 'ham');
        expect(await modelStats(u.id)).toMatchObject({ spamMessages: 6, hamMessages: 6 });
        const s = await classifyForUser(u.id, { subject: 'oferta premio ganador', body: 'compra ahora dinero facil cripto', fromDomain: 'promo.test' });
        const h = await classifyForUser(u.id, { subject: 'reunion proyecto', body: 'adjunto informe revision calendario equipo', fromDomain: 'trabajo.test' });
        expect(s!.points).toBeGreaterThan(8);
        expect(h!.points).toBeLessThan(-8);
        expect((await classifyForUser(u.id, { subject: 'zzzz', body: 'qqqq wwww', fromDomain: 'nada.test' }))).toBeNull();
    });
    it('sin muestras suficientes no cuenta', async () => {
        const u = await createUser(prisma);
        await train(u.id, msg(1), 'spam');
        expect(await classifyForUser(u.id, msg(1))).toBeNull();
    });
    it('undo: corregir una marca mueve el conteo de spam a ham sin negativos', async () => {
        const u = await createUser(prisma);
        await train(u.id, msg(1), 'spam');
        await train(u.id, msg(1), 'ham', { undo: true });
        const m = await loadModel(u.id, tokenize(msg(1)));
        expect(m.spamMessages).toBe(0);
        expect(m.hamMessages).toBe(1);
        for (const c of m.tokens.values()) { expect(c.spam).toBeGreaterThanOrEqual(0); expect(c.ham).toBeGreaterThanOrEqual(0); }
    });
    it('TOPE de 5000 tokens por usuario con expulsion LRU (el contador no cuenta ni se expulsa)', async () => {
        const u = await createUser(prisma);
        await prisma.$executeRawUnsafe(
            `INSERT INTO "SpamToken" ("userId","tokenHash","spam","ham","updatedAt") SELECT $1, lpad(to_hex(g), 8, '0'), 1, 0, NOW() - (g || ' minutes')::interval FROM generate_series(1, 5000) g`, u.id,
        );
        await train(u.id, msg(99), 'spam'); // anade tokens nuevos y el contador
        const rows = await q<{ tokenHash: string }>(`SELECT "tokenHash" FROM "SpamToken" WHERE "userId" = $1`, u.id);
        const non = rows.filter((r) => r.tokenHash !== COUNTER_TOKEN);
        expect(non.length).toBe(MAX_TOKENS_PER_USER);
        expect(rows.some((r) => r.tokenHash === COUNTER_TOKEN)).toBe(true);
        const fresh = tokenize(msg(99));
        for (const t of fresh) expect(non.some((r) => r.tokenHash === t)).toBe(true); // lo nuevo se conserva
        expect(non.some((r) => r.tokenHash === '00001388')).toBe(false); // el mas antiguo (g=5000) se expulsa
        expect(non.some((r) => r.tokenHash === '00000001')).toBe(true);
    });
    it('concurrencia: 20 marcas simultaneas dan contadores exactos', async () => {
        const u = await createUser(prisma);
        const m = { subject: 'mismo asunto repetido', body: 'mismo cuerpo repetido palabra', fromDomain: 'rep.test' };
        await Promise.all(Array.from({ length: 20 }, () => train(u.id, m, 'spam')));
        const model = await loadModel(u.id, tokenize(m));
        expect(model.spamMessages).toBe(20);
        for (const c of model.tokens.values()) expect(c.spam).toBe(20);
    });
    it('borrar el modelo vacia tokens y contadores del usuario, sin tocar a otros', async () => {
        const a = await createUser(prisma), b = await createUser(prisma);
        for (const u of [a, b]) { await train(u.id, msg(1), 'spam'); await bumpSender(u.id, 'x@d.test', 'spam'); }
        const r = await deleteModel(a.id);
        expect(r.tokens).toBeGreaterThan(0);
        expect(await modelStats(a.id)).toEqual({ spamMessages: 0, hamMessages: 0, tokens: 0 });
        expect((await senderCounts(a.id, 'x@d.test')).spamFromSender).toBe(0);
        expect((await modelStats(b.id)).tokens).toBeGreaterThan(0);
        expect((await senderCounts(b.id, 'x@d.test')).spamFromSender).toBe(1);
    });
    it('contadores por remitente y dominio (y undo)', async () => {
        const u = await createUser(prisma);
        await bumpSender(u.id, 'Ana <ana@x.test>', 'spam');
        await bumpSender(u.id, 'Luis <luis@x.test>', 'spam');
        await bumpSender(u.id, 'Ana <ana@x.test>', 'ham', true);
        expect(await senderCounts(u.id, 'ana@x.test')).toEqual({ spamFromSender: 0, hamFromSender: 1, spamFromDomain: 1, hamFromDomain: 1 });
    });
    it('preferencias: por defecto aprende; se acotan a -1/0/1', async () => {
        const u = await createUser(prisma);
        expect(await getUserPrefs(u.id)).toEqual({ learn: true, sensitivity: 0 });
        expect(await saveUserPrefs(u.id, { learn: false, sensitivity: 1 })).toEqual({ learn: false, sensitivity: 1 });
        expect(await saveUserPrefs(u.id, { sensitivity: 9 })).toEqual({ learn: false, sensitivity: 1 });
        expect(await saveUserPrefs(u.id, { sensitivity: -1 })).toEqual({ learn: false, sensitivity: -1 });
        await prisma.$executeRawUnsafe(`DELETE FROM "AdminSetting" WHERE "key" = $1`, `spamUser:${u.id}`);
    });
});

describe('configuracion en AdminSetting con version', () => {
    it('por defecto Equilibrado; guardar, rev creciente y restablecer', async () => {
        const d = await getSpamConfig({ fresh: true });
        expect(d).toMatchObject({ level: 'balanced', threshold: 65 });
        const a = await saveSpamConfig({ level: 'strict', actions: { suspicious: 'spam' } }, 'admin@pg.test');
        expect(a).toMatchObject({ level: 'strict', threshold: 50, rev: 1 });
        expect(a.actions.suspicious).toBe('spam');
        const b = await saveSpamConfig({ external: { enabled: true, text: { es: 'Cuidado' } } }, 'admin@pg.test');
        expect(b.rev).toBe(2);
        expect(b.level).toBe('strict'); // el parche parcial conserva lo demas
        expect(b.external.text).toEqual({ es: 'Cuidado', en: '' });
        const info = await getSpamConfigInfo({ fresh: true });
        expect(info.source).toBe('db');
        expect(info.updatedBy).toBe('admin@pg.test');
        expect((await resetSpamConfig('admin@pg.test')).level).toBe('balanced');
        expect((await getSpamConfigInfo({ fresh: true })).source).toBe('default');
    });
    it('una fila corrupta cae a los valores por defecto saneados', async () => {
        await prisma.$executeRawUnsafe(`INSERT INTO "AdminSetting" ("key","value","updatedBy") VALUES ('spamConfig', '{"level":"zzz","threshold":"x","familyWeights":{"auth":99}}'::jsonb, 't') ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value"`);
        const c = await getSpamConfig({ fresh: true });
        expect(c.level).toBe('balanced');
        expect(c.familyWeights.auth).toBe(2);
    });
    it('otra instancia cambia la configuracion: se ve tras la comprobacion de version (<= 5 s), sin esperar los 30 s', async () => {
        await saveSpamConfig({ level: 'low' }, 'a');
        expect((await getSpamConfig()).level).toBe('low');
        // otra instancia escribe y publica version
        await prisma.$executeRawUnsafe(`UPDATE "AdminSetting" SET "value" = jsonb_set("value", '{level}', '"max"'), "updatedAt" = NOW() WHERE "key" = 'spamConfig'`);
        await prisma.$executeRawUnsafe(`INSERT INTO "AdminSetting" ("key","value","updatedAt","updatedBy") VALUES ('spamConfigVersion', to_jsonb(md5(random()::text)), clock_timestamp(), 'otra') ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = clock_timestamp()`);
        expect((await getSpamConfig({ now: Date.now() + 6_000 })).level).toBe('max');
    });
});

describe('registro de eventos', () => {
    it('guarda sin contenido, filtra, pagina, estadisticas y retencion', async () => {
        await prisma.$executeRawUnsafe(`DELETE FROM "SpamEvent"`);
        await recordEvent({ sender: 'Malo@Spam.TEST', recipient: 'u@x.test', decision: 'blocked', ruleLabel: 'block.domain:spam.test' });
        await recordEvent({ sender: 'a@phish.test', decision: 'spam', score: 91, reasons: [{ i: 'auth.dmarc_fail', w: 30 }, { i: 'x'.repeat(100), w: 2.6 }] });
        await recordEvent({ sender: 'b@legit.test', decision: 'notspam' });
        const all = await listEvents({});
        expect(all.total).toBe(3);
        expect(all.rows.some((r) => r.sender === 'malo@spam.test' && r.senderDomain === 'spam.test')).toBe(true);
        const spam = await listEvents({ decision: 'spam' });
        expect(spam.rows[0].reasons).toEqual([{ i: 'auth.dmarc_fail', w: 30 }, { i: 'x'.repeat(40), w: 3 }]);
        expect((await listEvents({ domain: 'PHISH' })).total).toBe(1);
        expect((await listEvents({ pageSize: 1, page: 2 })).rows).toHaveLength(1);
        const stats = await spamStats(7);
        expect(stats.totals).toMatchObject({ spam: 1, blocked: 1, notspam: 1 });
        expect(stats.topDomains.map((d) => d.domain).sort()).toEqual(['phish.test', 'spam.test']);
        await prisma.$executeRawUnsafe(`UPDATE "SpamEvent" SET "ts" = NOW() - INTERVAL '40 days' WHERE "decision" = 'notspam'`);
        expect(await purgeEvents(30)).toBe(1);
        expect((await listEvents({})).total).toBe(2);
        // columnas: ningun campo de contenido
        const cols = (await q<{ c: string }>(`SELECT column_name AS c FROM information_schema.columns WHERE table_name = 'SpamEvent'`)).map((r) => r.c);
        expect(cols.some((c) => /subject|body|html|text|content/i.test(c))).toBe(false);
    });
});
