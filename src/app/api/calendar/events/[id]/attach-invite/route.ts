import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';

type EventAttendeeRecord = {
    email: string;
    name: string | null;
    responseStatus: string | null;
    isOrganizer: boolean;
};

function escapeIcsText(value: string) {
    return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');
}

function formatIcsDate(value: string | Date | null | undefined) {
    if (!value) return '';

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function normalizeEmailList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .map((entry) => String(entry || '').trim().toLowerCase())
            .filter((entry) => entry.includes('@'));
    }

    if (typeof value === 'string') {
        return value
            .split(',')
            .map((entry) => entry.trim().toLowerCase())
            .filter((entry) => entry.includes('@'));
    }

    return [];
}

function mapResponseStatusToPartstat(responseStatus?: string | null) {
    const normalized = String(responseStatus || '').toLowerCase();

    if (normalized === 'accepted') return 'ACCEPTED';
    if (normalized === 'declined') return 'DECLINED';
    if (normalized === 'tentative') return 'TENTATIVE';
    return 'NEEDS-ACTION';
}

function buildIcsFromEvent(options: {
    title: string;
    description?: string | null;
    location?: string | null;
    startsAt: string | Date;
    endsAt: string | Date;
    organizer: { email: string; name?: string | null };
    attendees: EventAttendeeRecord[];
    uid: string;
}) {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//BloomX//Calendar Invite//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:REQUEST',
        'BEGIN:VEVENT',
        `UID:${escapeIcsText(options.uid)}`,
        `DTSTAMP:${formatIcsDate(new Date())}`,
        `DTSTART:${formatIcsDate(options.startsAt)}`,
        `DTEND:${formatIcsDate(options.endsAt)}`,
        `SUMMARY:${escapeIcsText(options.title || 'New Event')}`,
        `DESCRIPTION:${escapeIcsText(options.description || options.title || 'Event invitation')}`,
        `LOCATION:${escapeIcsText(options.location || '')}`,
        `ORGANIZER;CN=${escapeIcsText(options.organizer.name || options.organizer.email)}:mailto:${options.organizer.email}`,
        'SEQUENCE:0',
        'STATUS:CONFIRMED',
        'TRANSP:OPAQUE',
    ];

    options.attendees.forEach((attendee) => {
        if (!attendee.email || attendee.isOrganizer) {
            return;
        }

        lines.push(
            `ATTENDEE;CN=${escapeIcsText(attendee.name || attendee.email)};ROLE=REQ-PARTICIPANT;RSVP=TRUE;PARTSTAT=${mapResponseStatusToPartstat(attendee.responseStatus)}:mailto:${attendee.email}`
        );
    });

    lines.push('END:VEVENT', 'END:VCALENDAR');
    return lines.join('\r\n');
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getCurrentUser();
    if (!user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id } = await params;
        const body = await req.json();

        const recipients = Array.from(new Set([
            ...normalizeEmailList(body?.to),
            ...normalizeEmailList(body?.cc),
        ])).filter((email) => email !== user.email?.toLowerCase());

        const event = await prisma.calendarEvent.findFirst({
            where: { id, userId: user.id },
            include: {
                calendar: true,
                attendees: true,
            }
        });

        if (!event) {
            return NextResponse.json({ error: 'Event not found' }, { status: 404 });
        }

        if (!event.calendar.isReadOnly && recipients.length > 0) {
            const existingEmails = new Set(event.attendees.map((attendee) => attendee.email.toLowerCase()));
            const attendeesToCreate = recipients.filter((email) => !existingEmails.has(email));

            if (attendeesToCreate.length > 0) {
                await prisma.calendarAttendee.createMany({
                    data: attendeesToCreate.map((email) => ({
                        eventId: event.id,
                        email,
                        name: null,
                        responseStatus: 'needsAction',
                        isOrganizer: false,
                    })),
                    skipDuplicates: true,
                });
            }
        }

        const latestAttendees = await prisma.calendarAttendee.findMany({
            where: { eventId: event.id },
        });

        const organizerFromAttendees = latestAttendees.find((attendee) => attendee.isOrganizer);
        const organizerEmail = organizerFromAttendees?.email || event.organizerEmail || user.email || 'noreply@bloomx.local';
        const organizerName = organizerFromAttendees?.name || event.organizerName || user.name || organizerEmail;
        const eventUid = event.inviteUid || event.externalId || `${event.id}@bloomx.local`;

        const icsContent = buildIcsFromEvent({
            title: event.title,
            description: event.description,
            location: event.location,
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            organizer: {
                email: organizerEmail,
                name: organizerName,
            },
            attendees: latestAttendees,
            uid: eventUid,
        });

        return NextResponse.json({
            success: true,
            subject: event.title,
            syncedAttendees: latestAttendees.filter((attendee) => !attendee.isOrganizer).length,
            attachment: {
                filename: `${(event.title || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'event'}.ics`,
                mimeType: 'text/calendar;charset=utf-8',
                contentBase64: Buffer.from(icsContent, 'utf8').toString('base64'),
            },
        });
    } catch (error: any) {
        console.error('Attach invite failed:', error);
        return NextResponse.json({ error: error?.message || 'Failed to attach invite' }, { status: 500 });
    }
}
