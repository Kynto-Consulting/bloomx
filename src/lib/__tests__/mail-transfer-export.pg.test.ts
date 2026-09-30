import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { assertLocalPg, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';
import { jobs, items, type JobRow } from '../mail-transfer/store';
import { memoryStorage, CHUNK_SIZE, chunkName, ChunkedSource } from '../mail-transfer/source';
import { defaultEngineDeps, runImportTick, type EngineDeps } from '../mail-transfer/import-engine';
import { runExportTick, type ExportOptions } from '../mail-transfer/export-engine';
import { transferLimits, jobPrefix } from '../mail-transfer/limits';
import { newEncryptionParams } from '../mail-transfer/package-crypto';
import { encrypt } from '../encryption';
import { MboxReader, bufferSource } from '../mail-transfer/mbox';
import { parseMessage } from '../mail-transfer/mime-parse';
// @ts-ignore herramienta .mjs sin tipos
import { decryptBuffer } from '../../../scripts/bloomx-decrypt.mjs';

const tag = `x${Math.random().toString(36).slice(2, 8)}`;
const addr = (n: string) => `${n}.${tag}@example.test`;

beforeAll(() => {
    assertLocalPg();
    process.env.TOP_DOMAIN = 'example.test';
});
afterAll(async () => { await prisma.$disconnect(); });

const mkDeps = (storage: ReturnType<typeof memoryStorage>, over: Partial<EngineDeps['limits']> = {}): EngineDeps =>
    defaultEngineDeps({ storage, limits: { ...transferLimits(), ...over } });

async function drainExport(id: string, deps: EngineDeps) {
    for (let i = 0; i < 300; i++) {
        const r = await runExportTick(id, deps);
        if (!r.more) return r;
    }
    throw new Error('no termina');
}
async function drainImport(id: string, deps: EngineDeps) {
    for (let i = 0; i < 300; i++) {
        const r = await runImportTick(id, deps);
        if (!r.more) return r;
    }
    throw new Error('no termina');
}

async function readOutput(storage: ReturnType<typeof memoryStorage>, job: JobRow): Promise<Buffer> {
    return new ChunkedSource(storage, `${jobPrefix(job.id)}/out`, job.outputBytes).read(0, job.outputBytes);
}

async function seedMailbox(storage: ReturnType<typeof memoryStorage>, email: string) {
    const u = await createUser(prisma, email);
    const put = async (key: string, body: string | Buffer, type = 'text/plain') => { await storage.put(key, Buffer.from(body), type); return key; };
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 7) % 256))]);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const mk = async (over: Record<string, unknown>, dir: string, html?: string, text?: string, atts: Array<{ filename: string; mimeType: string; buf: Buffer; contentId?: string }> = []) => {
        const base = `emails/2024-02-0${(Math.random() * 9) | 0}/${uid('e')}`;
        const created = await prisma.email.create({
            data: {
                userId: u.id, messageId: `${uid('mid')}-${u.id}`, from: 'Luis Pérez <luis@remoto.test>', to: email, subject: 'x', read: true,
                htmlKey: html ? await put(`${base}/content.html`, html, 'text/html') : null,
                textKey: text ? await put(`${base}/content.txt`, text) : null,
                rawKey: await put(`${base}/raw.json`, JSON.stringify({ data: { headers: { 'in-reply-to': '<prev@remoto.test>' } } }), 'application/json'),
                ...(over as object),
                attachments: { create: await Promise.all(atts.map(async (a) => ({ filename: a.filename, mimeType: a.mimeType, size: a.buf.length, key: await put(`${base}/attachments/${a.filename}`, a.buf), status: 'ready' }))) },
            },
            select: { id: true },
        });
        for (const a of atts) if (a.contentId) await prisma.$executeRawUnsafe(`UPDATE "Attachment" SET "contentId" = $1 WHERE "emailId" = $2 AND "filename" = $3`, a.contentId, created.id, a.filename);
        void dir;
        return created.id;
    };
    const label = await prisma.label.create({ data: { userId: u.id, name: 'Cliente, Alfa' } });
    const e1 = await mk({ subject: 'Propuesta año nuevo', createdAt: new Date('2024-02-01T10:00:00Z'), folder: 'inbox', read: false, starred: true, labels: { connect: [{ id: label.id }] } }, 'in',
        '<p>Hola <img src="cid:logo@x"></p>', 'Hola', [{ filename: 'logo.png', mimeType: 'image/png', buf: png, contentId: 'logo@x' }, { filename: 'Propuesta ñ.pdf', mimeType: 'application/pdf', buf: pdf }]);
    const e2 = await mk({ subject: 'From: linea que empieza asi', createdAt: new Date('2024-02-02T11:00:00Z'), folder: 'sent', from: email, to: 'luis@remoto.test', cc: 'copia@remoto.test' }, 'sent', undefined, 'Cuerpo\nFrom aqui\n>From alla\nfin');
    const e3 = await mk({ subject: 'A la papelera', createdAt: new Date('2024-02-03T12:00:00Z'), folder: 'trash', read: true }, 'trash', '<b>bye</b>', 'bye');
    return { user: u, ids: [e1, e2, e3], label };
}

