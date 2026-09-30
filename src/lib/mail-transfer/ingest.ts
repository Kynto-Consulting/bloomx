/**
 * ingest.ts - guarda UN mensaje importado en el buzon de un usuario, con el MISMO esquema de almacenamiento que la ingesta
 * normal (emails/<fecha>/<uuid>/content.html|content.txt|raw.json|attachments/*, filas Email/Attachment/Label).
 *
 * Diferencias deliberadas con el webhook de Resend:
 *  - NO ejecuta reglas del usuario, NI hooks EMAIL_RECEIVED de extensiones, NI notificaciones push, NI envia nada;
 *  - conserva la fecha original (Email.createdAt = Date del mensaje) y las banderas/etiquetas/carpeta del origen;
 *  - dedupe por Message-ID + buzon: el messageId guardado es el mismo esquema por usuario que usa el webhook, asi que un
 *    reintento, una reimportacion o un correo ya recibido normalmente NO se duplican (tambien ante carreras: P2002);
 *  - adjuntos validados por contenido (file-type) y por el hook antivirus opcional, igual que los entrantes.
 */
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { execute, query } from '@/lib/admin/sql';
import { validateAttachment } from '@/lib/file-type';
import { avShouldBlock, scanBuffer } from '@/lib/av-hook';
import { uniqueAttachmentKey } from '@/lib/attachment-keys';
import { saveAttachmentContentIds } from '@/lib/attachment-content-id';
import { normalizeContentId, normalizeEmailAddress } from '@/lib/email-utils';
import { sanitizeSubject } from '@/lib/mail-validation';
import { stableStorageId, userScopedMessageId } from '@/lib/inbound-recipients';
import { assignThread, headersOfInbound } from '@/lib/thread-store';
import { threadInfoFromParsedHeaders } from '@/lib/thread-headers';
import type { Address, ParsedMail } from './mime-parse';
import type { MessagePlacement } from './formats';
import { LabelError, ensureLabelPath } from '@/lib/labels/store';
import type { TransferStorage } from './source';

export type IngestStatus = 'imported' | 'duplicate' | 'error';

export interface IngestResult {
    status: IngestStatus;
    error?: string;
    emailId?: string;
    messageIdKey?: string;
}

export interface IngestContext {
    storage: TransferStorage;
    /** Cache de etiquetas por usuario (nombre -> id) durante un tick. */
    labelCache: Map<string, string>;
    now?: () => Date;
}

const KEEP_HEADERS = ['date', 'message-id', 'in-reply-to', 'references', 'reply-to', 'list-id', 'list-unsubscribe', 'thread-index', 'thread-topic', 'auto-submitted', 'precedence', 'authentication-results', 'received-spf', 'importance', 'x-priority'];

