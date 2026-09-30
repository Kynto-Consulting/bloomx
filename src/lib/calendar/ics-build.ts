/**
 * Constructor UNICO de ICS saliente (REQUEST / CANCEL / PUBLISH) con conferencia. Puro (sin Node, sin Prisma).
 *
 * Seguridad (CWE-93, inyeccion de lineas en ICS): TODO valor que entra (titulo, descripcion, ubicacion, organizador,
 * invitados, UID, URL, LABEL, PRODID) se sanea: CR/LF y caracteres de control nunca llegan al resultado, el texto se
 * escapa segun RFC 5545 (3.3.11), los parametros se citan sin comillas internas y los correos se validan. El plegado a
 * 75 octetos se hace DESPUES de sanear y nunca parte un caracter UTF-8 multibyte.
 *
 * Conferencia: solo se incluye si el enlace pasa `analyzeMeetingUrl` (https, sin credenciales, sin caracteres de
 * control). Las propiedades especificas de proveedor (`X-GOOGLE-CONFERENCE`, `X-ZOOM-JOIN-URL`) se anaden segun el
 * HOST del enlace ya analizado, nunca por coincidencia de subcadenas.
 */
import { analyzeMeetingUrl } from '../conferencing/hosts';
import { inviteCalName, inviteProdId, inviteText } from './invite-template.js';

export type IcsMethod = 'REQUEST' | 'CANCEL' | 'PUBLISH';

export interface IcsPerson {
    email: string;
    name?: string | null;
}

export interface IcsAttendee extends IcsPerson {
    role?: 'CHAIR' | 'REQ-PARTICIPANT' | 'OPT-PARTICIPANT';
    partstat?: 'NEEDS-ACTION' | 'ACCEPTED' | 'DECLINED' | 'TENTATIVE';
    rsvp?: boolean;
}

export interface IcsConference {
    /** Id del proveedor ('google-meet' | 'zoom' | 'custom' ...); informativo, NO decide las propiedades X-*. */
    provider?: string;
    joinUrl: string;
    passcode?: string | null;
    dialIn?: Array<{ country?: string; number: string; code?: string }>;
}

export interface BuildEventIcsInput {
    uid: string;
    sequence?: number;
    method: IcsMethod;
    title: string;
    description?: string | null;
    location?: string | null;
    startsAt: Date;
    endsAt: Date;
    organizer: IcsPerson;
    attendees?: IcsAttendee[];
    conference?: IcsConference | null;
    /** Marca de la empresa: va en PRODID (`-//<Marca>//BloomX Calendar//ES|EN`) y, en PUBLISH, en X-WR-CALNAME. */
    brandName?: string;
    /** Idioma de PRODID y de los textos de la descripcion / alarma (por defecto en). */
    locale?: 'es' | 'en';
    /** Zona IANA: si es valida se emite VTIMEZONE + TZID (como la reserva publica); si no, UTC. */
    timezone?: string | null;
    /** Minutos del VALARM (0/null = sin alarma). Por defecto 15. Nunca en CANCEL. */
    alarmMinutes?: number | null;
    /** Solo para pruebas: DTSTAMP fijo. */
    dtstamp?: Date;
}

// ─── Saneado y escape ────────────────────────────────────────────────────────

/** Caracteres de control (salvo \t), DEL y separadores de linea Unicode: nunca deben llegar a una linea ICS. */
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f\u0085\u2028\u2029]/g;

/** Texto de UNA linea: saltos y controles pasan a espacio. */
export function sanitizeIcsLine(value: unknown): string {
    return String(value == null ? '' : value)
        .replace(/\r\n|\r|\n/g, ' ')
        .replace(CONTROL_RE, ' ')
        .replace(/ {2,}/g, ' ')
        .trim();
}

/** Escape TEXT (RFC 5545): `\`, `;`, `,` y saltos (los saltos de texto multilinea se codifican como `\n`). */
export function escapeIcsText(value: unknown, opts: { multiline?: boolean } = {}): string {
    const segments = String(value == null ? '' : value)
        .replace(/\r\n|\r|\u0085|\u2028|\u2029/g, '\n')
        .split('\n')
        .map((seg) =>
            seg.replace(CONTROL_RE, ' ').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,'),
        );
    return segments.join(opts.multiline ? '\\n' : ' ');
}

/** Valor de parametro entre comillas (no admite comillas ni controles dentro). */
function paramValue(value: unknown): string {
    return `"${sanitizeIcsLine(value).replace(/"/g, "'")}"`;
}

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;

