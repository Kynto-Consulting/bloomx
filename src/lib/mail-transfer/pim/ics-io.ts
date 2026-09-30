/**
 * ics-io.ts - lector/escritor iCalendar (.ics) para IMPORTAR/EXPORTAR calendarios (Google Takeout, Apple, Outlook).
 *
 * Entrada NO CONFIABLE: puro, sin E/S, sin lanzar por basura y con limites (bytes, eventos, asistentes, longitudes).
 *
 * Zonas horarias (DTSTART;TZID=...):
 *  1. nombre IANA valido (Intl) -> conversion exacta incluyendo DST;
 *  2. rutas estilo "/freeassociation.sourceforge.net/Europe/Madrid" -> sufijo IANA;
 *  3. nombres de Windows/Outlook ("Romance Standard Time") -> tabla WINDOWS_TO_IANA;
 *  4. VTIMEZONE del propio archivo (X-LIC-LOCATION IANA, o reglas STANDARD/DAYLIGHT con RRULE anual);
 *  5. si nada sirve: UTC y se anota `tzid_desconocido:<TZID>` en `warnings`.
 * Hora flotante: zona X-WR-TIMEZONE del calendario, o `defaultTimeZone`, o UTC.
 * Los EXDATE/RDATE y el UNTIL del RRULE se normalizan a UTC (`...Z`) o a fecha (dia completo) al leer.
 */
import { createHash } from 'node:crypto';
import { escapeIcsText, foldIcsLine, sanitizeIcsLine } from '@/lib/calendar/ics-build';
import { findMeetingUrlInText, safeConferenceUrl } from '@/lib/conferencing/hosts';

export type PimEventStatus = 'confirmed' | 'tentative' | 'cancelled';
export type PimResponse = 'accepted' | 'declined' | 'tentative' | 'needsAction';

export interface PimAttendee {
    email: string;
    name: string | null;
    responseStatus: PimResponse | null;
    isOrganizer: boolean;
}

export interface PimEvent {
    uid: string;
    title: string;
    description: string | null;
    location: string | null;
    startsAt: Date;
    /** Para dia completo: fin EXCLUSIVO (medianoche UTC del dia siguiente al ultimo), como en iCalendar. */
    endsAt: Date;
    allDay: boolean;
    status: PimEventStatus;
    organizerEmail: string | null;
    organizerName: string | null;
    attendees: PimAttendee[];
    /** Texto RRULE sin prefijo (UNTIL normalizado a UTC/fecha). */
    rrule: string | null;
    /** Lineas `EXDATE:..`/`RDATE:..` normalizadas (valores UTC `YYYYMMDDTHHMMSSZ` o fechas con `;VALUE=DATE`). */
    recurrenceExtra: string[];
    /** Zona IANA resuelta del DTSTART (o el TZID original si solo se pudo resolver por VTIMEZONE). */
    tzid: string | null;
    conferenceUrl?: string | null;
    /** Excepcion de una serie (RECURRENCE-ID): instante de la ocurrencia que reemplaza. */
    recurrenceId?: Date | null;
}

/** Forma aceptada por el exportador (campos opcionales con valores por defecto). */
export type PimEventOut = Pick<PimEvent, 'uid' | 'title' | 'startsAt' | 'endsAt'> & Partial<Omit<PimEvent, 'uid' | 'title' | 'startsAt' | 'endsAt'>>;

export interface IcsLimits {
    maxBytes: number;
    maxEvents: number;
    maxAttendees: number;
    maxDescription: number;
    maxTitle: number;
    maxLocation: number;
    /** Zona IANA para horas flotantes cuando el calendario no declara X-WR-TIMEZONE. */
    defaultTimeZone?: string;
}

export const DEFAULT_ICS_LIMITS: IcsLimits = {
    maxBytes: 64 * 1024 * 1024,
    maxEvents: 50_000,
    maxAttendees: 500,
    maxDescription: 100_000,
    maxTitle: 500,
    maxLocation: 1_000,
};

export interface IcsParseResult {
    events: PimEvent[];
    invalid: number;
    calendarName: string | null;
    warnings: string[];
    truncated: boolean;
}

const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Zonas horarias
// ---------------------------------------------------------------------------

const dtfCache = new Map<string, Intl.DateTimeFormat | null>();

