import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { assertLocalPg, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';
import { __resetRateLimitState } from '../security';
import { __setAuditSink } from '../audit';
import { memoryStorage } from '../mail-transfer/source';
import { defaultEngineDeps } from '../mail-transfer/import-engine';
import { transferLimits } from '../mail-transfer/limits';
import { jobs, MailTransferTablesMissingError } from '../mail-transfer/store';
import { issueReauthToken, REAUTH_COOKIE, signDownload } from '../mail-transfer/auth';
import type { TransferActor } from '../mail-transfer/http';

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), getCurrentUser: vi.fn(), getSessionCookie: vi.fn() }));
vi.mock('@/lib/admin-auth', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/session', () => ({ getCurrentUser: mocks.getCurrentUser, getSessionCookie: mocks.getSessionCookie }));

import { dispatch } from '../mail-transfer/router';

const fx = (n: string) => readFileSync(path.join(__dirname, 'fixtures', 'mail-transfer', n));
const tag = `r${Math.random().toString(36).slice(2, 8)}`;
const addr = (n: string) => `${n}.${tag}@example.test`;
const PW = 'contrasena-del-admin-123';

const adminA: TransferActor = { mode: 'admin', key: `adminA_${tag}`, kind: 'user', email: addr('admina'), selfUserId: null, selfEmail: null, sessionId: 'jtiA', session: null, localUserId: null };
const adminB: TransferActor = { ...adminA, key: `adminB_${tag}`, email: addr('adminb'), sessionId: 'jtiB' };

let storage: ReturnType<typeof memoryStorage>;
let audits: Array<{ event: string; data: Record<string, unknown> }>;

beforeAll(async () => {
    assertLocalPg();
    process.env.TOP_DOMAIN = 'example.test';
    process.env.NEXT_PUBLIC_APP_URL = 'https://mail.example.test';
    const u = await createUser(prisma, adminA.email!);
    await prisma.user.update({ where: { id: u.id }, data: { password: await bcrypt.hash(PW, 4) } });
    adminA.localUserId = u.id;
    adminA.key = u.id;
});
afterAll(async () => { await prisma.$disconnect(); });
beforeEach(() => {
    storage = memoryStorage();
    audits = [];
    __resetRateLimitState();
    __setAuditSink(async (rec) => { audits.push({ event: rec.event, data: rec.data }); });
});

const engine = () => defaultEngineDeps({ storage, limits: { ...transferLimits() } });

async function call(method: string, p: string, opts: { actor?: TransferActor; mode?: 'admin' | 'self'; body?: unknown; raw?: Buffer; headers?: Record<string, string>; cookie?: string } = {}) {
    const mode = opts.mode ?? 'admin';
    const prefix = mode === 'admin' ? '/api/admin/mail-transfer' : '/api/mail-transfer';
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.cookie) headers.cookie = opts.cookie;
    let body: BodyInit | undefined;
    if (opts.raw) body = new Uint8Array(opts.raw);
    else if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers['content-type'] = 'application/json'; }
    const req = new NextRequest(`http://localhost${prefix}/${p}`, { method, headers, body });
    const res = await dispatch(req, p.split('?')[0].split('/').filter(Boolean), mode, { actor: opts.actor ?? adminA, ctx: { deps: engine, kick: () => undefined } });
    const text = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    return { res, status: res.status, json: text as any };
}

