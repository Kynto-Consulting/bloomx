export type InviteResponseStatus = 'accepted' | 'tentative' | 'declined';

export type ParsedInvite = {
    uid?: string;
    summary?: string;
    description?: string;
    location?: string;
    startsAt?: string;
    endsAt?: string;
    method?: string;
    sequence?: number;
    organizerEmail?: string;
    organizerName?: string;
};

function unfoldIcs(source: string) {
    return String(source || '').replace(/\r?\n[ \t]/g, '');
}

export function extractIcsValue(source: string, key: string) {
    const unfolded = unfoldIcs(source);
    const match = unfolded.match(new RegExp(`^${key}[^:]*:(.+)$`, 'im'));
    return match?.[1]?.trim() || '';
}

export function extractEmail(value: string) {
    const match = String(value || '').match(/mailto:([^\s;]+)/i);
    if (match?.[1]) {
        return match[1].trim().toLowerCase();
    }

    const bracketMatch = String(value || '').match(/<([^>]+)>/);
    if (bracketMatch?.[1]) {
        return bracketMatch[1].trim().toLowerCase();
    }

    const normalized = String(value || '').trim().toLowerCase();
    return normalized.includes('@') ? normalized : '';
}

export function extractDisplayName(value: string) {
    const cnMatch = String(value || '').match(/CN=([^;:]+)/i);
    if (cnMatch?.[1]) {
        return cnMatch[1].trim().replace(/^"|"$/g, '');
    }

    const normalized = String(value || '').trim();
    const angleIndex = normalized.indexOf('<');
    if (angleIndex > 0) {
        return normalized.slice(0, angleIndex).trim().replace(/^"|"$/g, '');
    }

    return extractEmail(normalized);
}

export function formatInviteDate(value: string) {
    if (!value) return '';

    const trimmed = value.trim();
    if (/^\d{8}$/.test(trimmed)) {
        return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
    }

    const match = trimmed.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
    if (!match) {
        return trimmed;
    }

    const [, year, month, day, hour, minute, second = '00', isUtc] = match;
    const isoValue = isUtc
        ? `${year}-${month}-${day}T${hour}:${minute}:${second}Z`
        : `${year}-${month}-${day}T${hour}:${minute}:${second}`;
    const parsed = new Date(isoValue);

    if (Number.isNaN(parsed.getTime())) {
        return trimmed;
    }

    return parsed.toISOString();
}

export function parseInviteFromIcs(source: string): ParsedInvite | null {
    if (!source || !/BEGIN:VCALENDAR/i.test(source)) {
        return null;
    }

    const organizerLine = extractIcsValue(source, 'ORGANIZER');
    const parsed = {
        uid: extractIcsValue(source, 'UID') || undefined,
        summary: extractIcsValue(source, 'SUMMARY') || undefined,
        description: extractIcsValue(source, 'DESCRIPTION') || undefined,
        location: extractIcsValue(source, 'LOCATION') || undefined,
        startsAt: formatInviteDate(extractIcsValue(source, 'DTSTART')) || undefined,
        endsAt: formatInviteDate(extractIcsValue(source, 'DTEND')) || undefined,
        method: extractIcsValue(source, 'METHOD') || undefined,
        sequence: Number.parseInt(extractIcsValue(source, 'SEQUENCE') || '0', 10),
        organizerEmail: extractEmail(organizerLine) || undefined,
        organizerName: extractDisplayName(organizerLine) || undefined,
    } satisfies ParsedInvite;

    return parsed.uid || parsed.summary || parsed.organizerEmail ? parsed : null;
}

function escapeIcsText(value: string) {
    return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');
}

function formatIcsDate(value: string | Date | undefined) {
    if (!value) {
        return '';
    }

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function buildReplyIcs(options: {
    invite: ParsedInvite;
    attendeeEmail: string;
    attendeeName?: string;
    response: InviteResponseStatus;
}) {
    const attendeeName = options.attendeeName || options.attendeeEmail;
    const responseMap = {
        accepted: 'ACCEPTED',
        tentative: 'TENTATIVE',
        declined: 'DECLINED',
    } as const;
    const partstat = responseMap[options.response];
    const sequence = options.invite.sequence || 0;

    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//BloomX//Invite Reply//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:REPLY',
        'BEGIN:VEVENT',
        options.invite.uid ? `UID:${escapeIcsText(options.invite.uid)}` : '',
        `DTSTAMP:${formatIcsDate(new Date())}`,
        options.invite.startsAt ? `DTSTART:${formatIcsDate(options.invite.startsAt)}` : '',
        options.invite.endsAt ? `DTEND:${formatIcsDate(options.invite.endsAt)}` : '',
        options.invite.summary ? `SUMMARY:${escapeIcsText(options.invite.summary)}` : '',
        options.invite.description ? `DESCRIPTION:${escapeIcsText(options.invite.description)}` : '',
        options.invite.location ? `LOCATION:${escapeIcsText(options.invite.location)}` : '',
        options.invite.organizerEmail ? `ORGANIZER;CN=${escapeIcsText(options.invite.organizerName || options.invite.organizerEmail)}:mailto:${options.invite.organizerEmail}` : '',
        `ATTENDEE;CN=${escapeIcsText(attendeeName)};PARTSTAT=${partstat};ROLE=REQ-PARTICIPANT:mailto:${options.attendeeEmail}`,
        `SEQUENCE:${sequence}`,
        'END:VEVENT',
        'END:VCALENDAR',
    ].filter(Boolean).join('\r\n');
}