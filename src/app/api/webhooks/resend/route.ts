import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { prisma } from '@/lib/prisma';
import { uploadToStorage } from '@/lib/storage';
import { Webhook } from 'svix';
import { resend } from '@/lib/resend';
import { sendNewMessagePushNotification } from '@/lib/notifications/web-push';
import { ensureDefaultCalendars } from '@/lib/calendar/defaults';
import { ParsedInvite, parseInviteFromIcs } from '@/lib/calendar/ics';
import { classifySpamFromHeaders } from '@/lib/spam-headers';
import { decodeRFC2047, extractFilenameFromHeaders, extensionFromMimeType, sanitizeFilename } from '@/lib/mime-decode';

export async function POST(req: NextRequest) {
    // 1. Validate Request Signature
    const payload = await req.text();
    const headers = {
        'svix-id': req.headers.get('svix-id') || '',
        'svix-timestamp': req.headers.get('svix-timestamp') || '',
        'svix-signature': req.headers.get('svix-signature') || '',
    };

    if (process.env.WEBHOOK_SECRET) {
        const wh = new Webhook(process.env.WEBHOOK_SECRET);
        try {
            wh.verify(payload, headers);
        } catch (err) {
            console.error('Webhook signature verification failed');
            return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
        }
    }

    const event = JSON.parse(payload);
    const { type, data } = event;

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

function normalizeInviteStatus(value?: string | null): 'accepted' | 'tentative' | 'declined' | 'needsAction' {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'accepted') return 'accepted';
    if (normalized === 'tentative') return 'tentative';
    if (normalized === 'declined') return 'declined';
    return 'needsAction';
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

// NOTE: extractNonCalendarAttachmentsFromRawMime and extractCalendarIcsFromRawEmail
// have been moved to /api/emails/[id]/process-attachments which runs asynchronously
// after the webhook returns, avoiding Vercel execution time limits.

function extractCalendarIcsFromRawEmail(rawSource: string): string[] {
    const source = String(rawSource || '');
    const foundBlocks: string[] = [];

    const partRegex = /Content-Type:\s*(?:text\/calendar|application\/ics)[^\r\n]*((?:\r?\n[^\r\n]*)*)\r?\n\r?\n([\s\S]*?)(?=\r?\n--[^\r\n]+(?:--)?\r?\n?)/gi;
    let partMatch: RegExpExecArray | null = null;
    while ((partMatch = partRegex.exec(source)) !== null) {
        const partHeaders = String(partMatch[1] || '');
        const partBody = String(partMatch[2] || '');
        const transferEncoding = (partHeaders.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i)?.[1] || '').trim().toLowerCase();

        let decoded = partBody;
        if (transferEncoding === 'base64') {
            const base64Payload = partBody.replace(/\s+/g, '');
            try {
                decoded = Buffer.from(base64Payload, 'base64').toString('utf8');
            } catch {
                decoded = '';
            }
        } else if (transferEncoding === 'quoted-printable') {
            decoded = decodeQuotedPrintable(partBody);
        }

        if (decoded && /BEGIN:VCALENDAR/i.test(decoded) && /END:VCALENDAR/i.test(decoded)) {
            foundBlocks.push(decoded);
        }
    }

    if (foundBlocks.length > 0) {
        return Array.from(new Set(foundBlocks));
    }

    const inlineBlocks = source.match(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/gi) || [];
    return Array.from(new Set(inlineBlocks.map((block) => block.trim()).filter(Boolean)));
}