function fmt(a: Address | null): string {
    if (!a) return '';
    const name = a.name.replace(/[<>",;\\]/g, '').trim();
    return name ? `${name} <${a.email}>` : a.email;
}

function fmtList(list: Address[]): string {
    return list.map(fmt).filter(Boolean).join(', ');
}

/** Texto plano de un HTML (para snippet cuando no hay parte text/plain). */
export function stripHtml(html: string): string {
    return html
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

/** Identificador base del mensaje: su Message-ID o, si falta, un hash determinista del contenido crudo. */
export function messageIdBase(parsed: ParsedMail, rawHash: string): string {
    const mid = parsed.messageId && parsed.messageId.length <= 400 ? parsed.messageId : null;
    return mid ?? `${rawHash.slice(0, 40)}@import.bloomx`;
}

export function sha256Hex(buf: Buffer): string {
    return createHash('sha256').update(buf).digest('hex');
}

let previousFolderColumn: boolean | null = null;
async function hasPreviousFolder(): Promise<boolean> {
    if (previousFolderColumn !== null) return previousFolderColumn;
    try {
        const rows = await query<{ ok: boolean }>(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Email' AND column_name = 'previousFolder') AS ok`);
        previousFolderColumn = !!rows[0]?.ok;
    } catch {
        previousFolderColumn = false;
    }
    return previousFolderColumn;
}
/** Solo para pruebas. */
export function __resetIngestCaches() { previousFolderColumn = null; }

/**
 * Etiquetas del origen -> etiquetas de Bloomx. Las rutas con "/" ("Trabajo/Proyecto A") crean JERARQUIA; las que vienen de una
 * carpeta del origen (folderNames: Outlook/Thunderbird/ZIP) se crean con comportamiento 'folder'. Si la BD aun no tiene
 * jerarquia, cae a etiquetas planas por nombre.
 */
async function ensureLabels(ctx: IngestContext, userId: string, names: string[], folderNames: string[] = []): Promise<string[]> {
    const ids: string[] = [];
    const asFolder = new Set(folderNames.map((n) => n.trim().slice(0, 80)));
    for (const raw of names) {
        const name = raw.trim().slice(0, 80);
        if (!name) continue;
        const key = `${userId}
${asFolder.has(name) ? 'f' : 't'}
${name}`;
        let id = ctx.labelCache.get(key);
        if (!id) {
            try {
                id = (await ensureLabelPath(userId, name, { behavior: asFolder.has(name) ? 'folder' : 'tag' })).id;
            } catch (e) {
                if (e instanceof LabelError) continue; // limite de etiquetas o nombre invalido: el correo se importa sin ella
                const found = await prisma.label.findFirst({ where: { userId, name }, select: { id: true } });
                id = found?.id ?? (await prisma.label.create({ data: { userId, name }, select: { id: true } }).catch(() => null))?.id;
            }
            if (!id) continue;
            if (ctx.labelCache.size > 5000) ctx.labelCache.clear();
            ctx.labelCache.set(key, id);
        }
        ids.push(id);
    }
    return ids;
}

/** Texto plano -> HTML minimo para el editor (los borradores se guardan como HTML). */
function textToHtml(text: string): string {
    const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc.split(/(?:\r?\n){2}/).map((p) => `<p>${p.replace(/\r?\n/g, '<br>')}</p>`).join('');
}

/**
 * Guarda un BORRADOR importado en la tabla Draft del usuario (Draft.from = su direccion). Id determinista a partir de usuario +
 * Message-ID (o hash del contenido): reimportar no duplica. Los adjuntos van a `attachments/<buzon>/...` (el prefijo que valida la app).
 */
export async function ingestDraft(
    ctx: IngestContext,
    input: { userId: string; userEmail: string; parsed: ParsedMail; rawHash: string; fallbackDate?: Date | null; maxAttachments?: number },
): Promise<IngestResult> {
    const { userId, parsed } = input;
    const now = (ctx.now ?? (() => new Date()))();
    const base = messageIdBase(parsed, input.rawHash);
    const id = `drf_${stableStorageId(`draft|${userId}|${base}`).replace(/-/g, '')}`;
    const existing = await prisma.draft.findUnique({ where: { id }, select: { id: true } });
    if (existing) return { status: 'duplicate', emailId: existing.id, messageIdKey: id };

    let date = parsed.date ?? input.fallbackDate ?? now;
    if (date.getTime() > now.getTime() + 24 * 3600 * 1000) date = now;
    const html = parsed.html || (parsed.text ? textToHtml(parsed.text) : '');
    const used = new Set<string>();
    const attRecords: Array<{ filename: string; mimeType: string; size: number; key: string; status: string }> = [];
    const uploads: Promise<void>[] = [];
    for (const att of parsed.attachments.slice(0, input.maxAttachments ?? 100)) {
        const validation = validateAttachment({ filename: att.filename, declaredMime: att.contentType, buffer: att.content, direction: 'inbound' });
        let blocked = validation.verdict === 'blocked';
        if (!blocked) {
            const av = await scanBuffer(att.content, att.filename, { userId });
            if (avShouldBlock(av)) blocked = true;
        }
        if (blocked) continue; // un borrador con un adjunto peligroso pierde ese adjunto (no queda ni la fila)
        const key = uniqueAttachmentKey(`attachments/${input.userEmail}/imp-${id.slice(4, 16)}`, att.filename, used);
        uploads.push(ctx.storage.put(key, att.content, validation.storeMime));
        attRecords.push({ filename: att.filename, mimeType: validation.storeMime, size: att.content.length, key, status: 'ready' });
    }
    try {
        await Promise.all(uploads);
    } catch {
        return { status: 'error', error: 'storage_failed', messageIdKey: id };
    }
    try {
        await prisma.draft.create({
            data: {
                id,
                from: input.userEmail.toLowerCase(),
                to: fmtList(parsed.to) || null,
                cc: fmtList(parsed.cc) || null,
                bcc: fmtList(parsed.bcc) || null,
                subject: sanitizeSubject(parsed.subject) || null,
                body: html,
                createdAt: date,
                updatedAt: date,
                attachments: attRecords.length ? { create: attRecords } : undefined,
            },
            select: { id: true },
        });
    } catch (e) {
        if ((e as { code?: string })?.code === 'P2002') return { status: 'duplicate', messageIdKey: id };
        return { status: 'error', error: 'db_failed', messageIdKey: id };
    }
    return { status: 'imported', emailId: id, messageIdKey: id };
}

export async function ingestMessage(
    ctx: IngestContext,
    input: {
        userId: string;
        userEmail: string;
        parsed: ParsedMail;
        placement: MessagePlacement;
        rawHash: string;
        /** Fecha de respaldo (linea From_ del mbox, fecha del archivo...). */
        fallbackDate?: Date | null;
        maxAttachments?: number;
    },
): Promise<IngestResult> {
    const { userId, parsed, placement } = input;
    const now = (ctx.now ?? (() => new Date()))();
    const base = messageIdBase(parsed, input.rawHash);
    const storedMessageId = userScopedMessageId(base, userId, stableStorageId(base));

    // Dedupe barato antes de subir nada
    const existing = await prisma.email.findUnique({ where: { messageId: storedMessageId }, select: { id: true } });
    if (existing) return { status: 'duplicate', emailId: existing.id, messageIdKey: storedMessageId };

    // Fecha original (nunca la de importacion salvo que falte); un futuro absurdo se acota a "ahora"
    let date = parsed.date ?? input.fallbackDate ?? now;
    if (date.getTime() > now.getTime() + 24 * 3600 * 1000) date = now;
    const dateStr = date.toISOString().split('T')[0];
    const uuid = stableStorageId(`import|${userId}|${base}`);
    const prefix = `emails/${dateStr}/${uuid}`;

    const text = parsed.text ?? '';
    const html = parsed.html ?? '';
    const subject = sanitizeSubject(parsed.subject) || '(No Subject)';
    const uploads: Promise<void>[] = [];
    const htmlKey = `${prefix}/content.html`;
    const textKey = `${prefix}/content.txt`;
    const rawKey = `${prefix}/raw.json`;
    if (html) uploads.push(ctx.storage.put(htmlKey, Buffer.from(html, 'utf8'), 'text/html'));
    if (text) uploads.push(ctx.storage.put(textKey, Buffer.from(text, 'utf8'), 'text/plain'));
    const headerSubset: Record<string, string> = {};
    for (const k of KEEP_HEADERS) {
        const v = parsed.headers[k]?.[0];
        if (v) headerSubset[k] = v.slice(0, 1000);
    }
    uploads.push(ctx.storage.put(rawKey, Buffer.from(JSON.stringify({ type: 'email.received', imported: true, data: { message_id: base, headers: headerSubset } }), 'utf8'), 'application/json'));

    const attRecords: Array<{ filename: string; mimeType: string; size: number; key: string; status: string }> = [];
    const contentIds: Array<{ key: string; contentId: string }> = [];
    const used = new Set<string>();
    for (const att of parsed.attachments.slice(0, input.maxAttachments ?? 100)) {
        const validation = validateAttachment({ filename: att.filename, declaredMime: att.contentType, buffer: att.content, direction: 'inbound' });
        let blocked = validation.verdict === 'blocked';
        if (!blocked) {
            const av = await scanBuffer(att.content, att.filename, { userId });
            if (avShouldBlock(av)) blocked = true;
        }
        if (blocked) {
            attRecords.push({ filename: att.filename, mimeType: 'application/octet-stream', size: att.content.length, key: 'BLOCKED', status: 'failed' });
            continue;
        }
        const key = uniqueAttachmentKey(`${prefix}/attachments`, att.filename, used);
        uploads.push(ctx.storage.put(key, att.content, validation.storeMime));
        attRecords.push({ filename: att.filename, mimeType: validation.storeMime, size: att.content.length, key, status: 'ready' });
        const cid = normalizeContentId(att.contentId);
        if (cid) contentIds.push({ key, contentId: cid });
    }

    try {
        await Promise.all(uploads);
    } catch {
        return { status: 'error', error: 'storage_failed', messageIdKey: storedMessageId };
    }

    const labelIds = await ensureLabels(ctx, userId, placement.labels, placement.folderLabels ?? []);
    const from = fmt(parsed.from) || 'unknown@unknown.local';
    const toAddrs = parsed.to.length ? parsed.to : parsed.cc;
    const toField = fmtList(toAddrs) || input.userEmail;
    const snippetSource = text || stripHtml(html);
    let created: { id: string };
    try {
        created = await prisma.email.create({
            data: {
                userId,
                from,
                to: toField,
                cc: parsed.cc.length && parsed.to.length ? fmtList(parsed.cc) : null,
                bcc: parsed.bcc.length ? fmtList(parsed.bcc) : null,
                replyTo: parsed.replyTo?.email ?? null,
                cleanTo: Array.from(new Set(toAddrs.map((a) => normalizeEmailAddress(a.email)))).join(', ') || null,
                subject,
                messageId: storedMessageId,
                snippet: snippetSource.slice(0, 200),
                htmlKey: html ? htmlKey : null,
                textKey: text ? textKey : null,
                rawKey,
                createdAt: date,
                folder: placement.folder,
                status: placement.folder === 'sent' ? 'sent' : 'received',
                read: placement.read,
                starred: placement.starred,
                attachmentsChecked: true,
                attachments: { create: attRecords },
                labels: labelIds.length ? { connect: labelIds.map((id) => ({ id })) } : undefined,
            },
            select: { id: true },
        });
    } catch (e) {
        if ((e as { code?: string })?.code === 'P2002') return { status: 'duplicate', messageIdKey: storedMessageId };
        return { status: 'error', error: 'db_failed', messageIdKey: storedMessageId };
    }

    if (contentIds.length) await saveAttachmentContentIds(contentIds.map((c) => ({ emailId: created.id, ...c })));
    // Hilo por cabeceras (Message-ID / In-Reply-To / References del archivo). Tolerante: nunca hace fallar la importacion.
    try {
        const info = threadInfoFromParsedHeaders(parsed.headers);
        await assignThread({
            userId, emailId: created.id, headers: headersOfInbound(info), date: date.getTime(), subject,
            from, to: toField, cc: parsed.cc.length && parsed.to.length ? fmtList(parsed.cc) : null, own: [input.userEmail],
            noFallback: info.autoSubmitted || info.bulk || Boolean(info.listId),
        });
    } catch { /* se agrupara con la clave heuristica heredada */ }
    // Carpeta de Outlook/Thunderbird importada como etiqueta-carpeta: el correo "vive" ahi y al quitarla vuelve a Entrada.
    if (placement.folder === 'archive' && (placement.folderLabels?.length ?? 0) > 0 && !placement.previousFolder && (await hasPreviousFolder())) {
        await execute(`UPDATE "Email" SET "previousFolder" = 'inbox' WHERE "id" = $1`, created.id).catch(() => undefined);
    }
    if (placement.previousFolder && (await hasPreviousFolder())) {
        await execute(`UPDATE "Email" SET "previousFolder" = $2 WHERE "id" = $1`, created.id, placement.previousFolder).catch(() => undefined);
    }
    return { status: 'imported', emailId: created.id, messageIdKey: storedMessageId };
}
