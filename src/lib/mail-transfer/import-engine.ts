/**
 * import-engine.ts - analisis y proceso en segundo plano de una importacion (patron del worker de Elixir):
 *
 *   created -> uploading -> uploaded -> analyzing -> ready -(confirm)-> queued -> running -> done | failed | canceled
 *
 * Cada `runImportTick` bloquea el trabajo (lockedUntil), avanza como mucho `budgetMs` y guarda un cursor (entrada + offset del
 * mensaje) para reanudar. Es idempotente: cada mensaje se identifica por su clave de origen (`entrada:offset`) y por
 * Message-ID+buzon (Email.messageId unico), asi que repetir un tick tras una caida no duplica. Los contadores salen de contar
 * MailTransferItem (fuente de verdad), no de sumas en memoria.
 */
import { auditLog } from '@/lib/audit';
import { decrypt } from '@/lib/encryption';
import { ArchiveError } from './zip';
import {
    type ArchiveState, expandStep, openArchive, walkMessages, type ArchiveDeps, type Cursor, type OpenedArchive, type WalkedMessage,
} from './archive';
import { decidePlacement, detectMailbox, type MessagePlacement } from './formats';
import { parseHeadersOnly, parseMessage, type Address } from './mime-parse';
import { ingestDraft, ingestMessage, sha256Hex, type IngestContext } from './ingest';
import { allowedDomains, findUsersByEmail, isInstanceAddress } from './mailboxes';
import { items as itemStore, jobs, type JobRow } from './store';
import { transferLimits, jobPrefix, type TransferLimits } from './limits';
import type { TransferStorage } from './source';
import type { RawMimeFetcher } from '@/lib/raw-mime';
import { realStorage } from './source';

export interface EngineDeps {
    storage: TransferStorage;
    now: () => number;
    limits: TransferLimits;
    /** Convierte un PST en un mbox por trozos (opcional: sin el, los PST se rechazan). */
    pstConvert?: (job: JobRow, d: ArchiveDeps, deadline: number) => Promise<{ done: boolean; size?: number; cursor?: unknown }>;
    notify?: (job: JobRow, emails: string[]) => Promise<void>;
    /** Descarga del MIME original (Email.rawMimeUrl) para exportar correos anteriores a raw.eml. Sin el: solo raw.eml o reconstruccion. */
    fetchRaw?: RawMimeFetcher;
}

export function defaultEngineDeps(over: Partial<EngineDeps> = {}): EngineDeps {
    return { storage: realStorage(), now: () => Date.now(), limits: transferLimits(), ...over };
}

export interface TickResult {
    ran: boolean;
    status?: string;
    /** Queda trabajo: conviene encadenar otra invocacion. */
    more: boolean;
    reason?: string;
    processed: number;
}

const none = (reason: string): TickResult => ({ ran: false, more: false, reason, processed: 0 });

// ---------------------------------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------------------------------

export interface Agg {
    messages: number;
    oversize: number;
    unparsable: number;
    notMail: number;
    mailboxes: Record<string, number>;
    mailboxOverflow: number;
    unknown: number;
    folders: Record<string, number>;
    labels: Record<string, number>;
    dateMin: string | null;
    dateMax: string | null;
    bytes: number;
    /** Archivos de datos personales encontrados (contactos, calendario, filtros). */
    pim?: { contacts: number; calendar: number; filters: number };
}

export const emptyAgg = (): Agg => ({ messages: 0, oversize: 0, unparsable: 0, notMail: 0, mailboxes: {}, mailboxOverflow: 0, unknown: 0, folders: {}, labels: {}, dateMin: null, dateMax: null, bytes: 0 });

const MAX_MAILBOXES = 2000;
const MAX_LABELS = 300;

function bump(map: Record<string, number>, key: string, cap: number): boolean {
    if (key in map) { map[key]++; return true; }
    if (Object.keys(map).length >= cap) return false;
    map[key] = 1;
    return true;
}

