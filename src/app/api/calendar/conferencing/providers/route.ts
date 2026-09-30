import { NextRequest, NextResponse } from 'next/server';
import { errorResponse, limit, NO_STORE_HEADERS, requireActor } from '@/lib/conferencing/http';
import { listProviderStatuses } from '@/lib/conferencing/status';

export const runtime = 'nodejs';

/** GET /api/calendar/conferencing/providers -> { providers: ConferencingProviderStatus[] } (solo del usuario de la sesion). */
export async function GET(req: NextRequest) {
    const who = await requireActor(req);
    if (!who.ok) return who.response;

    const limited = await limit(`conf:providers:${who.actor.userId}`, 60, 60_000);
    if (limited) return errorResponse(limited);

    try {
        const force = req.nextUrl.searchParams.get('refresh') === '1';
        const providers = await listProviderStatuses(who.actor, { force });
        return NextResponse.json({ providers }, { headers: NO_STORE_HEADERS });
    } catch (error) {
        return errorResponse(error);
    }
}
