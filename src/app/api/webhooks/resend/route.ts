import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { prisma } from '@/lib/prisma';
import { deleteFromStorage, uploadToStorage } from '@/lib/storage';
import { Webhook } from 'svix';
import { resend } from '@/lib/resend';
import { sendNewMessagePushNotification } from '@/lib/notifications/web-push';
import { ensureDefaultCalendars } from '@/lib/calendar/defaults';
import { ParsedInvite, parseInviteFromIcs } from '@/lib/calendar/ics';
import { applyBlocklist, classifyForRecipient, persistVerdict } from '@/lib/spam/pipeline';
import { decodeRFC2047, extractFilenameFromHeaders, extensionFromMimeType, sanitizeFilename } from '@/lib/mime-decode';
import { handleInboundCalendarInvite } from '@/lib/calendar/invite-handler';
import { escapeHtmlText, isValidEmailAddress, sanitizeSubject } from '@/lib/mail-validation';
import { parseAuthenticationResults } from '@/lib/email-auth';
import { computeInboundEffects } from '@/lib/rules/inbound';
import { bumpRuleStats, markRuleRun } from '@/lib/rules/store';
import { saveEmailHdrs } from '@/lib/rules/headers';
import { runForwards } from '@/lib/rules/forward';
import { uniqueAttachmentKey } from '@/lib/attachment-keys';
import { saveAttachmentContentIds } from '@/lib/attachment-content-id';
import { normalizeContentId } from '@/lib/email-utils';
import { validateAttachment } from '@/lib/file-type';
import { buildEmailSentContext, fireLifecycleHook, runEmailReceivedHooks } from '@/lib/expansions/server-hooks';
import { emitEmailSpamDetected, emitLabelApplied } from '@/lib/expansions/lifecycle-v2';
import { internalSecretToSend } from '@/lib/internal-auth';
import { collectInboundRecipients, isUniqueViolation, recipientsForUser, stableStorageId, userScopedMessageId } from '@/lib/inbound-recipients';
import { assignThread, headersOfInbound } from '@/lib/thread-store';
import { threadInfoFromRecord } from '@/lib/thread-headers';
import { subjectLooksLikeReply } from '@/lib/threading';
import { EMPTY_BODY_MARKER_HTML } from '@/lib/mail-empty-body';

