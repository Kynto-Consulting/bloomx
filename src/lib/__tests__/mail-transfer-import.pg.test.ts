import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { zipSync, strToU8, gzipSync } from 'fflate';
import { assertLocalPg, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';
import { items, jobs, newJobId, type JobRow } from '../mail-transfer/store';
import { memoryStorage, CHUNK_SIZE, chunkName } from '../mail-transfer/source';
import { runImportTick, defaultEngineDeps, type EngineDeps } from '../mail-transfer/import-engine';
import { transferLimits, jobPrefix } from '../mail-transfer/limits';
import { buildMime } from '../mail-transfer/mime-build';
import { mboxRecord } from '../mail-transfer/mbox';

const fx = (n: string) => readFileSync(path.join(__dirname, 'fixtures', 'mail-transfer', n));
const tag = `t${Math.random().toString(36).slice(2, 8)}`;
const addr = (n: string) => `${n}.${tag}@example.test`;

beforeAll(() => {
    assertLocalPg();
    process.env.TOP_DOMAIN = 'example.test';
    process.env.NEXT_PUBLIC_APP_URL = 'https://mail.example.test';
});
afterAll(async () => { await prisma.$disconnect(); });

/** Sube un buffer como trozos del trabajo (igual que la ruta de subida). */
async function putSource(storage: ReturnType<typeof memoryStorage>, jobId: string, buf: Buffer) {
    for (let i = 0, o = 0; o < buf.length; i++, o += CHUNK_SIZE) await storage.put(`${jobPrefix(jobId)}/src/${chunkName(i)}`, buf.subarray(o, o + CHUNK_SIZE));
}

async function newImport(storage: ReturnType<typeof memoryStorage>, buf: Buffer, fileName: string, options: Record<string, unknown> = {}): Promise<JobRow> {
    const j = (await jobs.create({ userId: `admin_${tag}`, actorKind: 'user', domain: 'example.test', kind: 'import', scope: 'domain', status: 'analyzing', fileName, totalBytes: buf.length, options }))!;
    await putSource(storage, j.id, buf);
    return j;
}

async function drain(id: string, deps: EngineDeps, max = 200) {
    let last;
    for (let i = 0; i < max; i++) {
        last = await runImportTick(id, deps);
        if (!last.more) break;
    }
    return last!;
}

const deps = (storage: ReturnType<typeof memoryStorage>, over: Partial<EngineDeps['limits']> = {}): EngineDeps =>
    defaultEngineDeps({ storage, limits: { ...transferLimits(), ...over } });

describe('importacion por lotes (Postgres real)', () => {
    let storage: ReturnType<typeof memoryStorage>;
    beforeEach(() => { storage = memoryStorage(); });

    async function analyzeThenRun(buf: Buffer, fileName: string, options: Record<string, unknown>, limits: Partial<EngineDeps['limits']> = {}) {
        const j = await newImport(storage, buf, fileName);
        const d = deps(storage, limits);
        const a = await drain(j.id, d);
        expect(a.status).toBe('ready');
        const ready = (await jobs.get(j.id))!;
        await jobs.update(j.id, { status: 'queued', options });
        const r = await drain(j.id, d);
        return { job: (await jobs.get(j.id))!, ready, r, d };
    }

    it('mbox estilo Takeout: analisis (buzones/carpetas/etiquetas) e importacion con fecha, banderas y carpetas originales', async () => {
        const ana = await createUser(prisma, addr('ana'));
        // Reescribe los buzones de la fixture a direcciones unicas de esta ejecucion
        const mbox = Buffer.from(fx('takeout-style.mbox').toString().replace(/ana@example\.test/g, addr('ana')));
        const j = await newImport(storage, mbox, 'takeout.mbox');
        const d = deps(storage);
        expect((await drain(j.id, d)).status).toBe('ready');
        const ready = (await jobs.get(j.id))!;
        expect(ready.summary).toMatchObject({ format: 'mbox', messages: 3, unknownMailbox: 0 });
        expect(ready.summary.mailboxes).toEqual([{ address: addr('ana'), count: 3 }]);
        expect(ready.summary.folders).toMatchObject({ inbox: 1, sent: 1, trash: 1 });
        expect((ready.summary.labels as Array<{ name: string }>).map((l) => l.name).sort()).toEqual(['Category Personal', 'Proyecto Alfa']);
        expect(ready.summary.dateMin).toBe('2024-01-01T10:00:00.000Z');

        await jobs.update(j.id, { status: 'queued', options: { targetMode: 'auto' } });
        const done = await drain(j.id, d);
        expect(done.status).toBe('done');
        const job = (await jobs.get(j.id))!;
        expect(job).toMatchObject({ importedItems: 3, duplicateItems: 0, errorItems: 0, status: 'done' });
        // El almacenamiento subido se borra al terminar
        expect(await storage.list(`${jobPrefix(j.id)}/`)).toHaveLength(0);

        const emails = await prisma.email.findMany({ where: { userId: ana.id }, include: { labels: true }, orderBy: { createdAt: 'asc' } });
        expect(emails).toHaveLength(3);
        const [e1, e2, e3] = emails;
        // Fecha ORIGINAL (no la de importacion)
        expect(e1.createdAt.toISOString()).toBe('2024-01-01T10:00:00.000Z');
        expect(e1).toMatchObject({ folder: 'inbox', read: false, starred: false, subject: 'Reunión de apertura' });
        expect(e1.labels.map((l) => l.name).sort()).toEqual(['Category Personal', 'Proyecto Alfa']);
        expect(e1.from).toContain('luis@remoto.test');
        expect(e2).toMatchObject({ folder: 'sent', read: true, starred: true, status: 'sent' });
        expect(e3).toMatchObject({ folder: 'trash' });
        // Contenido en storage real del correo (mismo esquema que la ingesta normal)
        const store = (await import('../mail-transfer/ingest'));
        expect(store.stripHtml('<p>a</p>')).toBe('a');
        expect(e1.htmlKey).toMatch(/^emails\/2024-01-01\/[0-9a-f-]+\/content\.html$/);
        expect((await storage.get(e1.textKey!))!.toString()).toContain('mañana');
    });

    it('idempotencia: reimportar el mismo archivo no duplica; Message-ID ya recibido tampoco', async () => {
        const u = await createUser(prisma, addr('bea'));
        const mbox = Buffer.from(fx('thunderbird-style.mbox').toString().replace(/bea@example\.test/g, addr('bea')));
        const first = await analyzeThenRun(mbox, 'tb.mbox', { targetMode: 'auto' });
        expect(first.job).toMatchObject({ importedItems: 2, duplicateItems: 0 });
        const second = await analyzeThenRun(mbox, 'tb.mbox', { targetMode: 'auto' });
        expect(second.job).toMatchObject({ importedItems: 0, duplicateItems: 2 });
        expect(await prisma.email.count({ where: { userId: u.id } })).toBe(2);
        const emails = await prisma.email.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'asc' }, include: { attachments: true, labels: true } });
        expect(emails[0]).toMatchObject({ read: true, starred: false, subject: 'Informe trimestral' });
        expect(emails[0].attachments).toHaveLength(1);
        expect(emails[0].attachments[0]).toMatchObject({ filename: 'nota.txt', status: 'ready' });
        expect((await storage.get(emails[0].attachments[0].key))!.toString()).toBe('Hola mundo');
        expect(emails[0].labels.map((l) => l.name)).toEqual(['Important']); // $label1
        expect(emails[1]).toMatchObject({ read: false, starred: true });
    });

    it('lotes minimos + reanudacion tras "caida": el cursor y las claves de origen evitan duplicados', async () => {
        const u = await createUser(prisma, addr('cy'));
        const raw = Buffer.concat(Array.from({ length: 12 }, (_, i) => mboxRecord('From x@y Mon Jan  1 00:00:00 2024', Buffer.from(
            `Message-ID: <lote-${tag}-${i}@remoto.test>\nDate: Mon, 01 Jan 2024 00:00:0${i % 10} +0000\nFrom: r@remoto.test\nTo: ${addr('cy')}\nDelivered-To: ${addr('cy')}\nSubject: n${i}\n\ncuerpo ${i}\n`))));
        const j = await newImport(storage, raw, 'lotes.mbox');
        const d = deps(storage, { maxItemsPerTick: 5 });
        await drain(j.id, d);
        await jobs.update(j.id, { status: 'queued', options: { targetMode: 'auto' } });
        // Un tick (5 mensajes) y "caida": se pierde el cursor persistido
        const t1 = await runImportTick(j.id, d);
        expect(t1).toMatchObject({ status: 'running', more: true, processed: 5 });
        const mid = (await jobs.get(j.id))!;
        expect(mid.importedItems).toBe(5);
        await jobs.update(j.id, { cursor: { ...mid.cursor, import: { entry: 0, offset: 0 } } });
        const fin = await drain(j.id, d);
        expect(fin.status).toBe('done');
        const job = (await jobs.get(j.id))!;
        expect(job.importedItems).toBe(12);
        expect(await prisma.email.count({ where: { userId: u.id } })).toBe(12);
        expect((await items.counts(j.id)).imported).toBe(12);
    });

    it('carreras: dos trabajos importando el mismo archivo a la vez no duplican (unicidad de messageId)', async () => {
        const u = await createUser(prisma, addr('dan'));
        const raw = Buffer.concat(Array.from({ length: 8 }, (_, i) => mboxRecord('From x@y Mon Jan  1 00:00:00 2024', Buffer.from(
            `Message-ID: <race-${tag}-${i}@r.test>\nDate: Mon, 01 Jan 2024 00:00:00 +0000\nFrom: r@r.test\nDelivered-To: ${addr('dan')}\nSubject: r${i}\n\nx\n`))));
        const [a, b] = await Promise.all([newImport(storage, raw, 'a.mbox'), newImport(storage, raw, 'b.mbox')]);
        const d = deps(storage);
        await Promise.all([drain(a.id, d), drain(b.id, d)]);
        await Promise.all([jobs.update(a.id, { status: 'queued', options: {} }), jobs.update(b.id, { status: 'queued', options: {} })]);
        await Promise.all([drain(a.id, d), drain(b.id, d)]);
        const [ja, jb] = [(await jobs.get(a.id))!, (await jobs.get(b.id))!];
        expect(ja.importedItems + jb.importedItems).toBe(8);
        expect(ja.duplicateItems + jb.duplicateItems).toBe(8);
        expect(ja.errorItems + jb.errorItems).toBe(0);
        expect(await prisma.email.count({ where: { userId: u.id } })).toBe(8);
    });

    it('ZIP: estructura buzon/Carpeta con EML sueltos, Maildir con banderas y rutas maliciosas ignoradas', async () => {
        const u = await createUser(prisma, addr('eva'));
        const eml = (id: string, extra = '') => strToU8(buildMime({ from: { email: 'x@remoto.test' }, to: [{ email: addr('eva') }], subject: `s-${id}`, date: new Date('2024-05-05T05:05:05Z'), messageId: `${id}-${tag}@r.test`, text: 'hola' }).toString('latin1') + extra);
        const zip = Buffer.from(zipSync({
            [`${addr('eva')}/Inbox/1.eml`]: eml('e1'),
            [`${addr('eva')}/Sent Items/2.eml`]: eml('e2'),
            [`${addr('eva')}/Clientes/Alfa/3.eml`]: eml('e3'),
            'Maildir/.Trash/cur/9999.abc:2,SF': eml('e4'),
            '../../fuera.eml': eml('evil'),
            'notas.txt': strToU8('nada'),
        }));
        const { job, ready } = await analyzeThenRun(zip, 'copia.zip', { targetMode: 'single', singleMailbox: addr('eva') });
        expect(ready.summary.skippedEntries).toMatchObject({ unsafe_path: 1 });
        expect(job).toMatchObject({ importedItems: 4, status: 'done' });
        const emails = await prisma.email.findMany({ where: { userId: u.id }, include: { labels: true } });
        const by: Record<string, (typeof emails)[number]> = Object.fromEntries(emails.map((e) => [e.subject ?? '', e]));
        expect(by['s-e1']).toMatchObject({ folder: 'inbox' });
        expect(by['s-e2']).toMatchObject({ folder: 'sent' });
        expect(by['s-e3']).toMatchObject({ folder: 'archive' });
        expect(by['s-e3'].labels.map((l) => l.name)).toEqual(['Clientes/Alfa']);
        expect(by['s-e4']).toMatchObject({ folder: 'trash', starred: true });
        expect(by['s-evil']).toBeUndefined();
    });

    it('gzip (.mbox.gz) se descomprime por trozos y se importa', async () => {
        const u = await createUser(prisma, addr('fay'));
        const mbox = mboxRecord('From x@y Mon Jan  1 00:00:00 2024', Buffer.from(`Message-ID: <gz-${tag}@r.test>\nDate: Mon, 01 Jan 2024 00:00:00 +0000\nFrom: r@r.test\nDelivered-To: ${addr('fay')}\nSubject: comprimido\n\nx\n`));
        const { job } = await analyzeThenRun(Buffer.from(gzipSync(mbox)), 'x.mbox.gz', { targetMode: 'auto' });
        expect(job).toMatchObject({ importedItems: 1, status: 'done' });
        expect(await prisma.email.count({ where: { userId: u.id } })).toBe(1);
    });

    it('buzones sin destino se omiten con motivo; mapa a otro buzon y descarte explicito', async () => {
        const dest = await createUser(prisma, addr('gus'));
        const raw = Buffer.concat([
            mboxRecord('From x@y Mon Jan  1 00:00:00 2024', Buffer.from(`Message-ID: <m1-${tag}@r.test>\nDelivered-To: viejo.${tag}@gmail.test\nSubject: a\n\nx\n`)),
            mboxRecord('From x@y Mon Jan  1 00:00:00 2024', Buffer.from(`Message-ID: <m2-${tag}@r.test>\nDelivered-To: otro.${tag}@gmail.test\nSubject: b\n\nx\n`)),
            mboxRecord('From x@y Mon Jan  1 00:00:00 2024', Buffer.from(`Message-ID: <m3-${tag}@r.test>\nSubject: sin buzon\n\nx\n`)),
        ]);
        const { job, ready } = await analyzeThenRun(raw, 'm.mbox', { mailboxMap: { [`viejo.${tag}@gmail.test`]: addr('gus'), [`otro.${tag}@gmail.test`]: null } });
        expect(ready.summary.unknownMailbox).toBe(1);
        expect(job).toMatchObject({ importedItems: 1, skippedItems: 2, errorItems: 0 });
        expect(await prisma.email.count({ where: { userId: dest.id } })).toBe(1);
        const errs = await prisma.$queryRawUnsafe<any[]>(`SELECT "error", COUNT(*)::int AS n FROM "MailTransferItem" WHERE "jobId" = $1 AND "status" = 'skipped' GROUP BY "error"`, job.id);
        expect(errs).toEqual([{ error: 'no_mailbox', n: 2 }]);
    });

    it('limites: mensaje demasiado grande y adjunto ejecutable bloqueado', async () => {
        const u = await createUser(prisma, addr('hal'));
        const big = mboxRecord('From x@y Mon Jan  1 00:00:00 2024', Buffer.from(`Message-ID: <big-${tag}@r.test>\nDelivered-To: ${addr('hal')}\nSubject: grande\n\n${'x'.repeat(3000)}\n`));
        const exe = mboxRecord('From x@y Mon Jan  1 00:00:00 2024', buildMime({
            from: { email: 'x@r.test' }, to: [{ email: addr('hal') }], subject: 'con exe', date: new Date('2024-01-02T00:00:00Z'), messageId: `exe-${tag}@r.test`, text: 't',
            attachments: [{ filename: 'setup.exe', contentType: 'application/octet-stream', content: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]) }],
        }));
        const { job } = await analyzeThenRun(Buffer.concat([big, exe]), 'l.mbox', { targetMode: 'auto' }, { maxMessageBytes: 2000 });
        // el primero supera 2000 bytes (error too_large); el segundo, pequeno, se importa con el adjunto BLOQUEADO
        expect(job.errorItems).toBe(1);
        const em = await prisma.email.findFirst({ where: { userId: u.id }, include: { attachments: true } });
        expect(em?.attachments[0]).toMatchObject({ status: 'failed', key: 'BLOCKED' });
        const err = await items.errors(job.id);
        expect(err[0].error).toBe('too_large');
    });

    it('cancelar: no importa mas, borra el almacenamiento y queda canceled', async () => {
        await createUser(prisma, addr('ian'));
        const raw = Buffer.concat(Array.from({ length: 30 }, (_, i) => mboxRecord('From x@y Mon Jan  1 00:00:00 2024', Buffer.from(`Message-ID: <c-${tag}-${i}@r.test>\nDelivered-To: ${addr('ian')}\nSubject: c${i}\n\nx\n`))));
        const j = await newImport(storage, raw, 'c.mbox');
        const d = deps(storage, { maxItemsPerTick: 10 });
        await drain(j.id, d);
        await jobs.update(j.id, { status: 'queued', options: { targetMode: 'auto' } });
        await runImportTick(j.id, d);
        await jobs.requestCancel(j.id);
        const r = await runImportTick(j.id, d);
        expect(r.status).toBe('canceled');
        expect((await jobs.get(j.id))!.status).toBe('canceled');
        expect(await storage.list(`${jobPrefix(j.id)}/`)).toHaveLength(0);
        expect((await jobs.get(j.id))!.importedItems).toBeLessThan(30);
    });

    it('archivo que no es correo: falla con codigo claro (sin detalles internos)', async () => {
        const j = await newImport(storage, Buffer.from('esto no es un archivo de correo, solo texto plano'), 'basura.txt');
        const r = await drain(j.id, deps(storage));
        expect(r.status).toBe('failed');
        expect((await jobs.get(j.id))!.lastError).toBe('unsupported_format');
    });

    it('propiedad estricta: otro administrador (o dominio) no ve el trabajo', async () => {
        const j = await newImport(storage, fx('takeout-style.mbox'), 'p.mbox');
        expect(await jobs.getOwned(j.id, { userId: `admin_${tag}`, domain: 'example.test' })).not.toBeNull();
        expect(await jobs.getOwned(j.id, { userId: 'otro_admin', domain: 'example.test' })).toBeNull();
        expect(await jobs.getOwned(j.id, { userId: `admin_${tag}`, domain: 'otra-instancia.test' })).toBeNull();
        const mine = await jobs.listOwned({ userId: `admin_${tag}`, domain: 'example.test' }, { limit: 50, offset: 0 });
        expect(mine.rows.some((r) => r.id === j.id)).toBe(true);
        expect((await jobs.listOwned({ userId: 'otro_admin', domain: 'example.test' }, { limit: 50, offset: 0 })).rows).toHaveLength(0);
    });
});

