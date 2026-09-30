import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getClientIp, rateLimitAsync } from '@/lib/security';
import {
    addDaysToKey,
    computeWeekSlots,
    isValidDateKey,
    isValidTimeZone,
    localDateKey,
    weekWindow,
} from '@/lib/appointments/slots';

const MAX_DAYS_AHEAD = 365;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const url = req.nextUrl;
    const dateParam = url.searchParams.get('date'); // YYYY-MM-DD (fecha de calendario en la zona de la agenda)

    // Endpoint publico: limite generoso por IP (el calendario pide una semana por navegacion).
    const limit = await rateLimitAsync(`slots-ip:${getClientIp(req)}`, 120, 60 * 1000);
    if (!limit.ok) {
        return NextResponse.json(
            { error: 'Too many requests' },
            { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
        );
    }

    if (dateParam !== null && !isValidDateKey(dateParam)) {
        return NextResponse.json({ error: 'Invalid date. Use YYYY-MM-DD.' }, { status: 400 });
    }

    const schedule = await prisma.appointmentSchedule.findFirst({
        where: { id, isActive: true },
        include: {
            availability: true,
            user: { select: { id: true } },
        },
    });

    if (!schedule) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });

    const tz = schedule.timezone && isValidTimeZone(schedule.timezone) ? schedule.timezone : 'UTC';
    const duration = schedule.duration;

    // Semana de 7 dias de calendario desde `date` (o desde hoy en la zona de la agenda).
    const now = new Date();
    const startKey = dateParam ?? localDateKey(now, tz);
    const todayKey = localDateKey(now, tz);
    if (startKey > addDaysToKey(todayKey, MAX_DAYS_AHEAD)) {
        return NextResponse.json({ scheduleId: id, duration, timezone: tz, slots: {} });
    }
    const { from, to } = weekWindow(startKey, 7, tz);

    // Ocupacion: eventos del anfitrion (todas sus agendas y calendarios) y reservas confirmadas de esta agenda.
    const [busyEvents, busyBookings] = await Promise.all([
        prisma.calendarEvent.findMany({
            where: {
                userId: schedule.user.id,
                status: { not: 'cancelled' },
                startsAt: { lt: to },
                endsAt: { gt: from },
            },
            select: { startsAt: true, endsAt: true },
        }),
        prisma.appointmentBooking.findMany({
            where: {
                scheduleId: id,
                status: 'confirmed',
                startsAt: { lt: to },
                endsAt: { gt: from },
            },
            select: { startsAt: true, endsAt: true },
        }),
    ]);

    const busy = [
        ...busyEvents.map((e) => ({ start: e.startsAt, end: e.endsAt })),
        ...busyBookings.map((b) => ({ start: b.startsAt, end: b.endsAt })),
    ];

    const slotsByDay = computeWeekSlots({
        startKey,
        days: 7,
        tz,
        availability: schedule.availability,
        durationMin: duration,
        busy,
        now,
    });

    return NextResponse.json({ scheduleId: id, duration, timezone: tz, slots: slotsByDay });
}
