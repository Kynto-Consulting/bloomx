/**
 * Formatos adicionales del importador: Apple Mail (.emlx), Outlook (.msg) y Outlook para Mac (.olm).
 *
 * - .emlx: fixtures construidas a mano segun el formato documentado (longitud + RFC822 + plist).
 * - .msg: NO hay .msg reales en el repositorio; se genera un CFB (OLE2) real con el escritor `burn` que trae
 *   @kenjiuno/msgreader (v3, sectores de 512, FAT/miniFAT, directorio) y se rellena con propiedades MAPI
 *   (__properties_version1.0, __substg1.0_XXXXTTTT, __recip_version1.0_#N, __attach_version1.0_#N), tal y como
 *   describe MS-OXMSG. Se valida que msgreader lo lee y que el MIME resultante se analiza con parseMessage.
 * - .olm: NO hay .olm reales; se construye un ZIP SINTETICO (fflate) con la estructura documentada por las herramientas
 *   publicas. Valida contra esa estructura, no contra un .olm real de Outlook.
 */
import { describe, expect, it } from 'vitest';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { burn } from '@kenjiuno/msgreader/lib/Burner';
import { emlxToRfc822, looksLikeEmlx, parseEmlx } from '../mail-transfer/emlx';
import { decompressRtf, isMsgFile, looksLikeMsg, msgToMime, rtfExtract } from '../mail-transfer/msg';
import { isOlmMessagePath, normalizeOlmAttachmentUrl, olmFolderOf, olmMessageToMime } from '../mail-transfer/olm';
import { decidePlacement, detectFormat } from '../mail-transfer/formats';
import { headersToRecord, parseHeaderBlock, parseMessage } from '../mail-transfer/mime-parse';

// ---------------------------------------------------------------------------------------------------------------------
// .emlx
// ---------------------------------------------------------------------------------------------------------------------