export async function POST(req: NextRequest) {
    // 1. Validate Request Signature
    const payload = await req.text();
    const headers = {
        'svix-id': req.headers.get('svix-id') || '',
        'svix-timestamp': req.headers.get('svix-timestamp') || '',
        'svix-signature': req.headers.get('svix-signature') || '',
    };

    // La verificacion de firma es OPCIONAL y la decide cada organizador: con WEBHOOK_SECRET (el secreto whsec_
    // del webhook de Resend) se exige firma valida; sin el, se acepta la peticion (recomendado configurarlo).
    if (!process.env.WEBHOOK_SECRET) {
        console.warn('[resend] WEBHOOK_SECRET not set: accepting UNSIGNED webhooks (optional; set it to require Resend signatures)');
    }
    if (process.env.WEBHOOK_SECRET) {
        const wh = new Webhook(process.env.WEBHOOK_SECRET);
        try {
            wh.verify(payload, headers);
        } catch (err) {
            console.error('Webhook signature verification failed');
            return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
        }
    }

    let event: any;
    try {
        event = JSON.parse(payload);
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const { type, data } = event || {};
    if (!type || typeof type !== 'string') {
        return NextResponse.json({ error: 'Invalid event' }, { status: 400 });
    }

    try {
        if (type === 'email.received') {
            await handleEmailReceived(data, payload);
        } else {
            await handleEmailStatusEvent(type, data);
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Webhook processing failed:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

/**
 * Decide si es seguro enviar un rebote "usuario desconocido" al remitente.
 * Evita backscatter hacia remitentes falsificados (SPF/DKIM/DMARC fail), listas, bulk,
 * autorespuestas y direcciones de sistema.
 */
function shouldSendBounce(headers: Record<string, unknown>, senderEmail: string): boolean {
    if (!isValidEmailAddress(senderEmail)) return false;

    const local = senderEmail.split('@')[0].toLowerCase();
    if (/^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce|bounces|abuse|root|daemon|notifications?)([+._-].*)?$/.test(local)) {
        return false;
    }

    const lower: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers || {})) {
        lower[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
    }

    const autoSubmitted = (lower['auto-submitted'] || '').trim().toLowerCase();
    if (autoSubmitted && autoSubmitted !== 'no') return false;
    if (/\b(bulk|list|junk|auto_reply)\b/i.test(lower['precedence'] || '')) return false;
    if (lower['list-id'] || lower['list-unsubscribe'] || lower['x-auto-response-suppress']) return false;
    if (lower['return-path'] && /^<\s*>$/.test(lower['return-path'].trim())) return false; // null sender

    const auth = parseAuthenticationResults(headers);
    if (auth && (auth.dmarc === 'fail' || auth.spf === 'fail' || auth.dkim === 'fail')) return false;

    return true;
}

// Helper function for email normalization (Gmail-style aliasing)
function normalizeEmail(email: string): string {
    const [localPart, domain] = email.toLowerCase().split('@');

    if (!domain) return email.toLowerCase();

    // Remove dots from local part
    let normalized = localPart.replace(/\./g, '');

    // Remove everything after and including the first '+'
    const plusIndex = normalized.indexOf('+');
    if (plusIndex !== -1) {
        normalized = normalized.substring(0, plusIndex);
    }

    return `${normalized}@${domain}`;
}

function parseMailbox(value: unknown): { email: string; name: string | null } {
    if (!value) {
        return { email: '', name: null };
    }

    if (typeof value === 'object') {
        const obj = value as any;
        const email = String(obj?.email || '').trim().toLowerCase();
        const name = String(obj?.name || '').trim() || null;
        if (email.includes('@')) {
            return { email, name };
        }
    }

    const raw = String(value || '').trim();
    const bracketMatch = raw.match(/^(.*)<([^>]+)>$/);
    if (bracketMatch?.[2]) {
        return {
            email: bracketMatch[2].trim().toLowerCase(),
            name: bracketMatch[1].trim().replace(/^"|"$/g, '') || null,
        };
    }

    if (raw.includes('@')) {
        return { email: raw.toLowerCase(), name: null };
    }

    return { email: '', name: null };
}

function decodeQuotedPrintable(input: string) {
    return String(input || '')
        .replace(/=(\r?\n)/g, '')
        .replace(/=([A-Fa-f0-9]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

async function handleEmailReceived(data: any, rawPayload: string) {
    const PAYLOAD_LIMIT = 4.5 * 1024 * 1024; // 4.5MB Safety Limit for Vercel Functions
    if (rawPayload.length > PAYLOAD_LIMIT) {
        console.warn(`⚠️ Payload too large (${(rawPayload.length / 1024 / 1024).toFixed(2)}MB). Skipping full processing to avoid Vercel 413/Timeout.`);
        // We might just want to return immediately or try to process minimally.
        // For now, let's verify if we can even PARSE it safely if it arrived here.
        // If we are here, Vercel/Next already accepted the body?
        // Actually Vercel Serverless Function Limit applies to the RESPONSE/Execution, not just Request body (Request body is 4.5MB max).
        // If request > 4.5MB, this function might not even run on Vercel (it returns 413 automatically).
        // BUT if it does run (e.g. streaming), we should be careful.
    }

    console.log('--- RAW PAYLOAD DEBUG ---');
    console.log(`Payload Size: ${rawPayload.length} bytes`);
    console.log('-------------------------');
    const { from, to, cc: rawCc, subject, attachments, messageId } = data;
    let headersMap = (data?.headers && typeof data.headers === 'object') ? data.headers : {};
    const webhookEmailId = String(data?.email_id || data?.id || '').trim();
    const resolvedMessageId = String(messageId || data?.message_id || '').trim();
    let { html, text } = data;

    // Destinatarios: to + cc + bcc. Un usuario que solo figura en CC/BCC tambien recibe el correo.
    const inbound = collectInboundRecipients({ to, cc: rawCc, bcc: data?.bcc });
    // Para mostrar/almacenar `to`: si el mensaje no trae `to` (solo CC/BCC) se usa el resto de destinatarios.
    const recipients = inbound.to.length > 0 ? inbound.to : inbound.all;

    // Normalize all recipients for validation, but store RAW for display
    const normalizedRecipients = recipients.map(email => normalizeEmail(email));

    const replyToCandidate = Array.isArray(data?.reply_to) && data.reply_to.length > 0
        ? data.reply_to[0]
        : (headersMap['reply-to'] || headersMap['Reply-To'] || headersMap['reply_to']);

    // Parse sender using payload + headers to support calendar providers like Google.
    const fromMailbox = parseMailbox(from || headersMap.from || headersMap.sender);
    const replyToMailbox = parseMailbox(replyToCandidate);
    const senderMailbox = fromMailbox.email
        ? fromMailbox
        : replyToMailbox.email
            ? replyToMailbox
            : parseMailbox(headersMap.sender || headersMap.from);

    const senderEmail = senderMailbox.email || 'unknown@unknown.local';
    const senderName = senderMailbox.name || null;
    const replyToEmail = replyToMailbox.email || null;
    const formattedFrom = senderName ? `${senderName} <${senderEmail}>` : senderEmail;

    // Use RAW for storage (Dedupe case-sensitive or insensitive? Let's keep it exact as received)
    const uniqueRawRecipients = Array.from(new Set(recipients));
    const toField = uniqueRawRecipients.join(', ');

    // Normalize CC field (same format as to)
    const rawCcList: any[] = Array.isArray(rawCc) ? rawCc : (rawCc ? [rawCc] : []);
    const ccField = rawCcList
        .map((r) => { const p = parseMailbox(r); return p.email || (typeof r === 'string' ? r.trim() : ''); })
        .filter(Boolean)
        .join(', ') || null;

    // Verify recipients exist in our DB
    const candidateUsers = await prisma.user.findMany({
        where: { email: { in: inbound.lookupKeys } }
    });

    // Blocklist ("ni entra"): ANTES de guardar cuerpo, adjuntos o el crudo. Sin rebote (evita backscatter); el proveedor recibe 200.
    const spamMail = {
        headers: headersMap as Record<string, unknown>,
        from: { name: senderName || '', email: senderEmail },
        envelopeFrom: null as string | null,
    };
    let users = candidateUsers;
    if (candidateUsers.length > 0) {
        const blocked = await applyBlocklist(spamMail, candidateUsers.map((u) => ({ id: u.id, email: u.email })));
        if (blocked.blocked.length > 0) {
            const gone = new Set(blocked.blocked.map((b) => b.user.id));
            users = candidateUsers.filter((u) => !gone.has(u.id));
            if (users.length === 0) return NextResponse.json({ success: true, message: 'Blocked' });
        }
    }

    if (users.length === 0) {
        console.log(`Rejected email: no matching user found in DB.`);

        // Auto-reply logic for User Unknown
        const topDomain = process.env.TOP_DOMAIN;
        // Anti-backscatter (RFC 3834 / NIST 800-177r1): no rebotar a remitentes probablemente
        // falsificados, listas, bulk, autorespuestas ni direcciones no validas.
        if (topDomain && shouldSendBounce(headersMap as Record<string, unknown>, senderEmail)) {
            try {
                await resend.emails.send({
                    from: `noreply@${topDomain}`,
                    to: senderEmail,
                    subject: `Undeliverable: ${sanitizeSubject(subject) || 'No Subject'}`,
                    headers: { 'Auto-Submitted': 'auto-replied', 'Precedence': 'auto_reply', 'X-Auto-Response-Suppress': 'All' },
                    html: `
                        <div style="font-family: sans-serif; padding: 20px;">
                            <h2 style="color: #d93025;">Delivery Status Notification (Failure)</h2>
                            <p>Hello,</p>
                            <p>Your message to <strong>${escapeHtmlText(toField)}</strong> could not be delivered because the recipient(s) do not exist in the domain <strong>${escapeHtmlText(topDomain)}</strong>.</p>
                            <p>Please check the email address and try again.</p>
                            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
                            <p style="color: #666; font-size: 12px; text-align: center;">This is an automated message from ${escapeHtmlText(topDomain)}. Please do not reply.</p>
                        </div>
                    `
                });
                console.log('Auto-reply (user unknown) sent');
            } catch (replyError) {
                console.error('Failed to send auto-reply:', replyError);
            }
        }
        return NextResponse.json({ success: true, message: 'User not found' });
    }


    // Id estable por correo entrante: un reintento del webhook sobrescribe los mismos objetos
    // de almacenamiento en vez de dejar huerfanos los del intento previo.
    const uuid = (webhookEmailId || resolvedMessageId) ? stableStorageId(webhookEmailId || resolvedMessageId) : crypto.randomUUID();
    const dateStr = new Date().toISOString().split('T')[0];

    // Reintento total: si todos los destinatarios ya tienen el correo, responder 2xx sin subir nada.
    {
        const messageIdCandidates = users.flatMap((u) => [
            userScopedMessageId(resolvedMessageId, u.id, uuid),
            ...(resolvedMessageId ? [resolvedMessageId] : []),
        ]);
        const delivered = await prisma.email.findMany({
            where: { userId: { in: users.map((u) => u.id) }, messageId: { in: messageIdCandidates } },
            select: { userId: true },
        });
        const deliveredUserIds = new Set(delivered.map((d) => d.userId));
        if (users.every((u) => deliveredUserIds.has(u.id))) {
            console.log('[webhook] Duplicate delivery ignored (already processed).');
            return NextResponse.json({ success: true, message: 'Already processed' });
        }
    }

    // Paths for B2
    const htmlKey = `emails/${dateStr}/${uuid}/content.html`;
    const textKey = `emails/${dateStr}/${uuid}/content.txt`;
    const rawKey = `emails/${dateStr}/${uuid}/raw.json`;

    const uploads = [];

    // 1. Upload Raw Payload (Backup)
    uploads.push(uploadToStorage(rawKey, rawPayload, 'application/json'));

    // 2. Upload Bodies
    const hasCalendarAttachmentWithoutContent = Array.isArray(attachments) && attachments.some((att: any) => {
        const mimeType = String(att?.contentType || att?.content_type || '').toLowerCase();
        const filename = String(att?.filename || '').toLowerCase();
        const isCalendarAttachment = mimeType.includes('text/calendar') || mimeType.includes('application/ics') || filename.endsWith('.ics');
        return isCalendarAttachment && !att?.content;
    });

    const hasAttachments = Array.isArray(attachments) && attachments.length > 0;

    // Hilos por cabeceras: el payload del webhook solo trae message_id. Si parece una respuesta y no trae In-Reply-To/References se pide a
    // Resend el correo completo (JSON pequeno con las cabeceras) para poder agruparla con su conversacion sin esperar al relleno perezoso.
    const headerKeys = new Set(Object.keys(headersMap as Record<string, unknown>).map((k) => k.toLowerCase()));
    const needsThreadHeaders = subjectLooksLikeReply(String(subject || '')) && !headerKeys.has('in-reply-to') && !headerKeys.has('references');

    let fetchedReceivingData: any = null;
    if (webhookEmailId && (!html || !text || hasCalendarAttachmentWithoutContent || hasAttachments || needsThreadHeaders)) {
        if (!html || !text) {
            console.log('[resend] Email body missing in webhook payload. Attempting Resend API fallback...');
        }
        try {
            const res = await fetch(`https://api.resend.com/emails/receiving/${webhookEmailId}`, {
                headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}` }
            });

            if (res.ok) {
                fetchedReceivingData = await res.json();
                if (fetchedReceivingData?.html) html = fetchedReceivingData.html;
                if (fetchedReceivingData?.text) text = fetchedReceivingData.text;
                if (fetchedReceivingData?.headers && typeof fetchedReceivingData.headers === 'object') {
                    headersMap = {
                        ...(headersMap as Record<string, unknown>),
                        ...(fetchedReceivingData.headers as Record<string, unknown>),
                    };
                    data.headers = headersMap;
                }
                console.log('Successfully fetched missing content from Resend API.');
            } else {
                console.error(`Failed to fetch content: ${res.status}`);
            }
        } catch (e) {
            console.error('Error fetching content fallback:', e);
        }
    }

    // Segunda pasada de la blocklist: la API de Resend puede aportar cabeceras (Return-Path, firma DKIM) que el webhook no traia.
    // Si ahora acierta, se retira lo unico subido hasta aqui (el crudo) y no se guarda nada mas.
    if (fetchedReceivingData?.headers) {
        const second = await applyBlocklist({ ...spamMail, headers: headersMap as Record<string, unknown> }, users.map((u) => ({ id: u.id, email: u.email })));
        if (second.blocked.length > 0) {
            const gone = new Set(second.blocked.map((b) => b.user.id));
            users = users.filter((u) => !gone.has(u.id));
            if (users.length === 0) {
                await Promise.allSettled(uploads);
                await deleteFromStorage(rawKey).catch(() => false);
                return NextResponse.json({ success: true, message: 'Blocked' });
            }
        }
    }

    if (!html && !text) {
        console.warn('[resend] Email body was still unavailable after Resend API fallback.');
        // Fallback for missing content if fetch also failed
        const placeholder = EMPTY_BODY_MARKER_HTML;
        uploads.push(uploadToStorage(htmlKey, placeholder, 'text/html'));
    } else {
        if (html) {
            uploads.push(uploadToStorage(htmlKey, html, 'text/html'));
        }
        if (text) {
            uploads.push(uploadToStorage(textKey, text, 'text/plain'));
        }
    }

    // 3. Build attachment metadata records (no content downloaded yet — done async)
    // We use the attachment hints from the webhook payload to create 'pending' records.
    // The actual file content is downloaded by /api/emails/[id]/process-attachments.
    const attachmentMetaRecords: Array<{
        filename: string;
        mimeType: string;
        size: number;
        key: string;
        status: string;
    }> = [];
    const parsedInvites: ParsedInvite[] = [];
    const parsedInviteKeys = new Set<string>();

    const registerParsedInvite = (invite: ParsedInvite | null | undefined) => {
        if (!invite) return;
        const key = `${invite.uid || ''}|${invite.method || ''}|${invite.organizerEmail || ''}`;
        if (parsedInviteKeys.has(key)) return;
        parsedInviteKeys.add(key);
        parsedInvites.push(invite);
    };

    const usedAttachmentKeys = new Set<string>();
    // Content-ID de adjuntos inline (imagenes `cid:`), por clave de storage. Se guardan aparte (SQL best-effort,
    // ver lib/attachment-content-id.ts) para no depender de que la columna Attachment.contentId ya exista.
    const attachmentContentIds: Array<{ key: string; contentId: string }> = [];
    // Process attachments that came with inline content in the webhook payload (small files)
    if (attachments && Array.isArray(attachments)) {
        // Limite de cantidad de adjuntos por correo (anti zip-bomb de metadatos / agotamiento de almacenamiento).
        for (const att of attachments.slice(0, 50)) {
            if (att.content && String(att.content?.data ? '' : att.content).length > 45 * 1024 * 1024) {
                console.warn('[resend] Inline attachment too large, skipped');
                continue;
            }
            if (att.content) {
                // Small file — content is inlined, upload immediately
                const buffer = Buffer.from(att.content.data || att.content);
                const contentType: string = att.contentType || att.content_type || 'application/octet-stream';

                // Decode filename properly (RFC 2047 encoded-words)
                let filename: string = att.filename
                    ? sanitizeFilename(decodeRFC2047(String(att.filename)))
                    : '';
                if (!filename) {
                    const ext = extensionFromMimeType(contentType);
                    filename = `attachment-${attachmentMetaRecords.length + 1}${ext || '.bin'}`;
                } else if (!filename.includes('.')) {
                    const ext = extensionFromMimeType(contentType);
                    if (ext) filename = `${filename}${ext}`;
                }

                // Validacion por contenido (magic-bytes): bloquea ejecutables y sanea HTML/SVG disfrazado.
                const validation = validateAttachment({ filename, declaredMime: contentType, buffer, direction: 'inbound' });
                if (validation.verdict === 'blocked') {
                    console.warn(`[resend] Inline attachment blocked (${validation.reason})`);
                    attachmentMetaRecords.push({
                        filename,
                        mimeType: 'application/octet-stream',
                        size: att.size || buffer.length,
                        key: 'BLOCKED',
                        status: 'failed',
                    });
                    continue;
                }

                // Clave unica: dos adjuntos con el mismo nombre ya no se sobrescriben.
                const attKey = uniqueAttachmentKey(`emails/${dateStr}/${uuid}/attachments`, filename, usedAttachmentKeys);
                uploads.push(uploadToStorage(attKey, buffer, validation.storeMime));

                attachmentMetaRecords.push({
                    filename,
                    mimeType: validation.storeMime,
                    size: att.size || buffer.length,
                    key: attKey,
                    status: 'ready',
                });
                const inlineContentId = normalizeContentId(att.content_id ?? att.contentId ?? att.cid);
                if (inlineContentId) attachmentContentIds.push({ key: attKey, contentId: inlineContentId });

                const isCalendarAttachment =
                    contentType.toLowerCase().includes('text/calendar') ||
                    contentType.toLowerCase().includes('application/ics') ||
                    filename.toLowerCase().endsWith('.ics');

                if (isCalendarAttachment) {
                    registerParsedInvite(parseInviteFromIcs(buffer.toString('utf8')));
                }
            } else {
                // Large file — no inline content, register as 'pending' for async download
                const contentType: string = att.contentType || att.content_type || 'application/octet-stream';
                let filename: string = att.filename
                    ? sanitizeFilename(decodeRFC2047(String(att.filename)))
                    : '';
                if (!filename) {
                    const ext = extensionFromMimeType(contentType);
                    filename = `attachment-${attachmentMetaRecords.length + 1}${ext || '.bin'}`;
                } else if (!filename.includes('.')) {
                    const ext = extensionFromMimeType(contentType);
                    if (ext) filename = `${filename}${ext}`;
                }

                attachmentMetaRecords.push({
                    filename,
                    mimeType: contentType,
                    size: att.size || 0,
                    key: 'PENDING',
                    status: 'pending',
                });
            }
        }
    }


    // The rawMimeUrl is stored on the email so that the async process-attachments
    // route can download it without needing the webhook payload again.
    const rawMimeUrl: string | null =
        fetchedReceivingData?.raw?.download_url ?? data?.raw?.download_url ?? null;

    await Promise.all(uploads);

    // Motor de spam v2 (por destinatario, dentro del bucle): ver lib/spam/pipeline.ts
    const spamMailFull = {
        ...spamMail,
        replyTo: replyToEmail,
        subject: String(subject || ''),
        text: String(text || ''),
        html: String(html || ''),
        attachments: attachmentMetaRecords.map((a) => ({ filename: a.filename, mimeType: a.mimeType, size: a.size, dangerous: a.key === 'BLOCKED' })),
        recipients: inbound.all,
    };

    // 4. Store in Postgres (Per User)
    for (const user of users) {
        // Scoped messageId per user ensures:
        // 1) Multi-recipient emails delivered across separate Resend webhooks don't collide.
        // 2) Retrying the webhook for a user who already received the email is idempotent.
        const userMessageId = userScopedMessageId(resolvedMessageId, user.id, uuid);

        // Idempotency check: if this user already received this email, skip creation
        const existingEmail = await prisma.email.findFirst({
            where: {
                userId: user.id,
                OR: [
                    { messageId: userMessageId },
                    ...(resolvedMessageId ? [{ messageId: resolvedMessageId }] : []),
                ],
            },
        });

        if (existingEmail) {
            console.log(`[webhook] Email already processed for user ${user.email} (messageId: ${userMessageId}). Skipping.`);
            continue;
        }

        const spamVerdict = await classifyForRecipient({ id: user.id, email: user.email }, spamMailFull);
        const deliveryFolder = spamVerdict.folder;

        // Etiquetas (alias/regex) + reglas del usuario. Tolerante a fallos: ver src/lib/rules/inbound.ts
        const inboundEffects = await computeInboundEffects({
            userId: user.id,
            userEmail: user.email,
            recipients: recipientsForUser(user.email, inbound.all),
            from: formattedFrom,
            to: String(toField || ''),
            subject: String(subject || ''),
            text: String(text || ''),
            html: String(html || ''),
            hasAttachment: attachmentMetaRecords.length > 0,
            deliveryFolder,
            cc: ccField ?? null,
            replyTo: replyToEmail ?? null,
            headers: headersMap as Record<string, unknown>,
            attachments: attachmentMetaRecords.map((a) => ({ filename: a.filename, mimeType: a.mimeType, size: a.size })),
            spamScore: spamVerdict.score,
            isExternal: spamVerdict.external.external,
        });
        const uniqueLabelIds = inboundEffects.labelIds.map((id) => ({ id }));

        let createdEmail: Awaited<ReturnType<typeof prisma.email.create>>;
        try {
        createdEmail = await prisma.email.create({
            data: {
                userId: user.id,
                from: formattedFrom,
                to: toField,
                cc: ccField,
                replyTo: replyToEmail,
                cleanTo: Array.from(new Set(normalizedRecipients)).join(', '),
                subject: subject || '(No Subject)',
                messageId: userMessageId,
                snippet: text ? text.substring(0, 200) : '',
                htmlKey: (html || (!html && !text)) ? htmlKey : null,
                textKey: text ? textKey : null,
                rawKey: rawKey,
                rawMimeUrl: rawMimeUrl,
                folder: inboundEffects.folder,
                ...(inboundEffects.previousFolder ? { previousFolder: inboundEffects.previousFolder } : {}),
                ...(inboundEffects.snoozeUntil ? { scheduledAt: inboundEffects.snoozeUntil } : {}),
                ...(inboundEffects.read ? { read: true } : {}),
                ...(inboundEffects.starred ? { starred: true } : {}),
                attachments: {
                    create: attachmentMetaRecords.map(a => ({ ...a, emailId: undefined })),
                },
                labels: {
                    connect: uniqueLabelIds
                }
            }
        });
        } catch (createError) {
            // Carrera entre reintentos concurrentes: otro proceso ya creo el correo -> idempotente.
            if (isUniqueViolation(createError)) {
                console.log(`[webhook] Concurrent duplicate for user ${user.id}; already stored. Skipping.`);
                continue;
            }
            throw createError;
        }
        void markRuleRun(createdEmail.id, user.id);
        await persistVerdict(createdEmail.id, { id: user.id, email: user.email }, spamMailFull, spamVerdict);
        // Reglas v2: cabeceras de la lista blanca (Email.hdrs), estadisticas de uso y reenvios permitidos (desactivados por defecto).
        // Best-effort: nada de esto puede hacer fallar la ingesta.
        try {
            await saveEmailHdrs(createdEmail.id, inboundEffects.hdrs);
            if (inboundEffects.appliedRuleIds.length > 0) {
                await bumpRuleStats(user.id, Object.fromEntries(inboundEffects.appliedRuleIds.map((rid) => [rid, 1])));
            }
            if (inboundEffects.forwardTo.length > 0) {
                await runForwards({
                    userId: user.id, userEmail: user.email, from: formattedFrom, subject: String(subject || ''),
                    text: String(text || ''), html: String(html || ''), hdrs: inboundEffects.hdrs,
                }, inboundEffects.forwardTo);
            }
        } catch (ruleError) {
            console.error('[webhook] Rule post-processing failed (non-fatal):', (ruleError as Error)?.message);
        }

        // Hilo por cabeceras (Message-ID / In-Reply-To / References / Thread-Index). Tolerante: nunca hace fallar la ingesta; si el MIME crudo
        // llega despues (process-attachments) se vuelve a calcular con las cabeceras completas.
        try {
            const threadInfo = threadInfoFromRecord(headersMap as Record<string, unknown>, resolvedMessageId);
            await assignThread({
                userId: user.id, emailId: createdEmail.id, headers: headersOfInbound(threadInfo), date: createdEmail.createdAt.getTime(),
                subject: createdEmail.subject, from: formattedFrom, to: toField, cc: ccField, own: [user.email],
                noFallback: threadInfo.autoSubmitted || threadInfo.bulk || Boolean(threadInfo.listId),
            });
        } catch (threadError) {
            console.error('[webhook] Thread assignment failed (non-fatal):', (threadError as Error)?.message);
        }

        // Content-ID de imagenes inline (best-effort: si la columna aun no existe, no rompe la ingesta).
        // Los adjuntos pendientes los rellena process-attachments leyendo la cabecera del MIME.
        await saveAttachmentContentIds(attachmentContentIds.map((c) => ({ emailId: createdEmail.id, ...c })));

        // Eventos v2 (lifecycle.events.v2): EMAIL_SPAM_DETECTED y LABEL_APPLIED (reglas). Asincronos, idempotentes y aislados: nunca afectan a la ingesta.
        emitEmailSpamDetected(user.id, { emailId: createdEmail.id, from: formattedFrom }, spamVerdict);
        void emitLabelApplied(user.id, createdEmail.id, inboundEffects.labelIds, 'rule');

        // Hook de extensiones EMAIL_RECEIVED: nunca bloquea ni hace fallar la ingesta.
        const receivedHookContext = { emailId: createdEmail.id, userId: user.id, domain: user.email.split('@')[1] || null };
        try {
            after(() => { void runEmailReceivedHooks(receivedHookContext); });
        } catch {
            void runEmailReceivedHooks(receivedHookContext);
        }


        // 🚀 Launch async attachment processing AFTER the webhook response is sent.
        // Using Next.js after() so this runs after the response without blocking Resend's timeout.
        // The process-attachments route will: download raw MIME, extract all attachments
        // with proper RFC-2047 filename decoding, upload to storage, and update DB records.
        // Trigger async processing when: a raw-MIME URL is available, a placeholder is
        // pending, OR any attachment is a calendar invite or landed empty (Resend never
        // inlines .ics content, so these always need a raw-MIME backfill).
        const needsAsyncProcessing =
            rawMimeUrl ||
            attachmentMetaRecords.some(
                a =>
                    a.status === 'pending' ||
                    a.size === 0 ||
                    a.mimeType.toLowerCase().includes('calendar') ||
                    a.filename.toLowerCase().endsWith('.ics'),
            );
        if (needsAsyncProcessing) {
            const emailIdForAsync = createdEmail.id;
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
            // Clave interna derivada de NEXTAUTH_SECRET (lib/internal-auth.ts); INTERNAL_SECRET solo si esta definido.
            const internalSecret = internalSecretToSend();
            const triggerProcessAttachments = () => {
                fetch(`${appUrl}/api/emails/${emailIdForAsync}/process-attachments`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-internal-secret': internalSecret,
                    },
                }).catch(err =>
                    console.error(`[webhook] Failed to trigger process-attachments for ${emailIdForAsync}:`, err),
                );
            };

            try {
                after(triggerProcessAttachments);
            } catch {
                // If after() is unavailable (e.g. background script or outside request context), run async
                triggerProcessAttachments();
            }
        }

        if (parsedInvites.length > 0) {
            for (const invite of parsedInvites) {
                try {
                    await handleInboundCalendarInvite({
                        userId: user.id,
                        userEmail: user.email,
                        emailId: createdEmail.id,
                        senderEmail: senderEmail.toLowerCase(),
                        senderName,
                        invite,
                    });
                } catch (inviteError) {
                    // El correo ya esta guardado: un fallo del calendario no debe provocar reintentos 5xx.
                    console.error('[webhook] Calendar invite handling failed:', inviteError);
                }
            }
        }

        if (deliveryFolder === 'inbox') {
            // El push es opcional: si falla no debe devolver 5xx (el correo ya esta guardado).
            try {
                await sendNewMessagePushNotification(user.id, {
                    title: senderName || senderEmail,
                    body: subject || text?.substring(0, 140) || 'You received a new message in BloomX.',
                    url: '/?folder=inbox',
                    tag: `email-${userMessageId}`,
                });
            } catch (pushError) {
                console.error('[webhook] Push notification failed:', pushError);
            }
        }
    }
}

async function handleEmailStatusEvent(type: string, data: any) {
    const { email_id, created_at, to, from, subject } = data;

    console.log(`Received event: ${type} for email ${email_id}`);

    // Find if we have this email in our DB
    const email = await prisma.email.findUnique({
        where: { messageId: email_id }
    });

    // Log the event
    await prisma.emailEvent.create({
        data: {
            type: type,
            resendEmailId: email_id,
            data: data as any,
            emailId: email?.id // Link relation if we found the local email
        }
    });

    // Update Email Status based on Event Type
    if (email) {
        let newStatus = null;

        switch (type) {
            case 'email.sent':
                newStatus = 'sent';
                break;
            case 'email.delivered':
                newStatus = 'delivered';
                break;
            case 'email.delivery_delayed':
                newStatus = 'delayed';
                break;
            case 'email.bounced':
                newStatus = 'bounced';
                break;
            case 'email.complained':
                newStatus = 'complained';
                break;
        }

        if (newStatus) {
            // Un programado que el proveedor ya envio (sent/delivered/bounced/complained) deja de estar "programado": pasa a
            // Enviados y se dispara EMAIL_SENT UNA sola vez (la condicion folder='scheduled' de la actualizacion lo garantiza
            // aunque lleguen varios eventos o reintentos del webhook).
            const leftSchedule = email.folder === 'scheduled' && newStatus !== 'delayed';
            if (leftSchedule) {
                const moved = await prisma.email.updateMany({
                    where: { id: email.id, folder: 'scheduled' },
                    data: { status: newStatus, folder: 'sent' },
                });
                if (moved.count > 0) {
                    const list = (v: string | null) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);
                    fireLifecycleHook('EMAIL_SENT', email.userId, buildEmailSentContext({
                        emailId: email.id, to: list(email.to), cc: list(email.cc), bcc: list(email.bcc), hasAttachments: false, sentAt: new Date(),
                    }));
                    return;
                }
            }
            await prisma.email.update({
                where: { id: email.id },
                data: { status: newStatus }
            });
        }
    }
}
