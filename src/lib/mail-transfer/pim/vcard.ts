/**
 * vcard.ts - lector/escritor vCard (.vcf) 2.1 / 3.0 / 4.0 para entrada NO CONFIABLE (Google Takeout, Apple, Outlook).
 *
 * Puro (sin E/S) y sin lanzar por basura:
 *  - pliegue de lineas (RFC 6350 3.2) y "soft breaks" de QUOTED-PRINTABLE de vCard 2.1;
 *  - ENCODING=QUOTED-PRINTABLE / CHARSET=... (utf-8, iso-8859-1, windows-1252...), escapes \n \N \, \; \\;
 *  - parametros TYPE (con o sin nombre: `TEL;CELL;VOICE:`), prefijos de grupo (`item1.EMAIL`);
 *  - multi-valor (varios EMAIL/TEL/ADR/URL), PHOTO/LOGO/SOUND/KEY se IGNORAN sin decodificar (pueden pesar MB);
 *  - limites: bytes totales, contactos, longitud de campos y nº de elementos por lista.
 */
import { foldIcsLine } from '@/lib/calendar/ics-build';

export interface PimContact {
    uid: string | null;
    name: string | null;
    emails: string[];
    phones: string[];
    org: string | null;
    title: string | null;
    notes: string | null;
    addresses: string[];
    /** `YYYY-MM-DD` o `--MM-DD` (sin anio). */
    birthday: string | null;
    urls: string[];
}

export interface VcfLimits {
    maxBytes: number;
    maxContacts: number;
    maxFieldLength: number;
    maxNotesLength: number;
    maxListItems: number;
}

export const DEFAULT_VCF_LIMITS: VcfLimits = {
    maxBytes: 64 * 1024 * 1024,
    maxContacts: 50_000,
    maxFieldLength: 1_000,
    maxNotesLength: 20_000,
    maxListItems: 50,
};

export interface VcfParseResult {
    contacts: PimContact[];
    invalid: number;
    /** true si se dejaron contactos sin leer por el limite `maxContacts` o `maxBytes`. */
    truncated: boolean;
}

// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const IGNORED = new Set(['PHOTO', 'LOGO', 'SOUND', 'KEY', 'CERT', 'PUBKEY']);

function decodeBytes(buf: Buffer): string {
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

/** Desplega lineas: continuacion = linea que empieza por espacio/tab; QP: linea que acaba en `=` continua en la siguiente. */
function unfold(text: string): string[] {
    const raw = text.replace(/\r\n?/g, '\n').split('\n');
    const out: string[] = [];
    for (const l of raw) {
        if ((l[0] === ' ' || l[0] === '\t') && out.length) out[out.length - 1] += l.slice(1);
        else out.push(l);
    }
    // vCard 2.1 con QP: soft line break
    const res: string[] = [];
    for (let i = 0; i < out.length; i++) {
        let cur = out[i];
        if (/quoted-printable/i.test(cur.slice(0, cur.indexOf(':') < 0 ? 0 : cur.indexOf(':')))) {
            let guard = 0;
            while (/=$/.test(cur) && i + 1 < out.length && guard++ < 1000) {
                cur = cur.slice(0, -1) + out[++i];
            }
        }
        res.push(cur);
    }
    return res;
}

interface Prop { name: string; params: Record<string, string[]>; value: string }

function parseLine(line: string): Prop | null {
    // nombre[;param...]:valor  (los parametros pueden ir entre comillas y contener ':')
    let i = 0;
    const n = line.length;
    let inQ = false;
    let colon = -1;
    for (; i < n; i++) {
        const c = line[i];
        if (c === '"') inQ = !inQ;
        else if (c === ':' && !inQ) { colon = i; break; }
    }
    if (colon <= 0) return null;
    const head = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const parts: string[] = [];
    let cur = '';
    inQ = false;
    for (const c of head) {
        if (c === '"') { inQ = !inQ; cur += c; } else if (c === ';' && !inQ) { parts.push(cur); cur = ''; } else cur += c;
    }
    parts.push(cur);
    let name = parts[0].trim().toUpperCase();
    const dot = name.lastIndexOf('.');
    if (dot >= 0) name = name.slice(dot + 1); // grupo `item1.EMAIL`
    if (!/^[A-Z0-9-]{1,40}$/.test(name)) return null;
    const params: Record<string, string[]> = Object.create(null);
    for (const p of parts.slice(1)) {
        const eq = p.indexOf('=');
        const k = (eq < 0 ? 'TYPE' : p.slice(0, eq)).trim().toUpperCase();
        const v = (eq < 0 ? p : p.slice(eq + 1)).trim();
        const vals = v.split(',').map((x) => x.replace(/^"|"$/g, '').trim().toUpperCase()).filter(Boolean);
        if (k) (params[k] ||= []).push(...vals);
    }
    return { name, params, value };
}

function decodeQp(s: string, charset: string): string {
    const bytes: number[] = [];
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) { bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; } else {
            const cp = s.charCodeAt(i);
            if (cp < 128) bytes.push(cp);
            else for (const b of Buffer.from(s[i], 'utf8')) bytes.push(b);
        }
    }
    const buf = Buffer.from(bytes);
    try {
        return new TextDecoder(charset || 'utf-8').decode(buf);
    } catch {
        return buf.toString('utf8');
    }
}

