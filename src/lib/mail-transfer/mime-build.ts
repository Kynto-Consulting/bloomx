/**
 * mime-build.ts - genera un mensaje RFC 5322 / MIME (CRLF) a partir de los datos almacenados de un correo.
 *
 * Estructura:  multipart/mixed( multipart/alternative( text/plain, multipart/related( text/html, imagenes cid ) ), adjuntos )
 * omitiendo los niveles que no hagan falta. Cuerpos y adjuntos en base64 (lineas de 76). Cabeceras saneadas (sin CR/LF) y
 * codificadas (RFC 2047) si llevan caracteres no ASCII. Puro: sin E/S.
 */
import { createHash, randomBytes } from 'node:crypto';
import { cleanHeaderValue } from './mime-parse';

export interface BuildAddress {
    name?: string | null;
    email: string;
}

export interface BuildAttachment {
    filename: string;
    contentType: string;
    content: Buffer;
    contentId?: string | null;
    inline?: boolean;
}

export interface BuildInput {
    from?: BuildAddress | null;
    to?: BuildAddress[];
    cc?: BuildAddress[];
    bcc?: BuildAddress[];
    replyTo?: BuildAddress | null;
    subject?: string;
    date: Date;
    messageId?: string | null;
    inReplyTo?: string | null;
    references?: string[];
    text?: string | null;
    html?: string | null;
    attachments?: BuildAttachment[];
    /** Cabeceras extra ya validadas (X-Gmail-Labels, Status...). Los valores se sanean aqui. */
    extraHeaders?: Array<[string, string]>;
}

const CRLF = '\r\n';

function isAscii(s: string): boolean {
    return /^[\x20-\x7e]*$/.test(s);
}

/** RFC 2047 "B" en palabras de <= 75 caracteres sin partir caracteres UTF-8. */
export function encodeWord(value: string): string {
    if (isAscii(value)) return value;
    const words: string[] = [];
    let chunk = '';
    const flush = () => {
        if (chunk) words.push(`=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`);
        chunk = '';
    };
    for (const ch of value) {
        // 45 bytes -> 60 caracteres base64 + 12 de envoltorio = 72
        if (Buffer.byteLength(chunk + ch, 'utf8') > 45) flush();
        chunk += ch;
    }
    flush();
    return words.join(' ');
}

/** Pliega una cabecera (nombre: valor) a <= 76 columnas en espacios. */
export function foldHeader(name: string, value: string): string {
    const first = `${name}: `;
    const tokens = value.split(' ');
    const lines: string[] = [];
    let line = first;
    for (const tok of tokens) {
        if (line.length + tok.length + 1 > 76 && line.trim().length > (lines.length === 0 ? first.trim().length : 0)) {
            lines.push(line.replace(/\s+$/, ''));
            line = ' ' + tok + ' ';
        } else {
            line += tok + ' ';
        }
    }
    lines.push(line.replace(/\s+$/, ''));
    return lines.join(CRLF);
}