function dtf(tz: string): Intl.DateTimeFormat | null {
    if (dtfCache.has(tz)) return dtfCache.get(tz)!;
    let f: Intl.DateTimeFormat | null = null;
    try {
        f = new Intl.DateTimeFormat('en-US', {
            timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
    } catch { f = null; }
    if (dtfCache.size > 300) dtfCache.clear();
    dtfCache.set(tz, f);
    return f;
}

export function isIanaZone(tz: string): boolean {
    return /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/.test(tz) && dtf(tz) !== null;
}

/** Desfase (ms) de la zona IANA en el instante UTC dado. */
export function ianaOffsetMs(tz: string, utcMs: number): number {
    const f = dtf(tz);
    if (!f) return 0;
    const p: Record<string, number> = {};
    for (const part of f.formatToParts(new Date(utcMs))) if (part.type !== 'literal') p[part.type] = Number(part.value);
    const h = p.hour === 24 ? 0 : p.hour;
    return Date.UTC(p.year, p.month - 1, p.day, h, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
}

/** Hora local "ingenua" (ms como si fuera UTC) -> instante UTC real, tratando huecos/solapes de DST. */
export function localToUtc(naiveMs: number, offsetAt: (utcMs: number) => number): number {
    const o1 = offsetAt(naiveMs);
    let u = naiveMs - o1;
    const o2 = offsetAt(u);
    if (o2 !== o1) u = naiveMs - o2;
    return u;
}

/** Windows/Outlook -> IANA (las mas comunes; territorio "001"). */
export const WINDOWS_TO_IANA: Record<string, string> = {
    'UTC': 'UTC', 'Coordinated Universal Time': 'UTC', 'GMT Standard Time': 'Europe/London', 'Greenwich Standard Time': 'Atlantic/Reykjavik',
    'W. Europe Standard Time': 'Europe/Berlin', 'Central Europe Standard Time': 'Europe/Budapest', 'Central European Standard Time': 'Europe/Warsaw',
    'Romance Standard Time': 'Europe/Paris', 'E. Europe Standard Time': 'Europe/Chisinau', 'GTB Standard Time': 'Europe/Bucharest',
    'FLE Standard Time': 'Europe/Kiev', 'Russian Standard Time': 'Europe/Moscow', 'Turkey Standard Time': 'Europe/Istanbul',
    'Israel Standard Time': 'Asia/Jerusalem', 'Egypt Standard Time': 'Africa/Cairo', 'South Africa Standard Time': 'Africa/Johannesburg',
    'W. Central Africa Standard Time': 'Africa/Lagos', 'E. Africa Standard Time': 'Africa/Nairobi', 'Morocco Standard Time': 'Africa/Casablanca',
    'Arab Standard Time': 'Asia/Riyadh', 'Arabian Standard Time': 'Asia/Dubai', 'Arabic Standard Time': 'Asia/Baghdad', 'Iran Standard Time': 'Asia/Tehran',
    'Pakistan Standard Time': 'Asia/Karachi', 'India Standard Time': 'Asia/Kolkata', 'Sri Lanka Standard Time': 'Asia/Colombo',
    'Bangladesh Standard Time': 'Asia/Dhaka', 'SE Asia Standard Time': 'Asia/Bangkok', 'China Standard Time': 'Asia/Shanghai',
    'Singapore Standard Time': 'Asia/Singapore', 'Taipei Standard Time': 'Asia/Taipei', 'W. Australia Standard Time': 'Australia/Perth',
    'Tokyo Standard Time': 'Asia/Tokyo', 'Korea Standard Time': 'Asia/Seoul', 'AUS Eastern Standard Time': 'Australia/Sydney',
    'E. Australia Standard Time': 'Australia/Brisbane', 'Cen. Australia Standard Time': 'Australia/Adelaide', 'AUS Central Standard Time': 'Australia/Darwin',
    'Tasmania Standard Time': 'Australia/Hobart', 'New Zealand Standard Time': 'Pacific/Auckland', 'Hawaiian Standard Time': 'Pacific/Honolulu',
    'Alaskan Standard Time': 'America/Anchorage', 'Pacific Standard Time': 'America/Los_Angeles', 'Pacific Standard Time (Mexico)': 'America/Tijuana',
    'US Mountain Standard Time': 'America/Phoenix', 'Mountain Standard Time': 'America/Denver', 'Central Standard Time': 'America/Chicago',
    'Central Standard Time (Mexico)': 'America/Mexico_City', 'Canada Central Standard Time': 'America/Regina', 'Eastern Standard Time': 'America/New_York',
    'US Eastern Standard Time': 'America/Indianapolis', 'SA Pacific Standard Time': 'America/Bogota', 'Atlantic Standard Time': 'America/Halifax',
    'Newfoundland Standard Time': 'America/St_Johns', 'SA Western Standard Time': 'America/La_Paz', 'Venezuela Standard Time': 'America/Caracas',
    'Pacific SA Standard Time': 'America/Santiago', 'E. South America Standard Time': 'America/Sao_Paulo', 'Argentina Standard Time': 'America/Buenos_Aires',
    'SA Eastern Standard Time': 'America/Cayenne', 'Montevideo Standard Time': 'America/Montevideo', 'Paraguay Standard Time': 'America/Asuncion',
    'Central America Standard Time': 'America/Guatemala', 'Mountain Standard Time (Mexico)': 'America/Chihuahua', 'Greenland Standard Time': 'America/Godthab',
    'Azores Standard Time': 'Atlantic/Azores', 'Cape Verde Standard Time': 'Atlantic/Cape_Verde', 'Central Asia Standard Time': 'Asia/Almaty',
    'West Asia Standard Time': 'Asia/Tashkent', 'Nepal Standard Time': 'Asia/Katmandu', 'Myanmar Standard Time': 'Asia/Rangoon',
    'North Asia East Standard Time': 'Asia/Irkutsk', 'Yakutsk Standard Time': 'Asia/Yakutsk', 'Vladivostok Standard Time': 'Asia/Vladivostok',
    'Fiji Standard Time': 'Pacific/Fiji', 'Samoa Standard Time': 'Pacific/Apia', 'Dateline Standard Time': 'Etc/GMT+12',
};

const WIN_LOWER = new Map(Object.entries(WINDOWS_TO_IANA).map(([k, v]) => [k.toLowerCase(), v]));

export interface Zone {
    /** Nombre IANA si lo hay; si no, el TZID original. */
    name: string;
    iana: boolean;
    offsetAt(utcMs: number): number;
}

function ianaZone(name: string): Zone {
    return { name, iana: true, offsetAt: (t) => ianaOffsetMs(name, t) };
}

/** Resuelve un TZID solo por IANA / ruta / tabla de Windows (sin VTIMEZONE). */
export function resolveIana(tzid: string): string | null {
    const t = String(tzid || '').trim().replace(/^"|"$/g, '');
    if (!t) return null;
    if (isIanaZone(t)) return t;
    const win = WIN_LOWER.get(t.toLowerCase());
    if (win && isIanaZone(win)) return win;
    // Rutas "/mozilla.org/20050126_1/Europe/Madrid", "/freeassociation.sourceforge.net/Tzfile/Europe/Madrid"
    if (t.includes('/')) {
        const segs = t.split('/').filter(Boolean);
        for (const n of [3, 2, 1]) {
            if (segs.length < n) continue;
            const cand = segs.slice(-n).join('/');
            if (n > 1 && isIanaZone(cand)) return cand;
        }
    }
    return null;
}

// --- VTIMEZONE (reglas) ---

interface VtzComp {
    from: number;
    to: number;
    startNaive: number;
    yearly: { month: number; ord: number; dow: number; monthDay: number | null } | null;
    untilNaive: number | null;
    rdates: number[];
}

const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function dim(y: number, m0: number): number {
    return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

/** Dia del mes (1..n) del n-esimo `dow` del mes (ord<0 = desde el final); null si no existe. */
function nthDow(y: number, m0: number, dow: number, ord: number): number | null {
    const n = dim(y, m0);
    if (ord > 0) {
        const first = new Date(Date.UTC(y, m0, 1)).getUTCDay();
        const d = 1 + ((dow - first + 7) % 7) + (ord - 1) * 7;
        return d <= n ? d : null;
    }
    const last = new Date(Date.UTC(y, m0, n)).getUTCDay();
    const d = n - ((last - dow + 7) % 7) + (ord + 1) * 7;
    return d >= 1 ? d : null;
}

function parseOffset(v: string): number | null {
    const m = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(String(v).trim());
    if (!m) return null;
    return (m[1] === '-' ? -1 : 1) * ((Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4] ?? 0)) * 1000);
}

function vtzZone(node: Node, tzid: string): Zone | null {
    const loc = (propOf(node, 'X-LIC-LOCATION')?.value ?? '').trim();
    if (loc && isIanaZone(loc)) return ianaZone(loc);
    const comps: VtzComp[] = [];
    for (const k of node.kids) {
        if (k.name !== 'STANDARD' && k.name !== 'DAYLIGHT') continue;
        const from = parseOffset(propOf(k, 'TZOFFSETFROM')?.value ?? '');
        const to = parseOffset(propOf(k, 'TZOFFSETTO')?.value ?? '');
        const ds = parseNaive(propOf(k, 'DTSTART')?.value ?? '');
        if (from === null || to === null || ds === null) continue;
        const comp: VtzComp = { from, to, startNaive: ds, yearly: null, untilNaive: null, rdates: [] };
        const rr = propOf(k, 'RRULE')?.value;
        if (rr) {
            const r = parseRruleParts(rr);
            if (r && r.FREQ === 'YEARLY') {
                const month = Number(r.BYMONTH) - 1;
                const bd = /^(-?\d)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(r.BYDAY ?? '');
                const md = r.BYMONTHDAY ? Number(r.BYMONTHDAY) : null;
                if (month >= 0 && month < 12 && (bd?.[1] || md !== null)) {
                    comp.yearly = { month, ord: bd?.[1] ? Number(bd[1]) : 0, dow: bd ? DOW.indexOf(bd[2]) : 0, monthDay: md };
                }
                const u = r.UNTIL ? parseNaive(r.UNTIL.replace(/Z$/, '')) : null;
                if (u !== null) comp.untilNaive = u;
            }
        }
        for (const rd of k.props.filter((p) => p.name === 'RDATE')) {
            for (const v of rd.value.split(',')) { const n = parseNaive(v); if (n !== null) comp.rdates.push(n); }
        }
        comps.push(comp);
    }
    if (!comps.length) return null;
    const transitions = (year: number): Array<{ utc: number; to: number }> => {
        const out: Array<{ utc: number; to: number }> = [];
        for (const c of comps) {
            const tod = c.startNaive - Math.floor(c.startNaive / DAY) * DAY;
            const startYear = new Date(c.startNaive).getUTCFullYear();
            if (c.startNaive >= 0) out.push({ utc: c.startNaive - c.from, to: c.to });
            for (const r of c.rdates) out.push({ utc: r - c.from, to: c.to });
            if (c.yearly && year >= startYear) {
                const y = c.yearly;
                const d = y.ord ? nthDow(year, y.month, y.dow, y.ord) : (y.monthDay && y.monthDay > 0 && y.monthDay <= dim(year, y.month) ? y.monthDay : null);
                if (d) {
                    const naive = Date.UTC(year, y.month, d) + tod;
                    if (c.untilNaive === null || naive <= c.untilNaive) out.push({ utc: naive - c.from, to: c.to });
                }
            }
        }
        return out;
    };
    const first = comps.reduce((a, b) => (a.startNaive <= b.startNaive ? a : b));
    return {
        name: tzid,
        iana: false,
        offsetAt(t: number) {
            const y = new Date(t).getUTCFullYear();
            let best: { utc: number; to: number } | null = null;
            for (const yy of [y - 1, y]) for (const tr of transitions(yy)) if (tr.utc <= t && (!best || tr.utc > best.utc)) best = tr;
            return best ? best.to : first.from;
        },
    };
}

function parseNaive(v: string): number | null {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?Z?$/.exec(String(v).trim());
    if (!m) return null;
    return validNaive(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
}

function validNaive(y: number, mo: number, d: number, h: number, mi: number, s: number): number | null {
    if (y < 1900 || y > 2999 || mo < 1 || mo > 12 || d < 1 || d > dim(y, mo - 1) || h > 23 || mi > 59 || s > 60) return null;
    return Date.UTC(y, mo - 1, d, h, mi, Math.min(s, 59));
}

// ---------------------------------------------------------------------------
// Arbol de contenido ICS
// ---------------------------------------------------------------------------

interface P { name: string; params: Record<string, string>; value: string }
interface Node { name: string; props: P[]; kids: Node[] }

function propOf(n: Node, name: string): P | undefined {
    return n.props.find((p) => p.name === name);
}

function propsOf(n: Node, name: string): P[] {
    return n.props.filter((p) => p.name === name);
}

function decodeIcsBytes(buf: Buffer): string {
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
    if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
        const sw = Buffer.from(buf.subarray(2));
        sw.swap16();
        return sw.toString('utf16le');
    }
    const start = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0;
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(start));
    } catch {
        return buf.toString('latin1', start);
    }
}

