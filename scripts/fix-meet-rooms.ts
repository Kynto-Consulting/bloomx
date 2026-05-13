/**
 * fix-meet-rooms.ts
 * Patches all existing Google Meet rooms to be open (no waiting room).
 * Runs as part of `prebuild` — skips gracefully if credentials are missing.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

function extractMeetSpaceName(meetUrl: string): string | null {
    const match = meetUrl.match(/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i);
    return match ? `spaces/${match[1]}` : null;
}

async function refreshToken(refreshToken: string): Promise<string | null> {
    try {
        const res = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: GOOGLE_CLIENT_ID!,
                client_secret: GOOGLE_CLIENT_SECRET!,
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
            }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.access_token ?? null;
    } catch {
        return null;
    }
}

async function patchSpaceOpen(accessToken: string, meetUrl: string): Promise<boolean> {
    const spaceName = extractMeetSpaceName(meetUrl);
    if (!spaceName) return false;
    try {
        const res = await fetch(
            `https://meet.googleapis.com/v2/${spaceName}?updateMask=config.accessType,config.entryPointAccess`,
            {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ config: { accessType: 'OPEN', entryPointAccess: 'ALL' } }),
            },
        );
        return res.ok;
    } catch {
        return false;
    }
}

async function main() {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        console.warn('[fix-meet-rooms] GOOGLE_CLIENT_ID/SECRET not set — skipping.');
        return;
    }
    if (!process.env.DATABASE_URL) {
        console.warn('[fix-meet-rooms] DATABASE_URL not set — skipping.');
        return;
    }

    // Find all bookings with a Google Meet URL, join to schedule to get the host userId.
    const bookings = await prisma.appointmentBooking.findMany({
        where: { meetUrl: { contains: 'meet.google.com' }, status: 'confirmed' },
        select: { id: true, meetUrl: true, schedule: { select: { userId: true } } },
    });

    // Also find calendar events with a Google Meet location.
    const calEvents = await prisma.calendarEvent.findMany({
        where: { location: { contains: 'meet.google.com' }, status: { not: 'cancelled' } },
        select: { id: true, location: true, userId: true },
    });

    console.log(`[fix-meet-rooms] Found ${bookings.length} bookings + ${calEvents.length} calendar events with Meet URLs.`);

    // Build a map userId → [meetUrls] to avoid duplicate token refreshes.
    const byUser = new Map<string, Set<string>>();

    for (const b of bookings) {
        if (!b.meetUrl) continue;
        const uid = b.schedule?.userId;
        if (!uid) continue;
        if (!byUser.has(uid)) byUser.set(uid, new Set());
        byUser.get(uid)!.add(b.meetUrl);
    }
    for (const e of calEvents) {
        if (!e.location) continue;
        if (!byUser.has(e.userId)) byUser.set(e.userId, new Set());
        byUser.get(e.userId)!.add(e.location);
    }

    let patched = 0;
    let failed = 0;

    for (const [userId, meetUrls] of byUser) {
        const account = await prisma.account.findFirst({
            where: { userId, provider: 'google' },
            select: { refresh_token: true },
        });
        if (!account?.refresh_token) {
            console.warn(`[fix-meet-rooms] No Google refresh token for user ${userId} — skipping ${meetUrls.size} rooms.`);
            failed += meetUrls.size;
            continue;
        }

        const accessToken = await refreshToken(account.refresh_token);
        if (!accessToken) {
            console.warn(`[fix-meet-rooms] Could not get access token for user ${userId} — skipping.`);
            failed += meetUrls.size;
            continue;
        }

        for (const url of meetUrls) {
            const ok = await patchSpaceOpen(accessToken, url);
            if (ok) {
                patched++;
            } else {
                console.warn(`[fix-meet-rooms] Failed to patch ${url} (user ${userId})`);
                failed++;
            }
        }
    }

    console.log(`[fix-meet-rooms] Done — patched: ${patched}, failed/skipped: ${failed}.`);
}

main()
    .catch(err => {
        // Non-fatal: warn but don't fail the build.
        console.warn('[fix-meet-rooms] Unexpected error (non-fatal):', err?.message ?? err);
    })
    .finally(() => prisma.$disconnect());
