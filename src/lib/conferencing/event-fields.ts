/**
 * Campos de conferencia de CalendarEvent (conferenceUrl / conferenceProvider / conferenceMeetingId), opcionales y aditivos.
 *
 * Compatibilidad: los eventos existentes guardan el enlace en `location`; al LEER se deriva el enlace reconocido de
 * `location` cuando `conferenceUrl` esta vacio, asi nada cambia para datos antiguos. Al ESCRIBIR:
 *  - `conferenceUrl` solo si es https valido (analyzeMeetingUrl);
 *  - `conferenceProvider` solo un id del registro;
 *  - `conferenceMeetingId` solo si el usuario es dueno de esa reunion en el registro (evita que un evento "apunte" al
 *    meetingId de otra persona).
 */
import { analyzeMeetingUrl, findMeetingUrlInText, providerIdForLink } from './hosts';
import { userOwnsMeeting } from './ledger';
import { isConferencingProviderId, type ConferencingProviderId } from './types';

export interface ConferenceFields {
    conferenceUrl: string | null;
    conferenceProvider: ConferencingProviderId | null;
    conferenceMeetingId: string | null;
}

/** undefined en `body` (campo ausente) => no se toca; null/'' => se borra. */
export async function conferenceFieldsFromBody(
    body: Record<string, unknown> | null | undefined,
    userId: string,
): Promise<Partial<ConferenceFields>> {
    const out: Partial<ConferenceFields> = {};
    if (!body || typeof body !== 'object') return out;

    if ('conferenceUrl' in body) {
        const raw = body.conferenceUrl;
        out.conferenceUrl = raw ? (analyzeMeetingUrl(raw)?.url ?? null) : null;
    }
    if ('conferenceProvider' in body) {
        out.conferenceProvider = isConferencingProviderId(body.conferenceProvider) ? body.conferenceProvider : null;
    }
    if ('conferenceMeetingId' in body) {
        const id = typeof body.conferenceMeetingId === 'string' ? body.conferenceMeetingId.slice(0, 200) : '';
        const provider = (out.conferenceProvider ?? (isConferencingProviderId(body.conferenceProvider) ? body.conferenceProvider : null)) as ConferencingProviderId | null;
        if (id && provider && provider !== 'custom' && (await userOwnsMeeting(userId, provider, id))) out.conferenceMeetingId = id;
        else out.conferenceMeetingId = null;
    }
    // Sin enlace valido no hay proveedor ni reunion que conservar.
    if ('conferenceUrl' in out && out.conferenceUrl === null) {
        out.conferenceProvider = null;
        out.conferenceMeetingId = null;
    }
    return out;
}

/** Enlace/proveedor efectivos de un evento leido de BD (deriva de `location` en eventos antiguos). */
export function effectiveConference(event: { location?: string | null; conferenceUrl?: string | null; conferenceProvider?: string | null }) {
    const stored = event.conferenceUrl ? analyzeMeetingUrl(event.conferenceUrl)?.url ?? null : null;
    const url = stored ?? findMeetingUrlInText(event.location);
    const provider = url ? (isConferencingProviderId(event.conferenceProvider) ? event.conferenceProvider : providerIdForLink(url)) : null;
    return { conferenceUrl: url, conferenceProvider: provider };
}
