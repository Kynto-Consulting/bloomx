/**
 * emlx.ts - Apple Mail (.emlx / .partial.emlx). Puro, sin E/S; entrada NO CONFIABLE (nunca lanza: devuelve null).
 *
 * Formato (documentado por Apple/ingenieria inversa publica, p. ej. libemlx, "emlx2eml", Mail.app):
 *   1) primera linea: longitud DECIMAL en bytes del mensaje RFC 822 que sigue (terminada en "\n");
 *   2) exactamente esos bytes (el mensaje tal cual);
 *   3) un plist XML (<!DOCTYPE plist PUBLIC ...>) con `flags` (integer, mascara), `date-sent` / `date-received`
 *      (real = segundos Unix), `conversation-id`, `remote-id`, y (segun version / cuenta IMAP) `labels`/`gmail-labels`.
 *   Los `*.partial.emlx` guardan el mensaje SIN adjuntos (Mail los descarga bajo demanda): `partial: true`.
 *
 * Mascara `flags` de Mail.app (bits desde el menos significativo; valores tomados de la documentacion publica de
 * MessageFlags de Mail.framework, verificados contra la tabla `messages.flags` de "Envelope Index"; NO contra un .emlx
 * real de esta instalacion, no hay fixtures):
 *   bit 0 (1)   leido            bit 1 (2)   borrado (eliminado)   bit 2 (4)   respondido
 *   bit 3 (8)   cifrado          bit 4 (16)  marcado (flagged)     bit 5 (32)  reciente
 *   bit 6 (64)  borrador         bit 7 (128) descarga inicial      bit 8 (256) reenviado
 *   bit 9 (512) redirigido       (el resto -- nº de adjuntos, colores, spam... -- se ignora; solo se usan los de la tabla)
 * El valor puede superar 32 bits (p. ej. 8590195713), por eso se opera con BigInt.
 *
 * El plist se lee con safe-xml. Los plist de Apple SI llevan `<!DOCTYPE plist PUBLIC "..." "...">`; safe-xml rechaza
 * cualquier DOCTYPE, asi que se elimina UNA sola cabecera con una regex estricta (sin subconjunto interno `[`), nunca se
 * procesan entidades ni DTD. Si el DOCTYPE tuviera otra forma, se rechaza el plist (banderas por defecto + warning).
 */
import { parseXml, childElements, textOf, type XmlElement } from './safe-xml';
import { findHeaderEnd, decodeHeaderBytes, parseHeaderBlock } from './mime-parse';
import { formatMailDate } from './mime-build';

export interface EmlxParsed {
    /** Mensaje RFC 822 exacto. */
    raw: Buffer;
    flags: { read: boolean; flagged: boolean; answered: boolean; deleted: boolean; draft: boolean };
    dateReceived: Date | null;
    dateSent: Date | null;
    labels: string[];
    /** `.partial.emlx`: el mensaje no incluye los adjuntos. */
    partial: boolean;
    warnings: string[];
}

// Mascaras como numeros (2^n): el destino de compilacion (es6) no admite literales BigInt; las banderas caben en 2^53
export const EMLX_FLAG = { read: 1, deleted: 2, answered: 4, encrypted: 8, flagged: 16, recent: 32, draft: 64, forwarded: 256 } as const;

const MAX_PLIST_BYTES = 1024 * 1024;
const MAX_LABELS = 50;

/** ¿Parece un .emlx? Primera linea = solo digitos (1..12) + salto, y despues cabeceras RFC 822 (o extension .emlx). */
export function looksLikeEmlx(head: Buffer, filename = ''): boolean {
    const nl = head.indexOf(0x0a);
    if (nl < 1 || nl > 13) return false;
    const first = head.toString('latin1', 0, nl).replace(/\r$/, '');
    if (!/^[0-9]{1,12}$/.test(first)) return false;
    if (/\.emlx$/i.test(filename)) return true;
    const rest = head.toString('latin1', nl + 1, Math.min(head.length, nl + 1 + 2048));
    return /^[\x21-\x39\x3b-\x7e]+:[ \t]/.test(rest) && /^(received|from|to|date|subject|message-id|mime-version|return-path|delivered-to|x-[a-z0-9-]+|content-type)\s*:/i.test(rest);
}

