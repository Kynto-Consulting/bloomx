/**
 * Decide que mostrar en el lector de correo para el enlace de reunion de una invitacion recibida (puro, testeable).
 *
 * - `join`: enlace https de un proveedor RECONOCIDO (por host, via `recognizeMeetingUrl`): boton "Unirse" con el href
 *   normalizado y el icono del proveedor.
 * - `unrecognized`: hay un enlace, pero no es de un proveedor conocido (o no es https seguro): NO boton, solo texto
 *   plano con aviso.
 * - `none`: no hay enlace.
 *
 * La deteccion se hace SOLO sobre campos ya parseados de la invitacion (meetUrl, ubicacion, descripcion de texto del
 * ICS); nunca sobre HTML arbitrario del correo.
 */
import { findMeetingUrlInText, recognizeMeetingUrl, type MeetingLinkProviderKey } from '../conferencing/hosts';

export type JoinLinkResult =
    | { kind: 'join'; url: string; provider: MeetingLinkProviderKey; providerName: string }
    | { kind: 'unrecognized'; text: string }
    | { kind: 'none' };

export interface JoinLinkSource {
    meetUrl?: string | null;
    location?: string | null;
    description?: string | null;
}

const MAX_TEXT = 300;

function toDisplayText(value: string): string {
    // eslint-disable-next-line no-control-regex
    return value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

function looksLikeUrl(value: string): boolean {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim());
}

export function resolveJoinLink(source: JoinLinkSource | null | undefined): JoinLinkResult {
    const meetUrl = typeof source?.meetUrl === 'string' ? source.meetUrl.trim() : '';
    const location = typeof source?.location === 'string' ? source.location.trim() : '';

    for (const candidate of [meetUrl, location]) {
        if (!candidate) continue;
        const info = recognizeMeetingUrl(candidate);
        if (info) return { kind: 'join', url: info.url, provider: info.provider, providerName: info.providerName };
    }

    // Enlace de reunion dentro de la descripcion (texto del ICS ya parseado).
    const fromText = findMeetingUrlInText(source?.description) || findMeetingUrlInText(location);
    if (fromText) {
        const info = recognizeMeetingUrl(fromText);
        if (info) return { kind: 'join', url: info.url, provider: info.provider, providerName: info.providerName };
    }

    // Hay un enlace explicito pero no reconocido: solo texto.
    if (meetUrl) return { kind: 'unrecognized', text: toDisplayText(meetUrl) };
    if (location && looksLikeUrl(location)) return { kind: 'unrecognized', text: toDisplayText(location) };
    return { kind: 'none' };
}
