import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyMoltToken } from '@/lib/molt-auth';
import { resend } from '@/lib/resend';
import { MAX_RECIPIENTS, formatFromHeader, parseRecipientList, sanitizeSubject } from '@/lib/mail-validation';
import { rateLimit } from '@/lib/security';

export async function GET(req: NextRequest) {
    // 1. Authenticate
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await verifyMoltToken(token);
    if (!user) return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });

    // 2. Fetch Messages
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '10');
    const folder = searchParams.get('folder') || 'inbox';

    try {
        const emails = await prisma.email.findMany({
            where: {
                userId: user.id,
                folder: folder,
            },
            take: limit,
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                from: true,
                to: true,
                subject: true,
                snippet: true,
                createdAt: true,
                read: true,
                starred: true
            }
        });

        return NextResponse.json({ success: true, emails });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    // 1. Authenticate
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await verifyMoltToken(token);
    if (!user) return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });

    // 2. Send Message
    try {
        const body = await req.json();
        const { to, subject, text, html, cc, bcc, reply_to, scheduled_at } = body;

        if (!to || !subject || (!text && !html)) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Validacion anti header-injection / abuso (mismas reglas que /api/emails)
        const toList = parseRecipientList(to);
        const ccList = parseRecipientList(cc);
        const bccList = parseRecipientList(bcc);
        if (toList.invalid.length || ccList.invalid.length || bccList.invalid.length || toList.valid.length === 0) {
            return NextResponse.json({ error: 'Invalid recipient address' }, { status: 400 });
        }
        if (toList.valid.length + ccList.valid.length + bccList.valid.length > MAX_RECIPIENTS) {
            return NextResponse.json({ error: `Too many recipients (max ${MAX_RECIPIENTS})` }, { status: 400 });
        }
        const rl = rateLimit(`molt-send:${user.id}`, 60, 60 * 60 * 1000);
        if (!rl.ok) {
            return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } });
        }

        const payload: any = {
            // Use the authenticated user's email.
            // Note: This requires the user's email domain to be verified in Resend.
            from: formatFromHeader(user.name, user.email),
            to: toList.valid,
            subject: sanitizeSubject(subject),
            text: text || '',
            html: html,
        };

        if (ccList.valid.length) payload.cc = ccList.valid;
        if (bccList.valid.length) payload.bcc = bccList.valid;
        if (reply_to) {
            const replyList = parseRecipientList(reply_to);
            if (replyList.valid.length) payload.reply_to = replyList.valid.slice(0, 1);
        }
        if (scheduled_at) payload.scheduled_at = scheduled_at;

        const { data, error } = await resend.emails.send(payload);

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }

        // 3. Save to Sent Folder (Database)
        const sentEmail = await prisma.email.create({
            data: {
                userId: user.id,
                messageId: data?.id || `sent-${Date.now()}`,
                from: user.email,
                to: toList.valid.join(', '),
                subject: payload.subject,
                snippet: text?.substring(0, 100) || '',
                folder: 'sent',
                status: 'sent',
                read: true,
                scheduledAt: scheduled_at ? new Date(scheduled_at) : null
            }
        });

        return NextResponse.json({ success: true, data, email: sentEmail });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