const RFC = 'From: Ana <ana@example.com>\nTo: yo@example.com\nSubject: Hola emlx\nDate: Tue, 05 May 2020 10:00:00 +0000\nMessage-ID: <e1@example.com>\n\ncuerpo\n';
const plist = (flags: number, extra = '') =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n\t<key>conversation-id</key>\n\t<integer>12</integer>\n\t<key>date-received</key>\n\t<integer>1588672800</integer>\n\t<key>date-sent</key>\n\t<real>1588672795.0</real>\n\t<key>flags</key>\n\t<integer>${flags}</integer>\n${extra}</dict>\n</plist>\n`;
const emlx = (raw: string, pl: string, declared = Buffer.byteLength(raw)) => Buffer.from(`${declared}\n${raw}${pl}`, 'utf8');

describe('emlx (Apple Mail)', () => {
    it('lee longitud, mensaje exacto, banderas, fechas y etiquetas; el DOCTYPE de Apple no bloquea el plist', () => {
        const p = parseEmlx(emlx(RFC, plist(8590195713 + 20 /* 0x200000000 | leido | marcado | respondido... */, '\t<key>labels</key>\n\t<array><string>Clientes</string><string>Urgente</string></array>\n')))!;
        expect(p).not.toBeNull();
        expect(p.raw.toString('utf8')).toBe(RFC);
        expect(p.flags).toEqual({ read: true, flagged: true, answered: true, deleted: false, draft: false });
        expect(p.dateReceived?.toISOString()).toBe('2020-05-05T10:00:00.000Z');
        expect(p.dateSent?.getTime()).toBe(1588672795000);
        expect(p.labels).toEqual(['Clientes', 'Urgente']);
        expect(p.partial).toBe(false);
        expect(p.warnings).toEqual([]);
    });

    it('no leido / borrado / borrador y emlxToRfc822 los traduce a cabeceras que entiende decidePlacement', () => {
        const unread = parseEmlx(emlx(RFC, plist(0)))!;
        expect(unread.flags.read).toBe(false);
        const rfc = emlxToRfc822(unread);
        expect(rfc.toString('utf8').startsWith('Status: O\nX-Bloomx-Flags: unread\n')).toBe(true);
        expect(rfc.subarray(rfc.length - RFC.length).toString('utf8')).toBe(RFC);
        const rec = (b: Buffer) => headersToRecord(parseHeaderBlock(b.toString('utf8').split('\n\n')[0]));
        const pl1 = decidePlacement(rec(rfc));
        expect(pl1.read).toBe(false);
        expect(pl1.folder).toBe('inbox');

        const del = parseEmlx(emlx(RFC, plist(1 | 2 | 16)))!;
        expect(del.flags).toMatchObject({ read: true, deleted: true, flagged: true });
        const pl2 = decidePlacement(rec(emlxToRfc822(del)));
        expect(pl2.folder).toBe('trash');
        expect(pl2.starred).toBe(true);
        expect(pl2.read).toBe(true);
        expect(parseEmlx(emlx(RFC, plist(64)))!.flags.draft).toBe(true);
    });

    it('no duplica cabeceras ya presentes y conserva CRLF', () => {
        const raw = 'Status: RO\r\nX-Status: F\r\nX-Bloomx-Flags: read\r\nDate: Tue, 05 May 2020 10:00:00 +0000\r\nSubject: x\r\n\r\nb\r\n';
        const out = emlxToRfc822(parseEmlx(emlx(raw, plist(1 | 16)))!);
        expect(out.toString('utf8')).toBe(raw);
        const raw2 = 'Subject: y\r\n\r\nb\r\n';
        const out2 = emlxToRfc822(parseEmlx(emlx(raw2, plist(1)))!).toString('utf8');
        expect(out2.startsWith('Status: RO\r\nX-Bloomx-Flags: read\r\nDate: ')).toBe(true);
        expect((out2.match(/^Status:/gm) ?? []).length).toBe(1);
    });

    it('.partial.emlx, longitud inconsistente, plist ausente/hostil y basura', () => {
        expect(parseEmlx(emlx(RFC, plist(1)), { filename: 'Messages/12.partial.emlx' })!.partial).toBe(true);
        const longer = parseEmlx(emlx(RFC, plist(1), Buffer.byteLength(RFC) + 5000))!;
        expect(longer.warnings).toContain('emlx_length_exceeds_file');
        expect(longer.raw.length).toBeGreaterThan(Buffer.byteLength(RFC) - 1);
        const shorter = parseEmlx(emlx(RFC, plist(1), 20))!;
        expect(shorter.raw.length).toBe(20);
        const none = parseEmlx(Buffer.from(`${Buffer.byteLength(RFC)}\n${RFC}`))!;
        expect(none.flags.read).toBe(true);
        expect(none.raw.toString('utf8')).toBe(RFC);
        // DOCTYPE con entidades internas: se rechaza el plist, el mensaje se importa igualmente
        const evil = `<?xml version="1.0"?>\n<!DOCTYPE plist [<!ENTITY x "boom">]>\n<plist><dict><key>flags</key><integer>2</integer></dict></plist>`;
        const e = parseEmlx(emlx(RFC, evil))!;
        expect(e.warnings).toContain('emlx_plist_rejected_doctype');
        expect(e.flags.deleted).toBe(false);
        expect(parseEmlx(Buffer.from('nada'))).toBeNull();
        expect(parseEmlx(Buffer.from('12x\nabc'))).toBeNull();
        expect(parseEmlx(Buffer.alloc(0))).toBeNull();
        expect(parseEmlx(Buffer.from('0\n'))).toBeNull();
    });

    it('looksLikeEmlx', () => {
        expect(looksLikeEmlx(emlx(RFC, plist(1)).subarray(0, 512), 'x')).toBe(true);
        expect(looksLikeEmlx(Buffer.from('123\nzzzz'), 'a.emlx')).toBe(true);
        expect(looksLikeEmlx(Buffer.from('123\nzzzz'), 'a.txt')).toBe(false);
        expect(looksLikeEmlx(Buffer.from(RFC), '')).toBe(false);
        expect(detectFormat(emlx(RFC, plist(1)), 'a.emlx').format).toBe('unknown');
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// .msg: escritor CFB de prueba (msgreader `burn`) + propiedades MAPI
// ---------------------------------------------------------------------------------------------------------------------

interface Node { name: string; data?: Buffer; children?: Node[] }
const DIR = 1, DOC = 2, ROOT = 5;

function flatten(children: Node[]): any[] {
    const entries: any[] = [{ name: 'Root Entry', type: ROOT, children: [], length: 0 }];
    const add = (parent: number, nodes: Node[]) => {
        for (const n of nodes) {
            const idx = entries.length;
            entries[parent].children.push(idx);
            if (n.children) {
                entries.push({ name: n.name, type: DIR, children: [], length: 0 });
                add(idx, n.children);
            } else {
                const d = n.data ?? Buffer.alloc(0);
                entries.push({ name: n.name, type: DOC, length: d.length, binaryProvider: () => new Uint8Array(d) /* copia: msgreader ignora el byteOffset de los Buffer agrupados */ });
            }
        }
    };
    add(0, children);
    return entries;
}

const tagName = (id: number, type: string) => `__substg1.0_${id.toString(16).toUpperCase().padStart(4, '0')}${type}`;
const u16 = (s: string) => Buffer.from(s, 'utf16le');
const str = (id: number, s: string): Node => ({ name: tagName(id, '001F'), data: u16(s) });
const str8 = (id: number, b: Buffer): Node => ({ name: tagName(id, '001E'), data: b });
const bin = (id: number, b: Buffer): Node => ({ name: tagName(id, '0102'), data: b });

function propStream(header: number, counts: { recips?: number; atts?: number }, fixed: Array<[number, number | bigint, 'int' | 'time']>): Node {
    const h = Buffer.alloc(header);
    if (header === 32 || header === 24) {
        h.writeUInt32LE(counts.recips ?? 0, 8);
        h.writeUInt32LE(counts.atts ?? 0, 12);
        h.writeUInt32LE(counts.recips ?? 0, 16);
        h.writeUInt32LE(counts.atts ?? 0, 20);
    }
    const entries = fixed.map(([id, v, kind]) => {
        const e = Buffer.alloc(16);
        e.writeUInt32LE(((id << 16) | (kind === 'time' ? 0x0040 : 0x0003)) >>> 0, 0);
        e.writeUInt32LE(6, 4);
        if (kind === 'time') e.writeBigUInt64LE(v as bigint, 8);
        else e.writeUInt32LE(Number(v), 8);
        return e;
    });
    return { name: '__properties_version1.0', data: Buffer.concat([h, ...entries]) };
}
const filetime = (d: Date) => (BigInt(d.getTime()) + BigInt('11644473600000')) * BigInt(10000);

interface MsgSpec {
    subject?: string;
    subject8?: Buffer;
    codepage?: number;
    body?: string;
    bodyHtml?: string;
    rtf?: Buffer;
    headers?: string;
    senderName?: string;
    senderEmail?: string;
    senderType?: string;
    messageClass?: string;
    submit?: Date;
    messageFlags?: number;
    flagStatus?: number;
    recipients?: Array<{ name: string; type: 1 | 2 | 3; addrType?: string; email?: string; smtp?: string }>;
    attachments?: Array<{ name: string; data?: Buffer; mime?: string; cid?: string; embedded?: MsgSpec }>;
}

function msgNodes(s: MsgSpec, embedded = false): Node[] {
    const nodes: Node[] = [];
    const fixed: Array<[number, number | bigint, 'int' | 'time']> = [];
    if (s.messageFlags !== undefined) fixed.push([0x0e07, s.messageFlags, 'int']);
    if (s.flagStatus !== undefined) fixed.push([0x1090, s.flagStatus, 'int']);
    if (s.codepage !== undefined) fixed.push([0x3ffd, s.codepage, 'int']);
    if (s.submit) fixed.push([0x0039, filetime(s.submit), 'time']);
    nodes.push(propStream(embedded ? 24 : 32, { recips: s.recipients?.length, atts: s.attachments?.length }, fixed));
    nodes.push(str(0x001a, s.messageClass ?? 'IPM.Note'));
    if (s.subject !== undefined) nodes.push(str(0x0037, s.subject));
    if (s.subject8) nodes.push(str8(0x0037, s.subject8));
    if (s.body !== undefined) nodes.push(str(0x1000, s.body));
    if (s.bodyHtml !== undefined) nodes.push(bin(0x1013, Buffer.from(s.bodyHtml, 'utf8')), { name: tagName(0x1013, '001F'), data: u16(s.bodyHtml) });
    if (s.rtf) nodes.push(bin(0x1009, s.rtf));
    if (s.headers) nodes.push(str(0x007d, s.headers));
    if (s.senderName) nodes.push(str(0x0c1a, s.senderName));
    if (s.senderEmail) nodes.push(str(0x0c1f, s.senderEmail), str(0x0c1e, s.senderType ?? 'SMTP'));
    (s.recipients ?? []).forEach((r, i) => {
        const ch: Node[] = [propStream(8, {}, [[0x0c15, r.type, 'int']]), str(0x3001, r.name)];
        if (r.addrType) ch.push(str(0x3002, r.addrType));
        if (r.email) ch.push(str(0x3003, r.email));
        if (r.smtp) ch.push(str(0x39fe, r.smtp));
        nodes.push({ name: `__recip_version1.0_#${i.toString(16).toUpperCase().padStart(8, '0')}`, children: ch });
    });
    (s.attachments ?? []).forEach((a, i) => {
        const ch: Node[] = [propStream(8, {}, [[0x3705, a.embedded ? 5 : 1, 'int']]), str(0x3001, a.name)];
        if (a.embedded) {
            ch.push({ name: '__substg1.0_3701000D', children: msgNodes(a.embedded, true) });
        } else {
            ch.push(bin(0x3701, a.data ?? Buffer.alloc(0)), str(0x3707, a.name));
            if (a.mime) ch.push(str(0x370e, a.mime));
            if (a.cid) ch.push(str(0x3712, a.cid));
        }
        nodes.push({ name: `__attach_version1.0_#${i.toString(16).toUpperCase().padStart(8, '0')}`, children: ch });
    });
    return nodes;
}
const makeMsg = (s: MsgSpec): Buffer => Buffer.from(burn(flatten(msgNodes(s))));

