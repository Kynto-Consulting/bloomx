/**
 * pst.ts - conversion PST (Outlook/Hotmail) -> mbox por trozos, con pst-extractor (JS puro, MIT).
 *
 * Lectura POR RANGOS: el PST no se copia a disco ni se carga entero. `PSTFile.readSync` (unica via de lectura de pst-extractor)
 * se sustituye por una cache LRU de trozos de 4 MiB traidos de TransferStorage bajo demanda (ver pst-reader.ts). Por eso el tope
 * de tamano ya no depende de /tmp (512 MB en Vercel) sino de la duracion total del trabajo. Se procesa mensaje a mensaje, es
 * reanudable (carpeta + indice de mensaje en el cursor, con clave de carpeta para no duplicar si cambia el orden) y cada mensaje
 * se reconstruye como MIME con nuestro constructor. Los mensajes adjuntos incrustados se exportan como adjunto message/rfc822
 * (.eml, profundidad max. 3). No se soportan PST cifrados/corruptos (pst_unreadable). Se omiten contactos, citas y tareas.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildMime, mboxFromLine } from './mime-build';
import { mboxRecord } from './mbox';
import { headersToRecord, parseAddressList, parseHeaderBlock, parseMailDate, type Address } from './mime-parse';
import { ArchiveError } from './zip';
import { ChunkWriter, ChunkedSource } from './source';
import { PstFnError, PstRangeReader, makeRangePstClass, runWithReader } from './pst-reader';
import type { ArchiveDeps } from './archive';
import type { EngineDeps } from './import-engine';
import type { JobRow } from './store';

interface PstCursor {
    fi: number;
    mi: number;
    /** Clave de la carpeta fi (ruta + descriptor): permite relocalizar si el orden de carpetas cambia entre ticks. */
    fk?: string;
    w: { nextChunk: number; totalBytes: number; tailVersion: number };
    converted: number;
    skipped: number;
}

/** Version anterior copiaba el PST a /tmp: se limpia ese temporal si quedo de un trabajo previo. */
const legacyTmpFile = (jobId: string) => path.join(os.tmpdir(), `bloomx-mt-${jobId.replace(/[^A-Za-z0-9_-]/g, '')}.pst`);

export async function removePstTemp(jobId: string): Promise<void> {
    await fs.promises.unlink(legacyTmpFile(jobId)).catch(() => undefined);
}

const addr = (name: string, email: string): Address | null => (email && email.includes('@') ? { name: name || '', email: email.toLowerCase() } : null);

const MAX_EMBED_DEPTH = 3;

interface MimeOpts { depth?: number; budget?: { left: number } }

function readAttachment(att: any, maxBytes: number): Buffer | null {
    try {
        const stream = att.fileInputStream;
        if (!stream) return null;
        const len = stream.length.toNumber();
        if (len <= 0 || len > maxBytes) return null;
        const buf = Buffer.alloc(len);
        stream.readCompletely(buf);
        return buf;
    } catch {
        return null;
    }
}

/**
 * pst-extractor 1.12: PSTMessage.getAttachment() construye el PSTAttachment con descriptorIndexNode = null, y
 * `embeddedPSTMessage` exige ese nodo (dist/PSTAttachment.class.js, rama "if (this.localDescriptorItems && this.descriptorIndexNode)"),
 * asi que SIEMPRE devuelve null. Se le da el nodo del mensaje padre (solo se usa como identificador). Ademas, si la propiedad
 * PtypObject (0x3701, tipo 0x0d) es una referencia a subnodo (NID) en vez de un valor de heap, la libreria lee item.data
 * (vacio) y no la encuentra: se sintetiza item.data con el NID.
 */
export function embeddedMessageOf(att: any, parent: any): any {
    try {
        if (!att.descriptorIndexNode && parent?.descriptorIndexNode) att.descriptorIndexNode = parent.descriptorIndexNode;
        const item = att.pstTableItems?.get?.(0x3701);
        if (item && item.entryValueType === 0x000d && item.data?.length === 0 && item.entryValueReference) {
            const b = Buffer.alloc(4);
            b.writeUInt32LE(item.entryValueReference >>> 0, 0);
            item.data = b;
        }
        return att.embeddedPSTMessage;
    } catch {
        return null;
    }
}

const emlName = (subject: unknown) => {
    const s = String(subject || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100);
    return `${s || 'mensaje-adjunto'}.eml`;
};

