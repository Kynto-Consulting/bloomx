/**
 * mime-parse.ts - analizador RFC 5322 / RFC 2045-2047 / 2231 para importar correo (EML, mbox, Maildir, PST).
 *
 * Puro y sin dependencias (solo Buffer / TextDecoder de Node). Pensado para entrada NO CONFIABLE:
 *  - limites de profundidad multipart, nº de partes, nº de adjuntos y bytes decodificados (anti bomba MIME);
 *  - cabeceras saneadas (sin CR/LF/control) y truncadas;
 *  - nunca lanza por contenido malformado: devuelve lo que pudo leer y anota `warnings`.
 */

export interface MimeLimits {
    maxDepth: number;
    maxParts: number;
    maxAttachments: number;
    /** Bytes maximos decodificados de UNA parte (adjunto o cuerpo). */
    maxPartBytes: number;
    /** Bytes maximos decodificados entre todas las partes. */
    maxTotalBytes: number;
    maxHeaderBytes: number;
}

export const DEFAULT_MIME_LIMITS: MimeLimits = {
    maxDepth: 12,
    maxParts: 600,
    maxAttachments: 100,
    maxPartBytes: 50 * 1024 * 1024,
    maxTotalBytes: 120 * 1024 * 1024,
    maxHeaderBytes: 256 * 1024,
};

export interface Address {
    name: string;
    email: string;
}

export interface ParsedAttachment {
    filename: string;
    contentType: string;
    content: Buffer;
    contentId?: string;
    /** Disposicion `inline` (imagen incrustada) o referenciada por cid. */
    inline: boolean;
}