function parseContentLine(line: string): P | null {
    let inQ = false;
    let colon = -1;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') inQ = !inQ;
        else if (c === ':' && !inQ) { colon = i; break; }
    }
    if (colon <= 0) return null;
    const head = line.slice(0, colon);
    const parts: string[] = [];
    let cur = '';
    inQ = false;
    for (const c of head) {
        if (c === '"') { inQ = !inQ; cur += c; } else if (c === ';' && !inQ) { parts.push(cur); cur = ''; } else cur += c;
    }
    parts.push(cur);
    const name = parts[0].trim().toUpperCase();
    if (!/^[A-Z0-9-]{1,60}$/.test(name)) return null;
    const params: Record<string, string> = Object.create(null);
    for (const p of parts.slice(1)) {
        const eq = p.indexOf('=');
        if (eq <= 0) continue;
        const k = p.slice(0, eq).trim().toUpperCase();
        if (!(k in params)) params[k] = p.slice(eq + 1).trim().replace(/^"|"$/g, '');
    }
    return { name, params, value: line.slice(colon + 1) };
}

function unescapeText(s: string): string {
    return s.replace(/\\([nN,;\\])/g, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

function buildTree(text: string, maxEvents: number): { root: Node; truncated: boolean } {
    const root: Node = { name: 'ROOT', props: [], kids: [] };
    const stack: Node[] = [root];
    let events = 0;
    let truncated = false;
    const lines: string[] = [];
    for (const l of text.replace(/\r\n?/g, '\n').split('\n')) {
        if ((l[0] === ' ' || l[0] === '\t') && lines.length) {
            if (lines[lines.length - 1].length < 200_000) lines[lines.length - 1] += l.slice(1);
        } else lines.push(l);
    }
    let skipDepth = 0; // >0 = ignorando un VEVENT por limite
    for (const line of lines) {
        if (!line) continue;
        const up = line.slice(0, 40).toUpperCase();
        if (up.startsWith('BEGIN:')) {
            const nm = line.slice(6).trim().toUpperCase().slice(0, 40);
            if (skipDepth > 0) { skipDepth++; continue; }
            if (nm === 'VEVENT' && events >= maxEvents) { truncated = true; skipDepth = 1; continue; }
            if (stack.length >= 8) continue;
            if (nm === 'VEVENT') events++;
            const node: Node = { name: nm, props: [], kids: [] };
            stack[stack.length - 1].kids.push(node);
            stack.push(node);
            continue;
        }
        if (up.startsWith('END:')) {
            if (skipDepth > 0) { skipDepth--; continue; }
            const nm = line.slice(4).trim().toUpperCase();
            for (let i = stack.length - 1; i >= 1; i--) {
                if (stack[i].name === nm) { stack.length = i; break; }
            }
            continue;
        }
        if (skipDepth > 0) continue;
        const top = stack[stack.length - 1];
        if (top.props.length > 5000) continue;
        const p = parseContentLine(line.length > 200_000 ? line.slice(0, 200_000) : line);
        if (p) top.props.push(p);
    }
    return { root, truncated };
}

// ---------------------------------------------------------------------------
// RRULE
// ---------------------------------------------------------------------------

function parseRruleParts(text: string): Record<string, string> | null {
    const t = String(text).trim().replace(/^RRULE:/i, '');
    if (!t || t.length > 600) return null;
    const out: Record<string, string> = Object.create(null);
    for (const seg of t.split(';')) {
        if (!seg) continue;
        const eq = seg.indexOf('=');
        if (eq <= 0) return null;
        out[seg.slice(0, eq).trim().toUpperCase()] = seg.slice(eq + 1).trim().toUpperCase();
    }
    return out.FREQ ? out : null;
}

function fmt2(n: number): string { return String(n).padStart(2, '0'); }
function fmtDate(ms: number): string { const d = new Date(ms); return `${String(d.getUTCFullYear()).padStart(4, '0')}${fmt2(d.getUTCMonth() + 1)}${fmt2(d.getUTCDate())}`; }
function fmtDateTime(ms: number): string { const d = new Date(ms); return `${fmtDate(ms)}T${fmt2(d.getUTCHours())}${fmt2(d.getUTCMinutes())}${fmt2(d.getUTCSeconds())}`; }
function fmtUtc(ms: number): string { return `${fmtDateTime(ms)}Z`; }

/** Normaliza el texto RRULE (claves en mayusculas, UNTIL en UTC o fecha). null si no es utilizable. */
function normalizeRrule(raw: string, zone: Zone | null, allDay: boolean): string | null {
    const parts = parseRruleParts(raw);
    if (!parts) return null;
    const segs: string[] = [];
    for (const [k, v] of Object.entries(parts)) {
        if (!/^[A-Z0-9-]{1,20}$/.test(k) || !/^[A-Z0-9,+\-]*$/.test(v)) return null;
        if (k === 'UNTIL') {
            if (/^\d{8}T\d{6}Z$/.test(v)) segs.push(`UNTIL=${v}`);
            else if (/^\d{8}T\d{6}$/.test(v)) {
                const n = parseNaive(v);
                if (n === null) return null;
                segs.push(`UNTIL=${allDay ? fmtDate(n) : fmtUtc(zone ? localToUtc(n, zone.offsetAt) : n)}`);
            } else if (/^\d{8}$/.test(v)) {
                const n = parseNaive(v);
                if (n === null) return null;
                segs.push(allDay ? `UNTIL=${v}` : `UNTIL=${fmtUtc(zone ? localToUtc(n + DAY - 1000, zone.offsetAt) : n + DAY - 1000)}`);
            } else return null;
        } else segs.push(`${k}=${v}`);
    }
    return segs.join(';');
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

interface Ctx {
    vtz: Map<string, Node>;
    zones: Map<string, Zone | null>;
    warnings: Set<string>;
    defaultZone: Zone | null;
}

function zoneFor(ctx: Ctx, tzid: string): Zone | null {
    const key = tzid.trim();
    if (ctx.zones.has(key)) return ctx.zones.get(key)!;
    let z: Zone | null = null;
    const iana = resolveIana(key);
    if (iana) z = ianaZone(iana);
    else {
        const node = ctx.vtz.get(key) ?? ctx.vtz.get(key.toLowerCase());
        if (node) z = vtzZone(node, key);
    }
    if (!z && ctx.warnings.size < 50) ctx.warnings.add(`tzid_desconocido:${key.slice(0, 80)}`);
    ctx.zones.set(key, z);
    return z;
}

interface DateVal { kind: 'date' | 'utc' | 'zoned' | 'floating'; ms: number; zone: Zone | null }

function parseDateProp(p: P, ctx: Ctx, rawValue?: string): DateVal | null {
    const v = (rawValue ?? p.value).trim();
    const dm = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
    if (dm) {
        const n = validNaive(Number(dm[1]), Number(dm[2]), Number(dm[3]), 0, 0, 0);
        return n === null ? null : { kind: 'date', ms: n, zone: null };
    }
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)$/i.exec(v);
    if (!m) return null;
    const n = validNaive(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
    if (n === null) return null;
    if (m[7]) return { kind: 'utc', ms: n, zone: null };
    const tzid = p.params.TZID;
    if (tzid) {
        const z = zoneFor(ctx, tzid);
        return z ? { kind: 'zoned', ms: localToUtc(n, z.offsetAt), zone: z } : { kind: 'utc', ms: n, zone: null };
    }
    if (ctx.defaultZone) return { kind: 'floating', ms: localToUtc(n, ctx.defaultZone.offsetAt), zone: ctx.defaultZone };
    return { kind: 'floating', ms: n, zone: null };
}

function parseDuration(v: string): number | null {
    const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(v.trim());
    if (!m || v.trim().replace(/[+-]?P/i, '') === '') return null;
    const ms = (Number(m[2] ?? 0) * 7 * 24 * 3600 + Number(m[3] ?? 0) * 24 * 3600 + Number(m[4] ?? 0) * 3600 + Number(m[5] ?? 0) * 60 + Number(m[6] ?? 0)) * 1000;
    return m[1] === '-' ? -ms : ms;
}

const EMAIL_OK = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,255}$/;

function mailtoOf(value: string): string | null {
    const v = value.trim().replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
    return v.length <= 254 && EMAIL_OK.test(v) ? v : null;
}

function cap(s: string, n: number): string { return s.length > n ? s.slice(0, n) : s; }

function eventFromNode(n: Node, ctx: Ctx, lim: IcsLimits): PimEvent | null {
    const ds = propOf(n, 'DTSTART');
    if (!ds) return null;
    const start = parseDateProp(ds, ctx);
    if (!start) return null;
    const allDay = start.kind === 'date';
    let endMs: number | null = null;
    const de = propOf(n, 'DTEND') ?? propOf(n, 'DUE');
    if (de) {
        const e = parseDateProp(de, ctx);
        if (e) endMs = e.ms;
    }
    if (endMs === null) {
        const du = propOf(n, 'DURATION');
        const d = du ? parseDuration(du.value) : null;
        if (d !== null) endMs = start.ms + d;
    }
    if (endMs === null) endMs = allDay ? start.ms + DAY : start.ms;
    if (endMs < start.ms) endMs = allDay ? start.ms + DAY : start.ms;
    if (allDay && endMs <= start.ms) endMs = start.ms + DAY;

    const title = cap(unescapeText(propOf(n, 'SUMMARY')?.value ?? '').replace(/\s+/g, ' ').trim(), lim.maxTitle) || '(sin titulo)';
    const descRaw = propOf(n, 'DESCRIPTION')?.value;
    const description = descRaw ? cap(unescapeText(descRaw).replace(/\r/g, '').trim(), lim.maxDescription) || null : null;
    const locRaw = propOf(n, 'LOCATION')?.value;
    const location = locRaw ? cap(unescapeText(locRaw).replace(/\s+/g, ' ').trim(), lim.maxLocation) || null : null;

    const st = (propOf(n, 'STATUS')?.value ?? '').trim().toUpperCase();
    const status: PimEventStatus = st === 'CANCELLED' ? 'cancelled' : st === 'TENTATIVE' ? 'tentative' : 'confirmed';

    let organizerEmail: string | null = null;
    let organizerName: string | null = null;
    const org = propOf(n, 'ORGANIZER');
    if (org) {
        organizerEmail = mailtoOf(org.value) ?? (org.params.EMAIL ? mailtoOf(org.params.EMAIL) : null);
        organizerName = org.params.CN ? cap(unescapeText(org.params.CN).trim(), 200) || null : null;
    }
    const attendees: PimAttendee[] = [];
    const seen = new Set<string>();
    for (const a of propsOf(n, 'ATTENDEE')) {
        if (attendees.length >= lim.maxAttendees) break;
        const email = mailtoOf(a.value) ?? (a.params.EMAIL ? mailtoOf(a.params.EMAIL) : null);
        if (!email || seen.has(email)) continue;
        seen.add(email);
        const ps = (a.params.PARTSTAT ?? '').toUpperCase();
        const responseStatus: PimResponse = ps === 'ACCEPTED' ? 'accepted' : ps === 'DECLINED' ? 'declined' : ps === 'TENTATIVE' ? 'tentative' : 'needsAction';
        attendees.push({
            email,
            name: a.params.CN ? cap(unescapeText(a.params.CN).trim(), 200) || null : null,
            responseStatus,
            isOrganizer: email === organizerEmail || (a.params.ROLE ?? '').toUpperCase() === 'CHAIR',
        });
    }

    // Zona del evento
    let tzid: string | null = null;
    if (start.zone) tzid = start.zone.name;
    const zoneForRules = start.zone;

    // Recurrencia
    let rrule: string | null = null;
    const rr = propOf(n, 'RRULE');
    if (rr) rrule = normalizeRrule(rr.value, zoneForRules, allDay);
    const recurrenceExtra: string[] = [];
    for (const kind of ['EXDATE', 'RDATE'] as const) {
        for (const p of propsOf(n, kind)) {
            const vals: string[] = [];
            let dateOnly = false;
            for (const raw of p.value.split(',').slice(0, 1000)) {
                if (raw.includes('/')) { ctx.warnings.add('rdate_periodo_omitido'); continue; }
                const d = parseDateProp(p, ctx, raw);
                if (!d) continue;
                if (d.kind === 'date') { dateOnly = true; vals.push(fmtDate(d.ms)); } else {
                    let ms = d.ms;
                    // EXDATE flotante/sin TZID en evento con zona: se interpreta en la zona del evento
                    if (d.kind === 'floating' && !p.params.TZID && zoneForRules) ms = localToUtc(d.ms, zoneForRules.offsetAt);
                    vals.push(fmtUtc(ms));
                }
            }
            if (vals.length && recurrenceExtra.length < 2000) recurrenceExtra.push(`${kind}${dateOnly ? ';VALUE=DATE' : ''}:${vals.join(',')}`);
        }
    }

    // Conferencia
    let conferenceUrl: string | null = null;
    for (const pn of ['X-GOOGLE-CONFERENCE', 'CONFERENCE', 'X-MICROSOFT-SKYPETEAMSMEETINGURL', 'X-MICROSOFT-ONLINEMEETINGEXTERNALLINK']) {
        const p = propOf(n, pn);
        const u = p ? safeConferenceUrl(p.value.trim()) : null;
        if (u) { conferenceUrl = u; break; }
    }
    if (!conferenceUrl) conferenceUrl = findMeetingUrlInText(location) ?? findMeetingUrlInText(description);

    let recurrenceId: Date | null = null;
    const rid = propOf(n, 'RECURRENCE-ID');
    if (rid) {
        const r = parseDateProp(rid, ctx);
        if (r) recurrenceId = new Date(r.ms);
    }

    const uidRaw = (propOf(n, 'UID')?.value ?? '').trim().replace(/[\u0000-\u001f]/g, '');
    const uid = cap(uidRaw, 255)
        || `${createHash('sha1').update(`${title}|${start.ms}|${location ?? ''}`).digest('hex').slice(0, 24)}@import.local`;

    return {
        uid, title, description, location,
        startsAt: new Date(start.ms), endsAt: new Date(endMs), allDay, status,
        organizerEmail, organizerName, attendees,
        rrule, recurrenceExtra, tzid, conferenceUrl, recurrenceId,
    };
}

export function parseIcsCalendar(input: string | Buffer, limits: Partial<IcsLimits> = {}): IcsParseResult {
    const lim = { ...DEFAULT_ICS_LIMITS, ...limits };
    const res: IcsParseResult = { events: [], invalid: 0, calendarName: null, warnings: [], truncated: false };
    try {
        const size = typeof input === 'string' ? Buffer.byteLength(input) : input.length;
        let text = typeof input === 'string' ? input : decodeIcsBytes(input);
        if (size > lim.maxBytes) {
            res.truncated = true;
            text = text.slice(0, lim.maxBytes);
            const last = text.toUpperCase().lastIndexOf('END:VEVENT');
            text = last >= 0 ? text.slice(0, last + 10) : '';
        }
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
        const { root, truncated } = buildTree(text, lim.maxEvents);
        if (truncated) res.truncated = true;
        const cals = root.kids.filter((k) => k.name === 'VCALENDAR');
        const holders = cals.length ? cals : [root];
        const warnings = new Set<string>();
        for (const cal of holders) {
            const name = unescapeText(propOf(cal, 'X-WR-CALNAME')?.value ?? propOf(cal, 'NAME')?.value ?? '').replace(/\s+/g, ' ').trim();
            if (name && !res.calendarName) res.calendarName = name.slice(0, 200);
            const vtz = new Map<string, Node>();
            for (const z of cal.kids.filter((k) => k.name === 'VTIMEZONE')) {
                const id = (propOf(z, 'TZID')?.value ?? '').trim();
                if (id) { vtz.set(id, z); vtz.set(id.toLowerCase(), z); }
            }
            const wrTz = (propOf(cal, 'X-WR-TIMEZONE')?.value ?? '').trim();
            const dz = wrTz && resolveIana(wrTz) ? resolveIana(wrTz)! : lim.defaultTimeZone && resolveIana(lim.defaultTimeZone) ? resolveIana(lim.defaultTimeZone)! : null;
            const ctx: Ctx = { vtz, zones: new Map(), warnings, defaultZone: dz ? ianaZone(dz) : null };
            for (const ev of cal.kids.filter((k) => k.name === 'VEVENT')) {
                const e = eventFromNode(ev, ctx, lim);
                if (e) res.events.push(e); else res.invalid++;
            }
        }
        res.warnings = [...warnings];
    } catch {
        res.invalid++;
    }
    return res;
}

// ---------------------------------------------------------------------------
// Expansion de RRULE
// ---------------------------------------------------------------------------

interface Rule {
    freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
    interval: number;
    count: number | null;
    until: { kind: 'utc' | 'naive' | 'date'; ms: number } | null;
    byday: Array<{ ord: number; dow: number }>;
    bymonthday: number[];
    bymonth: number[];
    bysetpos: number[];
    wkst: number;
}

function ints(v: string | undefined, lo: number, hi: number, allowNeg: boolean): number[] | null {
    if (!v) return [];
    const out: number[] = [];
    for (const s of v.split(',')) {
        if (!/^[+-]?\d{1,3}$/.test(s)) return null;
        const n = Number(s);
        if (n === 0 || Math.abs(n) > hi || (!allowNeg && n < lo)) return null;
        out.push(n);
    }
    return out;
}

function parseRule(text: string): Rule | null {
    const p = parseRruleParts(text);
    if (!p) return null;
    const known = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'BYSETPOS', 'WKST']);
    for (const k of Object.keys(p)) if (!known.has(k)) return null;
    if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(p.FREQ)) return null;
    const interval = p.INTERVAL ? Number(p.INTERVAL) : 1;
    if (!Number.isInteger(interval) || interval < 1 || interval > 1000) return null;
    let count: number | null = null;
    if (p.COUNT !== undefined) {
        count = Number(p.COUNT);
        if (!Number.isInteger(count) || count < 1 || count > 1_000_000) return null;
    }
    if (count !== null && p.UNTIL) return null;
    let until: Rule['until'] = null;
    if (p.UNTIL) {
        if (/^\d{8}T\d{6}Z$/.test(p.UNTIL)) { const n = parseNaive(p.UNTIL); if (n === null) return null; until = { kind: 'utc', ms: n }; } else if (/^\d{8}T\d{6}$/.test(p.UNTIL)) { const n = parseNaive(p.UNTIL); if (n === null) return null; until = { kind: 'naive', ms: n }; } else if (/^\d{8}$/.test(p.UNTIL)) { const n = parseNaive(p.UNTIL); if (n === null) return null; until = { kind: 'date', ms: n }; } else return null;
    }
    const byday: Rule['byday'] = [];
    if (p.BYDAY) {
        for (const s of p.BYDAY.split(',')) {
            const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(s);
            if (!m) return null;
            const ord = m[1] ? Number(m[1]) : 0;
            if (m[1] && (ord === 0 || Math.abs(ord) > 53)) return null;
            byday.push({ ord, dow: DOW.indexOf(m[2]) });
        }
    }
    const bymonthday = ints(p.BYMONTHDAY, 1, 31, true);
    const bymonth = ints(p.BYMONTH, 1, 12, false);
    const bysetpos = ints(p.BYSETPOS, 1, 366, true);
    if (!bymonthday || !bymonth || !bysetpos) return null;
    let wkst = 1;
    if (p.WKST) { wkst = DOW.indexOf(p.WKST); if (wkst < 0) return null; }
    const freq = p.FREQ as Rule['freq'];
    if (freq !== 'MONTHLY' && freq !== 'YEARLY' && byday.some((b) => b.ord !== 0)) return null;
    if ((freq === 'DAILY' || freq === 'WEEKLY') && bymonthday.length) return null;
    if (freq === 'YEARLY' && (byday.length || bymonthday.length) && !bymonth.length) return null;
    if (freq === 'WEEKLY' && bysetpos.length) return null;
    return { freq, interval, count, until, byday, bymonthday, bymonth, bysetpos, wkst };
}

