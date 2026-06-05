export type InviteResponseStatus = 'accepted' | 'tentative' | 'declined';

export type ParsedInvite = {
    uid?: string;
    summary?: string;
    description?: string;
    location?: string;
    meetUrl?: string;
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

// Maps Windows timezone names (used by Exchange/Outlook) to IANA timezone names.
// Source: Unicode CLDR windowsZones.xml + Microsoft timezone docs (complete as of Windows 11 / Exchange 2019).
const WINDOWS_TO_IANA: Record<string, string> = {
    'AUS Central Standard Time': 'Australia/Darwin',
    'AUS Eastern Standard Time': 'Australia/Sydney',
    'Afghanistan Standard Time': 'Asia/Kabul',
    'Alaskan Standard Time': 'America/Anchorage',
    'Altai Standard Time': 'Asia/Barnaul',
    'Arab Standard Time': 'Asia/Riyadh',
    'Arabian Standard Time': 'Asia/Dubai',
    'Arabic Standard Time': 'Asia/Baghdad',
    'Argentina Standard Time': 'America/Argentina/Buenos_Aires',
    'Astrakhan Standard Time': 'Europe/Astrakhan',
    'Atlantic Standard Time': 'America/Halifax',
    'Aus Central W. Standard Time': 'Australia/Eucla',
    'Azerbaijan Standard Time': 'Asia/Baku',
    'Azores Standard Time': 'Atlantic/Azores',
    'Bahia Standard Time': 'America/Bahia',
    'Bangladesh Standard Time': 'Asia/Dhaka',
    'Belarus Standard Time': 'Europe/Minsk',
    'Bougainville Standard Time': 'Pacific/Bougainville',
    'Canada Central Standard Time': 'America/Regina',
    'Cape Verde Standard Time': 'Atlantic/Cape_Verde',
    'Caucasus Standard Time': 'Asia/Yerevan',
    'Cen. Australia Standard Time': 'Australia/Adelaide',
    'Central America Standard Time': 'America/Guatemala',
    'Central Asia Standard Time': 'Asia/Almaty',
    'Central Brazilian Standard Time': 'America/Cuiaba',
    'Central Europe Standard Time': 'Europe/Budapest',
    'Central European Standard Time': 'Europe/Warsaw',
    'Central Pacific Standard Time': 'Pacific/Guadalcanal',
    'Central Standard Time': 'America/Chicago',
    'Central Standard Time (Mexico)': 'America/Mexico_City',
    'Chatham Islands Standard Time': 'Pacific/Chatham',
    'Chile Standard Time': 'America/Santiago',
    'China Standard Time': 'Asia/Shanghai',
    'Colombia Standard Time': 'America/Bogota',
    'Cuba Standard Time': 'America/Havana',
    'Dateline Standard Time': 'Etc/GMT+12',
    'E. Africa Standard Time': 'Africa/Nairobi',
    'E. Australia Standard Time': 'Australia/Brisbane',
    'E. Europe Standard Time': 'Asia/Nicosia',
    'E. South America Standard Time': 'America/Sao_Paulo',
    'Easter Island Standard Time': 'Pacific/Easter',
    'Eastern Standard Time': 'America/New_York',
    'Eastern Standard Time (Mexico)': 'America/Cancun',
    'Egypt Standard Time': 'Africa/Cairo',
    'Ekaterinburg Standard Time': 'Asia/Yekaterinburg',
    'FLE Standard Time': 'Europe/Kiev',
    'Fiji Standard Time': 'Pacific/Fiji',
    'GMT Standard Time': 'Europe/London',
    'GTB Standard Time': 'Europe/Bucharest',
    'Georgian Standard Time': 'Asia/Tbilisi',
    'Greenland Standard Time': 'America/Godthab',
    'Greenwich Standard Time': 'Atlantic/Reykjavik',
    'Haiti Standard Time': 'America/Port-au-Prince',
    'Hawaiian Standard Time': 'Pacific/Honolulu',
    'India Standard Time': 'Asia/Calcutta',
    'Iran Standard Time': 'Asia/Tehran',
    'Israel Standard Time': 'Asia/Jerusalem',
    'Jordan Standard Time': 'Asia/Amman',
    'Kaliningrad Standard Time': 'Europe/Kaliningrad',
    'Korea Standard Time': 'Asia/Seoul',
    'Libya Standard Time': 'Africa/Tripoli',
    'Line Islands Standard Time': 'Pacific/Kiritimati',
    'Lord Howe Standard Time': 'Australia/Lord_Howe',
    'Magadan Standard Time': 'Asia/Magadan',
    'Marquesas Standard Time': 'Pacific/Marquesas',
    'Mauritius Standard Time': 'Indian/Mauritius',
    'Mexico Standard Time': 'America/Mexico_City',
    'Mexico Standard Time 2': 'America/Chihuahua',
    'Mid-Atlantic Standard Time': 'Atlantic/South_Georgia',
    'Middle East Standard Time': 'Asia/Beirut',
    'Montevideo Standard Time': 'America/Montevideo',
    'Morocco Standard Time': 'Africa/Casablanca',
    'Mountain Standard Time': 'America/Denver',
    'Mountain Standard Time (Mexico)': 'America/Chihuahua',
    'Myanmar Standard Time': 'Asia/Rangoon',
    'N. Central Asia Standard Time': 'Asia/Novosibirsk',
    'Namibia Standard Time': 'Africa/Windhoek',
    'Nepal Standard Time': 'Asia/Katmandu',
    'New Zealand Standard Time': 'Pacific/Auckland',
    'Newfoundland Standard Time': 'America/St_Johns',
    'Norfolk Standard Time': 'Pacific/Norfolk',
    'North Asia East Standard Time': 'Asia/Irkutsk',
    'North Asia Standard Time': 'Asia/Krasnoyarsk',
    'North Korea Standard Time': 'Asia/Pyongyang',
    'Omsk Standard Time': 'Asia/Omsk',
    'Pacific SA Standard Time': 'America/Santiago',
    'Pacific Standard Time': 'America/Los_Angeles',
    'Pacific Standard Time (Mexico)': 'America/Tijuana',
    'Pakistan Standard Time': 'Asia/Karachi',
    'Paraguay Standard Time': 'America/Asuncion',
    'Qyzylorda Standard Time': 'Asia/Qyzylorda',
    'Romance Standard Time': 'Europe/Paris',
    'Russia Time Zone 1': 'Europe/Kaliningrad',
    'Russia Time Zone 10': 'Asia/Srednekolymsk',
    'Russia Time Zone 11': 'Asia/Kamchatka',
    'Russia Time Zone 3': 'Europe/Samara',
    'Russia Time Zone 9': 'Asia/Yakutsk',
    'Russian Standard Time': 'Europe/Moscow',
    'SA Eastern Standard Time': 'America/Cayenne',
    'SA Pacific Standard Time': 'America/Lima',
    'SA Western Standard Time': 'America/La_Paz',
    'SE Asia Standard Time': 'Asia/Bangkok',
    'Saint Pierre Standard Time': 'America/Miquelon',
    'Sakhalin Standard Time': 'Asia/Sakhalin',
    'Saratov Standard Time': 'Europe/Saratov',
    'Singapore Standard Time': 'Asia/Singapore',
    'South Africa Standard Time': 'Africa/Johannesburg',
    'South Sudan Standard Time': 'Africa/Juba',
    'Sri Lanka Standard Time': 'Asia/Colombo',
    'Sudan Standard Time': 'Africa/Khartoum',
    'Syria Standard Time': 'Asia/Damascus',
    'Taipei Standard Time': 'Asia/Taipei',
    'Tasmania Standard Time': 'Australia/Hobart',
    'Tocantins Standard Time': 'America/Araguaina',
    'Tokyo Standard Time': 'Asia/Tokyo',
    'Tomsk Standard Time': 'Asia/Tomsk',
    'Tonga Standard Time': 'Pacific/Tongatapu',
    'Transbaikal Standard Time': 'Asia/Chita',
    'Turkey Standard Time': 'Europe/Istanbul',
    'Turks And Caicos Standard Time': 'America/Grand_Turk',
    'US Eastern Standard Time': 'America/Indiana/Indianapolis',
    'US Mountain Standard Time': 'America/Phoenix',
    'UTC': 'UTC',
    'UTC+12': 'Etc/GMT-12',
    'UTC+13': 'Pacific/Enderbury',
    'UTC-02': 'Etc/GMT+2',
    'UTC-08': 'Etc/GMT+8',
    'UTC-09': 'Etc/GMT+9',
    'UTC-11': 'Etc/GMT+11',
    'Ulaanbaatar Standard Time': 'Asia/Ulaanbaatar',
    'Venezuela Standard Time': 'America/Caracas',
    'Vladivostok Standard Time': 'Asia/Vladivostok',
    'Volgograd Standard Time': 'Europe/Volgograd',
    'W. Australia Standard Time': 'Australia/Perth',
    'W. Central Africa Standard Time': 'Africa/Lagos',
    'W. Europe Standard Time': 'Europe/Berlin',
    'W. Mongolia Standard Time': 'Asia/Hovd',
    'West Asia Standard Time': 'Asia/Tashkent',
    'West Bank Standard Time': 'Asia/Hebron',
    'West Pacific Standard Time': 'Pacific/Port_Moresby',
    'Yakutsk Standard Time': 'Asia/Yakutsk',
    'Yukon Standard Time': 'America/Whitehorse',
};

function normalizeTimezone(tz: string | undefined): string | undefined {
    if (!tz) return tz;
    return WINDOWS_TO_IANA[tz] ?? tz;
}

function unfoldIcs(source: string) {
    return String(source || '')
        .replace(/\r?\n[ \t]/g, '')          // RFC 5545 line folding
        .replace(/=\r?\n/g, '');             // quoted-printable soft line breaks
}

function decodeQuotedPrintable(value: string, charset = 'utf-8') {
    const bytes: number[] = [];

    for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        if (char === '=' && index + 2 < value.length) {
            const hex = value.substr(index + 1, 2);
            if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
                bytes.push(parseInt(hex, 16));
                index += 2;
                continue;
            }
        }

        const code = value.charCodeAt(index);
        bytes.push(code & 0xff);
    }

    try {
        if (typeof TextDecoder !== 'undefined') {
            return new TextDecoder(charset, { fatal: false }).decode(new Uint8Array(bytes));
        }
    } catch {
        // ignore and fallback
    }

    try {
        return Buffer.from(bytes).toString(normalizeBufferEncoding(charset));
    } catch {
        return String.fromCharCode(...bytes);
    }
}

