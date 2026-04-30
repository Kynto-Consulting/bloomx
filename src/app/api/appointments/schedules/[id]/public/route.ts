import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    const schedule = await prisma.appointmentSchedule.findFirst({
        where: { id, isActive: true },
        select: {
            id: true,
            name: true,
            description: true,
            duration: true,
            color: true,
            timezone: true,
            conferencing: true,
            user: { select: { name: true, email: true, avatar: true } },
            availability: { orderBy: { dayOfWeek: 'asc' } },
        },
    });

    if (!schedule) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
    return NextResponse.json(schedule);
}
