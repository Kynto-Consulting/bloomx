
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resend } from '@/lib/resend';
import { getCurrentUser } from "@/lib/session";
import { buildContainsFilter, buildOperatorFilters, ftsEmailIds, parseSearchQuery } from '@/lib/rules/search';
import { uploadToStorage, getBufferFromStorage } from '@/lib/storage';
import { parseInviteFromIcs } from '@/lib/calendar/ics';
import { runEmailPreSendHooksForRequest } from '@/lib/expansions/server-hooks';
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
    const limit = 20;
    const skip = (page - 1) * limit;

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

    let mailboxUserId = user.id;

    if (accountCandidates.length > 0) {
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
                mailboxUserId = targetUser.id;
            }
        }
    }

    // Local expansions removed.
    // const { ensureCoreExpansions, expansionRegistry } = await import('@/lib/expansions/server');
    // ensureCoreExpansions();

    // Lazy Unsnooze: Check for snoozed emails that need to wake up
    // We do this before fetching to ensure data is consistent
    try {
        await prisma.email.updateMany({
            where: {
                userId: mailboxUserId,
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
        const whereObj: any = {
            AND: [
                { userId: mailboxUserId } // Force mailbox isolation by selected account
            ]
        };

        // Fechas: se ignoran si son invalidas (antes provocaban 500 en Prisma).
        const sinceDate = since ? new Date(since) : null;
        if (sinceDate && !Number.isNaN(sinceDate.getTime())) {
            whereObj.AND.push({
                createdAt: { gt: sinceDate }
            });
        }

        const until = searchParams.get('until');
        const untilDate = until ? new Date(until) : null;
        if (untilDate && !Number.isNaN(untilDate.getTime())) {
            whereObj.AND.push({
                createdAt: { lt: untilDate }
            });
        }

        // Busqueda: operadores (label:, from:, to:, subject:, has:attachment, is:unread|read|starred)
        // + texto libre. El texto usa full-text de Postgres (indice GIN) con fallback a contains.
        const parsedSearch = parseSearchQuery(q);
        whereObj.AND.push(...buildOperatorFilters(parsedSearch));
        if (parsedSearch.text) {
            const ftsIds = await ftsEmailIds(prisma, mailboxUserId, parsedSearch.text);
            if (ftsIds && ftsIds.length > 0) {
                whereObj.AND.push({ id: { in: ftsIds } });
            } else {
                whereObj.AND.push(buildContainsFilter(parsedSearch.text));
            }
        }

        const accountCandidates = Array.from(new Set([
            accountRaw,
            accountNormalized,
        ].filter(Boolean)));

        if (accountCandidates.length > 0) {
            const accountOrFilters = accountCandidates.flatMap((candidate) => ([
                { cleanTo: { contains: candidate, mode: 'insensitive' } },
                { to: { contains: candidate, mode: 'insensitive' } }
            ]));

            whereObj.AND.push({
                OR: accountOrFilters
            });
        }

        // Advanced Filters
        const fromParam = searchParams.get('from');
        if (fromParam) {
            whereObj.AND.push({ from: { contains: fromParam, mode: 'insensitive' } });
        }

        const hasAttachment = searchParams.get('hasAttachment') === 'true';
        if (hasAttachment) {
            whereObj.AND.push({ attachments: { some: {} } });
        }

        if (label) {
            const labelsList = label.split(',').map((l) => l.trim()).filter(Boolean).slice(0, 20);
            whereObj.AND.push({
                labels: {
                    some: {
                        name: {
                            in: labelsList,
                            mode: 'insensitive'
                        }
                    }
                },
                folder: { notIn: ['trash', 'spam'] } // Explicitly exclude trash/spam from label views
            });
        } else if (!q?.trim()) {
            // Only filter by folder if no label is selected and not searching globally
            // (or maybe search should be within folder? Usually Gmail global search ignores folder unless specified)
            // Let's make search global (ignore folder) if q is present.
            // For now: Global search if q present.
            if (folder) {
                whereObj.AND.push({ folder });
            }
        } else {
            // If searching (q exists), we generally want to search ALL folders, 
            // but usually except Trash/Spam unless specified.
            // For simplicity, let's search everything for now, or exclude trash/spam.
            whereObj.AND.push({
                folder: { notIn: ['trash', 'spam'] }
            });
        }

        const emails = await prisma.email.findMany({
            where: whereObj,
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
            include: {
                attachments: true,
                labels: true // Include labels in response
            }
        });

        console.log(`[GET / api / emails] Folder: ${folder}, Q: ${q}, Found: ${emails.length} `);
        if (folder === 'trash') {
            console.log(`[GET / api / emails] Trash IDs: `, emails.map(e => e.id));
        }

        const count = await prisma.email.count({ where: whereObj });

        return NextResponse.json({ emails, total: count, page, pages: Math.ceil(count / limit) });
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

        return NextResponse.json({ success: true, id: data?.id, warnings: preSend.warnings.length > 0 ? preSend.warnings : undefined });

    } catch (error) {
        if (idemClaimId && !idemClaimSent) await releaseSendKey(idemClaimId).catch(() => undefined);
        console.log(error);
        return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
    }
}