/** Cabeceras efectivas: mezcla las banderas del nombre de archivo Maildir como Status/X-Status si no vienen en el mensaje. */
export function effectiveHeaders(headers: Record<string, string[]>, flags: WalkedMessage['maildirFlags']): Record<string, string[]> {
    if (!flags) return headers;
    const h = { ...headers };
    if (!h['status'] && !h['x-mozilla-status'] && !h['x-gmail-labels'] && !h['x-bloomx-flags']) h['status'] = [flags.read ? 'RO' : 'O'];
    if (flags.draft && !h['x-bloomx-draft']) h['x-bloomx-draft'] = ['1'];
    if (flags.starred && !h['x-status']) h['x-status'] = ['F'];
    if (flags.deleted && !h['x-status']) h['x-status'] = ['D'];
    return h;
}

export interface Classified {
    mailbox: string | null;
    placement: MessagePlacement;
    from: Address | null;
    date: Date | null;
}

export function classify(headers: Record<string, string[]>, from: Address | null, to: Address[], cc: Address[], w: Pick<WalkedMessage, 'maildirFlags' | 'folderPath' | 'pathMailbox'>, domains: string[]): Classified {
    const h = effectiveHeaders(headers, w.maildirFlags);
    // Los mbox generados desde un PST llevan la ruta de carpeta original en X-Bloomx-Source-Folder
    const srcFolder = h['x-bloomx-source-folder']?.[0];
    const folderPath = srcFolder ? srcFolder.split('/').filter(Boolean) : w.folderPath;
    const placement = decidePlacement(h, folderPath.length ? folderPath : null);
    const { address } = detectMailbox({
        headers: h, from, to, cc, folder: placement.folder, pathMailbox: w.pathMailbox, isInstanceAddress: (a) => isInstanceAddress(a, domains),
    });
    return { mailbox: address, placement, from, date: null };
}

function errorCodeOf(e: unknown): string {
    if (e instanceof ArchiveError) return e.code;
    const m = e instanceof Error ? e.message : '';
    if (/chunk_missing|chunk_size_mismatch|tail_missing/.test(m)) return 'storage_inconsistent';
    return 'internal';
}

async function failJob(job: JobRow, code: string, deps: EngineDeps, cleanup: boolean): Promise<void> {
    await jobs.update(job.id, { status: 'failed', lastError: code, finishedAt: new Date(), phase: '', options: withoutZipPassword(job.options) });
    auditLog('admin.mail_transfer.failed', { userId: job.userId, jobId: job.id, kind: job.kind, code });
    if (cleanup) await purgeJobStorage(job.id, deps).catch(() => undefined);
}

export async function purgeJobStorage(jobId: string, deps: Pick<EngineDeps, 'storage'>): Promise<number> {
    const objs = await deps.storage.list(`${jobPrefix(jobId)}/`);
    if (objs.length) await deps.storage.del(objs.map((o) => o.key));
    // Temporal del PST (si se uso); mejor esfuerzo
    await import('./pst').then((m) => m.removePstTemp(jobId)).catch(() => undefined);
    return objs.length;
}

/** Quita la contrasena del ZIP de las opciones (se guarda cifrada con la clave de la instancia solo mientras se expanden las entradas cifradas). */
export function withoutZipPassword(o: Record<string, any>): Record<string, any> {
    const { zipPw, ...rest } = o;
    void zipPw;
    return rest;
}

/** Contrasena del ZIP en claro (solo en memoria del tick) o undefined. */
function zipPasswordOf(job: JobRow): string | undefined {
    const enc = job.options?.zipPw;
    if (typeof enc !== 'string' || !enc) return undefined;
    try { return decrypt(enc); } catch { return undefined; }
}

