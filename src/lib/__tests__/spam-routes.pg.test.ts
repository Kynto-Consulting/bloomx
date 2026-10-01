import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { assertLocalPg, createEmail, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';
import { addEntries, invalidateListCache, DOMAIN_OWNER, listEntries } from '../spam/lists-store';
import { invalidateSpamConfigCache } from '../spam/config-store';
import { packVerdict } from '../spam/verdict';
import { recordEvent } from '../spam/events-store';

// Rutas /api/admin/spam/** y /api/spam/** contra Postgres real: requireAdmin, IDOR, validacion, rate limit y auditoria. `npm run test:pg`.
const audits: Array<{ event: string; data: Record<string, unknown> }> = [];
let adminGuard: { ok: true; actor: { kind: 'user'; id: string; email: string } } | { ok: false; response: Response } = { ok: true, actor: { kind: 'user', id: 'admin-1', email: 'admin@pg.test' } };
let rateOk = true;
let sessionUser: { id: string; email: string } | null = null;
const denied = (status: number) => ({ ok: false as const, get response() { return NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }, { status }); } });
const OK_ADMIN = { ok: true as const, actor: { kind: 'user' as const, id: 'admin-1', email: 'admin@pg.test' } };

vi.mock('@/lib/admin-auth', () => {
    const guardFn = vi.fn(async () => adminGuard);
    // adminRoute usa requireLevel(n): en estas pruebas el nivel no se evalua (lo cubre admin-levels.test / admin-cli.pg.test)
    return { requireAdmin: guardFn, requireLevel: (_min: number, ...a: unknown[]) => (guardFn as (...x: unknown[]) => unknown)(...a) };
});
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => sessionUser }));
vi.mock('@/lib/security', async (orig) => {
    const actual = await orig<typeof import('@/lib/security')>();
    return {
        ...actual,
        auditLog: vi.fn((event: string, data: Record<string, unknown>) => { audits.push({ event, data }); }),
        rateLimitAsync: vi.fn(async () => (rateOk ? { ok: true, remaining: 10, retryAfter: 0 } : { ok: false, remaining: 0, retryAfter: 7 })),
        getClientIp: () => '203.0.113.9',
    };
});
const rawStore = new Map<string, string>();
vi.mock('@/lib/storage', () => ({ getFromStorage: vi.fn(async (k: string) => rawStore.get(k) ?? null), uploadToStorage: vi.fn(), deleteFromStorage: vi.fn() }));

const STARTED_AT = new Date(Date.now() - 1000);
let me: { id: string; email: string };
let other: { id: string; email: string };

const call = async (path: string, handlerName: string, route: string, method: string, body?: unknown, params?: Record<string, string>, raw?: string) => {
    const mod = await import(/* @vite-ignore */ route);
    const req = new NextRequest(`http://localhost${path}`, { method, ...(body !== undefined || raw !== undefined ? { body: raw ?? JSON.stringify(body) } : {}) });
    const res: Response = await mod[handlerName](req, params ? { params: Promise.resolve(params) } : undefined);
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* csv */ }
    return { status: res.status, body: json, text, headers: res.headers };
};
const A = '../../app/api/admin/spam';
const U = '../../app/api/spam';
const admin = {
    config: (m: string, b?: unknown, raw?: string) => call('/api/admin/spam/config', m, `${A}/config/route`, m, b, undefined, raw),
    list: (m: string, kind: string, b?: unknown, qs = '', raw?: string) => call(`/api/admin/spam/lists/${kind}${qs}`, m, `${A}/lists/[kind]/route`, m, b, { kind }, raw),
    exp: (kind: string) => call(`/api/admin/spam/lists/${kind}/export`, 'GET', `${A}/lists/[kind]/export/route`, 'GET', undefined, { kind }),
    imp: (kind: string, b: unknown, raw?: string) => call(`/api/admin/spam/lists/${kind}/import`, 'POST', `${A}/lists/[kind]/import/route`, 'POST', b, { kind }, raw),
    events: (qs = '') => call(`/api/admin/spam/events${qs}`, 'GET', `${A}/events/route`, 'GET'),
    stats: (qs = '') => call(`/api/admin/spam/stats${qs}`, 'GET', `${A}/stats/route`, 'GET'),
    test: (b: unknown) => call('/api/admin/spam/test', 'POST', `${A}/test/route`, 'POST', b),
    sim: (b: unknown) => call('/api/admin/spam/simulate', 'POST', `${A}/simulate/route`, 'POST', b),
};
const ALL_ADMIN: Array<[string, () => Promise<{ status: number }>]> = [
    ['config GET', () => admin.config('GET')], ['config PUT', () => admin.config('PUT', { level: 'low' })], ['config DELETE', () => admin.config('DELETE')],
    ['lists GET', () => admin.list('GET', 'block')], ['lists POST', () => admin.list('POST', 'block', { entries: [{ matchType: 'domain', value: 'x.com' }] })],
    ['lists DELETE', () => admin.list('DELETE', 'block', { ids: ['x'] })], ['export', () => admin.exp('block')], ['import', () => admin.imp('block', { csv: 'x.com' })],
    ['events', () => admin.events()], ['stats', () => admin.stats()], ['test', () => admin.test({ text: 'hola' })], ['simulate', () => admin.sim({ config: { level: 'low' } })],
];