/** Reconstruye un mensaje MIME a partir de un PSTMessage (los mensajes incrustados se anaden como message/rfc822). */
export function pstMessageToMime(msg: any, folderPath: string, maxAttachmentBytes: number, opts: MimeOpts = {}): { raw: Buffer; date: Date; from: string } {
    const depth = opts.depth ?? 0;
    const budget = opts.budget ?? { left: maxAttachmentBytes };
    const hdrText: string = msg.transportMessageHeaders || '';
    const hdr = hdrText ? headersToRecord(parseHeaderBlock(hdrText)) : {};
    const first = (n: string) => hdr[n]?.[0];

    let from: Address | null = parseAddressList(first('from'))[0] ?? null;
    if (!from) from = addr(msg.senderName, msg.senderAddrtype === 'SMTP' ? msg.senderEmailAddress : '') ?? addr(msg.sentRepresentingName, msg.sentRepresentingEmailAddress) ?? null;
    let to = parseAddressList(hdr['to']);
    let cc = parseAddressList(hdr['cc']);
    const bcc: Address[] = [];
    if (to.length === 0 && cc.length === 0) {
        const n = Math.min(Number(msg.numberOfRecipients) || 0, 200);
        for (let i = 0; i < n; i++) {
            try {
                const r = msg.getRecipient(i);
                const a = addr('', r?.smtpAddress || (r?.addrType === 'SMTP' ? r.emailAddress : ''));
                if (!a) continue;
                if (r.recipientType === 2) cc.push(a);
                else if (r.recipientType === 3) bcc.push(a);
                else to.push(a);
            } catch { /* destinatario ilegible */ }
        }
        if (to.length === 0 && cc.length === 0) { to = parseAddressList(msg.displayTo); cc = parseAddressList(msg.displayCC); }
    }
    const date = (msg.clientSubmitTime as Date | null) ?? (msg.messageDeliveryTime as Date | null) ?? parseMailDate(first('date')) ?? new Date();


    const attachments: Array<{ filename: string; contentType: string; content: Buffer; contentId?: string | null; inline?: boolean }> = [];
    const na = Math.min(Number(msg.numberOfAttachments) || 0, 100);
    for (let i = 0; i < na; i++) {
        try {
            const a = msg.getAttachment(i);
            if (Number(a.attachMethod) === 5) {
                // ATTACH_EMBEDDED_MSG: mensaje incrustado -> .eml (message/rfc822), recursivo con tope de profundidad y de tamano
                if (depth >= MAX_EMBED_DEPTH || budget.left <= 0) continue;
                const sub = embeddedMessageOf(a, msg);
                if (!sub) continue;
                const m = pstMessageToMime(sub, folderPath, maxAttachmentBytes, { depth: depth + 1, budget });
                if (m.raw.length > budget.left) continue;
                budget.left -= m.raw.length;
                attachments.push({ filename: emlName(sub.subject), contentType: 'message/rfc822', content: m.raw, contentId: null, inline: false });
                continue;
            }
            const content = readAttachment(a, Math.min(maxAttachmentBytes, budget.left));
            if (!content) continue;
            budget.left -= content.length;
            const cid = a.contentId ? String(a.contentId).replace(/[<>\s]/g, '') : '';
            attachments.push({
                filename: a.longFilename || a.filename || `adjunto-${i + 1}`,
                contentType: a.mimeTag || 'application/octet-stream',
                content,
                contentId: cid || null,
                inline: !!cid,
            });
        } catch { /* adjunto ilegible */ }
    }

    const mid = String(msg.internetMessageId || first('message-id') || '').replace(/[<>\s]/g, '') || null;
    const raw = buildMime({
        from, to, cc, bcc,
        replyTo: null,
        subject: String(msg.subject || ''),
        date,
        messageId: mid,
        inReplyTo: String(msg.inReplyToId || first('in-reply-to') || '').replace(/[<>\s]/g, '') || null,
        references: first('references')?.match(/<[^<>\s]+>/g)?.map((r) => r.slice(1, -1)),
        text: String(msg.body || ''),
        html: String(msg.bodyHTML || ''),
        attachments,
        extraHeaders: depth > 0 ? [] : [
            ['Status', msg.isRead ? 'RO' : 'O'],
            ['X-Bloomx-Source-Folder', folderPath],
        ],
    });
    return { raw, date, from: from?.email ?? 'bloomx@localhost' };
}

export interface FolderRef { folder: any; path: string; key: string }

export function collectFolders(root: any): FolderRef[] {
    const out: FolderRef[] = [];
    const walk = (f: any, p: string[]) => {
        let subs: any[] = [];
        try { subs = f.hasSubfolders ? f.getSubFolders() : []; } catch { subs = []; }
        for (const s of subs) {
            const np = [...p, String(s.displayName || 'Carpeta')];
            const cls = String(s.containerClass || '');
            if (s.contentCount > 0 && (!cls || /^IPF\.Note/i.test(cls))) {
                const p2 = np.join('/');
                out.push({ folder: s, path: p2, key: `${p2}#${s.descriptorIndexNode?.descriptorIdentifier ?? ''}` });
            }
            walk(s, np);
        }
    };
    walk(root, []);
    return out;
}

type Step =
    | { k: 'end' }
    | { k: 'folderEnd' }
    | { k: 'skip'; next: number }
    | { k: 'msg'; next: number; raw: Buffer; date: Date; from: string };

