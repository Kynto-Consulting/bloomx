/**
 * Etiquetado y reglas al recibir un correo (usado por el webhook de Resend).
 * Todo es tolerante a fallos: un error aqui nunca debe impedir guardar el correo.
 *
 * Orden: (0) migracion perezosa de alias/regex de etiquetas a reglas, (1) campos antiguos que sigan sin migrar,
 * (2) reglas por prioridad. Las etiquetas de tipo carpeta sacan el correo de Entrada.
 */
import { prisma } from '@/lib/prisma';
import { evaluateRules } from './engine';
import type { EmailContext } from './conditions';
import { safeRegexTest } from './regex-safety';
import { aliasSuffixFor } from './alias';
import { isMissingRelation, loadRules, migrateLegacyLabelRules, plainTextFromHtml } from './store';
import { pickHeaders } from './headers';
import { listLabels } from '@/lib/labels/store';
import { extractEmailOnly, splitAddressList } from '@/lib/email-utils';
import { loadOwnAddresses } from './context';

export interface InboundInput {
    userId: string;
    userEmail: string;
    recipients: string[];
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
    hasAttachment: boolean;
    deliveryFolder: string;
    cc?: string | null;
    bcc?: string | null;
    replyTo?: string | null;
    /** Cabeceras crudas del mensaje (cualquier capitalizacion). Solo se conservan las de la lista blanca. */
    headers?: Record<string, unknown> | null;
    attachments?: Array<{ filename: string; mimeType: string; size: number }>;
    date?: Date;
    spamScore?: number | null;
    /** Remitente externo segun el filtro de spam (campo de reglas `isExternal`). */
    isExternal?: boolean | null;
}

export interface InboundResult {
    labelIds: string[];
    read: boolean;
    starred: boolean;
    folder: string;
    /** Carpeta de origen a guardar cuando el correo sale de Entrada por una etiqueta-carpeta. */
    previousFolder: string | null;
    snoozeUntil: Date | null;
    forwardTo: string[];
    appliedRuleIds: string[];
    hdrs: Record<string, string>;
}

