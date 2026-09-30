import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { assertLocalPg, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';
import { items, jobs, type JobRow } from '../mail-transfer/store';
import { memoryStorage, CHUNK_SIZE, chunkName, ChunkedSource } from '../mail-transfer/source';
import { defaultEngineDeps, runImportTick, type EngineDeps } from '../mail-transfer/import-engine';
import { runExportTick, type ExportOptions } from '../mail-transfer/export-engine';
import { transferLimits, jobPrefix } from '../mail-transfer/limits';
import { MboxReader, bufferSource, mboxRecord } from '../mail-transfer/mbox';
import { parseMessage } from '../mail-transfer/mime-parse';
import { encrypt } from '../encryption';
import { deleteEmailsCompletely } from '../retention';
import { getBufferFromStorage, uploadToStorage } from '../storage';
import { buildZip, makeTextBlock } from './helpers/zip-fixtures';

const tag = `f${Math.random().toString(36).slice(2, 8)}`;
const addr = (n: string) => `${n}.${tag}@example.test`;
type Mem = ReturnType<typeof memoryStorage>;

beforeAll(() => {
    assertLocalPg();
    process.env.TOP_DOMAIN = 'example.test';
    process.env.NEXT_PUBLIC_APP_URL = 'https://mail.example.test';
});
afterAll(async () => { await prisma.$disconnect(); });

const mkDeps = (storage: Mem, over: Partial<EngineDeps['limits']> = {}, extra: Partial<EngineDeps> = {}): EngineDeps =>
    defaultEngineDeps({ storage, limits: { ...transferLimits(), ...over }, ...extra });

async function drainExport(id: string, deps: EngineDeps) {
    for (let i = 0; i < 300; i++) { const r = await runExportTick(id, deps); if (!r.more) return r; }
    throw new Error('no termina');
}
async function drainImport(id: string, deps: EngineDeps, max = 400) {
    let last;
    for (let i = 0; i < max; i++) { last = await runImportTick(id, deps); if (!last.more) break; }
    return last!;
}
async function newExport(mailbox: string, over: Partial<ExportOptions> = {}): Promise<JobRow> {
    const opts: ExportOptions = { scopeMode: 'one', mailboxes: [mailbox], folders: [], includeAttachments: true, format: 'mbox', oneTime: true, ...over };
    return (await jobs.create({ userId: `adm_${tag}`, actorKind: 'user', domain: 'example.test', kind: 'export', scope: 'mailboxes', status: 'queued', format: opts.format, options: opts as any }))!;
}
async function readZip(storage: Mem, job: JobRow) {
    const out = await new ChunkedSource(storage, `${jobPrefix(job.id)}/out`, job.outputBytes).read(0, job.outputBytes);
    return unzipSync(new Uint8Array(out));
}
async function newImport(storage: Mem, buf: Buffer, fileName: string, options: Record<string, unknown> = {}): Promise<JobRow> {
    const j = (await jobs.create({ userId: `adm_${tag}`, actorKind: 'user', domain: 'example.test', kind: 'import', scope: 'domain', status: 'analyzing', fileName, totalBytes: buf.length, options }))!;
    for (let i = 0, o = 0; o < buf.length; i++, o += CHUNK_SIZE) await storage.put(`${jobPrefix(j.id)}/src/${chunkName(i)}`, buf.subarray(o, o + CHUNK_SIZE));
    return j;
}
async function firstMbox(files: Record<string, Uint8Array>, name: string) {
    return parseMessage((await new MboxReader(bufferSource(Buffer.from(files[name]))).next())!.raw);
}

describe('MIME original al exportar (raw.eml / rawMimeUrl)', () => {
    it('prefiere raw.eml (cabeceras exactas), cae a rawMimeUrl y luego a la reconstruccion; sin adjuntos reconstruye', async () => {
        const storage = memoryStorage();
        const email = addr('raw');
        const u = await createUser(prisma, email);
        const original = (id: string) => Buffer.from(
            `Received: from mx.remoto.test (mx.remoto.test [203.0.113.9]) by mail.example.test; Tue, 05 Mar 2024 10:00:00 +0000\r\nAuthentication-Results: mail.example.test; dkim=pass header.d=remoto.test; spf=pass\r\n` +
            `DKIM-Signature: v=1; a=rsa-sha256; d=remoto.test; s=k1; b=AAAA\r\nFrom: Luis <luis@remoto.test>\r\nTo: ${email}\r\nSubject: original ${id}\r\nMessage-ID: <orig-${id}@remoto.test>\r\nDate: Tue, 05 Mar 2024 09:59:00 +0000\r\n\r\ncuerpo exacto ${id}\r\n`);
        const mk = async (id: string, withEml: boolean, rawMimeUrl: string | null) => {
            const base = `emails/2024-03-05/${uid('e')}`;
            await storage.put(`${base}/raw.json`, Buffer.from(JSON.stringify({ data: { headers: {} } })));
            if (withEml) await storage.put(`${base}/raw.eml`, original(id));
            await storage.put(`${base}/content.txt`, Buffer.from(`reconstruido ${id}`));
            return prisma.email.create({ data: { userId: u.id, messageId: `${uid('m')}-${u.id}`, from: 'luis@remoto.test', to: email, subject: `s-${id}`, textKey: `${base}/content.txt`, rawKey: `${base}/raw.json`, rawMimeUrl, createdAt: new Date('2024-03-05T10:00:00Z'), read: false } });
        };
        await mk('stored', true, null);
        await mk('url', false, 'https://raw.remoto.test/x?sig=1');
        await mk('rebuilt', false, null);
        await mk('urlfail', false, 'https://raw.remoto.test/dead');
        const calls: string[] = [];
        const fetchRaw = async (url: string) => { calls.push(url); return url.includes('dead') ? null : original('url'); };
        const j = await newExport(email, { format: 'eml' });
        expect((await drainExport(j.id, mkDeps(storage, {}, { fetchRaw }))).status).toBe('done');
        const done = (await jobs.get(j.id))!;
        expect(done.summary.mime).toEqual({ stored: 1, url: 1, rebuilt: 2 });
        expect(calls.sort()).toEqual(['https://raw.remoto.test/dead', 'https://raw.remoto.test/x?sig=1']);
        const files = await readZip(storage, done);
        const byName = Object.entries(files).filter(([k]) => k.endsWith('.eml')).map(([, v]) => Buffer.from(v).toString('latin1'));
        const stored = byName.find((t) => t.includes('cuerpo exacto stored'))!;
        expect(stored).toContain('Received: from mx.remoto.test');
        expect(stored).toContain('Authentication-Results: mail.example.test; dkim=pass');
        expect(stored).toContain('DKIM-Signature: v=1; a=rsa-sha256; d=remoto.test; s=k1; b=AAAA');
        expect(stored).toContain('X-Bloomx-Folder: inbox');
        expect(stored).toContain('X-Bloomx-Flags: unread');
        expect(byName.filter((t) => t.includes('Authentication-Results')).length).toBe(2); // stored + url
        expect(byName.filter((t) => t.includes('Subject: s-rebuilt') || t.includes('Subject: s-urlfail')).length).toBe(2);

        // includeAttachments=false: se reconstruye siempre
        const j2 = await newExport(email, { format: 'eml', includeAttachments: false });
        await drainExport(j2.id, mkDeps(storage, {}, { fetchRaw }));
        expect((await jobs.get(j2.id))!.summary.mime).toEqual({ stored: 0, url: 0, rebuilt: 4 });
    });

    it('retencion: el borrado completo elimina raw.json Y raw.eml, y no borra raw.eml si otro destinatario aun lo usa', async () => {
        const a = await createUser(prisma, addr('ra'));
        const b = await createUser(prisma, addr('rb'));
        const base = `emails/2024-04-01/${uid('r')}`;
        await uploadToStorage(`${base}/raw.json`, Buffer.from('{}'), 'application/json');
        await uploadToStorage(`${base}/raw.eml`, Buffer.from('Subject: x\r\n\r\ny'), 'message/rfc822');
        const mk = (uId: string) => prisma.email.create({ data: { userId: uId, messageId: `${uid('m')}-${uId}`, from: 'x@r.test', to: 'y@example.test', rawKey: `${base}/raw.json` }, select: { id: true } });
        const ea = await mk(a.id);
        const eb = await mk(b.id);
        await deleteEmailsCompletely([ea.id]);
        expect(await getBufferFromStorage(`${base}/raw.eml`)).not.toBeNull();
        expect(await getBufferFromStorage(`${base}/raw.json`)).not.toBeNull();
        await deleteEmailsCompletely([eb.id]);
        expect(await getBufferFromStorage(`${base}/raw.eml`)).toBeNull();
        expect(await getBufferFromStorage(`${base}/raw.json`)).toBeNull();
    });
});

describe('borradores', () => {
    it('exporta los Draft propios a Drafts.mbox (X-Bloomx-Draft) e importa a la tabla Draft del usuario correcto; reimportar no duplica', async () => {
        const storage = memoryStorage();
        const src = addr('dsrc');
        const dst = addr('ddst');
        const u = await createUser(prisma, src);
        const other = await createUser(prisma, addr('dother'));
        const dest = await createUser(prisma, dst);
        const key = `attachments/${src}/${uid('a')}-nota.txt`;
        await storage.put(key, Buffer.from('adjunto del borrador'));
        await prisma.draft.create({ data: { from: src, to: 'cli@remoto.test', cc: 'cc@remoto.test', subject: 'Borrador ñ', body: '<p>Texto <b>html</b></p>', attachments: { create: [{ filename: 'nota.txt', mimeType: 'text/plain', size: 20, key, status: 'ready' }] } } });
        await prisma.draft.create({ data: { from: other.email, subject: 'AJENO', body: '<p>no</p>' } });
        const j = await newExport(src);
        expect((await drainExport(j.id, mkDeps(storage))).status).toBe('done');
        const files = await readZip(storage, (await jobs.get(j.id))!);
        expect(Object.keys(files)).toContain(`${src}/Drafts.mbox`);
        const p = await firstMbox(files, `${src}/Drafts.mbox`);
        expect(p.headers['x-bloomx-draft'][0]).toBe('1');
        expect(p.subject).toBe('Borrador ñ');
        expect(p.attachments[0].filename).toBe('nota.txt');
        expect(Buffer.from(files[`${src}/Drafts.mbox`]).toString('latin1')).not.toContain('AJENO');
        // Import al otro buzon (el paquete se sube tal cual)
        const zip = Buffer.from(zipSync(files));
        for (let round = 0; round < 2; round++) {
            const ij = await newImport(storage, zip, 'export.zip');
            const d = mkDeps(storage);
            expect((await drainImport(ij.id, d)).status).toBe('ready');
            await jobs.update(ij.id, { status: 'queued', options: { targetMode: 'single', singleMailbox: dst } });
            expect((await drainImport(ij.id, d)).status).toBe('done');
            const job = (await jobs.get(ij.id))!;
            expect(job).toMatchObject(round === 0 ? { importedItems: 1 } : { duplicateItems: 1 });
        }
        const drafts = await prisma.draft.findMany({ where: { from: dst }, include: { attachments: true } });
        expect(drafts).toHaveLength(1);
        expect(drafts[0]).toMatchObject({ subject: 'Borrador ñ', to: expect.stringContaining('cli@remoto.test') });
        expect(drafts[0].body).toContain('<b>html</b>');
        expect(drafts[0].attachments[0].key.startsWith(`attachments/${dst}/`)).toBe(true);
        expect((await storage.get(drafts[0].attachments[0].key))!.toString()).toBe('adjunto del borrador');
        expect(await prisma.email.count({ where: { userId: dest.id } })).toBe(0); // no se colo como correo
    });

    it('Gmail: la etiqueta Drafts va a la tabla Draft, no a Archivo', async () => {
        const storage = memoryStorage();
        const email = addr('gdr');
        const u = await createUser(prisma, email);
        const raw = mboxRecord('From x@y Mon Jan  1 00:00:00 2024', Buffer.from(`Message-ID: <gd-${tag}@r.test>\nDate: Mon, 01 Jan 2024 00:00:00 +0000\nFrom: ${email}\nTo: cli@remoto.test\nSubject: borrador gmail\nX-Gmail-Labels: Drafts\nDelivered-To: ${email}\n\ncuerpo plano\n`));
        const ij = await newImport(storage, raw, 'Borradores.mbox');
        const d = mkDeps(storage);
        await drainImport(ij.id, d);
        await jobs.update(ij.id, { status: 'queued', options: { targetMode: 'auto' } });
        expect((await drainImport(ij.id, d)).status).toBe('done');
        expect(await prisma.email.count({ where: { userId: u.id } })).toBe(0);
        const dr = await prisma.draft.findMany({ where: { from: email } });
        expect(dr).toHaveLength(1);
        expect(dr[0].body).toContain('cuerpo plano');
    });
});

describe('ZIP con contrasena', () => {
    const eml = (id: string, to: string) => Buffer.from(`From: r@remoto.test\nTo: ${to}\nSubject: cifrado ${id}\nMessage-ID: <zp-${id}-${tag}@r.test>\nDate: Mon, 01 Jan 2024 00:00:00 +0000\n\nhola ${id}\n`);

    it('sin contrasena el trabajo espera (uploaded + passwordRequired); con la contrasena se expande cifrado, se BORRA de las opciones y se importa', async () => {
        const storage = memoryStorage();
        const email = addr('zp');
        const u = await createUser(prisma, email);
        const zip = buildZip([
            { name: `${email}/Inbox/1.eml`, data: eml('1', email), password: 'Clave-Zip-9!', kind: 'aes256' },
            { name: `${email}/Inbox/2.eml`, data: eml('2', email), password: 'Clave-Zip-9!', kind: 'zipcrypto' },
            { name: `${email}/Inbox/3.eml`, data: eml('3', email) },
        ]);
        const j = await newImport(storage, zip, 'cifrado.zip');
        const d = mkDeps(storage);
        const r = await drainImport(j.id, d);
        expect(r.status).toBe('uploaded');
        const waiting = (await jobs.get(j.id))!;
        expect(waiting.summary).toMatchObject({ passwordRequired: true, encryptedEntries: 2 });
        // Contrasena incorrecta durante la expansion -> fallo definitivo con codigo claro
        const bad = await newImport(storage, zip, 'cifrado.zip', { zipPw: encrypt('mala-mala-1') });
        expect((await drainImport(bad.id, d)).status).toBe('failed');
        expect((await jobs.get(bad.id))!.lastError).toBe('zip_wrong_password');
        expect((await jobs.get(bad.id))!.options.zipPw).toBeUndefined();
        // Contrasena correcta
        await jobs.update(j.id, { status: 'analyzing', options: { zipPw: encrypt('Clave-Zip-9!') } });
        expect((await drainImport(j.id, d)).status).toBe('ready');
        const ready = (await jobs.get(j.id))!;
        expect(ready.options.zipPw).toBeUndefined();
        expect(ready.summary).toMatchObject({ messages: 3 });
        await jobs.update(j.id, { status: 'queued', options: { targetMode: 'auto' } });
        expect((await drainImport(j.id, d)).status).toBe('done');
        expect((await jobs.get(j.id))).toMatchObject({ importedItems: 3 });
        expect(await prisma.email.count({ where: { userId: u.id } })).toBe(3);
        expect(await storage.list(`${jobPrefix(j.id)}/`)).toHaveLength(0);
    });

    it('"continuar sin las entradas cifradas": importa solo las que no lo estan', async () => {
        const storage = memoryStorage();
        const email = addr('zs');
        const u = await createUser(prisma, email);
        const zip = buildZip([{ name: `${email}/Inbox/1.eml`, data: eml('s1', email), password: 'x-y-z-123', kind: 'aes128' }, { name: `${email}/Inbox/2.eml`, data: eml('s2', email) }]);
        const j = await newImport(storage, zip, 'c.zip', { zipSkipEncrypted: true });
        const d = mkDeps(storage);
        expect((await drainImport(j.id, d)).status).toBe('ready');
        expect((await jobs.get(j.id))!.summary).toMatchObject({ messages: 1, skippedEntries: { encrypted: 1 } });
        await jobs.update(j.id, { status: 'queued', options: { targetMode: 'auto' } });
        await drainImport(j.id, d);
        expect(await prisma.email.count({ where: { userId: u.id } })).toBe(1);
    });
});

describe('formatos Apple / Outlook Mac, contactos, calendario y filtros dentro de un ZIP', () => {
    it('emlx (con DOCTYPE de Apple), olm sintetico, vcf, ics y mailFilters.xml -> correo, contactos, eventos y reglas; filtros no mapeables en el informe', async () => {
        const storage = memoryStorage();
        const email = addr('pim');
        const u = await createUser(prisma, email);
        const plist = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>flags</key><integer>17</integer></dict></plist>\n';
        const rfc = `From: Ana <ana@remoto.test>\nTo: ${email}\nSubject: Desde Apple Mail\nDate: Tue, 05 May 2020 10:00:00 +0000\nMessage-ID: <apple-${tag}@remoto.test>\n\ncuerpo apple\n`;
        const olm = `<emails><email><OPFMessageCopyMessageID>&lt;olm-${tag}@example.com&gt;</OPFMessageCopyMessageID><OPFMessageCopySubject>Desde Outlook Mac</OPFMessageCopySubject><OPFMessageCopyFromAddresses><emailAddress OPFContactEmailAddressAddress="bob@remoto.test"/></OPFMessageCopyFromAddresses><OPFMessageCopyToAddresses><emailAddress OPFContactEmailAddressAddress="${email}"/></OPFMessageCopyToAddresses><OPFMessageCopyBody>cuerpo olm</OPFMessageCopyBody><OPFMessageCopySentTime>2020-05-06T10:00:00</OPFMessageCopySentTime><OPFMessageGetIsRead>0</OPFMessageGetIsRead></email></emails>`;
        const vcf = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Carla Ruiz\r\nEMAIL:carla@remoto.test\r\nTEL:+34 600 111 222\r\nORG:Acme\r\nNOTE:nota\r\nEND:VCARD\r\n';
        const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//t//\r\nBEGIN:VEVENT\r\nUID:ev1@t\r\nDTSTART;TZID=Europe/Madrid:20240610T100000\r\nDTEND;TZID=Europe/Madrid:20240610T110000\r\nSUMMARY:Reunion\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nATTENDEE;CN=Ana:mailto:ana@remoto.test\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
        const filters = `<?xml version='1.0' encoding='UTF-8'?><feed xmlns='http://www.w3.org/2005/Atom' xmlns:apps='http://schemas.google.com/apps/2006'><title>Mail Filters</title>` +
            `<entry><category term='filter'/><apps:property name='from' value='facturas@proveedor.test'/><apps:property name='label' value='Facturas'/><apps:property name='shouldMarkAsRead' value='true'/></entry>` +
            `<entry><category term='filter'/><apps:property name='subject' value='reenviar'/><apps:property name='forwardTo' value='otro@ext.test'/></entry></feed>`;
        const zip = Buffer.from(zipSync({
            [`${email}/Mail/Bandeja.mbox/Messages/1.emlx`]: new Uint8Array(Buffer.from(`${Buffer.byteLength(rfc)}\n${rfc}${plist}`)),
            'Local/com.microsoft.__Messages/Inbox/message_00001.xml': strToU8(olm),
            'Takeout/Contactos/Todos.vcf': strToU8(vcf),
            'Takeout/Calendar/Personal.ics': strToU8(ics),
            'Takeout/Mail/mailFilters.xml': strToU8(filters),
        }));
        const j = await newImport(storage, zip, 'todo.zip');
        const d = mkDeps(storage);
        expect((await drainImport(j.id, d)).status).toBe('ready');
        const ready = (await jobs.get(j.id))!;
        expect(ready.summary).toMatchObject({ messages: 2, pim: { contacts: 1, calendar: 1, filters: 1 } });
        await jobs.update(j.id, { status: 'queued', options: { targetMode: 'single', singleMailbox: email } });
        expect((await drainImport(j.id, d)).status).toBe('done');

        const emails = await prisma.email.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'asc' } });
        expect(emails.map((e) => e.subject)).toEqual(['Desde Apple Mail', 'Desde Outlook Mac']);
        expect(emails[0]).toMatchObject({ read: true, starred: true }); // flags Apple 17 = leido + marcado
        expect(emails[1]).toMatchObject({ read: false });
        const contacts = await prisma.contact.findMany({ where: { userId: u.id } });
        expect(contacts.map((c) => c.email)).toEqual(['carla@remoto.test']);
        expect(contacts[0].notes).toContain('+34 600 111 222');
        const events = await prisma.calendarEvent.findMany({ where: { userId: u.id }, orderBy: { startsAt: 'asc' } });
        expect(events.length).toBeGreaterThanOrEqual(3); // ocurrencias expandidas de la RRULE
        expect(events[0].startsAt.toISOString()).toBe('2024-06-10T08:00:00.000Z'); // Europe/Madrid verano = UTC+2
        const rules = await prisma.rule.findMany({ where: { userId: u.id } });
        expect(rules).toHaveLength(1);
        const rep = await items.page(j.id, 0, 100);
        const unmapped = rep.filter((r) => r.error === 'filter_unmapped');
        expect(unmapped).toHaveLength(1);
        expect(unmapped[0].messageId).toMatch(/forward|reenv/i);

        // Exportar de vuelta: contactos, calendario y filtros van dentro del ZIP por buzon
        const ej = await newExport(email);
        expect((await drainExport(ej.id, mkDeps(storage))).status).toBe('done');
        const ejob = (await jobs.get(ej.id))!;
        const files = await readZip(storage, ejob);
        expect(Object.keys(files)).toEqual(expect.arrayContaining([`${email}/contacts.vcf`, `${email}/calendar.ics`, `${email}/mailFilters.xml`]));
        expect(Buffer.from(files[`${email}/contacts.vcf`]).toString()).toContain('VERSION:4.0');
        expect(ejob.summary.pim).toMatchObject({ [email]: { contacts: true, calendar: true, filters: true } });
    });

    it('.emlx suelto se importa con sus banderas', async () => {
        const storage = memoryStorage();
        const email = addr('emx');
        const u = await createUser(prisma, email);
        const rfc = `From: Ana <ana@remoto.test>\nTo: ${email}\nSubject: emlx suelto\nMessage-ID: <emx-${tag}@remoto.test>\nDate: Tue, 05 May 2020 10:00:00 +0000\n\nx\n`;
        const buf = Buffer.from(`${Buffer.byteLength(rfc)}\n${rfc}<?xml version="1.0"?><plist version="1.0"><dict><key>flags</key><integer>1</integer></dict></plist>`);
        const j = await newImport(storage, buf, '123.emlx');
        const d = mkDeps(storage);
        expect((await drainImport(j.id, d)).status).toBe('ready');
        await jobs.update(j.id, { status: 'queued', options: { targetMode: 'auto' } });
        await drainImport(j.id, d);
        expect(await prisma.email.findFirst({ where: { userId: u.id } })).toMatchObject({ subject: 'emlx suelto', read: true });
    });
});