function safeEmail(value: unknown): string | null {
    const e = String(value == null ? '' : value).trim();
    return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

function safeUid(value: unknown): string {
    return String(value == null ? '' : value).replace(/[^A-Za-z0-9@._+=-]/g, '').slice(0, 255);
}

function utf8Len(ch: string): number {
    const cp = ch.codePointAt(0) ?? 0;
    return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
}

/** Plegado RFC 5545 3.1: lineas de 75 octetos como maximo (continuacion = espacio + contenido), sin partir UTF-8. */
export function foldIcsLine(line: string): string {
    let total = 0;
    for (const ch of line) total += utf8Len(ch);
    if (total <= 75) return line;

    const out: string[] = [];
    let cur = '';
    let bytes = 0;
    for (const ch of line) {
        const b = utf8Len(ch);
        if (bytes + b > 75) {
            out.push(cur);
            cur = ' ';
            bytes = 1;
        }
        cur += ch;
        bytes += b;
    }
    out.push(cur);
    return out.join('\r\n');
}

// ─── Fechas ──────────────────────────────────────────────────────────────────

function formatUtc(d: Date): string {
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function validTimeZone(tz: unknown): string | null {
    const candidate = String(tz == null ? '' : tz).trim();
    if (!candidate || !/^[A-Za-z0-9_+\-/]+$/.test(candidate)) return null;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: candidate });
        return candidate;
    } catch {
        return null;
    }
}

function zonedParts(date: Date, tz: string) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(date);
    const get = (t: string) => {
        const v = parts.find((p) => p.type === t)?.value ?? '00';
        return v === '24' ? '00' : v;
    };
    return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

function formatZoned(date: Date, tz: string): string {
    const p = zonedParts(date, tz);
    return `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}`;
}

/** Desfase UTC de `tz` en `date` como ±HHMM. */
function tzOffset(date: Date, tz: string): string {
    const p = zonedParts(date, tz);
    const localMs = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
    const offMin = Math.round((localMs - date.getTime()) / 60000);
    const abs = Math.abs(offMin);
    return `${offMin >= 0 ? '+' : '-'}${String(Math.floor(abs / 60)).padStart(2, '0')}${String(abs % 60).padStart(2, '0')}`;
}

// ─── Conferencia ─────────────────────────────────────────────────────────────

interface ResolvedConference {
    url: string;
    label: string;
    google: boolean;
    zoom: boolean;
    passcode: string | null;
    dialIn: Array<{ country?: string; number: string; code?: string }>;
}

function resolveConference(conf: IcsConference | null | undefined): ResolvedConference | null {
    if (!conf) return null;
    const info = analyzeMeetingUrl(conf.joinUrl);
    if (!info) return null;
    const passcode = sanitizeIcsLine(conf.passcode).slice(0, 64) || null;
    const dialIn = (Array.isArray(conf.dialIn) ? conf.dialIn : [])
        .map((d) => ({
            country: sanitizeIcsLine(d?.country).slice(0, 40) || undefined,
            number: sanitizeIcsLine(d?.number).slice(0, 40),
            code: sanitizeIcsLine(d?.code).slice(0, 64) || undefined,
        }))
        .filter((d) => d.number)
        .slice(0, 10);
    return {
        url: info.url,
        // El LABEL sale del HOST analizado (nombre del proveedor reconocido o el propio host), no de lo que afirme el llamador.
        label: info.providerName,
        google: info.recognized && info.provider === 'google-meet' && new URL(info.url).hostname.toLowerCase() === 'meet.google.com',
        zoom: info.recognized && info.provider === 'zoom',
        passcode,
        dialIn,
    };
}

function conferenceDescription(conf: ResolvedConference, locale: 'es' | 'en'): string[] {
    const t = (path: string, vars?: Record<string, string>) => inviteText(locale, path, vars) as string;
    const lines = [`${t('join', { provider: conf.label })}: ${conf.url}`];
    if (conf.passcode) lines.push(`${t('labels.passcode')}: ${conf.passcode}`);
    if (conf.dialIn.length) {
        lines.push(`${t('conf.dialIn')}:`);
        for (const d of conf.dialIn) {
            lines.push(`${d.country ? `${d.country}: ` : ''}${d.number}${d.code ? ` (${t('labels.code').toLowerCase()} ${d.code})` : ''}`);
        }
    }
    return lines;
}

// ─── Constructor ─────────────────────────────────────────────────────────────