beforeAll(async () => {
    assertLocalPg();
    for (const m of ['log', 'error', 'warn'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
    vi.stubEnv('TOP_DOMAIN', 'pg.test');
    vi.stubEnv('ADMIN_EMAILS', 'admin@pg.test,jefe@gmail.com');
    me = await createUser(prisma);
    other = await createUser(prisma);
});
beforeEach(async () => {
    adminGuard = OK_ADMIN; rateOk = true; sessionUser = me; audits.length = 0; rawStore.clear();
    invalidateListCache(); invalidateSpamConfigCache();
    await prisma.$executeRawUnsafe(`DELETE FROM "SpamList"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "SpamEvent"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "AdminSetting" WHERE "key" LIKE 'spam%'`);
});
afterAll(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM "SpamList"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "SpamEvent"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "AdminSetting" WHERE "key" LIKE 'spam%'`);
    await prisma.$executeRawUnsafe('DELETE FROM "User" WHERE "createdAt" >= $1', STARTED_AT);
    vi.unstubAllEnvs();
    await prisma.$disconnect();
});

describe('admin: acceso, validacion y limites', () => {
    it.each(ALL_ADMIN)('%s -> 401 sin sesion y 403 sin rol de administrador', async (_n, run) => {
        adminGuard = denied(401);
        expect((await run()).status).toBe(401);
        adminGuard = denied(403);
        expect((await run()).status).toBe(403);
    });
    it.each(ALL_ADMIN)('%s -> 429 con Retry-After cuando se supera el limite', async (_n, run) => {
        rateOk = false;
        expect((await run()).status).toBe(429);
    });
    it('el rechazo de acceso no toca la base de datos', async () => {
        adminGuard = denied(403);
        await admin.list('POST', 'block', { entries: [{ matchType: 'domain', value: 'nope.com' }] });
        await admin.config('PUT', { level: 'max' });
        expect((await listEntries({ scope: 'domain', ownerKey: DOMAIN_OWNER, kind: 'block' })).total).toBe(0);
        expect(Number((await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM "AdminSetting" WHERE "key" = 'spamConfig'`) as any[])[0].n)).toBe(0);
    });
    it('validacion: tipo de lista, JSON roto, claves desconocidas, valores fuera de rango y cuerpo enorme; sin repetir lo recibido', async () => {
        expect((await admin.list('GET', 'nope')).status).toBe(400);
        expect((await admin.list('POST', 'block', undefined, '', '{no json')).status).toBe(400);
        expect((await admin.list('POST', 'block', { entries: [] })).status).toBe(400);
        expect((await admin.list('POST', 'block', { entries: [{ matchType: 'domain', value: 'a.com', evil: 1 }] })).status).toBe(400);
        expect((await admin.list('POST', 'block', { entries: [{ matchType: 'glob', value: 'a.com' }] })).status).toBe(400);
        expect((await admin.list('POST', 'block', { entries: Array.from({ length: 1001 }, (_, i) => ({ matchType: 'domain', value: `d${i}.com` })) })).status).toBe(400);
        expect((await admin.list('DELETE', 'block', { all: true })).status).toBe(400); // sin confirm
        expect((await admin.list('GET', 'block', undefined, '?pageSize=9999')).status).toBe(400);
        expect((await admin.config('PUT', { threshold: 500 })).status).toBe(400);
        expect((await admin.config('PUT', { actions: { spam: 'reject' } })).status).toBe(400);
        expect((await admin.config('PUT', { familyWeights: { content: 3 } })).status).toBe(400);
        expect((await admin.config('PUT', { hacker: true })).status).toBe(400);
        const big = await admin.list('POST', 'block', undefined, '', JSON.stringify({ entries: [{ matchType: 'domain', value: 'a.com', reason: 'x'.repeat(70_000) }] }));
        expect(big.status).toBe(413);
        const secret = 'VALOR-SECRETO-XYZ';
        const r = await admin.config('PUT', { level: secret });
        expect(r.status).toBe(400);
        expect(r.text).not.toContain(secret);
        expect((await admin.test({})).status).toBe(400);
        expect((await admin.test({ text: 'x', emailId: 'a'.repeat(200) })).status).toBe(400);
        expect((await admin.events('?decision=zzz')).status).toBe(400);
        expect((await admin.stats('?days=0')).status).toBe(400);
    });
});