/** Devuelve el conversor para `EngineDeps.pstConvert`. */
export function makePstConverter(limits: { maxPstBytes: number; maxMessageBytes: number }, hooks: { onReader?: (r: PstRangeReader) => void; readerOpts?: ConstructorParameters<typeof PstRangeReader>[1] } = {}): NonNullable<EngineDeps['pstConvert']> {
    return async (job: JobRow, d: ArchiveDeps, deadline: number) => {
        if (job.totalBytes > limits.maxPstBytes) throw new ArchiveError('pst_too_large');
        const cur: PstCursor = { fi: 0, mi: 0, w: { nextChunk: 0, totalBytes: 0, tailVersion: 0 }, converted: 0, skipped: 0, ...(job.cursor.pst ?? {}) };
        const source = d.state.gzSize !== undefined
            ? new ChunkedSource(d.storage, `${d.prefix}/x/gz`, d.state.gzSize)
            : new ChunkedSource(d.storage, `${d.prefix}/src`, d.totalBytes);
        if (source.size > limits.maxPstBytes) throw new ArchiveError('pst_too_large');

        const { PSTFile, PSTMessage } = await import('pst-extractor');
        const RangePst = makeRangePstClass(PSTFile);
        const reader = new PstRangeReader(source, hooks.readerOpts);
        hooks.onReader?.(reader);
        let pst: any = null;
        let folders: FolderRef[] | null = null;
        const discard = () => { pst = null; folders = null; };
        const ensureOpen = () => {
            if (pst && folders) return;
            pst = new RangePst(reader);
            folders = collectFolders(pst.getRootFolder());
        };
        // Relocaliza la carpeta por clave si el orden cambio entre ticks (idempotente).
        const relocate = () => {
            const fs_ = folders!;
            if (cur.fk && fs_[cur.fi]?.key !== cur.fk) {
                const j = fs_.findIndex((f) => f.key === cur.fk);
                if (j >= 0) cur.fi = j;
                else { cur.mi = 0; } // carpeta desaparecida: se empieza la que ocupe ese indice
            }
            if (cur.fi < fs_.length) cur.fk = fs_[cur.fi].key;
        };

        try {
            await runWithReader(reader, ensureOpen, discard);
        } catch (e) {
            if (e instanceof PstFnError) throw new ArchiveError('pst_unreadable');
            throw e;
        }

        const w = new ChunkWriter(d.storage, `${d.prefix}/x/pst`, cur.w);
        await w.resume();
        let done = false;
        let did = 0;
        const step = (): Step => {
            ensureOpen();
            relocate();
            const fl = folders!;
            if (cur.fi >= fl.length) return { k: 'end' };
            const { folder, path: fpath } = fl[cur.fi];
            folder.moveChildCursorTo(cur.mi);
            let child: any;
            try { child = folder.getNextChild(); } catch { return { k: 'folderEnd' }; }
            if (child === null || child === undefined) return { k: 'folderEnd' };
            // getNextChild puede saltar hijos ilegibles internamente: el cursor real es su indice interno
            const inner = Number(folder.currentEmailIndex);
            const next = Number.isFinite(inner) && inner > cur.mi ? inner : cur.mi + 1;
            if (!(child instanceof PSTMessage) || !/^IPM\.(Note|Schedule|Post)/i.test(String(child.messageClass || 'IPM.Note'))) return { k: 'skip', next };
            try {
                const m = pstMessageToMime(child, fpath, limits.maxMessageBytes);
                if (m.raw.length > limits.maxMessageBytes) return { k: 'skip', next };
                return { k: 'msg', next, raw: m.raw, date: m.date, from: m.from };
            } catch {
                return { k: 'skip', next };
            }
        };
        try {
            for (;;) {
                if (did > 0 && Date.now() > deadline) break;
                let r: Step;
                try {
                    r = await runWithReader(reader, step, discard);
                } catch (e) {
                    if (e instanceof PstFnError) throw new ArchiveError('pst_unreadable');
                    throw e;
                }
                if (r.k === 'end') { done = true; break; }
                if (r.k === 'folderEnd') { cur.fi++; cur.mi = 0; cur.fk = undefined; continue; }
                did++;
                if (r.k === 'skip') { cur.skipped++; cur.mi = r.next; continue; }
                await w.write(mboxRecord(mboxFromLine(r.date, r.from), r.raw));
                cur.converted++;
                cur.mi = r.next;
            }
        } finally {
            try { pst?.close(); } catch { /* ya cerrado */ }
        }
        if (done) {
            const size = await w.finish();
            await removePstTemp(job.id);
            return { done: true, size, cursor: { ...cur, w: w.state() } };
        }
        await w.flushTail();
        return { done: false, cursor: { ...cur, w: w.state() } };
    };
}
