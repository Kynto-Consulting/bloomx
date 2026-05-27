import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user?.id || !user.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const emailsParam = req.nextUrl.searchParams.get('emails') || '';
    const start = req.nextUrl.searchParams.get('start');
    const end = req.nextUrl.searchParams.get('end');

    if (!start || !end) {
        return NextResponse.json({ error: 'start and end required' }, { status: 400 });
    }

    const currentDomain = user.email.split('@')[1]?.toLowerCase();
    if (!currentDomain) return NextResponse.json([]);

    const requestedEmails = emailsParam
        .split(',')
        .map(e => e.trim().toLowerCase())
        .filter(e => e.includes('@') && e.split('@')[1]?.toLowerCase() === currentDomain && e !== user.email.toLowerCase());

    if (requestedEmails.length === 0) return NextResponse.json([]);

    const domainUsers = await prisma.user.findMany({
        where: { email: { in: requestedEmails } },
        select: { id: true, email: true, name: true },
    });

    if (domainUsers.length === 0) return NextResponse.json([]);

    const startDate = new Date(start);
    const endDate = new Date(end);

    const results = await Promise.all(
        domainUsers.map(async (domainUser) => {
            const events = await prisma.calendarEvent.findMany({
                where: {
                    userId: domainUser.id,
                    endsAt: { gte: startDate },
                    startsAt: { lte: endDate },
                    status: { not: 'cancelled' },
                },
                select: { title: true, startsAt: true, endsAt: true },
                orderBy: { startsAt: 'asc' },
            });
            return { email: domainUser.email, name: domainUser.name, events };
        })
    );

    return NextResponse.json(results);
}