describe('exportar (Postgres real)', () => {
    it('MBOX ZIP: un mbox por buzon y carpeta, manifest con sha256, cabeceras de carpeta/etiquetas/banderas; round-trip a otro buzon y reimportacion sin duplicados', async () => {
        const storage = memoryStorage();
        const a = await seedMailbox(storage, addr('ana'));
        const opts: ExportOptions = { scopeMode: 'one', mailboxes: [addr('ana')], folders: [], includeAttachments: true, format: 'mbox', oneTime: true };
        const j = (await jobs.create({ userId: `adm_${tag}`, actorKind: 'user', domain: 'example.test', kind: 'export', scope: 'mailboxes', status: 'queued', format: 'mbox', options: opts as any }))!;
        const deps = mkDeps(storage);
        const r = await drainExport(j.id, deps);
        expect(r.status).toBe('done');
        const job = (await jobs.get(j.id))!;
        expect(job.status).toBe('done');
        expect(job.outputBytes).toBeGreaterThan(1000);
        expect(job.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);
        const out = await readOutput(storage, job);
        expect(createHash('sha256').update(out).digest('hex')).toBe(job.outputSha256);

        const files = unzipSync(new Uint8Array(out));
        expect(Object.keys(files).sort()).toEqual([`${addr('ana')}/Inbox.mbox`, `${addr('ana')}/Sent.mbox`, `${addr('ana')}/Trash.mbox`, 'manifest.json']);
        const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString());
        expect(manifest).toMatchObject({ version: 1, format: 'mbox', totals: { mailboxes: 1, messages: 3 } });
        expect(manifest.mailboxes[0]).toMatchObject({ mailbox: addr('ana'), messages: 3, folders: { inbox: 1, sent: 1, trash: 1 } });
        for (const f of manifest.files) expect(createHash('sha256').update(files[f.path]).digest('hex')).toBe(f.sha256);
        expect(manifest.files).toHaveLength(3);

        // cabeceras que conservan carpeta, etiquetas y banderas
        const inbox = Buffer.from(files[`${addr('ana')}/Inbox.mbox`]);
        const m0 = await new MboxReader(bufferSource(inbox)).next();
        const p0 = parseMessage(m0!.raw);
        expect(p0.headers['x-gmail-labels'][0]).toBe('Inbox,Starred,Unread,"Cliente, Alfa"');
        expect(p0.headers['status'][0]).toBe('O');
        expect(p0.headers['x-status'][0]).toBe('F');
        expect(p0.headers['x-bloomx-folder'][0]).toBe('inbox');
        expect(p0.headers['x-bloomx-flags'][0]).toBe('unread,starred');
        expect(p0.subject).toBe('Propuesta año nuevo');
        expect(p0.date!.toISOString()).toBe('2024-02-01T10:00:00.000Z');
        expect(p0.attachments.map((x) => x.filename).sort()).toEqual(['Propuesta ñ.pdf', 'logo.png']);
        expect(p0.attachments.find((x) => x.filename === 'logo.png')!.contentId).toBe('logo@x');
        expect(p0.inReplyTo).toBe('prev@remoto.test');

        // ---- round-trip: importar el paquete en OTRO buzon
        const c = await createUser(prisma, addr('carla'));
        const imp = (await jobs.create({ userId: `adm_${tag}`, actorKind: 'user', domain: 'example.test', kind: 'import', scope: 'domain', status: 'analyzing', fileName: 'export.zip', totalBytes: out.length }))!;
        for (let i = 0, o = 0; o < out.length; i++, o += CHUNK_SIZE) await storage.put(`${jobPrefix(imp.id)}/src/${chunkName(i)}`, out.subarray(o, o + CHUNK_SIZE));
        expect((await drainImport(imp.id, deps)).status).toBe('ready');
        const ready = (await jobs.get(imp.id))!;
        expect(ready.summary).toMatchObject({ messages: 3, folders: { inbox: 1, sent: 1, trash: 1 } });
        expect(ready.summary.mailboxes).toEqual([{ address: addr('ana'), count: 3 }]);
        await jobs.update(imp.id, { status: 'queued', options: { mailboxMap: { [addr('ana')]: addr('carla') } } });
        expect((await drainImport(imp.id, deps)).status).toBe('done');
        expect((await jobs.get(imp.id))!).toMatchObject({ importedItems: 3, errorItems: 0 });

        const cmp = async (userId: string) => (await prisma.email.findMany({ where: { userId }, orderBy: { createdAt: 'asc' }, include: { labels: true, attachments: true } }))
            .map((e) => ({ subject: e.subject, folder: e.folder, read: e.read, starred: e.starred, createdAt: e.createdAt.toISOString(), labels: e.labels.map((l) => l.name).sort(), att: e.attachments.map((x) => x.filename).sort(), cc: e.cc }));
        expect(await cmp(c.id)).toEqual(await cmp(a.user.id));
        // El contenido de los adjuntos se conserva byte a byte
        const orig = await prisma.attachment.findMany({ where: { email: { userId: a.user.id }, filename: 'Propuesta ñ.pdf' } });
        const copy = await prisma.attachment.findMany({ where: { email: { userId: c.id }, filename: 'Propuesta ñ.pdf' } });
        expect((await storage.get(copy[0].key))!.equals((await storage.get(orig[0].key))!)).toBe(true);
        // y el cuerpo con "From " / ">From " escapados sobrevive
        const sent = await prisma.email.findFirst({ where: { userId: c.id, folder: 'sent' } });
        expect((await storage.get(sent!.textKey!))!.toString().replace(/\r\n/g, '\n')).toBe('Cuerpo\nFrom aqui\n>From alla\nfin');

        // ---- reimportar en el buzon ORIGEN: el Message-ID ya existe -> duplicados, nada nuevo
        const imp2 = (await jobs.create({ userId: `adm_${tag}`, actorKind: 'user', domain: 'example.test', kind: 'import', scope: 'domain', status: 'analyzing', fileName: 'export.zip', totalBytes: out.length }))!;
        for (let i = 0, o = 0; o < out.length; i++, o += CHUNK_SIZE) await storage.put(`${jobPrefix(imp2.id)}/src/${chunkName(i)}`, out.subarray(o, o + CHUNK_SIZE));
        await drainImport(imp2.id, deps);
        await jobs.update(imp2.id, { status: 'queued', options: { targetMode: 'auto' } });
        await drainImport(imp2.id, deps);
        expect((await jobs.get(imp2.id))!).toMatchObject({ importedItems: 0, duplicateItems: 3 });
        expect(await prisma.email.count({ where: { userId: a.user.id } })).toBe(3);
    });

    it('EML ZIP + filtros (carpeta, rango de fechas, sin adjuntos) + reanudacion por lotes identica a una sola pasada', async () => {
        const storage = memoryStorage();
        const a = await seedMailbox(storage, addr('bea'));
        const base: ExportOptions = { scopeMode: 'one', mailboxes: [addr('bea')], folders: [], from: '2024-02-01T00:00:00.000Z', to: '2024-02-02T23:59:59.000Z', includeAttachments: false, format: 'eml', oneTime: true };
        const run = async (over: Partial<EngineDeps['limits']>, crash = false) => {
            const j = (await jobs.create({ userId: `adm_${tag}`, actorKind: 'user', domain: 'example.test', kind: 'export', scope: 'mailboxes', status: 'queued', options: base as any }))!;
            const d = mkDeps(storage, over);
            if (crash) {
                await runExportTick(j.id, d);
                const mid = (await jobs.get(j.id))!;
                const before = new Map(storage.objects);
                await runExportTick(j.id, d); // avanza otro lote escribiendo salida...
                // ...y el proceso "se cae" antes de guardar el cursor y de borrar las colas anteriores
                for (const [k, v] of before) if (!storage.objects.has(k)) storage.objects.set(k, v);
                await jobs.update(j.id, { cursor: mid.cursor });
            }
            await drainExport(j.id, d);
            const job = (await jobs.get(j.id))!;
            return unzipSync(new Uint8Array(await readOutput(storage, job)));
        };
        const one = await run({});
        const names = Object.keys(one).filter((n) => n !== 'manifest.json');
        expect(names).toHaveLength(2); // e1 (inbox) y e2 (sent) dentro del rango; e3 (trash, 3 feb) fuera
        expect(names.every((n) => /^bea\./.test(n) && n.endsWith('.eml') && /\/(Inbox|Sent)\/\d{8}-\d{6}_/.test(n))).toBe(true);
        const p = parseMessage(Buffer.from(one[names.find((n) => n.includes('/Inbox/'))!]));
        expect(p.attachments).toHaveLength(0); // includeAttachments=false
        expect(p.html).toContain('cid:logo@x');
        const stepped = await run({ maxItemsPerTick: 1 }, true);
        const strip = (f: Record<string, Uint8Array>) => Object.fromEntries(Object.entries(f).filter(([n]) => n !== 'manifest.json').map(([n, v]) => [n, createHash('sha256').update(v).digest('hex')]));
        expect(strip(stepped)).toEqual(strip(one));
        const mf = JSON.parse(Buffer.from(stepped['manifest.json']).toString());
        expect(mf.files.map((f: any) => f.path).sort()).toEqual(names.sort());
        void a;
    });

    it('paquete cifrado: solo se abre con la contrasena y la herramienta independiente; el material de cifrado se borra al terminar', async () => {
        const storage = memoryStorage();
        await seedMailbox(storage, addr('cris'));
        const pw = 'una contrasena bien larga 123';
        const p = newEncryptionParams(pw);
        const base: ExportOptions = {
            scopeMode: 'one', mailboxes: [addr('cris')], folders: ['inbox'], includeAttachments: true, format: 'mbox', encrypted: true, oneTime: true,
            enc: { salt: p.salt.toString('hex'), noncePrefix: p.noncePrefix.toString('hex'), keyEnc: encrypt(p.key.toString('hex')) },
        };
        const j = (await jobs.create({ userId: `adm_${tag}`, actorKind: 'user', domain: 'example.test', kind: 'export', scope: 'mailboxes', status: 'queued', options: base as any }))!;
        await drainExport(j.id, mkDeps(storage, { maxItemsPerTick: 1 }));
        const job = (await jobs.get(j.id))!;
        expect((job.options as any).enc.keyEnc).toBe('');
        const out = await readOutput(storage, job);
        expect(out.subarray(0, 8).toString()).toBe('BLMXENC1');
        expect(() => unzipSync(new Uint8Array(out))).toThrow();
        expect(() => decryptBuffer(out, 'contrasena equivocada!')).toThrow();
        const zip = decryptBuffer(out, pw);
        const files = unzipSync(new Uint8Array(zip));
        expect(Object.keys(files).sort()).toEqual([`${addr('cris')}/Inbox.mbox`, 'manifest.json']);
        expect(createHash('sha256').update(out).digest('hex')).toBe(job.outputSha256);
    });

    it('dominio completo: solo buzones del dominio, informe por buzon y limpieza de temporales', async () => {
        const storage = memoryStorage();
        const u1 = await createUser(prisma, addr('dom1'));
        const u2 = await createUser(prisma, addr('dom2'));
        await prisma.email.create({ data: { userId: u1.id, messageId: uid('m'), from: 'a@r.test', to: addr('dom1'), subject: 'solo texto', snippet: 'hola', folder: 'inbox' } });
        const j = (await jobs.create({ userId: `adm_${tag}`, actorKind: 'user', domain: 'example.test', kind: 'export', scope: 'domain', status: 'queued', options: { scopeMode: 'domain', mailboxes: [addr('dom1'), addr('dom2')], folders: [], includeAttachments: true, format: 'mbox' } as any }))!;
        await items.record({ jobId: j.id, mailbox: addr('dom1'), sourceKey: `mbx:${addr('dom1')}`, status: 'pending' });
        await items.record({ jobId: j.id, mailbox: addr('dom2'), sourceKey: `mbx:${addr('dom2')}`, status: 'pending' });
        await drainExport(j.id, mkDeps(storage));
        const job = (await jobs.get(j.id))!;
        const files = unzipSync(new Uint8Array(await readOutput(storage, job)));
        expect(Object.keys(files).sort()).toEqual([`${addr('dom1')}/Inbox.mbox`, 'manifest.json']);
        expect((await items.counts(j.id)).done).toBe(2);
        // solo quedan los trozos del paquete final (`out`)
        const left = await storage.list(`${jobPrefix(j.id)}/`);
        expect(left.every((o) => o.key.startsWith(`${jobPrefix(j.id)}/out`))).toBe(true);
        expect(u2.id).toBeTruthy();
    });
});
