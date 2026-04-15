
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resend } from '@/lib/resend';
import { getCurrentUser } from "@/lib/session";
import { uploadToStorage } from '@/lib/storage';
import { parseInviteFromIcs } from '@/lib/calendar/ics';

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
    const page = parseInt(searchParams.get('page') || '1');
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

        if (since) {
            whereObj.AND.push({
                createdAt: { gt: new Date(since) }
            });
        }

        const until = searchParams.get('until');
        if (until) {
            whereObj.AND.push({
                createdAt: { lt: new Date(until) }
            });
        }

        if (q) {
            whereObj.AND.push({
                OR: [
                    { subject: { contains: q, mode: 'insensitive' } },
                    { from: { contains: q, mode: 'insensitive' } },
                    { snippet: { contains: q, mode: 'insensitive' } },
                    { to: { contains: q, mode: 'insensitive' } },
                    { cleanTo: { contains: q, mode: 'insensitive' } }
                ]
            });
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
            const labelsList = label.split(',');
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
        } else if (!q) {
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
export async function POST(req: NextRequest) {
    const sessionUser = await getCurrentUser();

    if (!sessionUser) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { to, subject, html, text, from, cc, bcc, attachments, scheduledAt, replyTo, reply_to } = body;
        const timestamp = Date.now();

        const processedAttachments = await Promise.all((attachments || []).map(async (att: any, index: number) => {
            if (att?.contentBase64) {
                const safeFilename = (att.filename || `attachment-${index + 1}.bin`).replace(/[^a-zA-Z0-9.-]/g, '_');
                const key = att.key || `attachments/${sessionUser.email}/${timestamp}-${safeFilename}`;
                const buffer = Buffer.from(att.contentBase64, 'base64');

                await uploadToStorage(key, buffer, att.mimeType || 'application/octet-stream');

                return {
                    ...att,
                    key,
                    size: att.size || buffer.byteLength,
                };
            }

            return att;
        }));

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

        const formattedFrom = `${senderName} <${senderEmail}>`;

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

        const payload: any = {
            from: formattedFrom,
            to: to.split(','),
            cc: cc ? cc.split(',') : undefined,
            bcc: bcc ? bcc.split(',') : undefined,
            subject: subject,
            html: finalHtml || undefined,
            text: finalText || undefined,
            attachments: resendAttachments.length > 0 ? resendAttachments : undefined
        };

        const requestedReplyTo = extractEmailAddress(replyTo || reply_to || '');
        if (requestedReplyTo.includes('@')) {
            payload.reply_to = [requestedReplyTo];
        }

        if (scheduledAt) {
            payload.scheduledAt = scheduledAt;
        }

        // Send via Resend
        const { data, error } = await resend.emails.send(payload);

        if (error) {
            console.error(error, to);
            return NextResponse.json({ error }, { status: 400 });
        }

        // Upload HTML/Text to Storage for persistence
        // We use the same storage as inbound emails
        const safeSubject = (subject || 'no-subject').replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 50);

        let htmlKey = null;
        let textKey = null;

        if (finalHtml) {
            htmlKey = `sent / ${sessionUser.email}/${timestamp}-${safeSubject}.html`;
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
                replyTo: requestedReplyTo.includes('@') ? requestedReplyTo : null,
                cleanTo: to.split(',').map((email: string) => { // Use same logic as before or extract helper
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
                folder: scheduledAt ? 'scheduled' : 'sent',
                status: scheduledAt ? 'scheduled' : 'sent',
                scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
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

        return NextResponse.json({ success: true, id: data?.id });

    } catch (error) {
        console.log(error);
        return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
    }
}
