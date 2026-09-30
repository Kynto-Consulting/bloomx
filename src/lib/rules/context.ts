/**
 * Carga (servidor) del contexto de evaluacion de correos YA guardados: cabeceras, adjuntos, etiquetas (rutas completas),
 * contactos, hilo... Todo en pocas consultas por lote (no N+1). Tolera que falten columnas aditivas (hdrs, hilos): esos
 * datos quedan "desconocidos" y las condiciones que los necesitan no coinciden.
 */
import { prisma } from '@/lib/prisma';
import { classifySpamFromHeaders } from '@/lib/spam-headers';
import { extractEmailOnly, splitAddressList } from '@/lib/email-utils';
import { aliasSuffixFor } from './alias';
import { fieldsUsed, MAX_TEXT_INPUT, type EmailContext } from './conditions';

export interface StoredEmailContext extends EmailContext {
    id: string;
    /** Estado actual necesario para aplicar/deshacer efectos. */
    currentLabelIds: string[];
    ownerId: string;
}

export interface LoadOptions {
    /** Cargar el cuerpo completo (texto) desde el almacenamiento. Por defecto solo el extracto (snippet). */
    needBody?: boolean;
    needHtml?: boolean;
    /** Inyectable en pruebas. Devuelve el contenido de un objeto de almacenamiento o null. */
    readObject?: (key: string) => Promise<string | null>;
}

const isMissingColumn = (e: unknown) => /42703|column .* does not exist/i.test(`${(e as any)?.code ?? ''} ${(e as any)?.meta?.code ?? ''} ${(e as any)?.message ?? ''}`);

export function plainText(html: string): string {
    return String(html || '').slice(0, 200_000).replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

async function defaultReadObject(key: string): Promise<string | null> {
    try {
        const { getBufferFromStorage } = await import('@/lib/storage');
        const buf = await getBufferFromStorage(key);
        return buf ? buf.toString('utf8') : null;
    } catch {
        return null;
    }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i]);
        }
    }));
    return out;
}

export function needsFromRules(rules: Array<{ conditions: unknown }>): { body: boolean; html: boolean } {
    let body = false;
    let html = false;
    for (const r of rules) {
        const f = fieldsUsed(r.conditions);
        if (f.has('body')) body = true;
        if (f.has('bodyHtml')) html = true;
    }
    return { body, html };
}

export async function loadOwnAddresses(userId: string): Promise<{ email: string; own: string[] }> {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, accounts: { select: { providerAccountId: true } } } });
    const email = (u?.email ?? '').toLowerCase();
    const set = new Set<string>(email ? [email] : []);
    for (const a of u?.accounts ?? []) {
        const v = String(a.providerAccountId || '').trim().toLowerCase();
        if (v.includes('@')) set.add(v);
    }
    return { email, own: Array.from(set) };
}

