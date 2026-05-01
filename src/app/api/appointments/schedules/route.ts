import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';

const DEFAULT_AVAILABILITY = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    dayOfWeek: day,
    startTime: '09:00',
    endTime: '17:00',
    isEnabled: day >= 1 && day <= 5, // Mon–Fri enabled by default
}));

export async function GET(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const schedules = await prisma.appointmentSchedule.findMany({
        where: { userId: user.id },
        include: { availability: { orderBy: { dayOfWeek: 'asc' } }, _count: { select: { bookings: true } } },
        orderBy: { createdAt: 'desc' },
    });

    const origin = process.env.NEXT_PUBLIC_APP_URL || `${req.nextUrl.protocol}//${req.nextUrl.host}`;
    const withUrls = schedules.map(s => ({ ...s, bookingUrl: `${origin}/book/${s.id}` }));

    return NextResponse.json(withUrls);
}

export async function POST(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const name = String(body?.name || '').trim();
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

    const duration = Number(body?.duration) || 30;
    const color = String(body?.color || '#2563eb');
    const timezone = String(body?.timezone || 'UTC');
    const description = body?.description ? String(body.description).trim() : null;
    const conferencing = ['meet', 'zoom'].includes(String(body?.conferencing || ''))
        ? String(body.conferencing)
        : null;

    const rawAvailability: any[] = Array.isArray(body?.availability) ? body.availability : DEFAULT_AVAILABILITY;

    const schedule = await prisma.appointmentSchedule.create({
        data: {
            userId: user.id,
            name,
            description,
            duration,
            color,
            timezone,
            conferencing,
            availability: {
                create: rawAvailability.map((a) => ({
                    dayOfWeek: Number(a.dayOfWeek),
                    startTime: String(a.startTime || '09:00'),
                    endTime: String(a.endTime || '17:00'),
                    isEnabled: Boolean(a.isEnabled ?? true),
                })),
            },
        },
        include: { availability: { orderBy: { dayOfWeek: 'asc' } } },
    });

    return NextResponse.json(schedule, { status: 201 });
}
