/**
 * archive.ts - abre el archivo subido (trozos en storage) como una lista de "entradas" con mensajes y los recorre de forma
 * REANUDABLE. Soporta: mbox / eml sueltos, ZIP (mbox, eml, Maildir), TAR, gzip (.mbox.gz, .tgz) y el mbox generado desde un PST.
 *
 * Las entradas deflate grandes (> INLINE_MAX) se expanden UNA vez a trozos (`x/<idx>`) para poder leerlas por rango; las pequenas
 * se inflan en memoria al abrirlas. Nada se escribe en un sistema de archivos: no hay zip-slip ni enlaces simbolicos que seguir.
 */
import { detectFormat, interpretPath, isKnownFolderName, type PathInfo, type SourceFormat } from './formats';
import { emlxToRfc822, parseEmlx } from './emlx';
import { msgToMime } from './msg';
import { normalizeOlmAttachmentUrl, olmMessageToMime } from './olm';
import { renderHeaderLines } from './mime-build';
import { MboxReader, bufferSource, type ByteSource } from './mbox';
import { ArchiveError, extractZipEntry, gunzipStream, readTarDirectory, readZipDirectory, zipDataStart, type ZipEntry, type ZipLimits } from './zip';
import { CHUNK_SIZE, ChunkWriter, ChunkedSource, type TransferStorage } from './source';

export interface WriterState { nextChunk: number; totalBytes: number; tailVersion: number }

/** Entradas deflate hasta este tamano se inflan en memoria al leerlas. */
export const INLINE_MAX = 16 * 1024 * 1024;

export class SliceSource implements ByteSource {
    constructor(private base: ByteSource, private start: number, public readonly size: number) {}
    async read(offset: number, length: number): Promise<Buffer> {
        if (offset >= this.size) return Buffer.alloc(0);
        return this.base.read(this.start + offset, Math.min(length, this.size - offset));
    }
}

export interface ArchiveState {
    /** Entradas expandidas (deflate grande o cifradas): idx -> tamano. */
    expanded: Record<string, number>;
    gzSize?: number;
    pstSize?: number;
    /**
     * Expansion EN CURSO (fase de extraccion reanudable): objetivo ('gz' o indice de entrada) y estado del escritor de trozos.
     * Si un tick se corta a media entrada se conserva lo escrito y se reanuda re-inflando (sin escribir) el prefijo.
     */
    exp?: { target: string; w: WriterState };
}

export type EntryKind = 'mbox' | 'eml' | 'emlx' | 'msg' | 'olm' | 'vcf' | 'ics' | 'filters' | 'maildir' | 'pst' | 'sniff' | 'ignored';

/** Datos personales que no son correo: contactos (vcf), calendario (ics) y filtros de Gmail. */
export type PimKind = 'contacts' | 'calendar' | 'filters';
export const PIM_OF_KIND: Partial<Record<EntryKind, PimKind>> = { vcf: 'contacts', ics: 'calendar', filters: 'filters' };

export interface ArchiveEntry {
    idx: number;
    name: string;
    size: number;
    kind: EntryKind;
    info: PathInfo;
    /** Necesita expansion previa (deflate grande sin expandir). */
    needsExpansion: boolean;
    open(): Promise<ByteSource>;
}

export interface OpenedArchive {
    format: SourceFormat;
    innerFormat: SourceFormat | null;
    entries: ArchiveEntry[];
    skipped: Record<string, number>;
    /** Falta un paso previo: gunzip (.gz) o conversion de PST. */
    needs: 'gunzip' | 'pst' | null;
    /** Entradas cifradas omitidas por no haber contrasena (el asistente debe pedirla). */
    encryptedEntries?: number;
    /** Lee un adjunto de un .olm (ruta normalizada `.../com.microsoft.__Attachments/<id>/<fichero>`), o null. */
    olmAttachment?: (url: string, maxBytes: number) => Promise<Buffer | null>;
}

export interface ArchiveDeps {
    storage: TransferStorage;
    /** Prefijo raiz del trabajo (mailtransfer/<jobId>). */
    prefix: string;
    totalBytes: number;
    fileName: string;
    state: ArchiveState;
    limits?: Partial<ZipLimits>;
    /** Contrasena del ZIP (solo en memoria; se usa unicamente para expandir entradas cifradas). */
    password?: string;
}

