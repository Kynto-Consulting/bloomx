/**
 * Bloque HTML de una reunion para el cuerpo del correo (composer "/zoom" y "/meet").
 *
 * Es HTML inline MINIMO y sin colores propios (p, strong, a): el editor y el cliente de correo del destinatario lo
 * estilizan. Todo valor se escapa; el enlace solo se convierte en boton si es https valido (safeConferenceUrl).
 * (Para el correo de invitacion completo con plantilla de marca existe `buildMeetingAnnouncementHtml`, que es un
 * documento HTML entero y no cabe dentro del editor.)
 */
import { safeConferenceUrl } from '@/lib/conferencing/hosts';
import type { PickerMeeting } from './picker-state';

export interface MeetingBlockLabels {
    join: string; // "Unirse"
    meetingId: string; // "ID de reunion"
    passcode: string; // "Codigo"
    dialIn: string; // "Marcacion"
    when: string; // "Fecha"
}

export interface MeetingBlockOptions {
    meeting: PickerMeeting;
    labels: MeetingBlockLabels;
    topic?: string | null;
    startsAt?: Date | null;
    endsAt?: Date | null;
    timeZone?: string | null;
    locale?: string;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

function whenLabel(start: Date, end: Date | null | undefined, timeZone: string | null | undefined, locale: string): string {
    try {
        const tz = timeZone || undefined;
        const date = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz }).format(start);
        const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: tz });
        return `${date}, ${time.format(start)}${end ? ` - ${time.format(end)}` : ''}${tz ? ` (${tz})` : ''}`;
    } catch {
        return start.toISOString();
    }
}

/** Devuelve '' si el enlace no es seguro (nunca se inserta un href peligroso). */
export function buildMeetingBlockHtml(opts: MeetingBlockOptions): string {
    const { meeting, labels } = opts;
    const url = safeConferenceUrl(meeting.joinUrl);
    if (!url) return '';
    const locale = opts.locale || 'es';
    const title = (opts.topic || meeting.topic || '').toString().trim();
    const lines: string[] = [];
    lines.push(`<p><strong>${escapeHtml(meeting.providerName)}${title ? `: ${escapeHtml(title)}` : ''}</strong></p>`);
    if (opts.startsAt && !Number.isNaN(opts.startsAt.getTime())) {
        lines.push(`<p>${escapeHtml(labels.when)}: ${escapeHtml(whenLabel(opts.startsAt, opts.endsAt, opts.timeZone, locale))}</p>`);
    }
    lines.push(`<p><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(labels.join)}</strong></a> &middot; ${escapeHtml(url)}</p>`);
    const extra: string[] = [];
    // En Google Meet el codigo ya esta en el enlace (el meetingId interno es 'spaces/...' o 'cal:...'): no se muestra.
    if (meeting.meetingId && meeting.provider === 'zoom') extra.push(`${escapeHtml(labels.meetingId)}: ${escapeHtml(meeting.meetingId)}`);
    if (meeting.passcode) extra.push(`${escapeHtml(labels.passcode)}: ${escapeHtml(meeting.passcode)}`);
    if (extra.length) lines.push(`<p>${extra.join(' &middot; ')}</p>`);
    const dial = (meeting.dialIn || []).filter((d) => d && d.number).slice(0, 3);
    if (dial.length) {
        lines.push(`<p>${escapeHtml(labels.dialIn)}: ${dial.map((d) => `${escapeHtml(d.number)}${d.country ? ` (${escapeHtml(d.country)})` : ''}`).join(' &middot; ')}</p>`);
    }
    return lines.join('');
}
