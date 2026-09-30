
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resend } from '@/lib/resend';
import { getCurrentUser } from "@/lib/session";
import { parseSearchQuery } from '@/lib/rules/search';
import { uploadToStorage, getBufferFromStorage } from '@/lib/storage';
import { parseInviteFromIcs } from '@/lib/calendar/ics';
import { buildEmailSentContext, fireLifecycleHook, runEmailPreSendHooksForRequest } from '@/lib/expansions/server-hooks';
import {
    MAX_RECIPIENTS,
    formatFromHeader,
    hasDangerousExtension,
    isValidEmailAddress,
    parseRecipientList,
    sanitizeSubject,
    stripControlChars,
} from '@/lib/mail-validation';
import { sanitizeFilename } from '@/lib/mime-decode';
import { attachSendKeyEmail, claimSendKey, markSendKeySent, releaseSendKey } from '@/lib/send-idempotency';
import { MAIL_PAGE_SIZE, decodeCursor, encodeCursor, parseFilter, parseMailboxesParam, parseSort } from '@/lib/mail-query';
import type { MailListScope } from '@/lib/mail-list-sql';
import { getScopeCounts, ownAddressesOf, resolveMailboxScope, selectPageRows } from '@/lib/mail-store';
import { checkQuotaForSend, invalidateQuotaCache } from '@/lib/mail-quota';

const MAX_SENDS_PER_HOUR = Number.parseInt(process.env.MAX_SENDS_PER_HOUR || '200', 10) || 200;
const MAX_ATTACHMENTS = 25;
// Resend limita el mensaje completo a ~40MB; dejamos margen por codificacion base64.
const MAX_INLINE_ATTACHMENT_BYTES = 35 * 1024 * 1024;

function extractEmailAddress(value: string): string {
    const raw = String(value || '').trim();
    const bracketMatch = raw.match(/<([^>]+)>/);
    return (bracketMatch?.[1] || raw).trim().toLowerCase();
}

