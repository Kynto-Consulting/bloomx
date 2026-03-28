import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { uploadToStorage } from '@/lib/storage';
import { Webhook } from 'svix';
import { resend } from '@/lib/resend';
import { sendNewMessagePushNotification } from '@/lib/notifications/web-push';

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
    const { from, to, subject, attachments, messageId } = data;
    let { html, text } = data;

    // Normalize recipient data
    // 'to' can be string, string[], or object[] {name, email}
    let rawRecipients: any[] = [];
    if (Array.isArray(to)) {
        rawRecipients = to;
    } else if (to) {
        rawRecipients = [to];
    }

    const recipients = rawRecipients.map(r => {
        if (typeof r === 'string') return r;
        return r.email || '';
    }).filter(Boolean); // Clean string emails

    // Normalize all recipients for validation, but store RAW for display
    const normalizedRecipients = recipients.map(email => normalizeEmail(email));

    // Parse sender (Moved up for auto-reply)
    const senderMatch = from.match(/^(.+?)\s*<(.+?)>$/);
    const senderEmail = senderMatch ? senderMatch[2].trim() : from.trim();
    const senderName = senderMatch ? senderMatch[1].trim() : null;
    const formattedFrom = senderName ? `${senderName} <${senderEmail}>` : senderEmail;

    // Use RAW for storage (Dedupe case-sensitive or insensitive? Let's keep it exact as received)
    const uniqueRawRecipients = Array.from(new Set(recipients));
    const toField = uniqueRawRecipients.join(', ');

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
    if (!html && !text) {
        console.log('[resend] Email body missing in webhook payload. Attempting Resend API fallback...');
        try {
            const res = await fetch(`https://api.resend.com/emails/receiving/${data.email_id}`, {
                headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}` }
            });

            if (res.ok) {
                const fetchedData = await res.json();
                if (fetchedData.html) html = fetchedData.html;
                if (fetchedData.text) text = fetchedData.text;
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

    // 3. Upload Attachments
    const attachmentRecords = [];
    if (attachments && Array.isArray(attachments)) {
        for (const att of attachments) {
            if (att.content) {
                const attKey = `emails/${dateStr}/${uuid}/attachments/${att.filename}`;

                const buffer = Buffer.from(att.content.data || att.content);

                uploads.push(uploadToStorage(attKey, buffer, att.contentType || 'application/octet-stream'));

                attachmentRecords.push({
                    filename: att.filename,
                    mimeType: att.contentType || 'application/octet-stream',
                    size: att.size || buffer.length,
                    key: attKey
                });
            }
        }
    }

    await Promise.all(uploads);

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

        await prisma.email.create({
            data: {
                userId: user.id, // Assign to correct user
                from: formattedFrom,
                to: toField,
                cleanTo: Array.from(new Set(normalizedRecipients)).join(', '),
                subject: subject || '(No Subject)',
                messageId: users.length > 1 ? `${messageId || uuid}-${user.id}` : (messageId || uuid), // Ensure unique messageId per record if multipule users? 
                // Wait, messageId in schema is unique? Yes.
                // If we store same email for multiple users, they need distinct messageId in DB?
                // The Schema says `messageId String @unique`.
                // So yes, we must append user.id or random suffix if multiple users receive it.
                // Actually, `messageId` from email headers is global.
                // If we enforce uniqueness, we can't save the same messageId twice.
                // Solution: We should probably scope messageId by userId in schema, OR append suffixes.
                // Appending suffix is safer for now without schema migration.
                snippet: text ? text.substring(0, 200) : '',
                htmlKey: (html || (!html && !text)) ? htmlKey : null,
                textKey: text ? textKey : null,
                rawKey: rawKey,
                folder: 'inbox',
                attachments: {
                    create: attachmentRecords.map(a => ({ ...a, emailId: undefined })) // Create new attachment records for each email? 
                    // Attachment schema links to Email via emailId.
                    // Yes, we need to clone attachment records for each email entry.
                },
                labels: {
                    connect: uniqueLabelIds
                }
            }
        });

        await sendNewMessagePushNotification(user.id, {
            title: senderName || senderEmail,
            body: subject || text?.substring(0, 140) || 'You received a new message in BloomX.',
            url: '/?folder=inbox',
            tag: `email-${messageId || uuid}-${user.id}`,
        });
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