function monthDays(y: number, m0: number, r: Rule, defaultDay: number): number[] {
    const n = dim(y, m0);
    let a: number[] | null = null;
    if (r.byday.length) {
        const set = new Set<number>();
        for (const b of r.byday) {
            if (b.ord === 0) { for (let d = 1; d <= n; d++) if (new Date(Date.UTC(y, m0, d)).getUTCDay() === b.dow) set.add(d); } else {
                const d = nthDow(y, m0, b.dow, b.ord);
                if (d) set.add(d);
            }
        }
        a = [...set];
    }
    let b: number[] | null = null;
    if (r.bymonthday.length) b = [...new Set(r.bymonthday.map((d) => (d > 0 ? d : n + d + 1)).filter((d) => d >= 1 && d <= n))];
    let days: number[];
    if (a && b) days = a.filter((d) => b!.includes(d));
    else if (a) days = a;
    else if (b) days = b;
    else days = defaultDay <= n ? [defaultDay] : [];
    return days.sort((x, y2) => x - y2).map((d) => Date.UTC(y, m0, d));
}

export interface ExpandOptions { maxOccurrences?: number; horizonYears?: number }
export interface ExpandResult { dates: Date[]; truncated: boolean }

type Expandable = Pick<PimEvent, 'startsAt' | 'allDay' | 'tzid' | 'rrule' | 'recurrenceExtra'>;

