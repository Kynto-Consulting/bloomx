// Plan de hilo de un correo SALIENTE: In-Reply-To / References / Message-ID propio, asunto normalizado y clave de hilo inicial.
//
// El original se resuelve en el SERVIDOR a partir de `inReplyToEmailId` con propiedad estricta (canAccessEmail): jamas se toma un
// Message-ID de otro usuario ni se confia en cabeceras enviadas por el cliente. Los envios de Elixir/campanas no pasan por aqui.
import { randomUUID } from 'node:crypto';
import { canAccessEmail } from '@/lib/mailbox-access';
import { prisma } from '@/lib/prisma';
import { ensureThreadHeaders } from '@/lib/thread-backfill';
import {
    angle,
    buildReplyHeaders,
    effectiveThreadKey,
    normalizeMessageId,
    normalizeOutgoingSubject,
    type OutgoingMode,
} from '@/lib/threading';

export type OutboundMode = 'new' | OutgoingMode;

export interface OriginalRef {
    id: string;
    userId: string;
    subject: string | null;
    folder: string;
    rawKey: string | null;
}

export interface OutboundPlan {
    mode: OutboundMode;
    original: OriginalRef | null;
    /** Asunto final (colapsado a un solo prefijo si venia con prefijos acumulados). */
    subject: string;
    /** Message-ID propio (sin <>) que se emite en la cabecera Message-ID y se guarda en Email.rfcMessageId. */
    messageId: string;
    /** In-Reply-To (sin <>) o null (nuevo, reenvio o original sin Message-ID conocido). */
    inReplyTo: string | null;
    /** References (sin <>) de la cadena hasta el original. */
    refs: string[];
    /** Cabeceras personalizadas para Resend (incluye Message-ID). */
    headers: Record<string, string>;
    /** Las mismas SIN Message-ID (reintento si el proveedor rechaza fijarlo). */
    headersWithoutMessageId: Record<string, string>;
    /** Clave de hilo del original (la efectiva): el correo enviado se agrupa con el, aunque no se conozca su Message-ID. */
    joinKey: string | null;
}

export type OutboundPlanResult = { ok: true; plan: OutboundPlan } | { ok: false; status: number; error: string };

const DOMAIN_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

/** Message-ID nuevo, unico, con el dominio del remitente: `uuid@dominio` (sin <>). */
export function generateMessageId(fromEmail: string): string {
    const domain = String(fromEmail || '').split('@')[1]?.trim().toLowerCase() || '';
    return `${randomUUID()}@${DOMAIN_RE.test(domain) && domain.length <= 200 ? domain : 'bloomx.invalid'}`;
}

/** Modo de envio: el declarado por el cliente o, si falta, "forward" cuando el asunto lo parece y "reply" en el resto. */
export function inferMode(requested: unknown, subject: string): OutgoingMode {
    if (requested === 'reply' || requested === 'replyAll' || requested === 'forward') return requested;
    return /^\s*(fwd?|fw|wg|tr|rv|enc)\s*:/i.test(subject) ? 'forward' : 'reply';
}

async function storedKey(emailId: string): Promise<string | null> {
    try {
        const rows = (await prisma.$queryRawUnsafe(`SELECT "threadKey" FROM "Email" WHERE "id" = $1`, emailId)) as Array<{ threadKey: string | null }>;
        return rows[0]?.threadKey ?? null;
    } catch {
        return null;
    }
}

export async function planOutboundThread(input: {
    sessionUserId: string;
    fromEmail: string;
    subject: string;
    inReplyToEmailId?: unknown;
    replyMode?: unknown;
}): Promise<OutboundPlanResult> {
    const messageId = generateMessageId(input.fromEmail);
    const idRaw = typeof input.inReplyToEmailId === 'string' ? input.inReplyToEmailId.trim() : '';

    if (!idRaw) {
        // Mensaje nuevo: Message-ID propio y X-Entity-Ref-ID (Resend lo documenta para que Gmail no lo una por asunto a otros envios parecidos)
        const extra = { 'X-Entity-Ref-ID': randomUUID() };
        return {
            ok: true,
            plan: { mode: 'new', original: null, subject: input.subject, messageId, inReplyTo: null, refs: [], headers: { 'Message-ID': angle(messageId), ...extra }, headersWithoutMessageId: extra, joinKey: null },
        };
    }
    if (idRaw.length > 64 || !/^[A-Za-z0-9_-]+$/.test(idRaw)) return { ok: false, status: 400, error: 'Invalid inReplyToEmailId' };

    const original = await prisma.email.findUnique({
        where: { id: idRaw },
        select: { id: true, userId: true, subject: true, folder: true, rawKey: true, to: true, cleanTo: true },
    });
    // Propiedad estricta: 404 tambien si existe pero es de otro usuario (no filtra existencia)
    if (!original || !(await canAccessEmail(input.sessionUserId, original.userId))) return { ok: false, status: 404, error: 'Original message not found' };

    const mode = inferMode(input.replyMode, input.subject);
    const subject = normalizeOutgoingSubject(input.subject, mode, original.subject);
    const joinKey = effectiveThreadKey({ id: original.id, subject: original.subject, to: original.to, cleanTo: original.cleanTo, threadKey: await storedKey(original.id) });

    let inReplyTo: string | null = null;
    let refs: string[] = [];
    if (mode !== 'forward') {
        // Cabeceras del original (las lee del MIME/payload guardado si nunca se procesaron). Ya paso canAccessEmail.
        const stored = await ensureThreadHeaders(original.id, { remote: false });
        const headers = stored ? buildReplyHeaders({ messageId: normalizeMessageId(stored.rfcMessageId), refs: stored.refs, inReplyTo: stored.inReplyTo }) : null;
        if (headers) {
            inReplyTo = headers.inReplyTo;
            refs = (headers.references.match(/<[^<>]+>/g) ?? []).map((r) => r.slice(1, -1));
        }
    }
    const h: Record<string, string> = {};
    if (inReplyTo) h['In-Reply-To'] = angle(inReplyTo);
    if (refs.length > 0) h['References'] = refs.map(angle).join(' ');
    return {
        ok: true,
        plan: {
            mode, original: { id: original.id, userId: original.userId, subject: original.subject, folder: original.folder, rawKey: original.rawKey },
            subject, messageId, inReplyTo, refs, headers: { 'Message-ID': angle(messageId), ...h }, headersWithoutMessageId: h, joinKey,
        },
    };
}