export async function computeInboundEffects(input: InboundInput): Promise<InboundResult> {
    const hdrs = pickHeaders(input.headers);
    const result: InboundResult = {
        labelIds: [], read: false, starred: false, folder: input.deliveryFolder, previousFolder: null,
        snoozeUntil: null, forwardTo: [], appliedRuleIds: [], hdrs,
    };
    const labelIds = new Set<string>();

    // 0) Campos antiguos (alias / regex) -> reglas equivalentes (idempotente; si falla, siguen funcionando abajo).
    try { await migrateLegacyLabelRules(input.userId); } catch (e) {
        if (!isMissingRelation(e)) console.error('[inbound] legacy migration failed:', (e as any)?.message);
    }

    let userLabels: Awaited<ReturnType<typeof listLabels>> = [];
    try {
        userLabels = await listLabels(input.userId);
    } catch (e) {
        console.error('[inbound] label lookup failed:', (e as any)?.message);
    }
    const labelById = new Map(userLabels.map((l) => [l.id, l]));

    // 1) Etiquetas por alias y por regex que sigan en los campos antiguos.
    const suffixes = new Set<string>();
    for (const r of input.recipients) {
        const s = aliasSuffixFor(input.userEmail, r);
        if (s) suffixes.add(s);
    }
    const bodyText = input.text || plainTextFromHtml(input.html);
    for (const label of userLabels) {
        if (label.aliasSuffix && suffixes.has(label.aliasSuffix.toLowerCase())) labelIds.add(label.id);
        if (label.filterRegex) {
            if (safeRegexTest(label.filterRegex, input.subject.slice(0, 1000)) || safeRegexTest(label.filterRegex, bodyText)) {
                labelIds.add(label.id);
            }
        }
    }

    // 2) Reglas del usuario (tolera tabla "Rule" inexistente).
    try {
        const rules = await loadRules(input.userId, true);
        if (rules.length > 0) {
            const own = await loadOwnAddresses(input.userId).catch(() => ({ email: input.userEmail.toLowerCase(), own: [input.userEmail.toLowerCase()] }));
            const attachments = (input.attachments ?? []).map((a) => ({ name: a.filename, type: a.mimeType, size: Number(a.size) || 0 }));
            const inReplyTo = (hdrs['in-reply-to'] || '').replace(/[<>]/g, '').trim();
            const ctx: EmailContext = {
                from: input.from, to: input.to, cc: input.cc ?? null, bcc: input.bcc ?? null, replyTo: input.replyTo ?? undefined,
                subject: input.subject, body: bodyText, bodyHtml: input.html || null,
                hasAttachment: input.hasAttachment,
                attachments: input.attachments ? attachments : input.hasAttachment ? undefined : [],
                size: attachments.reduce((n, a) => n + a.size, 0) + bodyText.length + (input.html?.length ?? 0),
                date: input.date ?? new Date(),
                labelIds: Array.from(labelIds),
                labelNames: userLabels.filter((l) => labelIds.has(l.id)).map((l) => l.fullPath),
                hdrs,
                inReplyTo: inReplyTo || undefined,
                isThread: await repliesToSent(input.userId, hdrs),
                senderInContacts: await isContact(input.userId, input.from),
                ownAddresses: own.own,
                aliasSuffixes: Array.from(suffixes),
                folder: input.deliveryFolder,
                read: false,
                starred: false,
                spamScore: input.spamScore ?? undefined,
                isExternal: input.isExternal ?? undefined,
            };
            const fx = evaluateRules(ctx, rules);
            const valid = new Set(userLabels.map((l) => l.id));
            fx.addLabelIds.filter((id) => valid.has(id)).forEach((id) => labelIds.add(id));
            fx.removeLabelIds.forEach((id) => labelIds.delete(id));
            result.read = fx.markRead;
            result.starred = fx.star;
            // El spam detectado por cabeceras no se saca de spam por una regla.
            if (fx.folder && input.deliveryFolder !== 'spam') result.folder = fx.folder;
            result.appliedRuleIds = fx.appliedRuleIds;
            result.forwardTo = input.deliveryFolder === 'spam' ? [] : fx.forwardTo;
            if (fx.snoozeHours && result.folder === 'inbox') {
                result.folder = 'snoozed';
                result.snoozeUntil = new Date(Date.now() + fx.snoozeHours * 3_600_000);
            }
        }
    } catch (e) {
        if (!isMissingRelation(e)) console.error('[inbound] rules failed:', (e as any)?.message);
    }

    // 3) Etiquetas-carpeta: sacan el correo de Entrada (la regla explicita de carpeta gana).
    if (result.folder === 'inbox' && Array.from(labelIds).some((id) => labelById.get(id)?.behavior === 'folder')) {
        result.folder = 'archive';
        result.previousFolder = 'inbox';
    }

    result.labelIds = Array.from(labelIds);
    return result;
}

async function isContact(userId: string, from: string): Promise<boolean | null> {
    const addr = extractEmailOnly(splitAddressList(from)[0] ?? from);
    if (!addr) return null;
    try {
        const rows: Array<{ n: number }> = await prisma.$queryRawUnsafe(
            `SELECT COUNT(*)::int AS n FROM "Contact" WHERE "userId" = $1 AND lower("email") = $2`, userId, addr);
        return (rows[0]?.n ?? 0) > 0;
    } catch { return null; }
}

/** El correo responde (In-Reply-To / References) a un mensaje que el usuario envio. null = sin datos de hilo. */
async function repliesToSent(userId: string, hdrs: Record<string, string>): Promise<boolean | null> {
    const tokens = `${hdrs['in-reply-to'] ?? ''} ${hdrs['references'] ?? ''}`.split(/\s+/).map((t) => t.replace(/[<>]/g, '').trim()).filter(Boolean);
    if (tokens.length === 0) return false;
    try {
        const rows: Array<{ n: number }> = await prisma.$queryRawUnsafe(
            `SELECT COUNT(*)::int AS n FROM "Email" WHERE "userId" = $1 AND "folder" = 'sent' AND lower("rfcMessageId") = ANY($2::text[])`,
            userId, tokens.map((t) => t.toLowerCase()).slice(0, 60));
        return (rows[0]?.n ?? 0) > 0;
    } catch { return null; }
}
