import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const title = String(body?.title || '').trim();
    const startsAt = body?.startsAt ? new Date(body.startsAt) : null;
    const endsAt = body?.endsAt ? new Date(body.endsAt) : null;

    if (!title || !startsAt || !endsAt || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
        return NextResponse.json({ error: 'Invalid event payload' }, { status: 400 });
    }

    const event = await prisma.calendarEvent.findFirst({
        where: { id, userId: user.id },
        include: { calendar: true }
    });

    if (!event) {
        return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    if (event.calendar.isReadOnly) {
        return NextResponse.json({ error: 'Cannot edit read-only events' }, { status: 400 });
    }

    const updated = await prisma.calendarEvent.update({
        where: { id },
        data: {
            title,
            location: body?.location || null,
            startsAt,
            endsAt,
        }
    });

    return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    
    const event = await prisma.calendarEvent.findFirst({
        where: { id, userId: user.id },
        include: { calendar: true }
    });

    if (!event) {
        return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    if (event.calendar.isReadOnly) {
        return NextResponse.json({ error: 'Cannot delete read-only events' }, { status: 400 });
    }

    await prisma.calendarEvent.delete({
        where: { id }
    });

    return NextResponse.json({ success: true });
}
