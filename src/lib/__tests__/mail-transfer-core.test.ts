import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { zipSync, gzipSync, strToU8 } from 'fflate';
import { MboxReader, bufferSource, escapeMboxrd, mboxRecord, unescapeMboxrd, type ByteSource } from '../mail-transfer/mbox';
import { decodeEncodedWords, parseAddressList, parseMailDate, parseMessage, parseParamHeader } from '../mail-transfer/mime-parse';
import { buildMime, encodeWord } from '../mail-transfer/mime-build';
import {
    decidePlacement, decideFromGmailLabels, detectFormat, detectMailbox, formatGmailLabels, interpretPath, mapFolderPath, parseGmailLabels, safeArchivePath,
} from '../mail-transfer/formats';
import { ArchiveError, buildZipEntry, buildZipEnd, crc32, extractZipEntry, readTarDirectory, readZipDirectory } from '../mail-transfer/zip';
import { PackageEncryptor, newEncryptionParams } from '../mail-transfer/package-crypto';
import { ChunkWriter, ChunkedSource, memoryStorage } from '../mail-transfer/source';
import { decryptBuffer } from '../../../scripts/bloomx-decrypt.mjs';

const fx = (n: string) => readFileSync(path.join(__dirname, 'fixtures', 'mail-transfer', n));

async function readAll(src: ByteSource, opts: ConstructorParameters<typeof MboxReader>[2] = {}) {
    const r = new MboxReader(src, 0, opts);
    const out = [];
    for (let m = await r.next(); m; m = await r.next()) out.push(m);
    return out;
}

/** ByteSource que sirve pocos bytes por lectura para probar los limites de bloque. */
function trickle(buf: Buffer, step: number): ByteSource {
    return { size: buf.length, read: async (o, l) => buf.subarray(o, Math.min(buf.length, o + Math.min(l, step))) };
}