function archiveDeps(job: JobRow, deps: EngineDeps, state: ArchiveState, password?: string): ArchiveDeps {
    return {
        storage: deps.storage,
        prefix: jobPrefix(job.id),
        totalBytes: job.totalBytes,
        fileName: job.fileName ?? '',
        state,
        limits: { maxTotalBytes: deps.limits.maxExpandedBytes },
        password,
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------------------------------------------------

export async function runImportTick(jobId: string, deps: EngineDeps = defaultEngineDeps()): Promise<TickResult> {
    const job = await jobs.lock(jobId, ['analyzing', 'queued', 'running'], deps.limits.lockMs);
    if (!job) return none('not_runnable_or_locked');
    if (job.kind !== 'import') { await jobs.unlock(job.id); return none('not_import'); }
    try {
        if (job.cancelRequested) {
            await jobs.update(job.id, { status: 'canceled', finishedAt: new Date(), phase: '' });
            await purgeJobStorage(job.id, deps).catch(() => undefined);
            auditLog('admin.mail_transfer.canceled', { userId: job.userId, jobId: job.id, kind: 'import' });
            return { ran: true, status: 'canceled', more: false, processed: 0 };
        }
        if (job.status === 'analyzing') return await analysisTick(job, deps);
        if (job.status === 'queued') {
            await jobs.update(job.id, { status: 'running', startedAt: job.startedAt ?? new Date(), phase: 'import' });
            job.status = 'running';
        }
        return await importTick(job, deps);
    } catch (e) {
        const code = errorCodeOf(e);
        console.error('[mail-transfer] tick failed:', e instanceof Error ? e.message.slice(0, 200) : 'error');
        // Fallos de datos (archivo corrupto/inconsistente) son definitivos; el resto se reintenta en el siguiente tick
        if (e instanceof ArchiveError || code === 'storage_inconsistent') {
            await failJob(job, e instanceof ArchiveError ? e.code : code, deps, job.status === 'analyzing');
            return { ran: true, status: 'failed', more: false, reason: code, processed: 0 };
        }
        await jobs.update(job.id, { lastError: code });
        return { ran: true, status: job.status, more: false, reason: code, processed: 0 };
    } finally {
        await jobs.unlock(job.id).catch(() => undefined);
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Analisis
// ---------------------------------------------------------------------------------------------------------------------

async function analysisTick(job: JobRow, deps: EngineDeps): Promise<TickResult> {
    const started = deps.now();
    const deadline = started + deps.limits.budgetMs;
    const cursor: Record<string, any> = { ...job.cursor };
    const state: ArchiveState = { expanded: {}, ...(cursor.state ?? {}) };
    cursor.state = state;
    const password = zipPasswordOf(job);
    const d = archiveDeps(job, deps, state, password);
    const save = () => jobs.update(job.id, { cursor });
    const heartbeat = () => jobs.extendLock(job.id, deps.limits.lockMs);

    /** Un paso de la fase de extraccion (reanudable). Persiste el cursor ANTES de borrar colas antiguas. */
    const expand = async (target: 'gz' | number, phase: string): Promise<boolean> => {
        await jobs.update(job.id, { phase });
        const prev = state.exp && state.exp.target === String(target) ? state.exp.w : undefined;
        const out = await expandStep(d, target, prev, { deadline, now: deps.now, heartbeat });
        if (out.done) {
            if (target === 'gz') state.gzSize = out.size; else state.expanded[String(target)] = out.size!;
            delete state.exp;
        } else {
            state.exp = { target: String(target), w: out.w };
        }
        cursor.expandStats = { ...(cursor.expandStats ?? {}), replayedBytes: (cursor.expandStats?.replayedBytes ?? 0) + out.replayed, writtenBytes: (cursor.expandStats?.writtenBytes ?? 0) + out.written };
        await jobs.update(job.id, { cursor, bytesProcessed: out.done ? (out.size ?? 0) : out.w.totalBytes });
        await out.commit();
        return out.done;
    };

    let archive: OpenedArchive = await openArchive(d);
    // Pasos previos: gunzip / PST
    if (archive.needs === 'gunzip') {
        await expand('gz', 'gunzip');
        return { ran: true, status: 'analyzing', more: true, processed: 0 };
    }
    if (archive.needs === 'pst') {
        if (!deps.pstConvert) throw new ArchiveError('pst_unavailable');
        await jobs.update(job.id, { phase: 'pst' });
        const r = await deps.pstConvert(job, d, deadline);
        if (r.cursor !== undefined) cursor.pst = r.cursor;
        if (r.done) state.pstSize = r.size ?? 0;
        await save();
        return { ran: true, status: 'analyzing', more: true, processed: 0 };
    }
    // ZIP con entradas cifradas y sin contrasena: se pide en el asistente (o se continua sin ellas)
    if ((archive.encryptedEntries ?? 0) > 0 && !job.options?.zipSkipEncrypted) {
        await jobs.update(job.id, { status: 'uploaded', phase: 'password', summary: { ...job.summary, passwordRequired: true, encryptedEntries: archive.encryptedEntries }, cursor });
        return { ran: true, status: 'uploaded', more: false, reason: 'password_required', processed: 0 };
    }
    // Fase de extraccion: entradas deflate grandes / cifradas, una a una, reanudable a mitad de entrada
    const pending = archive.entries.filter((e) => e.needsExpansion);
    if (pending.length) {
        let did = 0;
        for (const e of pending) {
            if (did > 0 && deps.now() > deadline - 2_000) break;
            const finished = await expand(e.idx, 'expand');
            if (!finished) return { ran: true, status: 'analyzing', more: true, processed: 0 };
            did++;
        }
        return { ran: true, status: 'analyzing', more: true, processed: 0 };
    }
    // Ya no hace falta la contrasena: se descarta de las opciones del trabajo
    if (job.options?.zipPw) {
        await jobs.update(job.id, { options: withoutZipPassword(job.options) });
        job.options = withoutZipPassword(job.options);
    }

    await jobs.update(job.id, { phase: 'scan', format: archive.innerFormat === 'tar' || archive.format === 'gzip' ? archive.format : archive.format });
    const domains = allowedDomains();
    const agg: Agg = { ...emptyAgg(), ...(cursor.analysis?.agg ?? {}) };
    let pos: Cursor = cursor.analysis?.pos ?? { entry: 0, offset: 0 };
    let processed = 0;
    let finished = true;
    let sinceSave = 0;

    const walker = walkMessages(archive, pos, {
        maxMessageBytes: deps.limits.maxMessageBytes,
        headBytes: 96 * 1024,
        onSkipEntry: () => { agg.notMail++; },
    });
    for await (const w of walker) {
        agg.bytes += w.size;
        if (w.pim) {
            agg.pim ||= { contacts: 0, calendar: 0, filters: 0 };
            agg.pim[w.pim]++;
        } else if (w.unparsable) {
            agg.unparsable++;
        } else if (w.oversize) {
            agg.oversize++;
        } else {
            const ph = parseHeadersOnly(w.raw);
            const c = classify(ph.headers, ph.from, ph.to, ph.cc, w, domains);
            agg.messages++;
            if (c.mailbox) { if (!bump(agg.mailboxes, c.mailbox, MAX_MAILBOXES)) agg.mailboxOverflow++; } else agg.unknown++;
            bump(agg.folders, c.placement.folder, 20);
            for (const l of c.placement.labels) bump(agg.labels, l, MAX_LABELS);
            const iso = ph.date?.toISOString() ?? null;
            if (iso) {
                if (!agg.dateMin || iso < agg.dateMin) agg.dateMin = iso;
                if (!agg.dateMax || iso > agg.dateMax) agg.dateMax = iso;
            }
        }
        pos = w.next;
        processed++;
        if (++sinceSave >= 500) {
            cursor.analysis = { pos, agg };
            await jobs.update(job.id, { cursor, bytesProcessed: agg.bytes, totalItems: agg.messages + agg.oversize });
            await jobs.extendLock(job.id, deps.limits.lockMs);
            sinceSave = 0;
        }
        if (deps.now() > deadline || processed >= deps.limits.maxItemsPerTick * 4) { finished = false; break; }
    }

    cursor.analysis = { pos, agg };
    if (!finished) {
        await jobs.update(job.id, { cursor, bytesProcessed: agg.bytes, totalItems: agg.messages + agg.oversize });
        return { ran: true, status: 'analyzing', more: true, processed };
    }

    const mailboxes = Object.entries(agg.mailboxes).sort((a, b) => b[1] - a[1]).map(([address, count]) => ({ address, count }));
    const summary = {
        format: archive.format,
        innerFormat: archive.innerFormat,
        entries: archive.entries.length,
        skippedEntries: archive.skipped,
        messages: agg.messages,
        oversize: agg.oversize,
        notMail: agg.notMail,
        unparsable: agg.unparsable,
        pim: agg.pim ?? { contacts: 0, calendar: 0, filters: 0 },
        unknownMailbox: agg.unknown,
        mailboxes: mailboxes.slice(0, 500),
        mailboxOverflow: agg.mailboxOverflow + Math.max(0, mailboxes.length - 500),
        folders: agg.folders,
        labels: Object.entries(agg.labels).sort((a, b) => b[1] - a[1]).slice(0, 100).map(([name, count]) => ({ name, count })),
        dateMin: agg.dateMin,
        dateMax: agg.dateMax,
        bytes: agg.bytes,
        chunkDigest: job.summary.chunkDigest ?? null,
    };
    cursor.import = { entry: 0, offset: 0 };
    await jobs.update(job.id, {
        status: 'ready', phase: '', summary, cursor, format: archive.format, totalItems: agg.messages + agg.oversize, bytesProcessed: 0,
    });
    auditLog('admin.mail_transfer.analyzed', { userId: job.userId, jobId: job.id, format: archive.format, messages: agg.messages, mailboxes: mailboxes.length, bytes: job.totalBytes });
    return { ran: true, status: 'ready', more: false, processed };
}

// ---------------------------------------------------------------------------------------------------------------------
// Importacion
// ---------------------------------------------------------------------------------------------------------------------

export interface ImportOptions {
    targetMode?: 'auto' | 'single';
    singleMailbox?: string;
    /** direccion detectada -> buzon destino (null = descartar). La clave '' es "no detectado". */
    mailboxMap?: Record<string, string | null>;
    /** Autoimportacion: todo va a este buzon. */
    selfEmail?: string;
    notifyUsers?: boolean;
}

/** Buzon destino para una direccion detectada, o null (descartar / sin destino). */
export function resolveTarget(detected: string | null, o: ImportOptions, existing: (a: string) => boolean): string | null {
    if (o.selfEmail) return o.selfEmail.toLowerCase();
    if (o.targetMode === 'single') return o.singleMailbox ? o.singleMailbox.toLowerCase() : null;
    const key = detected ?? '';
    const map = o.mailboxMap ?? {};
    if (Object.prototype.hasOwnProperty.call(map, key)) return map[key] ? String(map[key]).toLowerCase() : null;
    if (detected && existing(detected)) return detected.toLowerCase();
    return null;
}

async function importTick(job: JobRow, deps: EngineDeps): Promise<TickResult> {
    const started = deps.now();
    const deadline = started + deps.limits.budgetMs;
    const cursor: Record<string, any> = { ...job.cursor };
    const state: ArchiveState = { expanded: {}, ...(cursor.state ?? {}) };
    cursor.state = state;
    const d = archiveDeps(job, deps, state);
    const archive = await openArchive(d);
    if (archive.needs) throw new ArchiveError('not_prepared');
    if (archive.entries.some((e) => e.needsExpansion)) throw new ArchiveError('not_prepared');

    const opts: ImportOptions = job.options as ImportOptions;
    const domains = allowedDomains();
    let pos: Cursor = cursor.import ?? { entry: 0, offset: 0 };
    const ictx: IngestContext = { storage: deps.storage, labelCache: new Map() };
    const userCache = new Map<string, { id: string; email: string } | null>();
    const getUser = async (email: string) => {
        const k = email.toLowerCase();
        if (!userCache.has(k)) {
            const found = await findUsersByEmail([k]);
            const u = found.get(k);
            userCache.set(k, u ? { id: u.id, email: u.email } : null);
        }
        return userCache.get(k)!;
    };
    const existsCache = new Map<string, boolean>();
    // Direcciones destino conocidas: se precargan las del mapa para evitar consultas por mensaje
    const preload = new Set<string>();
    for (const v of Object.values(opts.mailboxMap ?? {})) if (v) preload.add(v.toLowerCase());
    if (opts.singleMailbox) preload.add(opts.singleMailbox.toLowerCase());
    if (opts.selfEmail) preload.add(opts.selfEmail.toLowerCase());
    const pre = await findUsersByEmail([...preload]);
    for (const [k, u] of pre) userCache.set(k, { id: u.id, email: u.email });
    const touched = new Set<string>(Array.isArray(cursor.touched) ? cursor.touched : []);

    let processed = 0;
    let finished = true;
    let canceled = false;
    const walker = walkMessages(archive, pos, { maxMessageBytes: deps.limits.maxMessageBytes, maxAttachments: deps.limits.maxAttachmentsPerMessage });
    // Con un unico buzon detectado, los contactos/calendario/filtros (sin buzon en la ruta) van a ese buzon
    const detectedList = Array.isArray((job.summary as any)?.mailboxes) ? ((job.summary as any).mailboxes as Array<{ address: string }>) : [];
    const soleMailbox = detectedList.length === 1 ? detectedList[0].address : null;
    for await (const w of walker) {
        processed++;
        const record = (status: 'imported' | 'duplicate' | 'skipped' | 'error', mailbox: string, extra: { error?: string; messageId?: string | null; emailId?: string | null; folder?: string | null } = {}) =>
            itemStore.record({ jobId: job.id, mailbox, sourceKey: w.sourceKey, status, bytes: w.size, ...extra });

        if (w.pim) {
            await importPim(w, job, opts, soleMailbox, getUser, deps, record);
        } else if (w.unparsable) {
            await record('error', '', { error: 'parse_failed' });
        } else if (w.oversize) {
            await record('error', '', { error: 'too_large' });
        } else {
            let parsed;
            try {
                parsed = parseMessage(w.raw, { maxAttachments: deps.limits.maxAttachmentsPerMessage });
            } catch {
                parsed = null;
            }
            if (!parsed || (!parsed.from && !parsed.messageId && !parsed.subject && !parsed.text && !parsed.html && parsed.attachments.length === 0)) {
                await record('error', '', { error: 'parse_failed' });
            } else {
                const c = classify(parsed.headers, parsed.from, parsed.to, parsed.cc, w, domains);
                const detected = c.mailbox;
                const existing = (a: string) => {
                    const k = a.toLowerCase();
                    if (existsCache.has(k)) return existsCache.get(k)!;
                    return false;
                };
                // Resolver existencia de la direccion detectada (auto): una consulta por direccion nueva
                if (detected && !existsCache.has(detected.toLowerCase())) {
                    const u = await getUser(detected);
                    existsCache.set(detected.toLowerCase(), !!u);
                }
                const target = resolveTarget(detected, opts, existing);
                if (!target) {
                    await record('skipped', detected ?? '', { error: 'no_mailbox' });
                } else {
                    const user = await getUser(target);
                    if (!user) {
                        await record('error', target, { error: 'user_not_found' });
                    } else {
                        const rawHash = sha256Hex(w.raw);
                        const fallback = parseFromLineDate(w.fromLine);
                        const r = c.placement.draft
                            ? await ingestDraft(ictx, { userId: user.id, userEmail: user.email, parsed, rawHash, fallbackDate: fallback, maxAttachments: deps.limits.maxAttachmentsPerMessage })
                            : await ingestMessage(ictx, {
                                userId: user.id, userEmail: user.email, parsed, placement: c.placement, rawHash, fallbackDate: fallback, maxAttachments: deps.limits.maxAttachmentsPerMessage,
                            });
                        touched.add(user.email);
                        await record(r.status === 'error' ? 'error' : r.status, target, { error: r.error, messageId: r.messageIdKey ?? parsed.messageId, emailId: r.emailId, folder: c.placement.draft ? 'drafts' : c.placement.folder });
                    }
                }
            }
        }
        pos = w.next;
        if (processed % 25 === 0) {
            const fresh = await jobs.get(job.id);
            if (fresh?.cancelRequested) { canceled = true; finished = false; break; }
            await jobs.extendLock(job.id, deps.limits.lockMs);
        }
        if (processed % 200 === 0) await persistProgress(job, cursor, pos, touched);
        if (deps.now() > deadline || processed >= deps.limits.maxItemsPerTick) { finished = false; break; }
    }

    cursor.import = pos;
    cursor.touched = [...touched].slice(0, 5000);
    const counts = await itemStore.counts(job.id);
    const patch: Record<string, unknown> = {
        cursor,
        importedItems: counts.imported ?? 0,
        duplicateItems: counts.duplicate ?? 0,
        skippedItems: counts.skipped ?? 0,
        errorItems: counts.error ?? 0,
        doneItems: (counts.imported ?? 0) + (counts.duplicate ?? 0) + (counts.skipped ?? 0) + (counts.error ?? 0),
    };
    if (canceled) {
        await jobs.update(job.id, { ...patch, status: 'canceled', finishedAt: new Date(), phase: '' });
        await purgeJobStorage(job.id, deps).catch(() => undefined);
        auditLog('admin.mail_transfer.canceled', { userId: job.userId, jobId: job.id, kind: 'import', imported: counts.imported ?? 0 });
        return { ran: true, status: 'canceled', more: false, processed };
    }
    if (!finished) {
        await jobs.update(job.id, patch);
        return { ran: true, status: 'running', more: true, processed };
    }
    await jobs.update(job.id, { ...patch, status: 'done', finishedAt: new Date(), phase: '', expiresAt: new Date(deps.now() + 24 * 3600 * 1000) });
    // Los archivos subidos se borran al terminar el trabajo (el informe sale de MailTransferItem)
    await purgeJobStorage(job.id, deps).catch(() => undefined);
    auditLog('admin.mail_transfer.completed', {
        userId: job.userId, jobId: job.id, kind: 'import', scope: job.scope, imported: counts.imported ?? 0, duplicates: counts.duplicate ?? 0,
        errors: counts.error ?? 0, skipped: counts.skipped ?? 0, mailboxes: touched.size, bytes: job.totalBytes,
    });
    if (opts.notifyUsers && deps.notify) await deps.notify(job, [...touched]).catch(() => undefined);
    return { ran: true, status: 'done', more: false, processed };
}

type RecordFn = (status: 'imported' | 'duplicate' | 'skipped' | 'error', mailbox: string, extra?: { error?: string; messageId?: string | null; emailId?: string | null; folder?: string | null }) => Promise<boolean>;

/** Contactos (.vcf), calendario (.ics) y filtros de Gmail (mailFilters.xml) hacia el buzon de destino. Idempotente. */
async function importPim(
    w: WalkedMessage, job: JobRow, opts: ImportOptions, soleMailbox: string | null,
    getUser: (email: string) => Promise<{ id: string; email: string } | null>, deps: EngineDeps, record: RecordFn,
): Promise<void> {
    const kind = w.pim!;
    const folder = kind;
    if (w.oversize) { await record('error', '', { error: 'too_large', folder }); return; }
    const detected = w.pathMailbox ?? soleMailbox;
    let exists = false;
    if (detected) exists = !!(await getUser(detected));
    const target = resolveTarget(detected, opts, () => exists);
    if (!target) { await record('skipped', detected ?? '', { error: 'no_mailbox', folder }); return; }
    const user = await getUser(target);
    if (!user) { await record('error', target, { error: 'user_not_found', folder }); return; }
    const pim = await import('./pim');
    try {
        if (kind === 'contacts') {
            const r = await pim.importContacts(user.id, pim.parseVcf(w.raw).contacts);
            await record(r.created > 0 ? 'imported' : r.existing > 0 ? 'duplicate' : 'error', target, { folder, messageId: `contacts: +${r.created} =${r.existing} invalid:${r.invalid}`, error: r.created + r.existing === 0 ? 'no_items' : undefined });
        } else if (kind === 'calendar') {
            const parsed = pim.parseIcsCalendar(w.raw);
            const r = await pim.importEvents(user.id, parsed.events, { calendarName: parsed.calendarName ?? undefined });
            await record(r.created > 0 ? 'imported' : r.existing > 0 ? 'duplicate' : 'error', target, { folder, messageId: `events: +${r.created} =${r.existing} rrule-expanded:${r.expandedFromRrule}`, error: r.created + r.existing === 0 ? 'no_items' : undefined });
        } else {
            const parsed = pim.parseGmailFilters(w.raw);
            const r = await pim.importFilters(user.id, parsed.filters);
            await record(r.created > 0 ? 'imported' : r.skippedExisting > 0 ? 'duplicate' : 'error', target, { folder, messageId: `filters: +${r.created} =${r.skippedExisting} unmapped:${r.unmapped.length}`, error: r.created + r.skippedExisting === 0 && r.unmapped.length === 0 ? 'no_items' : undefined });
            // Filtros que no se pudieron convertir: una fila por filtro en el informe (con el motivo)
            for (let i = 0; i < Math.min(r.unmapped.length, 500); i++) {
                const u = r.unmapped[i];
                await itemStore.record({ jobId: job.id, mailbox: target, sourceKey: `${w.sourceKey}:u${i}`, status: 'skipped', error: 'filter_unmapped', messageId: `${u.name}: ${u.reasons.join('; ')}`, folder, bytes: 0 });
            }
        }
    } catch (e) {
        void deps;
        console.error('[mail-transfer] pim import failed:', e instanceof Error ? e.message.slice(0, 200) : 'error');
        await record('error', target, { error: 'db_failed', folder });
    }
}

async function persistProgress(job: JobRow, cursor: Record<string, any>, pos: Cursor, touched: Set<string>): Promise<void> {
    cursor.import = pos;
    cursor.touched = [...touched].slice(0, 5000);
    const counts = await itemStore.counts(job.id);
    await jobs.update(job.id, {
        cursor,
        importedItems: counts.imported ?? 0,
        duplicateItems: counts.duplicate ?? 0,
        skippedItems: counts.skipped ?? 0,
        errorItems: counts.error ?? 0,
        doneItems: (counts.imported ?? 0) + (counts.duplicate ?? 0) + (counts.skipped ?? 0) + (counts.error ?? 0),
    });
}

const FROM_LINE_DATE = /(?:[A-Za-z]{3}\s+)?([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})(?:\s+[+-]\d{4})?\s+(\d{4})\s*$/;
const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** Fecha de la linea `From ` del mbox (respaldo si el mensaje no tiene Date). */
export function parseFromLineDate(line: string): Date | null {
    const m = FROM_LINE_DATE.exec(line);
    if (!m) return null;
    const mon = MONTHS[m[1].toLowerCase()];
    if (mon === undefined) return null;
    const [hh, mm, ss] = m[3].split(':').map(Number);
    const d = new Date(Date.UTC(Number(m[4]), mon, Number(m[2]), hh, mm, ss));
    return Number.isNaN(d.getTime()) ? null : d;
}