async function handleInboundCalendarInvite(options: {
    userId: string;
    userEmail: string;
    emailId: string;
    senderEmail: string;
    senderName: string | null;
    invite: ParsedInvite;
}) {
    const method = (options.invite.method || 'REQUEST').toUpperCase();
    const inviteUid = options.invite.uid || null;

    const calendars = await ensureDefaultCalendars(options.userId);
    const sharedCalendar = calendars.find((calendar) => calendar.source === 'shared') || calendars[0];
    if (!sharedCalendar) {
        return;
    }

    if (method === 'CANCEL') {
        if (!inviteUid) {
            return;
        }

        await prisma.calendarEvent.updateMany({
            where: {
                userId: options.userId,
                inviteUid,
            },
            data: {
                status: 'cancelled',
                source: 'shared',
                sourceEmailId: options.emailId,
                calendarId: sharedCalendar.id,
            }
        });
        return;
    }

    if (method === 'REPLY') {
        if (!inviteUid) {
            return;
        }

        const existingEvent = await prisma.calendarEvent.findFirst({
            where: {
                userId: options.userId,
                inviteUid,
            },
        });

        if (!existingEvent) {
            return;
        }

        const responder = (options.invite.attendees || []).find((attendee) => attendee.email);
        const responderEmail = (responder?.email || options.senderEmail || '').toLowerCase();
        if (!responderEmail) {
            return;
        }

        const responseStatus = normalizeInviteStatus(responder?.responseStatus || null);
        const existingAttendee = await prisma.calendarAttendee.findFirst({
            where: {
                eventId: existingEvent.id,
                email: responderEmail,
            },
        });

        if (existingAttendee) {
            await prisma.calendarAttendee.update({
                where: { id: existingAttendee.id },
                data: {
                    responseStatus,
                    name: responder?.name || existingAttendee.name,
                },
            });
        } else {
            await prisma.calendarAttendee.create({
                data: {
                    eventId: existingEvent.id,
                    email: responderEmail,
                    name: responder?.name || null,
                    responseStatus,
                    isOrganizer: false,
                }
            });
        }

        if (existingEvent.sourceEmailId) {
            await prisma.emailEvent.create({
                data: {
                    emailId: existingEvent.sourceEmailId,
                    type: 'invite.rsvp',
                    data: {
                        response: responseStatus,
                        responderEmail,
                        responderName: responder?.name || responderEmail,
                        organizerEmail: existingEvent.organizerEmail,
                        organizerName: existingEvent.organizerName,
                        uid: inviteUid,
                    },
                }
            });
        }

        return;
    }

    const startsAt = options.invite.startsAt ? new Date(options.invite.startsAt) : null;
    const endsAt = options.invite.endsAt ? new Date(options.invite.endsAt) : null;

    if (!startsAt || !endsAt || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
        return;
    }

    const existingEvent = await prisma.calendarEvent.findFirst({
        where: {
            userId: options.userId,
            OR: [
                inviteUid ? { inviteUid } : undefined,
                { sourceEmailId: options.emailId },
            ].filter(Boolean) as any,
        },
    });

    const organizerEmail = (options.invite.organizerEmail || options.senderEmail || '').toLowerCase();
    const organizerName = options.invite.organizerName || options.senderName || organizerEmail;

    const attendeeRecords = (options.invite.attendees || [])
        .filter((attendee) => attendee.email)
        .map((attendee) => ({
            email: attendee.email.toLowerCase(),
            name: attendee.name || attendee.email,
            responseStatus: normalizeInviteStatus(attendee.responseStatus || null),
            isOrganizer: Boolean(attendee.isOrganizer) || (organizerEmail ? attendee.email.toLowerCase() === organizerEmail : false),
        }));

    if (organizerEmail && !attendeeRecords.some((attendee) => attendee.email === organizerEmail)) {
        attendeeRecords.push({
            email: organizerEmail,
            name: organizerName,
            responseStatus: 'accepted',
            isOrganizer: true,
        });
    }

    if (options.userEmail && !attendeeRecords.some((attendee) => attendee.email === options.userEmail.toLowerCase())) {
        attendeeRecords.push({
            email: options.userEmail.toLowerCase(),
            name: options.userEmail,
            responseStatus: 'needsAction',
            isOrganizer: false,
        });
    }

    const eventData = {
        calendarId: sharedCalendar.id,
        title: options.invite.summary || 'Invitation',
        description: options.invite.description || null,
        location: options.invite.meetUrl || options.invite.location || null,
        startsAt,
        endsAt,
        source: 'shared',
        status: 'confirmed',
        responseStatus: null,
        inviteUid,
        organizerEmail: organizerEmail || null,
        organizerName: organizerName || null,
        sourceEmailId: options.emailId,
    };

    if (existingEvent) {
        await prisma.calendarEvent.update({
            where: { id: existingEvent.id },
            data: {
                ...eventData,
                attendees: {
                    deleteMany: {},
                    create: attendeeRecords,
                }
            }
        });
    } else {
        await prisma.calendarEvent.create({
            data: {
                userId: options.userId,
                ...eventData,
                attendees: {
                    create: attendeeRecords,
                }
            }
        });
    }
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

    // Normalize recipient data
    // 'to' can be string, string[], or object[] {name, email}
    let rawRecipients: any[] = [];
    if (Array.isArray(to)) {
        rawRecipients = to;
    } else if (to) {
        rawRecipients = [to];
    }

    const recipients = rawRecipients
        .map((recipient) => {
            const parsed = parseMailbox(recipient);
            if (parsed.email) {
                return parsed.email;
            }

            if (typeof recipient === 'string') {
                return recipient.trim().toLowerCase();
            }

            return String((recipient as any)?.email || '').trim().toLowerCase();
        })
        .filter(Boolean); // Clean string emails

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
    const users = await prisma.user.findMany({
        where: { email: { in: normalizedRecipients } }
    });

    if (users.length === 0) {
        console.log(`Rejected email: no matching user found in DB.`);

        // Auto-reply logic for User Unknown
        const topDomain = process.env.TOP_DOMAIN;
        if (topDomain) {
            try {
                await resend.emails.send({
                    from: `noreply@${topDomain}`,
                    to: senderEmail,
                    subject: `Undeliverable: ${subject || 'No Subject'}`,
                    html: `
                        <div style="font-family: sans-serif; padding: 20px;">
                            <h2 style="color: #d93025;">Delivery Status Notification (Failure)</h2>
                            <p>Hello,</p>
                            <p>Your message to <strong>${toField}</strong> could not be delivered because the recipient(s) do not exist in the domain <strong>${topDomain}</strong>.</p>
                            <p>Please check the email address and try again.</p>
                            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
                            <p style="color: #666; font-size: 12px; text-align: center;">This is an automated message from ${topDomain}. Please do not reply.</p>
                        </div>
                    `
                });
                console.log(`Auto-reply sent to ${senderEmail}`);
            } catch (replyError) {
                console.error('Failed to send auto-reply:', replyError);
            }
        }
        return NextResponse.json({ success: true, message: 'User not found' });
    }


    const uuid = crypto.randomUUID();
    const dateStr = new Date().toISOString().split('T')[0];

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

    let fetchedReceivingData: any = null;
    if (webhookEmailId && (!html || !text || hasCalendarAttachmentWithoutContent)) {
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

    if (!html && !text) {
        console.warn('[resend] Email body was still unavailable after Resend API fallback.');
        // Fallback for missing content if fetch also failed
        const placeholder = '<div style="padding: 20px; text-align: center; color: #666; background: #f9f9f9; border-radius: 8px;"><p><strong>Content Unavailable</strong></p><p>The email provider did not include the message body.</p></div>';
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

    // Process attachments that came with inline content in the webhook payload (small files)
    if (attachments && Array.isArray(attachments)) {
        for (const att of attachments) {
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

                const attKey = `emails/${dateStr}/${uuid}/attachments/${filename}`;
                uploads.push(uploadToStorage(attKey, buffer, contentType));

                attachmentMetaRecords.push({
                    filename,
                    mimeType: contentType,
                    size: att.size || buffer.length,
                    key: attKey,
                    status: 'ready',
                });

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

    const spamThresholdRaw = Number.parseFloat(String(process.env.SPAM_SCORE_THRESHOLD || '60'));
    const spamThreshold = Number.isFinite(spamThresholdRaw)
        ? Math.min(100, Math.max(0, spamThresholdRaw))
        : 60;
    const autoSpamEnabled = String(process.env.ENABLE_AUTO_SPAM_DETECTION || 'true').toLowerCase() !== 'false';
    const spamClassification = classifySpamFromHeaders(headersMap as Record<string, unknown>, spamThreshold);
    const deliveryFolder = autoSpamEnabled && spamClassification.isSpam ? 'spam' : 'inbox';

    // 4. Store in Postgres (Per User)
    for (const user of users) {
        // Identify Labels for THIS user
        const matchingLabels: { id: string }[] = [];

        // Check Alias Suffixes (e.g. user+news@...)
        const userEmail = user.email.toLowerCase();
        // Determine which specific recipient address maps to this user to check alias
        // Simple heuristic: check if any raw recipient starts with user's localpart + '+'
        const userLocal = userEmail.split('@')[0];

        for (const rawEmail of uniqueRawRecipients) {
            // Check if this raw email belongs to this user
            if (rawEmail.toLowerCase().startsWith(userLocal)) {
                const match = rawEmail.match(/\+([^@]+)@/);
                if (match) {
                    const suffix = match[1].toLowerCase();
                    const label = await prisma.label.findFirst({
                        where: { userId: user.id, aliasSuffix: suffix }
                    });
                    if (label) matchingLabels.push({ id: label.id });
                }
            }
        }

        // Check Regex Filters for THIS user
        const regexLabels = await prisma.label.findMany({
            where: { userId: user.id, filterRegex: { not: null } }
        });

        for (const label of regexLabels) {
            if (label.filterRegex) {
                try {
                    const regex = new RegExp(label.filterRegex, 'i');
                    if (regex.test(subject || '') || regex.test(text || '')) {
                        matchingLabels.push({ id: label.id });
                    }
                } catch (e) {
                    console.error(`Invalid regex for label ${label.name}:`, e);
                }
            }
        }

        const uniqueLabelIds = Array.from(new Set(matchingLabels.map(l => l.id))).map(id => ({ id }));

        const createdEmail = await prisma.email.create({
            data: {
                userId: user.id,
                from: formattedFrom,
                to: toField,
                cc: ccField,
                replyTo: replyToEmail,
                cleanTo: Array.from(new Set(normalizedRecipients)).join(', '),
                subject: subject || '(No Subject)',
                messageId: users.length > 1 ? `${resolvedMessageId || uuid}-${user.id}` : (resolvedMessageId || uuid),
                snippet: text ? text.substring(0, 200) : '',
                htmlKey: (html || (!html && !text)) ? htmlKey : null,
                textKey: text ? textKey : null,
                rawKey: rawKey,
                rawMimeUrl: rawMimeUrl,
                folder: deliveryFolder,
                attachments: {
                    create: attachmentMetaRecords.map(a => ({ ...a, emailId: undefined })),
                },
                labels: {
                    connect: uniqueLabelIds
                }
            }
        });

        // 🚀 Launch async attachment processing AFTER the webhook response is sent.
        // Using Next.js after() so this runs after the response without blocking Resend's timeout.
        // The process-attachments route will: download raw MIME, extract all attachments
        // with proper RFC-2047 filename decoding, upload to storage, and update DB records.
        if (rawMimeUrl || attachmentMetaRecords.some(a => a.status === 'pending')) {
            const emailIdForAsync = createdEmail.id;
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
            const internalSecret = process.env.INTERNAL_SECRET || '';
            after(
                fetch(`${appUrl}/api/emails/${emailIdForAsync}/process-attachments`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-internal-secret': internalSecret,
                    },
                }).catch(err =>
                    console.error(`[webhook] Failed to trigger process-attachments for ${emailIdForAsync}:`, err),
                ),
            );
        }

        if (parsedInvites.length > 0) {
            for (const invite of parsedInvites) {
                await handleInboundCalendarInvite({
                    userId: user.id,
                    userEmail: user.email,
                    emailId: createdEmail.id,
                    senderEmail: senderEmail.toLowerCase(),
                    senderName,
                    invite,
                });
            }
        }

        if (deliveryFolder === 'inbox') {
            await sendNewMessagePushNotification(user.id, {
                title: senderName || senderEmail,
                body: subject || text?.substring(0, 140) || 'You received a new message in BloomX.',
                url: '/?folder=inbox',
                tag: `email-${resolvedMessageId || uuid}-${user.id}`,
            });
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
            await prisma.email.update({
                where: { id: email.id },
                data: { status: newStatus }
            });
        }
    }
}
