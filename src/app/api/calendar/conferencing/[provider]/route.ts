import { NextRequest, NextResponse } from 'next/server';
import { createMeeting, deleteMeeting } from '@/lib/conferencing/service';
import { ConferencingError } from '@/lib/conferencing/types';
import { createMeetingSchema, errorResponse, limit, NO_STORE_HEADERS, parseProvider, readIdempotencyKey, requireActor } from '@/lib/conferencing/http';
import { auditLog, getClientIp } from '@/lib/security';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ provider: string }> };

/**
 * POST /api/calendar/conferencing/{google-meet|zoom|custom}
 * Crea una reunion con el proveedor (delegando en su extension). Cabecera opcional `Idempotency-Key` (8-128 [A-Za-z0-9_.:-]).
 * -> { meeting: ConferencingMeeting }. Errores: { error: { code, message, retryAfter? } }.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
    const who = await requireActor(req);
    if (!who.ok) return who.response;

    const provider = parseProvider((await params).provider);
    if (!provider) return errorResponse(new ConferencingError('invalid_input', 'Unknown provider'));

    const limited = await limit(`conf:create:${who.actor.userId}`, 20, 60_000);
    if (limited) return errorResponse(limited);

    const key = readIdempotencyKey(req);
    if (key === 'invalid') return errorResponse(new ConferencingError('invalid_input', 'Invalid Idempotency-Key'));

    let json: unknown;
    try {
        json = await req.json();
    } catch {
        json = {};
    }
    const parsed = createMeetingSchema.safeParse(json ?? {});
    if (!parsed.success) return errorResponse(new ConferencingError('invalid_input', 'Invalid request body'));

    try {
        const meeting = await createMeeting(who.actor, provider, parsed.data, { idempotencyKey: key });
        auditLog('conferencing.meeting.created', { userId: who.actor.userId, provider, mode: meeting.mode ?? undefined, ip: getClientIp(req) });
        return NextResponse.json({ meeting }, { headers: NO_STORE_HEADERS });
    } catch (error) {
        return errorResponse(error, reconnectHints(error));
    }
}

/** DELETE /api/calendar/conferencing/{provider}?meetingId=... -> { ok: true } (solo reuniones creadas por el propio usuario). */
export async function DELETE(req: NextRequest, { params }: Ctx) {
    const who = await requireActor(req);
    if (!who.ok) return who.response;

    const provider = parseProvider((await params).provider);
    if (!provider) return errorResponse(new ConferencingError('invalid_input', 'Unknown provider'));

    const limited = await limit(`conf:delete:${who.actor.userId}`, 30, 60_000);
    if (limited) return errorResponse(limited);

    const meetingId = req.nextUrl.searchParams.get('meetingId') || '';
    try {
        await deleteMeeting(who.actor, provider, meetingId);
        auditLog('conferencing.meeting.deleted', { userId: who.actor.userId, provider, ip: getClientIp(req) });
        return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
    } catch (error) {
        return errorResponse(error);
    }
}

function reconnectHints(error: unknown): Record<string, unknown> {
    const code = (error as { code?: string } | null)?.code;
    return code === 'not_connected' || code === 'token_revoked' ? { reconnect: code === 'token_revoked' } : {};
}
