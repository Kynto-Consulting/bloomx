import { prisma } from '@/lib/prisma';
import { resend } from '@/lib/resend';
import { getRequestEmailBrand, getRequestEmailLocale } from '@/lib/calendar/email-brand-server';
import { uploadToStorage } from '@/lib/storage';
import { inviteProdId } from '@/lib/calendar/invite-template.js';
import {
    buildEmailHtml,
    buildEmailText,
    calendarInviteOptions,
    emailSubject,
    resolveTimeZone,
    type EmailBrand,
    type EmailLocale,
} from '@/lib/calendar/email-templates';

type EventForInvite = {
    id: string;
    title: string;
    description?: string | null;
    location?: string | null;
    startsAt: Date;
    endsAt: Date;
    inviteUid?: string | null;
    externalId?: string | null;
    organizerEmail?: string | null;
    organizerName?: string | null;
    updatedAt?: Date | null;
    attendees: Array<{ email: string; name?: string | null; isOrganizer: boolean }>;
};

function escapeIcsText(value: string) {
    return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');
}

function formatIcsDate(value: string | Date) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function buildRequestIcs(event: EventForInvite, uid: string, sequence: number, organizer: { email: string; name: string }, brandName: string, locale: EmailLocale) {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        `PRODID:${inviteProdId(brandName, locale)}`,
        'CALSCALE:GREGORIAN',
        'METHOD:REQUEST',
        'BEGIN:VEVENT',
        `UID:${escapeIcsText(uid)}`,
        `DTSTAMP:${formatIcsDate(new Date())}`,
        `DTSTART:${formatIcsDate(event.startsAt)}`,
        `DTEND:${formatIcsDate(event.endsAt)}`,
        `SUMMARY:${escapeIcsText(event.title || 'New Event')}`,
        `DESCRIPTION:${escapeIcsText(event.description || event.title || 'Event invitation')}`,
        `LOCATION:${escapeIcsText(event.location || '')}`,
        `ORGANIZER;CN=${escapeIcsText(organizer.name)}:mailto:${organizer.email}`,
        `SEQUENCE:${Number.isFinite(sequence) ? sequence : 0}`,
        'STATUS:CONFIRMED',
        'TRANSP:OPAQUE',
    ];

    event.attendees.forEach((attendee) => {
        if (!attendee.email || attendee.isOrganizer) return;
        lines.push(
            `ATTENDEE;CN=${escapeIcsText(attendee.name || attendee.email)};ROLE=REQ-PARTICIPANT;RSVP=TRUE;PARTSTAT=NEEDS-ACTION:mailto:${attendee.email}`
        );
    });

    lines.push('END:VEVENT', 'END:VCALENDAR');
    return lines.join('\r\n');
}

/**
 * Server-side auto-invite. Sends a REQUEST .ics to the given recipients,
 * stamps invitedAt, and persists a Sent record. Best-effort: never throws —
 * returns how many were notified. Runs regardless of client bundle freshness.
 */