const LIM = { maxAttachmentBytes: 1024 * 1024, maxAttachments: 20 };

const TRANSPORT = [
    'Received: from mail.example.org (mail.example.org [192.0.2.5])',
    '\tby mx.local with ESMTPS id ABC123; Tue, 05 May 2020 10:00:02 +0000',
    'Authentication-Results: mx.local; dkim=pass header.d=example.org; spf=pass',
    'DKIM-Signature: v=1; a=rsa-sha256; d=example.org; s=sel; h=from:to:subject; bh=AAAA; b=BBBB',
    'From: "Ana Perez" <ana@example.org>',
    'To: Bob <bob@example.org>',
    'Subject: ignorado',
    'Message-ID: <orig-123@example.org>',
    'References: <r1@example.org> <r2@example.org>',
    'In-Reply-To: <r2@example.org>',
    'X-Secret-Internal: no-debe-pasar',
    'Content-Type: text/plain; charset=utf-8',
    '',
    '',
].join('\r\n');

describe('msg (Outlook .msg) con un CFB generado por burn', () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const big = Buffer.alloc(9000, 7);
    const inner: MsgSpec = { subject: 'Mensaje interno', body: 'texto interno', senderName: 'Carla', senderEmail: 'carla@example.org', submit: new Date('2020-04-01T08:00:00Z'), recipients: [{ name: 'Yo', type: 1, addrType: 'SMTP', email: 'yo@example.org' }] };
    const spec: MsgSpec = {
        subject: 'Reunión ñ € importante',
        body: 'Hola\r\nmundo',
        bodyHtml: '<p>Hola <img src="cid:logo@x"> mundo</p>',
        headers: TRANSPORT,
        senderName: 'Ana Perez',
        senderEmail: 'ana@example.org',
        submit: new Date('2020-05-05T10:00:00Z'),
        messageFlags: 0,
        flagStatus: 2,
        recipients: [
            { name: 'Bob', type: 1, addrType: 'SMTP', email: 'bob@example.org' },
            { name: 'Dora', type: 2, addrType: 'EX', email: '/O=EXCH/OU=X/CN=RECIPIENTS/CN=dora', smtp: 'dora@corp.example' },
            { name: 'Secreto', type: 3, addrType: 'SMTP', email: 'bcc@example.org' },
            { name: 'Sin Resolver', type: 1, addrType: 'EX', email: '/O=EXCH/CN=nadie' },
        ],
        attachments: [
            { name: 'informe ñ.pdf', data: big, mime: 'application/pdf' },
            { name: 'logo.png', data: png, mime: 'image/png', cid: 'logo@x' },
            { name: 'Reenviado', embedded: inner },
        ],
    };

    it('msgreader lee el CFB generado (propiedades, destinatarios y adjuntos)', async () => {
        const { default: MsgReader } = await import('@kenjiuno/msgreader');
        const buf = makeMsg(spec);
        const r = new MsgReader(new DataView(buf.buffer, buf.byteOffset, buf.byteLength));
        const d = r.getFileData();
        expect(d.error).toBeUndefined();
        expect(d.subject).toBe('Reunión ñ € importante');
        expect(d.recipients).toHaveLength(4);
        expect(d.attachments).toHaveLength(3);
        expect(Buffer.from(r.getAttachment(0).content).equals(big)).toBe(true);
    });

    it('msgToMime: cabeceras, destinatarios, cuerpos, adjuntos (inline y .msg incrustado) y banderas', () => {
        const buf = makeMsg(spec);
        expect(isMsgFile(buf)).toBe(true);
        expect(looksLikeMsg(buf.subarray(0, 512), 'x.msg')).toBe(true);
        const r = msgToMime(buf, LIM)!;
        expect(r).not.toBeNull();
        expect(r.subject).toBe('Reunión ñ € importante');
        expect(r.from).toBe('ana@example.org');
        expect(r.date?.toISOString()).toBe('2020-05-05T10:00:00.000Z');
        expect(r.unread).toBe(true);
        expect(r.flagged).toBe(true);
        expect(r.warnings).toContain('msg_recipients_unresolved:1');

        const p = parseMessage(r.raw);
        expect(p.subject).toBe('Reunión ñ € importante');
        expect(p.from?.email).toBe('ana@example.org');
        expect(p.to.map((a) => a.email)).toEqual(['bob@example.org']);
        expect(p.cc.map((a) => a.email)).toEqual(['dora@corp.example']);
        expect(p.bcc.map((a) => a.email)).toEqual(['bcc@example.org']);
        expect(p.text.replace(/\r/g, '')).toContain('Hola\nmundo');
        expect(p.html).toContain('cid:logo@x');
        expect(p.date?.toISOString()).toBe('2020-05-05T10:00:00.000Z');
        // Cabeceras de transporte: lista blanca, sin duplicar las que emite buildMime
        expect(p.messageId).toBe('orig-123@example.org');
        expect(p.headers['message-id']).toHaveLength(1);
        expect(p.headers['from']).toHaveLength(1);
        expect(p.headers['subject']).toHaveLength(1);
        expect(p.references).toEqual(['r1@example.org', 'r2@example.org']);
        expect(p.inReplyTo).toBe('r2@example.org');
        expect(p.headers['received']).toHaveLength(1);
        expect(p.headers['authentication-results']?.[0]).toContain('dkim=pass');
        expect(p.headers['dkim-signature']?.[0]).toContain('d=example.org');
        expect(p.headers['x-secret-internal']).toBeUndefined();
        // Adjuntos
        const byName = (n: string) => p.attachments.find((a) => a.filename === n)!;
        expect(byName('informe ñ.pdf').content.equals(big)).toBe(true);
        expect(byName('informe ñ.pdf').contentType).toBe('application/pdf');
        expect(byName('logo.png').contentId).toBe('logo@x');
        expect(byName('logo.png').inline).toBe(true);
        const eml = p.attachments.find((a) => a.filename.endsWith('.eml'))!;
        expect(eml.filename).toBe('Mensaje interno.eml');
        const ip = parseMessage(eml.content);
        expect(ip.subject).toBe('Mensaje interno');
        expect(ip.from?.email).toBe('carla@example.org');
        expect(ip.to[0].email).toBe('yo@example.org');
        expect(ip.text).toContain('texto interno');
    });

    it('PT_STRING8 con la pagina de codigos del mensaje, leido y borrador', () => {
        const r = msgToMime(makeMsg({ subject8: Buffer.from('Ré: año', 'latin1'), codepage: 1252, body: 'x', senderEmail: 'a@b.co', messageFlags: 1 | 8 }), LIM)!;
        expect(r.subject).toBe('Ré: año');
        expect(r.unread).toBe(false);
        expect(r.folderHint).toBe('Drafts');
        expect(r.flagged).toBeNull();
    });

    it('solo RTF: LZFu (vector MS-OXRTFCP), HTML encapsulado y texto plano', () => {
        const spec2 = Buffer.from('2d0000002b0000004c5a4675f1c5c7a7' + '03000a00' + '72637067' + '31323542' + '320af320' + '68656c09' + '00206277' + '05b06c64' + '7d0a800f' + 'a0', 'hex');
        const out = decompressRtf(spec2);
        expect(out?.length).toBe(43);
        expect(out!.toString('latin1').startsWith('{\\rtf1\\ansi\\ansicpg1252\\pard hello world')).toBe(true);
        expect(out!.toString('latin1').endsWith('\r\n')).toBe(true);

        const fromHtml = Buffer.from("{\\rtf1\\ansi\\ansicpg1252\\fromhtml1 \\fbidis {\\fonttbl{\\f0 Arial;}}{\\*\\htmltag19 <html>}\\htmlrtf {\\htmlrtf0 {\\*\\htmltag64 <p>}Hola \\'e9 mundo {\\*\\htmltag72 </p>}\\htmlrtf \\par\\htmlrtf0 {\\*\\htmltag27 </html>}}", 'latin1');
        const x = rtfExtract(fromHtml);
        expect(x.html).toContain('<html>');
        expect(x.html).toContain('<p>Hola é mundo </p>');
        expect(x.html).not.toContain('Arial');

        const plain = Buffer.from("{\\rtf1\\ansi\\ansicpg1252{\\fonttbl{\\f0 Arial;}}{\\colortbl;}\\pard Hola \\'e9 mundo\\par Segunda \\u241? linea\\par}", 'latin1');
        expect(rtfExtract(plain).text).toBe('Hola é mundo\nSegunda ñ linea');

        // Compresor de prueba solo literales + marca de fin
        const lz = (raw: Buffer): Buffer => {
            const init = 207;
            const body: number[] = [];
            let wp = init;
            for (let i = 0; i < raw.length; i += 8) {
                const chunk = raw.subarray(i, i + 8);
                body.push(0);
                for (const c of chunk) { body.push(c); wp++; }
            }
            body.push(0x01, (wp & 4095) >> 4, ((wp & 4095) & 15) << 4);
            const hdr = Buffer.alloc(16);
            hdr.writeUInt32LE(body.length + 12, 0);
            hdr.writeUInt32LE(raw.length, 4);
            hdr.write('LZFu', 8, 'latin1');
            return Buffer.concat([hdr, Buffer.from(body)]);
        };
        expect(decompressRtf(lz(Buffer.from('{\\rtf1 hola}')))!.toString('latin1')).toBe('{\\rtf1 hola}');

        const mela = (raw: Buffer) => { const h = Buffer.alloc(16); h.writeUInt32LE(raw.length + 12, 0); h.writeUInt32LE(raw.length, 4); h.write('MELA', 8, 'latin1'); return Buffer.concat([h, raw]); };
        const m1 = msgToMime(makeMsg({ subject: 'rtf html', rtf: lz(fromHtml), senderEmail: 'a@b.co' }), LIM)!;
        const p1 = parseMessage(m1.raw);
        expect(p1.html).toContain('<p>Hola é mundo </p>');
        const m2 = msgToMime(makeMsg({ subject: 'rtf texto', rtf: mela(plain), senderEmail: 'a@b.co' }), LIM)!;
        expect(parseMessage(m2.raw).text).toContain('Segunda ñ linea');
        expect(decompressRtf(Buffer.alloc(10))).toBeNull();
        expect(decompressRtf(Buffer.concat([Buffer.alloc(8), Buffer.from('XXXX'), Buffer.alloc(4)]))).toBeNull();
    });

    it('limites: nº y tamano de adjuntos, profundidad de mensajes incrustados, entrada hostil', () => {
        const many: MsgSpec = { subject: 'muchos', body: 'x', senderEmail: 'a@b.co', attachments: [1, 2, 3].map((i) => ({ name: `f${i}.bin`, data: Buffer.alloc(100 * i, i) })) };
        const r1 = msgToMime(makeMsg(many), { maxAttachmentBytes: 250, maxAttachments: 2 })!;
        const p1 = parseMessage(r1.raw);
        expect(p1.attachments.map((a) => a.filename)).toEqual(['f1.bin', 'f2.bin']);
        expect(r1.warnings).toContain('msg_attachments_truncated:1');
        const r2 = msgToMime(makeMsg(many), { maxAttachmentBytes: 150, maxAttachments: 10 })!;
        expect(parseMessage(r2.raw).attachments.map((a) => a.filename)).toEqual(['f1.bin']);
        expect(r2.warnings.filter((w) => w === 'msg_attachment_too_large')).toHaveLength(2);

        // 5 niveles: solo se convierten 3 (0 raiz + 3 incrustados)
        let leaf: MsgSpec = { subject: 'nivel5', body: 'x', senderEmail: 'a@b.co' };
        for (let i = 4; i >= 1; i--) leaf = { subject: `nivel${i}`, body: 'x', senderEmail: 'a@b.co', attachments: [{ name: `n${i + 1}`, embedded: leaf }] };
        const deep = msgToMime(makeMsg(leaf), LIM)!;
        expect(deep.warnings.join(',')).toContain('msg_nested_too_deep');
        let cur = parseMessage(deep.raw);
        const seen = [cur.subject];
        for (let k = 0; k < 6; k++) {
            const e = cur.attachments.find((a) => a.filename.endsWith('.eml'));
            if (!e) break;
            cur = parseMessage(e.content);
            seen.push(cur.subject);
        }
        expect(seen).toEqual(['nivel1', 'nivel2', 'nivel3', 'nivel4']);

        // Entrada que no es .msg
        expect(msgToMime(Buffer.from('hola'), LIM)).toBeNull();
        expect(msgToMime(Buffer.alloc(0), LIM)).toBeNull();
        const ole = Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(2000)]);
        expect(msgToMime(ole, LIM)).toBeNull();
        expect(looksLikeMsg(ole.subarray(0, 512), 'algo.doc')).toBe(false);
        expect(looksLikeMsg(Buffer.from('nada'))).toBe(false);
        const good = makeMsg(spec);
        expect(() => msgToMime(good.subarray(0, Math.floor(good.length / 3)), LIM)).not.toThrow();
        const corrupt = Buffer.from(good);
        for (let i = 512; i < corrupt.length; i += 37) corrupt[i] = (corrupt[i] + 91) & 255;
        expect(() => msgToMime(corrupt, LIM)).not.toThrow();
        expect(msgToMime(good, { ...LIM, maxMessageBytes: 100 })).toBeNull();
        // Un .msg de contacto no es correo
        expect(msgToMime(makeMsg({ messageClass: 'IPM.Contact', subject: 'Persona' }), LIM)).toBeNull();
        // Un OLE que no es MAPI (.doc) tiene la firma pero no las propiedades
        expect(detectFormat(good.subarray(0, 512), 'a.msg').format).toBe('msg');
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// .olm sintetico
// ---------------------------------------------------------------------------------------------------------------------

const OLM_XML = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<emails>
  <email>
    <OPFMessageCopyMessageID>&lt;olm-1@example.com&gt;</OPFMessageCopyMessageID>
    <OPFMessageCopySubject>Presupuesto Ñandú &amp; cía</OPFMessageCopySubject>
    <OPFMessageCopyFromAddresses><emailAddress OPFContactEmailAddressAddress="Ana@Example.com" OPFContactEmailAddressName="Ana Pérez" OPFContactEmailAddressType="1"/></OPFMessageCopyFromAddresses>
    <OPFMessageCopyToAddresses><emailAddress OPFContactEmailAddressAddress="bob@example.com" OPFContactEmailAddressName="Bob"/><emailAddress OPFContactEmailAddressAddress="malformado" OPFContactEmailAddressName="X"/></OPFMessageCopyToAddresses>
    <OPFMessageCopyCCAddresses><emailAddress OPFContactEmailAddressAddress="carl@example.com"/></OPFMessageCopyCCAddresses>
    <OPFMessageCopyBody>Hola
mundo</OPFMessageCopyBody>
    <OPFMessageCopyHTMLBody><![CDATA[<p>Hola <img src="cid:img1"> mundo</p>]]></OPFMessageCopyHTMLBody>
    <OPFMessageCopySentTime>2020-05-05T10:00:00</OPFMessageCopySentTime>
    <OPFMessageCopyReceivedTime>2020-05-05T10:00:05</OPFMessageCopyReceivedTime>
    <OPFMessageGetIsRead>0</OPFMessageGetIsRead>
    <OPFMessageCopyAttachmentList>
      <messageAttachment OPFAttachmentName="informe.pdf" OPFAttachmentContentType="application/pdf" OPFAttachmentURL="Local/com.microsoft.__Attachments/aaa/informe.pdf" OPFAttachmentContentFileSize="6"/>
      <messageAttachment OPFAttachmentName="img.png" OPFAttachmentContentType="image/png" OPFAttachmentContentID="img1" OPFAttachmentURL="Local/com.microsoft.__Attachments/bbb/img.png"/>
      <messageAttachment OPFAttachmentName="passwd" OPFAttachmentContentType="text/plain" OPFAttachmentURL="Local/com.microsoft.__Attachments/../../etc/passwd"/>
      <messageAttachment OPFAttachmentName="abs" OPFAttachmentURL="/etc/passwd"/>
      <messageAttachment OPFAttachmentName="ext" OPFAttachmentURL="file:///c:/windows/win.ini"/>
      <messageAttachment OPFAttachmentName="falta.bin" OPFAttachmentURL="Local/com.microsoft.__Attachments/ccc/falta.bin"/>
    </OPFMessageCopyAttachmentList>
  </email>
</emails>`;

describe('olm (estructura documentada, sintetico; NO un .olm real)', () => {
    const files: Record<string, Uint8Array> = {
        'Local/com.microsoft.__Messages/Inbox/Clientes/message_00001.xml': strToU8(OLM_XML),
        'Local/com.microsoft.__Messages/Sent Items/message_00002.xml': strToU8('<emails><email><OPFMessageCopySubject>Enviado</OPFMessageCopySubject><OPFMessageCopyFromAddresses><emailAddress OPFContactEmailAddressAddress="yo@example.com"/></OPFMessageCopyFromAddresses></email></emails>'),
        'Local/com.microsoft.__Attachments/aaa/informe.pdf': strToU8('%PDF-1'),
        'Local/com.microsoft.__Attachments/bbb/img.png': new Uint8Array([137, 80, 78, 71]),
        'Local/com.microsoft.__Contacts/contact_1.xml': strToU8('<x/>'),
        'Categories.xml': strToU8('<categories/>'),
    };
    const zip = Buffer.from(zipSync(files));
    const entries = unzipSync(new Uint8Array(zip));
    const called: string[] = [];
    const resolver = async (url: string) => {
        called.push(url);
        const e = entries[url];
        return e ? Buffer.from(e) : null;
    };

    it('rutas: mensajes, carpeta y URL de adjuntos', () => {
        const msgs = Object.keys(entries).filter(isOlmMessagePath);
        expect(msgs.sort()).toEqual(['Local/com.microsoft.__Messages/Inbox/Clientes/message_00001.xml', 'Local/com.microsoft.__Messages/Sent Items/message_00002.xml']);
        expect(olmFolderOf(msgs[0])).toEqual(['Inbox', 'Clientes']);
        expect(olmFolderOf(msgs[1])).toEqual(['Sent Items']);
        expect(isOlmMessagePath('Local/com.microsoft.__Messages/../x.xml')).toBe(false);
        expect(isOlmMessagePath('__MACOSX/Local/com.microsoft.__Messages/Inbox/._m.xml')).toBe(false);
        expect(isOlmMessagePath('/com.microsoft.__Messages/Inbox/m.xml')).toBe(false);
        expect(isOlmMessagePath('com.microsoft.__Messages/Inbox/m.txt')).toBe(false);
        expect(normalizeOlmAttachmentUrl('Local/com.microsoft.__Attachments/a%20b/x.pdf')).toBe('Local/com.microsoft.__Attachments/a b/x.pdf');
        for (const bad of ['../com.microsoft.__Attachments/x', 'com.microsoft.__Attachments/../../x', '/etc/passwd', 'C:\\x\\com.microsoft.__Attachments\\a', 'file:///x', 'http://a/com.microsoft.__Attachments/x', 'otro/dir/x.pdf', 'com.microsoft.__Attachments/%2e%2e/%2e%2e/x', '']) {
            expect(normalizeOlmAttachmentUrl(bad), bad).toBeNull();
        }
    });

    it('olmMessageToMime: cabeceras, cuerpos, adjuntos resueltos por nombre normalizado y rechazo de URL peligrosas', async () => {
        const path = 'Local/com.microsoft.__Messages/Inbox/Clientes/message_00001.xml';
        const r = (await olmMessageToMime(Buffer.from(entries[path]), resolver, { ...LIM, path }))!;
        expect(r).not.toBeNull();
        expect(r.subject).toBe('Presupuesto Ñandú & cía');
        expect(r.from).toBe('ana@example.com');
        expect(r.read).toBe(false);
        expect(r.flagged).toBeNull();
        expect(r.folder).toEqual(['Inbox', 'Clientes']);
        expect(r.date?.toISOString()).toBe('2020-05-05T10:00:00.000Z');
        const p = parseMessage(r.raw);
        expect(p.messageId).toBe('olm-1@example.com');
        expect(p.from).toMatchObject({ email: 'ana@example.com', name: 'Ana Pérez' });
        expect(p.to.map((a) => a.email)).toEqual(['bob@example.com']);
        expect(p.cc.map((a) => a.email)).toEqual(['carl@example.com']);
        expect(p.text.replace(/\r/g, '')).toBe('Hola\nmundo');
        expect(p.html).toContain('cid:img1');
        expect(p.attachments.map((a) => a.filename).sort()).toEqual(['img.png', 'informe.pdf']);
        expect(p.attachments.find((a) => a.filename === 'img.png')).toMatchObject({ contentId: 'img1', inline: true });
        expect(p.attachments.find((a) => a.filename === 'informe.pdf')!.content.toString()).toBe('%PDF-1');
        expect(r.warnings.filter((w) => w === 'olm_attachment_url_rejected')).toHaveLength(3);
        expect(r.warnings).toContain('olm_attachment_missing');
        // El resolvedor solo recibio rutas normalizadas seguras
        expect(called.every((u) => !u.includes('..') && !u.startsWith('/') && !u.includes(':'))).toBe(true);
        expect(called).not.toContain('/etc/passwd');
    });

    it('limites de adjuntos, DOCTYPE/XXE, XML invalido y mensaje sin contenido', async () => {
        const path = 'Local/com.microsoft.__Messages/Inbox/Clientes/message_00001.xml';
        const small = (await olmMessageToMime(Buffer.from(entries[path]), resolver, { maxAttachmentBytes: 5, maxAttachments: 20, path }))!;
        expect(parseMessage(small.raw).attachments.map((a) => a.filename)).toEqual(['img.png']);
        expect(small.warnings).toContain('olm_attachment_too_large');
        const one = (await olmMessageToMime(Buffer.from(entries[path]), resolver, { maxAttachmentBytes: 1000, maxAttachments: 1 }))!;
        expect(parseMessage(one.raw).attachments).toHaveLength(1);
        expect(one.warnings.some((w) => w.startsWith('olm_attachments_truncated'))).toBe(true);

        const xxe = '<?xml version="1.0"?><!DOCTYPE e [<!ENTITY x SYSTEM "file:///etc/passwd">]><emails><email><OPFMessageCopySubject>&x;</OPFMessageCopySubject></email></emails>';
        expect(await olmMessageToMime(Buffer.from(xxe), resolver, LIM)).toBeNull();
        expect(await olmMessageToMime(Buffer.from('<emails><email>'), resolver, LIM)).toBeNull();
        expect(await olmMessageToMime(Buffer.from('no es xml'), resolver, LIM)).toBeNull();
        expect(await olmMessageToMime(Buffer.alloc(0), resolver, LIM)).toBeNull();
        expect(await olmMessageToMime(Buffer.from('<emails><email/></emails>'), resolver, LIM)).toBeNull();
        expect(await olmMessageToMime(Buffer.from(OLM_XML), resolver, { ...LIM, maxXmlBytes: 100 })).toBeNull();
        // El resolvedor que lanza no rompe el mensaje
        const boom = await olmMessageToMime(Buffer.from(OLM_XML), async () => { throw new Error('x'); }, LIM);
        expect(boom).not.toBeNull();
        expect(boom!.warnings).toContain('olm_attachment_unreadable');
    });
});