describe('store: bloqueo, items y descarga unica', () => {
    it('lock exclusivo, items idempotentes y claim de descarga una sola vez', async () => {
        const j = (await jobs.create({ userId: 'u', actorKind: 'user', domain: 'example.test', kind: 'export', scope: 'domain', status: 'running' }))!;
        const a = await jobs.lock(j.id, ['running'], 30_000);
        expect(a).not.toBeNull();
        expect(await jobs.lock(j.id, ['running'], 30_000)).toBeNull(); // bloqueado
        await jobs.unlock(j.id);
        expect(await jobs.lock(j.id, ['queued'], 30_000)).toBeNull(); // estado no permitido
        expect(await items.record({ jobId: j.id, mailbox: 'a@x', sourceKey: 'k1', status: 'error', error: 'x' })).toBe(true);
        expect(await items.record({ jobId: j.id, mailbox: 'a@x', sourceKey: 'k1', status: 'imported' })).toBe(true); // error -> reintento OK
        expect(await items.record({ jobId: j.id, mailbox: 'a@x', sourceKey: 'k1', status: 'duplicate' })).toBe(false); // definitivo
        expect((await items.get(j.id, 'k1'))!.status).toBe('imported');
        await jobs.update(j.id, { status: 'done' });
        expect(await jobs.claimDownload(j.id)).toBe(true);
        expect(await jobs.claimDownload(j.id)).toBe(false);
        await jobs.releaseDownload(j.id);
        expect(await jobs.claimDownload(j.id)).toBe(true);
        expect(uid('x')).toBeTruthy();
        expect(newJobId()).toMatch(/^mtj_/);
    });
});