const srcPrefix = (d: ArchiveDeps) => `${d.prefix}/src`;
const xPrefix = (d: ArchiveDeps, id: string | number) => `${d.prefix}/x/${id}`;

function singleEntry(name: string, source: ByteSource, kind: EntryKind): ArchiveEntry {
    const info = interpretPath(name || 'file');
    // Archivo suelto: su nombre solo indica carpeta si es una conocida (Inbox.mbox, Enviados.mbox); "copia-2024.mbox" no crea etiquetas
    const base = (name || '').replace(/^.*[\/]/, '').replace(/\.(mbox|mbx|eml)$/i, '');
    const folder = isKnownFolderName(base) ? info.folder : [];
    return { idx: 0, name, size: source.size, kind, info: { ...info, folder, mailbox: null, kind: kind === 'sniff' ? 'ignored' : (kind as any) }, needsExpansion: false, open: async () => source };
}

function classify(fmt: SourceFormat): EntryKind {
    switch (fmt) {
        case 'mbox': case 'eml': case 'emlx': case 'msg': case 'pst': case 'vcf': case 'ics': case 'filters': return fmt;
        default: return 'ignored';
    }
}

async function fromDirectory(d: ArchiveDeps, base: ByteSource, dir: Array<{ path: string | null; size: number; skip: string | null }>, opener: (i: number) => (() => Promise<ByteSource>) | null, needs: (i: number) => boolean): Promise<{ entries: ArchiveEntry[]; skipped: Record<string, number> }> {
    const entries: ArchiveEntry[] = [];
    const skipped: Record<string, number> = {};
    dir.forEach((e, i) => {
        if (e.skip || !e.path) {
            if (e.skip && e.skip !== 'directory') skipped[e.skip] = (skipped[e.skip] ?? 0) + 1;
            return;
        }
        const info = interpretPath(e.path);
        let kind: EntryKind = (['mbox', 'eml', 'emlx', 'msg', 'olm', 'vcf', 'ics', 'filters', 'maildir', 'pst'] as const).includes(info.kind as any) ? (info.kind as EntryKind) : 'ignored';
        // Archivos sin extension (Thunderbird: "Inbox", "Sent") se identifican por contenido
        if (kind === 'ignored' && info.kind === 'ignored' && e.size >= 64 && !/\.[A-Za-z0-9]{1,5}$/.test(e.path.split('/').pop() || '')) kind = 'sniff';
        if (kind === 'ignored' || info.kind === 'manifest') { skipped['ignored'] = (skipped['ignored'] ?? 0) + 1; return; }
        const open = opener(i);
        if (!open) return;
        entries.push({ idx: i, name: e.path, size: e.size, kind, info, needsExpansion: needs(i), open });
    });
    void base;
    void d;
    return { entries, skipped };
}

