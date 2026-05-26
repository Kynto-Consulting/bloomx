import { prisma } from '@/lib/prisma';
import { ensureDefaultCalendars } from '@/lib/calendar/defaults';
import { ParsedInvite } from '@/lib/calendar/ics';

function normalizeInviteStatus(value?: string | null): 'accepted' | 'tentative' | 'declined' | 'needsAction' {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'accepted') return 'accepted';
    if (normalized === 'tentative') return 'tentative';
    if (normalized === 'declined') return 'declined';
    return 'needsAction';
}

export async function handleInboundCalendarInvite(options: {
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
