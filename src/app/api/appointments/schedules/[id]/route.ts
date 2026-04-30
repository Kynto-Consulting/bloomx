import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const schedule = await prisma.appointmentSchedule.findFirst({
        where: { id, userId: user.id },
        include: {
            availability: { orderBy: { dayOfWeek: 'asc' } },
            bookings: {
                where: { status: 'confirmed', startsAt: { gte: new Date() } },
                orderBy: { startsAt: 'asc' },
            },
        },
    });

    if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(schedule);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const existing = await prisma.appointmentSchedule.findFirst({ where: { id, userId: user.id } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await req.json();
    const name = body?.name !== undefined ? String(body.name).trim() : existing.name;
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

    const conferencing = body?.conferencing !== undefined
        ? (['meet', 'zoom'].includes(String(body.conferencing)) ? String(body.conferencing) : null)
        : existing.conferencing;

    const schedule = await prisma.appointmentSchedule.update({
        where: { id },
        data: {
            name,
            description: body?.description !== undefined ? (body.description ? String(body.description).trim() : null) : existing.description,
            duration: body?.duration !== undefined ? Number(body.duration) : existing.duration,
            color: body?.color !== undefined ? String(body.color) : existing.color,
            timezone: body?.timezone !== undefined ? String(body.timezone) : existing.timezone,
            isActive: body?.isActive !== undefined ? Boolean(body.isActive) : existing.isActive,
            conferencing,
        },
        include: { availability: { orderBy: { dayOfWeek: 'asc' } } },
    });

    if (Array.isArray(body?.availability)) {
        await prisma.appointmentAvailability.deleteMany({ where: { scheduleId: id } });
        await prisma.appointmentAvailability.createMany({
            data: body.availability.map((a: any) => ({
                scheduleId: id,
                dayOfWeek: Number(a.dayOfWeek),
                startTime: String(a.startTime || '09:00'),
                endTime: String(a.endTime || '17:00'),
                isEnabled: Boolean(a.isEnabled ?? true),
            })),
        });
    }

    const updated = await prisma.appointmentSchedule.findFirst({
        where: { id },
        include: { availability: { orderBy: { dayOfWeek: 'asc' } } },
    });

    return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const existing = await prisma.appointmentSchedule.findFirst({ where: { id, userId: user.id } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await prisma.appointmentSchedule.delete({ where: { id } });
    return NextResponse.json({ success: true });
}