describe('mbox: lector', () => {
    it('separa mensajes de un mbox estilo Takeout y desescapa ">From "', async () => {
        const msgs = await readAll(bufferSource(fx('takeout-style.mbox')));
        expect(msgs).toHaveLength(3);
        expect(msgs[0].fromLine).toMatch(/^From 1700000000000000001@xxx Mon Jan 01/);
        const m0 = parseMessage(msgs[0].raw);
        expect(m0.text).toContain('\nFrom aqui empieza una linea escapada.');
        expect(m0.subject).toBe('Reunión de apertura');
        expect(m0.from).toEqual({ name: 'Luis Pérez', email: 'luis@remoto.test' });
        expect(m0.html).toContain('<b>Ana</b>');
        expect(m0.text).toContain('mañana');
    });

    it('lee igual con bloques diminutos, CRLF y sin salto final', async () => {
        const base = fx('takeout-style.mbox');
        const a = await readAll(bufferSource(base));
        const crlf = Buffer.from(base.toString('utf8').replace(/\n/g, '\r\n'));
        const b = await readAll(trickle(crlf, 7), { blockSize: 7 });
        expect(b).toHaveLength(3);
        expect(b.map((m) => parseMessage(m.raw).messageId)).toEqual(a.map((m) => parseMessage(m.raw).messageId));
        const noEol = await readAll(bufferSource(base.subarray(0, base.length - 1)));
        expect(noEol).toHaveLength(3);
    });

    it('offsets de reanudacion: empezar en el offset del 2o mensaje devuelve del 2o al final', async () => {
        const src = bufferSource(fx('takeout-style.mbox'));
        const all = await readAll(src);
        const r = new MboxReader(src, all[1].offset);
        const first = await r.next();
        expect(first!.offset).toBe(all[1].offset);
        expect(parseMessage(first!.raw).messageId).toBe('takeout-2@example.test');
        expect((await r.next())!.offset).toBe(all[2].offset);
        expect(await r.next()).toBeNull();
    });

    it('un "From " dentro del cuerpo que no va seguido de cabecera no parte el mensaje (Thunderbird)', async () => {
        const msgs = await readAll(bufferSource(fx('thunderbird-style.mbox')));
        expect(msgs).toHaveLength(2);
        const m = parseMessage(msgs[0].raw);
        expect(m.text).toContain('From lo que sea');
        expect(m.subject).toBe('Informe trimestral');
        expect(m.attachments).toHaveLength(1);
        expect(m.attachments[0].content.toString()).toBe('Hola mundo');
        expect(m.text).toContain('María');
        expect(m.from!.name).toBe('Marta Muñoz');
    });

    it('lineas gigantes (2 MiB sin salto) y mensaje sobredimensionado se descartan sin acumular', async () => {
        const giant = 'x'.repeat(2 * 1024 * 1024);
        const raw = Buffer.from(`From a@b Mon Jan 01 00:00:00 2024\nMessage-ID: <big@x>\nSubject: big\n\n${giant}\n\nFrom c@d Mon Jan 01 00:00:00 2024\nMessage-ID: <small@x>\nSubject: small\n\nhola\n`);
        const msgs = await readAll(bufferSource(raw), { maxMessageBytes: 1024 * 1024, blockSize: 64 * 1024 });
        expect(msgs).toHaveLength(2);
        expect(msgs[0].oversize).toBe(true);
        expect(msgs[0].size).toBeGreaterThan(2 * 1024 * 1024);
        expect(msgs[0].raw.length).toBe(0);
        expect(parseMessage(msgs[1].raw).messageId).toBe('small@x');
    });

    it('modo cabeceras: conserva solo el principio de cada mensaje pero cuenta todos', async () => {
        const msgs = await readAll(bufferSource(fx('takeout-style.mbox')), { headBytes: 300 });
        expect(msgs).toHaveLength(3);
        for (const m of msgs) expect(m.raw.length).toBeLessThanOrEqual(300);
        expect(msgs[0].size).toBeGreaterThan(300);
    });

    it('un archivo sin "From " inicial se lee como un unico mensaje', async () => {
        const eml = Buffer.from('Message-ID: <solo@x>\nSubject: hola\n\ncuerpo\n');
        const msgs = await readAll(bufferSource(eml));
        expect(msgs).toHaveLength(1);
        expect(parseMessage(msgs[0].raw).subject).toBe('hola');
    });
});

describe('mboxrd: escape / desescape', () => {
    it('round-trip de lineas From_ con ninguno, uno y varios ">"', () => {
        const body = Buffer.from('Subject: x\n\nFrom a\n>From b\n>>From c\nFrom\nnormal >From\n');
        const esc = escapeMboxrd(body);
        expect(esc.toString()).toBe('Subject: x\n\n>From a\n>>From b\n>>>From c\nFrom\nnormal >From\n');
        expect(unescapeMboxrd(esc).toString()).toBe(body.toString());
    });
    it('un registro escapado se lee como un solo mensaje aunque el cuerpo tenga "From "', async () => {
        const raw = Buffer.from('Message-ID: <e@x>\r\nSubject: s\r\n\r\n\r\nFrom nadie@x Mon Jan 01 00:00:00 2024\r\nMessage-ID: <fake@x>\r\n');
        const rec = Buffer.concat([mboxRecord('From a@b Mon Jan  1 00:00:00 2024', raw), mboxRecord('From c@d Mon Jan  1 00:00:00 2024', Buffer.from('Message-ID: <e2@x>\n\nhola\n'))]);
        const msgs = await readAll(bufferSource(rec));
        expect(msgs).toHaveLength(2);
        expect(msgs[0].raw.toString()).toContain('From nadie@x');
        expect(parseMessage(msgs[1].raw).messageId).toBe('e2@x');
    });
});