function quoteName(name: string): string {
    const n = cleanHeaderValue(name, 200);
    if (!n) return '';
    if (!isAscii(n)) return encodeWord(n);
    return /^[A-Za-z0-9 !#$%&'*+\-/=?^_`{|}~]+$/.test(n) ? n : `"${n.replace(/(["\\])/g, '\\$1')}"`;
}

export function formatAddress(a: BuildAddress): string {
    const email = cleanHeaderValue(a.email, 320).replace(/[<>\s,;"]/g, '');
    const name = a.name ? quoteName(a.name) : '';
    return name ? `${name} <${email}>` : email;
}

function formatList(list: BuildAddress[] | undefined): string {
    return (list ?? []).filter((a) => a && a.email).map(formatAddress).join(', ');
}

/** Fecha RFC 5322 en UTC: "Tue, 05 May 2020 10:00:00 +0000". */
export function formatMailDate(d: Date): string {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const p = (n: number) => String(n).padStart(2, '0');
    return `${days[d.getUTCDay()]}, ${p(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

/** Linea "From " de mbox (formato asctime de la fecha UTC). */
export function mboxFromLine(d: Date, sender = 'bloomx@localhost'): string {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const p = (n: number) => String(n).padStart(2, '0');
    const safe = sender.replace(/[^\x21-\x7e]/g, '') || 'bloomx@localhost';
    return `From ${safe} ${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} ${d.getUTCFullYear()}`;
}

function b64Lines(buf: Buffer): string {
    const b = buf.toString('base64');
    const out: string[] = [];
    for (let i = 0; i < b.length; i += 76) out.push(b.slice(i, i + 76));
    return out.join(CRLF);
}

/** Normaliza los saltos de linea del texto a CRLF (los cuerpos se guardan en base64, asi que solo importa al decodificar). */
function textBytes(s: string): Buffer {
    return Buffer.from(s.replace(/\r\n|\r|\n/g, CRLF), 'utf8');
}

const boundaryGen = (seed: string, n: number) => `=_bx_${createHash('sha256').update(seed + n).digest('hex').slice(0, 24)}`;

function part(headers: string[], body: string): string {
    return headers.join(CRLF) + CRLF + CRLF + body + CRLF;
}

function encodeFilenameParam(name: string): string {
    const safe = cleanHeaderValue(name.replace(/[\\/]+/g, '_'), 200) || 'attachment';
    if (isAscii(safe) && !/["\\]/.test(safe)) return `filename="${safe}"`;
    // RFC 2231 + alternativa ASCII para clientes antiguos
    const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    return `filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`;
}

function attachmentPart(a: BuildAttachment): string {
    const type = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(a.contentType) ? a.contentType.toLowerCase() : 'application/octet-stream';
    const name = a.filename || 'attachment';
    const asciiName = cleanHeaderValue(name, 200).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    // RFC 2046 5.2.1: message/rfc822 NO admite base64; va tal cual en 8bit (los ".eml" adjuntos se leen igual en cualquier cliente)
    if (type === 'message/rfc822') {
        return part([
            `Content-Type: message/rfc822; name="${asciiName}"`,
            'Content-Transfer-Encoding: 8bit',
            `Content-Disposition: ${a.inline ? 'inline' : 'attachment'}; ${encodeFilenameParam(name)}`,
        ], a.content.toString('latin1').replace(/\r?\n/g, CRLF));
    }
    const headers = [
        `Content-Type: ${type}; name="${asciiName}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: ${a.inline ? 'inline' : 'attachment'}; ${encodeFilenameParam(name)}`,
    ];
    if (a.contentId) headers.push(`Content-ID: <${cleanHeaderValue(a.contentId, 255).replace(/[<>\s]/g, '')}>`);
    return part(headers, b64Lines(a.content));
}

function textPart(type: 'text/plain' | 'text/html', body: string): string {
    return part([`Content-Type: ${type}; charset="utf-8"`, 'Content-Transfer-Encoding: base64'], b64Lines(textBytes(body)));
}

function multipart(kind: string, boundary: string, parts: string[]): { header: string; body: string } {
    return {
        header: `Content-Type: multipart/${kind}; boundary="${boundary}"`,
        body: parts.map((p) => `--${boundary}${CRLF}${p}`).join('') + `--${boundary}--${CRLF}`,
    };
}

/** Cabeceras extra saneadas y plegadas (una por linea, terminadas en CRLF) para anteponer a un mensaje ya existente. */
export function renderHeaderLines(headers: Array<[string, string]>): string {
    const lines: string[] = [];
    for (const [name, value] of headers) {
        if (!/^[A-Za-z][A-Za-z0-9-]{0,60}$/.test(name)) continue;
        const v = cleanHeaderValue(value, 2000);
        if (!v) continue;
        lines.push(foldHeader(name, isAscii(v) ? v : encodeWord(v)));
    }
    return lines.length ? lines.join(CRLF) + CRLF : '';
}

/** Construye el mensaje completo (cabeceras + cuerpo). */
export function buildMime(input: BuildInput): Buffer {
    const atts = (input.attachments ?? []).filter((a) => a && a.content);
    const cidImages = atts.filter((a) => a.contentId && a.inline !== false && !!input.html);
    const plainAtts = atts.filter((a) => !cidImages.includes(a));
    const seed = `${input.messageId ?? ''}|${input.subject ?? ''}|${input.date.getTime()}|${atts.length}`;
    let n = 0;

    const hasText = !!input.text && input.text.length > 0;
    const hasHtml = !!input.html && input.html.length > 0;

    // Cuerpo
    let bodyHeaders: string[];
    let bodyContent: string;
    const htmlPart = (): { headers: string[]; content: string } => {
        if (cidImages.length === 0) {
            return { headers: ['Content-Type: text/html; charset="utf-8"', 'Content-Transfer-Encoding: base64'], content: b64Lines(textBytes(input.html!)) };
        }
        const b = boundaryGen(seed, n++);
        const mp = multipart('related; type="text/html"', b, [textPart('text/html', input.html!), ...cidImages.map(attachmentPart)]);
        return { headers: [mp.header], content: mp.body };
    };

    if (hasHtml && hasText) {
        const b = boundaryGen(seed, n++);
        const h = htmlPart();
        const mp = multipart('alternative', b, [textPart('text/plain', input.text!), part(h.headers, h.content)]);
        bodyHeaders = [mp.header];
        bodyContent = mp.body;
    } else if (hasHtml) {
        const h = htmlPart();
        bodyHeaders = h.headers;
        bodyContent = h.content + (cidImages.length === 0 ? '' : '');
    } else {
        bodyHeaders = ['Content-Type: text/plain; charset="utf-8"', 'Content-Transfer-Encoding: base64'];
        bodyContent = b64Lines(textBytes(input.text ?? ''));
    }

    let topHeaders = bodyHeaders;
    let topBody = bodyContent;
    if (plainAtts.length > 0) {
        const b = boundaryGen(seed, n++);
        const mp = multipart('mixed', b, [part(bodyHeaders, bodyContent), ...plainAtts.map(attachmentPart)]);
        topHeaders = [mp.header];
        topBody = mp.body;
    }

    // Cabeceras de nivel superior
    const lines: string[] = [];
    const add = (name: string, value: string | undefined | null) => {
        if (value === undefined || value === null || value === '') return;
        lines.push(foldHeader(name, value));
    };
    const mid = input.messageId ? cleanHeaderValue(input.messageId, 500).replace(/[<>\s]/g, '') : `${randomBytes(12).toString('hex')}@bloomx.local`;
    add('Date', formatMailDate(input.date));
    if (input.from) add('From', formatAddress(input.from));
    const to = formatList(input.to);
    add('To', to);
    add('Cc', formatList(input.cc));
    add('Bcc', formatList(input.bcc));
    if (input.replyTo) add('Reply-To', formatAddress(input.replyTo));
    add('Subject', encodeWord(cleanHeaderValue(input.subject ?? '', 998)));
    add('Message-ID', `<${mid}>`);
    if (input.inReplyTo) add('In-Reply-To', `<${cleanHeaderValue(input.inReplyTo, 500).replace(/[<>\s]/g, '')}>`);
    if (input.references && input.references.length) add('References', input.references.slice(-30).map((r) => `<${cleanHeaderValue(r, 500).replace(/[<>\s]/g, '')}>`).join(' '));
    add('MIME-Version', '1.0');
    for (const [name, value] of input.extraHeaders ?? []) {
        if (!/^[A-Za-z][A-Za-z0-9-]{0,60}$/.test(name)) continue;
        add(name, isAscii(cleanHeaderValue(value, 2000)) ? cleanHeaderValue(value, 2000) : encodeWord(cleanHeaderValue(value, 2000)));
    }
    const head = lines.join(CRLF) + CRLF + topHeaders.join(CRLF) + CRLF + CRLF;
    return Buffer.concat([Buffer.from(head, 'latin1'), Buffer.from(topBody, 'latin1')]);
}
