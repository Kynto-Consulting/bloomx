import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { assertLocalPg, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';
import { addEntries, invalidateListCache, DOMAIN_OWNER, listEntries } from '../spam/lists-store';
import { invalidateSpamConfigCache, saveSpamConfig, resetSpamConfig } from '../spam/config-store';
import { listEvents } from '../spam/events-store';
import { resetInternalNamesCache } from '../spam/pipeline';
import { unpackVerdict } from '../spam/verdict';
import { moveEmailsTracked } from '../mail-store';
import { saveUserPrefs } from '../spam/learning-store';

// Webhook de entrada (route real) + motor v2 contra Postgres, con Resend/almacenamiento simulados: la blocklist NO guarda nada,
// spam va a la carpeta spam, sospechoso lleva veredicto, externos con/sin whitelist, permitidos sin eludir suplantacion/malware,
// aprendizaje al marcar y degradacion al comportamiento anterior. `npm run test:pg`. Datos 100 % sinteticos.
const uploads = new Map<string, unknown>();
const deletes: string[] = [];
const resendSend = vi.fn(async () => ({ data: { id: 'x' }, error: null }));
vi.mock('@/lib/storage', () => ({
    uploadToStorage: vi.fn(async (k: string, b: unknown) => { uploads.set(k, b); }),
    deleteFromStorage: vi.fn(async (k: string) => { deletes.push(k); return true; }),
}));
vi.mock('@/lib/resend', () => ({ resend: { emails: { send: (...a: unknown[]) => resendSend(...(a as [])) } } }));
vi.mock('@/lib/notifications/web-push', () => ({ sendNewMessagePushNotification: vi.fn(async () => undefined) }));
vi.mock('@/lib/expansions/server-hooks', () => ({ runEmailReceivedHooks: vi.fn(async () => undefined) }));

const STARTED_AT = new Date(Date.now() - 1000);
const AUTH_PASS = (d: string) => `mx.pg.test; spf=pass smtp.mailfrom=${d}; dkim=pass header.d=${d}; dmarc=pass header.from=${d}`;
const AUTH_FAIL = (d: string) => `mx.pg.test; spf=fail smtp.mailfrom=${d}; dkim=fail header.d=${d}; dmarc=fail header.from=${d}`;

beforeAll(() => {
    assertLocalPg();
    vi.stubEnv('WEBHOOK_SECRET', '');
    vi.stubEnv('TOP_DOMAIN', 'pg.test');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    for (const m of ['log', 'warn'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});
beforeEach(async () => {
    invalidateListCache();
    invalidateSpamConfigCache();
    resetInternalNamesCache();
    resendSend.mockClear();
    await prisma.$executeRawUnsafe(`DELETE FROM "SpamList"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "SpamEvent"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "AdminSetting" WHERE "key" LIKE 'spam%'`);
});
afterAll(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM "SpamList"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "SpamEvent"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "AdminSetting" WHERE "key" LIKE 'spam%'`);
    await prisma.$executeRawUnsafe('DELETE FROM "User" WHERE "createdAt" >= $1', STARTED_AT);
    vi.unstubAllEnvs(); vi.unstubAllGlobals();
    await prisma.$disconnect();
});

async function deliver(data: Record<string, unknown>) {
    const { POST } = await import('../../app/api/webhooks/resend/route');
    const res = await POST(new NextRequest('http://localhost/api/webhooks/resend', { method: 'POST', body: JSON.stringify({ type: 'email.received', data }) }));
    return { status: res.status, body: await res.json() };
}
const payload = (over: Record<string, unknown>) => ({
    email_id: uid('em'), message_id: `<${uid('mid')}@sender.test>`, from: 'Ana <ana@sender.test>', subject: 'Hola', text: 'Hola, nos vemos manana para revisar el proyecto con calma.', html: '',
    headers: { 'authentication-results': AUTH_PASS('sender.test'), date: new Date().toUTCString(), received: ['from mail.sender.test ([203.0.113.9]) by mx'] }, ...over,
});
const phishing = (over: Record<string, unknown> = {}) => payload({
    from: 'PayPal Seguridad <aviso@paypa1-secure.xyz>', subject: 'Su cuenta ha sido bloqueada',
    text: 'Hemos detectado actividad inusual. Verifique su cuenta de inmediato: haga clic aqui para verificar. Su contrasena ha caducado. https://paypa1-secure.xyz/login',
    html: '<p>Verifique su cuenta</p><a href="https://paypa1-secure.xyz/login">www.paypal.com</a>',
    headers: { 'authentication-results': AUTH_FAIL('paypa1-secure.xyz') }, ...over,
});
const row = (userId: string) => q<{ folder: string; spamScore: number | null; spamReasons: unknown; isExternal: boolean | null }>(`SELECT "folder","spamScore","spamReasons","isExternal" FROM "Email" WHERE "userId" = $1 ORDER BY "createdAt" DESC`, userId);
const q = <T,>(sql: string, ...p: unknown[]) => prisma.$queryRawUnsafe(sql, ...p) as Promise<T[]>;
const block = (value: string, matchType: 'domain' | 'email' | 'wildcard' | 'tld' | 'regex' = 'domain', sub = false) =>
    addEntries([{ matchType, value, includeSubdomains: sub }], { scope: 'domain', ownerKey: DOMAIN_OWNER, kind: 'block', actor: 'admin@pg.test' });

describe('blocklist: el correo no entra', () => {
    it('dominio bloqueado: 200 al proveedor, nada guardado (ni cuerpo, ni adjuntos, ni crudo), sin rebote, con evento y acierto', async () => {
        const u = await createUser(prisma);
        await block('blocked.test');
        const before = uploads.size;
        const r = await deliver(payload({
            to: [u.email], from: 'Malo <x@blocked.test>', attachments: [{ filename: 'a.txt', content_type: 'text/plain', content: 'contenido' }],
        }));
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ success: true });
        expect(uploads.size).toBe(before);
        expect(await prisma.email.count({ where: { userId: u.id } })).toBe(0);
        expect(await prisma.attachment.count({ where: { filename: 'a.txt', emailId: { not: null } } })).toBe(0);
        expect(resendSend).not.toHaveBeenCalled(); // sin backscatter
        const ev = (await listEvents({ decision: 'blocked' })).rows;
        expect(ev).toHaveLength(1);
        expect(ev[0]).toMatchObject({ sender: 'x@blocked.test', recipient: u.email.toLowerCase(), ruleLabel: 'block.domain:blocked.test' });
        expect(JSON.stringify(ev[0])).not.toMatch(/Hola|contenido|Hola, nos vemos/); // sin contenido
        await vi.waitFor(async () => { expect((await listEntries({ scope: 'domain', ownerKey: DOMAIN_OWNER, kind: 'block' })).rows[0].hits).toBe(1); });
    });
    it('la retransmision del mismo webhook bloqueado tampoco guarda nada', async () => {
        const u = await createUser(prisma);
        await block('blocked.test');
        const p = payload({ to: [u.email], from: 'x@blocked.test' });
        const before = uploads.size;
        await deliver(p); await deliver(p);
        expect(uploads.size).toBe(before);
        expect(await prisma.email.count({ where: { userId: u.id } })).toBe(0);
    });
    it('coincide por direccion exacta, subdominios, comodin, TLD y regex', async () => {
        const u = await createUser(prisma);
        await block('exacto@ok.test', 'email');
        await block('sub.test', 'domain', true);
        await block('*@wild.test', 'wildcard');
        await block('icu', 'tld');
        await block('^promo\\d+@', 'regex');
        for (const from of ['exacto@ok.test', 'a@x.y.sub.test', 'cualquiera@wild.test', 'a@cosa.icu', 'promo77@lo-que-sea.test']) {
            expect((await deliver(payload({ to: [u.email], from }))).status).toBe(200);
        }
        expect(await prisma.email.count({ where: { userId: u.id } })).toBe(0);
        // y lo que no coincide entra
        await deliver(payload({ to: [u.email], from: 'ok@ok.test' }));
        expect(await prisma.email.count({ where: { userId: u.id } })).toBe(1);
    });
    it('bloquea por remitente del sobre (Return-Path) y por dominio de la firma DKIM', async () => {
        const u = await createUser(prisma);
        await block('envelope.test');
        await block('firmante.test');
        const a = await deliver(payload({ to: [u.email], from: 'limpio@ok.test', headers: { 'return-path': '<bounce@envelope.test>' } }));
        const b = await deliver(payload({ to: [u.email], from: 'limpio@ok.test', headers: { 'authentication-results': 'mx; dkim=pass header.d=firmante.test' } }));
        expect([a.status, b.status]).toEqual([200, 200]);
        expect(await prisma.email.count({ where: { userId: u.id } })).toBe(0);
    });
    it('la blocklist PERSONAL solo afecta al destinatario que la definio', async () => {
        const a = await createUser(prisma), b = await createUser(prisma);
        await addEntries([{ matchType: 'domain', value: 'personal.test' }], { scope: 'user', ownerKey: a.id, kind: 'block', actor: a.id });
        await deliver(payload({ to: [a.email, b.email], from: 'x@personal.test' }));
        expect(await prisma.email.count({ where: { userId: a.id } })).toBe(0);
        expect(await prisma.email.count({ where: { userId: b.id } })).toBe(1);
        const ev = (await listEvents({ decision: 'blocked' })).rows;
        expect(ev.map((e) => e.recipient)).toEqual([a.email.toLowerCase()]);
    });
    it('el correo de la propia organizacion nunca se bloquea por lista', async () => {
        const u = await createUser(prisma);
        await prisma.$executeRawUnsafe(`INSERT INTO "SpamList" ("id","scope","ownerKey","kind","matchType","value") VALUES ('forzada','domain','domain','block','domain','pg.test')`);
        invalidateListCache();
        await deliver(payload({ to: [u.email], from: 'colega@pg.test', headers: { 'authentication-results': AUTH_PASS('pg.test') } }));
        expect(await prisma.email.count({ where: { userId: u.id } })).toBe(1);
    });
    it('el Level Desactivado NO desactiva la blocklist explicita', async () => {
        const u = await createUser(prisma);
        await saveSpamConfig({ level: 'off' }, 'a');
        await block('blocked.test');
        expect((await deliver(payload({ to: [u.email], from: 'x@blocked.test' }))).status).toBe(200);
        expect(await prisma.email.count({ where: { userId: u.id } })).toBe(0);
    });
});

describe('puntuacion, bandas y acciones', () => {
    it('phishing -> carpeta spam con veredicto, motivos y evento; boletin legitimo -> bandeja', async () => {
        const u = await createUser(prisma);
        await deliver(phishing({ to: [u.email] }));
        await deliver(payload({ to: [u.email], from: 'News <news@tienda.test>', subject: 'Novedades', headers: { 'authentication-results': AUTH_PASS('tienda.test'), 'list-unsubscribe': '<mailto:baja@tienda.test>' } }));
        const rows = await row(u.id);
        const spam = rows.find((r) => r.folder === 'spam')!, inbox = rows.find((r) => r.folder === 'inbox')!;
        expect(spam.spamScore).toBeGreaterThanOrEqual(65);
        const v = unpackVerdict(spam.spamReasons)!;
        expect(v.d).toBe('spam');
        expect(v.sg.map((s) => s[0])).toEqual(expect.arrayContaining(['imp.name_brand', 'auth.dmarc_fail']));
        expect(JSON.stringify(spam.spamReasons).length).toBeLessThanOrEqual(2048);
        expect(inbox.spamScore).toBeLessThan(15);
        expect(unpackVerdict(inbox.spamReasons)!.d).toBe('delivered');
        const ev = (await listEvents({ decision: 'spam' })).rows;
        expect(ev).toHaveLength(1);
        expect(ev[0].reasons.length).toBeGreaterThan(0);
        expect(ev[0].score).toBe(spam.spamScore);
    });
    it('banda sospechosa: entrega con advertencia (inbox) y el veredicto lo dice; la accion por banda manda', async () => {
        const u = await createUser(prisma);
        const p = () => payload({ to: [u.email], from: 'Soporte <soporte@gmail.com>', subject: 'Aviso', text: 'Verifique su cuenta, su contrasena ha caducado.', headers: { 'authentication-results': AUTH_PASS('gmail.com') } });
        await deliver(p());
        const score = (await row(u.id))[0].spamScore!;
        expect(score).toBeGreaterThan(20);
        await saveSpamConfig({ level: 'custom', threshold: score + 5 }, 'a'); // el correo cae en [umbral-15, umbral)
        await deliver(p());
        const warned = (await row(u.id))[0];
        expect(warned.folder).toBe('inbox');
        expect(unpackVerdict(warned.spamReasons)).toMatchObject({ d: 'warned', b: 'suspicious' });
        await saveSpamConfig({ actions: { suspicious: 'spam' } }, 'a');
        await deliver(p());
        expect((await row(u.id))[0].folder).toBe('spam');
        await saveSpamConfig({ actions: { suspicious: 'deliver' } }, 'a');
        await deliver(p());
        const plain = (await row(u.id))[0];
        expect(plain.folder).toBe('inbox');
        expect(unpackVerdict(plain.spamReasons)!.d).toBe('delivered');
    });
    it('Desactivado: todo a la bandeja, sin puntuacion', async () => {
        const u = await createUser(prisma);
        await saveSpamConfig({ level: 'off' }, 'a');
        await deliver(phishing({ to: [u.email] }));
        const r = (await row(u.id))[0];
        expect(r.folder).toBe('inbox');
        expect(r.spamScore).toBeNull();
    });
    it('los presets cambian el destino de un mismo correo', async () => {
        const u = await createUser(prisma);
        // remitente distinto en cada envio: siempre "primera vez", asi el score es identico
        let n = 0;
        const p = () => payload({ to: [u.email], from: `Soporte <soporte${++n}@gmail.com>`, subject: 'Aviso', text: 'Verifique su cuenta, su contrasena ha caducado.', headers: { 'authentication-results': AUTH_PASS('gmail.com') } });
        await deliver(p());
        const score = (await row(u.id))[0].spamScore!;
        await saveSpamConfig({ level: 'custom', threshold: score + 1 }, 'a'); await deliver(p());
        await saveSpamConfig({ level: 'custom', threshold: score }, 'a'); await deliver(p());
        const folders = (await row(u.id)).map((r) => r.folder).reverse();
        expect(folders).toEqual(['inbox', 'inbox', 'spam']);
    });
    it('los pesos de familia del dominio cambian el resultado', async () => {
        const u = await createUser(prisma);
        await deliver(phishing({ to: [u.email] }));
        const base = (await row(u.id))[0].spamScore!;
        await saveSpamConfig({ familyWeights: { impersonation: 0, content: 0, links: 0 } }, 'a');
        await deliver(phishing({ to: [u.email] }));
        expect((await row(u.id))[0].spamScore!).toBeLessThan(base);
    });
    it('sensibilidad del usuario (+1) solo si el dominio la permite', async () => {
        const u = await createUser(prisma);
        let n = 0;
        const p = () => payload({ to: [u.email], from: `Soporte <soporte${++n}@gmail.com>`, subject: 'Aviso', text: 'Verifique su cuenta, su contrasena ha caducado.', headers: { 'authentication-results': AUTH_PASS('gmail.com') } });
        await deliver(p());
        const score = (await row(u.id))[0].spamScore!;
        await saveSpamConfig({ level: 'custom', threshold: score + 8 }, 'a');
        await saveUserPrefs(u.id, { sensitivity: 1 }); // umbral efectivo = score - 2
        await deliver(p());
        expect((await row(u.id))[0].folder).toBe('spam');
        await saveSpamConfig({ allowUserSensitivity: false }, 'a');
        await deliver(p());
        expect((await row(u.id))[0].folder).toBe('inbox');
    });
    it('reglas v2 leen spamScore', async () => {
        const { insertRule } = await import('../rules/store');
        const u = await createUser(prisma);
        await insertRule(u.id, {
            name: 'alto', enabled: true, priority: 1, stopProcessing: false,
            conditions: { v: 2, root: { type: 'group', op: 'and', children: [{ field: 'spamScore', op: 'gte', value: 30 }] } } as never,
            actions: [{ type: 'star' }],
        });
        await deliver(phishing({ to: [u.email] }));
        await deliver(payload({ to: [u.email] }));
        const rows = await prisma.email.findMany({ where: { userId: u.id }, select: { subject: true, starred: true } });
        expect(rows.find((r) => r.subject === 'Su cuenta ha sido bloqueada')!.starred).toBe(true);
        expect(rows.find((r) => r.subject === 'Hola')!.starred).toBe(false);
    });
});

describe('permitidos: no eluden suplantacion ni malware', () => {
    const allow = (userId: string | null, value: string) => addEntries([{ matchType: 'domain', value }], { scope: userId ? 'user' : 'domain', ownerKey: userId ?? DOMAIN_OWNER, kind: 'allow', actor: 'a' });
    const spammy = (from: string, auth: string, extra: Record<string, unknown> = {}) => payload({ from, subject: 'Oferta', text: 'Verifique su cuenta, su contrasena ha caducado. Urgente.', headers: { 'authentication-results': auth }, ...extra });
    it('remitente permitido y autenticado: entrega normal aunque el texto parezca spam', async () => {
        const u = await createUser(prisma);
        await allow(null, 'socio.test');
        await deliver(spammy('Socio <a@socio.test>', AUTH_PASS('socio.test'), { to: [u.email] }));
        const r = (await row(u.id))[0];
        expect(r.folder).toBe('inbox');
        expect(unpackVerdict(r.spamReasons)).toMatchObject({ d: 'delivered' });
        expect(unpackVerdict(r.spamReasons)!.al).toBeTruthy();
    });
    it('permitido pero con DMARC/DKIM en fallo: posible suplantacion, NO se entrega como limpio', async () => {
        const u = await createUser(prisma);
        await allow(null, 'socio.test');
        await deliver(spammy('Socio <a@socio.test>', AUTH_FAIL('socio.test'), { to: [u.email] }));
        const r = (await row(u.id))[0];
        const v = unpackVerdict(r.spamReasons)!;
        expect(v.sg.map((s) => s[0])).toContain('imp.allow_spoof');
        expect(r.spamScore).toBeGreaterThanOrEqual(65);
        expect(r.folder).toBe('spam');
    });
    it('la lista personal de permitidos tiene la misma garantia', async () => {
        const u = await createUser(prisma);
        await allow(u.id, 'socio.test');
        await deliver(spammy('Socio <a@socio.test>', AUTH_FAIL('socio.test'), { to: [u.email] }));
        expect((await row(u.id))[0].folder).toBe('spam');
    });
    it('permitido con adjunto peligroso: se bloquea igual (el adjunto no se guarda y cuenta como malware)', async () => {
        const u = await createUser(prisma);
        await allow(null, 'socio.test');
        const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 1)]);
        await deliver(spammy('Socio <a@socio.test>', AUTH_PASS('socio.test'), { to: [u.email], attachments: [{ filename: 'factura.exe', content_type: 'application/octet-stream', content: exe.toString('latin1') }] }));
        const r = (await row(u.id))[0];
        const v = unpackVerdict(r.spamReasons)!;
        expect(v.sg.map((s) => s[0]).some((id) => id === 'att.dangerous_ext' || id === 'att.blocked_type')).toBe(true);
        expect(v.al).toBeFalsy(); // no se entrego "por estar permitido"
        expect(v.d).not.toBe('delivered');
        const att = await prisma.attachment.findFirst({ where: { filename: 'factura.exe', email: { userId: u.id } } });
        expect(att?.key === 'BLOCKED' || att?.status === 'failed').toBe(true);
    });
});

describe('externos', () => {
    const extCfg = (over: Record<string, unknown> = {}) => saveSpamConfig({ external: { enabled: true, ...over } }, 'a');
    it('remitente fuera del dominio propio -> isExternal; del propio dominio o interno adicional -> no', async () => {
        const u = await createUser(prisma);
        await extCfg({ internalDomains: ['filial.test'] });
        await deliver(payload({ to: [u.email], from: 'a@otro.test', subject: 'externo' }));
        await deliver(payload({ to: [u.email], from: 'b@pg.test', subject: 'propio', headers: { 'authentication-results': AUTH_PASS('pg.test') } }));
        await deliver(payload({ to: [u.email], from: 'c@filial.test', subject: 'filial', headers: { 'authentication-results': AUTH_PASS('filial.test') } }));
        const by = Object.fromEntries((await prisma.email.findMany({ where: { userId: u.id }, select: { id: true, subject: true } })).map((e) => [e.subject, e.id]));
        const flag = async (id: string) => (await q<{ isExternal: boolean }>(`SELECT "isExternal" FROM "Email" WHERE "id" = $1`, id))[0].isExternal;
        expect(await flag(by.externo)).toBe(true);
        expect(await flag(by.propio)).toBe(false);
        expect(await flag(by.filial)).toBe(false);
    });
    it('con whitelist (dominio o personal) queda marcado como confiable; sin ella no', async () => {
        const u = await createUser(prisma);
        await extCfg();
        await addEntries([{ matchType: 'domain', value: 'socio.test' }], { scope: 'domain', ownerKey: DOMAIN_OWNER, kind: 'external', actor: 'a' });
        await addEntries([{ matchType: 'email', value: 'amigo@otro.test' }], { scope: 'user', ownerKey: u.id, kind: 'external', actor: u.id });
        for (const from of ['x@socio.test', 'amigo@otro.test', 'extrano@otro.test']) await deliver(payload({ to: [u.email], from, subject: from }));
        const rows = await q<{ subject: string; spamReasons: unknown }>(`SELECT "subject","spamReasons" FROM "Email" WHERE "userId" = $1`, u.id);
        const t = (s: string) => unpackVerdict(rows.find((r) => r.subject === s)!.spamReasons)!.ext?.t === 1;
        expect(t('x@socio.test')).toBe(true);
        expect(t('amigo@otro.test')).toBe(true);
        expect(t('extrano@otro.test')).toBe(false);
    });
    it('nombre de un companero con direccion externa -> suplantacion de companero, aunque este en la whitelist', async () => {
        const boss = await createUser(prisma);
        await prisma.user.update({ where: { id: boss.id }, data: { name: 'Laura Gomez' } });
        const u = await createUser(prisma);
        await extCfg();
        await addEntries([{ matchType: 'domain', value: 'otro.test' }], { scope: 'domain', ownerKey: DOMAIN_OWNER, kind: 'external', actor: 'a' });
        resetInternalNamesCache();
        await deliver(payload({ to: [u.email], from: 'Laura Gómez <laura@otro.test>', subject: 'urgente' }));
        const v = unpackVerdict((await row(u.id))[0].spamReasons)!;
        expect(v.ext).toMatchObject({ c: 1, t: 1 });
    });
    it('primera vez que recibes de ese remitente', async () => {
        const u = await createUser(prisma);
        await extCfg();
        await deliver(payload({ to: [u.email], from: 'nuevo@otro.test', subject: 'uno' }));
        await deliver(payload({ to: [u.email], from: 'nuevo@otro.test', subject: 'dos' }));
        const rows = await q<{ subject: string; spamReasons: unknown }>(`SELECT "subject","spamReasons" FROM "Email" WHERE "userId" = $1`, u.id);
        expect(unpackVerdict(rows.find((r) => r.subject === 'uno')!.spamReasons)!.ext?.f).toBe(1);
        expect(unpackVerdict(rows.find((r) => r.subject === 'dos')!.spamReasons)!.ext?.f).toBeUndefined();
    });
});

describe('aprendizaje y degradacion', () => {
    const tokens = (id: string) => q<{ n: bigint }>(`SELECT COUNT(*) AS n FROM "SpamToken" WHERE "userId" = $1`, id).then((r) => Number(r[0].n));
    it('"Es spam" y "No es spam" (mover en el servidor) entrenan el modelo, cuentan al remitente y registran el evento', async () => {
        const u = await createUser(prisma);
        await deliver(payload({ to: [u.email], from: 'Promo <promo@oferta.test>', subject: 'Oferta exclusiva premio' }));
        const e = (await prisma.email.findFirst({ where: { userId: u.id } }))!;
        await moveEmailsTracked({ ids: [e.id], userIds: [u.id], folder: 'spam' });
        await vi.waitFor(async () => { expect(await tokens(u.id)).toBeGreaterThan(0); });
        const { modelStats, senderCounts } = await import('../spam/learning-store');
        expect((await modelStats(u.id)).spamMessages).toBe(1);
        expect((await senderCounts(u.id, 'promo@oferta.test')).spamFromSender).toBe(1);
        await moveEmailsTracked({ ids: [e.id], userIds: [u.id], folder: 'inbox' });
        await vi.waitFor(async () => { expect((await modelStats(u.id)).hamMessages).toBe(1); });
        const kinds = (await listEvents({})).rows.map((r) => r.decision);
        expect(kinds).toEqual(expect.arrayContaining(['markspam', 'notspam']));
    });
    it('mover a la papelera o entre carpetas normales no entrena', async () => {
        const u = await createUser(prisma);
        await deliver(payload({ to: [u.email], subject: 'normal' }));
        const e = (await prisma.email.findFirst({ where: { userId: u.id } }))!;
        await moveEmailsTracked({ ids: [e.id], userIds: [u.id], folder: 'trash' });
        await moveEmailsTracked({ ids: [e.id], userIds: [u.id], folder: 'archive' });
        await new Promise((r) => setTimeout(r, 150));
        expect(await tokens(u.id)).toBe(0);
    });
    it('con "aprender de mis marcas" desactivado no se entrena (pero el evento de falso positivo si se cuenta)', async () => {
        const u = await createUser(prisma);
        await saveUserPrefs(u.id, { learn: false });
        await deliver(payload({ to: [u.email], subject: 'algo' }));
        const e = (await prisma.email.findFirst({ where: { userId: u.id } }))!;
        await moveEmailsTracked({ ids: [e.id], userIds: [u.id], folder: 'spam' });
        await vi.waitFor(async () => { expect((await listEvents({ decision: 'markspam' })).total).toBe(1); });
        expect(await tokens(u.id)).toBe(0);
    });
    it('tras suficientes marcas, el modelo sube el score de correos parecidos al spam marcado', async () => {
        const u = await createUser(prisma);
        const mk = (i: number) => payload({ to: [u.email], from: `Club <club${i}@ofertas.test>`, subject: 'Descuento especial club', text: `Descuento especial para socios del club, membresia exclusiva numero ${i}. Participa en el sorteo semanal.` });
        for (let i = 0; i < 5; i++) await deliver(mk(i));
        for (let i = 0; i < 5; i++) await deliver(payload({ to: [u.email], from: `Ana ${i} <ana${i}@trabajo.test>`, subject: 'Reunion de proyecto', text: `Adjunto el informe de la reunion de proyecto semana ${i} con las conclusiones del equipo.` }));
        const all = await prisma.email.findMany({ where: { userId: u.id }, select: { id: true, subject: true } });
        await moveEmailsTracked({ ids: all.filter((e) => e.subject === 'Descuento especial club').map((e) => e.id), userIds: [u.id], folder: 'spam' });
        await moveEmailsTracked({ ids: all.filter((e) => e.subject !== 'Descuento especial club').map((e) => e.id), userIds: [u.id], folder: 'trash' });
        const { modelStats } = await import('../spam/learning-store');
        await vi.waitFor(async () => { expect((await modelStats(u.id)).spamMessages).toBe(5); });
        // el modelo necesita ham: rescatamos dos de trabajo
        for (const e of all.filter((x) => x.subject !== 'Descuento especial club').slice(0, 4)) { await moveEmailsTracked({ ids: [e.id], userIds: [u.id], folder: 'spam' }); await moveEmailsTracked({ ids: [e.id], userIds: [u.id], folder: 'inbox' }); }
        await vi.waitFor(async () => { expect((await modelStats(u.id)).hamMessages).toBeGreaterThanOrEqual(4); });
        await deliver(mk(99));
        const last = (await row(u.id))[0];
        const v = unpackVerdict(last.spamReasons)!;
        expect(v.sg.map((s) => s[0])).toContain('learn.bayes');
        expect(v.sg.find((s) => s[0] === 'learn.bayes')![1]).toBeGreaterThan(0);
    });
    it('si el motor v2 falla, se degrada al comportamiento anterior (X-Spam del origen + SPAM_SCORE_THRESHOLD) y el correo no se pierde', async () => {
        const u = await createUser(prisma);
        const cs = await import('../spam/config-store');
        const spy = vi.spyOn(cs, 'getSpamConfig').mockRejectedValue(new Error('boom'));
        try {
            await deliver(payload({ to: [u.email], subject: 'marcado por origen', headers: { 'x-spam-flag': 'YES' } }));
            await deliver(payload({ to: [u.email], subject: 'normal' }));
        } finally { spy.mockRestore(); }
        const folders = Object.fromEntries((await prisma.email.findMany({ where: { userId: u.id }, select: { subject: true, folder: true } })).map((e) => [e.subject, e.folder]));
        expect(folders).toEqual({ 'marcado por origen': 'spam', normal: 'inbox' });
    });
    it('las importaciones y otras ingestas internas no pasan por el filtro', async () => {
        const fs = await import('node:fs');
        const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(`${dir}/${d.name}`) : [`${dir}/${d.name}`]));
        const files = walk('src/lib/mail-transfer').filter((f) => f.endsWith('.ts') && !f.includes('__tests__'));
        for (const f of files) expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/applyBlocklist|classifyForRecipient/);
    });
});

afterAll(async () => { await resetSpamConfig('test'); });