describe('MIME: cabeceras, charsets y estructura', () => {
    it('decodifica RFC 2047 (B y Q, palabras adyacentes) y RFC 2231', () => {
        expect(decodeEncodedWords('=?UTF-8?B?w4FsdmFybw==?= =?UTF-8?Q?_P=C3=A9rez?=')).toBe('Álvaro Pérez');
        const p = parseParamHeader(`attachment; filename*0*=UTF-8''Informe%20; filename*1*=A%C3%B1o.pdf`);
        expect(p.params.filename).toBe('Informe Año.pdf');
    });
    it('direcciones con comas entre comillas, grupos y comentarios', () => {
        const l = parseAddressList('"Doe, John" <j@x.test>, ana@x.test (Ana), Grupo: a@y.test, b@y.test;');
        expect(l.map((a) => a.email)).toEqual(['j@x.test', 'ana@x.test', 'a@y.test', 'b@y.test']);
        expect(l[0].name).toBe('Doe, John');
        expect(l[1].name).toBe('Ana');
    });
    it('fechas RFC 2822 con zona, comentario y basura', () => {
        expect(parseMailDate('Mon, 01 Jan 2024 10:00:00 +0100 (CET)')!.toISOString()).toBe('2024-01-01T09:00:00.000Z');
        expect(parseMailDate('esto no es fecha')).toBeNull();
        expect(parseMailDate('Mon, 01 Jan 1900 00:00:00 +0000')).toBeNull();
    });
    it('cabeceras plegadas, charset windows-1252/iso-8859-1/latin y base64 con saltos', () => {
        const raw = Buffer.from([
            'Subject: uno',
            '\tdos',
            'Content-Type: text/plain; charset=windows-1252',
            'Content-Transfer-Encoding: base64',
            '',
            Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x80]).toString('base64').replace(/(.{4})/g, '$1\r\n'),
        ].join('\r\n'), 'latin1');
        const m = parseMessage(raw);
        expect(m.subject).toBe('uno dos');
        expect(m.text).toBe('café €');
    });
    it('charset desconocido cae a UTF-8 sin lanzar', () => {
        const m = parseMessage(Buffer.from('Content-Type: text/plain; charset=x-inexistente\r\n\r\nhola ñ'));
        expect(m.text).toBe('hola ñ');
    });
    it('multipart anidado: alternative + related con imagen cid + adjunto', () => {
        const b = buildMime({
            from: { name: 'Ana', email: 'ana@x.test' }, to: [{ email: 'b@x.test' }], subject: 'Adjuntos ñandú', date: new Date('2024-03-04T05:06:07Z'), messageId: 'm1@x.test',
            text: 'texto', html: '<img src="cid:logo@x"><p>hola</p>',
            attachments: [
                { filename: 'logo.png', contentType: 'image/png', content: Buffer.from([1, 2, 3, 4]), contentId: 'logo@x', inline: true },
                { filename: 'Informe ñ.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF-1.4 x') },
            ],
        });
        const m = parseMessage(b);
        expect(m.text).toBe('texto');
        expect(m.html).toContain('cid:logo@x');
        expect(m.attachments.map((a) => a.filename).sort()).toEqual(['Informe ñ.pdf', 'logo.png']);
        const logo = m.attachments.find((a) => a.filename === 'logo.png')!;
        expect(logo.contentId).toBe('logo@x');
        expect(logo.inline).toBe(true);
        expect(logo.content).toEqual(Buffer.from([1, 2, 3, 4]));
        expect(m.subject).toBe('Adjuntos ñandú');
        expect(m.date!.toISOString()).toBe('2024-03-04T05:06:07.000Z');
    });
    it('limites: demasiados adjuntos y profundidad', () => {
        const atts = Array.from({ length: 8 }, (_, i) => ({ filename: `f${i}.txt`, contentType: 'text/plain', content: Buffer.from('x' + i), inline: false }));
        const b = buildMime({ from: { email: 'a@x.test' }, to: [{ email: 'b@x.test' }], subject: 's', date: new Date(), text: 't', attachments: atts });
        const m = parseMessage(b, { maxAttachments: 3 });
        expect(m.attachments).toHaveLength(3);
        expect(m.droppedAttachments).toBe(5);
    });
    it('cabeceras con inyeccion CRLF se sanean al construir', () => {
        const b = buildMime({ from: { name: 'Eve\r\nBcc: victima@x.test', email: 'e@x.test' }, to: [{ email: 'b@x.test' }], subject: 'hola\r\nBcc: v@x.test', date: new Date(), text: 't' });
        const head = b.toString('latin1').split('\r\n\r\n')[0];
        expect(head).not.toMatch(/^Bcc:/im);
        expect(encodeWord('ñ'.repeat(100)).split(' ').every((w) => w.length <= 75)).toBe(true);
    });
});