export async function loadRuleContexts(userId: string, emailIds: string[], opts: LoadOptions = {}): Promise<Map<string, StoredEmailContext>> {
    const out = new Map<string, StoredEmailContext>();
    const ids = Array.from(new Set(emailIds));
    if (ids.length === 0) return out;

    let rows: any[];
    let hasThreadCols = true;
    let hasHdrs = true;
    try {
        rows = await prisma.$queryRawUnsafe(
            `SELECT "id","from","to","cc","bcc","replyTo","subject","snippet","folder","read","starred","createdAt","textKey","htmlKey","hdrs","inReplyTo","refs","rfcMessageId","userId"
             FROM "Email" WHERE "id" = ANY($1::text[]) AND "userId" = $2`, ids, userId);
    } catch (e) {
        if (!isMissingColumn(e)) throw e;
        hasThreadCols = false;
        try {
            rows = await prisma.$queryRawUnsafe(
                `SELECT "id","from","to","cc","bcc","replyTo","subject","snippet","folder","read","starred","createdAt","textKey","htmlKey","hdrs","userId"
                 FROM "Email" WHERE "id" = ANY($1::text[]) AND "userId" = $2`, ids, userId);
        } catch (e2) {
            if (!isMissingColumn(e2)) throw e2;
            hasHdrs = false;
            rows = await prisma.$queryRawUnsafe(
                `SELECT "id","from","to","cc","bcc","replyTo","subject","snippet","folder","read","starred","createdAt","textKey","htmlKey","userId"
                 FROM "Email" WHERE "id" = ANY($1::text[]) AND "userId" = $2`, ids, userId);
        }
    }
    if (rows.length === 0) return out;
    const found = rows.map((r) => r.id as string);

    // Etiquetas (ruta completa; cae al nombre si fullPath aun no existe).
    let labelRows: Array<{ eid: string; id: string; path: string }>;
    try {
        labelRows = await prisma.$queryRawUnsafe(
            `SELECT el."A" AS eid, l."id", COALESCE(l."fullPath", l."name") AS path FROM "_EmailToLabel" el JOIN "Label" l ON l."id" = el."B"
             WHERE el."A" = ANY($1::text[]) AND l."userId" = $2`, found, userId);
    } catch (e) {
        if (!isMissingColumn(e)) throw e;
        labelRows = await prisma.$queryRawUnsafe(
            `SELECT el."A" AS eid, l."id", l."name" AS path FROM "_EmailToLabel" el JOIN "Label" l ON l."id" = el."B"
             WHERE el."A" = ANY($1::text[]) AND l."userId" = $2`, found, userId);
    }
    const labelsBy = new Map<string, Array<{ id: string; path: string }>>();
    for (const l of labelRows) labelsBy.set(l.eid, [...(labelsBy.get(l.eid) ?? []), { id: l.id, path: l.path }]);

    const attRows: Array<{ emailId: string; filename: string; mimeType: string; size: number }> = await prisma.$queryRawUnsafe(
        `SELECT "emailId","filename","mimeType","size" FROM "Attachment" WHERE "emailId" = ANY($1::text[])`, found);
    const attBy = new Map<string, Array<{ name: string; type: string; size: number }>>();
    for (const a of attRows) attBy.set(a.emailId, [...(attBy.get(a.emailId) ?? []), { name: a.filename, type: a.mimeType, size: Number(a.size) || 0 }]);

    // Contactos del remitente.
    const senders = Array.from(new Set(rows.map((r) => extractEmailOnly(r.from)).filter(Boolean)));
    const contacts = new Set<string>();
    if (senders.length) {
        const c = await prisma.$queryRawUnsafe<Array<{ email: string }>>(
            `SELECT lower("email") AS email FROM "Contact" WHERE "userId" = $1 AND lower("email") = ANY($2::text[])`, userId, senders).catch(() => []);
        c.forEach((x) => contacts.add(x.email));
    }

    // Hilo: el correo responde a algo que el usuario envio (Message-ID de sus enviados).
    const sentIds = new Set<string>();
    if (hasThreadCols) {
        const tokens = new Set<string>();
        for (const r of rows) for (const t of `${r.inReplyTo ?? ''} ${r.refs ?? ''}`.split(/\s+/)) if (t) tokens.add(t);
        if (tokens.size) {
            const s = await prisma.$queryRawUnsafe<Array<{ rfcMessageId: string }>>(
                `SELECT "rfcMessageId" FROM "Email" WHERE "userId" = $1 AND "folder" = 'sent' AND "rfcMessageId" = ANY($2::text[])`, userId, Array.from(tokens)).catch(() => []);
            s.forEach((x) => sentIds.add(x.rfcMessageId));
        }
    }

    const { email: userEmail, own } = await loadOwnAddresses(userId);

    // Cuerpos completos solo si las reglas los necesitan (lectura acotada y con concurrencia limitada).
    const bodyBy = new Map<string, { text?: string; html?: string }>();
    if (opts.needBody || opts.needHtml) {
        const read = opts.readObject ?? defaultReadObject;
        await mapLimit(rows, 6, async (r) => {
            const entry: { text?: string; html?: string } = {};
            if (opts.needBody) {
                if (r.textKey) entry.text = (await read(r.textKey)) ?? undefined;
                else if (r.htmlKey) { const h = await read(r.htmlKey); if (h) entry.text = plainText(h); }
            }
            if (opts.needHtml && r.htmlKey) entry.html = (await read(r.htmlKey)) ?? undefined;
            bodyBy.set(r.id, entry);
        });
    }

    for (const r of rows) {
        const atts = attBy.get(r.id) ?? [];
        const labs = labelsBy.get(r.id) ?? [];
        const hdrs: Record<string, string> | null = hasHdrs && r.hdrs && typeof r.hdrs === 'object' ? (r.hdrs as Record<string, string>) : null;
        const body = bodyBy.get(r.id);
        const text = (body?.text ?? r.snippet ?? '').slice(0, MAX_TEXT_INPUT);
        const recips = [...splitAddressList(r.to), ...splitAddressList(r.cc)].map((x) => extractEmailOnly(x)).filter(Boolean);
        const suffixes = Array.from(new Set(recips.map((x) => aliasSuffixFor(userEmail, x)).filter((x): x is string => !!x)));
        const refsKnown = hasThreadCols && !!r.rfcMessageId;
        const tokens = `${r.inReplyTo ?? ''} ${r.refs ?? ''}`.split(/\s+/).filter(Boolean);
        const spam = hdrs && Object.keys(hdrs).some((k) => k.startsWith('x-spam')) ? classifySpamFromHeaders(hdrs).score : undefined;
        out.set(r.id, {
            id: r.id,
            ownerId: r.userId,
            currentLabelIds: labs.map((l) => l.id),
            from: r.from ?? '',
            to: r.to ?? '',
            cc: r.cc ?? null,
            bcc: r.bcc ?? null,
            replyTo: r.replyTo ?? undefined,
            subject: r.subject ?? '',
            body: text,
            bodyHtml: body?.html ?? undefined,
            hasAttachment: atts.length > 0,
            attachments: atts,
            size: atts.reduce((n, a) => n + a.size, 0) + text.length,
            date: r.createdAt,
            labelIds: labs.map((l) => l.id),
            labelNames: labs.map((l) => l.path),
            hdrs,
            inReplyTo: r.inReplyTo ?? undefined,
            isThread: refsKnown ? tokens.some((t) => sentIds.has(t)) : null,
            senderInContacts: contacts.has(extractEmailOnly(r.from)),
            ownAddresses: own,
            aliasSuffixes: suffixes,
            folder: r.folder,
            read: !!r.read,
            starred: !!r.starred,
            spamScore: spam,
        });
    }
    return out;
}