function normalizeBufferEncoding(charset: string): BufferEncoding {
    const normalized = String(charset || '').trim().toLowerCase().replace(/^"|"$/g, '');

    switch (normalized) {
        case 'utf8':
        case 'utf-8':
            return 'utf8';
        case 'utf16le':
        case 'utf-16le':
        case 'ucs2':
        case 'ucs-2':
            return 'utf16le';
        case 'latin1':
        case 'iso-8859-1':
        case 'iso8859-1':
            return 'latin1';
        case 'ascii':
            return 'ascii';
        case 'base64':
            return 'base64';
        case 'hex':
            return 'hex';
        case 'binary':
            return 'binary';
        default:
            return 'utf8';
    }
}

/**
 * When an email client applies QP encoding to an ICS MIME part it encodes every
 * literal `=` as `=3D`, including the `=` that separates ICS parameter names
 * from their values (e.g. `TZID=America/Panama` becomes `TZID=3DAmerica/Panama`).
 * Detect this by looking for `=3D` and decode the whole params string if found.
 */
function decodeIcsParams(params: string): string {
    if (!/=3[Dd]/.test(params)) return params;
    return decodeQuotedPrintable(params);
}

function decodeIcsText(value: string, params: string) {
    const normalizedParams = String(params || '').toUpperCase();
    const charsetMatch = normalizedParams.match(/CHARSET=([^;:]+)/i);
    const encodingMatch = normalizedParams.match(/ENCODING=([^;:]+)/i);
    const charset = charsetMatch?.[1]?.trim() || 'utf-8';
    const encoding = encodingMatch?.[1]?.trim().toUpperCase();

    if (encoding === 'QUOTED-PRINTABLE' || /=[0-9A-F]{2}/i.test(value)) {
        return decodeQuotedPrintable(value, charset);
    }

    return value;
}