describe('Gmail labels, carpetas y banderas', () => {
    it('X-Gmail-Labels con comillas y RFC 2047', () => {
        expect(parseGmailLabels('Inbox,"Cliente, Alfa",=?UTF-8?Q?Facturaci=C3=B3n?=,Unread')).toEqual(['Inbox', 'Cliente, Alfa', 'Facturación', 'Unread']);
        expect(formatGmailLabels(['Inbox', 'Cliente, Alfa'])).toBe('Inbox,"Cliente, Alfa"');
    });
    it('Takeout -> carpeta, etiquetas y banderas', () => {
        const d = decideFromGmailLabels(['Inbox', 'Unread', 'Starred', 'Category Personal', 'Proyecto Alfa']);
        expect(d).toMatchObject({ folder: 'inbox', starred: true, unread: true });
        expect(d.userLabels).toEqual(['Category Personal', 'Proyecto Alfa']);
        expect(decideFromGmailLabels(['Trash', 'Inbox']).folder).toBe('trash');
        expect(decideFromGmailLabels(['Spam']).folder).toBe('spam');
        expect(decideFromGmailLabels(['Enviados']).folder).toBe('sent');
        expect(decideFromGmailLabels(['Etiqueta suelta']).folder).toBe('archive');
        expect(decideFromGmailLabels(['Drafts'])).toMatchObject({ folder: 'archive', drafts: true });
    });
    it('decidePlacement: prioridad X-Bloomx-Folder > Gmail > banderas > ruta, y lectura/destacado', () => {
        expect(decidePlacement({ 'x-bloomx-folder': ['sent'], 'x-gmail-labels': ['Inbox'], 'x-bloomx-flags': ['read,starred'] })).toMatchObject({ folder: 'sent', read: true, starred: true });
        expect(decidePlacement({ 'x-gmail-labels': ['Inbox,Unread'] })).toMatchObject({ folder: 'inbox', read: false });
        expect(decidePlacement({ 'x-mozilla-status': ['0001'], 'x-mozilla-keys': ['$label1 Cliente'] })).toMatchObject({ read: true, labels: ['Important', 'Cliente'] });
        expect(decidePlacement({ status: ['O'], 'x-status': ['FA'] })).toMatchObject({ read: false, starred: true });
        expect(decidePlacement({ 'x-mozilla-status': ['0008'] })).toMatchObject({ folder: 'trash', previousFolder: 'inbox' });
        expect(decidePlacement({}, ['Bandeja de entrada', 'Clientes'])).toMatchObject({ folder: 'inbox', labels: ['Clientes'] });
        expect(decidePlacement({}, ['Mis cosas', 'Q1'])).toMatchObject({ folder: 'archive', labels: ['Mis cosas/Q1'] });
        expect(decidePlacement({})).toMatchObject({ folder: 'inbox', read: true, starred: false, labels: [] });
    });
    it('mapFolderPath entiende Outlook, Gmail, IMAP y Maildir++', () => {
        expect(mapFolderPath('[Gmail]/Sent Mail')).toMatchObject({ folder: 'sent' });
        expect(mapFolderPath('Elementos eliminados')).toMatchObject({ folder: 'trash' });
        expect(mapFolderPath('Junk Email')).toMatchObject({ folder: 'spam' });
        expect(mapFolderPath('.Sent')).toMatchObject({ folder: 'sent' });
        expect(mapFolderPath('INBOX.Clientes')).toMatchObject({ folder: 'inbox', label: 'Clientes' });
        expect(mapFolderPath('Borradores')).toMatchObject({ folder: 'archive', drafts: true });
    });
});