/**
 * Expande la serie en instantes (incluye la primera ocurrencia = DTSTART). Devuelve null si la regla no esta soportada
 * (FREQ distinto de DAILY/WEEKLY/MONTHLY/YEARLY, BYYEARDAY/BYWEEKNO/BYHOUR..., zona no resoluble...): el llamador debe
 * conservar la RRULE como texto.
 */
export function expandRruleEx(ev: Expandable, opts: ExpandOptions = {}): ExpandResult | null {
    const maxOcc = Math.max(1, Math.min(opts.maxOccurrences ?? 500, 10_000));
    const horizonYears = Math.max(0, Math.min(opts.horizonYears ?? 5, 50));
    let zone: Zone | null = null;
    if (!ev.allDay && ev.tzid) {
        const iana = resolveIana(ev.tzid);
        if (!iana) return null;
        zone = ianaZone(iana);
    }
    const startMs = ev.startsAt.getTime();
    if (!Number.isFinite(startMs)) return null;
    const startNaive = zone ? startMs + zone.offsetAt(startMs) : startMs;
    const toInstant = (naive: number) => (zone ? localToUtc(naive, zone.offsetAt) : naive);
    const startDay = Math.floor(startNaive / DAY) * DAY;
    const tod = startNaive - startDay;

    // EXDATE / RDATE
    const exInstants = new Set<number>();
    const exDays = new Set<number>();
    const extra: number[] = [];
    for (const line of ev.recurrenceExtra ?? []) {
        const m = /^(EXDATE|RDATE)((?:;[^:]*)?):(.*)$/i.exec(line);
        if (!m) continue;
        const kind = m[1].toUpperCase();
        for (const v of m[3].split(',')) {
            const t = v.trim();
            if (/^\d{8}$/.test(t)) {
                const d = parseNaive(t);
                if (d === null) continue;
                if (kind === 'EXDATE') exDays.add(d); else extra.push(toInstant(d + tod));
            } else if (/^\d{8}T\d{6}Z$/.test(t)) {
                const d = parseNaive(t);
                if (d === null) continue;
                if (kind === 'EXDATE') exInstants.add(d); else extra.push(d);
            } else if (/^\d{8}T\d{6}$/.test(t)) {
                const d = parseNaive(t);
                if (d === null) continue;
                const inst = toInstant(d);
                if (kind === 'EXDATE') exInstants.add(inst); else extra.push(inst);
            }
        }
    }

    const out = new Set<number>();
    let truncated = false;
    if (ev.rrule) {
        const r = parseRule(ev.rrule);
        if (!r) return null;
        const st = new Date(startDay);
        const y0 = st.getUTCFullYear();
        const m0 = st.getUTCMonth();
        const dow0 = st.getUTCDay();
        const d0 = st.getUTCDate();
        const horizon = Date.UTC(y0 + horizonYears, m0, d0) + DAY;
        let untilNaive: number | null = null;
        if (r.until) {
            if (r.until.kind === 'utc') untilNaive = zone ? r.until.ms + zone.offsetAt(r.until.ms) : r.until.ms;
            else if (r.until.kind === 'naive') untilNaive = r.until.ms;
            else untilNaive = r.until.ms + DAY - 1;
        }
        let produced = 0;
        let stop = false;
        for (let k = 0; !stop && k < 20_000; k++) {
            let periodStart: number;
            let days: number[] = [];
            switch (r.freq) {
                case 'DAILY': {
                    periodStart = startDay + k * r.interval * DAY;
                    days = [periodStart];
                    if (r.byday.length) days = days.filter((d) => r.byday.some((b) => b.dow === new Date(d).getUTCDay()));
                    if (r.bymonth.length) days = days.filter((d) => r.bymonth.includes(new Date(d).getUTCMonth() + 1));
                    break;
                }
                case 'WEEKLY': {
                    periodStart = startDay - ((dow0 - r.wkst + 7) % 7) * DAY + k * r.interval * 7 * DAY;
                    const dows = r.byday.length ? [...new Set(r.byday.map((b) => b.dow))] : [dow0];
                    days = dows.map((w) => periodStart + ((w - r.wkst + 7) % 7) * DAY).sort((a, b) => a - b);
                    if (r.bymonth.length) days = days.filter((d) => r.bymonth.includes(new Date(d).getUTCMonth() + 1));
                    break;
                }
                case 'MONTHLY': {
                    const idx = m0 + k * r.interval;
                    const y = y0 + Math.floor(idx / 12);
                    const mo = ((idx % 12) + 12) % 12;
                    periodStart = Date.UTC(y, mo, 1);
                    if (r.bymonth.length && !r.bymonth.includes(mo + 1)) break;
                    days = monthDays(y, mo, r, d0);
                    break;
                }
                default: { // YEARLY
                    const y = y0 + k * r.interval;
                    periodStart = Date.UTC(y, 0, 1);
                    const months = r.bymonth.length ? [...r.bymonth].sort((a, b) => a - b) : [m0 + 1];
                    for (const mo of months) days.push(...monthDays(y, mo - 1, r, d0));
                    break;
                }
            }
            if (periodStart > horizon) { truncated = true; break; }
            if (r.bysetpos.length && days.length) {
                const sel = new Set<number>();
                for (const p of r.bysetpos) {
                    const d = p > 0 ? days[p - 1] : days[days.length + p];
                    if (d !== undefined) sel.add(d);
                }
                days = [...sel].sort((a, b) => a - b);
            }
            for (const day of days) {
                if (day < startDay) continue;
                const naive = day + tod;
                if (untilNaive !== null && naive > untilNaive) { stop = true; break; }
                if (day > horizon) { stop = true; truncated = r.count === null || produced < r.count; break; }
                produced++;
                if (r.count !== null && produced > r.count) { stop = true; break; }
                const inst = toInstant(naive);
                if (!exInstants.has(inst) && !exDays.has(day)) {
                    out.add(inst);
                    if (out.size >= maxOcc) { truncated = true; stop = true; break; }
                }
            }
        }
    }
    out.add(startMs);
    for (const x of extra) if (!exInstants.has(x) && out.size < maxOcc) out.add(x);
    return { dates: [...out].sort((a, b) => a - b).map((ms) => new Date(ms)), truncated };
}

