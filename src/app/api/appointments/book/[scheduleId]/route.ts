import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { randomBytes } from 'crypto';
import { ensureDefaultCalendars } from '@/lib/calendar/defaults';

async function createGoogleMeetRoom(refreshToken: string, topic: string, startsAt: Date, endsAt: Date, guestEmail: string) {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID || '',
            client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        }),
    });
    if (!tokenRes.ok) throw new Error('Failed to refresh Google token');
    const { access_token } = await tokenRes.json();

    const eventRes = await fetch(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1',
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                summary: topic,
                start: { dateTime: startsAt.toISOString() },
                end: { dateTime: endsAt.toISOString() },
                attendees: [{ email: guestEmail }],
                conferenceData: {
                    createRequest: { requestId: randomBytes(8).toString('hex'), conferenceSolutionKey: { type: 'hangoutsMeet' } },
                },
            }),
        }
    );
    if (!eventRes.ok) throw new Error('Failed to create Google Meet event');
    const data = await eventRes.json();
    return data.conferenceData?.entryPoints?.find((ep: any) => ep.entryPointType === 'video')?.uri || null;
}

async function createZoomMeeting(topic: string, startsAt: Date, duration: number) {
    const accountId = process.env.ZOOM_ACCOUNT_ID;
    const clientId = process.env.ZOOM_CLIENT_ID;
    const clientSecret = process.env.ZOOM_CLIENT_SECRET;
    if (!accountId || !clientId || !clientSecret) throw new Error('Zoom not configured');

    const params = new URLSearchParams({ grant_type: 'account_credentials', account_id: accountId });
    const tokenRes = await fetch('https://zoom.us/oauth/token', {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` },
        body: params,
    });
    if (!tokenRes.ok) throw new Error('Failed to get Zoom token');
    const { access_token } = await tokenRes.json();

    const meetRes = await fetch('https://api.zoom.us/v2/users/me/meetings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            topic,
            type: 2,
            start_time: startsAt.toISOString(),
            duration,
            timezone: 'UTC',
            settings: { join_before_host: true, waiting_room: false },
        }),
    });
    if (!meetRes.ok) throw new Error('Failed to create Zoom meeting');
    const data = await meetRes.json();
    return data.join_url || null;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ scheduleId: string }> }) {
    const { scheduleId } = await params;
    const body = await req.json();

    const guestName = String(body?.guestName || '').trim();
    const guestEmail = String(body?.guestEmail || '').trim().toLowerCase();
    const slotIso = String(body?.startsAt || '').trim();

    if (!guestName || !guestEmail || !guestEmail.includes('@') || !slotIso) {
        return NextResponse.json({ error: 'Name, email, and slot are required' }, { status: 400 });
    }

    const startsAt = new Date(slotIso);
    if (Number.isNaN(startsAt.getTime())) {
        return NextResponse.json({ error: 'Invalid slot time' }, { status: 400 });
    }

    const schedule = await prisma.appointmentSchedule.findFirst({
        where: { id: scheduleId, isActive: true },
        include: { user: { select: { id: true, name: true, email: true } }, availability: true },
    });

    if (!schedule) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });

    const endsAt = new Date(startsAt.getTime() + schedule.duration * 60 * 1000);

    // Verify slot is still free
    const busyEvent = await prisma.calendarEvent.findFirst({
        where: {
            userId: schedule.user.id,
            status: { not: 'cancelled' },
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
        },
    });
    const busyBooking = await prisma.appointmentBooking.findFirst({
        where: {
            scheduleId,
            status: 'confirmed',
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
        },
    });
    if (busyEvent || busyBooking) {
        return NextResponse.json({ error: 'This slot is no longer available' }, { status: 409 });
    }

    // Create meeting link if conferencing is configured
    let meetUrl: string | null = null;
    if (schedule.conferencing === 'meet') {
        try {
            const googleAccount = await prisma.account.findFirst({
                where: { userId: schedule.user.id, provider: 'google' },
                select: { refresh_token: true },
            });
            if (googleAccount?.refresh_token) {
                meetUrl = await createGoogleMeetRoom(
                    googleAccount.refresh_token,
                    `${schedule.name} — ${guestName}`,
                    startsAt,
                    endsAt,
                    guestEmail
                );
            }
        } catch (err) {
            console.error('Meet creation failed:', err);
        }
    } else if (schedule.conferencing === 'zoom') {
        try {
            meetUrl = await createZoomMeeting(`${schedule.name} — ${guestName}`, startsAt, schedule.duration);
        } catch (err) {
            console.error('Zoom creation failed:', err);
        }
    }

    // Create CalendarEvent for host
    const calendars = await ensureDefaultCalendars(schedule.user.id);
    const targetCalendar = calendars.find(c => c.source === 'local' && !c.isReadOnly) || calendars[0];
    let calendarEventId: string | null = null;

    if (targetCalendar) {
        const event = await prisma.calendarEvent.create({
            data: {
                userId: schedule.user.id,
                calendarId: targetCalendar.id,
                title: `${schedule.name} — ${guestName}`,
                description: body?.guestNotes ? String(body.guestNotes) : null,
                location: meetUrl || null,
                startsAt,
                endsAt,
                source: 'local',
                status: 'confirmed',
                attendees: {
                    create: [
                        ...(schedule.user.email ? [{ email: schedule.user.email, name: schedule.user.name || schedule.user.email, responseStatus: 'accepted', isOrganizer: true }] : []),
                        { email: guestEmail, name: guestName, responseStatus: 'accepted', isOrganizer: false },
                    ],
                },
            },
        });
        calendarEventId = event.id;
    }

    const cancelToken = randomBytes(24).toString('hex');
    const booking = await prisma.appointmentBooking.create({
        data: {
            scheduleId,
            calendarEventId,
            guestName,
            guestEmail,
            guestNotes: body?.guestNotes ? String(body.guestNotes).trim() : null,
            startsAt,
            endsAt,
            meetUrl,
            cancelToken,
            status: 'confirmed',
        },
    });

    return NextResponse.json({
        id: booking.id,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        meetUrl: booking.meetUrl,
        cancelToken: booking.cancelToken,
        hostName: schedule.user.name,
        scheduleName: schedule.name,
    }, { status: 201 });
}