describe('deteccion de formato por contenido y buzon de destino', () => {
    it('detecta por magic bytes, no por extension', () => {
        expect(detectFormat(fx('takeout-style.mbox'), 'renombrado.txt').format).toBe('mbox');
        expect(detectFormat(Buffer.from('Received: x\r\nFrom: a@b\r\nSubject: s\r\n\r\nhi'), 'algo.bin').format).toBe('eml');
        expect(detectFormat(Buffer.from([0x50, 0x4b, 3, 4, 0, 0]), 'x.mbox').format).toBe('zip');
        expect(detectFormat(Buffer.from([0x1f, 0x8b, 8, 0]), 'x').format).toBe('gzip');
        expect(detectFormat(Buffer.concat([Buffer.from('!BDN'), Buffer.alloc(600)]), 'x.txt').format).toBe('pst');
        expect(detectFormat(Buffer.from('BLMXENC1xxxx'), 'x').format).toBe('bloomx-encrypted');
        expect(detectFormat(Buffer.from('hola mundo, esto es texto'), 'x.eml').format).toBe('unknown');
        expect(detectFormat(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0, 0]), 'x.msg').format).toBe('msg');
    });
    it('interpretPath: buzon/carpeta, Maildir con banderas, Apple Mail', () => {
        expect(interpretPath('ana@example.test/Inbox/1.eml')).toMatchObject({ kind: 'eml', mailbox: 'ana@example.test', folder: ['Inbox'] });
        expect(interpretPath('Maildir/.Sent/cur/1699:2,RS')).toMatchObject({ kind: 'maildir', folder: ['.Sent'], maildirFlags: { read: true, starred: false } });
        expect(interpretPath('Takeout/Mail/Proyecto.mbox')).toMatchObject({ kind: 'mbox', folder: ['Proyecto'] });
        expect(interpretPath('Bandeja.mbox/mbox')).toMatchObject({ kind: 'mbox', folder: ['Bandeja'] });
    });
    it('detectMailbox prefiere cabeceras de entrega, luego dominio de la instancia', () => {
        const isOwn = (a: string) => a.endsWith('@example.test');
        const d = (headers: Record<string, string[]>, to: string[], folder: any = 'inbox', from = 'x@remoto.test') =>
            detectMailbox({ headers, from: { name: '', email: from }, to: to.map((e) => ({ name: '', email: e })), cc: [], folder, isInstanceAddress: isOwn });
        expect(d({ 'delivered-to': ['ana@gmail.test'] }, ['colega@example.test']).address).toBe('ana@gmail.test');
        expect(d({}, ['otro@remoto.test', 'bea@example.test']).address).toBe('bea@example.test');
        expect(d({}, ['t@remoto.test'], 'sent', 'ana@example.test').address).toBe('ana@example.test');
        expect(d({ 'x-bloomx-mailbox': ['zed@example.test'], 'delivered-to': ['a@b.test'] }, []).address).toBe('zed@example.test');
        expect(d({}, [], 'inbox', '').address).toBeNull();
    });
});

