/**
 * export-engine.ts - exportacion en segundo plano a un paquete ZIP (MBOX o EML) escrito por trozos en el storage.
 *
 * Paquete:  <buzon>/<Carpeta>.mbox (partes de hasta 32 MB: <Carpeta>.partNNN.mbox)   o   <buzon>/<Carpeta>/<fecha>_<asunto>_<id>.eml
 *           + manifest.json (buzones, carpetas, etiquetas, conteos, fechas y sha256 de cada archivo).
 * Cifrado opcional: contenedor BLMXENC1 (package-crypto.ts) sobre el ZIP completo.
 *
 * Reanudable: cada tick guarda el cursor (buzon, carpeta, clave de paginacion, estado de los escritores). Los escritores de trozos
 * versionan la cola: si el proceso cae entre escribir la salida y guardar el cursor, se reanuda desde el cursor anterior y los
 * trozos se reescriben de forma determinista.
 */
import { createHash } from 'node:crypto';
import { auditLog } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { decrypt } from '@/lib/encryption';
import {
    buildStoredCentral, buildStoredHeader, buildZipEnd, buildZipEntry, crc32,
} from './zip';
import { buildMime, mboxFromLine, renderHeaderLines } from './mime-build';
import { rawEmlKey, type RawMimeFetcher } from '@/lib/raw-mime';
import { listLabels } from '@/lib/labels/store';
import { FOLDER_EXPORT_NAMES, formatGmailLabels, gmailLabelsFor, safeArchivePath } from './formats';
import { mboxRecord } from './mbox';
import { parseAddressList, parseMailDate } from './mime-parse';
import { PackageEncryptor, ENC_RECORD_SIZE, type EncryptionParams } from './package-crypto';
import { CHUNK_SIZE, ChunkWriter, ChunkedSource, type TransferStorage } from './source';
import { findUsersByEmail } from './mailboxes';
import { stripHtml } from './ingest';
import { items as itemStore, jobs, type JobRow } from './store';
import { jobPrefix } from './limits';
import { purgeJobStorage, type EngineDeps, type TickResult } from './import-engine';

export interface ExportOptions {
    scopeMode: 'domain' | 'selected' | 'one' | 'self';
    /** Incluir contactos.vcf, calendar.ics y mailFilters.xml por buzon (por defecto si). */
    includePim?: boolean;
    mailboxes: string[];
    folders: string[];
    from?: string | null;
    to?: string | null;
    includeAttachments: boolean;
    format: 'mbox' | 'eml';
    encrypted?: boolean;
    /** Parametros de cifrado: la CLAVE va cifrada con la clave de datos de la instancia; se borra al terminar. */
    enc?: { salt: string; noncePrefix: string; keyEnc: string };
    oneTime?: boolean;
    notifyUsers?: boolean;
}

const PART_MAX = 32 * 1024 * 1024;
const BATCH = 40;
const HASH_MAX_BYTES = 1.5 * 1024 * 1024 * 1024;

interface Stats {
    [mailbox: string]: { messages: number; bytes: number; folders: Record<string, number> };
}

// ---------------------------------------------------------------------------------------------------------------------
// Escritor del paquete
// ---------------------------------------------------------------------------------------------------------------------

export class PackageWriter {
    readonly out: ChunkWriter;
    readonly cd: ChunkWriter;
    readonly mf: ChunkWriter;
    zipOffset: number;
    entries: number;
    mfCount: number;
    private enc: PackageEncryptor | null;
    private plain: Buffer[] = [];
    private plainBytes = 0;

    constructor(storage: TransferStorage, prefix: string, st: PackageState, enc: EncryptionParams | null) {
        this.out = new ChunkWriter(storage, `${prefix}/out`, st.out);
        this.cd = new ChunkWriter(storage, `${prefix}/cd`, st.cd);
        this.mf = new ChunkWriter(storage, `${prefix}/mf`, st.mf);
        this.zipOffset = st.zipOffset;
        this.entries = st.entries;
        this.mfCount = st.mfCount;
        this.enc = enc ? new PackageEncryptor(enc, st.encCounter) : null;
        this.headerWritten = st.out.totalBytes > 0 || !enc;
    }

    private headerWritten: boolean;

    async resume(): Promise<void> {
        await Promise.all([this.out.resume(), this.cd.resume(), this.mf.resume()]);
    }

    private async emit(buf: Buffer): Promise<void> {
        this.zipOffset += buf.length;
        if (!this.enc) { await this.out.write(buf); return; }
        if (!this.headerWritten) { await this.out.write(this.enc.header); this.headerWritten = true; }
        this.plain.push(buf);
        this.plainBytes += buf.length;
        if (this.plainBytes >= ENC_RECORD_SIZE) await this.flushPlain();
    }