export async function openArchive(d: ArchiveDeps): Promise<OpenedArchive> {
    const base = new ChunkedSource(d.storage, srcPrefix(d), d.totalBytes);
    const head = await base.read(0, 4096);
    const det = detectFormat(head, d.fileName);
    const format = det.format;

    if (format === 'zip') {
        const zip = await readZipDirectory(base, d.limits, { allowEncrypted: true });
        let encryptedNoPassword = 0;
        // Sin contrasena, las entradas cifradas aun no expandidas se omiten (y se informa para pedirla)
        const dir = zip.map((z, i) => {
            if (z.encKind && !z.skip && d.password === undefined && d.state.expanded[String(i)] === undefined) {
                encryptedNoPassword++;
                return { path: z.path, size: z.size, skip: 'encrypted' as string | null };
            }
            return z;
        });
        const { entries, skipped } = await fromDirectory(
            d, base, dir,
            (i) => {
                const z: ZipEntry = zip[i];
                return async () => {
                    const done = d.state.expanded[String(i)];
                    if (done !== undefined) return new ChunkedSource(d.storage, xPrefix(d, i), done);
                    if (z.encKind) throw new ArchiveError('needs_expansion');
                    if (z.method === 0) return new SliceSource(base, await zipDataStart(base, z), z.size);
                    if (z.size > INLINE_MAX) throw new ArchiveError('needs_expansion');
                    const parts: Buffer[] = [];
                    await extractZipEntry(base, z, async (c) => { parts.push(Buffer.from(c)); }, d.limits);
                    return bufferSource(Buffer.concat(parts));
                };
            },
            (i) => d.state.expanded[String(i)] === undefined && (!!zip[i].encKind || (zip[i].method !== 0 && zip[i].size > INLINE_MAX)),
        );
        return { format, innerFormat: null, entries, skipped, needs: null, encryptedEntries: encryptedNoPassword, olmAttachment: olmResolver(d, base, zip) };
    }

    if (format === 'tar') {
        return openTar(d, base, 'tar');
    }

    if (format === 'gzip') {
        if (d.state.gzSize === undefined) return { format, innerFormat: null, entries: [], skipped: {}, needs: 'gunzip' };
        const inner = new ChunkedSource(d.storage, xPrefix(d, 'gz'), d.state.gzSize);
        const innerHead = await inner.read(0, 4096);
        const innerDet = detectFormat(innerHead, d.fileName.replace(/\.gz$/i, ''));
        if (innerDet.format === 'tar') {
            const r = await openTar(d, inner, 'gzip');
            return { ...r, format };
        }
        const kind = classify(innerDet.format);
        if (innerDet.format === 'pst') return { format, innerFormat: 'pst', entries: [], skipped: {}, needs: d.state.pstSize === undefined ? 'pst' : null };
        if (kind === 'ignored') throw new ArchiveError('unsupported_format');
        return { format, innerFormat: innerDet.format, entries: [singleEntry(d.fileName.replace(/\.gz$/i, ''), inner, kind)], skipped: {}, needs: null };
    }

    if (format === 'pst') {
        if (d.state.pstSize === undefined) return { format, innerFormat: null, entries: [], skipped: {}, needs: 'pst' };
        const converted = new ChunkedSource(d.storage, xPrefix(d, 'pst'), d.state.pstSize);
        const e = singleEntry(d.fileName.replace(/\.(pst|ost)$/i, '.mbox'), converted, 'mbox');
        return { format, innerFormat: 'mbox', entries: [e], skipped: {}, needs: null };
    }

    if (format === 'mbox' || format === 'eml' || format === 'emlx' || format === 'msg' || format === 'vcf' || format === 'ics' || format === 'filters') {
        const e = singleEntry(d.fileName || (format === 'mbox' ? 'archivo.mbox' : `archivo.${format}`), base, classify(format));
        return { format, innerFormat: null, entries: [e], skipped: {}, needs: null };
    }
    throw new ArchiveError(format === 'bloomx-encrypted' ? 'encrypted_package' : 'unsupported_format');
}

/** Resolvedor de adjuntos de un .olm: indexa por la ruta desde `com.microsoft.__Attachments/` y lee la entrada (nunca sale del ZIP). */
function olmResolver(d: ArchiveDeps, base: ByteSource, zip: ZipEntry[]): OpenedArchive['olmAttachment'] {
    let index: Map<string, number> | null = null;
    const build = () => {
        const m = new Map<string, number>();
        zip.forEach((z, i) => {
            if (z.skip || !z.path) return;
            const at = z.path.indexOf('com.microsoft.__Attachments/');
            if (at >= 0) m.set(z.path.slice(at).toLowerCase(), i);
        });
        return m;
    };
    return async (url, maxBytes) => {
        const norm = normalizeOlmAttachmentUrl(url);
        if (!norm) return null;
        index ||= build();
        const at = norm.indexOf('com.microsoft.__Attachments/');
        const i = index.get(norm.slice(at).toLowerCase());
        if (i === undefined) return null;
        const z = zip[i];
        if (z.size > maxBytes) return null;
        const done = d.state.expanded[String(i)];
        if (done !== undefined) return new ChunkedSource(d.storage, xPrefix(d, i), done).read(0, done);
        if (z.encKind) return null;
        const parts: Buffer[] = [];
        await extractZipEntry(base, z, async (c) => { parts.push(Buffer.from(c)); }, d.limits);
        return Buffer.concat(parts);
    };
}