export async function sendEventInvites(options: {
    userId: string;
    userEmail?: string | null;
    userName?: string | null;
    event: EventForInvite;
    recipients: string[];
    timezone?: string | null;
    /** Marca de la empresa y idioma (getRequestEmailBrand / getRequestEmailLocale). Sin ellos: marca por defecto, es. */
    brand?: EmailBrand | null;
    locale?: EmailLocale;
    /** Peticion que origina el envio: si no se pasan `brand`/`locale`, se resuelven a partir de ella (dominio, cookie, Accept-Language). */
    request?: Request | null;
}): Promise<number> {
    try {
        const tz = resolveTimeZone(options.timezone);
        const organizerEmail = (options.event.organizerEmail || options.userEmail || '').trim();
        if (!organizerEmail) return 0;
        const organizerName = (options.event.organizerName || options.userName || organizerEmail).trim();

        const recipients = Array.from(new Set(
            options.recipients
                .map((e) => String(e || '').trim().toLowerCase())
                .filter((e) => e.includes('@') && e !== organizerEmail.toLowerCase())
        ));
        if (recipients.length === 0) return 0;

        const brandLocal = (process.env.NEXT_PUBLIC_BRAND_NAME || 'bloom').toLowerCase().replace(/[^a-z0-9]/g, '');
        const uid = options.event.inviteUid || options.event.externalId || `${options.event.id}@${brandLocal}.local`;
        const sequenceBase = new Date(options.event.updatedAt || new Date()).getTime();
        const sequence = Number.isFinite(sequenceBase) ? Math.floor(sequenceBase / 1000) : 0;

        // Marca + idioma primero: el PRODID del ICS lleva la marca del dominio.
        const brand = options.brand ?? (options.request ? await getRequestEmailBrand(options.request) : null);
        const locale = options.locale ?? (options.request ? getRequestEmailLocale(options.request, brand, 'user') : brand?.locale ?? 'es');
        const icsContent = buildRequestIcs(options.event, uid, sequence, { email: organizerEmail, name: organizerName }, brand?.name || process.env.NEXT_PUBLIC_BRAND_NAME || 'Bloom', locale);
        const icsBuffer = Buffer.from(icsContent, 'utf8');
        const formattedFrom = `${organizerName} <${organizerEmail}>`;

        // UNA sola plantilla (marca + idioma de la empresa) para el HTML y el texto plano: mismos datos, mismo idioma
        // (una discrepancia texto/HTML es senal de spam y algunos clientes solo muestran el texto).
        const templateOptions = calendarInviteOptions({
            title: options.event.title || '',
            startsAt: options.event.startsAt,
            endsAt: options.event.endsAt,
            timezone: tz,
            location: options.event.location || null,
            description: options.event.description || null,
            organizer: { email: organizerEmail, name: organizerName },
            brand,
            locale,
        });
        const html = buildEmailHtml(templateOptions);
        const text = buildEmailText(templateOptions);
        const subject = emailSubject(locale, 'invitation', options.event.title || '');

        const filename = `${(options.event.title || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'event'}.ics`;

        const { error } = await resend.emails.send({
            from: formattedFrom,
            to: recipients,
            subject,
            html,
            text,
            attachments: [{ filename, content: icsBuffer }],
        });

        if (error) {
            console.error('[sendEventInvites] Resend send failed:', error);
            return 0;
        }

        // Stamp invitedAt so we never re-mail these recipients.
        await prisma.calendarAttendee.updateMany({
            where: { eventId: options.event.id, isOrganizer: false, email: { in: recipients } },
            data: { invitedAt: new Date() },
        });

        // Persist to Sent (best-effort). The body MUST be uploaded to storage and
        // referenced via htmlKey/textKey — the mail viewer reads those. Storing only
        // a snippet is what made our own Sent copy render as plain text while the
        // recipient (Gmail) saw the real HTML.
        try {
            const timestamp = Date.now();
            const safeSubject = subject.replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 50);

            const key = `attachments/${organizerEmail}/${timestamp}-${filename}`;
            const htmlKey = `sent/${organizerEmail}/${timestamp}-${safeSubject}.html`;
            const textKey = `sent/${organizerEmail}/${timestamp}-${safeSubject}.txt`;

            await Promise.all([
                uploadToStorage(key, icsBuffer, 'text/calendar;charset=utf-8'),
                uploadToStorage(htmlKey, Buffer.from(html, 'utf8'), 'text/html'),
                uploadToStorage(textKey, Buffer.from(text, 'utf8'), 'text/plain'),
            ]);

            await prisma.email.create({
                data: {
                    userId: options.userId,
                    from: formattedFrom,
                    to: recipients.join(', '),
                    cleanTo: recipients.join(', '),
                    subject,
                    messageId: crypto.randomUUID(),
                    snippet: text.substring(0, 200),
                    htmlKey,
                    textKey,
                    folder: 'sent',
                    status: 'sent',
                    read: true,
                    attachments: {
                        create: [{ filename, mimeType: 'text/calendar;charset=utf-8', size: icsBuffer.byteLength, key }],
                    },
                },
            });
        } catch (persistError) {
            console.error('[sendEventInvites] failed to persist Sent record:', persistError);
        }

        return recipients.length;
    } catch (error) {
        console.error('[sendEventInvites] unexpected error:', error);
        return 0;
    }
}