function normalizeMailboxIdentity(email: string): string {
    const [localPart, domain] = String(email || '').trim().toLowerCase().split('@');
    if (!localPart || !domain) return '';

    let normalizedLocal = localPart.replace(/\./g, '');
    const plusIndex = normalizedLocal.indexOf('+');
    if (plusIndex !== -1) {
        normalizedLocal = normalizedLocal.substring(0, plusIndex);
    }

    return `${normalizedLocal}@${domain}`;
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const folder = searchParams.get('folder') || 'inbox';
    const q = searchParams.get('q'); // Search query
    const label = searchParams.get('label');
    const pageRaw = Number.parseInt(searchParams.get('page') || '1', 10);
    const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.min(pageRaw, 10000) : 1;
    const since = searchParams.get('since'); // Date string ISO
    const accountRaw = extractEmailAddress(searchParams.get('account') || '');
    const accountNormalized = normalizeMailboxIdentity(accountRaw);
    const limit = MAIL_PAGE_SIZE;
    // Orden y filtro rapido en el SERVIDOR; paginacion por cursor estable (keyset). `page` sigue funcionando (sin cursor).
    const sort = parseSort(searchParams.get('sort'));
    const filter = parseFilter(searchParams.get('filter'));
    const cursorRaw = searchParams.get('cursor');
    const cursor = cursorRaw ? decodeCursor(cursorRaw, sort) : null;
    if (cursorRaw && !cursor) return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 });
    const skip = cursor ? 0 : (page - 1) * limit;
    const wantCounts = searchParams.get('counts') !== '0';
    const mailboxesRaw = searchParams.get('mailboxes');
    const requestedMailboxes = mailboxesRaw === null ? null : parseMailboxesParam(mailboxesRaw);
    if (mailboxesRaw !== null && (!requestedMailboxes || requestedMailboxes.length === 0)) {
        return NextResponse.json({ error: 'Invalid mailboxes' }, { status: 400 });
    }

    const sessionUser = await getCurrentUser();
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await prisma.user.findUnique({
        where: { id: sessionUser.id },
        select: {
            id: true,
            email: true,
            accounts: {
                select: {
                    providerAccountId: true,
                }
            }
        }
    });

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const accountCandidates = Array.from(new Set([
        accountRaw,
        accountNormalized,
    ].filter(Boolean)));

    const connectedMailboxEmails = new Set<string>([
        user.email.toLowerCase(),
        ...user.accounts
            .map((account) => String(account.providerAccountId || '').trim().toLowerCase())
            .filter((email) => email.includes('@')),
    ]);

    // Buzones sobre los que se consulta. `mailboxes=<ids|all>` = union en el servidor (solo buzones accesibles por la sesion);
    // sin el, un unico buzon (el de la sesion o el de `account`).
    let mailboxUserIds: string[] = [user.id];

    if (requestedMailboxes) {
        const resolved = await resolveMailboxScope(user.id, requestedMailboxes);
        if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
        mailboxUserIds = resolved.userIds;
    } else if (accountCandidates.length > 0) {
        const selectedAccount = accountCandidates.find((candidate) => {
            if (connectedMailboxEmails.has(candidate)) return true;
            const normalizedCandidate = normalizeMailboxIdentity(candidate);
            return normalizedCandidate ? connectedMailboxEmails.has(normalizedCandidate) : false;
        });

        if (selectedAccount) {
            const targetUser = await prisma.user.findFirst({
                where: {
                    OR: [
                        { email: selectedAccount },
                        {
                            accounts: {
                                some: {
                                    providerAccountId: selectedAccount,
                                }
                            }
                        }
                    ]
                },
                select: { id: true }
            });

            if (targetUser) {
                mailboxUserIds = [targetUser.id];
            }
        }
    }

    // Lazy Unsnooze: Check for snoozed emails that need to wake up
    // We do this before fetching to ensure data is consistent
    try {
        await prisma.email.updateMany({
            where: {
                userId: { in: mailboxUserIds },
                folder: 'snoozed',
                scheduledAt: { lte: new Date() }
            },
            data: {
                folder: 'inbox',
                scheduledAt: null
            }
        });
    } catch (e) {
        console.error("Failed to unsnooze", e);
    }

    try {
        // Fechas: se ignoran si son invalidas (antes provocaban 500 en Prisma).
        const validIso = (raw: string | null): string | null => {
            const d = raw ? new Date(raw) : null;
            return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
        };

        // Busqueda: operadores (label:, from:, to:, subject:, has:attachment, is:unread|read|starred) + texto libre (full-text con
        // respaldo "contiene"). Todo se resuelve en SQL junto con la carpeta/etiqueta: sin listas de ids ni topes.
        const searching = Boolean(q?.trim());
        const labelsList = label ? label.split(',').map((l) => l.trim()).filter(Boolean).slice(0, 20) : [];
        const fromParam = searchParams.get('from');
        const scope: MailListScope = {
            userIds: mailboxUserIds,
            folder: folder || null,
            labels: labelsList,
            search: searching ? parseSearchQuery(q) : null,
            useFts: true,
            since: validIso(since),
            until: validIso(searchParams.get('until')),
            fromContains: fromParam ? fromParam : null,
            hasAttachment: searchParams.get('hasAttachment') === 'true',
            account: accountCandidates,
        };

        // Direcciones propias de TODOS los buzones consultados (filtro "de mi").
        const owners = mailboxUserIds.length === 1 && mailboxUserIds[0] === user.id
            ? [user]
            : await prisma.user.findMany({ where: { id: { in: Array.from(new Set([...mailboxUserIds, user.id])) } }, select: { email: true, accounts: { select: { providerAccountId: true } } } });
        const own = Array.from(new Set(owners.flatMap((u) => ownAddressesOf(u))));

        // La pagina se elige en SQL con comparacion de tupla (createdAt, id) [o (clave de remitente, createdAt, id)]; una fila de mas
        // indica si hay siguiente. Despues se cargan las filas completas (adjuntos y etiquetas) en ese mismo orden.
        const pageRows = await selectPageRows({ scope, sort, filter, own, cursor, take: limit + 1, offset: skip });
        const hasMore = pageRows.length > limit;
        const keep = hasMore ? pageRows.slice(0, limit) : pageRows;
        const byId = new Map((await prisma.email.findMany({
            where: { id: { in: keep.map((r) => r.id) }, userId: { in: mailboxUserIds } },
            include: {
                attachments: true,
                labels: true // Include labels in response
            }
        })).map((e) => [e.id, e]));
        const emails = keep.map((r) => byId.get(r.id)).filter((e): e is NonNullable<typeof e> => Boolean(e));
        const last = keep[keep.length - 1];
        const nextCursor = hasMore && last ? encodeCursor(sort, last) : null;

        if (!wantCounts) {
            return NextResponse.json({ emails, hasMore, nextCursor, sort, filter, ...(requestedMailboxes ? { mailboxes: mailboxUserIds } : {}) });
        }

        // `total` = mensajes que cumplen el filtro activo; `totalThreads` y `filters` = HILOS (las filas que dibuja la interfaz),
        // con el mismo criterio de agrupacion que la lista (lib/mail-list-sql.ts).
        const counts = await getScopeCounts(scope, own);
        const total = counts.messages[filter === 'all' ? 'all' : filter];
        const totalThreads = counts.threads[filter === 'all' ? 'all' : filter];

        return NextResponse.json({
            emails, total, totalThreads, page, pages: Math.ceil(total / limit), hasMore, nextCursor, sort, filter,
            filters: counts.threads, messageFilters: counts.messages,
            ...(requestedMailboxes ? { mailboxes: mailboxUserIds } : {}),
        });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: 'Failed to fetch emails' }, { status: 500 });
    }
}
class AttachmentAccessError extends Error {
    constructor(public key: string, public reason: 'forbidden' | 'missing' = 'forbidden') {
        super(reason === 'missing' ? 'Attachment file not found' : 'Attachment not accessible');
    }
}

