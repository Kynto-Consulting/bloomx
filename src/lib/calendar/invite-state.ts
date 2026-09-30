/**
 * Reglas puras de consistencia para invitaciones de calendario recibidas (sin Prisma: testeable).
 *
 * Una invitacion se identifica por su UID (estable). SEQUENCE solo crece: una actualizacion con SEQUENCE menor que la
 * ya aplicada es antigua (correo reprocesado o fuera de orden) y se ignora; una invitacion vieja NUNCA resucita un
 * evento cancelado (hace falta un SEQUENCE mayor que el de la cancelacion); responder (RSVP) nunca cambia el estado.
 */
import { providerIdForLink, recognizeMeetingUrl } from '../conferencing/hosts';

export type InviteMethod = 'REQUEST' | 'CANCEL' | 'PUBLISH' | 'REPLY' | string;

export interface KnownInviteState {
    /** Mayor SEQUENCE ya aplicado para este UID. */
    sequence: number;
    /** El ultimo estado aplicado para ese SEQUENCE fue una cancelacion. */
    cancelled: boolean;
}

export function normalizeSequence(value: unknown): number {
    const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Decide si una invitacion entrante (REQUEST/PUBLISH/CANCEL) debe aplicarse al calendario. */
export function shouldApplyInvite(
    method: InviteMethod,
    incomingSequence: unknown,
    known: KnownInviteState | null,
): boolean {
    if (!known) return true;
    const seq = normalizeSequence(incomingSequence);
    const isCancel = String(method).toUpperCase() === 'CANCEL';
    if (seq < known.sequence) return false; // antigua
    if (!isCancel && known.cancelled && seq <= known.sequence) return false; // no resucitar un evento cancelado
    return true;
}

/** Resume los registros 'invite.sequence' de un UID en el estado conocido. */
export function summarizeKnownState(
    records: Array<{ sequence?: unknown; method?: unknown }>,
): KnownInviteState | null {
    if (!records.length) return null;
    let max = -1;
    let cancelledAtMax = false;
    for (const r of records) {
        const seq = normalizeSequence(r.sequence);
        const cancelled = String(r.method || '').toUpperCase() === 'CANCEL';
        if (seq > max) {
            max = seq;
            cancelledAtMax = cancelled;
        } else if (seq === max && cancelled) {
            cancelledAtMax = true;
        }
    }
    return { sequence: max, cancelled: cancelledAtMax };
}

/**
 * Campos opcionales de conferencia de CalendarEvent para el enlace de una invitacion: solo si el enlace es de un
 * proveedor RECONOCIDO (https + host + forma de ruta); si no, null (el enlace sigue en `location`).
 */
export function conferenceFieldsFor(link: string | null | undefined): {
    conferenceUrl: string | null;
    conferenceProvider: string | null;
} {
    const info = recognizeMeetingUrl(link);
    if (!info) return { conferenceUrl: null, conferenceProvider: null };
    return { conferenceUrl: info.url, conferenceProvider: providerIdForLink(info.url) ?? 'custom' };
}
