import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { ensureDefaultCalendars } from '@/lib/calendar/defaults';

export async function GET(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await ensureDefaultCalendars(user.id);

    const start = req.nextUrl.searchParams.get('start');
    const end = req.nextUrl.searchParams.get('end');
    const calendarId = req.nextUrl.searchParams.get('calendarId');

    const where: any = { userId: user.id };
    if (calendarId) {
        where.calendarId = calendarId;
    }
    if (start || end) {
        where.AND = [
            start ? { endsAt: { gte: new Date(start) } } : {},
            end ? { startsAt: { lte: new Date(end) } } : {},
        ];
    }

    const events = await prisma.calendarEvent.findMany({
        where,
        include: {
            calendar: true,
            attendees: true,
        },
        orderBy: { startsAt: 'asc' }
    });

    const enriched = events.map((event) => {
        const safeTitle = String(event.title || '').trim() || 'Untitled event';

        return {
            ...event,
            title: safeTitle,
            displayTitle: safeTitle,
        };
    });

    return NextResponse.json(enriched);
}

export async function POST(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const title = String(body?.title || '').trim();
    const calendarId = String(body?.calendarId || '').trim();
    const inviteUid = String(body?.inviteUid || '').trim() || null;
    const organizerEmail = String(body?.organizerEmail || user.email || '').trim() || null;
    const organizerName = String(body?.organizerName || user.name || organizerEmail || '').trim() || null;
    const startsAt = body?.startsAt ? new Date(body.startsAt) : null;
    const endsAt = body?.endsAt ? new Date(body.endsAt) : null;

    if (!title || !calendarId || !startsAt || !endsAt || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
        return NextResponse.json({ error: 'Invalid event payload' }, { status: 400 });
    }

    const calendar = await prisma.calendar.findFirst({
        where: { id: calendarId, userId: user.id }
    });

    if (!calendar) {
        return NextResponse.json({ error: 'Calendar not found' }, { status: 404 });
    }

    if (calendar.isReadOnly) {
        return NextResponse.json({ error: 'This calendar is read-only' }, { status: 400 });
    }

    if (inviteUid) {
        const existingEvent = await prisma.calendarEvent.findFirst({
            where: {
                userId: user.id,
                inviteUid,
            },
            include: {
                calendar: true,
                attendees: true,
            }
        });

        if (existingEvent) {
            // Update the existing event in case dates or other fields were wrong (e.g. epoch from VTIMEZONE bug)
            const updated = await prisma.calendarEvent.update({
                where: { id: existingEvent.id },
                data: {
                    calendarId,
                    title,
                    description: body?.description || null,
                    location: body?.location || null,
                    startsAt,
                    endsAt,
                    organizerEmail,
                    organizerName,
                },
                include: {
                    calendar: true,
                    attendees: true,
                }
            });
            return NextResponse.json(updated);
        }
    }

    const attendeeEmails: string[] = Array.isArray(body?.attendees)
        ? body.attendees
            .map((email: string) => typeof email === 'string' ? email.trim().toLowerCase() : String(email).trim().toLowerCase())
            .filter((email: string) => email && email.includes('@') && email !== user.email?.toLowerCase())
            .filter((email: string, index: number, all: string[]) => all.indexOf(email) === index)
        : [];

    const additionalAttendees = attendeeEmails.map((email: string) => ({
        email,
        name: null,
        responseStatus: 'needsAction',
        isOrganizer: false,
    }));

    const source = ['local', 'shared', 'google', 'outlook', 'public'].includes(String(body?.source || '').toLowerCase())
        ? String(body?.source).toLowerCase()
        : (calendar.source === 'local' ? 'local' : calendar.source);

    const event = await prisma.calendarEvent.create({
        data: {
            userId: user.id,
            calendarId,
            title,
            description: body?.description || null,
            location: body?.location || null,
            startsAt,
            endsAt,
            allDay: Boolean(body?.allDay),
            source,
            inviteUid,
            organizerEmail,
            organizerName,
            attendees: {
                create: [
                    ...(user.email ? [{
                        email: user.email,
                        name: user.name || user.email,
                        responseStatus: 'accepted',
                        isOrganizer: true,
                    }] : []),
                    ...additionalAttendees
                ]
            }
        },
        include: {
            calendar: true,
            attendees: true,
        }
    });

    return NextResponse.json(event, { status: 201 });
}