export function buildEventIcs(input: BuildEventIcsInput): string {
    const method: IcsMethod = input.method === 'CANCEL' || input.method === 'PUBLISH' ? input.method : 'REQUEST';
    const cancel = method === 'CANCEL';
    const locale: 'es' | 'en' = input.locale === 'es' ? 'es' : 'en';
    const sequence = Number.isFinite(input.sequence) ? Math.max(0, Math.floor(input.sequence as number)) : 0;
    const tz = validTimeZone(input.timezone);
    const conf = cancel ? null : resolveConference(input.conference);

    const descParts: string[] = [];
    if (input.description) descParts.push(String(input.description));
    if (input.location && conf) {
        const place = sanitizeIcsLine(input.location);
        if (place && place !== conf.url) descParts.push(`${inviteText(locale, 'conf.location')}: ${place}`);
    }
    if (conf) descParts.push(conferenceDescription(conf, locale).join('\n'));
    const description = descParts.join('\n\n');

    const location = conf ? conf.url : sanitizeIcsLine(input.location);

    const lines: Array<string | null> = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        `PRODID:${inviteProdId(input.brandName, locale)}`,
        'CALSCALE:GREGORIAN',
        `METHOD:${method}`,
        // Nombre del calendario solo al publicar un calendario/evento suelto; en REQUEST/CANCEL renombraria el calendario del invitado.
        method === 'PUBLISH' ? `X-WR-CALNAME:${inviteCalName(input.brandName)}` : null,
    ];

    if (tz) {
        const offset = tzOffset(input.startsAt, tz);
        lines.push(
            'BEGIN:VTIMEZONE', `TZID:${tz}`, `X-LIC-LOCATION:${tz}`,
            'BEGIN:STANDARD', `TZOFFSETFROM:${offset}`, `TZOFFSETTO:${offset}`, `TZNAME:${tz}`, 'DTSTART:19700101T000000', 'END:STANDARD',
            'END:VTIMEZONE',
        );
    }

    const dt = (d: Date) => (tz ? `;TZID=${tz}:${formatZoned(d, tz)}` : `:${formatUtc(d)}`);

    lines.push(
        'BEGIN:VEVENT',
        `UID:${escapeIcsText(safeUid(input.uid))}`,
        `DTSTAMP:${formatUtc(input.dtstamp ?? new Date())}`,
        `DTSTART${dt(input.startsAt)}`,
        `DTEND${dt(input.endsAt)}`,
        `SUMMARY:${escapeIcsText(input.title)}`,
        description ? `DESCRIPTION:${escapeIcsText(description, { multiline: true })}` : null,
        location ? `LOCATION:${escapeIcsText(location)}` : null,
    );

    if (conf) {
        lines.push(
            `URL:${conf.url}`,
            `CONFERENCE;VALUE=URI;FEATURE=VIDEO;LABEL=${paramValue(inviteText(locale, 'join', { provider: conf.label }) as string)}:${conf.url}`,
            conf.google ? `X-GOOGLE-CONFERENCE:${conf.url}` : null,
            conf.zoom ? `X-ZOOM-JOIN-URL:${conf.url}` : null,
        );
    }

    const organizerEmail = safeEmail(input.organizer?.email);
    if (organizerEmail) {
        lines.push(`ORGANIZER;CN=${paramValue(input.organizer.name || organizerEmail)}:mailto:${organizerEmail}`);
    }

    const seen = new Set<string>();
    const attendees: IcsAttendee[] = [];
    if (organizerEmail && !cancel) {
        attendees.push({ email: organizerEmail, name: input.organizer.name, role: 'CHAIR', partstat: 'ACCEPTED', rsvp: false });
        seen.add(organizerEmail.toLowerCase());
    }
    for (const a of input.attendees || []) {
        const email = safeEmail(a?.email);
        if (!email || seen.has(email.toLowerCase())) continue;
        seen.add(email.toLowerCase());
        attendees.push({ ...a, email });
    }
    for (const a of attendees) {
        const role = a.role === 'CHAIR' || a.role === 'OPT-PARTICIPANT' ? a.role : 'REQ-PARTICIPANT';
        const partstat = a.partstat && ['NEEDS-ACTION', 'ACCEPTED', 'DECLINED', 'TENTATIVE'].includes(a.partstat) ? a.partstat : 'NEEDS-ACTION';
        const rsvp = a.rsvp ?? role !== 'CHAIR';
        lines.push(
            `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=${role};PARTSTAT=${partstat};RSVP=${rsvp ? 'TRUE' : 'FALSE'};CN=${paramValue(a.name || a.email)}:mailto:${a.email}`,
        );
    }

    lines.push(`SEQUENCE:${sequence}`, cancel ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED', 'TRANSP:OPAQUE');

    const alarm = input.alarmMinutes === undefined ? 15 : input.alarmMinutes;
    if (!cancel && alarm && alarm > 0 && Number.isFinite(alarm)) {
        lines.push(
            'BEGIN:VALARM',
            `TRIGGER:-PT${Math.floor(alarm)}M`,
            'ACTION:DISPLAY',
            `DESCRIPTION:${escapeIcsText(`${inviteText(locale, 'conf.reminder')}: ${input.title}`)}`,
            'END:VALARM',
        );
    }

    lines.push('END:VEVENT', 'END:VCALENDAR');

    return (lines.filter((l): l is string => Boolean(l)).map(foldIcsLine).join('\r\n')) + '\r\n';
}
