import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { ensureDefaultCalendars } from '@/lib/calendar/defaults';

export async function GET() {
    const user = await getCurrentUser();
    if (!user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const calendars = await ensureDefaultCalendars(user.id);
    return NextResponse.json(calendars);
}

export async function POST(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const name = String(body?.name || '').trim();
    const color = String(body?.color || '#2563eb').trim() || '#2563eb';

    if (!name) {
        return NextResponse.json({ error: 'Calendar name is required' }, { status: 400 });
    }

    const calendar = await prisma.calendar.create({
        data: {
            userId: user.id,
            name,
            color,
            source: 'local',
            isReadOnly: false,
        }
    });

    return NextResponse.json(calendar, { status: 201 });
}