import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { randomBytes } from 'crypto';
import { patchMeetSpaceOpen } from '@/lib/google/meet';

export async function POST(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const title = String(body?.title || 'Meeting').trim();
    const startsAt = body?.startsAt ? new Date(body.startsAt) : new Date();
    const endsAt = body?.endsAt ? new Date(body.endsAt) : new Date(startsAt.getTime() + 60 * 60 * 1000);

    const googleAccount = await prisma.account.findFirst({
        where: { userId: user.id, provider: 'google' },
        select: { refresh_token: true },
    });

    if (!googleAccount?.refresh_token) {
        return NextResponse.json({ error: 'Google account not linked' }, { status: 400 });
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID || '',
            client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
            grant_type: 'refresh_token',
            refresh_token: googleAccount.refresh_token,
        }),
    });
    if (!tokenRes.ok) return NextResponse.json({ error: 'Failed to refresh token' }, { status: 500 });
    const { access_token } = await tokenRes.json();

    const eventRes = await fetch(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=none',
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                summary: title,
                start: { dateTime: startsAt.toISOString() },
                end: { dateTime: endsAt.toISOString() },
                conferenceData: {
                    createRequest: {
                        requestId: randomBytes(8).toString('hex'),
                        conferenceSolutionKey: { type: 'hangoutsMeet' },
                    },
                },
            }),
        },
    );

    if (!eventRes.ok) return NextResponse.json({ error: 'Failed to create Meet room' }, { status: 500 });
    const data = await eventRes.json();
    const meetUrl = data.conferenceData?.entryPoints?.find((ep: any) => ep.entryPointType === 'video')?.uri || null;

    // Delete the temp Google Calendar event — no attendees added so no email risk,
    // but we clean up to keep the host's calendar tidy. BloomX owns the event record.
    if (data.id) {
        fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events/${data.id}?sendUpdates=none`,
            { method: 'DELETE', headers: { Authorization: `Bearer ${access_token}` } },
        ).catch(() => undefined);
    }

    if (!meetUrl) return NextResponse.json({ error: 'No Meet URL returned' }, { status: 500 });

    // Patch the space immediately so it's open (no waiting room) for everyone with the link.
    await patchMeetSpaceOpen(access_token, meetUrl);

    return NextResponse.json({ meetUrl });
}