function unescapeText(s: string): string {
    return s.replace(/\\([nN,;:\\])/g, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

/** Divide por `;` sin escapar y deshace escapes de cada componente. */
function splitStructured(s: string): string[] {
    const out: string[] = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '\\' && i + 1 < s.length) { cur += s[i] + s[i + 1]; i++; } else if (s[i] === ';') { out.push(cur); cur = ''; } else cur += s[i];
    }
    out.push(cur);
    return out.map((c) => unescapeText(c).trim());
}

function clean(s: string, max: number): string {
    return s.replace(CTRL, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);
}

function normBirthday(v: string): string | null {
    const s = v.trim();
    let m = /^(\d{4})-?(\d{2})-?(\d{2})(?:T.*)?$/.exec(s);
    if (m) {
        const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
        if (y >= 1 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${m[1]}-${m[2]}-${m[3]}`;
        return null;
    }
    m = /^--(\d{2})-?(\d{2})$/.exec(s);
    if (m) {
        const [mo, d] = [Number(m[1]), Number(m[2])];
        if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `--${m[1]}-${m[2]}`;
    }
    return null;
}

const EMAIL_OK = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,255}$/;

function pushUnique(list: string[], v: string, max: number) {
    if (v && list.length < max && !list.some((x) => x.toLowerCase() === v.toLowerCase())) list.push(v);
}

function textOf(p: Prop, lim: VcfLimits, structured = false): string[] | string {
    let v = p.value;
    const enc = (p.params.ENCODING ?? []).join(',');
    if (/QUOTED-PRINTABLE/.test(enc) || (p.params.TYPE ?? []).includes('QUOTED-PRINTABLE') || (p.params['QUOTED-PRINTABLE'] ?? []).length) {
        v = decodeQp(v, (p.params.CHARSET?.[0] ?? 'utf-8').toLowerCase());
    } else if (/^(b|base64)$/i.test(enc)) {
        try { v = Buffer.from(v, 'base64').toString('utf8'); } catch { /* deja el valor */ }
    } else if (p.params.CHARSET?.[0] && !/^utf-?8$/i.test(p.params.CHARSET[0])) {
        // Ya es texto JS; si venia latin1 mal decodificado no hay forma fiable de repararlo: se deja tal cual.
    }
    const cap = p.name === 'NOTE' ? lim.maxNotesLength : lim.maxFieldLength * 4;
    v = v.slice(0, cap * 2);
    return structured ? splitStructured(v) : unescapeText(v);
}

function parseCard(props: Prop[], lim: VcfLimits): PimContact | null {
    const c: PimContact = { uid: null, name: null, emails: [], phones: [], org: null, title: null, notes: null, addresses: [], birthday: null, urls: [] };
    let nStruct: string[] | null = null;
    let nick: string | null = null;
    for (const p of props) {
        if (IGNORED.has(p.name)) continue;
        switch (p.name) {
            case 'UID': {
                const u = clean(String(textOf(p, lim)), 255).replace(/^urn:uuid:/i, '');
                if (u && !c.uid) c.uid = u;
                break;
            }
            case 'FN': {
                const v = clean(String(textOf(p, lim)), lim.maxFieldLength);
                if (v && !c.name) c.name = v;
                break;
            }
            case 'N': nStruct ||= textOf(p, lim, true) as string[]; break;
            case 'NICKNAME': nick ||= clean(String(textOf(p, lim)).split(',')[0], lim.maxFieldLength) || null; break;
            case 'EMAIL': {
                const v = clean(String(textOf(p, lim)).replace(/^mailto:/i, ''), 254).toLowerCase();
                if (EMAIL_OK.test(v)) pushUnique(c.emails, v, lim.maxListItems);
                break;
            }
            case 'TEL': {
                const v = clean(String(textOf(p, lim)).replace(/^tel:/i, ''), 64);
                if (/\d/.test(v)) pushUnique(c.phones, v, lim.maxListItems);
                break;
            }
            case 'ORG': {
                const parts = (textOf(p, lim, true) as string[]).map((x) => clean(x, lim.maxFieldLength)).filter(Boolean);
                if (parts.length && !c.org) c.org = parts.join(', ').slice(0, lim.maxFieldLength);
                break;
            }
            case 'TITLE': {
                const v = clean(String(textOf(p, lim)), lim.maxFieldLength);
                if (v && !c.title) c.title = v;
                break;
            }
            case 'NOTE': {
                const v = String(textOf(p, lim)).replace(CTRL, '').replace(/\r/g, '').trim().slice(0, lim.maxNotesLength);
                if (v) c.notes = c.notes ? `${c.notes}\n${v}`.slice(0, lim.maxNotesLength) : v;
                break;
            }
            case 'ADR': {
                const comps = (textOf(p, lim, true) as string[]).map((x) => clean(x.replace(/\n/g, ', '), lim.maxFieldLength)).filter(Boolean);
                if (comps.length) pushUnique(c.addresses, comps.join(', ').slice(0, lim.maxFieldLength * 2), lim.maxListItems);
                break;
            }
            case 'BDAY': {
                const b = normBirthday(String(textOf(p, lim)));
                if (b && !c.birthday) c.birthday = b;
                break;
            }
            case 'URL': {
                const v = clean(String(textOf(p, lim)), lim.maxFieldLength * 2);
                if (v) pushUnique(c.urls, v, lim.maxListItems);
                break;
            }
            default: break;
        }
    }
    if (!c.name && nStruct) {
        // N = familia;nombre;adicionales;prefijo;sufijo
        const [fam, giv, add, pre, suf] = nStruct;
        const nm = [pre, giv, add, fam, suf].map((x) => clean(x ?? '', lim.maxFieldLength)).filter(Boolean).join(' ');
        if (nm) c.name = nm.slice(0, lim.maxFieldLength);
    }
    if (!c.name && nick) c.name = nick;
    if (!c.name && !c.emails.length && !c.phones.length) return null;
    return c;
}

export function parseVcf(input: string | Buffer, limits: Partial<VcfLimits> = {}): VcfParseResult {
    const lim = { ...DEFAULT_VCF_LIMITS, ...limits };
    const res: VcfParseResult = { contacts: [], invalid: 0, truncated: false };
    try {
        const size = typeof input === 'string' ? Buffer.byteLength(input) : input.length;
        let text = typeof input === 'string' ? input : decodeBytes(input);
        if (size > lim.maxBytes) {
            res.truncated = true;
            text = text.slice(0, lim.maxBytes);
            const last = text.toUpperCase().lastIndexOf('END:VCARD');
            text = last >= 0 ? text.slice(0, last + 9) : '';
        }
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
        let cur: Prop[] | null = null;
        for (const line of unfold(text)) {
            if (!line.trim()) continue;
            const up = line.slice(0, 16).trim().toUpperCase();
            if (up === 'BEGIN:VCARD') {
                if (cur) res.invalid++; // tarjeta anterior sin END
                cur = [];
                continue;
            }
            if (up === 'END:VCARD') {
                if (cur) {
                    if (res.contacts.length >= lim.maxContacts) { res.truncated = true; cur = null; break; }
                    const card = parseCard(cur, lim);
                    if (card) res.contacts.push(card); else res.invalid++;
                }
                cur = null;
                continue;
            }
            if (!cur) continue;
            const head = line.slice(0, 12).toUpperCase();
            // Descarta cuanto antes las propiedades binarias (fotos base64 de varios MB)
            if (/^(?:[A-Z0-9-]+\.)?(PHOTO|LOGO|SOUND|KEY|CERT)[;:]/.test(head)) continue;
            if (cur.length > 2000) continue;
            const p = parseLine(line.length > 65_536 ? line.slice(0, 65_536) : line);
            if (p) cur.push(p);
        }
        if (cur) res.invalid++; // ultima tarjeta sin END
    } catch {
        res.invalid++;
    }
    return res;
}

// ---------------------------------------------------------------------------
// Escritura (vCard 4.0)
// ---------------------------------------------------------------------------

function esc(v: string): string {
    return String(v ?? '')
        .replace(/\r\n|\r|\u0085|\u2028|\u2029/g, '\n')
        .replace(CTRL, ' ')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');
}

function oneLine(v: string): string {
    return String(v ?? '').replace(/[\r\n\u0085\u2028\u2029]+/g, ' ').replace(CTRL, ' ').trim();
}

/** Serializa contactos como vCard 4.0 (CRLF, pliegue a 75 octetos, escapes RFC 6350). */
export function buildVcf(contacts: PimContact[]): string {
    const lines: string[] = [];
    for (const c of contacts) {
        const fn = oneLine(c.name || c.emails[0] || c.phones[0] || c.org || '') || 'Sin nombre';
        lines.push('BEGIN:VCARD', 'VERSION:4.0');
        if (c.uid) lines.push(`UID:${esc(oneLine(c.uid))}`);
        lines.push(`FN:${esc(fn)}`);
        // N: familia;nombre (heuristica: ultima palabra = apellido)
        const words = fn.split(/\s+/);
        const fam = words.length > 1 ? words[words.length - 1] : '';
        const giv = words.length > 1 ? words.slice(0, -1).join(' ') : words[0];
        lines.push(`N:${esc(fam)};${esc(giv)};;;`);
        for (const e of c.emails) if (oneLine(e)) lines.push(`EMAIL:${esc(oneLine(e))}`);
        for (const t of c.phones) if (oneLine(t)) lines.push(`TEL;VALUE=text:${esc(oneLine(t))}`);
        if (c.org) lines.push(`ORG:${esc(oneLine(c.org))}`);
        if (c.title) lines.push(`TITLE:${esc(oneLine(c.title))}`);
        for (const a of c.addresses) if (oneLine(a)) lines.push(`ADR:;;${esc(oneLine(a))};;;;`);
        if (c.birthday && /^(\d{4}-\d{2}-\d{2}|--\d{2}-\d{2})$/.test(c.birthday)) lines.push(`BDAY:${c.birthday}`);
        for (const u of c.urls) if (oneLine(u)) lines.push(`URL:${oneLine(u).replace(/[\\]/g, '')}`);
        if (c.notes) lines.push(`NOTE:${esc(c.notes)}`);
        lines.push('END:VCARD');
    }
    return lines.map(foldIcsLine).join('\r\n') + (lines.length ? '\r\n' : '');
}