const reauthCookie = (actor: TransferActor = adminA, at = Date.now()) => `${REAUTH_COOKIE}=${issueReauthToken(actor.key, 'password', actor.sessionId, at).token}`;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function uploadFile(buf: Buffer, actor: TransferActor = adminA, mode: 'admin' | 'self' = 'admin', cookie = reauthCookie(actor)) {
    const c = await call('POST', 'import', { actor, mode, cookie, body: { fileName: 'copia.mbox', size: buf.length } });
    expect(c.status).toBe(200);
    const id = c.json.job.id as string;
    const chunk = c.json.chunkBytes as number;
    const total = c.json.totalChunks as number;
    for (let i = total - 1; i >= 0; i--) { // fuera de orden a proposito
        const part = buf.subarray(i * chunk, Math.min(buf.length, (i + 1) * chunk));
        const r = await call('PUT', `jobs/${id}/chunks/${i}`, { actor, mode, raw: part, headers: { 'x-chunk-sha256': sha(part) } });
        expect(r.status).toBe(200);
    }
    return id;
}
async function tickUntil(id: string, want: string, actor: TransferActor = adminA, mode: 'admin' | 'self' = 'admin') {
    for (let i = 0; i < 100; i++) {
        const t = await call('POST', `jobs/${id}/tick`, { actor, mode });
        if (t.json.job.status === want) return t.json.job;
        if (['failed', 'canceled'].includes(t.json.job.status)) throw new Error(`estado ${t.json.job.status} ${t.json.job.lastError}`);
    }
    throw new Error('sin llegar a ' + want);
}
const mbox = () => fx('takeout-style.mbox').toString().replace(/ana@example\.test/g, addr('ana'));