describe('admin: configuracion', () => {
    it('GET por defecto, PUT parcial saneado, auditoria sin textos libres, DELETE restablece', async () => {
        const g = await admin.config('GET');
        expect(g.body).toMatchObject({ source: 'default', config: { level: 'balanced', threshold: 65 }, presets: { low: 80, balanced: 65, strict: 50, max: 35 } });
        const p = await admin.config('PUT', { level: 'strict', external: { enabled: true, text: { es: '<b>Ojo</b> con esto' } } });
        expect(p.status).toBe(200);
        expect(p.body.config).toMatchObject({ level: 'strict', threshold: 50 });
        expect(p.body.config.external.text.es).toBe('Ojo con esto');
        const a = audits.find((x) => x.event === 'admin.spam.config_changed')!;
        expect(a.data).toMatchObject({ keys: ['level', 'external'], level: 'strict', actorEmail: 'admin@pg.test' });
        expect(JSON.stringify(a.data)).not.toContain('Ojo');
        expect((await admin.config('GET')).body.source).toBe('db');
        const d = await admin.config('DELETE');
        expect(d.body.config.level).toBe('balanced');
        expect(audits.some((x) => x.event === 'admin.spam.config_reset')).toBe(true);
    });
});

describe('admin: listas', () => {
    it('alta, consulta, filtros, borrado por ids y borrado total con confirmacion; todo auditado', async () => {
        const add = await admin.list('POST', 'block', { entries: [{ matchType: 'domain', value: 'malo.com', includeSubdomains: true, reason: 'spam' }, { matchType: 'email', value: 'x@y.com' }, { matchType: 'tld', value: 'icu' }, { matchType: 'email', value: 'mal' }] });
        expect(add.body).toMatchObject({ added: 3, invalid: [{ index: 3, error: 'invalid_email' }] });
        const list = await admin.list('GET', 'block');
        expect(list.body.total).toBe(3);
        expect(list.body.limit).toBe(10000);
        expect((await admin.list('GET', 'block', undefined, '?q=malo')).body.rows).toHaveLength(1);
        expect((await admin.list('GET', 'block', undefined, '?matchType=tld')).body.rows[0].value).toBe('icu');
        const id = list.body.rows.find((r: any) => r.value === 'x@y.com').id;
        expect((await admin.list('DELETE', 'block', { ids: [id] })).body.deleted).toBe(1);
        expect((await admin.list('DELETE', 'block', { all: true, confirm: true })).body.deleted).toBe(2);
        expect(audits.map((a) => a.event)).toEqual(expect.arrayContaining(['admin.spam.list_added', 'admin.spam.list_removed']));
    });
    it('guardas: propio dominio y administradores (ADMIN_EMAILS) no se pueden bloquear; si se pueden permitir', async () => {
        const r = await admin.list('POST', 'block', { entries: [{ matchType: 'domain', value: 'pg.test' }, { matchType: 'email', value: 'jefe@gmail.com' }, { matchType: 'domain', value: 'gmail.com' }, { matchType: 'tld', value: 'test' }, { matchType: 'domain', value: 'ok.example' }] });
        expect(r.body.added).toBe(1);
        expect(r.body.invalid.map((i: any) => i.error).sort()).toEqual(['protected_admin', 'protected_admin', 'protected_own_domain', 'protected_own_domain']);
        expect((await admin.list('POST', 'allow', { entries: [{ matchType: 'domain', value: 'pg.test' }] })).body.added).toBe(1);
    });
    it('CSV: exportar neutraliza formulas; importar informa errores por linea y respeta duplicados', async () => {
        await admin.list('POST', 'block', { entries: [{ matchType: 'domain', value: 'a.com', reason: '=CMD()' }] });
        const e = await admin.exp('block');
        expect(e.status).toBe(200);
        expect(e.headers.get('content-type')).toContain('text/csv');
        expect(e.text).toContain("'=CMD()");
        const csv = 'type,value,include_subdomains,reason,expires_at\r\ndomain,b.com,true,razon,\r\nemail,malo\r\ndomain,a.com,false,dup,\r\nregex,(a+)+$\r\ndomain,pg.test\r\n';
        const i = await admin.imp('block', { csv });
        expect(i.status).toBe(200);
        expect(i.body).toMatchObject({ added: 1, duplicates: 1 });
        expect(i.body.errors.map((x: any) => [x.line, x.error])).toEqual([[3, 'invalid_email'], [5, 'unsafe_regex'], [6, 'protected_own_domain']]);
        expect((await admin.imp('block', { csv: 'x' }, 'no json')).status).toBe(400);
        expect(audits.some((x) => x.event === 'admin.spam.list_imported')).toBe(true);
        expect(audits.some((x) => x.event === 'admin.spam.list_exported')).toBe(true);
        // archivo demasiado grande
        expect((await admin.imp('block', { csv: 'a'.repeat(3 * 1024 * 1024) })).status).toBe(413);
    });
    it('IDOR: la consola solo toca la lista del DOMINIO; las personales de los usuarios siguen intactas', async () => {
        await addEntries([{ matchType: 'domain', value: 'privado.com' }], { scope: 'user', ownerKey: me.id, kind: 'block', actor: me.id });
        const mine = (await listEntries({ scope: 'user', ownerKey: me.id, kind: 'block' })).rows[0];
        expect((await admin.list('DELETE', 'block', { ids: [mine.id] })).body.deleted).toBe(0);
        expect((await admin.list('GET', 'block')).body.total).toBe(0);
        expect((await admin.list('DELETE', 'block', { all: true, confirm: true })).body.deleted).toBe(0);
        expect((await listEntries({ scope: 'user', ownerKey: me.id, kind: 'block' })).total).toBe(1);
        expect((await admin.exp('block')).text).not.toContain('privado.com');
    });
});