describe('ZIP / TAR / gzip: lectura segura', () => {
    const src = (b: Uint8Array): ByteSource => bufferSource(Buffer.from(b));

    it('lee el directorio central y extrae (stored y deflate) verificando CRC', async () => {
        const z = zipSync({ 'ana@example.test/Inbox/1.eml': strToU8('Subject: uno\r\n\r\nhola'), 'nota.txt': [strToU8('a'.repeat(5000)), { level: 6 }] });
        const dir = await readZipDirectory(src(z));
        expect(dir.map((e) => e.path).sort()).toEqual(['ana@example.test/Inbox/1.eml', 'nota.txt']);
        const chunks: Buffer[] = [];
        const e = dir.find((x) => x.path === 'nota.txt')!;
        const r = await extractZipEntry(src(z), e, async (c) => { chunks.push(Buffer.from(c)); });
        expect(r.bytes).toBe(5000);
        expect(Buffer.concat(chunks).toString()).toBe('a'.repeat(5000));
    });

    it('zip-slip: rutas con "..", absolutas, unidad y NUL se omiten (nunca se extraen)', async () => {
        const evil = ['../../etc/passwd', '/abs/x.eml', 'C:\\Windows\\x.eml', 'a/../../b.eml', 'ok\0.eml', 'dir\\..\\..\\x.eml'];
        for (const n of evil) expect(safeArchivePath(n)).toBeNull();
        expect(safeArchivePath('a\\b/c.eml')).toBe('a/b/c.eml');
        const files: Record<string, Uint8Array> = {};
        for (const n of ['../../etc/passwd', '/abs/x.eml', 'bien/x.eml']) files[n] = strToU8('Subject: x\r\n\r\ny');
        const dir = await readZipDirectory(src(zipSync(files)));
        const byName = Object.fromEntries(dir.map((e) => [e.rawName, e.skip]));
        expect(byName['../../etc/passwd']).toBe('unsafe_path');
        expect(byName['/abs/x.eml']).toBe('unsafe_path');
        expect(byName['bien/x.eml']).toBeNull();
    });

    it('zip-bomb: razon de compresion desproporcionada se rechaza antes de inflar; el conteo real tambien manda', async () => {
        const bomb = zipSync({ 'a.mbox': [new Uint8Array(20 * 1024 * 1024), { level: 9 }] });
        const dir = await readZipDirectory(src(bomb));
        expect(dir[0].skip).toBe('bomb_ratio');
        await expect(extractZipEntry(src(bomb), dir[0], async () => undefined)).rejects.toBeInstanceOf(ArchiveError);
        // Cabecera que MIENTE sobre el tamano (declara 100 bytes, infla 2 MiB): aborta por conteo real
        const honest = zipSync({ 'b.mbox': [new Uint8Array(2 * 1024 * 1024).fill(97), { level: 9 }] });
        const liar = Buffer.from(honest);
        const cd = liar.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
        liar.writeUInt32LE(100, cd + 24); // tamano sin comprimir declarado en el directorio central
        const dir2 = await readZipDirectory(src(liar), { maxRatio: 1e9 });
        await expect(extractZipEntry(src(liar), dir2[0], async () => undefined)).rejects.toMatchObject({ code: 'zip_bomb' });
        // limite de entradas y de total declarado
        await expect(readZipDirectory(src(zipSync({ 'a.eml': strToU8('x'), 'b.eml': strToU8('y') })), { maxEntries: 1 })).rejects.toMatchObject({ code: 'zip_too_many_entries' });
    });

    it('enlaces simbolicos y entradas cifradas se omiten', async () => {
        const z = Buffer.from(zipSync({ 'link.eml': strToU8('/etc/passwd') }));
        const cd = z.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
        z.writeUInt16LE((3 << 8) | 20, cd + 4);
        z.writeUInt32LE((0o120777 << 16) >>> 0, cd + 38);
        expect((await readZipDirectory(src(z)))[0].skip).toBe('symlink');
        const enc = Buffer.from(zipSync({ 'x.eml': strToU8('hola') }));
        const cd2 = enc.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
        enc.writeUInt16LE(1, cd2 + 8);
        expect((await readZipDirectory(src(enc)))[0].skip).toBe('encrypted');
    });

    it('escritor propio: entradas + directorio central + EOCD se leen con nuestro lector y con fflate', async () => {
        let off = 0;
        const parts: Buffer[] = [];
        const cd: Buffer[] = [];
        for (const [name, body] of [['a/uno.eml', 'x'.repeat(1000)], ['dos.txt', 'corto']] as const) {
            const e = buildZipEntry(name, Buffer.from(body), off);
            parts.push(e.local); cd.push(e.central); off += e.local.length;
        }
        const cdBuf = Buffer.concat(cd);
        const zip = Buffer.concat([...parts, cdBuf, buildZipEnd(2, cdBuf.length, off)]);
        const dir = await readZipDirectory(bufferSource(zip));
        expect(dir.map((e) => e.path)).toEqual(['a/uno.eml', 'dos.txt']);
        const { unzipSync } = await import('fflate');
        expect(Buffer.from(unzipSync(new Uint8Array(zip))['dos.txt']).toString()).toBe('corto');
        expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    });

    it('tar: ignora enlaces y rutas peligrosas', async () => {
        const hdr = (name: string, size: number, type = '0') => {
            const h = Buffer.alloc(512);
            h.write(name, 0);
            h.write(size.toString(8).padStart(11, '0') + '\0', 124, 'latin1');
            h.write(type, 156);
            h.write('ustar\0', 257);
            return h;
        };
        const data = (s: string) => Buffer.concat([Buffer.from(s), Buffer.alloc(512 - (s.length % 512 || 512))]);
        const tar = Buffer.concat([hdr('ok/1.eml', 5), data('hello'), hdr('../mal.eml', 3), data('abc'), hdr('ln', 0, '2'), Buffer.alloc(1024)]);
        const dir = await readTarDirectory(bufferSource(tar));
        expect(dir.map((e) => [e.rawName, e.skip])).toEqual([['ok/1.eml', null], ['../mal.eml', 'unsafe_path'], ['ln', 'symlink']]);
    });

    it('gzip valido se detecta', () => {
        expect(detectFormat(Buffer.from(gzipSync(strToU8('From a@b Mon Jan 01 00:00:00 2024\nX: y\n\nz'))), 'a.mbox.gz').format).toBe('gzip');
    });
});

