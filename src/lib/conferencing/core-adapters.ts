/**
 * Adaptadores FINOS de compatibilidad del host. Solo se usan cuando la extension del proveedor NO esta instalada o el
 * backend de extensiones no responde (`unavailable`), para no romper lo que ya funcionaba antes de existir las
 * extensiones `core-zoom` / `core-google-meet`:
 *   - Google Meet con la cuenta Google vinculada del usuario (ruta vieja /api/calendar/conferencing/meet y appointments).
 *   - Zoom con la cuenta Zoom vinculada del usuario (appointments).
 * La logica completa (modos S2S / cuenta de servicio, ICS, dial-in, update/delete) vive en las extensiones.
 */
import { apiBase } from './api-bases';
import { classifyGoogleApiError } from '@/lib/google/errors';
import { ConferencingError, type ConferencingMeeting, type CreateMeetingInput } from './types';
import { normalizeMeeting } from './normalize';

const TIMEOUT_MS = 12_000;

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
    try {
        return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
        throw new ConferencingError('provider_error', 'Could not reach the provider');
    }
}

/** Sala de Google Meet abierta (sin sala de espera) con el token del usuario (scope meetings.space.created). */
export async function createGoogleMeetWithUserToken(accessToken: string): Promise<ConferencingMeeting> {
    const res = await timedFetch(`${apiBase('MEET_API_BASE')}/v2/spaces`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { accessType: 'OPEN', entryPointAccess: 'ALL' } }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
        const reconnect = classifyGoogleApiError(res.status, body);
        if (reconnect) throw new ConferencingError('token_revoked', 'Google permissions are missing; reconnect your Google account');
        if (res.status === 429) throw new ConferencingError('rate_limited', undefined, { retryAfter: Number(res.headers.get('retry-after')) || undefined });
        throw new ConferencingError('provider_error', 'Google Meet could not create the room');
    }
    return normalizeMeeting('google-meet', { joinUrl: body?.meetingUri, meetingId: body?.name, mode: 'google-account' }, 'google-account');
}

/** Reunion de Zoom con el token de la cuenta Zoom del usuario. */
export async function createZoomWithUserToken(accessToken: string, input: CreateMeetingInput): Promise<ConferencingMeeting> {
    const startsAt = input.startsAt ? new Date(input.startsAt) : null;
    const endsAt = input.endsAt ? new Date(input.endsAt) : null;
    const scheduled = startsAt && !Number.isNaN(startsAt.getTime());
    const duration = scheduled && endsAt && endsAt > startsAt ? Math.max(15, Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000)) : 60;

    const res = await timedFetch(`${apiBase('ZOOM_API_BASE')}/users/me/meetings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            topic: (input.topic || 'Meeting').slice(0, 200),
            type: scheduled ? 2 : 1,
            duration,
            ...(scheduled ? { start_time: startsAt!.toISOString(), timezone: input.timeZone || 'UTC' } : {}),
            settings: { join_before_host: true, waiting_room: false },
        }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
        if (res.status === 401) throw new ConferencingError('token_revoked', 'Zoom account needs to be reconnected');
        if (res.status === 429) throw new ConferencingError('rate_limited', undefined, { retryAfter: Number(res.headers.get('retry-after')) || undefined });
        throw new ConferencingError('provider_error', 'Zoom could not create the meeting');
    }
    return normalizeMeeting(
        'zoom',
        { joinUrl: body?.join_url, hostUrl: body?.start_url, meetingId: body?.id, passcode: body?.password, topic: body?.topic, mode: 'user-oauth' },
        'user-oauth',
    );
}
