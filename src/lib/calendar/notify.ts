import { prisma } from '@/lib/prisma';
import { resend } from '@/lib/resend';
import { uploadToStorage } from '@/lib/storage';
import { buildCalendarInviteHtml, resolveTimeZone } from '@/lib/calendar/email-templates';

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

function buildRequestIcs(event: EventForInvite, uid: string, sequence: number, organizer: { email: string; name: string }) {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        `PRODID:-//${process.env.NEXT_PUBLIC_BRAND_NAME || 'Bloom'}//Calendar//EN`,
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

        const icsContent = buildRequestIcs(options.event, uid, sequence, { email: organizerEmail, name: organizerName });
        const icsBuffer = Buffer.from(icsContent, 'utf8');
        const formattedFrom = `${organizerName} <${organizerEmail}>`;

        const html = buildCalendarInviteHtml({
            title: options.event.title || 'New Event',
            startsAt: options.event.startsAt,
            endsAt: options.event.endsAt,
            timezone: tz,
            location: options.event.location || null,
            description: options.event.description || null,
            organizer: { email: organizerEmail, name: organizerName },
        });

        // Keep the plain-text part in the same language and with the same facts as
        // the HTML part. A text/HTML mismatch (English text + Spanish HTML) is a
        // spam-filter signal, and some clients only ever show this version.
        const text = [
            `${organizerName} te invitó a: ${options.event.title || 'Nuevo evento'}`,
            '',
            `Cuándo: ${new Date(options.event.startsAt).toLocaleString('es-PE', { timeZone: tz })} — ${new Date(options.event.endsAt).toLocaleString('es-PE', { timeZone: tz })}`,
            options.event.location ? `Enlace/Lugar: ${options.event.location}` : '',
            `Organizador: ${organizerName} (${organizerEmail})`,
            options.event.description ? `Notas: ${options.event.description}` : '',
            '',
            'El archivo .ics está adjunto para agregar esta invitación a tu calendario.',
        ].filter(Boolean).join('\n');

        const filename = `${(options.event.title || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'event'}.ics`;

        const { error } = await resend.emails.send({
            from: formattedFrom,
            to: recipients,
            subject: `Invitación: ${options.event.title || 'Nuevo evento'}`,
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
            const subject = `Invitación: ${options.event.title || 'Nuevo evento'}`;
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