/** Quita la UNICA cabecera `<!DOCTYPE plist PUBLIC "..." "...">` (sin subconjunto interno). null si hay otro DOCTYPE/ENTITY. */
function stripPlistDoctype(xml: string): string | null {
    const re = /<!DOCTYPE\s+plist(?:\s+PUBLIC\s+"[-A-Za-z0-9 \/\/.:_+]{0,200}"(?:\s+"[-A-Za-z0-9\/\/.:_+]{0,300}")?)?\s*>/;
    const out = xml.replace(re, '');
    if (/<!(DOCTYPE|ENTITY|ELEMENT|ATTLIST|NOTATION)/i.test(out)) return null;
    return out;
}

type PlistValue = string | number | boolean | PlistValue[] | { [k: string]: PlistValue };

function plistValue(el: XmlElement, depth = 0): PlistValue | undefined {
    if (depth > 8) return undefined;
    switch (el.local) {
        case 'string': case 'date': case 'data': return textOf(el);
        case 'integer': case 'real': { const n = Number(textOf(el).trim()); return Number.isFinite(n) ? n : undefined; }
        case 'true': return true;
        case 'false': return false;
        case 'array': return childElements(el).slice(0, 500).map((c) => plistValue(c, depth + 1)).filter((v): v is PlistValue => v !== undefined);
        case 'dict': return plistDict(el, depth + 1);
    }
    return undefined;
}

function plistDict(el: XmlElement, depth = 0): { [k: string]: PlistValue } {
    const out: { [k: string]: PlistValue } = Object.create(null);
    const kids = childElements(el);
    for (let i = 0; i + 1 < kids.length; i++) {
        if (kids[i].local !== 'key') continue;
        const key = textOf(kids[i]).trim();
        const v = plistValue(kids[i + 1], depth);
        if (v !== undefined && key && key !== '__proto__') out[key] = v;
        i++;
    }
    return out;
}

function toDate(v: PlistValue | undefined): Date | null {
    if (typeof v === 'number') {
        const d = new Date(v * 1000);
        return Number.isFinite(d.getTime()) && d.getUTCFullYear() >= 1970 && d.getUTCFullYear() < 2200 ? d : null;
    }
    if (typeof v === 'string') {
        const d = new Date(v);
        return Number.isFinite(d.getTime()) ? d : null;
    }
    return null;
}

function labelsOf(dict: { [k: string]: PlistValue }): string[] {
    const out: string[] = [];
    for (const key of ['labels', 'gmail-labels', 'keywords']) {
        const v = dict[key];
        if (Array.isArray(v)) {
            for (const x of v) if (typeof x === 'string' && x.trim()) out.push(x.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80));
        } else if (typeof v === 'string' && v.trim()) {
            out.push(v.trim().slice(0, 80));
        }
    }
    return Array.from(new Set(out)).slice(0, MAX_LABELS);
}

