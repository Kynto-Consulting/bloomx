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
    const extractEmail = (entry: string) => {
        const normalized = String(entry || '').trim();
        const angled = normalized.match(/<([^>]+)>/);
        const candidate = angled?.[1] ? angled[1].trim() : normalized;
        return candidate.includes('@') ? candidate.toLowerCase() : '';
    };

    if (Array.isArray(value)) {
        return value
            .map((entry) => extractEmail(String(entry || '')))
            .filter((entry) => entry.includes('@'));
    }

    if (typeof value === 'string') {
        return value
            .split(',')
            .map((entry) => extractEmail(entry))
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
    sequence: number;
}) {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        `PRODID:-//${process.env.NEXT_PUBLIC_BRAND_NAME || 'Bloom'}//Calendar//EN`,
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
        `SEQUENCE:${Number.isFinite(options.sequence) ? options.sequence : 0}`,
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
        const body = await req.json().catch(() => ({}));

        const recipients = Array.from(new Set([
            ...normalizeEmailList(body?.to),
            ...normalizeEmailList(body?.cc),
        ])).filter(Boolean);

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

        const providedOrganizerEmail = String(body?.organizerEmail || '').trim().toLowerCase();
        const providedOrganizerName = String(body?.organizerName || '').trim();
        const organizerEmail = providedOrganizerEmail || event.organizerEmail || user.email || `noreply@${(process.env.NEXT_PUBLIC_BRAND_NAME || 'bloom').toLowerCase().replace(/[^a-z0-9]/g, '')}.local`;
        const organizerName = providedOrganizerName || event.organizerName || user.name || organizerEmail;

        const nextTitle = typeof body?.title === 'string' && body.title.trim()
            ? body.title.trim()
            : event.title;
        const nextDescription = body?.description !== undefined
            ? (body.description ? String(body.description) : null)
            : event.description;
        const nextLocation = body?.location !== undefined
            ? (body.location ? String(body.location) : null)
            : event.location;

        const parsedStartsAt = body?.startsAt ? new Date(body.startsAt) : null;
        const parsedEndsAt = body?.endsAt ? new Date(body.endsAt) : null;
        const nextStartsAt = parsedStartsAt && !Number.isNaN(parsedStartsAt.getTime()) ? parsedStartsAt : event.startsAt;
        const nextEndsAt = parsedEndsAt && !Number.isNaN(parsedEndsAt.getTime()) ? parsedEndsAt : event.endsAt;

        const requestedInviteUid = String(body?.inviteUid || '').trim();
        const brandLocal = (process.env.NEXT_PUBLIC_BRAND_NAME || 'bloom').toLowerCase().replace(/[^a-z0-9]/g, '');
        const eventUid = requestedInviteUid || event.inviteUid || event.externalId || `${event.id}@${brandLocal}.local`;
        const replaceAttendees = body?.replaceAttendees !== false;

        let latestEvent = event;

        if (!event.calendar.isReadOnly) {
            latestEvent = await prisma.calendarEvent.update({
                where: { id: event.id },
                data: {
                    title: nextTitle,
                    description: nextDescription,
                    location: nextLocation,
                    startsAt: nextStartsAt,
                    endsAt: nextEndsAt,
                    inviteUid: eventUid,
                    organizerEmail,
                    organizerName,
                },
                include: {
                    calendar: true,
                    attendees: true,
                }
            });

            const organizerAttendee = latestEvent.attendees.find((attendee) => attendee.isOrganizer);

            if (organizerAttendee) {
                if (organizerAttendee.email !== organizerEmail || (organizerAttendee.name || '') !== (organizerName || '')) {
                    await prisma.calendarAttendee.update({
                        where: { id: organizerAttendee.id },
                        data: {
                            email: organizerEmail,
                            name: organizerName,
                            responseStatus: 'accepted',
                            isOrganizer: true,
                        }
                    });
                }
            } else {
                await prisma.calendarAttendee.create({
                    data: {
                        eventId: latestEvent.id,
                        email: organizerEmail,
                        name: organizerName,
                        responseStatus: 'accepted',
                        isOrganizer: true,
                    }
                });
            }

            const attendeeRecipients = recipients.filter((email) => email !== organizerEmail.toLowerCase());

            if (replaceAttendees) {
                if (attendeeRecipients.length > 0) {
                    await prisma.calendarAttendee.deleteMany({
                        where: {
                            eventId: latestEvent.id,
                            isOrganizer: false,
                            email: { notIn: attendeeRecipients }
                        }
                    });
                } else {
                    await prisma.calendarAttendee.deleteMany({
                        where: {
                            eventId: latestEvent.id,
                            isOrganizer: false,
                        }
                    });
                }
            }

            if (attendeeRecipients.length > 0) {
                const existingEmails = new Set(
                    latestEvent.attendees
                        .filter((attendee) => !attendee.isOrganizer)
                        .map((attendee) => attendee.email.toLowerCase())
                );
                const attendeesToCreate = attendeeRecipients.filter((email) => !existingEmails.has(email));

                if (attendeesToCreate.length > 0) {
                    await prisma.calendarAttendee.createMany({
                        data: attendeesToCreate.map((email) => ({
                            eventId: latestEvent.id,
                            email,
                            name: null,
                            responseStatus: 'needsAction',
                            isOrganizer: false,
                        })),
                        skipDuplicates: true,
                    });
                }

                // Stamp invite state server-side so re-sends / reopens can dedupe
                // by who has actually been mailed, not by client-held guesses.
                await prisma.calendarAttendee.updateMany({
                    where: {
                        eventId: latestEvent.id,
                        isOrganizer: false,
                        email: { in: attendeeRecipients },
                    },
                    data: { invitedAt: new Date() },
                });
            }

            latestEvent = await prisma.calendarEvent.findFirstOrThrow({
                where: { id: latestEvent.id, userId: user.id },
                include: {
                    calendar: true,
                    attendees: true,
                }
            });
        }
        const latestAttendees = await prisma.calendarAttendee.findMany({
            where: { eventId: latestEvent.id },
        });

        let attendeesForIcs: EventAttendeeRecord[] = latestAttendees;
        if (event.calendar.isReadOnly && recipients.length > 0) {
            const organizerAttendee = latestAttendees.find((attendee) => attendee.isOrganizer) || {
                email: organizerEmail,
                name: organizerName,
                responseStatus: 'accepted',
                isOrganizer: true,
            };

            const virtualAttendees: EventAttendeeRecord[] = recipients
                .filter((email) => email !== organizerEmail.toLowerCase())
                .map((email) => ({
                    email,
                    name: null,
                    responseStatus: 'needsAction',
                    isOrganizer: false,
                }));

            attendeesForIcs = [organizerAttendee, ...virtualAttendees];
        }

        const sequenceBase = new Date(latestEvent.updatedAt || new Date()).getTime();
        const computedSequence = Number.isFinite(sequenceBase) ? Math.floor(sequenceBase / 1000) : 0;

        const icsContent = buildIcsFromEvent({
            title: latestEvent.title,
            description: latestEvent.description,
            location: latestEvent.location,
            startsAt: latestEvent.startsAt,
            endsAt: latestEvent.endsAt,
            organizer: {
                email: organizerEmail,
                name: organizerName,
            },
            attendees: attendeesForIcs,
            uid: eventUid,
            sequence: computedSequence,
        });

        const attendeeEmails = attendeesForIcs
            .filter((attendee) => !attendee.isOrganizer)
            .map((attendee) => attendee.email.toLowerCase());

        return NextResponse.json({
            success: true,
            eventId: latestEvent.id,
            inviteUid: eventUid,
            subject: latestEvent.title,
            syncedAttendees: attendeeEmails.length,
            attachment: {
                filename: `${(latestEvent.title || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'event'}.ics`,
                mimeType: 'text/calendar;charset=utf-8',
                contentBase64: Buffer.from(icsContent, 'utf8').toString('base64'),
                calendarEvent: {
                    syncedEventId: latestEvent.id,
                    inviteUid: eventUid,
                    title: latestEvent.title,
                    description: latestEvent.description,
                    location: latestEvent.location,
                    startsAt: latestEvent.startsAt?.toISOString?.() || latestEvent.startsAt,
                    endsAt: latestEvent.endsAt?.toISOString?.() || latestEvent.endsAt,
                    organizerEmail,
                    organizerName,
                    attendees: attendeeEmails,
                },
            },
        });
    } catch (error: any) {
        console.error('Attach invite failed:', error);
        return NextResponse.json({ error: error?.message || 'Failed to attach invite' }, { status: 500 });
    }
}
