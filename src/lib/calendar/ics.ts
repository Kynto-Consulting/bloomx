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
    attendees?: Array<{
        email: string;
        name?: string;
        responseStatus?: 'accepted' | 'tentative' | 'declined' | 'needsAction';
        isOrganizer?: boolean;
    }>;
};

function unfoldIcs(source: string) {
    return String(source || '')
        .replace(/\r?\n[ \t]/g, '')          // RFC 5545 line folding
        .replace(/=\r?\n/g, '')              // quoted-printable soft line breaks
        .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))); // quoted-printable encoded chars (e.g. =3D → =)
}

function extractIcsDateField(source: string, key: string) {
    const unfolded = unfoldIcs(source);
    const match = unfolded.match(new RegExp(`^${key}([^:]*):(.+)$`, 'im'));
    if (!match?.[2]) {
        return null;
    }

    const params = String(match[1] || '');
    const value = match[2].trim();
    const tzMatch = params.match(/TZID=([^;:]+)/i);

    return {
        value,
        timeZone: tzMatch?.[1]?.trim().replace(/^"|"$/g, ''),
    };
}

function parseIcsLocalDateParts(value: string) {
    const match = String(value || '').trim().match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?$/);
    if (!match) {
        return null;
    }

    return {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
        hour: Number(match[4]),
        minute: Number(match[5]),
        second: Number(match[6] || '0'),
    };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });

    const parts = formatter.formatToParts(date);
    const year = Number(parts.find((part) => part.type === 'year')?.value || '0');
    const month = Number(parts.find((part) => part.type === 'month')?.value || '1');
    const day = Number(parts.find((part) => part.type === 'day')?.value || '1');
    const hour = Number(parts.find((part) => part.type === 'hour')?.value || '0');
    const minute = Number(parts.find((part) => part.type === 'minute')?.value || '0');
    const second = Number(parts.find((part) => part.type === 'second')?.value || '0');

    const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    return asUtc - date.getTime();
}

function toDateInTimeZone(parts: ReturnType<typeof parseIcsLocalDateParts>, timeZone: string) {
    if (!parts) {
        return null;
    }

    try {
        new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    } catch {
        return null;
    }

    const guess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
    const firstOffset = getTimeZoneOffsetMs(guess, timeZone);
    const firstPass = new Date(guess.getTime() - firstOffset);
    const secondOffset = getTimeZoneOffsetMs(firstPass, timeZone);
    const parsed = new Date(guess.getTime() - secondOffset);

    return Number.isNaN(parsed.getTime()) ? null : parsed;
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

export function formatInviteDate(value: string, timeZone?: string) {
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

    if (!isUtc && timeZone) {
        const zoned = toDateInTimeZone(parseIcsLocalDateParts(trimmed), timeZone);
        if (zoned) {
            return zoned.toISOString();
        }
    }

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

    const unfolded = unfoldIcs(source);

    // Scope field extraction to VEVENT to avoid matching fields in VTIMEZONE or other components
    // (e.g. VTIMEZONE has its own DTSTART:19700101T000000 which would shadow the real event date)
    const veventMatch = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/i);
    const veventBlock = veventMatch?.[0] || unfolded;

    const attendeeLines = veventBlock
        .split(/\r?\n/)
        .filter((line) => /^ATTENDEE/i.test(line));

    const attendees = attendeeLines
        .map((line) => {
            const separatorIndex = line.indexOf(':');
            const metadata = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line;
            const value = separatorIndex >= 0 ? line.slice(separatorIndex + 1) : '';

            const email = extractEmail(value);
            if (!email) {
                return null;
            }

            const cnMatch = metadata.match(/CN=([^;:]+)/i);
            const rawPartstat = metadata.match(/PARTSTAT=([^;:]+)/i)?.[1]?.toUpperCase();
            const responseStatus = rawPartstat === 'ACCEPTED'
                ? 'accepted'
                : rawPartstat === 'DECLINED'
                    ? 'declined'
                    : rawPartstat === 'TENTATIVE'
                        ? 'tentative'
                        : 'needsAction';

            return {
                email,
                name: cnMatch?.[1]?.trim().replace(/^"|"$/g, '') || extractDisplayName(value),
                responseStatus,
                isOrganizer: /ROLE=CHAIR/i.test(metadata),
            };
        })
        .filter(Boolean) as ParsedInvite['attendees'];

    const organizerLine = extractIcsValue(veventBlock, 'ORGANIZER');
    const startsAtField = extractIcsDateField(veventBlock, 'DTSTART');
    const endsAtField = extractIcsDateField(veventBlock, 'DTEND');

    const parsed = {
        uid: extractIcsValue(veventBlock, 'UID') || undefined,
        summary: extractIcsValue(veventBlock, 'SUMMARY') || undefined,
        description: extractIcsValue(veventBlock, 'DESCRIPTION') || undefined,
        location: extractIcsValue(veventBlock, 'LOCATION') || undefined,
        startsAt: formatInviteDate(startsAtField?.value || '', startsAtField?.timeZone) || undefined,
        endsAt: formatInviteDate(endsAtField?.value || '', endsAtField?.timeZone) || undefined,
        method: (extractIcsValue(source, 'METHOD') || '').toUpperCase() || undefined,
        sequence: Number.parseInt(extractIcsValue(veventBlock, 'SEQUENCE') || '0', 10),
        organizerEmail: extractEmail(organizerLine) || undefined,
        organizerName: extractDisplayName(organizerLine) || undefined,
        attendees,
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