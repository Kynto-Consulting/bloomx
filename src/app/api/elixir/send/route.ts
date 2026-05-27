import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { resend } from '@/lib/resend';
import { prisma } from '@/lib/prisma';
import { renderTemplate } from '@/lib/liquid';

type Row = Record<string, string>;

type SenderConfig = {
    fromName?: string;
    fromEmail?: string;
    cc?: string;
    bcc?: string;
};

type SendPayload = {
    rows: Row[];
    template: string;
    subject: string;
    recipientColumn: string;
    senderConfig?: SenderConfig;
    systemVars?: Row;
};

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    const sessionUser = await getCurrentUser();
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body: SendPayload = await req.json();
    const { rows, template, subject, recipientColumn, senderConfig = {}, systemVars = {} } = body;

    if (!rows?.length) return NextResponse.json({ error: 'No rows provided' }, { status: 400 });
    if (!template?.trim()) return NextResponse.json({ error: 'Template is empty' }, { status: 400 });
    if (!subject?.trim()) return NextResponse.json({ error: 'Subject is empty' }, { status: 400 });
    if (!recipientColumn) return NextResponse.json({ error: 'Recipient column not specified' }, { status: 400 });

    const user = await prisma.user.findUnique({
        where: { id: sessionUser.id },
        select: {
            id: true,
            email: true,
            name: true,
            accounts: { select: { providerAccountId: true } },
        },
    });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // Build set of emails this user is authorized to send from
    const allowedEmails = new Set<string>([
        user.email.toLowerCase(),
        ...user.accounts
            .map(a => String(a.providerAccountId || '').trim().toLowerCase())
            .filter(e => e.includes('@')),
    ]);

    // Validate fromEmail if explicitly provided
    if (senderConfig.fromEmail?.trim()) {
        const raw = senderConfig.fromEmail.trim().toLowerCase();
        const extracted = raw.match(/<([^>]+)>/)?.[1]?.toLowerCase() ?? raw;
        if (!allowedEmails.has(extracted)) {
            return NextResponse.json({ error: 'Unauthorized sender account' }, { status: 401 });
        }
    }

    const results: { email: string; row: Row; status: 'sent' | 'error' | 'skipped'; message?: string }[] = [];

    for (const row of rows) {
        const recipientEmail = (row[recipientColumn] || '').trim();
        if (!recipientEmail.includes('@')) {
            results.push({ email: recipientEmail || '(vacío)', row, status: 'skipped', message: 'Email inválido' }); continue;
        }

        const mergedRow = { ...systemVars, ...row };

        const renderedSubject = renderTemplate(subject, mergedRow);
        const renderedHtml = renderTemplate(template, mergedRow);

        const fromName = senderConfig.fromName?.trim() ? renderTemplate(senderConfig.fromName, mergedRow) : (user.name || 'User');
        const fromEmail = senderConfig.fromEmail?.trim() ? renderTemplate(senderConfig.fromEmail, mergedRow) : user.email;
        const formattedFrom = `${fromName} <${fromEmail}>`;

        const cc = senderConfig.cc?.trim()
            ? renderTemplate(senderConfig.cc, mergedRow).split(',').map(s => s.trim()).filter(s => s.includes('@'))
            : undefined;
        const bcc = senderConfig.bcc?.trim()
            ? renderTemplate(senderConfig.bcc, mergedRow).split(',').map(s => s.trim()).filter(s => s.includes('@'))
            : undefined;

        try {
            const payload: any = { from: formattedFrom, to: [recipientEmail], subject: renderedSubject, html: renderedHtml };
            if (cc?.length) payload.cc = cc;
            if (bcc?.length) payload.bcc = bcc;

            const { error } = await resend.emails.send(payload);
            if (error) { results.push({ email: recipientEmail, row, status: 'error', message: String(error) }); }
            else { results.push({ email: recipientEmail, row, status: 'sent' }); }
        } catch (e: any) {
            results.push({ email: recipientEmail, row, status: 'error', message: e?.message || 'Error desconocido' });
        }

        await new Promise(r => setTimeout(r, 500));
    }

    return NextResponse.json({ results });
}