function extractIcsDateField(source: string, key: string) {
    const unfolded = unfoldIcs(source);
    const match = unfolded.match(new RegExp(`^${key}([^:]*):(.+)$`, 'im'));
    if (!match?.[2]) {
        return null;
    }

    const params = decodeIcsParams(String(match[1] || ''));
    const value = match[2].trim();
    const tzMatch = params.match(/TZID=([^;:]+)/i);

    return {
        value,
        timeZone: normalizeTimezone(tzMatch?.[1]?.trim().replace(/^"|"$/g, '')),
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
    const match = unfolded.match(new RegExp(`^${key}([^:]*):(.+)$`, 'im'));
    if (!match?.[2]) {
        return '';
    }

    const params = decodeIcsParams(String(match[1] || ''));
    const value = match[2].trim();
    return decodeIcsText(value, params);
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
        return decodeIcsText(cnMatch[1].trim().replace(/^"|"$/g, ''), '');
    }

    const normalized = String(value || '').trim();
    const angleIndex = normalized.indexOf('<');
    if (angleIndex > 0) {
        return decodeIcsText(normalized.slice(0, angleIndex).trim().replace(/^"|"$/g, ''), '');
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
            const metadata = decodeIcsParams(separatorIndex >= 0 ? line.slice(0, separatorIndex) : line);
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

    const description = extractIcsValue(veventBlock, 'DESCRIPTION') || undefined;
    const location = extractIcsValue(veventBlock, 'LOCATION') || undefined;

    // Extract meeting join URL — prefer dedicated vendor fields, fallback to regex in description
    let meetUrl: string | undefined =
        extractIcsValue(veventBlock, 'X-MICROSOFT-SKYPETEAMSMEETINGURL') || undefined;

    if (!meetUrl) {
        const conferenceVal = extractIcsValue(veventBlock, 'CONFERENCE') || '';
        if (conferenceVal.startsWith('http')) meetUrl = conferenceVal;
    }

    if (!meetUrl && description) {
        const teamsMatch = description.match(/https:\/\/teams\.microsoft\.com\/[^\s<>\]"\\]+/);
        if (teamsMatch) meetUrl = teamsMatch[0];
    }

    if (!meetUrl && description) {
        const meetMatch = description.match(/https:\/\/meet\.google\.com\/[^\s<>\]"\\]+/);
        if (meetMatch) meetUrl = meetMatch[0];
    }

    if (!meetUrl && description) {
        const zoomMatch = description.match(/https:\/\/[a-z0-9.-]*zoom\.us\/[^\s<>\]"\\]+/);
        if (zoomMatch) meetUrl = zoomMatch[0];
    }

    const parsed = {
        uid: extractIcsValue(veventBlock, 'UID') || undefined,
        summary: extractIcsValue(veventBlock, 'SUMMARY') || undefined,
        description,
        location,
        meetUrl,
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

export function buildCancelIcs(options: {
    uid: string;
    title?: string | null;
    description?: string | null;
    location?: string | null;
    startsAt?: string | Date | null;
    endsAt?: string | Date | null;
    organizerEmail?: string | null;
    organizerName?: string | null;
    attendees?: Array<{ email: string; name?: string | null; isOrganizer?: boolean }>;
    sequence?: number;
}) {
    const toIcs = (value?: string | Date | null) =>
        value ? formatIcsDate(value instanceof Date ? value.toISOString() : String(value)) : '';

    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        `PRODID:-//${process.env.NEXT_PUBLIC_BRAND_NAME || 'Bloom'}//Calendar//EN`,
        'CALSCALE:GREGORIAN',
        'METHOD:CANCEL',
        'BEGIN:VEVENT',
        `UID:${escapeIcsText(options.uid)}`,
        `DTSTAMP:${formatIcsDate(new Date())}`,
        options.startsAt ? `DTSTART:${toIcs(options.startsAt)}` : '',
        options.endsAt ? `DTEND:${toIcs(options.endsAt)}` : '',
        options.title ? `SUMMARY:${escapeIcsText(options.title)}` : '',
        options.description ? `DESCRIPTION:${escapeIcsText(options.description)}` : '',
        options.location ? `LOCATION:${escapeIcsText(options.location)}` : '',
        options.organizerEmail
            ? `ORGANIZER;CN=${escapeIcsText(options.organizerName || options.organizerEmail)}:mailto:${options.organizerEmail}`
            : '',
        `SEQUENCE:${Number.isFinite(options.sequence) ? options.sequence : 0}`,
        'STATUS:CANCELLED',
    ];

    (options.attendees || []).forEach((attendee) => {
        if (!attendee.email || attendee.isOrganizer) return;
        lines.push(
            `ATTENDEE;CN=${escapeIcsText(attendee.name || attendee.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION:mailto:${attendee.email}`
        );
    });

    lines.push('END:VEVENT', 'END:VCALENDAR');
    return lines.filter(Boolean).join('\r\n');
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
        `PRODID:-//${process.env.NEXT_PUBLIC_BRAND_NAME || 'Bloom'}//Calendar//EN`,
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