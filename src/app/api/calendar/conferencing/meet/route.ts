import { NextRequest, NextResponse } from 'next/server';
import { createMeeting } from '@/lib/conferencing/service';
import { CONFERENCING_ERROR_STATUS, isConferencingError } from '@/lib/conferencing/types';
import { errorResponse, limit, NO_STORE_HEADERS, readIdempotencyKey, requireActor } from '@/lib/conferencing/http';

export const runtime = 'nodejs';

/**
 * ALIAS COMPATIBLE de la ruta antigua (POST /api/calendar/conferencing/meet -> { meetUrl }).
 * Ahora delega en la fachada unica (POST /api/calendar/conferencing/google-meet): misma sesion, propiedad, limite y
 * errores tipados. Conserva la forma historica: body { title, startsAt, endsAt } y respuesta { meetUrl } (+ `meeting`).
 * En errores devuelve { error: <mensaje>, code } (la forma antigua era un texto).
 */
export async function POST(req: NextRequest) {
    const who = await requireActor(req);
    if (!who.ok) return who.response;

    const limited = await limit(`conf:create:${who.actor.userId}`, 20, 60_000);
    if (limited) return errorResponse(limited);

    let body: any = {};
    try {
        body = await req.json();
    } catch {
        body = {};
    }
    const key = readIdempotencyKey(req);

    try {
        const meeting = await createMeeting(
            who.actor,
            'google-meet',
            {
                topic: typeof body?.title === 'string' ? body.title : typeof body?.topic === 'string' ? body.topic : undefined,
                startsAt: typeof body?.startsAt === 'string' ? body.startsAt : null,
                endsAt: typeof body?.endsAt === 'string' ? body.endsAt : null,
            },
            { idempotencyKey: key === 'invalid' ? null : key },
        );
        return NextResponse.json({ meetUrl: meeting.joinUrl, meeting }, { headers: NO_STORE_HEADERS });
    } catch (error) {
        if (isConferencingError(error)) {
            return NextResponse.json(
                { error: error.message, code: error.code, ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) },
                { status: CONFERENCING_ERROR_STATUS[error.code], headers: NO_STORE_HEADERS },
            );
        }
        return errorResponse(error);
    }
}
