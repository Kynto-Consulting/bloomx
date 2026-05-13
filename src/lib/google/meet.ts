import { prisma } from '@/lib/prisma';

/** Extracts the meeting code (e.g. "abc-defg-hij") from a meet.google.com URL. */
export function extractMeetCode(meetUrl: string): string | null {
    const match = meetUrl.match(/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i);
    return match ? match[1] : null;
}

/** @deprecated Use extractMeetCode instead. */
export function extractMeetSpaceName(meetUrl: string): string | null {
    const code = extractMeetCode(meetUrl);
    return code ? `spaces/${code}` : null;
}

/**
 * Resolves the canonical Meet space name by calling GET spaces/{meetingCode}.
 * Calendar-created rooms return a different opaque space ID than the meeting code.
 * Returns the opaque space name (e.g. "spaces/jQCFfuBOdN5z") or falls back to
 * "spaces/{meetingCode}" if the GET fails.
 */
async function resolveMeetSpaceName(accessToken: string, meetUrl: string): Promise<string | null> {
    const code = extractMeetCode(meetUrl);
    if (!code) return null;

    try {
        const res = await fetch(`https://meet.googleapis.com/v2/spaces/${code}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (res.ok) {
            const space = await res.json();
            return space.name || `spaces/${code}`;
        }
    } catch {
        // fallthrough to default
    }

    return `spaces/${code}`;
}

export interface PatchResult {
    url: string;
    ok: boolean;
    error?: string;
}

/**
 * Patches a Google Meet space to be fully open (no waiting room).
 * Works for spaces created via the Meet REST API (meetings.space.created scope).
 * First resolves the canonical space name via GET to handle both opaque IDs and meeting codes.
 */
export async function patchMeetSpaceOpen(accessToken: string, meetUrl: string): Promise<PatchResult> {
    const spaceName = await resolveMeetSpaceName(accessToken, meetUrl);
    if (!spaceName) return { url: meetUrl, ok: false, error: 'Could not extract meeting code from URL' };

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
            const msg = `Meet API PATCH ${res.status}: ${body}`;
            console.warn(`[meet] patchMeetSpaceOpen failed for ${meetUrl}:`, msg);
            return { url: meetUrl, ok: false, error: msg };
        }
        return { url: meetUrl, ok: true };
    } catch (err: any) {
        const msg = String(err?.message || err);
        console.warn('[meet] patchMeetSpaceOpen error for', meetUrl, msg);
        return { url: meetUrl, ok: false, error: msg };
    }
}

/**
 * Patches all existing Meet rooms for a user.
 * Tries both Meet API PATCH (Option 1) AND Calendar API update (Option 2) for each room.
 * Returns per-URL results with detailed error messages.
 */
export async function patchAllUserMeetRooms(
    userId: string,
    accessToken: string,
): Promise<PatchResult[]> {
    const [bookings, calEvents] = await Promise.all([
        prisma.appointmentBooking.findMany({
            where: { schedule: { userId }, meetUrl: { contains: 'meet.google.com' }, status: 'confirmed' },
            select: { meetUrl: true },
        }),
        prisma.calendarEvent.findMany({
            where: { userId, location: { contains: 'meet.google.com' }, status: { not: 'cancelled' } },
            select: { location: true, calendarEventId: true },
        }),
    ]);

    const urls = new Set<string>();
    const calEventMap = new Map<string, string | null>(); // meetUrl → calendarEventId

    for (const b of bookings) if (b.meetUrl) urls.add(b.meetUrl);
    for (const e of calEvents) {
        if (e.location) {
            urls.add(e.location);
            calEventMap.set(e.location, e.calendarEventId);
        }
    }

    if (urls.size === 0) return [];

    console.log(`[meet] Patching ${urls.size} room(s) for user ${userId}…`);

    const results: PatchResult[] = await Promise.all(
        [...urls].map(async (url) => {
            // Option 1: Meet API PATCH
            const meetResult = await patchMeetSpaceOpen(accessToken, url);
            if (meetResult.ok) return meetResult;

            // Option 2: Calendar API — refresh the event's conference, then try Meet API again
            const calEventId = calEventMap.get(url);
            if (calEventId) {
                try {
                    const calRes = await fetch(
                        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${calEventId}?conferenceDataVersion=1`,
                        {
                            method: 'PATCH',
                            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ status: 'confirmed' }),
                        },
                    );
                    if (calRes.ok) {
                        // After touching the Calendar event, retry the Meet patch
                        const retryResult = await patchMeetSpaceOpen(accessToken, url);
                        if (retryResult.ok) return retryResult;
                        return { ...meetResult, error: `${meetResult.error} | Calendar retry: ${retryResult.error}` };
                    }
                } catch {
                    // Calendar API failed — return original Meet error
                }
            }

            return meetResult;
        }),
    );

    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
        console.warn(`[meet] ${failed.length} room(s) failed to patch for user ${userId}`);
    }

    return results;
}