describe('storage por trozos', () => {
    it('ChunkWriter + ChunkedSource: escritura reanudable con cola y lectura por rangos', async () => {
        const st = memoryStorage();
        const data = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
        const w1 = new ChunkWriter(st, 'p/x', undefined, 256);
        await w1.write(data.subarray(0, 300));
        await w1.flushTail();
        const w2 = new ChunkWriter(st, 'p/x', w1.state(), 256);
        await w2.resume();
        await w2.write(data.subarray(300));
        const total = await w2.finish();
        expect(total).toBe(1000);
        const src = new ChunkedSource(st, 'p/x', total, 256);
        expect((await src.read(250, 20)).equals(data.subarray(250, 270))).toBe(true);
        expect((await src.read(0, 5000)).equals(data)).toBe(true);
        expect((await src.read(990, 100)).equals(data.subarray(990))).toBe(true);
    });
});

describe('cifrado del paquete', () => {
    it('round-trip con la herramienta independiente, deteccion de manipulacion y truncado', () => {
        const params = newEncryptionParams('correcto caballo bateria grapa');
        const enc = new PackageEncryptor(params);
        const plain = Buffer.alloc(2_500_000, 7);
        const file = Buffer.concat([enc.header, enc.encrypt(plain.subarray(0, 1_000_000)), enc.encrypt(plain.subarray(1_000_000)), enc.finalRecord()]);
        expect(decryptBuffer(file, 'correcto caballo bateria grapa').equals(plain)).toBe(true);
        expect(() => decryptBuffer(file, 'otra contrasena distinta')).toThrow();
        const tampered = Buffer.from(file); tampered[tampered.length - 40] ^= 1;
        expect(() => decryptBuffer(tampered, 'correcto caballo bateria grapa')).toThrow();
        // truncado: sin el registro final
        const finalLen = 4 + 16;
        expect(() => decryptBuffer(file.subarray(0, file.length - finalLen), 'correcto caballo bateria grapa')).toThrow(/truncado/);
        // reordenar registros falla (contador en el nonce)
        expect(() => decryptBuffer(Buffer.concat([file.subarray(0, 37), file.subarray(37 + 4 + 1048576 + 16 + 0)]), 'correcto caballo bateria grapa')).toThrow();
    });
});
