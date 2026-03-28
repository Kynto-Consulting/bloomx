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

    return NextResponse.json(events);
}

export async function POST(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const title = String(body?.title || '').trim();
    const calendarId = String(body?.calendarId || '').trim();
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
            source: calendar.source === 'local' ? 'local' : calendar.source,
            attendees: {
                create: user.email ? [{
                    email: user.email,
                    name: user.name || user.email,
                    responseStatus: 'accepted',
                    isOrganizer: true,
                }] : []
            }
        },
        include: {
            calendar: true,
            attendees: true,
        }
    });

    return NextResponse.json(event, { status: 201 });
}