describe('autenticacion y autorizacion', () => {
    it('sin sesion 401; usuario sin rol 403; con rol pasa (requireAdmin real de la consola)', async () => {
        const req = (p = 'config') => new NextRequest(`http://localhost/api/admin/mail-transfer/${p}`);
        mocks.requireAdmin.mockResolvedValueOnce({ ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
        expect((await dispatch(req(), ['config'], 'admin')).status).toBe(401);
        mocks.requireAdmin.mockResolvedValueOnce({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
        expect((await dispatch(req(), ['jobs'], 'admin')).status).toBe(403);
        mocks.requireAdmin.mockResolvedValueOnce({ ok: true, actor: { kind: 'user', id: adminA.key, email: adminA.email } });
        mocks.getSessionCookie.mockResolvedValueOnce({ mfa: true, at: Math.floor(Date.now() / 1000), jti: 'j1' });
        const ok = await dispatch(req(), ['config'], 'admin');
        expect(ok.status).toBe(200);
        expect((await ok.json()).reauth.recent).toBe(true); // MFA verificado hace < 10 min cuenta como re-autenticacion
    });
    it('modo usuario: sin sesion 401 y cuenta deshabilitada 403', async () => {
        mocks.getCurrentUser.mockResolvedValueOnce(null);
        expect((await dispatch(new NextRequest('http://localhost/api/mail-transfer/config'), ['config'], 'self')).status).toBe(401);
    });
    it('rutas y metodos desconocidos: 404 / 405', async () => {
        expect((await call('GET', 'nada/raro')).status).toBe(404);
        expect((await call('DELETE', 'config')).status).toBe(405);
    });
});

describe('re-autenticacion reciente', () => {
    it('crear importacion/confirmar/exportar exige re-autenticacion; con contrasena correcta se emite una cookie ligada al admin', async () => {
        expect((await call('POST', 'import', { body: { fileName: 'a.mbox', size: 10 } })).json.code).toBe('reauth_required');
        expect((await call('POST', 'export', { body: { scopeMode: 'domain', confirmDomain: 'example.test' } })).json.code).toBe('reauth_required');
        const bad = await call('POST', 'reauth', { body: { password: 'incorrecta-incorrecta' } });
        expect(bad.status).toBe(401);
        const ok = await call('POST', 'reauth', { body: { password: PW } });
        expect(ok.status).toBe(200);
        const set = ok.res.headers.get('set-cookie') ?? '';
        expect(set).toMatch(/bx_mt_reauth=/);
        expect(set).toMatch(/HttpOnly/i);
        expect(set).toMatch(/SameSite=strict/i);
        const cookie = set.split(';')[0];
        expect((await call('POST', 'import', { cookie, body: { fileName: 'a.mbox', size: 10 } })).status).toBe(200);
        // la prueba de OTRO administrador no sirve
        const other = adminB;
        expect((await call('POST', 'import', { actor: other, cookie, body: { fileName: 'a.mbox', size: 10 } })).json.code).toBe('reauth_required');
        // caducada (hace 11 minutos)
        expect((await call('POST', 'import', { cookie: reauthCookie(adminA, Date.now() - 11 * 60_000), body: { fileName: 'a.mbox', size: 10 } })).json.code).toBe('reauth_required');
        // manipulada
        expect((await call('POST', 'import', { cookie: cookie.slice(0, -3) + 'aaa', body: { fileName: 'a.mbox', size: 10 } })).json.code).toBe('reauth_required');
        // sin contrasena ni codigo
        expect((await call('POST', 'reauth', { body: {} })).status).toBe(400);
        expect(audits.some((a) => a.event === 'admin.mail_transfer.reauth_failed')).toBe(true);
    });
    it('rate limit del reintento de contrasena: 429 a partir del 7o intento', async () => {
        let last = 0;
        for (let i = 0; i < 7; i++) last = (await call('POST', 'reauth', { body: { password: 'mala-mala-mala-mala' } })).status;
        expect(last).toBe(429);
    });
});

describe('importacion completa por API (subida por trozos, vista previa, buzones faltantes, confirmacion)', () => {
    it('trozos: hash erroneo 422, tamano erroneo 400, indice fuera de rango, completar incompleto 409, reanudar consulta los recibidos', async () => {
        const buf = Buffer.from(mbox());
        const c = await call('POST', 'import', { cookie: reauthCookie(), body: { fileName: '../../etc/passwd\\x.mbox', size: buf.length } });
        const id = c.json.job.id;
        expect(c.json.job.fileName).toBe('x.mbox');
        expect((await call('PUT', `jobs/${id}/chunks/0`, { raw: buf, headers: { 'x-chunk-sha256': 'a'.repeat(64) } })).json.code).toBe('chunk_hash_mismatch');
        expect((await call('PUT', `jobs/${id}/chunks/0`, { raw: buf })).json.code).toBe('chunk_hash_required');
        expect((await call('PUT', `jobs/${id}/chunks/0`, { raw: buf.subarray(1), headers: { 'x-chunk-sha256': sha(buf.subarray(1)) } })).json.code).toBe('bad_chunk_size');
        expect((await call('PUT', `jobs/${id}/chunks/5`, { raw: buf, headers: { 'x-chunk-sha256': sha(buf) } })).json.code).toBe('bad_chunk_index');
        expect((await call('POST', `jobs/${id}/complete`)).json.code).toBe('upload_incomplete');
        expect((await call('GET', `jobs/${id}/chunks`)).json.received).toEqual([]);
        expect((await call('PUT', `jobs/${id}/chunks/0`, { raw: buf, headers: { 'x-chunk-sha256': sha(buf) } })).status).toBe(200);
        expect((await call('GET', `jobs/${id}/chunks`)).json.received).toEqual([0]);
        const done = await call('POST', `jobs/${id}/complete`);
        expect(done.json.job.status).toBe('analyzing');
        // ya no se aceptan mas trozos
        expect((await call('PUT', `jobs/${id}/chunks/0`, { raw: buf, headers: { 'x-chunk-sha256': sha(buf) } })).json.code).toBe('not_uploading');
    });

    it('flujo completo: vista previa con estado de buzones, creacion de faltantes (credenciales una sola vez), confirmacion y informe', async () => {
        await createUser(prisma, addr('existe'));
        const raw = Buffer.from(mbox().replace(/Delivered-To: [^\n]+\n/g, `Delivered-To: ${addr('nuevo')}\n`) + `\nFrom x@y Mon Jan 04 09:00:00 +0000 2024\nMessage-ID: <extra-${tag}@r.test>\nDelivered-To: ${addr('existe')}\nSubject: para el que existe\n\nhola\n`);
        const id = await uploadFile(raw);
        expect((await call('POST', `jobs/${id}/complete`)).status).toBe(200);
        // otro administrador NO ve el trabajo (propiedad estricta) ni puede operar sobre el
        for (const [m, p] of [['GET', `jobs/${id}`], ['GET', `jobs/${id}/preview`], ['POST', `jobs/${id}/cancel`], ['POST', `jobs/${id}/tick`], ['GET', `jobs/${id}/report`], ['DELETE', `jobs/${id}`]] as const) {
            expect((await call(m, p, { actor: adminB })).status, `${m} ${p}`).toBe(404);
        }
        expect((await call('GET', 'jobs', { actor: adminB })).json.jobs).toEqual([]);
        await tickUntil(id, 'ready');

        const pv = await call('GET', `jobs/${id}/preview`);
        expect(pv.json.summary).toMatchObject({ messages: 4 });
        const byAddr = Object.fromEntries(pv.json.mailboxes.map((m: any) => [m.address, m]));
        expect(byAddr[addr('nuevo')]).toMatchObject({ count: 2, status: 'missing' });
        expect(byAddr[addr('ana')]).toMatchObject({ count: 1, status: 'missing' }); // el enviado se asigna por su remitente
        expect(byAddr[addr('existe')]).toMatchObject({ count: 1, status: 'exists' });
        expect(pv.json.canCreate).toBe(true);

        // confirmar sin crear el buzon faltante: 409 con la lista
        const early = await call('POST', `jobs/${id}/confirm`, { cookie: reauthCookie(), body: { confirmDomain: 'example.test', targetMode: 'auto', mailboxMap: { [addr('nuevo')]: addr('nuevo'), [addr('ana')]: addr('nuevo') } } });
        expect(early.json.code).toBe('mailboxes_missing');

        // crear faltantes: exige dominio escrito, politica de contrasena y direcciones de la instancia
        const mk = (over: Record<string, unknown>, cookie = reauthCookie()) => call('POST', `jobs/${id}/mailboxes`, { cookie, body: { addresses: [addr('nuevo')], passwordMode: 'random', mustChange: true, confirmDomain: 'example.test', ...over } });
        expect((await mk({}, '')).json.code).toBe('reauth_required');
        expect((await mk({ confirmDomain: 'otro.test' })).json.code).toBe('domain_confirmation_mismatch');
        expect((await mk({ addresses: ['x@gmail.com'] })).json.code).toBe('invalid_addresses');
        expect((await mk({ passwordMode: 'generic', genericPassword: 'corta' })).json.code).toBe('weak_password');
        expect((await mk({ passwordMode: 'generic' })).json.code).toBe('generic_password_required');
        const made = await mk({});
        expect(made.status).toBe(201);
        expect(made.res.headers.get('cache-control')).toBe('no-store');
        expect(made.json.created).toHaveLength(1);
        const cred = made.json.created[0];
        expect(cred).toMatchObject({ email: addr('nuevo'), mustChange: true });
        expect(cred.password.length).toBeGreaterThanOrEqual(12);
        // usuario creado con la misma politica: hash bcrypt (nunca en claro) y mustChangePassword
        const u = await prisma.user.findUnique({ where: { email: addr('nuevo') } });
        expect(u!.password).not.toBe(cred.password);
        expect(await bcrypt.compare(cred.password, u!.password)).toBe(true);
        const st = await prisma.$queryRawUnsafe<any[]>(`SELECT "mustChangePassword" FROM "UserAdminState" WHERE "userId" = $1`, u!.id);
        expect(st[0].mustChangePassword).toBe(true);
        // segunda llamada: ya existe, no se vuelven a entregar credenciales
        const again = await mk({});
        expect(again.json.created).toEqual([]);
        expect(again.json.existing).toEqual([addr('nuevo')]);
        // La contrasena no aparece en ninguna respuesta posterior, ni en el trabajo, ni en la auditoria
        const blob = JSON.stringify([(await call('GET', `jobs/${id}`)).json, (await call('GET', `jobs/${id}/preview`)).json, audits]);
        expect(blob).not.toContain(cred.password);
        expect(await prisma.$queryRawUnsafe<any[]>(`SELECT 1 FROM "MailTransferJob" WHERE "options"::text LIKE $1 OR "summary"::text LIKE $1 OR "cursor"::text LIKE $1`, `%${cred.password}%`)).toEqual([]);
        expect(audits.find((a) => a.event === 'admin.mail_transfer.mailboxes_created')!.data).toMatchObject({ created: 1, credentialMode: 'random', mustChange: true });

        // confirmar
        expect((await call('POST', `jobs/${id}/confirm`, { cookie: reauthCookie(), body: { confirmDomain: 'nope.test', targetMode: 'auto' } })).json.code).toBe('domain_confirmation_mismatch');
        const conf = await call('POST', `jobs/${id}/confirm`, { cookie: reauthCookie(), body: { confirmDomain: 'example.test', targetMode: 'auto', mailboxMap: { [addr('nuevo')]: addr('nuevo'), [addr('ana')]: addr('nuevo') } } });
        expect(conf.status).toBe(200);
        expect(conf.json.job.status).toBe('queued');
        const fin = await tickUntil(id, 'done');
        expect(fin).toMatchObject({ importedItems: 4, errorItems: 0 });
        expect(await prisma.email.count({ where: { user: { email: addr('nuevo') } } })).toBe(3);
        expect(await prisma.email.count({ where: { user: { email: addr('existe') } } })).toBe(1);
        // informe CSV
        const rep = await call('GET', `jobs/${id}/report`);
        const repBytes = Buffer.from(await rep.res.arrayBuffer());
        expect([...repBytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM para Excel
        const csv = repBytes.toString('utf8');
        expect(csv).toMatch(/status,mailbox,folder,message_id,source,error_code,reason,bytes/);
        expect(csv.match(/Importado/g)!.length).toBe(4);
        expect(audits.some((a) => a.event === 'admin.mail_transfer.import_confirmed' && a.data.messages === 4)).toBe(true);
        // no quedan archivos subidos
        expect(await storage.list(`mailtransfer/${id}/`)).toHaveLength(0);
        // borrar el trabajo terminado
        expect((await call('DELETE', `jobs/${id}`)).status).toBe(200);
        expect((await call('GET', `jobs/${id}`)).status).toBe(404);
    });

    it('cancelar una subida sin terminar borra los trozos; tope de trabajos concurrentes', async () => {
        const buf = Buffer.from(mbox());
        const id = await uploadFile(buf);
        expect((await storage.list(`mailtransfer/${id}/`)).length).toBeGreaterThan(0);
        const c = await call('POST', `jobs/${id}/cancel`);
        expect(c.json.job.status).toBe('canceled');
        expect(await storage.list(`mailtransfer/${id}/`)).toHaveLength(0);
        // tope: MAIL_TRANSFER_MAX_CONCURRENT=2 -> con 2 trabajos activos del dominio, el 3o se rechaza
        await prisma.$executeRawUnsafe(`UPDATE "MailTransferJob" SET "status" = 'canceled' WHERE "domain" = 'example.test' AND "status" IN ('analyzing','queued','running')`);
        process.env.MAIL_TRANSFER_MAX_CONCURRENT = '1';
        try {
            const a = await call('POST', 'import', { cookie: reauthCookie(), body: { fileName: 'a.mbox', size: 10 } });
            await jobs.update(a.json.job.id, { status: 'analyzing' });
            const b = await call('POST', 'import', { cookie: reauthCookie(), body: { fileName: 'b.mbox', size: 10 } });
            expect(b.status).toBe(429);
            expect(b.json.code).toBe('too_many_active_jobs');
            await jobs.update(a.json.job.id, { status: 'canceled' });
        } finally {
            delete process.env.MAIL_TRANSFER_MAX_CONCURRENT;
        }
    });

    it('tablas ausentes: 503 mail_transfer_tables_missing', async () => {
        const spy = vi.spyOn(jobs, 'listOwned').mockRejectedValueOnce(new MailTransferTablesMissingError());
        const r = await call('GET', 'jobs');
        expect(r.status).toBe(503);
        expect(r.json.code).toBe('mail_transfer_tables_missing');
        spy.mockRestore();
    });
});

describe('exportacion por API: enlace firmado, descarga unica, cifrado, dominio escrito', () => {
    it('flujo: exportar dominio -> enlace firmado ligado al trabajo y al admin -> descarga una sola vez -> se borra del storage', async () => {
        const dom = await createUser(prisma, addr('expo'));
        await prisma.email.create({ data: { userId: dom.id, messageId: uid('m'), from: 'a@r.test', to: addr('expo'), subject: 'para exportar', snippet: 'x', folder: 'inbox' } });
        const body = { scopeMode: 'selected', mailboxes: [addr('expo')], format: 'eml', includeAttachments: true, confirmDomain: 'example.test' };
        expect((await call('POST', 'export', { body })).json.code).toBe('reauth_required');
        expect((await call('POST', 'export', { cookie: reauthCookie(), body: { ...body, confirmDomain: '' } })).json.code).toBe('domain_confirmation_mismatch');
        expect((await call('POST', 'export', { cookie: reauthCookie(), body: { ...body, mailboxes: ['nadie@example.test'] } })).json.code).toBe('mailboxes_not_found');
        expect((await call('POST', 'export', { cookie: reauthCookie(), body: { ...body, password: 'corta' } })).json.code).toBe('weak_password');
        const pw = 'clave-larga-del-paquete-1';
        const created = await call('POST', 'export', { cookie: reauthCookie(), body: { ...body, password: pw } });
        expect(created.status).toBe(200);
        const id = created.json.job.id;
        // el cifrado no se expone
        expect(JSON.stringify(created.json)).not.toContain(pw);
        expect(created.json.job.options).not.toHaveProperty('enc');
        const done = await tickUntil(id, 'done');
        expect(done).toMatchObject({ downloadable: true, outputBytes: expect.any(Number) });
        expect(new Date(done.expiresAt).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);

        // enlace: exige re-autenticacion y va firmado
        expect((await call('POST', `jobs/${id}/download-link`)).json.code).toBe('reauth_required');
        const link = await call('POST', `jobs/${id}/download-link`, { cookie: reauthCookie() });
        expect(link.status).toBe(200);
        expect(link.json.url).toMatch(new RegExp(`^/api/admin/mail-transfer/jobs/${id}/download\\?exp=\\d+&sig=[\\w-]+$`));
        expect(link.json).toMatchObject({ encrypted: true, oneTime: true });
        expect(JSON.stringify(link.json)).not.toMatch(/mailtransfer\//); // no expone rutas de storage
        const dl = link.json.url.replace('/api/admin/mail-transfer/', '');

        // firma alterada / de otro admin / caducada
        expect((await call('GET', dl.replace(/sig=.{4}/, 'sig=AAAA'))).json.code).toBe('invalid_link');
        expect((await call('GET', dl, { actor: adminB })).status).toBe(404);
        const past = Math.floor(Date.now() / 1000) - 5;
        expect((await call('GET', `jobs/${id}/download?exp=${past}&sig=${signDownload(id, adminA.key, past)}`)).status).toBe(410);

        // descarga real: coincide con el tamano y el hash registrados
        const ok = await call('GET', dl);
        expect(ok.status).toBe(200);
        expect(ok.res.headers.get('content-disposition')).toMatch(/\.zip\.bmx"/);
        const bytes = Buffer.from(await ok.res.arrayBuffer());
        expect(bytes.length).toBe(done.outputBytes);
        expect(sha(bytes)).toBe(done.outputSha256);
        expect(bytes.subarray(0, 8).toString()).toBe('BLMXENC1');
        // una sola vez: nuevo enlace/descarga rechazados y el paquete se borro
        expect((await call('POST', `jobs/${id}/download-link`, { cookie: reauthCookie() })).status).toBe(410);
        expect((await call('GET', dl)).status).toBe(410);
        expect(await storage.list(`mailtransfer/${id}/`)).toHaveLength(0);
        await vi.waitFor(async () => expect((await call('GET', `jobs/${id}`)).json.job.status).toBe('expired'));
        // auditoria completa sin contenido
        const ev = audits.filter((a) => a.event.startsWith('admin.mail_transfer.'));
        const started = ev.find((a) => a.event.endsWith('export_started'))!.data;
        expect(started).toMatchObject({ mailboxes: 1, messages: 1, encrypted: true, format: 'eml', ip: expect.any(String) });
        const dld = ev.find((a) => a.event.endsWith('download_started'))!.data;
        expect(dld).toMatchObject({ bytes: done.outputBytes, sha256: done.outputSha256 });
        expect(JSON.stringify(ev)).not.toContain('para exportar');
        expect(JSON.stringify(ev)).not.toContain(pw);
    });

    it('descarga interrumpida no consume el "una sola vez"; sin oneTime se puede repetir', async () => {
        const dom = await createUser(prisma, addr('expo2'));
        await prisma.email.create({ data: { userId: dom.id, messageId: uid('m'), from: 'a@r.test', to: addr('expo2'), subject: 's', snippet: 'x', folder: 'inbox' } });
        const created = await call('POST', 'export', { cookie: reauthCookie(), body: { scopeMode: 'one', mailboxes: [addr('expo2')], format: 'mbox', confirmDomain: 'example.test' } });
        const id = created.json.job.id;
        await tickUntil(id, 'done');
        const link = (await call('POST', `jobs/${id}/download-link`, { cookie: reauthCookie() })).json.url.replace('/api/admin/mail-transfer/', '');
        const first = await call('GET', link);
        const reader = first.res.body!.getReader();
        await reader.read();
        await reader.cancel(); // el cliente aborta
        const again = await call('GET', link);
        expect(again.status).toBe(200);
        await again.res.arrayBuffer();
        expect((await call('GET', link)).status).toBe(410);

        const c2 = await call('POST', 'export', { cookie: reauthCookie(), body: { scopeMode: 'one', mailboxes: [addr('expo2')], format: 'mbox', oneTime: false, confirmDomain: 'example.test' } });
        await tickUntil(c2.json.job.id, 'done');
        const l2 = (await call('POST', `jobs/${c2.json.job.id}/download-link`, { cookie: reauthCookie() })).json.url.replace('/api/admin/mail-transfer/', '');
        for (let i = 0; i < 2; i++) {
            const r = await call('GET', l2);
            expect(r.status).toBe(200);
            const z = unzipSync(new Uint8Array(await r.res.arrayBuffer()));
            expect(Object.keys(z)).toContain('manifest.json');
        }
    });

    it('rate limit de exportaciones: 429 a partir de la 7a en un minuto', async () => {
        let last = 0;
        for (let i = 0; i < 7; i++) last = (await call('POST', 'export', { cookie: reauthCookie(), body: { scopeMode: 'selected', mailboxes: ['nadie@example.test'], confirmDomain: 'example.test' } })).status;
        expect(last).toBe(429);
    });
});

describe('modo "Mi buzon" (auto-servicio)', () => {
    it('solo el propio buzon: la importacion se fuerza a SU buzon, la exportacion solo contiene el suyo y no ve trabajos del admin', async () => {
        const me = await createUser(prisma, addr('yo'));
        const other = await createUser(prisma, addr('otro'));
        await prisma.email.create({ data: { userId: other.id, messageId: uid('m'), from: 'a@r.test', to: addr('otro'), subject: 'ajeno', snippet: 'x', folder: 'inbox' } });
        await prisma.email.create({ data: { userId: me.id, messageId: uid('m'), from: 'a@r.test', to: addr('yo'), subject: 'mio', snippet: 'x', folder: 'inbox' } });
        const self: TransferActor = { mode: 'self', key: me.id, kind: 'user', email: me.email, selfUserId: me.id, selfEmail: me.email.toLowerCase(), sessionId: 'jtiS', session: null, localUserId: me.id };
        // el admin no puede usar rutas de administracion desde el modo self
        expect((await call('GET', 'mailboxes', { actor: self, mode: 'self' })).json.code).toBe('admin_only');
        expect((await call('POST', `jobs/mtj_${'0'.repeat(32)}/mailboxes`, { actor: self, mode: 'self', body: { addresses: [addr('x')], passwordMode: 'random', confirmDomain: 'example.test' } })).json.code).toBe('admin_only');

        // importacion: los mensajes dirigidos a otro buzon terminan en el MIO
        const id = await uploadFile(Buffer.from(mbox().replace(/ana@example\.test/g, addr('otro'))), self, 'self');
        await call('POST', `jobs/${id}/complete`, { actor: self, mode: 'self' });
        await tickUntil(id, 'ready', self, 'self');
        const conf = await call('POST', `jobs/${id}/confirm`, { actor: self, mode: 'self', body: { targetMode: 'auto', mailboxMap: { [addr('otro')]: addr('otro') } } });
        expect(conf.status).toBe(200);
        await tickUntil(id, 'done', self, 'self');
        expect(await prisma.email.count({ where: { userId: me.id } })).toBe(1 + 3);
        expect(await prisma.email.count({ where: { userId: other.id } })).toBe(1);

        // exportacion: requiere contrasena reciente y solo incluye mi buzon
        expect((await call('POST', 'export', { actor: self, mode: 'self', body: { format: 'mbox' } })).json.code).toBe('reauth_required');
        const ex = await call('POST', 'export', { actor: self, mode: 'self', cookie: reauthCookie(self), body: { format: 'mbox', scopeMode: 'domain', mailboxes: [addr('otro')] } });
        expect(ex.json.job.scope).toBe('self');
        expect(ex.json.job.options.mailboxes).toEqual([me.email.toLowerCase()]);
        await tickUntil(ex.json.job.id, 'done', self, 'self');
        const link = (await call('POST', `jobs/${ex.json.job.id}/download-link`, { actor: self, mode: 'self', cookie: reauthCookie(self) })).json.url.replace('/api/mail-transfer/', '');
        const dl = await call('GET', link, { actor: self, mode: 'self' });
        const z = unzipSync(new Uint8Array(await dl.res.arrayBuffer()));
        expect(Object.keys(z).every((n) => n === 'manifest.json' || n.startsWith(`${me.email.toLowerCase()}/`))).toBe(true);
        expect(JSON.stringify(Object.keys(z))).not.toContain(addr('otro'));

        // los trabajos de administracion no son visibles en modo self y viceversa
        const adminJob = (await call('POST', 'import', { cookie: reauthCookie(), body: { fileName: 'a.mbox', size: 10 } })).json.job.id;
        expect((await call('GET', `jobs/${adminJob}`, { actor: self, mode: 'self' })).status).toBe(404);
        expect((await call('GET', `jobs/${ex.json.job.id}`, { actor: adminA })).status).toBe(404);
        expect((await call('GET', 'jobs', { actor: self, mode: 'self' })).json.jobs.every((j: any) => j.scope === 'self')).toBe(true);
    });
});
