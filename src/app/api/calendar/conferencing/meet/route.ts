import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

    // Create via Meet REST API directly so the space is open (no waiting room) from the start.
    // Calendar API's createRequest produces rooms that are not patchable via meetings.space.created scope.
    const spaceRes = await fetch('https://meet.googleapis.com/v2/spaces', {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            config: { accessType: 'OPEN', entryPointAccess: 'ALL' },
        }),
    });

    if (!spaceRes.ok) {
        const body = await spaceRes.text().catch(() => '');
        console.error('[meet] Failed to create space:', spaceRes.status, body);
        return NextResponse.json({ error: 'Failed to create Meet room' }, { status: 500 });
    }

    const space = await spaceRes.json();
    const meetUrl: string | null = space.meetingUri || null;

    if (!meetUrl) return NextResponse.json({ error: 'No Meet URL returned' }, { status: 500 });

    return NextResponse.json({ meetUrl });
}
