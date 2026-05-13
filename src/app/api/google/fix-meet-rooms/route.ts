import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { patchAllUserMeetRooms } from '@/lib/google/meet';

/**
 * POST /api/google/fix-meet-rooms
 *
 * Applies BOTH patching methods to open all stored Meet rooms (no waiting room):
 *   Option 1 — Meet REST API PATCH with accessType:OPEN
 *   Option 2 — Calendar API PATCH to refresh conference, then retry Meet PATCH
 * Returns per-room results with error details so the UI can surface failures.
 */
export async function POST() {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const account = await prisma.account.findFirst({
        where: { userId: user.id, provider: 'google' },
        select: { refresh_token: true, scope: true },
    });

    if (!account?.refresh_token) {
        return NextResponse.json({ error: 'Google account not linked' }, { status: 400 });
    }

    if (!account.scope?.includes('meetings.space.created')) {
        return NextResponse.json({ error: 'missing_scope' }, { status: 403 });
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID || '',
            client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
            grant_type: 'refresh_token',
            refresh_token: account.refresh_token,
        }),
    });

    if (!tokenRes.ok) {
        return NextResponse.json({ error: 'Failed to refresh token' }, { status: 500 });
    }

    const { access_token } = await tokenRes.json();

    const results = await patchAllUserMeetRooms(user.id, access_token);

    return NextResponse.json({
        total: results.length,
        patched: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        rooms: results.map((r) => ({
            url: r.url,
            ok: r.ok,
            ...(r.error ? { error: r.error } : {}),
        })),
    });
}