describe('fase de extraccion dentro del motor', () => {
    it('entrada deflate de 24 MB con presupuesto minimo: varios ticks de extraccion (re-inflado del prefijo), sin perder ni duplicar mensajes', async () => {
        const storage = memoryStorage();
        const email = addr('big');
        const u = await createUser(prisma, email);
        const one = (i: number) => mboxRecord('From x@y Mon Jan  1 00:00:00 2024', Buffer.concat([
            Buffer.from(`Message-ID: <big-${i}-${tag}@r.test>\nDate: Mon, 01 Jan 2024 00:00:00 +0000\nFrom: r@r.test\nDelivered-To: ${email}\nSubject: m${i}\n\n`), makeTextBlock(i, 100_000), Buffer.from('\n')]));
        const mbox = Buffer.concat(Array.from({ length: 240 }, (_, i) => one(i)));
        expect(mbox.length).toBeGreaterThan(20 * 1024 * 1024);
        const zip = buildZip([{ name: 'Takeout/Mail/Todo.mbox', data: mbox }]);
        const j = await newImport(storage, zip, 'big.zip');
        const d = mkDeps(storage, { budgetMs: 1 });
        let ticks = 0;
        let last;
        for (; ticks < 3000; ticks++) { last = await runImportTick(j.id, d); if (!last.more) break; }
        expect(last!.status).toBe('ready');
        const ready = (await jobs.get(j.id))!;
        expect(ready.summary).toMatchObject({ messages: 240 });
        expect((ready.cursor as any).expandStats.replayedBytes).toBeGreaterThan(0);
        expect((ready.cursor as any).expandStats.writtenBytes).toBe(mbox.length);
        await jobs.update(j.id, { status: 'queued', options: { targetMode: 'auto' } });
        await drainImport(j.id, mkDeps(storage, { maxItemsPerTick: 100 }));
        expect(await prisma.email.count({ where: { userId: u.id } })).toBe(240);
    }, 180_000);
});