export function parseEmlx(buf: Buffer, opts: { filename?: string } = {}): EmlxParsed | null {
    try {
        const nl = buf.indexOf(0x0a);
        if (nl < 1 || nl > 13) return null;
        const first = buf.toString('latin1', 0, nl).replace(/\r$/, '').trim();
        if (!/^[0-9]{1,12}$/.test(first)) return null;
        const declared = Number(first);
        const rest = buf.subarray(nl + 1);
        const warnings: string[] = [];
        let raw: Buffer;
        let tail: Buffer;
        if (declared > rest.length) {
            warnings.push('emlx_length_exceeds_file');
            raw = rest;
            tail = Buffer.alloc(0);
        } else {
            raw = rest.subarray(0, declared);
            tail = rest.subarray(declared);
            if (declared === 0) warnings.push('emlx_empty_message');
        }
        if (raw.length === 0) return null;
        const partial = /\.partial\.emlx$/i.test(opts.filename ?? '');
        if (partial) warnings.push('emlx_partial_no_attachments');

        let dict: { [k: string]: PlistValue } = Object.create(null);
        const tailStr = tail.subarray(0, MAX_PLIST_BYTES).toString('utf8');
        const start = tailStr.indexOf('<?xml');
        const startAlt = start < 0 ? tailStr.indexOf('<plist') : start;
        if (startAlt >= 0) {
            let xml = tailStr.slice(startAlt);
            const cleaned = stripPlistDoctype(xml);
            if (cleaned === null) {
                warnings.push('emlx_plist_rejected_doctype');
            } else {
                xml = cleaned;
                try {
                    const root = parseXml(xml, { maxBytes: MAX_PLIST_BYTES, maxDepth: 16, maxNodes: 20_000 });
                    const d = root.local === 'plist' ? childElements(root, 'dict')[0] : root.local === 'dict' ? root : undefined;
                    if (d) dict = plistDict(d);
                    else warnings.push('emlx_plist_no_dict');
                } catch {
                    warnings.push('emlx_plist_invalid');
                }
            }
        } else if (declared < rest.length && tail.toString('latin1').trim()) {
            warnings.push('emlx_plist_missing');
        }

        const fl = typeof dict.flags === 'number' && Number.isFinite(dict.flags) && dict.flags >= 0 ? Math.floor(dict.flags) : 0;
        const has = (bit: number) => Math.floor(fl / bit) % 2 === 1;
        return {
            raw,
            flags: {
                // Sin plist no hay informacion: se asume leido (evita inundar la bandeja de "no leidos")
                read: typeof dict.flags === 'number' ? has(EMLX_FLAG.read) : true,
                flagged: has(EMLX_FLAG.flagged),
                answered: has(EMLX_FLAG.answered),
                deleted: has(EMLX_FLAG.deleted),
                draft: has(EMLX_FLAG.draft),
            },
            dateReceived: toDate(dict['date-received']),
            dateSent: toDate(dict['date-sent']),
            labels: labelsOf(dict),
            partial,
            warnings,
        };
    } catch {
        return null;
    }
}

/**
 * Mensaje RFC 822 con `Status`, `X-Status` y `X-Bloomx-Flags` inyectadas AL PRINCIPIO (las consume decidePlacement).
 * No duplica cabeceras ya presentes. Anade `Date` (de date-sent / date-received) solo si el mensaje no la trae.
 * Las etiquetas NO se inyectan como X-Gmail-Labels (decideFromGmailLabels forzaria carpeta/leido): estan en `parsed.labels`.
 */
export function emlxToRfc822(p: Pick<EmlxParsed, 'raw' | 'flags' | 'dateSent' | 'dateReceived'>): Buffer {
    const he = findHeaderEnd(p.raw);
    const block = (he.index < 0 ? p.raw : p.raw.subarray(0, he.index)).subarray(0, 256 * 1024);
    const present = new Set(parseHeaderBlock(decodeHeaderBytes(block)).map((h) => h.name));
    const eol = p.raw.subarray(0, 4096).includes(0x0d) ? '\r\n' : '\n';
    const f = p.flags;
    const lines: string[] = [];
    if (!present.has('status')) lines.push(`Status: ${f.read ? 'RO' : 'O'}`);
    if (!present.has('x-status')) {
        const xs = (f.flagged ? 'F' : '') + (f.answered ? 'A' : '') + (f.deleted ? 'D' : '') + (f.draft ? 'T' : '');
        if (xs) lines.push(`X-Status: ${xs}`);
    }
    if (!present.has('x-bloomx-flags')) {
        const set = [f.read ? 'read' : 'unread'];
        if (f.flagged) set.push('flagged');
        if (f.answered) set.push('answered');
        if (f.draft) set.push('draft');
        lines.push(`X-Bloomx-Flags: ${set.join(',')}`);
    }
    const d = p.dateSent ?? p.dateReceived;
    if (!present.has('date') && d) lines.push(`Date: ${formatMailDate(d)}`);
    if (lines.length === 0) return p.raw;
    return Buffer.concat([Buffer.from(lines.join(eol) + eol, 'latin1'), p.raw]);
}