    private async flushPlain(): Promise<void> {
        if (!this.enc || this.plainBytes === 0) return;
        const all = this.plain.length === 1 ? this.plain[0] : Buffer.concat(this.plain);
        this.plain = [];
        this.plainBytes = 0;
        await this.out.write(this.enc.encrypt(all));
    }

    /** Anade un archivo al ZIP (en memoria: entradas de hasta ~64 MB). Devuelve sha256 y tamano del contenido. */
    async addFile(name: string, data: Buffer, date: Date): Promise<{ sha256: string; size: number }> {
        const safe = safeArchivePath(name);
        if (!safe) throw new Error('unsafe_name');
        const e = buildZipEntry(safe, data, this.zipOffset, { date, deflate: true });
        await this.emit(e.local);
        await this.cd.write(e.central);
        this.entries++;
        return { sha256: createHash('sha256').update(data).digest('hex'), size: data.length };
    }

    async addManifestFile(obj: Record<string, unknown>): Promise<void> {
        await this.mf.write(Buffer.from((this.mfCount > 0 ? ',\n' : '') + JSON.stringify(obj), 'utf8'));
        this.mfCount++;
    }

    /** Fin de tick: vuelca el resto del cifrado y las colas. NO borra las colas antiguas (hacerlo tras guardar el cursor). */
    async flush(): Promise<void> {
        await this.flushPlain();
        await Promise.all([this.out.flushTail(), this.cd.flushTail(), this.mf.flushTail()]);
    }

    async dropOldTails(): Promise<void> {
        await Promise.all([this.out.dropOldTails(), this.cd.dropOldTails(), this.mf.dropOldTails()]);
    }

    state(): PackageState {
        return { out: this.out.state(), cd: this.cd.state(), mf: this.mf.state(), zipOffset: this.zipOffset, entries: this.entries, mfCount: this.mfCount, encCounter: this.enc?.counter ?? 0 };
    }

    /** Cierra el ZIP: manifest.json (stored), directorio central y EOCD; registro final del cifrado. Devuelve el tamano final. */
    async finalize(manifestHead: string, manifestTail: string, date: Date): Promise<number> {
        await this.mf.finish();
        const fragBytes = this.mf.totalBytes;
        const head = Buffer.from(manifestHead, 'utf8');
        const tail = Buffer.from(manifestTail, 'utf8');
        const mfSrc = new ChunkedSource(this.mfStorage(), `${this.mfPrefix()}`, fragBytes);
        // CRC en una pasada por los fragmentos
        let crc = crc32(head);
        for (let pos = 0; pos < fragBytes; pos += CHUNK_SIZE) crc = crc32(await mfSrc.read(pos, CHUNK_SIZE), crc);
        crc = crc32(tail, crc);
        const size = head.length + fragBytes + tail.length;
        const offset = this.zipOffset;
        const hdr = buildStoredHeader('manifest.json', size, crc, date);
        await this.emit(hdr.local);
        await this.emit(head);
        for (let pos = 0; pos < fragBytes; pos += CHUNK_SIZE) await this.emit(await mfSrc.read(pos, CHUNK_SIZE));
        await this.emit(tail);
        await this.cd.write(buildStoredCentral('manifest.json', size, crc, offset, date));
        this.entries++;
        // Directorio central
        await this.cd.finish();
        const cdSize = this.cd.totalBytes;
        const cdOffset = this.zipOffset;
        const cdSrc = new ChunkedSource(this.mfStorage(), this.cdPrefix(), cdSize);
        for (let pos = 0; pos < cdSize; pos += CHUNK_SIZE) await this.emit(await cdSrc.read(pos, CHUNK_SIZE));
        await this.emit(buildZipEnd(this.entries, cdSize, cdOffset));
        await this.flushPlain();
        if (this.enc) await this.out.write(this.enc.finalRecord());
        return this.out.finish();
    }

    // Acceso interno al storage/prefijos (los ChunkWriter no los exponen)
    private mfStorage(): TransferStorage { return (this.mf as any).storage; }
    private mfPrefix(): string { return (this.mf as any).prefix; }
    private cdPrefix(): string { return (this.cd as any).prefix; }
}

export interface PackageState {
    out: { nextChunk: number; totalBytes: number; tailVersion: number };
    cd: { nextChunk: number; totalBytes: number; tailVersion: number };
    mf: { nextChunk: number; totalBytes: number; tailVersion: number };
    zipOffset: number;
    entries: number;
    mfCount: number;
    encCounter: number;
}

