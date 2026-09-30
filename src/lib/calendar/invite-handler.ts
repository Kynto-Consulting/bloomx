import { prisma } from '@/lib/prisma';
import { ensureDefaultCalendars } from '@/lib/calendar/defaults';
import { ParsedInvite } from '@/lib/calendar/ics';
import {
    conferenceFieldsFor,
    normalizeSequence,
    shouldApplyInvite,
    summarizeKnownState,
    type KnownInviteState,
} from '@/lib/calendar/invite-state';

// SEQUENCE ya aplicado por UID (registro 'invite.sequence' en EmailEvent: no requiere columnas nuevas). Si la lectura o
// la escritura fallan, se aplica la invitacion igualmente (la consistencia nunca debe perder un evento).
async function loadKnownInviteState(userId: string, uid: string): Promise<KnownInviteState | null> {
    try {
        const rows = await prisma.emailEvent.findMany({
            where: { type: 'invite.sequence', email: { userId }, data: { path: ['uid'], equals: uid } },
            select: { data: true },
            take: 200,
        });
        return summarizeKnownState(
            rows.map((r) => {
                const d = (r.data || {}) as { sequence?: unknown; method?: unknown };
                return { sequence: d.sequence, method: d.method };
            }),
        );
    } catch {
        return null;
    }
}

async function recordInviteState(emailId: string, uid: string, method: string, sequence: number) {
    try {
        await prisma.emailEvent.create({ data: { emailId, type: 'invite.sequence', data: { uid, method, sequence } } });
    } catch {
        // best effort
    }
}

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

        // Cancelacion antigua o ya aplicada con un SEQUENCE mayor: no tocar. Una cancelacion NUNCA crea eventos.
        const known = await loadKnownInviteState(options.userId, inviteUid);
        if (!shouldApplyInvite('CANCEL', options.invite.sequence, known)) {
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
        await recordInviteState(options.emailId, inviteUid, 'CANCEL', normalizeSequence(options.invite.sequence));
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

    // Una actualizacion con SEQUENCE menor, o una invitacion vieja sobre un evento cancelado, no se aplica.
    if (inviteUid) {
        const known = await loadKnownInviteState(options.userId, inviteUid);
        if (!shouldApplyInvite(method, options.invite.sequence, known)) {
            return;
        }
    }

    // Mismo UID => se ACTUALIZA el evento existente (nunca se duplica).
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
        // Columnas de conferencia solo con enlace RECONOCIDO (https + host de proveedor); si no, null.
        ...conferenceFieldsFor(options.invite.meetUrl || options.invite.location),
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

    if (inviteUid) {
        await recordInviteState(options.emailId, inviteUid, method, normalizeSequence(options.invite.sequence));
    }
}