async function openTar(d: ArchiveDeps, base: ByteSource, outer: SourceFormat): Promise<OpenedArchive> {
    const tar = await readTarDirectory(base, d.limits);
    const { entries, skipped } = await fromDirectory(
        d, base, tar,
        (i) => async () => new SliceSource(base, tar[i].offset, tar[i].size),
        () => false,
    );
    return { format: outer, innerFormat: 'tar', entries, skipped, needs: null };
}

// ---------------------------------------------------------------------------------------------------------------------
// Expansion (trozos)
// ---------------------------------------------------------------------------------------------------------------------

export interface ExpandControl {
    /** Instante (ms) a partir del cual conviene parar (tras haber escrito al menos un trozo nuevo). */
    deadline: number;
    now: () => number;
    /** Latido del bloqueo del trabajo (se invoca cada ~32 MiB, tambien mientras se re-infla el prefijo). */
    heartbeat?: () => Promise<void>;
}

export interface ExpandOutcome {
    done: boolean;
    /** Tamano total del objeto expandido (solo si done). */
    size?: number;
    /** Estado del escritor para persistir en el cursor (si !done). */
    w: WriterState;
    /** Bytes nuevos escritos en este tick y prefijo re-inflado sin escribir (coste de la reanudacion). */
    written: number;
    replayed: number;
    /** Llamar DESPUES de persistir el cursor: borra las colas antiguas (seguro ante caidas entre escribir y guardar). */
    commit: () => Promise<void>;
}

/**
 * FASE DE EXTRACCION reanudable: expande `target` ('gz' = el .gz completo; n = entrada n del ZIP, deflate grande o cifrada) a
 * trozos `x/<target>/NNNNNN` de 4 MiB, sin cargar la entrada en memoria (inflate en trozos de 16 KiB, salida en flujo).
 *
 * Presupuesto: al agotarse `ctl.deadline` (y con al menos un trozo nuevo escrito, para garantizar avance) se guarda la cola y se
 * devuelve el estado del escritor. En el siguiente tick se reanuda SIN repetir las escrituras: deflate no es reanudable a mitad de
 * flujo, asi que se re-infla el prefijo ya escrito (solo CPU, sin E/S; ~cientos de MB/s) y se sigue escribiendo desde
 * `w.totalBytes`. El tiempo de re-inflado no cuenta contra el presupuesto de escritura del tick. Si el proceso muere entre
 * escribir y guardar el cursor, se reanuda del ultimo checkpoint y los trozos se reescriben de forma determinista.
 */
export async function expandStep(d: ArchiveDeps, target: 'gz' | number, prev: WriterState | undefined, ctl: ExpandControl): Promise<ExpandOutcome> {
    const base = new ChunkedSource(d.storage, srcPrefix(d), d.totalBytes);
    const w = new ChunkWriter(d.storage, xPrefix(d, target), prev, CHUNK_SIZE);
    await w.resume();
    const startAt = w.totalBytes;
    const t0 = ctl.now();
    let workStart = 0;
    const sink = async (c: Buffer) => {
        if (!workStart) workStart = ctl.now();
        await w.write(c);
    };
    // Parar: presupuesto agotado (descontando lo gastado en re-inflar el prefijo) y al menos un trozo nuevo
    const shouldStop = () => workStart > 0 && w.totalBytes - startAt >= CHUNK_SIZE && ctl.now() > ctl.deadline + (workStart - t0);
    const heartbeat = ctl.heartbeat ? async () => { await ctl.heartbeat!(); } : undefined;
    let stopped = false;
    if (target === 'gz') {
        const r = await gunzipStream(base, sink, { maxBytes: d.limits?.maxTotalBytes ?? DEFAULT_MAX_EXPANDED, startAt, shouldStop, heartbeat });
        stopped = !!r.stopped;
    } else {
        const zip = await readZipDirectory(base, d.limits, { allowEncrypted: true });
        const z = zip[target];
        if (!z) throw new ArchiveError('zip_invalid');
        const r = await extractZipEntry(base, z, sink, d.limits, { password: d.password, startAt, shouldStop, heartbeat });
        stopped = !!r.stopped;
    }
    if (stopped) {
        await w.flushTail();
        return { done: false, w: w.state(), written: w.totalBytes - startAt, replayed: startAt, commit: () => w.dropOldTails() };
    }
    const size = await w.finish();
    return { done: true, size, w: w.state(), written: size - startAt, replayed: startAt, commit: async () => undefined };
}

