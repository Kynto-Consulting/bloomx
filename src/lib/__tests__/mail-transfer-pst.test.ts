import { afterAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { memoryStorage, CHUNK_SIZE, chunkName, ChunkedSource, type TransferStorage } from '../mail-transfer/source';
import { collectFolders, embeddedMessageOf, makePstConverter, pstMessageToMime } from '../mail-transfer/pst';
import { PstRangeReader, PstNeedChunk, runWithReader } from '../mail-transfer/pst-reader';
import { buildPst, type PstFolderSpec } from '../mail-transfer/pst-testkit';
import { mboxRecord, MboxReader } from '../mail-transfer/mbox';
import { mboxFromLine } from '../mail-transfer/mime-build';
import { parseMessage } from '../mail-transfer/mime-parse';
import { decidePlacement, detectFormat } from '../mail-transfer/formats';
import type { JobRow } from '../mail-transfer/store';

const MB = 1024 * 1024;
const LIMITS = { maxPstBytes: 4 * 1024 * MB, maxMessageBytes: 50 * MB };
const DATA = path.join(process.cwd(), 'node_modules', 'pst-extractor', 'example', 'testdata');
const FIXTURES = ['enron.pst', 'pstextractortest@outlook.com.ost', 'pstextractortestpdf@outlook.com.ost'].map((f) => path.join(DATA, f));
const haveFixtures = FIXTURES.every((f) => fs.existsSync(f));
const tmpNames = () => new Set(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('bloomx-mt-')));
const tmpBefore = tmpNames();

// ---------------------------------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------------------------------
type Converter = ReturnType<typeof makePstConverter>;

/** Almacenamiento cuyo `${prefix}/src/NNNNNN` se genera bajo demanda (no se materializa el PST); el resto va a memoria. */
function virtualStorage(prefix: string, chunkFn: (i: number) => Buffer, hooks: { onGet?: (i: number) => void } = {}) {
    const mem = memoryStorage();
    const fetched = new Set<number>();
    let gets = 0;
    const storage: TransferStorage & { objects: Map<string, Buffer> } = {
        ...mem,
        async get(key) {
            const m = key.match(new RegExp(`^${prefix}/src/(\\d{6})$`));
            if (m) { const i = Number(m[1]); gets++; fetched.add(i); hooks.onGet?.(i); return chunkFn(i); }
            return mem.get(key);
        },
    };
    return { storage, stats: () => ({ gets, distinct: fetched.size, fetched }) };
}

function bufferStorage(prefix: string, buf: Buffer) {
    return virtualStorage(prefix, (i) => Buffer.from(buf.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)));
}

interface RunResult { mbox: Buffer; cursor: any; calls: number; reader: PstRangeReader | null; ms: number }

async function convertAll(conv: Converter, storage: TransferStorage, prefix: string, size: number, opts: { deadlineMs?: number; maxCalls?: number; job?: JobRow; onTick?: (cursor: any, call: number) => void } = {}): Promise<RunResult> {
    const job = opts.job ?? ({ id: 'mtj_pst', totalBytes: size, cursor: {} } as unknown as JobRow);
    const d = { storage, prefix, totalBytes: size, fileName: 'x.pst', state: { expanded: {} } } as any;
    let calls = 0;
    let last: Awaited<ReturnType<Converter>>;
    const t0 = Date.now();
    do {
        last = await conv(job, d, Date.now() + (opts.deadlineMs ?? 40));
        job.cursor = { pst: last.cursor } as any;
        calls++;
        opts.onTick?.(last.cursor, calls);
    } while (!last.done && calls < (opts.maxCalls ?? 20000));
    expect(last.done).toBe(true);
    const src = new ChunkedSource(storage, `${prefix}/x/pst`, last.size!);
    const mbox = last.size ? await src.read(0, last.size) : Buffer.alloc(0);
    return { mbox, cursor: last.cursor, calls, reader: null, ms: Date.now() - t0 };
}

async function readMbox(mbox: Buffer) {
    const storage = memoryStorage();
    await storage.put('m/000000', mbox);
    const r = new MboxReader(new ChunkedSource(storage, 'm', mbox.length, Math.max(1, mbox.length)), 0, { headBytes: 0 });
    const out: Buffer[] = [];
    for (let m = await r.next(); m; m = await r.next()) out.push(m.raw);
    return out;
}

