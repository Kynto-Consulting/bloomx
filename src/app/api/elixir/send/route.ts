import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { resend } from '@/lib/resend';
import { prisma } from '@/lib/prisma';
import { renderTemplate } from '@/lib/liquid';
import { extractAddress, formatFromHeader, isValidEmailAddress, parseRecipientList, sanitizeSubject } from '@/lib/mail-validation';
import { buildUnsubscribeHeaders, getSuppressedRecipients } from '@/lib/unsubscribe';
import { rateLimit } from '@/lib/security';

const MAX_BULK_ROWS = Number.parseInt(process.env.MAX_BULK_ROWS || '500', 10) || 500;
const MAX_EXTRA_RECIPIENTS = 10;

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

    // Limite de solicitudes de envio masivo por usuario (best-effort por instancia).
    const rl = rateLimit(`elixir:${sessionUser.id}`, 10, 60 * 60 * 1000);
    if (!rl.ok) {
        return NextResponse.json({ error: 'Too many bulk sends. Try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } });
    }

    let body: SendPayload;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const { rows, template, subject, recipientColumn, senderConfig = {}, systemVars = {} } = body;

    if (!Array.isArray(rows) || !rows.length) return NextResponse.json({ error: 'No rows provided' }, { status: 400 });
    if (rows.length > MAX_BULK_ROWS) {
        return NextResponse.json({ error: `Too many rows (max ${MAX_BULK_ROWS} per request)` }, { status: 400 });
    }
    if (String(template || '').length > 500_000) return NextResponse.json({ error: 'Template too large' }, { status: 413 });
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

    // Destinatarios que ya se dieron de baja de este remitente (RFC 8058).
    const suppressed = await getSuppressedRecipients(user.id).catch(() => new Set<string>());
    const seenRecipients = new Set<string>();

    for (const row of rows) {
        const recipientEmail = String(row?.[recipientColumn] || '').trim();
        if (!isValidEmailAddress(recipientEmail)) {
            results.push({ email: recipientEmail.slice(0, 80) || '(vacío)', row, status: 'skipped', message: 'Email inválido' }); continue;
        }
        const recipientKey = recipientEmail.toLowerCase();
        if (seenRecipients.has(recipientKey)) {
            results.push({ email: recipientEmail, row, status: 'skipped', message: 'Duplicado' }); continue;
        }
        seenRecipients.add(recipientKey);
        if (suppressed.has(recipientKey)) {
            results.push({ email: recipientEmail, row, status: 'skipped', message: 'Dado de baja' }); continue;
        }

        const mergedRow = { ...systemVars, ...row };

        const renderedSubject = sanitizeSubject(renderTemplate(subject, mergedRow));
        const renderedHtml = renderTemplate(template, mergedRow);

        // El remitente se valida DESPUES de renderizar: la plantilla puede tomar valores de la fila
        // (CSV) y no debe permitir suplantar una cuenta ajena.
        const fromName = senderConfig.fromName?.trim() ? renderTemplate(senderConfig.fromName, mergedRow) : (user.name || 'User');
        const renderedFrom = senderConfig.fromEmail?.trim() ? renderTemplate(senderConfig.fromEmail, mergedRow) : user.email;
        const fromEmail = extractAddress(renderedFrom).toLowerCase();
        if (!isValidEmailAddress(fromEmail) || !allowedEmails.has(fromEmail)) {
            results.push({ email: recipientEmail, row, status: 'error', message: 'Unauthorized sender account' }); continue;
        }
        const formattedFrom = formatFromHeader(fromName, fromEmail);

        const cc = senderConfig.cc?.trim()
            ? parseRecipientList(renderTemplate(senderConfig.cc, mergedRow)).valid.slice(0, MAX_EXTRA_RECIPIENTS)
            : undefined;
        const bcc = senderConfig.bcc?.trim()
            ? parseRecipientList(renderTemplate(senderConfig.bcc, mergedRow)).valid.slice(0, MAX_EXTRA_RECIPIENTS)
            : undefined;

        try {
            const payload: any = { from: formattedFrom, to: [recipientEmail], subject: renderedSubject, html: renderedHtml };
            if (cc?.length) payload.cc = cc;
            if (bcc?.length) payload.bcc = bcc;

            const unsubscribeHeaders = buildUnsubscribeHeaders(user.id, recipientEmail, fromEmail);
            if (unsubscribeHeaders) payload.headers = unsubscribeHeaders;

            const { error } = await resend.emails.send(payload);
            if (error) { results.push({ email: recipientEmail, row, status: 'error', message: String((error as any)?.message || 'Send failed') }); }
            else { results.push({ email: recipientEmail, row, status: 'sent' }); }
        } catch (e: any) {
            results.push({ email: recipientEmail, row, status: 'error', message: e?.message || 'Error desconocido' });
        }

        await new Promise(r => setTimeout(r, 500));
    }

    return NextResponse.json({ results });
}