const DEFAULT_MAX_EXPANDED = 40 * 1024 * 1024 * 1024;

// ---------------------------------------------------------------------------------------------------------------------
// Recorrido de mensajes
// ---------------------------------------------------------------------------------------------------------------------

export interface Cursor {
    entry: number;
    offset: number;
}

export interface WalkedMessage {
    entry: ArchiveEntry;
    /** Clave estable de origen (idempotencia): `${idx}:${offset}`. */
    sourceKey: string;
    fromLine: string;
    raw: Buffer;
    size: number;
    oversize: boolean;
    /** Cursor para reanudar DESPUES de este mensaje. */
    next: Cursor;
    /** Banderas deducidas del nombre de archivo Maildir. */
    maildirFlags: PathInfo['maildirFlags'];
    /** Carpeta segun la ruta del archivo. */
    folderPath: string[];
    pathMailbox: string | null;
    /** Solo datos personales (contactos/calendario/filtros): `raw` es el archivo completo. */
    pim?: PimKind;
    /** La entrada no se pudo interpretar como mensaje (emlx/msg/olm invalido): se informa como parse_failed. */
    unparsable?: boolean;
}

export interface WalkOptions {
    maxMessageBytes: number;
    /** Adjuntos maximos por mensaje al convertir .msg / .olm. */
    maxAttachments?: number;
    /** Solo cabeceras (analisis). */
    headBytes?: number;
    onSkipEntry?: (entry: ArchiveEntry, reason: string) => void;
}

const PIM_MAX_BYTES = 64 * 1024 * 1024;

/** Antepone cabeceras X-Bloomx-* (banderas/carpeta deducidas del formato de origen) a un mensaje ya convertido. */
function withFlags(raw: Buffer, f: { read?: boolean | null; flagged?: boolean | null; draft?: boolean; sent?: boolean }): Buffer {
    const h: Array<[string, string]> = [];
    if (f.draft) h.push(['X-Bloomx-Draft', '1']);
    if (f.sent) h.push(['X-Bloomx-Folder', 'sent']);
    const flags = [f.read === null || f.read === undefined ? '' : f.read ? 'read' : 'unread', f.flagged ? 'starred' : ''].filter(Boolean).join(',');
    if (flags) h.push(['X-Bloomx-Flags', flags]);
    const head = renderHeaderLines(h);
    return head ? Buffer.concat([Buffer.from(head, 'latin1'), raw]) : raw;
}

/** .emlx / .msg / .olm (un mensaje por archivo) -> RFC 822. null = ilegible; 'not_mail' = es de otro tipo (contacto, cita...). */
async function convertSingle(kind: EntryKind, buf: Buffer, entry: ArchiveEntry, archive: OpenedArchive, opts: WalkOptions): Promise<{ raw: Buffer; folder?: string[] } | 'not_mail' | null> {
    const maxAttachments = opts.maxAttachments ?? 100;
    try {
        if (kind === 'emlx') {
            const p = parseEmlx(buf, { filename: entry.name });
            if (!p) return null;
            return { raw: emlxToRfc822(p) };
        }
        if (kind === 'msg') {
            const m = msgToMime(buf, { maxAttachmentBytes: opts.maxMessageBytes, maxAttachments });
            if (!m) return 'not_mail';
            return { raw: withFlags(m.raw, { read: m.unread === null ? null : !m.unread, flagged: m.flagged, draft: m.folderHint === 'Drafts', sent: m.folderHint === 'Sent' }) };
        }
        const resolve = archive.olmAttachment ?? (async () => null);
        const o = await olmMessageToMime(buf, (url) => resolve(url, opts.maxMessageBytes), { maxAttachmentBytes: opts.maxMessageBytes, maxAttachments, path: entry.name });
        if (!o) return null;
        return { raw: withFlags(o.raw, { read: o.read, flagged: o.flagged }), folder: o.folder && o.folder.length ? o.folder : undefined };
    } catch {
        return null;
    }
}