export interface ParsedMail {
    /** Cabeceras de nivel superior: nombre en minusculas -> valores (desplegados, sin decodificar RFC 2047). */
    headers: Record<string, string[]>;
    messageId: string | null;
    date: Date | null;
    subject: string;
    from: Address | null;
    sender: Address | null;
    to: Address[];
    cc: Address[];
    bcc: Address[];
    replyTo: Address | null;
    inReplyTo: string | null;
    references: string[];
    text: string;
    html: string;
    attachments: ParsedAttachment[];
    /** Adjuntos omitidos (limite de cantidad o tamano). */
    droppedAttachments: number;
    size: number;
    warnings: string[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Utilidades de bajo nivel
// ---------------------------------------------------------------------------------------------------------------------

/** Quita caracteres de control (incluye CR/LF) de un valor de cabecera. */
export function cleanHeaderValue(value: string, max = 2000): string {
    // eslint-disable-next-line no-control-regex
    return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u{2028}\u{2029}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

const utf8Strict = new TextDecoder('utf-8', { fatal: true });

/** Cabeceras en bytes -> texto: UTF-8 si es valido (cabeceras de 8 bits), si no latin1. */
export function decodeHeaderBytes(buf: Buffer): string {
    try {
        return utf8Strict.decode(buf);
    } catch {
        return buf.toString('latin1');
    }
}

/** Indice del primer separador cabecera/cuerpo (linea vacia) y su longitud; -1 si no hay. */
export function findHeaderEnd(buf: Buffer, from = 0): { index: number; length: number } {
    for (let i = from; i < buf.length; i++) {
        if (buf[i] === 0x0a) {
            if (buf[i + 1] === 0x0a) return { index: i, length: 2 };
            if (buf[i + 1] === 0x0d && buf[i + 2] === 0x0a) return { index: i, length: 3 };
        }
    }
    // Mensaje solo con cabeceras (sin linea vacia)
    return { index: -1, length: 0 };
}

export interface RawHeader {
    name: string;
    value: string;
}

/** Cabeceras desplegadas (RFC 5322 2.2.3). Las lineas sin ":" se ignoran. */
export function parseHeaderBlock(block: string, maxHeaders = 500): RawHeader[] {
    const out: RawHeader[] = [];
    const lines = block.split(/\r?\n/);
    let current: RawHeader | null = null;
    for (const line of lines) {
        if (!line) continue;
        if (/^[ \t]/.test(line)) {
            if (current) current.value += ' ' + line.trim();
            continue;
        }
        const idx = line.indexOf(':');
        if (idx <= 0) {
            current = null;
            continue;
        }
        const name = line.slice(0, idx).trim();
        // Nombre de cabecera valido: ASCII imprimible sin espacios
        if (!/^[\x21-\x39\x3b-\x7e]+$/.test(name)) {
            current = null;
            continue;
        }
        current = { name: name.toLowerCase(), value: line.slice(idx + 1).trim() };
        out.push(current);
        if (out.length >= maxHeaders) break;
    }
    return out;
}

export function headersToRecord(list: RawHeader[]): Record<string, string[]> {
    const rec: Record<string, string[]> = {};
    for (const h of list) (rec[h.name] ||= []).push(h.value);
    return rec;
}

const CHARSET_ALIASES: Record<string, string> = {
    'us-ascii': 'windows-1252',
    ascii: 'windows-1252',
    'ansi_x3.4-1968': 'windows-1252',
    utf8: 'utf-8',
    'iso-8859-1': 'windows-1252',
    latin1: 'windows-1252',
    'iso8859-1': 'windows-1252',
    'ks_c_5601-1987': 'euc-kr',
    'x-sjis': 'shift_jis',
    'unicode-1-1-utf-7': 'utf-7',
};

const decoderCache = new Map<string, TextDecoder | null>();

function getDecoder(charset: string): TextDecoder | null {
    const key = (charset || 'utf-8').trim().toLowerCase().replace(/^"|"$/g, '');
    const cached = decoderCache.get(key);
    if (cached !== undefined) return cached;
    let dec: TextDecoder | null = null;
    for (const candidate of [CHARSET_ALIASES[key] ?? key, key]) {
        try {
            dec = new TextDecoder(candidate, { fatal: false });
            break;
        } catch {
            dec = null;
        }
    }
    if (decoderCache.size < 64) decoderCache.set(key, dec);
    return dec;
}

/** Bytes -> texto con el charset declarado (utf-8 si es desconocido). */
// Windows-1252 0x80-0x9F (Node puede decodificarlo como latin1 puro segun la version)
const CP1252_HIGH = [
    0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
    0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

function fixCp1252(text: string): string {
    let out = '';
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        out += c >= 0x80 && c <= 0x9f ? String.fromCharCode(CP1252_HIGH[c - 0x80]) : text[i];
    }
    return out;
}

export function decodeCharset(bytes: Buffer, charset: string): string {
    const cs = (charset || 'utf-8').toLowerCase();
    if (cs === 'utf-8' || cs === 'utf8') return bytes.toString('utf8');
    const dec = getDecoder(cs);
    if (dec) {
        try {
            const out = dec.decode(bytes);
            return dec.encoding === 'windows-1252' ? fixCp1252(out) : out;
        } catch {
            /* caer a utf-8 */
        }
    }
    return bytes.toString('utf8');
}

/** Cuerpo quoted-printable (RFC 2045 6.7) a bytes. */
export function decodeQuotedPrintable(input: Buffer): Buffer {
    const out = Buffer.allocUnsafe(input.length);
    let o = 0;
    for (let i = 0; i < input.length; i++) {
        const c = input[i];
        if (c === 0x3d /* = */) {
            // salto de linea suave
            if (input[i + 1] === 0x0d && input[i + 2] === 0x0a) { i += 2; continue; }
            if (input[i + 1] === 0x0a) { i += 1; continue; }
            const h = hexVal(input[i + 1]);
            const l = hexVal(input[i + 2]);
            if (h >= 0 && l >= 0) { out[o++] = (h << 4) | l; i += 2; continue; }
            out[o++] = c;
            continue;
        }
        out[o++] = c;
    }
    return out.subarray(0, o);
}

function hexVal(c: number | undefined): number {
    if (c === undefined) return -1;
    if (c >= 0x30 && c <= 0x39) return c - 0x30;
    if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
    if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
    return -1;
}

/** Palabras codificadas RFC 2047 (las adyacentes se unen sin espacio). */
export function decodeEncodedWords(value: string): string {
    if (!value || !value.includes('=?')) return value;
    const joined = value.replace(/(\?=)\s+(=\?)/g, '$1$2');
    return joined.replace(/=\?([^?\s]+)\?([BbQq])\?([^?]*)\?=/g, (whole, charsetRaw: string, enc: string, text: string) => {
        const charset = String(charsetRaw).split('*')[0];
        try {
            const bytes = enc.toUpperCase() === 'B'
                ? Buffer.from(text, 'base64')
                : decodeQuotedPrintable(Buffer.from(text.replace(/_/g, ' '), 'latin1'));
            return decodeCharset(bytes, charset);
        } catch {
            return whole;
        }
    });
}

// ---------------------------------------------------------------------------------------------------------------------
// Direcciones (RFC 5322 3.4, tolerante)
// ---------------------------------------------------------------------------------------------------------------------

function splitTopLevel(input: string): string[] {
    const parts: string[] = [];
    let cur = '';
    let quote = false;
    let angle = 0;
    let paren = 0;
    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (ch === '\\' && i + 1 < input.length) { cur += ch + input[++i]; continue; }
        if (ch === '"' && paren === 0) quote = !quote;
        else if (!quote && ch === '(') paren++;
        else if (!quote && ch === ')' && paren > 0) paren--;
        else if (!quote && paren === 0 && ch === '<') angle++;
        else if (!quote && paren === 0 && ch === '>' && angle > 0) angle--;
        if (!quote && paren === 0 && angle === 0 && (ch === ',' || ch === ';')) {
            if (cur.trim()) parts.push(cur);
            cur = '';
            continue;
        }
        cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    return parts;
}

const EMAIL_IN_TEXT = /([^\s<>()",;:@]+@[^\s<>()",;:@]+\.[^\s<>()",;:@]+)/;

export function parseAddress(entry: string): Address | null {
    let raw = entry.trim();
    if (!raw) return null;
    // Grupos "nombre: a@x, b@y;" ya se separaron arriba; quita el nombre del grupo
    raw = raw.replace(/^[^"<]*:\s*(?=[^<]*@)/, (m) => (m.includes('@') ? m : ''));
    const angled = /<([^<>]*)>/.exec(raw);
    let email = '';
    let name = '';
    if (angled) {
        email = angled[1].trim();
        name = raw.slice(0, angled.index).trim();
    } else {
        // "a@x.com (Nombre)" o "a@x.com"
        const comment = /\(([^)]*)\)/.exec(raw);
        const bare = raw.replace(/\([^)]*\)/g, ' ').trim();
        email = bare;
        if (comment) name = comment[1].trim();
    }
    email = email.replace(/^mailto:/i, '').replace(/^"+|"+$/g, '').trim();
    if (!email.includes('@')) {
        const m = EMAIL_IN_TEXT.exec(raw);
        if (!m) return null;
        email = m[1];
    }
    // Ruta de origen obsoleta "@a,@b:user@host"
    if (email.includes(':')) email = email.slice(email.lastIndexOf(':') + 1);
    name = name.replace(/^"([^]*)"$/, '$1').replace(/\\(.)/g, '$1');
    name = cleanHeaderValue(decodeEncodedWords(name), 200);
    email = cleanHeaderValue(email, 320).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) return null;
    return { name, email };
}

export function parseAddressList(value: string | string[] | undefined): Address[] {
    if (!value) return [];
    const joined = Array.isArray(value) ? value.join(', ') : value;
    const out: Address[] = [];
    const seen = new Set<string>();
    for (const part of splitTopLevel(joined)) {
        const a = parseAddress(part);
        if (a && !seen.has(a.email)) {
            seen.add(a.email);
            out.push(a);
        }
        if (out.length >= 200) break;
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------------------------------------------------

/** Fecha RFC 5322 / variantes habituales. null si no se puede interpretar (nunca "hoy" por defecto). */
export function parseMailDate(value: string | undefined | null): Date | null {
    if (!value) return null;
    let s = value.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return null;
    // "Mon, 1 Jan 2020 10:00:00 +0000"; Date de V8 lo acepta. Algunas zonas raras (p. ej. "+0000 (UTC)") ya se limpiaron.
    let d = new Date(s);
    if (Number.isNaN(d.getTime())) {
        // Quita el dia de la semana y vuelve a probar; zona textual desconocida -> UTC
        s = s.replace(/^[A-Za-z]{3,9},?\s+/, '').replace(/\s+([A-Za-z]{3,5})$/, (m, z: string) => (/^(GMT|UTC|UT|Z|[ECMP][SD]T)$/i.test(z) ? ` ${z}` : ''));
        d = new Date(s);
    }
    if (Number.isNaN(d.getTime())) return null;
    const y = d.getUTCFullYear();
    // Fechas absurdas (0001, 9999) suelen ser basura: se descartan
    if (y < 1970 || y > new Date().getUTCFullYear() + 1) return null;
    return d;
}

// ---------------------------------------------------------------------------------------------------------------------
// Parametros de cabecera (Content-Type, Content-Disposition) con RFC 2231
// ---------------------------------------------------------------------------------------------------------------------

export interface ParamHeader {
    value: string;
    params: Record<string, string>;
}

export function parseParamHeader(raw: string | undefined): ParamHeader {
    const out: ParamHeader = { value: '', params: {} };
    if (!raw) return out;
    // Separa por ';' fuera de comillas
    const segs: string[] = [];
    let cur = '';
    let quote = false;
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (ch === '\\' && quote && i + 1 < raw.length) { cur += ch + raw[++i]; continue; }
        if (ch === '"') quote = !quote;
        if (ch === ';' && !quote) { segs.push(cur); cur = ''; continue; }
        cur += ch;
    }
    segs.push(cur);
    out.value = (segs.shift() || '').trim().toLowerCase();

    const simple: Record<string, string> = {};
    const ext: Record<string, { idx: number; encoded: boolean; value: string }[]> = {};
    for (const seg of segs) {
        const eq = seg.indexOf('=');
        if (eq <= 0) continue;
        let key = seg.slice(0, eq).trim().toLowerCase();
        let val = seg.slice(eq + 1).trim();
        if (val.startsWith('"')) {
            val = val.replace(/^"/, '').replace(/"\s*$/, '').replace(/\\(.)/g, '$1');
        }
        const m = /^([^*]+)(?:\*(\d+))?(\*)?$/.exec(key);
        if (m && key.includes('*')) {
            key = m[1];
            (ext[key] ||= []).push({ idx: m[2] ? Number(m[2]) : 0, encoded: !!m[3], value: val });
        } else {
            simple[key] = val;
        }
    }
    for (const [key, parts] of Object.entries(ext)) {
        parts.sort((a, b) => a.idx - b.idx);
        let charset = 'utf-8';
        if (parts[0]?.encoded) {
            const m = /^([^']*)'[^']*'/.exec(parts[0].value);
            if (m) charset = m[1] || 'utf-8';
        }
        // Solo los trozos codificados se pasan por percent-decoding
        const bytes: number[] = [];
        parts.forEach((p, i) => {
            let v = p.value;
            if (i === 0 && p.encoded) {
                const m = /^([^']*)'[^']*'(.*)$/.exec(v);
                if (m) v = m[2];
            }
            if (p.encoded) {
                for (let k = 0; k < v.length; k++) {
                    if (v[k] === '%' && hexVal(v.charCodeAt(k + 1)) >= 0 && hexVal(v.charCodeAt(k + 2)) >= 0) {
                        bytes.push((hexVal(v.charCodeAt(k + 1)) << 4) | hexVal(v.charCodeAt(k + 2)));
                        k += 2;
                    } else {
                        for (const b of Buffer.from(v[k], 'utf8')) bytes.push(b);
                    }
                }
            } else {
                for (const b of Buffer.from(v, 'utf8')) bytes.push(b);
            }
        });
        simple[key] = decodeCharset(Buffer.from(bytes), charset);
    }
    for (const [k, v] of Object.entries(simple)) out.params[k] = v;
    return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Arbol MIME
// ---------------------------------------------------------------------------------------------------------------------

interface Ctx {
    limits: MimeLimits;
    parts: number;
    totalBytes: number;
    attachments: ParsedAttachment[];
    dropped: number;
    texts: string[];
    htmls: string[];
    warnings: string[];
    attCounter: number;
}

function decodeTransfer(body: Buffer, encoding: string, ctx: Ctx): Buffer {
    const enc = encoding.trim().toLowerCase();
    if (enc === 'base64') {
        // Buffer.from tolera espacios/saltos de linea; estimacion previa del tamano
        if ((body.length / 4) * 3 > ctx.limits.maxPartBytes * 1.4) return Buffer.alloc(0);
        return Buffer.from(body.toString('latin1'), 'base64');
    }
    if (enc === 'quoted-printable') return decodeQuotedPrintable(body);
    return body;
}

function textFromPart(body: Buffer, charset: string): string {
    let txt = decodeCharset(body, charset);
    if (txt.charCodeAt(0) === 0xfeff) txt = txt.slice(1);
    return txt;
}

function sanitizeFilename(name: string): string {
    // eslint-disable-next-line no-control-regex
    let n = name.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/]+/g, '_').trim();
    n = n.replace(/^\.+/, '');
    if (n.length > 180) {
        const dot = n.lastIndexOf('.');
        const ext = dot > 0 && n.length - dot <= 12 ? n.slice(dot) : '';
        n = n.slice(0, 180 - ext.length) + ext;
    }
    return n;
}

function extFor(contentType: string): string {
    const map: Record<string, string> = {
        'text/calendar': '.ics', 'application/ics': '.ics', 'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg',
        'image/gif': '.gif', 'image/webp': '.webp', 'text/plain': '.txt', 'text/html': '.html', 'message/rfc822': '.eml',
        'application/zip': '.zip', 'application/octet-stream': '.bin',
    };
    return map[contentType] ?? '.bin';
}

function walkPart(raw: Buffer, ctx: Ctx, depth: number, parentType: string, top: { headers: RawHeader[] | null }): void {
    ctx.parts++;
    if (ctx.parts > ctx.limits.maxParts) {
        if (ctx.parts === ctx.limits.maxParts + 1) ctx.warnings.push('max_parts');
        return;
    }
    const he = findHeaderEnd(raw);
    let headerBuf: Buffer;
    let body: Buffer;
    if (he.index < 0) {
        // solo cabeceras o cuerpo sin cabeceras: si empieza con una cabecera valida se toma como cabeceras
        const firstLine = raw.subarray(0, Math.min(raw.length, 200)).toString('latin1');
        if (/^[\x21-\x39\x3b-\x7e]+:/.test(firstLine)) { headerBuf = raw; body = Buffer.alloc(0); }
        else { headerBuf = Buffer.alloc(0); body = raw; }
    } else {
        headerBuf = raw.subarray(0, Math.min(he.index, ctx.limits.maxHeaderBytes));
        body = raw.subarray(he.index + he.length);
    }
    const hdrs = parseHeaderBlock(decodeHeaderBytes(headerBuf));
    if (top.headers === null) top.headers = hdrs;
    const h = (name: string) => hdrs.find((x) => x.name === name)?.value;

    const ct = parseParamHeader(h('content-type') || (parentType === 'multipart/digest' ? 'message/rfc822' : 'text/plain'));
    const type = ct.value || 'text/plain';
    const cd = parseParamHeader(h('content-disposition'));
    const encoding = h('content-transfer-encoding') || '7bit';
    const contentIdRaw = h('content-id');
    const contentId = contentIdRaw ? cleanHeaderValue(contentIdRaw, 255).replace(/[<>\s]/g, '') || undefined : undefined;

    if (type.startsWith('multipart/') && ct.params.boundary && depth < ctx.limits.maxDepth) {
        const boundary = ct.params.boundary;
        for (const child of splitMultipart(body, boundary)) walkPart(child, ctx, depth + 1, type, top);
        return;
    }
    if (type.startsWith('multipart/') && depth >= ctx.limits.maxDepth) {
        ctx.warnings.push('max_depth');
        return;
    }

    let rawName = cd.params.filename || ct.params.name || '';
    if (rawName) rawName = decodeEncodedWords(rawName);
    const isAttachmentDisp = cd.value === 'attachment';
    const isInlineDisp = cd.value === 'inline';
    const isText = type === 'text/plain' || type === 'text/html';

    const isBody = isText && !isAttachmentDisp && !rawName;
    if (isBody) {
        const decoded = decodeTransfer(body, encoding, ctx);
        ctx.totalBytes += decoded.length;
        if (decoded.length > ctx.limits.maxPartBytes || ctx.totalBytes > ctx.limits.maxTotalBytes) {
            ctx.warnings.push('body_too_large');
            return;
        }
        const txt = textFromPart(decoded, ct.params.charset || 'utf-8');
        if (type === 'text/html') ctx.htmls.push(txt);
        else ctx.texts.push(txt);
        return;
    }

    // --- adjunto
    if (type === 'message/delivery-status' || type === 'text/rfc822-headers') {
        // Informes de rebote: se conservan como texto legible, no como adjunto binario
        const decoded = decodeTransfer(body, encoding, ctx);
        ctx.texts.push(textFromPart(decoded, ct.params.charset || 'utf-8'));
        return;
    }
    if (ctx.attachments.length >= ctx.limits.maxAttachments) {
        ctx.dropped++;
        return;
    }
    let decoded: Buffer;
    // message/rfc822: 7bit/8bit/binary -> bytes tal cual (RFC 2046); si un generador no conforme lo envio en base64/qp se decodifica
    decoded = decodeTransfer(body, encoding, ctx);
    ctx.totalBytes += decoded.length;
    if (decoded.length > ctx.limits.maxPartBytes || ctx.totalBytes > ctx.limits.maxTotalBytes) {
        ctx.dropped++;
        ctx.warnings.push('attachment_too_large');
        return;
    }
    ctx.attCounter++;
    let filename = sanitizeFilename(rawName);
    if (!filename) filename = `attachment-${ctx.attCounter}${extFor(type)}`;
    else if (!filename.includes('.') && extFor(type) !== '.bin') filename += extFor(type);
    ctx.attachments.push({
        filename,
        contentType: type,
        content: decoded,
        ...(contentId ? { contentId } : {}),
        inline: isInlineDisp || (!!contentId && !isAttachmentDisp),
    });
}

/** Divide un cuerpo multipart por su delimitador (lineas `--boundary` y `--boundary--`). */
export function splitMultipart(body: Buffer, boundary: string): Buffer[] {
    const delim = Buffer.from('--' + boundary, 'latin1');
    const parts: Buffer[] = [];
    let partStart = -1;
    let pos = 0;
    while (pos <= body.length) {
        // busca delimitador al inicio de linea
        let idx = body.indexOf(delim, pos);
        while (idx > 0 && body[idx - 1] !== 0x0a) idx = body.indexOf(delim, idx + 1);
        if (idx < 0) break;
        const after = idx + delim.length;
        const isClose = body[after] === 0x2d && body[after + 1] === 0x2d;
        if (partStart >= 0) {
            let end = idx;
            // quita el salto de linea previo al delimitador (pertenece al delimitador)
            if (end > partStart && body[end - 1] === 0x0a) end--;
            if (end > partStart && body[end - 1] === 0x0d) end--;
            parts.push(body.subarray(partStart, Math.max(partStart, end)));
        }
        if (isClose) { partStart = -1; break; }
        // salta hasta el final de la linea del delimitador
        let eol = body.indexOf(0x0a, after);
        if (eol < 0) { partStart = -1; break; }
        partStart = eol + 1;
        pos = partStart;
    }
    if (partStart >= 0 && partStart <= body.length) {
        // multipart sin cierre: toma el resto
        parts.push(body.subarray(partStart));
    }
    return parts;
}

// ---------------------------------------------------------------------------------------------------------------------
// API publica
// ---------------------------------------------------------------------------------------------------------------------

export function parseMessage(raw: Buffer, limits: Partial<MimeLimits> = {}): ParsedMail {
    const lim = { ...DEFAULT_MIME_LIMITS, ...limits };
    const ctx: Ctx = { limits: lim, parts: 0, totalBytes: 0, attachments: [], dropped: 0, texts: [], htmls: [], warnings: [], attCounter: 0 };
    const top: { headers: RawHeader[] | null } = { headers: null };
    try {
        walkPart(raw, ctx, 0, 'message', top);
    } catch {
        ctx.warnings.push('parse_error');
    }
    const headers = headersToRecord(top.headers ?? []);
    const first = (n: string) => (headers[n] && headers[n][0]) || undefined;
    const subject = cleanHeaderValue(decodeEncodedWords(first('subject') || ''), 998);
    const midRaw = first('message-id');
    const messageId = midRaw ? cleanHeaderValue(midRaw, 512).replace(/^<|>$/g, '').trim() || null : null;
    const fromList = parseAddressList(headers['from']);
    const refs = (first('references') || '').match(/<[^<>\s]+>/g)?.map((r) => r.slice(1, -1)).slice(-30) ?? [];
    const inReplyRaw = first('in-reply-to');
    const inReplyTo = inReplyRaw ? (inReplyRaw.match(/<([^<>\s]+)>/)?.[1] ?? null) : null;
    const text = ctx.texts.join('\n');
    const html = ctx.htmls.join('\n');
    return {
        headers,
        messageId,
        date: parseMailDate(first('date')),
        subject,
        from: fromList[0] ?? null,
        sender: parseAddressList(headers['sender'])[0] ?? null,
        to: parseAddressList(headers['to']),
        cc: parseAddressList(headers['cc']),
        bcc: parseAddressList(headers['bcc']),
        replyTo: parseAddressList(headers['reply-to'])[0] ?? null,
        inReplyTo,
        references: refs,
        text,
        html,
        attachments: ctx.attachments,
        droppedAttachments: ctx.dropped,
        size: raw.length,
        warnings: ctx.warnings,
    };
}

/** Solo cabeceras (para el analisis rapido del archivo). Acepta una cabecera parcial. */
export function parseHeadersOnly(raw: Buffer): { headers: Record<string, string[]>; date: Date | null; from: Address | null; to: Address[]; cc: Address[]; messageId: string | null } {
    const he = findHeaderEnd(raw);
    const block = (he.index < 0 ? raw : raw.subarray(0, he.index)).subarray(0, DEFAULT_MIME_LIMITS.maxHeaderBytes);
    const headers = headersToRecord(parseHeaderBlock(decodeHeaderBytes(block)));
    const first = (n: string) => (headers[n] && headers[n][0]) || undefined;
    const midRaw = first('message-id');
    return {
        headers,
        date: parseMailDate(first('date')),
        from: parseAddressList(headers['from'])[0] ?? null,
        to: parseAddressList(headers['to']),
        cc: parseAddressList(headers['cc']),
        messageId: midRaw ? cleanHeaderValue(midRaw, 512).replace(/^<|>$/g, '').trim() || null : null,
    };
}