/** Conversion de referencia: PSTFile en memoria (Buffer) + misma logica que la version antigua, sin lector por rangos. */
async function referenceMbox(buf: Buffer): Promise<{ mbox: Buffer; count: number }> {
    const { PSTFile, PSTMessage } = await import('pst-extractor');
    const pst = new PSTFile(buf);
    const parts: Buffer[] = [];
    let count = 0;
    for (const { folder, path: fpath } of collectFolders(pst.getRootFolder())) {
        folder.moveChildCursorTo(0);
        for (let c: any = folder.getNextChild(); c; c = folder.getNextChild()) {
            if (!(c instanceof PSTMessage) || !/^IPM\.(Note|Schedule|Post)/i.test(String(c.messageClass || 'IPM.Note'))) continue;
            const m = pstMessageToMime(c, fpath, LIMITS.maxMessageBytes);
            parts.push(mboxRecord(mboxFromLine(m.date, m.from), m.raw));
            count++;
        }
    }
    return { mbox: Buffer.concat(parts), count };
}

const sha = (b: Buffer) => crypto.createHash('sha1').update(b).digest('hex');

// ---------------------------------------------------------------------------------------------------------------------
// 1) Lector por rangos: unidad
// ---------------------------------------------------------------------------------------------------------------------
describe('PST: lector por rangos (PstRangeReader)', () => {
    const mk = (n: number, cs: number) => {
        const data = Buffer.from(Array.from({ length: n }, (_, i) => i % 251));
        let reads = 0;
        const src = { size: n, async read(o: number, l: number) { reads++; return data.subarray(o, o + l); } };
        return { data, src, reads: () => reads, reader: new PstRangeReader(src, { chunkSize: cs, maxCached: 2, maxPinned: 4 }) };
    };

    it('readSync sigue la semantica de fs.readSync: lanza si falta el trozo, cruza trozos y devuelve menos bytes solo al final', async () => {
        const { data, reader } = mk(1000, 100);
        const b = Buffer.alloc(30);
        expect(() => reader.readSync(b, 30, 95)).toThrow(PstNeedChunk);
        await reader.load(0);
        expect(() => reader.readSync(b, 30, 95)).toThrow(PstNeedChunk); // cruza al trozo 1 y no esta: no copia a medias
        await reader.load(1);
        expect(reader.readSync(b, 30, 95)).toBe(30);
        expect(b.equals(data.subarray(95, 125))).toBe(true);
        await reader.load(9);
        const e = Buffer.alloc(50);
        expect(reader.readSync(e, 50, 980)).toBe(20); // EOF
        expect(reader.readSync(e, 50, 1000)).toBe(0);
        expect(reader.readSync(e, 50, 5000)).toBe(0);
    });

    it('la cache LRU respeta maxCached, no expulsa los trozos de la unidad en curso y no se cuelga (sin livelock)', async () => {
        const { data, reader, reads } = mk(1000, 100);
        // Una unidad que necesita 4 trozos distintos con maxCached=2: los fijados no se expulsan (maxPinned=4)
        const out = await runWithReader(reader, () => {
            const b = Buffer.alloc(400);
            reader.readSync(b, 400, 0);
            return b;
        }, () => undefined);
        expect(out.equals(data.subarray(0, 400))).toBe(true);
        expect(reads()).toBe(4);
        // Otra unidad posterior: la cache vuelve a acotarse
        await runWithReader(reader, () => { reader.readSync(Buffer.alloc(10), 10, 900); }, () => undefined);
        expect(reader.cachedChunks).toBeLessThanOrEqual(2 + 1);
        // Una unidad que necesita mas trozos fijados que maxPinned falla limpio
        await expect(runWithReader(reader, () => { reader.readSync(Buffer.alloc(600), 600, 0); }, () => undefined)).rejects.toMatchObject({ code: 'pst_unreadable' });
    });

    it('una excepcion tragada por la libreria (try/catch) no oculta el fallo: se reintenta la unidad y se descarta el resultado parcial', async () => {
        const { data, reader } = mk(1000, 100);
        let discards = 0;
        const out = await runWithReader(reader, () => {
            try { reader.readSync(Buffer.alloc(10), 10, 500); return 'basura'; } catch { return 'tragado'; }
        }, () => { discards++; });
        expect(out).toBe('tragado'); // tras cargar el trozo, la segunda ejecucion ya no falla...
        expect(discards).toBe(1); // ...pero la primera (con el fallo tragado) se descarto
        void data;
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// 2) Generador de PST: el PST creado por codigo se abre y se lee con pst-extractor
// ---------------------------------------------------------------------------------------------------------------------
const bigAttachment = Buffer.from(Array.from({ length: 300_000 }, (_, i) => (i * 7 + 13) & 0xff)).fill(0x41, 0, 2); // 300 KB => XBLOCK de 37 bloques

const inner = (n: number): any => ({ subject: `Nivel ${n}`, body: `cuerpo del nivel ${n}`, senderName: 'Anidado', senderEmail: `n${n}@x.com`, date: new Date(Date.UTC(2021, 0, n + 1)) });
function nest(depth: number): any {
    // mensaje raiz con un mensaje incrustado dentro de otro, `depth` niveles
    let m = inner(depth);
    for (let d = depth - 1; d >= 0; d--) m = { ...inner(d), attachments: [{ embedded: m }] };
    return m;
}

function sampleTree(): PstFolderSpec[] {
    return [
        {
            name: 'Inbox',
            messages: [
                { subject: 'Con cabeceras', body: 'Hola mundo', headers: 'From: Ana <ana@x.com>\r\nTo: b@y.com\r\nCc: c@y.com\r\nMessage-ID: <m1@x.com>\r\nDate: Mon, 4 Jan 2021 10:00:00 +0000\r\n', messageId: '<m1@x.com>', date: new Date(Date.UTC(2021, 0, 4, 10)), read: true },
                { subject: 'Con destinatarios', body: 'texto', html: '<p>html <b>negrita</b></p>', senderName: 'Luis', senderEmail: 'luis@x.com', to: ['dest1@y.com', 'dest2@y.com'], cc: ['copia@y.com'], date: new Date(Date.UTC(2021, 1, 5)) },
                {
                    subject: 'Adjuntos', body: 'ver adjuntos', senderName: 'Eva', senderEmail: 'eva@x.com', to: ['z@y.com'], date: new Date(Date.UTC(2021, 2, 6)),
                    attachments: [
                        { name: 'nota.txt', mime: 'text/plain', data: Buffer.from('contenido pequeno') },
                        { name: 'grande.bin', mime: 'application/octet-stream', data: bigAttachment },
                        { name: 'img.png', mime: 'image/png', data: Buffer.from([1, 2, 3, 4, 5]), cid: 'img1@x' },
                        { embedded: { subject: 'Reenviado: ¡Ñandú/informe?', body: 'mensaje incrustado', senderName: 'Oscar', senderEmail: 'oscar@x.com', to: ['q@y.com'], date: new Date(Date.UTC(2020, 5, 7)), attachments: [{ name: 'interno.txt', mime: 'text/plain', data: Buffer.from('adjunto del incrustado') }] } },
                    ],
                },
                { subject: 'Cita', messageClass: 'IPM.Appointment', body: 'no es correo', date: new Date(Date.UTC(2021, 3, 7)) },
            ],
            children: [{ name: 'Sub', messages: [{ subject: 'En subcarpeta', body: 'sub', senderName: 'Sara', senderEmail: 'sara@x.com', to: ['a@b.com'], date: new Date(Date.UTC(2021, 4, 8)) }] }],
        },
        { name: 'Contactos', containerClass: 'IPF.Contact', messages: [{ subject: 'Un contacto', messageClass: 'IPM.Contact' }] },
        { name: 'Profundo', messages: [{ ...nest(5), subject: 'Anidados' }] },
        { name: 'Vacia' },
    ];
}

describe('PST generado por codigo (pst-testkit): NDB + LTP + mensajeria', () => {
    it('pst-extractor abre el PST generado y lee carpetas, mensajes, destinatarios, adjuntos (incluido uno de 300 KB en XBLOCK) e incrustados', async () => {
        const built = buildPst(sampleTree());
        const buf = built.pst.toBuffer();
        expect(detectFormat(buf.subarray(0, 4096), 'x.bin').format).toBe('pst');
        const { PSTFile, PSTMessage } = await import('pst-extractor');
        const pst = new PSTFile(buf);
        const folders = collectFolders(pst.getRootFolder());
        // 'Contactos' (IPF.Contact) y 'Vacia' (sin mensajes) no se recorren
        expect(folders.map((f) => f.path)).toEqual(['Inbox', 'Inbox/Sub', 'Profundo']);
        const inbox: any = folders[0].folder;
        expect(inbox.contentCount).toBe(4);
        const msgs: any[] = [];
        for (let m = inbox.getNextChild(); m; m = inbox.getNextChild()) msgs.push(m);
        expect(msgs.map((m) => m.subject)).toEqual(['Con cabeceras', 'Con destinatarios', 'Adjuntos', 'Cita']);
        expect(msgs[1].numberOfRecipients).toBe(3);
        expect(msgs[1].bodyHTML).toBe('<p>html <b>negrita</b></p>');
        expect(msgs[2].numberOfAttachments).toBe(4);
        const a1 = msgs[2].getAttachment(1);
        const big = Buffer.alloc(a1.fileInputStream.length.toNumber());
        a1.fileInputStream.readCompletely(big);
        expect(big.equals(bigAttachment)).toBe(true);
        // El bug de la libreria: embeddedPSTMessage devuelve null (descriptorIndexNode null); nuestro envoltorio lo resuelve
        const a3 = msgs[2].getAttachment(3);
        expect(a3.attachMethod).toBe(5);
        expect(a3.embeddedPSTMessage).toBeNull();
        const emb: any = embeddedMessageOf(a3, msgs[2]);
        expect(emb).toBeInstanceOf(PSTMessage);
        expect(emb.subject).toBe('Reenviado: ¡Ñandú/informe?');
        expect(emb.numberOfAttachments).toBe(1);
    });

    it('cada mensaje del PST generado se convierte a MIME valido: destinatarios, cid, adjunto grande y mensajes incrustados como .eml (message/rfc822)', async () => {
        const { pst } = buildPst(sampleTree());
        const buf = pst.toBuffer();
        const prefix = 'mailtransfer/mtj_gen';
        const { storage } = bufferStorage(prefix, buf);
        const conv = makePstConverter(LIMITS);
        const run = await convertAll(conv, storage, prefix, buf.length, { deadlineMs: 5 });
        expect(run.cursor.converted).toBe(5); // Inbox(3 correos; la cita se omite) + Sub(1) + Profundo(1)
        expect(run.cursor.skipped).toBe(1);
        const parsed = (await readMbox(run.mbox)).map((r) => parseMessage(r));
        const bySubject = (s: string) => parsed.find((p) => p.subject === s)!;

        const h = bySubject('Con cabeceras');
        expect(h.from?.email).toBe('ana@x.com');
        expect(h.to.map((a) => a.email)).toEqual(['b@y.com']);
        expect(h.cc.map((a) => a.email)).toEqual(['c@y.com']);
        expect(h.headers['x-bloomx-source-folder']?.[0]).toBe('Inbox');

        const r = bySubject('Con destinatarios');
        expect(r.to.map((a) => a.email)).toEqual(['dest1@y.com', 'dest2@y.com']);
        expect(r.cc.map((a) => a.email)).toEqual(['copia@y.com']);
        expect(r.html).toContain('negrita');

        const a = bySubject('Adjuntos');
        const names = a.attachments.map((x) => x.filename);
        expect(names).toEqual(['nota.txt', 'grande.bin', 'img.png', 'Reenviado_ ¡Ñandú_informe_.eml']);
        expect(a.attachments[1].content.equals(bigAttachment)).toBe(true);
        expect(a.attachments[3].contentType).toBe('message/rfc822');
        const eml = parseMessage(a.attachments[3].content);
        expect(eml.subject).toBe('Reenviado: ¡Ñandú/informe?');
        expect(eml.from?.email).toBe('oscar@x.com');
        expect(eml.text).toContain('mensaje incrustado');
        expect(eml.attachments.map((x) => x.filename)).toEqual(['interno.txt']);
        expect(eml.attachments[0].content.toString()).toBe('adjunto del incrustado');
        expect(eml.headers['x-bloomx-source-folder']).toBeUndefined(); // los incrustados no llevan cabeceras de origen

        // Profundidad maxima 3: nivel 0 (raiz) -> 1 -> 2 -> 3 se exportan; el nivel 4 y 5 no
        let level = bySubject('Anidados');
        const chain: string[] = [level.subject];
        for (;;) {
            const e = level.attachments.find((x) => x.contentType === 'message/rfc822');
            if (!e) break;
            level = parseMessage(e.content);
            chain.push(level.subject);
        }
        expect(chain).toEqual(['Anidados', 'Nivel 1', 'Nivel 2', 'Nivel 3']);

        // La ubicacion (decidePlacement) usa la carpeta de origen
        const placement = decidePlacement(h.headers, h.headers['x-bloomx-source-folder']?.[0]?.split('/'));
        expect(placement.folder).toBeTruthy();
    });

    it('el mismo PST convertido con un lector diminuto (trozos de 4 KB, cache de 8) da exactamente el mismo mbox', async () => {
        const { pst } = buildPst(sampleTree(), { scatterStride: 64 * 1024 });
        const buf = pst.toBuffer();
        const ref = await referenceMbox(buf);
        const prefix = 'mailtransfer/mtj_gen2';
        const { storage } = bufferStorage(prefix, buf);
        let reader: PstRangeReader | undefined;
        const conv = makePstConverter(LIMITS, { readerOpts: { chunkSize: 4096, maxCached: 8, maxPinned: 2000 }, onReader: (r) => { reader = r; } });
        const run = await convertAll(conv, storage, prefix, buf.length, { deadlineMs: 5 });
        expect(sha(run.mbox)).toBe(sha(ref.mbox));
        expect(reader!.stats.retries).toBeGreaterThan(0);
        expect(reader!.stats.peakCachedChunks).toBeLessThan(reader!.size / 4096);
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// 3) Mensajes incrustados: simulacros de PSTMessage (limites de profundidad, tamano y fallos)
// ---------------------------------------------------------------------------------------------------------------------
describe('PST: mensajes adjuntos incrustados (mock de PSTMessage)', () => {
    const mkMsg = (subject: string, atts: any[] = []): any => ({
        subject, body: `cuerpo ${subject}`, bodyHTML: '', transportMessageHeaders: '', senderName: 'S', senderAddrtype: 'SMTP', senderEmailAddress: 's@x.com',
        clientSubmitTime: new Date(Date.UTC(2022, 0, 1)), isRead: true, numberOfAttachments: atts.length, numberOfRecipients: 0,
        getAttachment: (i: number) => atts[i],
    });
    const emb = (m: any) => ({ attachMethod: 5, embeddedPSTMessage: m });

    it('message/rfc822 se reconstruye recursivamente, se nombra <asunto>.eml y buildMime -> parseMessage lo devuelve como adjunto .eml intacto', () => {
        const child = mkMsg('Hijo: prueba/1');
        const root = mkMsg('Padre', [emb(child), { attachMethod: 1, fileInputStream: null, longFilename: 'sin-datos.txt' }]);
        const { raw } = pstMessageToMime(root, 'Inbox', 1 * MB);
        const p = parseMessage(raw);
        expect(p.attachments).toHaveLength(1);
        expect(p.attachments[0]).toMatchObject({ contentType: 'message/rfc822', filename: 'Hijo_ prueba_1.eml' });
        const c = parseMessage(p.attachments[0].content);
        expect(c.subject).toBe('Hijo: prueba/1');
        expect(c.text).toContain('cuerpo Hijo');
    });

    it('profundidad maxima 3, presupuesto de tamano, incrustado nulo o que lanza error', () => {
        let m = mkMsg('L5');
        for (const n of ['L4', 'L3', 'L2', 'L1', 'L0']) m = mkMsg(n, [emb(m)]);
        const subjects = (raw: Buffer) => { const out = []; let p = parseMessage(raw); for (;;) { out.push(p.subject); const e = p.attachments.find((a) => a.contentType === 'message/rfc822'); if (!e) break; p = parseMessage(e.content); } return out; };
        expect(subjects(pstMessageToMime(m, 'F', MB).raw)).toEqual(['L0', 'L1', 'L2', 'L3']);

        const big = mkMsg('Grande', []);
        big.body = 'x'.repeat(200_000);
        const withBig = mkMsg('Raiz', [emb(big), emb(mkMsg('Pequeno'))]);
        const small = parseMessage(pstMessageToMime(withBig, 'F', 100_000).raw); // el presupuesto no da para el grande
        expect(small.attachments.map((a) => a.filename)).toEqual(['Pequeno.eml']);

        const boom = { attachMethod: 5, get embeddedPSTMessage(): any { throw new Error('externo'); } };
        const ok = parseMessage(pstMessageToMime(mkMsg('R', [boom, emb(null), emb(mkMsg(''))]), 'F', MB).raw);
        expect(ok.attachments.map((a) => a.filename)).toEqual(['mensaje-adjunto.eml']);
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// 4) Reanudacion y robustez del cursor
// ---------------------------------------------------------------------------------------------------------------------
describe('PST: reanudacion y robustez del cursor', () => {
    const tree = (): PstFolderSpec[] => ['A', 'B', 'C'].map((n, fi) => ({
        name: n,
        messages: Array.from({ length: 4 }, (_, i) => ({ subject: `${n}${i}`, body: `cuerpo ${n}${i}`, messageId: `<${n}${i}@x>`, senderEmail: `${n.toLowerCase()}@x.com`, senderName: n, to: ['d@y.com'], date: new Date(Date.UTC(2021, fi, i + 1)) })),
    }));

    it('deadline minimo (un mensaje por tick): 12 mensajes, cursor monotono, mismo mbox que una sola pasada, sin duplicados', async () => {
        const { pst } = buildPst(tree(), { scatterStride: 32 * 1024 });
        const buf = pst.toBuffer();
        const prefix = 'mailtransfer/mtj_res';
        const { storage } = bufferStorage(prefix, buf);
        const conv = makePstConverter(LIMITS, { readerOpts: { chunkSize: 16 * 1024, maxCached: 6, maxPinned: 500 } });
        const seen: Array<[number, number]> = [];
        const one = await convertAll(conv, storage, prefix, buf.length, { deadlineMs: -1, onTick: (c) => seen.push([c.fi, c.mi]) });
        expect(one.calls).toBe(13); // 12 mensajes (1 por tick, deadline vencido) + el tick final que detecta el fin
        for (let i = 1; i < seen.length; i++) expect(seen[i][0] > seen[i - 1][0] || (seen[i][0] === seen[i - 1][0] && seen[i][1] >= seen[i - 1][1])).toBe(true);

        const { storage: s2 } = bufferStorage('mailtransfer/mtj_res2', buf);
        const all = await convertAll(makePstConverter(LIMITS), s2, 'mailtransfer/mtj_res2', buf.length, { deadlineMs: 60_000 });
        expect(all.calls).toBe(1);
        expect(sha(one.mbox)).toBe(sha(all.mbox));
        const ids = (await readMbox(one.mbox)).map((r) => parseMessage(r).messageId);
        expect(ids).toHaveLength(12);
        expect(new Set(ids).size).toBe(12);
    });

    it('si el orden/indice de carpetas del cursor no coincide con el PST, se relocaliza por clave de carpeta y no se duplica ni se salta nada', async () => {
        const { pst } = buildPst(tree());
        const buf = pst.toBuffer();
        const prefix = 'mailtransfer/mtj_res3';
        const { storage } = bufferStorage(prefix, buf);
        const conv = makePstConverter(LIMITS);
        const job = { id: 'mtj_res3', totalBytes: buf.length, cursor: {} } as unknown as JobRow;
        const d = { storage, prefix, totalBytes: buf.length, fileName: 'x.pst', state: { expanded: {} } } as any;
        // 6 ticks de 1 mensaje: 4 de A y 2 de B
        let last: any;
        for (let i = 0; i < 6; i++) { last = await conv(job, d, Date.now() - 1); job.cursor = { pst: last.cursor } as any; }
        expect(last.cursor).toMatchObject({ fi: 1, mi: 2, converted: 6 });
        expect(last.cursor.fk).toMatch(/^B#/);
        // El cursor guardado apunta a un indice de carpeta equivocado (p. ej. cambio de orden): la clave manda
        job.cursor = { pst: { ...last.cursor, fi: 2 } } as any;
        let calls = 0;
        do { last = await conv(job, d, Date.now() + 60_000); job.cursor = { pst: last.cursor } as any; calls++; } while (!last.done && calls < 20);
        const src = new ChunkedSource(storage, `${prefix}/x/pst`, last.size);
        const subjects = (await readMbox(await src.read(0, last.size))).map((r) => parseMessage(r).subject);
        expect(subjects).toEqual(['A0', 'A1', 'A2', 'A3', 'B0', 'B1', 'B2', 'B3', 'C0', 'C1', 'C2', 'C3']);
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// 5) PST corruptos / truncados / cifrados
// ---------------------------------------------------------------------------------------------------------------------
describe('PST: archivos corruptos', () => {
    const run = async (buf: Buffer) => {
        const prefix = 'mailtransfer/mtj_bad';
        const { storage } = bufferStorage(prefix, buf);
        return convertAll(makePstConverter(LIMITS), storage, prefix, buf.length, { deadlineMs: 5000, maxCalls: 50 });
    };

    it('cabecera invalida, archivo diminuto y PST cifrado (bCryptMethod=2) => pst_unreadable', async () => {
        const good = buildPst(tree1()).pst.toBuffer();
        await expect(run(Buffer.from('esto no es un pst, es texto plano'.repeat(50)))).rejects.toMatchObject({ code: 'pst_unreadable' });
        await expect(run(good.subarray(0, 100))).rejects.toMatchObject({ code: 'pst_unreadable' });
        const enc = Buffer.from(good);
        enc[513] = 2;
        await expect(run(enc)).rejects.toMatchObject({ code: 'pst_unreadable' });
        const badVer = Buffer.from(good);
        badVer[10] = 99;
        await expect(run(badVer)).rejects.toMatchObject({ code: 'pst_unreadable' });
    });

    it('PST truncado (sin el arbol de nodos) o con el puntero del arbol destrozado => pst_unreadable, sin colgarse', async () => {
        const good = buildPst(tree1()).pst.toBuffer();
        await expect(run(good.subarray(0, good.length - 4096))).rejects.toMatchObject({ code: 'pst_unreadable' });
        const trashed = Buffer.from(good);
        trashed.fill(0xff, 224, 232); // ibRoot del NBT
        await expect(run(trashed)).rejects.toMatchObject({ code: 'pst_unreadable' });
    });

    it.skipIf(!haveFixtures)('enron.pst recortado a 1 MB, 6 MB y 13 MB (truncado real) termina sin colgarse: pst_unreadable o mensajes omitidos', async () => {
        const full = fs.readFileSync(FIXTURES[0]);
        for (const cut of [1 * MB, 6 * MB, 13 * MB]) {
            let outcome: string;
            try {
                const r = await run(full.subarray(0, cut));
                outcome = `ok converted=${r.cursor.converted} skipped=${r.cursor.skipped}`;
            } catch (e: any) {
                expect(e.code).toBe('pst_unreadable');
                outcome = 'pst_unreadable';
            }
            expect(outcome).toBeTruthy();
        }
    }, 120_000);

    function tree1(): PstFolderSpec[] { return [{ name: 'Inbox', messages: [{ subject: 'uno', body: 'x', senderEmail: 'a@b.com', senderName: 'A' }] }]; }
});

// ---------------------------------------------------------------------------------------------------------------------
// 6) PST reales (3 fixtures distintas): mismo resultado que la lectura completa en memoria
// ---------------------------------------------------------------------------------------------------------------------
describe.skipIf(!haveFixtures)('PST reales (enron.pst y 2 OST de Outlook): lectura por rangos == lectura completa', () => {
    it('detecta el PST por contenido, convierte por lotes (reanudable) y cada mensaje se reconstruye como MIME valido (enron)', async () => {
        const buf = fs.readFileSync(FIXTURES[0]);
        expect(detectFormat(buf.subarray(0, 4096), 'renombrado.bin').format).toBe('pst');
        const prefix = 'mailtransfer/mtj_pst';
        const { storage } = bufferStorage(prefix, buf);
        const conv = makePstConverter({ maxPstBytes: 400 * MB, maxMessageBytes: 50 * MB });
        const run = await convertAll(conv, storage, prefix, buf.length, { deadlineMs: 40 });
        expect(run.calls).toBeGreaterThan(2);
        expect(run.cursor.converted).toBeGreaterThan(50);
        const msgs = await readMbox(run.mbox);
        let withFolder = 0;
        let withFrom = 0;
        const folders = new Set<string>();
        for (const raw of msgs) {
            const p = parseMessage(raw);
            expect(p.date).not.toBeNull();
            if (p.from) withFrom++;
            folders.add(decidePlacement(p.headers, p.headers['x-bloomx-source-folder']?.[0]?.split('/')).folder);
            if (p.headers['x-bloomx-source-folder']) withFolder++;
        }
        expect(msgs.length).toBe(run.cursor.converted);
        expect(withFolder).toBe(msgs.length);
        expect(withFrom).toBeGreaterThan(msgs.length * 0.8);
        expect(folders.size).toBeGreaterThan(0);
    }, 180_000);

    for (const [idx, label] of [[0, 'enron.pst'], [1, 'pstextractortest@outlook.com.ost'], [2, 'pstextractortestpdf@outlook.com.ost']] as const) {
        for (const cfg of [{ name: 'trozos de 4 MiB', opts: undefined, deadline: 60_000 }, { name: 'trozos de 64 KiB con cache de 6 y ticks minimos', opts: { chunkSize: 64 * 1024, maxCached: 6, maxPinned: 400 }, deadline: 5 }]) {
            it(`${label} con ${cfg.name}: mbox identico byte a byte a la conversion completa en memoria`, async () => {
                const buf = fs.readFileSync(FIXTURES[idx]);
                const ref = await referenceMbox(buf);
                expect(ref.count).toBeGreaterThan(20);
                const prefix = `mailtransfer/mtj_real${idx}`;
                const v = bufferStorage(prefix, buf);
                let reader: PstRangeReader | undefined;
                const conv = makePstConverter(LIMITS, { readerOpts: cfg.opts, onReader: (r) => { reader = r; } });
                const run = await convertAll(conv, v.storage, prefix, buf.length, { deadlineMs: cfg.deadline });
                expect(run.cursor.converted).toBe(ref.count);
                expect(sha(run.mbox)).toBe(sha(ref.mbox));
                // eslint-disable-next-line no-console
                console.log(`[pst] ${label} | ${cfg.name} | ${(buf.length / MB).toFixed(1)} MB | ${ref.count} msgs | ticks=${run.calls} | ${run.ms} ms | ${(buf.length / MB / (run.ms / 1000)).toFixed(1)} MB/s | last-tick reader: hits=${reader!.stats.hits} misses=${reader!.stats.misses} retries=${reader!.stats.retries} fetched=${reader!.stats.fetched} peakCache=${reader!.stats.peakCachedChunks}`);
            }, 180_000);
        }
    }
});

// ---------------------------------------------------------------------------------------------------------------------
// 7) Memoria y "sin copia a disco": PST virtual de cientos de MB
// ---------------------------------------------------------------------------------------------------------------------
describe('PST grande (virtual): no se carga entero ni se copia a /tmp', () => {
    const rss = () => process.memoryUsage().rss;

    it('PST generado de 640 MiB con los bloques repartidos por todo el archivo: pico de RSS acotado por la cache y ningun temporal', async () => {
        const size = 640 * MB;
        const tree: PstFolderSpec[] = [0, 1, 2, 3].map((f) => ({
            name: `Carpeta${f}`,
            messages: Array.from({ length: 12 }, (_, i) => ({
                subject: `m${f}-${i}`, body: `cuerpo ${f}-${i}`.repeat(50), senderName: 'S', senderEmail: 's@x.com', to: ['d@y.com'], messageId: `<${f}-${i}@x>`,
                date: new Date(Date.UTC(2021, f, i + 1)),
                attachments: i % 3 === 0 ? [{ name: 'a.bin', mime: 'application/octet-stream', data: Buffer.alloc(40_000, i + 1) }] : [],
            })),
        }));
        const { pst } = buildPst(tree, { scatterStride: 2 * MB, padTo: size });
        expect(pst.size).toBe(size);
        const segBytes = pst.segments.reduce((a, s) => a + s.data.length, 0);
        expect(segBytes).toBeLessThan(size / 20); // el archivo virtual es casi todo hueco

        const prefix = 'mailtransfer/mtj_big';
        let peak = 0;
        const rss0 = rss();
        const v = virtualStorage(prefix, (i) => pst.chunk(i, CHUNK_SIZE), { onGet: () => { peak = Math.max(peak, rss()); } });
        let reader: PstRangeReader | undefined;
        const conv = makePstConverter({ maxPstBytes: 2048 * MB, maxMessageBytes: 50 * MB }, { onReader: (r) => { reader = r; } });
        const run = await convertAll(conv, v.storage, prefix, size, { deadlineMs: 300 });
        peak = Math.max(peak, rss());
        expect(run.cursor.converted).toBe(48);
        const ref = await referenceMbox(await smallEquivalent(tree));
        expect(sha(run.mbox)).toBe(sha(ref.mbox));

        const st = v.stats();
        const totalChunks = Math.ceil(size / CHUNK_SIZE);
        const deltaMb = (peak - rss0) / MB;
        // eslint-disable-next-line no-console
        console.log(`[pst-big] virtual ${size / MB} MiB (${totalChunks} trozos de 4 MiB) | trozos distintos leidos=${st.distinct} | descargas=${st.gets} | ticks=${run.calls} | ${run.ms} ms | RSS base=${(rss0 / MB).toFixed(0)} MB pico=${(peak / MB).toFixed(0)} MB delta=${deltaMb.toFixed(0)} MB | cache pico=${reader!.stats.peakCachedChunks} trozos | ${(size / MB / (run.ms / 1000)).toFixed(0)} MB/s virtual`);
        expect(reader!.stats.peakCachedChunks).toBeLessThanOrEqual(24 + 1);
        expect(st.distinct).toBeLessThan(totalChunks); // no se leyo el archivo entero
        expect(deltaMb).toBeLessThan(size / MB / 2); // el pico es una fraccion del tamano (sin copia completa)
        const after = tmpNames();
        for (const n of after) expect(tmpBefore.has(n)).toBe(true); // ningun temporal bloomx-mt-* nuevo
    }, 300_000);

    /** Mismo contenido logico, compacto (para la conversion de referencia sin materializar 640 MiB). */
    async function smallEquivalent(tree: PstFolderSpec[]) {
        return buildPst(tree).pst.toBuffer();
    }

    it.skipIf(!haveFixtures)('enron.pst real con relleno de ceros hasta 640 MiB: solo se descargan los trozos que contienen datos', async () => {
        const real = fs.readFileSync(FIXTURES[0]);
        const size = 640 * MB;
        const prefix = 'mailtransfer/mtj_pad';
        const v = virtualStorage(prefix, (i) => {
            const start = i * CHUNK_SIZE;
            const out = Buffer.alloc(Math.min(CHUNK_SIZE, size - start));
            if (start < real.length) real.copy(out, 0, start, Math.min(real.length, start + out.length));
            return out;
        });
        const conv = makePstConverter({ maxPstBytes: 2048 * MB, maxMessageBytes: 50 * MB });
        const run = await convertAll(conv, v.storage, prefix, size, { deadlineMs: 500 });
        const ref = await referenceMbox(real);
        expect(sha(run.mbox)).toBe(sha(ref.mbox));
        const st = v.stats();
        const dataChunks = Math.ceil(real.length / CHUNK_SIZE);
        expect([...st.fetched].every((i) => i < dataChunks)).toBe(true); // nunca se pidio un trozo del relleno
        // eslint-disable-next-line no-console
        console.log(`[pst-pad] enron ${(real.length / MB).toFixed(1)} MB + relleno hasta ${size / MB} MiB | trozos con datos=${dataChunks} de ${Math.ceil(size / CHUNK_SIZE)} | distintos leidos=${st.distinct}`);
    }, 120_000);

    it('el tope maxPstBytes se aplica antes de leer nada', async () => {
        const conv = makePstConverter({ maxPstBytes: 1000, maxMessageBytes: 1000 });
        await expect(conv({ id: 'mtj_x', totalBytes: 5000, cursor: {} } as unknown as JobRow, { storage: memoryStorage(), prefix: 'p', totalBytes: 5000, fileName: 'x.pst', state: { expanded: {} } } as any, Date.now() + 1000)).rejects.toMatchObject({ code: 'pst_too_large' });
    });
});

afterAll(() => {
    // Nada debe quedar en el directorio temporal
    for (const n of tmpNames()) expect(tmpBefore.has(n)).toBe(true);
});