export const emptyPackageState = (): PackageState => ({
    out: { nextChunk: 0, totalBytes: 0, tailVersion: 0 },
    cd: { nextChunk: 0, totalBytes: 0, tailVersion: 0 },
    mf: { nextChunk: 0, totalBytes: 0, tailVersion: 0 },
    zipOffset: 0, entries: 0, mfCount: 0, encCounter: 0,
});

// ---------------------------------------------------------------------------------------------------------------------
// Reconstruccion del mensaje
// ---------------------------------------------------------------------------------------------------------------------

type EmailWithRels = Awaited<ReturnType<typeof loadBatch>>[number];

async function loadBatch(userId: string, folder: string, after: { ts: string; id: string } | null, o: ExportOptions) {
    const and: any[] = [{ userId }, { folder }];
    if (o.from) and.push({ createdAt: { gte: new Date(o.from) } });
    if (o.to) and.push({ createdAt: { lte: new Date(o.to) } });
    if (after) {
        const ts = new Date(after.ts);
        and.push({ OR: [{ createdAt: { gt: ts } }, { createdAt: ts, id: { gt: after.id } }] });
    }
    const rows = await prisma.email.findMany({
        where: { AND: and },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: BATCH,
        include: { attachments: true, labels: { select: { id: true, name: true } } },
    });
    // Etiquetas jerarquicas: se exporta la RUTA completa ("Trabajo/Proyecto A") y se marca si la etiqueta es una carpeta.
    let info = new Map<string, { path: string; folder: boolean }>();
    if (rows.some((r) => r.labels.length > 0)) {
        info = new Map((await listLabels(userId).catch(() => [])).map((l) => [l.id, { path: l.fullPath, folder: l.behavior === 'folder' }]));
    }
    return rows.map((r) => ({ ...r, labels: r.labels.map((l) => ({ name: info.get(l.id)?.path ?? l.name, folder: info.get(l.id)?.folder === true })) }));
}

