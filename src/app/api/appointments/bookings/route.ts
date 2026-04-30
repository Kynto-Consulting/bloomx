import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';

export async function GET() {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const schedules = await prisma.appointmentSchedule.findMany({
        where: { userId: user.id },
        select: { id: true },
    });
    const scheduleIds = schedules.map(s => s.id);

    const bookings = await prisma.appointmentBooking.findMany({
        where: { scheduleId: { in: scheduleIds }, startsAt: { gte: new Date() } },
        include: { schedule: { select: { name: true, duration: true, color: true } } },
        orderBy: { startsAt: 'asc' },
    });

    return NextResponse.json(bookings);
}