export function expandRrule(ev: Expandable, opts: ExpandOptions = {}): Date[] | null {
    return expandRruleEx(ev, opts)?.dates ?? null;
}

// ---------------------------------------------------------------------------
// Marcadores de recurrencia dentro de `description` (el modelo de BD no tiene campo de recurrencia)
// ---------------------------------------------------------------------------

export const RRULE_MARKER = '[bloomx:rrule]';
export const RECUR_EXTRA_MARKER = '[bloomx:recur-extra]';
export const TZ_MARKER = '[bloomx:tz]';
export const EXPANDED_MARKER = '[bloomx:expanded]';

export interface RecurrenceMarkers {
    rrule: string | null;
    recurrenceExtra: string[];
    tzid: string | null;
    /** ISO de la ultima ocurrencia materializada como evento concreto al importar (para detectar borrados al exportar). */
    expandedUntil?: string | null;
}

export function encodeRecurrenceMarkers(description: string | null, m: RecurrenceMarkers): string | null {
    const tail: string[] = [];
    if (m.rrule) tail.push(`${RRULE_MARKER} ${sanitizeIcsLine(m.rrule)}`);
    for (const x of m.recurrenceExtra ?? []) if (/^(EXDATE|RDATE)[A-Za-z0-9=;,:_\-]*$/.test(x)) tail.push(`${RECUR_EXTRA_MARKER} ${x}`);
    if (m.rrule && m.tzid && /^[A-Za-z0-9_+\-/]{1,64}$/.test(m.tzid)) tail.push(`${TZ_MARKER} ${m.tzid}`);
    if (m.rrule && m.expandedUntil && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(m.expandedUntil)) tail.push(`${EXPANDED_MARKER} ${m.expandedUntil}`);
    const base = (description ?? '').trimEnd();
    if (!tail.length) return base || null;
    return `${base}${base ? '\n' : ''}${tail.join('\n')}`;
}