/** Resuelve entradas "sniff" por contenido. Devuelve el tipo final y la fuente ya abierta. */
async function resolveEntry(entry: ArchiveEntry): Promise<{ kind: EntryKind; source: ByteSource } | null> {
    const source = await entry.open();
    if (entry.kind !== 'sniff') return { kind: entry.kind, source };
    const head = await source.read(0, 4096);
    const det = detectFormat(head, entry.name);
    if (det.format === 'mbox') return { kind: 'mbox', source };
    if (det.format === 'eml') return { kind: 'eml', source };
    if (det.format === 'emlx' || det.format === 'msg' || det.format === 'vcf' || det.format === 'ics' || det.format === 'filters') return { kind: classify(det.format), source };
    return null;
}

export async function* walkMessages(archive: OpenedArchive, from: Cursor, opts: WalkOptions): AsyncGenerator<WalkedMessage> {
    for (let ei = 0; ei < archive.entries.length; ei++) {
        const entry = archive.entries[ei];
        if (entry.idx < from.entry) continue;
        const startOffset = entry.idx === from.entry ? from.offset : 0;
        const nextEntryIdx = archive.entries[ei + 1]?.idx ?? entry.idx + 1;
        const resolved = await resolveEntry(entry);
        if (!resolved) { opts.onSkipEntry?.(entry, 'not_mail'); continue; }
        const { kind, source } = resolved;
        const folderPath = entry.info.folder;
        const common = { entry, maildirFlags: entry.info.maildirFlags, folderPath, pathMailbox: entry.info.mailbox };
        if (kind === 'eml' || kind === 'maildir') {
            if (startOffset > 0) continue; // ya procesado
            if (source.size > opts.maxMessageBytes) {
                yield { ...common, sourceKey: `${entry.idx}:0`, fromLine: '', raw: Buffer.alloc(0), size: source.size, oversize: true, next: { entry: nextEntryIdx, offset: 0 } };
                continue;
            }
            const raw = await source.read(0, source.size);
            yield { ...common, sourceKey: `${entry.idx}:0`, fromLine: '', raw: opts.headBytes ? raw.subarray(0, opts.headBytes) : raw, size: raw.length, oversize: false, next: { entry: nextEntryIdx, offset: 0 } };
            continue;
        }
        const pim = PIM_OF_KIND[kind];
        if (pim) {
            if (startOffset > 0) continue;
            const over = source.size > PIM_MAX_BYTES;
            yield { ...common, sourceKey: `${entry.idx}:0`, fromLine: '', raw: over ? Buffer.alloc(0) : await source.read(0, source.size), size: source.size, oversize: over, next: { entry: nextEntryIdx, offset: 0 }, pim };
            continue;
        }
        if (kind === 'emlx' || kind === 'msg' || kind === 'olm') {
            if (startOffset > 0) continue;
            const next = { entry: nextEntryIdx, offset: 0 };
            if (source.size > opts.maxMessageBytes) {
                yield { ...common, sourceKey: `${entry.idx}:0`, fromLine: '', raw: Buffer.alloc(0), size: source.size, oversize: true, next };
                continue;
            }
            const buf = await source.read(0, source.size);
            const conv = await convertSingle(kind, buf, entry, archive, opts);
            if (conv === 'not_mail') { opts.onSkipEntry?.(entry, 'not_mail'); continue; }
            if (!conv) { yield { ...common, sourceKey: `${entry.idx}:0`, fromLine: '', raw: buf.subarray(0, 4096), size: buf.length, oversize: false, next, unparsable: true }; continue; }
            yield { ...common, folderPath: conv.folder ?? folderPath, sourceKey: `${entry.idx}:0`, fromLine: '', raw: opts.headBytes ? conv.raw.subarray(0, opts.headBytes) : conv.raw, size: conv.raw.length, oversize: false, next };
            continue;
        }
        if (kind === 'mbox') {
            const reader = new MboxReader(source, startOffset, { maxMessageBytes: opts.maxMessageBytes, headBytes: opts.headBytes });
            for (;;) {
                const m = await reader.next();
                if (!m) break;
                const atEnd = m.end >= source.size;
                yield {
                    ...common,
                    sourceKey: `${entry.idx}:${m.offset}`,
                    fromLine: m.fromLine,
                    raw: m.raw,
                    size: m.size,
                    oversize: m.oversize,
                    next: atEnd ? { entry: nextEntryIdx, offset: 0 } : { entry: entry.idx, offset: m.end },
                };
            }
            continue;
        }
        opts.onSkipEntry?.(entry, kind);
    }
}