describe('admin: registro, estadisticas, probar y simular', () => {
    it('registro sin contenido con motivos en es/en; filtros; estadisticas', async () => {
        await recordEvent({ sender: 'a@phish.test', recipient: 'u@pg.test', decision: 'spam', score: 88, reasons: [{ i: 'auth.dmarc_fail', w: 30 }] });
        await recordEvent({ sender: 'b@x.test', decision: 'blocked', ruleLabel: 'block.domain:x.test' });
        const r = await admin.events('?decision=spam');
        expect(r.body.total).toBe(1);
        expect(r.body.rows[0].reasons[0]).toMatchObject({ id: 'auth.dmarc_fail', weight: 30 });
        expect(r.body.rows[0].reasons[0].es).toMatch(/DMARC/);
        expect(r.body.rows[0].reasons[0].en).toMatch(/DMARC/);
        expect((await admin.events('?domain=x.test')).body.total).toBe(1);
        expect((await admin.events(`?from=${encodeURIComponent(new Date(Date.now() + 3_600_000).toISOString())}`)).body.total).toBe(0);
        const s = await admin.stats('?days=7');
        expect(s.body.totals).toMatchObject({ spam: 1, blocked: 1 });
    });
    it('Probar: puntuacion por senal desde cabeceras + texto pegados, sin guardar nada ni contar aciertos', async () => {
        await admin.list('POST', 'block', { entries: [{ matchType: 'domain', value: 'phish.test' }] });
        const before = Number((await prisma.$queryRawUnsafe(`SELECT COALESCE(SUM("hits"),0) AS n FROM "SpamList"`) as any[])[0].n);
        const r = await admin.test({
            rawHeaders: 'From: PayPal <a@phish.test>\nAuthentication-Results: mx; spf=fail; dkim=fail; dmarc=fail\nMessage-ID: <1@phish.test>\nReceived: from mail.phish.test by mx',
            subject: 'Verifique su cuenta', text: 'Su contrasena ha caducado. Haga clic aqui para verificar.',
        });
        expect(r.status).toBe(200);
        expect(r.body.score).toBeGreaterThanOrEqual(65);
        expect(r.body.blockedByList).toBe(true);
        expect(r.body.decision).toBe('blocked');
        expect(r.body.signals.map((s: any) => s.id)).toEqual(expect.arrayContaining(['auth.dmarc_fail', 'imp.name_brand']));
        expect(r.body.signals[0]).toMatchObject({ family: expect.any(String), weight: expect.any(Number), es: expect.any(String), en: expect.any(String) });
        expect(Number((await prisma.$queryRawUnsafe(`SELECT COALESCE(SUM("hits"),0) AS n FROM "SpamList"`) as any[])[0].n)).toBe(before);
        expect(Number((await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM "SpamEvent"`) as any[])[0].n)).toBe(0);
        expect(audits.find((a) => a.event === 'admin.spam.test_run')!.data).not.toHaveProperty('text');
    });
    it('Probar con un correo propio usa su crudo; uno ajeno o inexistente responde 404 igual', async () => {
        adminGuard = { ok: true, actor: { kind: 'user', id: me.id, email: me.email } };
        const mine = await createEmail(prisma, me.id, { subject: 'Premio', rawKey: 'raw/mine.json', textKey: 'txt/mine' });
        const theirs = await createEmail(prisma, other.id, { rawKey: 'raw/theirs.json' });
        rawStore.set('raw/mine.json', JSON.stringify({ data: { headers: { 'authentication-results': 'mx; spf=fail; dkim=fail; dmarc=fail' } } }));
        rawStore.set('txt/mine', 'Has ganado la loteria, reclama tu premio');
        rawStore.set('raw/theirs.json', JSON.stringify({ data: { headers: {} } }));
        const ok = await admin.test({ emailId: mine.id });
        expect(ok.status).toBe(200);
        expect(ok.body.signals.map((s: any) => s.id)).toEqual(expect.arrayContaining(['auth.dmarc_fail', 'content.lex.fraud']));
        expect((await admin.test({ emailId: theirs.id })).status).toBe(404);
        expect((await admin.test({ emailId: 'no-existe' })).status).toBe(404);
        adminGuard = { ok: true, actor: { kind: 'manager' as never, id: 'm1' } as never };
        expect((await admin.test({ emailId: mine.id })).status).toBe(400); // un manager no tiene buzon
    });
    it('Simular: cuantos de los ultimos correos evaluados cambian con un ajuste', async () => {
        adminGuard = { ok: true, actor: { kind: 'user', id: me.id, email: me.email } };
        const mk = async (score: number, decision: 'spam' | 'warned' | 'delivered', raw: Array<[string, string, number]>) => {
            const e = await createEmail(prisma, me.id, { folder: decision === 'spam' ? 'spam' : 'inbox' });
            const v = packVerdict({ decision, band: decision === 'spam' ? 'spam' : decision === 'warned' ? 'suspicious' : 'clean', signals: raw.map(([id, family, weight]) => ({ id, family: family as never, weight })), raw: raw.map(([id, family, weight]) => ({ id, family: family as never, weight })) });
            await prisma.$executeRawUnsafe(`UPDATE "Email" SET "spamScore" = $2, "spamReasons" = $3::jsonb WHERE "id" = $1`, e.id, score, JSON.stringify(v));
        };
        await mk(70, 'spam', [['content.lex.phishing', 'content', 34], ['auth.dmarc_fail', 'auth', 30], ['link.ip_host', 'links', 22]]);
        await mk(55, 'warned', [['content.lex.fraud', 'content', 40], ['hdr.replyto_mismatch', 'headers', 15]]);
        await mk(5, 'delivered', [['hdr.list_unsub', 'headers', -5], ['auth.spf_neutral', 'auth', 10]]);
        await createEmail(prisma, me.id); // sin veredicto: se cuenta como omitido solo si entra en la muestra (no entra: spamReasons IS NULL)
        const strict = await admin.sim({ config: { level: 'max' } });
        expect(strict.status).toBe(200);
        expect(strict.body).toMatchObject({ analyzed: 3, scope: 'mine', current: { spam: 1, warned: 1, delivered: 1 } });
        expect(strict.body.proposed.spam).toBe(2);
        expect(strict.body.changed.toSpam).toBe(1);
        const off = await admin.sim({ config: { level: 'off' } });
        expect(off.body.proposed).toEqual({ spam: 0, warned: 0, delivered: 3 });
        expect(off.body.changed.fromSpam).toBe(1);
        const noContent = await admin.sim({ config: { familyWeights: { content: 0 } } });
        // sin la familia de contenido: el phishing baja a 52 (sospechoso) y el de estafa a 15 (limpio)
        expect(noContent.body.proposed).toEqual({ spam: 0, warned: 1, delivered: 2 });
        // la simulacion no cambia nada
        expect((await admin.config('GET')).body.source).toBe('default');
    });
});

describe('usuario: ajustes, listas personales, politica externa y bloqueo desde el lector', () => {
    const u = {
        settings: (m: string, b?: unknown) => call('/api/spam/settings', m, `${U}/settings/route`, m, b),
        list: (m: string, kind: string, b?: unknown, qs = '') => call(`/api/spam/lists/${kind}${qs}`, m, `${U}/lists/[kind]/route`, m, b, { kind }),
        block: (b: unknown) => call('/api/spam/block', 'POST', `${U}/block/route`, 'POST', b),
        external: () => call('/api/spam/external', 'GET', `${U}/external/route`, 'GET'),
        why: (id: string) => call(`/api/emails/${id}/spam`, 'GET', '../../app/api/emails/[id]/spam/route', 'GET', undefined, { id }),
    };
    it('sin sesion -> 401 en todas', async () => {
        sessionUser = null;
        for (const r of [await u.settings('GET'), await u.list('GET', 'block'), await u.block({ emailId: 'x', target: 'sender' }), await u.external(), await u.why('x')]) expect(r.status).toBe(401);
    });
    it('ajustes: por defecto aprende; PUT valida; DELETE borra el modelo', async () => {
        const g = await u.settings('GET');
        expect(g.body).toMatchObject({ prefs: { learn: true, sensitivity: 0 }, domain: { allowUserSensitivity: true }, model: { minMessages: 8, active: false } });
        expect((await u.settings('PUT', { learn: false, sensitivity: 1 })).body.prefs).toEqual({ learn: false, sensitivity: 1 });
        expect((await u.settings('PUT', { sensitivity: 2 })).status).toBe(400);
        expect((await u.settings('PUT', { otra: 1 })).status).toBe(400);
        const { train } = await import('../spam/learning-store');
        await train(me.id, { subject: 'oferta premio', body: 'compra ahora dinero', fromDomain: 'x.test' }, 'spam');
        const d = await u.settings('DELETE');
        expect(d.body.model).toMatchObject({ spamMessages: 0, tokens: 0 });
        expect(d.body.deleted.tokens).toBeGreaterThan(0);
        expect(audits.map((a) => a.event)).toEqual(expect.arrayContaining(['spam.user_prefs_changed', 'spam.user_model_deleted']));
    });
    it('listas personales: aisladas por usuario y con la guarda del propio dominio', async () => {
        expect((await u.list('POST', 'block', { entries: [{ matchType: 'domain', value: 'molesto.com' }, { matchType: 'domain', value: 'pg.test' }] })).body).toMatchObject({ added: 1, invalid: [{ index: 1, error: 'protected_own_domain' }] });
        sessionUser = other;
        expect((await u.list('GET', 'block')).body.total).toBe(0);
        const mineId = (await listEntries({ scope: 'user', ownerKey: me.id, kind: 'block' })).rows[0].id;
        expect((await u.list('DELETE', 'block', { ids: [mineId] })).body.deleted).toBe(0); // IDOR
        sessionUser = me;
        expect((await u.list('GET', 'block')).body.total).toBe(1);
        expect((await u.list('GET', 'block', undefined, '?format=csv')).text).toContain('molesto.com');
        expect((await u.list('GET', 'zzz')).status).toBe(400);
        // un usuario puede bloquear a un administrador en SU lista personal (no hay guarda de administradores en ese ambito)
        expect((await u.list('POST', 'block', { entries: [{ matchType: 'email', value: 'jefe@gmail.com' }] })).body.added).toBe(1);
    });
    it('politica externa: dominios internos + confiables del dominio y propios; nunca los de otros usuarios', async () => {
        await prisma.$executeRawUnsafe(`INSERT INTO "AdminSetting" ("key","value","updatedBy") VALUES ('spamConfig', '{"external":{"enabled":true,"internalDomains":["filial.test"],"style":"info","hardenLinks":true}}'::jsonb, 't')`);
        invalidateSpamConfigCache();
        await addEntries([{ matchType: 'domain', value: 'socio.test' }], { scope: 'domain', ownerKey: DOMAIN_OWNER, kind: 'external', actor: 'a' });
        await addEntries([{ matchType: 'email', value: 'amigo@otro.test' }], { scope: 'user', ownerKey: me.id, kind: 'external', actor: me.id });
        await addEntries([{ matchType: 'email', value: 'ajeno@otro.test' }], { scope: 'user', ownerKey: other.id, kind: 'external', actor: other.id });
        const r = await u.external();
        expect(r.body).toMatchObject({ enabled: true, style: 'info', hardenLinks: true });
        expect(r.body.internalDomains).toEqual(expect.arrayContaining(['filial.test', 'pg.test']));
        expect(r.body.trusted.map((t: any) => t.v).sort()).toEqual(['amigo@otro.test', 'socio.test']);
        expect(r.body.text.es.length).toBeGreaterThan(10); // texto por defecto si no hay personalizado
        // desactivada: no expone la whitelist
        await prisma.$executeRawUnsafe(`UPDATE "AdminSetting" SET "value" = '{"external":{"enabled":false}}'::jsonb WHERE "key" = 'spamConfig'`);
        invalidateSpamConfigCache();
        expect((await u.external()).body.trusted).toEqual([]);
    });
    it('bloquear desde el lector: sender / domain, mueve a spam, y correos ajenos dan 404', async () => {
        const e = await createEmail(prisma, me.id, { from: 'Molesto <m@molesto.example>' });
        const foreign = await createEmail(prisma, other.id, { from: 'x@foreign.example' });
        const r = await u.block({ emailId: e.id, target: 'sender' });
        expect(r.body).toMatchObject({ ok: true, added: 1, value: 'm@molesto.example' });
        expect((await prisma.email.findUnique({ where: { id: e.id } }))!.folder).toBe('spam');
        expect((await u.block({ emailId: e.id, target: 'domain', moveToSpam: false })).body.value).toBe('molesto.example');
        const l = (await listEntries({ scope: 'user', ownerKey: me.id, kind: 'block' })).rows.map((x) => x.value).sort();
        expect(l).toEqual(['m@molesto.example', 'molesto.example']);
        expect((await u.block({ emailId: foreign.id, target: 'sender' })).status).toBe(404);
        expect((await u.block({ emailId: foreign.id, target: 'domain' })).status).toBe(404);
        expect((await listEntries({ scope: 'user', ownerKey: other.id, kind: 'block' })).total).toBe(0);
        const own = await createEmail(prisma, me.id, { from: 'Colega <c@pg.test>' });
        expect((await u.block({ emailId: own.id, target: 'sender' })).status).toBe(400); // propio dominio
        expect((await u.block({ emailId: e.id, target: 'nope' })).status).toBe(400);
    });
    it('"Por que": motivos es/en del correo propio; ajeno 404; sin veredicto -> scored:false', async () => {
        const e = await createEmail(prisma, me.id, { folder: 'spam' });
        const v = packVerdict({ decision: 'spam', band: 'spam', signals: [{ id: 'auth.dmarc_fail', family: 'auth', weight: 30 }, { id: 'link.ip_host', family: 'links', weight: 22, params: { host: '203.0.113.9' } }], raw: [], ext: { f: 1 } });
        await prisma.$executeRawUnsafe(`UPDATE "Email" SET "spamScore" = 72, "spamReasons" = $2::jsonb, "isExternal" = TRUE WHERE "id" = $1`, e.id, JSON.stringify(v));
        const r = await u.why(e.id);
        expect(r.body).toMatchObject({ scored: true, score: 72, decision: 'spam', threshold: 65, external: true, firstTime: true, colleagueSpoof: false });
        expect(r.body.signals[0]).toMatchObject({ id: 'auth.dmarc_fail', weight: 30 });
        expect(r.body.signals[1].es).toContain('203.0.113.9');
        expect(r.body.signals[1].en).toContain('203.0.113.9');
        const foreign = await createEmail(prisma, other.id);
        expect((await u.why(foreign.id)).status).toBe(404);
        expect((await u.why('no-existe')).status).toBe(404);
        const plain = await createEmail(prisma, me.id);
        expect((await u.why(plain.id)).body).toMatchObject({ scored: false });
    });
    it('limite de peticiones tambien en las rutas de usuario', async () => {
        rateOk = false;
        expect((await u.settings('GET')).status).toBe(429);
        expect((await u.block({ emailId: 'x', target: 'sender' })).status).toBe(429);
    });
});

void uid;