/** Directorio propio de un correo dentro de una etiqueta-carpeta (Archive/Trabajo/Proyecto A), o null. */
export function folderLabelDir(labels: Array<{ name: string; folder: boolean }>): string | null {
    const f = labels.find((l) => l.folder);
    if (!f) return null;
    const segs = f.name.split('/').map((x) => x.replace(/[\/:*?"<>| -]/g, '_').trim().slice(0, 100)).filter((x) => x && x !== '.' && x !== '..');
    return segs.length ? segs.join('/') : null;
}

function headersOfRaw(json: string | null): Record<string, string> {
    if (!json) return {};
    try {
        const p = JSON.parse(json);
        const h = p?.data?.headers ?? p?.headers ?? {};
        const out: Record<string, string> = {};
        if (Array.isArray(h)) {
            for (const e of h) if (e && typeof e.name === 'string') out[e.name.toLowerCase()] = String(e.value ?? '');
        } else if (h && typeof h === 'object') {
            for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
        }
        return out;
    } catch {
        return {};
    }
}

/** Mensaje RFC 822 de un correo almacenado (cuerpo y adjuntos desde el storage). */
export type MimeSource = 'stored' | 'url' | 'rebuilt';

export interface BuildMessageOpts {
    /** Descarga del MIME original desde Email.rawMimeUrl (correos anteriores a raw.eml). Sin el, solo se usa raw.eml o la reconstruccion. */
    fetchRaw?: RawMimeFetcher;
}

/** Quita una linea "From " de mbox inicial y espacios en blanco previos a las cabeceras. */
function stripMboxPrefix(b: Buffer): Buffer {
    let s = 0;
    if (b.toString('latin1', 0, 5) === 'From ') {
        const nl = b.indexOf(0x0a);
        s = nl >= 0 ? nl + 1 : b.length;
    }
    return s ? b.subarray(s) : b;
}

export async function buildEmailMessage(storage: TransferStorage, e: EmailWithRels, userEmail: string, o: Pick<ExportOptions, 'includeAttachments'>, x: BuildMessageOpts = {}): Promise<{ raw: Buffer; date: Date; messageId: string; warnings: number; source: MimeSource }> {
    let warnings = 0;
    const suffix0 = `-${e.userId}`;
    const messageId0 = e.messageId.endsWith(suffix0) ? e.messageId.slice(0, -suffix0.length) : e.messageId;
    // 1) MIME ORIGINAL (raw.eml guardado por process-attachments) o, para correos antiguos, bajado de rawMimeUrl sin bloquear.
    //    Se conservan tal cual las cabeceras (Received, Authentication-Results, DKIM...) y se ANTEPONEN las de carpeta/etiquetas/banderas.
    //    Con includeAttachments=false se reconstruye (el original lleva los adjuntos dentro).
    if (o.includeAttachments) {
        let orig: Buffer | null = null;
        let source: MimeSource = 'stored';
        const ek = rawEmlKey(e.rawKey);
        if (ek) orig = await storage.get(ek).catch(() => null);
        if ((!orig || orig.length === 0) && e.rawMimeUrl && x.fetchRaw) {
            orig = await x.fetchRaw(e.rawMimeUrl).catch(() => null);
            source = 'url';
        }
        if (orig && orig.length > 0) {
            const labelNames0 = e.labels.map((l) => l.name);
            const head = renderHeaderLines([
                ['X-Gmail-Labels', formatGmailLabels(gmailLabelsFor({ folder: e.folder, read: e.read, starred: e.starred, labels: labelNames0 }))],
                ['Status', e.read ? 'RO' : 'O'],
                ...(e.starred ? [['X-Status', 'F'] as [string, string]] : []),
                ['X-Bloomx-Folder', e.folder],
                ['X-Bloomx-Flags', [e.read ? 'read' : 'unread', ...(e.starred ? ['starred'] : [])].join(',')],
                ['X-Bloomx-Mailbox', userEmail],
                ...(labelNames0.length ? [['X-Bloomx-Labels', formatGmailLabels(labelNames0)] as [string, string]] : []),
            ]);
            return { raw: Buffer.concat([Buffer.from(head, 'latin1'), stripMboxPrefix(orig)]), date: e.createdAt, messageId: messageId0, warnings: 0, source };
        }
    }
    const [htmlBuf, textBuf, rawBuf] = await Promise.all([
        e.htmlKey ? storage.get(e.htmlKey) : null,
        e.textKey ? storage.get(e.textKey) : null,
        e.rawKey ? storage.get(e.rawKey) : null,
    ]);
    if ((e.htmlKey && !htmlBuf) || (e.textKey && !textBuf)) warnings++;
    const rh = headersOfRaw(rawBuf ? rawBuf.toString('utf8') : null);
    const html = htmlBuf?.toString('utf8') ?? '';
    const text = textBuf?.toString('utf8') ?? '';
    const atts: Array<{ filename: string; contentType: string; content: Buffer; contentId?: string | null; inline?: boolean }> = [];
    if (o.includeAttachments) {
        for (const a of e.attachments) {
            if (!a.key || a.key === 'PENDING' || a.key === 'BLOCKED' || a.status !== 'ready') continue;
            const content = await storage.get(a.key);
            if (!content) { warnings++; continue; }
            const cid = (a as any).contentId as string | null | undefined;
            atts.push({ filename: a.filename, contentType: a.mimeType, content, contentId: cid, inline: !!cid && html.includes(`cid:${cid}`) });
        }
    }
    const suffix = `-${e.userId}`;
    const messageId = e.messageId.endsWith(suffix) ? e.messageId.slice(0, -suffix.length) : e.messageId;
    // Fecha: la del correo (createdAt = original en importados); la cabecera original de Resend solo si coincide con el dia
    const date = e.createdAt;
    void parseMailDate;
    const from = parseAddressList(e.from)[0] ?? { name: '', email: 'unknown@unknown.local' };
    const labelNames = e.labels.map((l) => l.name);
    const flagList = [e.read ? 'read' : 'unread', ...(e.starred ? ['starred'] : [])];
    const raw = buildMime({
        from: { name: from.name, email: from.email },
        to: parseAddressList(e.to),
        cc: parseAddressList(e.cc ?? ''),
        bcc: parseAddressList(e.bcc ?? ''),
        replyTo: e.replyTo ? parseAddressList(e.replyTo)[0] ?? null : null,
        subject: e.subject ?? '',
        date,
        messageId,
        inReplyTo: (rh['in-reply-to'] || '').replace(/[<>\s]/g, '') || null,
        references: (rh['references'] || '').match(/<[^<>\s]+>/g)?.map((r) => r.slice(1, -1)),
        text: text || (html ? '' : e.snippet ?? ''),
        html,
        attachments: atts,
        extraHeaders: [
            ['X-Gmail-Labels', formatGmailLabels(gmailLabelsFor({ folder: e.folder, read: e.read, starred: e.starred, labels: labelNames }))],
            ['Status', e.read ? 'RO' : 'O'],
            ...(e.starred ? [['X-Status', 'F'] as [string, string]] : []),
            ['X-Bloomx-Folder', e.folder],
            ['X-Bloomx-Flags', flagList.join(',')],
            ['X-Bloomx-Mailbox', userEmail],
            ...(labelNames.length ? [['X-Bloomx-Labels', formatGmailLabels(labelNames)] as [string, string]] : []),
        ],
    });
    return { raw, date, messageId, warnings, source: 'rebuilt' };
}

// ---------------------------------------------------------------------------------------------------------------------
// Borradores, contactos, calendario y filtros
// ---------------------------------------------------------------------------------------------------------------------

const MAX_DRAFTS = 5000;

/** Borradores propios (Draft.from = direccion del buzon) -> `<buzon>/Drafts.mbox` o `<buzon>/Drafts/*.eml`, con X-Bloomx-Draft: 1. */
async function exportDrafts(
    storage: TransferStorage, writer: PackageWriter, mailbox: string, userEmail: string, o: ExportOptions, cur: ExportCursor,
    st: { messages: number; bytes: number; folders: Record<string, number> },
): Promise<number> {
    const drafts = await prisma.draft.findMany({
        where: { from: { equals: userEmail, mode: 'insensitive' } },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: MAX_DRAFTS,
        include: { attachments: true },
    });
    if (drafts.length === 0) return 0;
    const mbox: Buffer[] = [];
    let min: Date | null = null;
    let max: Date | null = null;
    let bytes = 0;
    for (const d of drafts) {
        const html = d.body ?? '';
        const atts: Array<{ filename: string; contentType: string; content: Buffer }> = [];
        if (o.includeAttachments) {
            for (const a of d.attachments) {
                if (!a.key || a.key === 'PENDING' || a.key === 'BLOCKED' || a.status !== 'ready') continue;
                const content = await storage.get(a.key);
                if (!content) { cur.warnings++; continue; }
                atts.push({ filename: a.filename, contentType: a.mimeType, content });
            }
        }
        const raw = buildMime({
            from: { email: userEmail },
            to: parseAddressList(d.to ?? ''),
            cc: parseAddressList(d.cc ?? ''),
            bcc: parseAddressList(d.bcc ?? ''),
            subject: d.subject ?? '',
            date: d.updatedAt,
            messageId: `draft-${d.id}@drafts.bloomx.local`,
            text: stripHtml(html),
            html,
            attachments: atts,
            extraHeaders: [
                ['X-Bloomx-Draft', '1'],
                ['X-Gmail-Labels', 'Drafts'],
                ['X-Bloomx-Folder', 'drafts'],
                ['X-Bloomx-Mailbox', userEmail],
            ],
        });
        bytes += raw.length;
        if (!min || d.updatedAt < min) min = d.updatedAt;
        if (!max || d.updatedAt > max) max = d.updatedAt;
        if (o.format === 'mbox') {
            mbox.push(mboxRecord(mboxFromLine(d.updatedAt, userEmail), raw));
        } else {
            const name = `${mailbox}/Drafts/${stamp(d.updatedAt)}_${slug(d.subject ?? '')}_${d.id.slice(-6)}.eml`;
            const { sha256, size } = await writer.addFile(name, raw, d.updatedAt);
            await writer.addManifestFile({ path: name, mailbox, folder: 'drafts', draft: true, messageId: `draft-${d.id}@drafts.bloomx.local`, date: d.updatedAt.toISOString(), bytes: size, sha256 });
        }
    }
    if (o.format === 'mbox') {
        const name = `${mailbox}/Drafts.mbox`;
        const { sha256, size } = await writer.addFile(name, Buffer.concat(mbox), max ?? new Date());
        await writer.addManifestFile({ path: name, mailbox, folder: 'drafts', draft: true, messages: drafts.length, bytes: size, sha256, dateMin: min?.toISOString() ?? null, dateMax: max?.toISOString() ?? null });
    }
    st.messages += drafts.length;
    st.bytes += bytes;
    st.folders['drafts'] = drafts.length;
    return drafts.length;
}

/** contacts.vcf (vCard 4.0), calendar.ics y mailFilters.xml del buzon, si tiene datos. */
async function exportPim(writer: PackageWriter, mailbox: string, userId: string, cur: ExportCursor): Promise<void> {
    const pim = await import('./pim');
    const flags: { contacts: boolean; calendar: boolean; filters: boolean } = (cur.pimStats[mailbox] = { contacts: false, calendar: false, filters: false });
    const at = new Date();
    const add = async (name: string, data: Buffer | null, kind: 'contacts' | 'calendar' | 'filters') => {
        if (!data || data.length === 0) return;
        const { sha256, size } = await writer.addFile(`${mailbox}/${name}`, data, at);
        await writer.addManifestFile({ path: `${mailbox}/${name}`, mailbox, kind, bytes: size, sha256 });
        flags[kind] = true;
    };
    await add('contacts.vcf', await pim.exportContactsVcf(userId), 'contacts');
    await add('calendar.ics', await pim.exportCalendarIcs(userId), 'calendar');
    await add('mailFilters.xml', await pim.exportFiltersXml(userId), 'filters');
}

function slug(s: string): string {
    return (s || 'sin-asunto').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'mensaje';
}
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
export const folderDir = (folder: string) => FOLDER_EXPORT_NAMES[folder] ?? folder.replace(/[^A-Za-z0-9 _.-]/g, '_').slice(0, 40) ?? 'Folder';

// ---------------------------------------------------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------------------------------------------------

interface ExportCursor {
    mi: number;
    /** carpetas del buzon actual (null = aun sin cargar) */
    folders: string[] | null;
    fi: number;
    after: { ts: string; id: string } | null;
    pkg: PackageState;
    stats: Stats;
    part: { n: number };
    warnings: number;
    phase: 'messages' | 'done';
    /** Origen del MIME exportado: raw.eml guardado, descargado de rawMimeUrl o reconstruido. */
    mime: { stored: number; url: number; rebuilt: number };
    /** Borradores del buzon actual ya exportados. */
    dr: boolean;
    /** Datos personales (contactos, calendario, filtros) del buzon actual ya exportados. */
    pim: boolean;
    /** Resumen de datos personales exportados por buzon. */
    pimStats: Record<string, { contacts: boolean; calendar: boolean; filters: boolean }>;
}

const freshCursor = (): ExportCursor => ({ mi: 0, folders: null, fi: 0, after: null, pkg: emptyPackageState(), stats: {}, part: { n: 0 }, warnings: 0, phase: 'messages', mime: { stored: 0, url: 0, rebuilt: 0 }, dr: false, pim: false, pimStats: {} });

export function encryptionFromOptions(o: ExportOptions): EncryptionParams | null {
    if (!o.enc) return null;
    return { salt: Buffer.from(o.enc.salt, 'hex'), noncePrefix: Buffer.from(o.enc.noncePrefix, 'hex'), key: Buffer.from(decrypt(o.enc.keyEnc), 'hex') };
}

export async function runExportTick(jobId: string, deps: EngineDeps): Promise<TickResult> {
    const job = await jobs.lock(jobId, ['queued', 'running'], deps.limits.lockMs);
    if (!job) return { ran: false, more: false, reason: 'not_runnable_or_locked', processed: 0 };
    if (job.kind !== 'export') { await jobs.unlock(job.id); return { ran: false, more: false, reason: 'not_export', processed: 0 }; }
    try {
        if (job.cancelRequested) {
            await jobs.update(job.id, { status: 'canceled', finishedAt: new Date(), phase: '', options: stripSecrets(job.options) });
            await purgeJobStorage(job.id, deps).catch(() => undefined);
            auditLog('admin.mail_transfer.canceled', { userId: job.userId, jobId: job.id, kind: 'export' });
            return { ran: true, status: 'canceled', more: false, processed: 0 };
        }
        if (job.status === 'queued') {
            await jobs.update(job.id, { status: 'running', startedAt: job.startedAt ?? new Date(), phase: 'export' });
            job.status = 'running';
        }
        return await exportStep(job, deps);
    } catch (e) {
        console.error('[mail-transfer] export tick failed:', e instanceof Error ? e.message.slice(0, 200) : 'error');
        const msg = e instanceof Error ? e.message : '';
        const fatal = /unsafe_name|tail_missing|chunk_/.test(msg);
        if (fatal) {
            await jobs.update(job.id, { status: 'failed', lastError: 'storage_inconsistent', finishedAt: new Date(), phase: '', options: stripSecrets(job.options) });
            await purgeJobStorage(job.id, deps).catch(() => undefined);
            auditLog('admin.mail_transfer.failed', { userId: job.userId, jobId: job.id, kind: 'export', code: 'storage_inconsistent' });
            return { ran: true, status: 'failed', more: false, reason: 'storage_inconsistent', processed: 0 };
        }
        await jobs.update(job.id, { lastError: 'internal' });
        return { ran: true, status: 'running', more: false, reason: 'internal', processed: 0 };
    } finally {
        await jobs.unlock(job.id).catch(() => undefined);
    }
}

/** Quita el material de cifrado de las opciones (se llama al terminar/cancelar/fallar). */
export function stripSecrets(o: Record<string, any>): Record<string, any> {
    const { enc, zipPw, ...rest } = o;
    void zipPw;
    return enc ? { ...rest, enc: { salt: enc.salt, noncePrefix: enc.noncePrefix, keyEnc: '' } } : rest;
}

async function exportStep(job: JobRow, deps: EngineDeps): Promise<TickResult> {
    const started = deps.now();
    const deadline = started + deps.limits.budgetMs;
    const o = job.options as ExportOptions;
    const prefix = jobPrefix(job.id);
    const cur: ExportCursor = { ...freshCursor(), ...(job.cursor as Partial<ExportCursor>) };
    const writer = new PackageWriter(deps.storage, prefix, cur.pkg, encryptionFromOptions(o));
    await writer.resume();
    const users = await findUsersByEmail(o.mailboxes);
    let processed = 0;
    let stop = false;

    while (!stop && cur.mi < o.mailboxes.length) {
        const email = o.mailboxes[cur.mi].toLowerCase();
        const user = users.get(email);
        if (!user) {
            // Buzon borrado durante el trabajo: se registra y se sigue
            await itemStore.record({ jobId: job.id, mailbox: email, sourceKey: `mbx:${email}`, status: 'error', error: 'user_not_found' });
            cur.mi++; cur.folders = null; cur.fi = 0; cur.after = null; cur.dr = false; cur.pim = false;
            continue;
        }
        if (cur.folders === null) {
            const rows = await prisma.email.groupBy({ by: ['folder'], where: { userId: user.id } });
            const wanted = o.folders?.length ? new Set(o.folders) : null;
            cur.folders = rows.map((r) => r.folder).filter((f) => !wanted || wanted.has(f)).sort();
            cur.fi = 0; cur.after = null; cur.part = { n: 0 };
            cur.stats[email] ||= { messages: 0, bytes: 0, folders: {} };
        }
        while (!stop && cur.fi < cur.folders.length) {
            const folder = cur.folders[cur.fi];
            const dir = `${email}/${folderDir(folder)}`;
            let mbox: Buffer[] = [];
            let mboxBytes = 0;
            let mboxCount = 0;
            let mboxMin: Date | null = null;
            let mboxMax: Date | null = null;
            const flushPart = async () => {
                if (mboxCount === 0) return;
                cur.part.n++;
                const name = `${dir}${cur.part.n > 1 ? `.part${String(cur.part.n).padStart(3, '0')}` : ''}.mbox`;
                const data = Buffer.concat(mbox);
                const { sha256, size } = await writer.addFile(name, data, mboxMax ?? new Date());
                await writer.addManifestFile({ path: name, mailbox: email, folder, messages: mboxCount, bytes: size, sha256, dateMin: mboxMin?.toISOString() ?? null, dateMax: mboxMax?.toISOString() ?? null });
                mbox = []; mboxBytes = 0; mboxCount = 0; mboxMin = null; mboxMax = null;
            };
            for (;;) {
                const batch = await loadBatch(user.id, folder, cur.after, o);
                if (batch.length === 0) break;
                for (const e of batch) {
                    const m = await buildEmailMessage(deps.storage, e, user.email, o, { fetchRaw: deps.fetchRaw });
                    cur.warnings += m.warnings;
                    cur.mime[m.source]++;
                    if (o.format === 'mbox') {
                        const rec = mboxRecord(mboxFromLine(m.date, user.email), m.raw);
                        mbox.push(rec);
                        mboxBytes += rec.length;
                        mboxCount++;
                        if (!mboxMin || m.date < mboxMin) mboxMin = m.date;
                        if (!mboxMax || m.date > mboxMax) mboxMax = m.date;
                        if (mboxBytes >= PART_MAX) await flushPart();
                    } else {
                        const labelDir = folderLabelDir(e.labels);
                        const name = `${dir}${labelDir ? `/${labelDir}` : ''}/${stamp(m.date)}_${slug(e.subject ?? '')}_${e.id.slice(-6)}.eml`;
                        const { sha256, size } = await writer.addFile(name, m.raw, m.date);
                        await writer.addManifestFile({ path: name, mailbox: email, folder, messageId: m.messageId, date: m.date.toISOString(), bytes: size, sha256, labels: e.labels.map((l) => l.name), read: e.read, starred: e.starred });
                    }
                    const st = cur.stats[email];
                    st.messages++;
                    st.bytes += m.raw.length;
                    st.folders[folder] = (st.folders[folder] ?? 0) + 1;
                    cur.after = { ts: e.createdAt.toISOString(), id: e.id };
                    processed++;
                }
                if (deps.now() > deadline || processed >= deps.limits.maxItemsPerTick) { stop = true; break; }
                const fresh = await jobs.get(job.id);
                if (fresh?.cancelRequested) { stop = true; break; }
                await jobs.extendLock(job.id, deps.limits.lockMs);
                if (batch.length < BATCH) break;
            }
            await flushPart();
            if (stop) break;
            cur.fi++; cur.after = null; cur.part = { n: 0 };
        }
        if (stop) break;
        // Borradores propios (tabla Draft) -> Drafts.mbox / Drafts/*.eml con X-Bloomx-Draft
        if (!cur.dr) {
            if (!o.folders?.length || o.folders.includes('drafts')) {
                const st = (cur.stats[email] ||= { messages: 0, bytes: 0, folders: {} });
                const n = await exportDrafts(deps.storage, writer, email, user.email, o, cur, st);
                processed += n;
            }
            cur.dr = true;
        }
        // Contactos (vCard 4.0), calendario (iCalendar) y filtros (Gmail XML) del buzon
        if (!cur.pim) {
            if (o.includePim !== false) await exportPim(writer, email, user.id, cur);
            cur.pim = true;
        }
        await itemStore.record({ jobId: job.id, mailbox: email, sourceKey: `mbx:${email}`, status: 'done', bytes: cur.stats[email]?.bytes ?? 0 });
        cur.mi++; cur.folders = null; cur.fi = 0; cur.after = null; cur.dr = false; cur.pim = false;
    }

    const doneCount = Object.values(cur.stats).reduce((s, x) => s + x.messages, 0);
    if (!stop) cur.phase = 'done';
    await writer.flush();
    cur.pkg = writer.state();
    await jobs.update(job.id, { cursor: cur, doneItems: doneCount, importedItems: doneCount, bytesProcessed: writer.zipOffset, summary: { stats: cur.stats, warnings: cur.warnings, mime: cur.mime, pim: cur.pimStats } });
    await writer.dropOldTails();

    if (stop) return { ran: true, status: 'running', more: true, processed };

    // ---- finalizar el paquete
    const at = new Date(deps.now());
    const head = JSON.stringify({
        version: 1, generator: 'bloomx-mail-transfer', generatedAt: at.toISOString(), format: o.format, encrypted: !!o.encrypted, includeAttachments: o.includeAttachments,
        filters: { folders: o.folders ?? [], from: o.from ?? null, to: o.to ?? null },
        mailboxes: Object.entries(cur.stats).map(([mailbox, s]) => ({ mailbox, messages: s.messages, bytes: s.bytes, folders: s.folders })),
        totals: { mailboxes: Object.keys(cur.stats).length, messages: doneCount },
        mimeSource: cur.mime,
        pim: cur.pimStats,
        notes: 'mbox: mboxrd; X-Gmail-Labels, Status, X-Status, X-Bloomx-Folder y X-Bloomx-Flags conservan carpeta, etiquetas y banderas.',
    }).replace(/\}$/, ',\n"files":[\n');
    const outBytes = await writer.finalize(head, '\n]}\n', at);
    let sha: string | null = null;
    if (outBytes <= HASH_MAX_BYTES) {
        const src = new ChunkedSource(deps.storage, `${prefix}/out`, outBytes);
        const h = createHash('sha256');
        for (let pos = 0; pos < outBytes; pos += CHUNK_SIZE) h.update(await src.read(pos, CHUNK_SIZE));
        sha = h.digest('hex');
    }
    // limpieza de temporales de construccion
    const tmp = await deps.storage.list(`${prefix}/`);
    await deps.storage.del(tmp.filter((t) => !t.key.startsWith(`${prefix}/out`)).map((t) => t.key)).catch(() => undefined);
    const expiresAt = new Date(deps.now() + deps.limits.exportTtlHours * 3600 * 1000);
    await jobs.update(job.id, {
        status: 'done', phase: '', finishedAt: new Date(), outputBytes: outBytes, outputSha256: sha, expiresAt, options: stripSecrets(job.options),
        cursor: { ...cur, pkg: writer.state() },
    });
    auditLog('admin.mail_transfer.completed', {
        userId: job.userId, jobId: job.id, kind: 'export', scope: job.scope, mailboxes: Object.keys(cur.stats).length, messages: doneCount, bytes: outBytes,
        sha256: sha, format: o.format, encrypted: !!o.encrypted,
    });
    return { ran: true, status: 'done', more: false, processed };
}
