import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

function parseHHMM(time: string): { h: number; m: number } {
    const [h, m] = time.split(':').map(Number);
    return { h: h || 0, m: m || 0 };
}

function dateAtTimeInTz(date: Date, hhmm: string, tz: string): Date {
    // Build an ISO string for that calendar date in the given timezone at the given HH:MM
    const localStr = new Intl.DateTimeFormat('sv-SE', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
    const { h, m } = parseHHMM(hhmm);
    const candidate = new Date(`${localStr}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`);
    // candidate is local — convert to UTC by interpreting as tz
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
    });
    // Use offset trick
    const parts = formatter.formatToParts(candidate);
    const pv = (type: string) => Number(parts.find(p => p.type === type)?.value || '0');
    const asUtc = Date.UTC(pv('year'), pv('month') - 1, pv('day'), pv('hour'), pv('minute'), pv('second'));
    const offset = asUtc - candidate.getTime();
    return new Date(candidate.getTime() - offset);
}

function dayOfWeekInTz(date: Date, tz: string): number {
    const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(date);
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(day);
}

function slotsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
    return aStart < bEnd && aEnd > bStart;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const url = req.nextUrl;
    const dateParam = url.searchParams.get('date'); // YYYY-MM-DD in user's local

    const schedule = await prisma.appointmentSchedule.findFirst({
        where: { id, isActive: true },
        include: {
            availability: true,
            user: { select: { id: true } },
        },
    });

    if (!schedule) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });

    const tz = schedule.timezone || 'UTC';
    const duration = schedule.duration;

    // Build week range: 7 days starting from dateParam (or today)
    const startDate = dateParam ? new Date(`${dateParam}T00:00:00Z`) : new Date();
    startDate.setUTCHours(0, 0, 0, 0);
    const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Fetch busy times from CalendarEvents
    const busyEvents = await prisma.calendarEvent.findMany({
        where: {
            userId: schedule.user.id,
            status: { not: 'cancelled' },
            startsAt: { lt: endDate },
            endsAt: { gt: startDate },
        },
        select: { startsAt: true, endsAt: true },
    });

    // Fetch existing bookings
    const busyBookings = await prisma.appointmentBooking.findMany({
        where: {
            scheduleId: id,
            status: 'confirmed',
            startsAt: { lt: endDate },
            endsAt: { gt: startDate },
        },
        select: { startsAt: true, endsAt: true },
    });

    const busy = [
        ...busyEvents.map(e => ({ start: e.startsAt, end: e.endsAt })),
        ...busyBookings.map(b => ({ start: b.startsAt, end: b.endsAt })),
    ];

    const slotsByDay: Record<string, string[]> = {};
    const now = new Date();

    for (let i = 0; i < 7; i++) {
        const day = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
        const dow = dayOfWeekInTz(day, tz);
        const avail = schedule.availability.find(a => a.dayOfWeek === dow && a.isEnabled);
        if (!avail) continue;

        const dayStart = dateAtTimeInTz(day, avail.startTime, tz);
        const dayEnd = dateAtTimeInTz(day, avail.endTime, tz);

        const dayKey = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(day);
        slotsByDay[dayKey] = [];

        let cursor = dayStart;
        while (cursor < dayEnd) {
            const slotEnd = new Date(cursor.getTime() + duration * 60 * 1000);
            if (slotEnd > dayEnd) break;

            // Skip past slots (with 15min buffer)
            if (cursor.getTime() > now.getTime() - 15 * 60 * 1000) {
                const overlaps = busy.some(b => slotsOverlap(cursor, slotEnd, b.start, b.end));
                if (!overlaps) {
                    slotsByDay[dayKey].push(cursor.toISOString());
                }
            }

            cursor = slotEnd;
        }
    }

    return NextResponse.json({ scheduleId: id, duration, timezone: tz, slots: slotsByDay });
}