/** Separa la descripcion visible de los marcadores (que van en las ultimas lineas). */
export function decodeRecurrenceMarkers(description: string | null | undefined): RecurrenceMarkers & { description: string | null } {
    const lines = String(description ?? '').split('\n');
    const m: RecurrenceMarkers = { rrule: null, recurrenceExtra: [], tzid: null, expandedUntil: null };
    while (lines.length) {
        const l = lines[lines.length - 1].trimEnd();
        if (l.startsWith(RRULE_MARKER + ' ')) m.rrule = l.slice(RRULE_MARKER.length + 1).trim();
        else if (l.startsWith(RECUR_EXTRA_MARKER + ' ')) m.recurrenceExtra.unshift(l.slice(RECUR_EXTRA_MARKER.length + 1).trim());
        else if (l.startsWith(TZ_MARKER + ' ')) m.tzid = l.slice(TZ_MARKER.length + 1).trim();
        else if (l.startsWith(EXPANDED_MARKER + ' ')) m.expandedUntil = l.slice(EXPANDED_MARKER.length + 1).trim();
        else break;
        lines.pop();
    }
    const d = lines.join('\n').trimEnd();
    return { ...m, description: d || null };
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

function paramText(v: string): string {
    return `"${sanitizeIcsLine(v).replace(/"/g, "'")}"`;
}

function safeMail(v: unknown): string | null {
    const e = String(v ?? '').trim();
    return e.length <= 254 && EMAIL_OK.test(e) ? e : null;
}

const RESP_OUT: Record<string, string> = { accepted: 'ACCEPTED', declined: 'DECLINED', tentative: 'TENTATIVE', needsAction: 'NEEDS-ACTION' };

export interface BuildCalendarOptions { now?: Date; prodId?: string }

/** VCALENDAR 2.0. Instantes en UTC; las series con zona IANA emiten DTSTART;TZID (sin VTIMEZONE) para conservar la hora local tras DST. */
export function buildCalendarIcs(events: PimEventOut[], name: string, opts: BuildCalendarOptions = {}): string {
    const now = opts.now ?? new Date();
    const lines: string[] = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${sanitizeIcsLine(opts.prodId ?? '-//BloomX//Calendar Export//ES')}`, 'CALSCALE:GREGORIAN',
    ];
    const nm = sanitizeIcsLine(name);
    if (nm) lines.push(`X-WR-CALNAME:${escapeIcsText(nm)}`);
    for (const ev of events) {
        const s = ev.startsAt?.getTime?.();
        const e = ev.endsAt?.getTime?.();
        if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
        const allDay = !!ev.allDay;
        const rrule = ev.rrule && /^[A-Za-z0-9=;,+\-]+$/.test(ev.rrule) ? ev.rrule : null;
        const iana = rrule && !allDay && ev.tzid ? resolveIana(ev.tzid) : null;
        const off = iana ? (t: number) => ianaOffsetMs(iana, t) : null;
        const dt = (ms: number, prop: string): string => {
            if (allDay) return `${prop};VALUE=DATE:${fmtDate(ms)}`;
            if (off) return `${prop};TZID=${iana}:${fmtDateTime(ms + off(ms))}`;
            return `${prop}:${fmtUtc(ms)}`;
        };
        lines.push('BEGIN:VEVENT');
        lines.push(`UID:${String(ev.uid).replace(/[^A-Za-z0-9@._+=:#-]/g, '').slice(0, 255) || 'x@bloomx'}`);
        lines.push(`DTSTAMP:${fmtUtc(now.getTime())}`);
        if (ev.recurrenceId) {
            const rid = ev.recurrenceId.getTime();
            lines.push(allDay ? `RECURRENCE-ID;VALUE=DATE:${fmtDate(rid)}` : `RECURRENCE-ID:${fmtUtc(rid)}`);
        }
        lines.push(dt(s, 'DTSTART'), dt(Math.max(e, s), 'DTEND'));
        lines.push(`SUMMARY:${escapeIcsText(sanitizeIcsLine(ev.title || '(sin titulo)'))}`);
        if (ev.description) lines.push(`DESCRIPTION:${escapeIcsText(ev.description, { multiline: true })}`);
        if (ev.location) lines.push(`LOCATION:${escapeIcsText(sanitizeIcsLine(ev.location))}`);
        lines.push(`STATUS:${(ev.status ?? 'confirmed').toUpperCase()}`);
        const oe = safeMail(ev.organizerEmail);
        if (oe) lines.push(`ORGANIZER${ev.organizerName ? `;CN=${paramText(ev.organizerName)}` : ''}:mailto:${oe}`);
        for (const a of ev.attendees ?? []) {
            const ae = safeMail(a.email);
            if (!ae) continue;
            const ps = a.responseStatus ? RESP_OUT[a.responseStatus] : undefined;
            lines.push(`ATTENDEE${a.name ? `;CN=${paramText(a.name)}` : ''}${ps ? `;PARTSTAT=${ps}` : ''}${a.isOrganizer ? ';ROLE=CHAIR' : ''}:mailto:${ae}`);
        }
        if (rrule) {
            lines.push(`RRULE:${rrule}`);
            for (const x of ev.recurrenceExtra ?? []) if (/^(EXDATE|RDATE)(;VALUE=DATE)?:[0-9TZ,]+$/.test(x)) lines.push(x);
        }
        const cu = ev.conferenceUrl ? safeConferenceUrl(ev.conferenceUrl) : null;
        if (cu) lines.push(`CONFERENCE;VALUE=URI:${cu}`);
        lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}
