import { prisma } from '@/lib/prisma';

/** Extracts the Meet space resource name from a meet.google.com URL. */
export function extractMeetSpaceName(meetUrl: string): string | null {
    const match = meetUrl.match(/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i);
    return match ? `spaces/${match[1]}` : null;
}

/**
 * Patches a Google Meet space to be fully open (no waiting room, anyone with the link can join).
 * Requires an access_token with meetings.space.created scope AND the space must have been
 * created via the Meet REST API (not via Calendar API's createRequest).
 * Returns true on success, false on failure.
 */
export async function patchMeetSpaceOpen(accessToken: string, meetUrl: string): Promise<boolean> {
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
                body: JSON.stringify({
                    config: {
                        accessType: 'OPEN',
                        entryPointAccess: 'ALL',
                    },
                }),
            },
        );
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            console.warn(`[meet] patchMeetSpaceOpen failed (${res.status}) for ${meetUrl}:`, body);
            return false;
        }
        return true;
    } catch (err) {
        console.warn('[meet] patchMeetSpaceOpen error for', meetUrl, err);
        return false;
    }
}

/**
 * Patches all existing Meet rooms for a user to be open.
 * Looks up AppointmentBookings and CalendarEvents that contain meet.google.com URLs.
 * Returns per-URL results so callers can surface failures.
 */
export async function patchAllUserMeetRooms(
    userId: string,
    accessToken: string,
): Promise<{ url: string; ok: boolean }[]> {
    const [bookings, calEvents] = await Promise.all([
        prisma.appointmentBooking.findMany({
            where: { schedule: { userId }, meetUrl: { contains: 'meet.google.com' }, status: 'confirmed' },
            select: { meetUrl: true },
        }),
        prisma.calendarEvent.findMany({
            where: { userId, location: { contains: 'meet.google.com' }, status: { not: 'cancelled' } },
            select: { location: true },
        }),
    ]);

    const urls = new Set<string>();
    for (const b of bookings) if (b.meetUrl) urls.add(b.meetUrl);
    for (const e of calEvents) if (e.location) urls.add(e.location);

    if (urls.size === 0) return [];

    console.log(`[meet] Patching ${urls.size} room(s) for user ${userId}…`);

    const results = await Promise.all(
        [...urls].map(async (url) => ({ url, ok: await patchMeetSpaceOpen(accessToken, url) })),
    );

    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
        console.warn(`[meet] ${failed.length} room(s) failed to patch for user ${userId}`);
    }

    return results;
}