export async function POST(req: NextRequest) {
    const sessionUser = await getCurrentUser();

    if (!sessionUser) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Reserva de Idempotency-Key (ver lib/send-idempotency.ts): se libera si el envio no llega a producirse.
    let idemClaimId: string | null = null;
    let idemClaimSent = false;
    try {
        const body = await req.json();
        const { to: rawTo, subject: rawSubject, html, text, from, cc: rawCc, bcc: rawBcc, attachments, scheduledAt, replyTo, reply_to } = body;
        const timestamp = Date.now();

        // ---- Validacion de destinatarios / cabeceras (anti CRLF injection, anti abuso) ----
        const toList = parseRecipientList(rawTo);
        const ccList = parseRecipientList(rawCc);
        const bccList = parseRecipientList(rawBcc);
        const invalidRecipients = [...toList.invalid, ...ccList.invalid, ...bccList.invalid];
        if (invalidRecipients.length > 0) {
            return NextResponse.json({ error: `Invalid recipient address: ${invalidRecipients[0]}` }, { status: 400 });
        }
        if (toList.valid.length === 0) {
            return NextResponse.json({ error: 'At least one recipient is required' }, { status: 400 });
        }
        if (toList.valid.length + ccList.valid.length + bccList.valid.length > MAX_RECIPIENTS) {
            return NextResponse.json({ error: `Too many recipients (max ${MAX_RECIPIENTS})` }, { status: 400 });
        }

        // Valores normalizados (sin CR/LF) que se usan de aqui en adelante.
        const to = toList.valid.join(', ');
        const cc = ccList.valid.length > 0 ? ccList.valid.join(', ') : '';
        const bcc = bccList.valid.length > 0 ? bccList.valid.join(', ') : '';
        const subject = sanitizeSubject(rawSubject);

        let validatedScheduledAt: string | undefined;
        if (scheduledAt) {
            const parsed = new Date(scheduledAt);
            if (Number.isNaN(parsed.getTime())) {
                return NextResponse.json({ error: 'Invalid scheduledAt' }, { status: 400 });
            }
            validatedScheduledAt = String(scheduledAt);
        }

        // ---- Cuota de buzon: solo bloquea si el dominio activo `enforceMailQuota` (por defecto NO bloquea) ----
        const quotaCheck = await checkQuotaForSend(sessionUser.id);
        if (quotaCheck.blocked && quotaCheck.status) {
            return NextResponse.json({
                error: 'Mailbox quota exceeded. Free up space before sending.',
                code: 'QUOTA_EXCEEDED',
                usedBytes: quotaCheck.status.usedBytes,
                limitBytes: quotaCheck.status.limitBytes,
            }, { status: 403 });
        }

        // ---- Limite de envio por usuario (anti spam / cuenta comprometida) ----
        const sentLastHour = await prisma.email.count({
            where: {
                userId: sessionUser.id,
                folder: { in: ['sent', 'scheduled'] },
                createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
            },
        });
        if (sentLastHour >= MAX_SENDS_PER_HOUR) {
            return NextResponse.json({ error: 'Sending rate limit reached. Try again later.' }, { status: 429 });
        }

        // ---- Adjuntos: limites, extensiones y origen ----
        const attachmentList: any[] = Array.isArray(attachments) ? attachments : [];
        if (attachmentList.length > MAX_ATTACHMENTS) {
            return NextResponse.json({ error: `Too many attachments (max ${MAX_ATTACHMENTS})` }, { status: 400 });
        }

        let inlineBytes = 0;
        for (const att of attachmentList) {
            if (hasDangerousExtension(att?.filename)) {
                return NextResponse.json({ error: `Attachment type not allowed: ${stripControlChars(att?.filename).slice(0, 80)}` }, { status: 400 });
            }
            if (att?.contentBase64) {
                inlineBytes += Math.floor(String(att.contentBase64).length * 0.75);
            } else if (typeof att?.key === 'string' && att.key.startsWith('attachments/') && !att.key.startsWith(`attachments/${sessionUser.email}/`)) {
                return NextResponse.json({ error: 'Invalid attachment key' }, { status: 403 });
            } else if (att?.url) {
                // Solo URLs de nuestro proxy de assets (evita que se pida a Resend descargar hosts arbitrarios).
                let okUrl = false;
                try {
                    const u = new URL(String(att.url));
                    okUrl = (u.protocol === 'https:' || u.protocol === 'http:') && u.pathname.startsWith('/api/assets/');
                } catch { /* invalid */ }
                if (!okUrl) {
                    return NextResponse.json({ error: 'Invalid attachment url' }, { status: 400 });
                }
            }
        }
        if (inlineBytes > MAX_INLINE_ATTACHMENT_BYTES) {
            return NextResponse.json({ error: 'Attachments exceed the size limit' }, { status: 413 });
        }

        let processedAttachments: any[];
        try {
            processedAttachments = await Promise.all(attachmentList.map(async (att: any, index: number) => {
            if (att?.contentBase64) {
                const safeFilename = sanitizeFilename(String(att.filename || `attachment-${index + 1}.bin`)).replace(/[^a-zA-Z0-9.-]/g, '_');
                // La clave SIEMPRE la genera el servidor: nunca aceptar att.key del cliente
                // (permitia sobrescribir objetos arbitrarios del bucket).
                const key = `attachments/${sessionUser.email}/${timestamp}-${index}-${safeFilename}`;
                const buffer = Buffer.from(att.contentBase64, 'base64');

                await uploadToStorage(key, buffer, att.mimeType || 'application/octet-stream');

                return {
                    ...att,
                    key,
                    size: att.size || buffer.byteLength,
                };
            }

            // Forwarded / already-stored attachment referenced only by storage key:
            // load the bytes server-side so they are truly attached (never rely on a URL fetch).
            if (att?.key && !att?.contentBase64) {
                const key = String(att.key);
                const ownsUpload = key.startsWith(`attachments/${sessionUser.email}/`);
                const ownsStored = ownsUpload || !!(await prisma.attachment.findFirst({
                    where: { key, email: { userId: sessionUser.id } },
                    select: { id: true },
                }));
                if (!ownsStored) {
                    throw new AttachmentAccessError(key);
                }

                const buffer = await getBufferFromStorage(key);
                if (!buffer) {
                    throw new AttachmentAccessError(key, 'missing');
                }

                const safeFilename = (att.filename || `attachment-${index + 1}.bin`).replace(/[^a-zA-Z0-9.-]/g, '_');
                // Copy to a fresh key so deleting the original email never breaks this sent copy.
                const newKey = ownsUpload ? key : `attachments/${sessionUser.email}/${timestamp}-${index}-${safeFilename}`;
                if (!ownsUpload) {
                    await uploadToStorage(newKey, buffer, att.mimeType || 'application/octet-stream');
                }

                return {
                    ...att,
                    key: newKey,
                    size: att.size || buffer.byteLength,
                    __buffer: buffer,
                };
            }

            return att;
            }));
        } catch (err) {
            if (err instanceof AttachmentAccessError) {
                return NextResponse.json(
                    { error: err.reason === 'missing' ? 'An attachment could not be found in storage' : 'Invalid attachment key' },
                    { status: err.reason === 'missing' ? 404 : 403 }
                );
            }
            throw err;
        }

        const outboundInviteUids = new Set<string>();
        processedAttachments.forEach((att: any) => {
            const metadataUid = String(att?.calendarEvent?.inviteUid || '').trim();
            if (metadataUid) {
                outboundInviteUids.add(metadataUid);
            }

            const mimeType = String(att?.mimeType || '').toLowerCase();
            const filename = String(att?.filename || '').toLowerCase();
            const isCalendarAttachment = mimeType.includes('text/calendar') || filename.endsWith('.ics');

            if (!isCalendarAttachment || !att?.contentBase64) {
                return;
            }

            try {
                const rawIcs = Buffer.from(att.contentBase64, 'base64').toString('utf8');
                const parsedInvite = parseInviteFromIcs(rawIcs);
                const parsedUid = String(parsedInvite?.uid || '').trim();
                if (parsedUid) {
                    outboundInviteUids.add(parsedUid);
                }
            } catch {
                // Ignore malformed ICS payloads to avoid blocking send.
            }
        });

        // Use authenticated user's credentials
        let senderName = sessionUser.name || 'User';
        let senderEmail = sessionUser.email;

        const user = await prisma.user.findUnique({
            where: { id: sessionUser.id },
            select: {
                id: true,
                email: true,
                accounts: {
                    select: {
                        providerAccountId: true,
                    }
                }
            }
        });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const allowedSenderEmails = new Set<string>([
            user.email.toLowerCase(),
            ...user.accounts
                .map((account) => String(account.providerAccountId || '').trim().toLowerCase())
                .filter((email) => email.includes('@')),
        ]);

        const allowedSenderIdentities = new Set<string>(
            Array.from(allowedSenderEmails)
                .map(normalizeMailboxIdentity)
                .filter(Boolean)
        );

        // Allow overriding ONLY if the domain matches (for aliasing)
        // or just strictly enforce the user's email for now to prevent spoofing
        if (from) {
            const requestedSender = extractEmailAddress(from);
            if (!requestedSender.includes('@')) {
                return NextResponse.json({ error: 'Invalid sender email' }, { status: 400 });
            }

            const requestedIdentity = normalizeMailboxIdentity(requestedSender);
            const isAuthorizedSender = allowedSenderEmails.has(requestedSender)
                || (requestedIdentity ? allowedSenderIdentities.has(requestedIdentity) : false);

            if (!isAuthorizedSender) {
                return NextResponse.json({ error: 'Unauthorized sender account' }, { status: 401 });
            }

            senderEmail = requestedSender;
        }

        if (!isValidEmailAddress(senderEmail)) {
            return NextResponse.json({ error: 'Invalid sender email' }, { status: 400 });
        }
        const formattedFrom = formatFromHeader(senderName, senderEmail);

        // ----------------------------------------------------
        // MIDDLEWARE: Pre-Send Hooks
        // ----------------------------------------------------
        // Local expansions removed.
        // ----------------------------------------------------

        // Prepare attachments for Resend
        const resendAttachments = processedAttachments.map((att: any) => {
            if (att.contentBase64) {
                return {
                    filename: att.filename,
                    content: Buffer.from(att.contentBase64, 'base64'),
                };
            }

            if (att.__buffer) {
                return {
                    filename: att.filename,
                    content: att.__buffer as Buffer,
                };
            }

            return {
                filename: att.filename,
                path: att.url,
            };
        });

        // Wrapper for Resend payload
        // Resend requires at least 'html' or 'text' to be present.
        let finalHtml = html;
        let finalText = text;

        const plainHtml = String(finalHtml || '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const plainText = String(finalText || '').trim();

        if (!plainHtml && !plainText && resendAttachments.length === 0) {
            return NextResponse.json({
                error: 'Cannot send an empty email. Add message content or an attachment.'
            }, { status: 400 });
        }

        if (!plainHtml && !plainText && resendAttachments.length > 0) {
            finalText = ' ';
        }

        // Hook EMAIL_PRE_SEND de las extensiones (DLP, etc.): { stop: true } cancela el envio, { modify } ajusta asunto/cuerpo.
        const preSend = await runEmailPreSendHooksForRequest(req, sessionUser, {
            subject, html: finalHtml, text: finalText, from: formattedFrom,
            to: toList.valid, cc: ccList.valid, bcc: bccList.valid, attachments: processedAttachments,
        });
        if (preSend.stop) {
            return NextResponse.json({ error: preSend.message, code: 'EXTENSION_BLOCKED' }, { status: 422 });
        }
        if (preSend.modify.html !== undefined) finalHtml = preSend.modify.html;
        if (preSend.modify.text !== undefined) finalText = preSend.modify.text;

        const payload: any = {
            from: formattedFrom,
            to: toList.valid,
            cc: ccList.valid.length > 0 ? ccList.valid : undefined,
            bcc: bccList.valid.length > 0 ? bccList.valid : undefined,
            subject: subject,
            html: finalHtml || undefined,
            text: finalText || undefined,
            attachments: resendAttachments.length > 0 ? resendAttachments : undefined
        };

        if (preSend.modify.subject !== undefined) payload.subject = sanitizeSubject(preSend.modify.subject);

        const requestedReplyTo = extractEmailAddress(replyTo || reply_to || '');
        const replyToValid = isValidEmailAddress(requestedReplyTo);
        if (replyToValid) {
            payload.reply_to = [requestedReplyTo];
        }

        if (validatedScheduledAt) {
            payload.scheduledAt = validatedScheduledAt;
            // La API REST de Resend espera `scheduled_at` (el SDK 2.x no traduce `scheduledAt`): sin esto el envio salia al instante.
            payload.scheduled_at = new Date(validatedScheduledAt).toISOString();
        }

        // Idempotencia: un reintento con la misma Idempotency-Key devuelve el envio original.
        const rawIdemKey = req.headers.get('idempotency-key')?.trim() || '';
        const idemKey = /^[A-Za-z0-9_:.-]{8,128}$/.test(rawIdemKey) ? rawIdemKey : null;
        const idemType = idemKey ? `send_idem:${user.id}:${idemKey}` : null;
        if (idemType) {
            const claim = await claimSendKey(idemType);
            if (claim.kind === 'duplicate') {
                if (claim.inProgress) {
                    // Otra peticion con la misma clave esta enviando ahora mismo: no duplicar; el cliente reintenta (425 = reintentable).
                    return NextResponse.json(
                        { error: 'A request with this Idempotency-Key is still in progress', code: 'IDEMPOTENCY_IN_PROGRESS' },
                        { status: 425, headers: { 'Retry-After': '2' } },
                    );
                }
                return NextResponse.json({ success: true, id: claim.resendEmailId ?? undefined, duplicate: true });
            }
            idemClaimId = claim.id;
        }

        // Send via Resend
        let sendResult;
        try {
            sendResult = await resend.emails.send(payload);
        } catch (sendErr) {
            if (idemClaimId) await releaseSendKey(idemClaimId).catch(() => undefined);
            throw sendErr;
        }
        const { data, error } = sendResult;

        if (error) {
            if (idemClaimId) await releaseSendKey(idemClaimId).catch(() => undefined);
            // No registrar destinatarios (PII) en logs.
            console.error('[POST /api/emails] Resend send failed:', (error as any)?.name, (error as any)?.message);
            const message = (error as any)?.message || (error as any)?.name || 'Failed to send email';
            return NextResponse.json({ error: message }, { status: 400 });
        }
        // El correo ya salio: registrar el id de Resend de inmediato para que ningun reintento reenvie.
        if (idemClaimId) {
            await markSendKeySent(idemClaimId, data?.id ?? null)
                .catch((e) => console.error('[POST /api/emails] idempotency mark failed:', (e as Error)?.message));
            idemClaimSent = true;
        }

        // Upload HTML/Text to Storage for persistence
        // We use the same storage as inbound emails
        const safeSubject = (subject || 'no-subject').replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 50);

        let htmlKey = null;
        let textKey = null;

        if (finalHtml) {
            htmlKey = `sent/${sessionUser.email}/${timestamp}-${safeSubject}.html`;
            await uploadToStorage(htmlKey, Buffer.from(finalHtml), 'text/html');
        }

        if (finalText) {
            textKey = `sent/${sessionUser.email}/${timestamp}-${safeSubject}.txt`;
            await uploadToStorage(textKey, Buffer.from(finalText), 'text/plain');
        }

        // Save to Sent/Scheduled folder
        const email = await prisma.email.create({
            data: {
                userId: user.id, // Link to User
                from: formattedFrom, // Store in "Name <email>" format
                to: to,
                cc: cc || null,
                bcc: bcc || null,
                replyTo: replyToValid ? requestedReplyTo : null,
                cleanTo: toList.valid.map((email: string) => {
                    const [local, domain] = email.trim().toLowerCase().split('@');
                    if (!domain) return email.trim();
                    let cleanLocal = local.replace(/\./g, '');
                    const plusIndex = cleanLocal.indexOf('+');
                    if (plusIndex !== -1) cleanLocal = cleanLocal.substring(0, plusIndex);
                    return `${cleanLocal}@${domain}`;
                }).join(', '),
                subject: subject,
                messageId: data?.id || crypto.randomUUID(),
                snippet: finalText ? finalText.substring(0, 200) : '',
                htmlKey: htmlKey,
                textKey: textKey,
                // Determine folder and status
                folder: validatedScheduledAt ? 'scheduled' : 'sent',
                status: validatedScheduledAt ? 'scheduled' : 'sent',
                scheduledAt: validatedScheduledAt ? new Date(validatedScheduledAt) : null,
                read: true,
                attachments: {
                    create: processedAttachments.map((att: any) => ({
                        filename: att.filename,
                        mimeType: att.mimeType || 'application/octet-stream',
                        size: att.size || 0,
                        key: att.key || `inline/${att.filename || 'attachment.bin'}`
                    }))
                }
            }
        });

        invalidateQuotaCache(user.id);

        if (idemClaimId) {
            await attachSendKeyEmail(idemClaimId, email.id)
                .catch((e) => console.error('[POST /api/emails] idempotency record failed:', (e as Error)?.message));
        }

        if (outboundInviteUids.size > 0) {
            await prisma.calendarEvent.updateMany({
                where: {
                    userId: user.id,
                    inviteUid: { in: Array.from(outboundInviteUids) },
                },
                data: {
                    sourceEmailId: email.id,
                }
            });
        }

        // ----------------------------------------------------
        // MIDDLEWARE: Post-Send Hooks (Background)
        // ----------------------------------------------------
        // Local expansions removed.
        // ----------------------------------------------------

        // Hook EMAIL_SENT (no bloqueante, contexto minimo: solo conteos). Los programados no se notifican aqui.
        if (!validatedScheduledAt) {
            fireLifecycleHook('EMAIL_SENT', user.id, buildEmailSentContext({
                emailId: email.id, to: toList.valid, cc: ccList.valid, bcc: bccList.valid,
                hasAttachments: processedAttachments.length > 0, sentAt: new Date(),
            }));
        }

        return NextResponse.json({ success: true, id: data?.id, warnings: preSend.warnings.length > 0 ? preSend.warnings : undefined });

    } catch (error) {
        if (idemClaimId && !idemClaimSent) await releaseSendKey(idemClaimId).catch(() => undefined);
        console.log(error);
        return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
    }
}
