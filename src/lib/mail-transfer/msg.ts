/**
 * msg.ts - Outlook .msg (OLE / CFB + propiedades MAPI, MS-OXMSG) -> MIME con buildMime. Puro, sin E/S.
 *
 * Lector: @kenjiuno/msgreader (Apache-2.0). Entrada NO CONFIABLE: tope de tamano del .msg, de nº y tamano de adjuntos,
 * profundidad maxima de mensajes adjuntos (3) y nunca lanza (devuelve null / warnings).
 *
 * Decisiones:
 *  - msgreader NO decodifica RTF comprimido; aqui se implementa LZFu (MS-OXRTFCP) y, si el RTF encapsula HTML
 *    (\fromhtml, MS-OXRTFEX), se recupera el HTML original; si es RTF "normal" se extrae el texto plano.
 *  - Cabeceras de transporte (PidTagTransportMessageHeaders): solo una lista blanca de nombres, como extraHeaders.
 *    From/To/Cc/Reply-To/Message-ID/In-Reply-To/References se re-emiten con buildMime (no se duplican).
 *  - Destinatarios: recipients con SMTP directo, smtpAddress (tipo EX), o por coincidencia de nombre con las cabeceras.
 *  - Mensajes adjuntos (.msg incrustados) -> message/rfc822 (.eml), recursivo hasta profundidad 3.
 *  - Lectura/bandera: PidTagMessageFlags (MSGFLAG_READ=1, UNSENT=8, FROMME=0x20) y PidTagFlagStatus (0x1090: 2 = marcado).
 */
import MsgReader, { type FieldsData } from '@kenjiuno/msgreader';
import { createHash } from 'node:crypto';
import { buildMime, type BuildAddress, type BuildAttachment } from './mime-build';
import { cleanHeaderValue, decodeCharset, headersToRecord, parseAddressList, parseHeaderBlock, parseMailDate } from './mime-parse';

export interface MsgToMimeOptions {
    maxAttachmentBytes: number;
    maxAttachments: number;
    /** Profundidad actual de anidamiento (uso interno; 0 por defecto). Maximo 3. */
    depth?: number;
    /** Tamano maximo del propio .msg (150 MB por defecto). */
    maxMessageBytes?: number;
    /** Suma maxima de adjuntos (120 MB por defecto). */
    maxTotalBytes?: number;
}

export interface MsgMime {
    raw: Buffer;
    date: Date | null;
    /** Direccion (solo el email, minusculas) del remitente. */
    from: string | null;
    subject: string;
    folderHint?: string;
    unread: boolean | null;
    flagged: boolean | null;
    warnings: string[];
}

const MAX_DEPTH = 3;
/**
 * Tipo del .eml adjunto. buildMime codifica TODOS los adjuntos en base64, pero mime-parse trata `message/rfc822` como 7bit
 * (RFC 2046) y no decodifica base64: con message/rfc822 el .eml no sobreviviria al round-trip buildMime -> parseMessage.
 * Por eso se usa application/octet-stream con extension .eml. Cambiar a 'message/rfc822' cuando mime-parse honre el CTE.
 */
export const EMBEDDED_EML_TYPE = 'application/octet-stream';
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const PROPS_UTF16 = Buffer.from('__properties_version1.0', 'utf16le');
const SUBSTG_UTF16 = Buffer.from('__substg1.0_', 'utf16le');

/** Cabecera OLE + (si cabe en `head`) el storage MAPI. Un .doc/.xls tiene la misma firma pero no `__properties_version1.0`. */
export function looksLikeMsg(head: Buffer, filename = ''): boolean {
    if (head.length < 8 || !head.subarray(0, 8).equals(OLE_MAGIC)) return false;
    if (head.includes(PROPS_UTF16) || head.includes(SUBSTG_UTF16)) return true;
    // El directorio puede estar mas alla de `head`: la extension desempata; sin ella, decide isMsgFile() con el fichero completo
    return /\.msg$/i.test(filename);
}

/** Comprobacion definitiva con el fichero completo (los nombres de directorio CFB van en UTF-16LE). */
export function isMsgFile(buf: Buffer): boolean {
    return buf.length >= 512 && buf.subarray(0, 8).equals(OLE_MAGIC) && (buf.includes(PROPS_UTF16) || buf.includes(SUBSTG_UTF16));
}

// ---------------------------------------------------------------------------------------------------------------------
// RTF comprimido (LZFu) y de-encapsulado
// ---------------------------------------------------------------------------------------------------------------------

const LZFU_INIT =
    '{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}{\\f0\\fnil \\froman \\fswiss \\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New RomanCourier{\\colortbl\\red0\\green0\\blue0\r\n\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tx';

/** Descomprime PidTagRtfCompressed (MS-OXRTFCP). null si el formato no es valido. */
export function decompressRtf(src: Uint8Array, maxOut = 32 * 1024 * 1024): Buffer | null {
    try {
        const b = Buffer.from(src.buffer, src.byteOffset, src.byteLength);
        if (b.length < 16) return null;
        const compSize = b.readUInt32LE(0);
        const rawSize = b.readUInt32LE(4);
        const type = b.toString('latin1', 8, 12);
        if (rawSize > maxOut) return null;
        if (type === 'MELA') return b.subarray(16, 16 + Math.min(rawSize, b.length - 16));
        if (type !== 'LZFu') return null;
        const end = Math.min(b.length, compSize + 4);
        const dict = Buffer.alloc(4096);
        dict.write(LZFU_INIT, 0, 'latin1');
        let wp = LZFU_INIT.length;
        const out = Buffer.allocUnsafe(rawSize);
        let op = 0;
        let ip = 16;
        while (ip < end && op < rawSize) {
            const ctl = b[ip++];
            for (let bit = 0; bit < 8 && op < rawSize; bit++) {
                if (ctl & (1 << bit)) {
                    if (ip + 1 >= b.length) return op > 0 ? out.subarray(0, op) : null;
                    const hi = b[ip++];
                    const lo = b[ip++];
                    let off = (hi << 4) | (lo >> 4);
                    const len = (lo & 0x0f) + 2;
                    if (off === wp) return out.subarray(0, op);
                    for (let k = 0; k < len && op < rawSize; k++) {
                        const c = dict[off];
                        off = (off + 1) & 4095;
                        out[op++] = c;
                        dict[wp] = c;
                        wp = (wp + 1) & 4095;
                    }
                } else {
                    if (ip >= end) break;
                    const c = b[ip++];
                    out[op++] = c;
                    dict[wp] = c;
                    wp = (wp + 1) & 4095;
                }
            }
        }
        return out.subarray(0, op);
    } catch {
        return null;
    }
}

const RTF_SKIP_DEST = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'headerl', 'headerr', 'footerl', 'footerr', 'listtable', 'listoverridetable', 'revtbl', 'rsidtbl', 'themedata', 'colorschememapping', 'datastore', 'latentstyles', 'filetbl', 'xmlnstbl', 'object', 'fldinst', 'generator']);
const RTF_SYMBOLS: Record<string, string> = { emdash: '—', endash: '–', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', bullet: '•', tab: '\t', par: '\n', line: '\n', emspace: ' ', enspace: ' ' };

/**
 * Extrae de un RTF: el HTML original si esta encapsulado (\fromhtml) o el texto plano. Tokenizador propio (sin regex
 * sobre el documento), acotado por el tamano de entrada y con tope de salida.
 */
export function rtfExtract(rtfBuf: Buffer, maxOut = 10 * 1024 * 1024): { html: string | null; text: string } {
    const s = rtfBuf.toString('latin1');
    const fromHtml = /\\fromhtml1?\b/.test(s.slice(0, 4096));
    const cpg = Number(/\\ansicpg(\d{3,5})/.exec(s.slice(0, 4096))?.[1] ?? 1252);
    const charset = cpg === 65001 ? 'utf-8' : `windows-${cpg}`;
    interface St { skip: boolean; htmlrtf: boolean; tag: boolean; uc: number }
    let st: St = { skip: false, htmlrtf: false, tag: false, uc: 1 };
    const stack: St[] = [];
    const out: string[] = [];
    let outLen = 0;
    let pending: number[] = [];
    let skipChars = 0;
    let groupFirst = false;
    let star = false;
    const canEmit = () => !st.skip && (!fromHtml || st.tag || !st.htmlrtf);
    const emit = (t: string) => {
        if (!t || !canEmit()) return;
        outLen += t.length;
        if (outLen > maxOut) throw new Error('rtf_too_large');
        out.push(t);
    };
    const flush = () => {
        if (pending.length) {
            const bytes = Buffer.from(pending);
            pending = [];
            emit(decodeCharset(bytes, charset));
        }
    };
    const n = s.length;
    let i = 0;
    try {
        while (i < n) {
            const c = s[i];
            if (c === '{') {
                flush();
                stack.push({ ...st });
                if (stack.length > 200) throw new Error('rtf_too_deep');
                groupFirst = true;
                star = false;
                i++;
            } else if (c === '}') {
                flush();
                const prev = stack.pop();
                if (prev) st = prev;
                groupFirst = false;
                i++;
            } else if (c === '\\') {
                const nx = s[i + 1];
                if (nx === undefined) break;
                if (nx === "'") {
                    const hex = s.substr(i + 2, 2);
                    i += 4;
                    if (/^[0-9a-fA-F]{2}$/.test(hex)) {
                        if (skipChars > 0) skipChars--;
                        else pending.push(parseInt(hex, 16));
                    }
                    groupFirst = false;
                    continue;
                }
                flush();
                if (/[a-zA-Z]/.test(nx)) {
                    let j = i + 1;
                    while (j < n && /[a-zA-Z]/.test(s[j]) && j - i < 40) j++;
                    const word = s.slice(i + 1, j);
                    let neg = false;
                    if (s[j] === '-') { neg = true; j++; }
                    let ps = j;
                    while (j < n && s.charCodeAt(j) >= 48 && s.charCodeAt(j) <= 57 && j - ps < 10) j++;
                    const param = j > ps ? (neg ? -1 : 1) * Number(s.slice(ps, j)) : null;
                    if (s[j] === ' ') j++;
                    i = j;
                    if (groupFirst) {
                        if (star) {
                            if (fromHtml && word === 'htmltag') st.tag = true;
                            else st.skip = true;
                        } else if (RTF_SKIP_DEST.has(word)) st.skip = true;
                        star = false;
                    }
                    groupFirst = false;
                    if (word === 'htmlrtf') st.htmlrtf = param !== 0;
                    else if (word === 'uc') st.uc = param ?? 1;
                    else if (word === 'u' && param !== null) {
                        if (skipChars > 0) skipChars--;
                        else { emit(String.fromCharCode(param < 0 ? param + 65536 : param)); skipChars = st.uc; }
                    } else if (RTF_SYMBOLS[word] !== undefined) {
                        // \par/\line/\tab solo cuentan como texto fuera de la sombra \htmlrtf
                        emit(RTF_SYMBOLS[word]);
                    }
                    continue;
                }
                // simbolo de control
                i += 2;
                if (nx === '*') { star = groupFirst; continue; }
                groupFirst = false;
                if (nx === '\\' || nx === '{' || nx === '}') emit(nx);
                else if (nx === '~') emit(' ');
                else if (nx === '_') emit('-');
                continue;
            } else {
                if (c !== '\r' && c !== '\n') {
                    if (skipChars > 0) skipChars--;
                    else { flush(); emit(c); }
                }
                groupFirst = false;
                i++;
            }
        }
        flush();
    } catch {
        // tope de salida o anidamiento excesivo: se conserva lo extraido
    }
    const joined = out.join('');
    if (fromHtml) return { html: /<[a-z!\/]/i.test(joined) ? joined : null, text: '' };
    return { html: null, text: joined.replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim() };
}

// ---------------------------------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------------------------------

/** Pagina de codigos Windows -> nombre de charset (o null si no se conoce). */
function charsetOfCodepage(cp: number | undefined): string | null {
    if (!cp) return null;
    if (cp === 65001) return 'utf-8';
    if (cp === 20127) return 'us-ascii';
    if (cp === 936 || cp === 54936) return 'gb18030';
    if (cp === 950) return 'big5';
    if (cp === 932 || cp === 50220 || cp === 50221 || cp === 50222) return 'shift_jis';
    if (cp === 51932) return 'euc-jp';
    if (cp === 949 || cp === 51949) return 'euc-kr';
    if (cp === 20866) return 'koi8-r';
    if (cp === 21866) return 'koi8-u';
    if (cp >= 1250 && cp <= 1258) return `windows-${cp}`;
    if (cp >= 28591 && cp <= 28599) return `iso-8859-${cp - 28590}`;
    if (cp === 28605) return 'iso-8859-15';
    return null;
}

const EXT_TYPES: Record<string, string> = {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp',
    txt: 'text/plain', htm: 'text/html', html: 'text/html', csv: 'text/csv', ics: 'text/calendar', zip: 'application/zip', xml: 'application/xml',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    mp3: 'audio/mpeg', mp4: 'video/mp4', json: 'application/json', msg: 'application/vnd.ms-outlook', eml: 'message/rfc822',
};

/** Cabeceras de transporte que se conservan (nombres en minusculas -> forma canonica). Todo lo demas se descarta. */
const KEEP_HEADERS: Record<string, string> = {
    'received': 'Received', 'authentication-results': 'Authentication-Results', 'received-spf': 'Received-SPF', 'dkim-signature': 'DKIM-Signature',
    'arc-seal': 'ARC-Seal', 'arc-message-signature': 'ARC-Message-Signature', 'arc-authentication-results': 'ARC-Authentication-Results',
    'return-path': 'Return-Path', 'delivered-to': 'Delivered-To', 'x-original-to': 'X-Original-To', 'sender': 'Sender',
    'list-id': 'List-Id', 'list-unsubscribe': 'List-Unsubscribe', 'list-unsubscribe-post': 'List-Unsubscribe-Post', 'list-post': 'List-Post',
    'precedence': 'Precedence', 'auto-submitted': 'Auto-Submitted', 'x-mailer': 'X-Mailer', 'user-agent': 'User-Agent', 'x-priority': 'X-Priority',
    'importance': 'Importance', 'x-spam-status': 'X-Spam-Status', 'x-spam-flag': 'X-Spam-Flag', 'x-spam-score': 'X-Spam-Score',
    'thread-topic': 'Thread-Topic', 'thread-index': 'Thread-Index', 'x-original-sender': 'X-Original-Sender',
};

function smtpOk(e: string | undefined | null): string | null {
    const v = (e ?? '').trim();
    return /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(v) && v.length <= 320 ? v.toLowerCase() : null;
}

function u8(v: unknown): Buffer | null {
    return v instanceof Uint8Array ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : null;
}

function parseDate(s: string | undefined): Date | null {
    if (!s) return null;
    const d = new Date(s);
    return Number.isFinite(d.getTime()) && d.getUTCFullYear() > 1970 && d.getUTCFullYear() < 2200 ? d : null;
}

function readFields(buf: Buffer, ansi: string | undefined, flagStatus: WeakMap<object, number>): { reader: MsgReader; data: FieldsData } {
    // msgreader ignora el desplazamiento de un DataView/Buffer: se le da un ArrayBuffer exacto (copia solo si hace falta)
    const ab = buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength ? (buf.buffer as ArrayBuffer) : (buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    const reader = new MsgReader(ab);
    reader.parserConfig = {
        ansiEncoding: ansi,
        propertyObserver: (fields, tag, raw) => {
            // PidTagFlagStatus (0x1090, PT_LONG): 2 = flagged. Se guarda por objeto para no mezclar con mensajes incrustados.
            if (tag === 0x10900003 && raw && raw.length >= 4 && fields.dataType === 'msg') {
                flagStatus.set(fields, (raw[0] | (raw[1] << 8) | (raw[2] << 16) | (raw[3] << 24)) >>> 0);
            }
        },
    };
    return { reader, data: reader.getFileData() };
}

const NON_MAIL_CLASS = /^IPM\.(Contact|DistList|Appointment|Task|TaskRequest|StickyNote|Activity|Journal|Post\.Rss|Configuration)/i;

// ---------------------------------------------------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------------------------------------------------

export function msgToMime(buf: Buffer, opts: MsgToMimeOptions): MsgMime | null {
    const depth = opts.depth ?? 0;
    const warnings: string[] = [];
    try {
        if (!isMsgFile(buf) || buf.length > (opts.maxMessageBytes ?? 150 * 1024 * 1024)) return null;
        const flagStatus = new WeakMap<object, number>();
        let { reader, data } = readFields(buf, undefined, flagStatus);
        if (!data || data.error || data.dataType !== 'msg') return null;
        // Segunda pasada con la pagina de codigos del mensaje: los PT_STRING8 (ANSI) se decodifican con ella
        const cp = typeof (data as any).messageCodepage === 'number' ? (data as any).messageCodepage : typeof (data as any).internetCodepage === 'number' ? (data as any).internetCodepage : undefined;
        if (cp) {
            try {
                const again = readFields(buf, cp === 65001 ? 'utf8' : `cp${cp}`, flagStatus);
                if (again.data && !again.data.error) { reader = again.reader; data = again.data; }
            } catch { warnings.push('msg_codepage_unsupported'); }
        }
        if (data.messageClass && NON_MAIL_CLASS.test(String(data.messageClass))) return null;

        // Cabeceras de transporte
        const hdrText = typeof data.headers === 'string' ? data.headers.slice(0, 256 * 1024) : '';
        const parsedHeaders = hdrText ? parseHeaderBlock(hdrText, 400) : [];
        const hrec = headersToRecord(parsedHeaders);
        const hfirst = (n: string) => (hrec[n] && hrec[n][0]) || undefined;

        const subject = cleanHeaderValue(String(data.subject ?? data.normalizedSubject ?? ''), 998);
        const date = parseDate(data.clientSubmitTime) ?? parseMailDate(hfirst('date')) ?? parseDate(data.messageDeliveryTime) ?? parseDate(data.creationTime);
        if (!date) warnings.push('msg_no_date');

        // Remitente
        const hdrFrom = parseAddressList(hrec['from'])[0] ?? null;
        const senderEmail = smtpOk(data.senderSmtpAddress) ?? smtpOk(data.sentRepresentingSmtpAddress)
            ?? (String(data.senderAddressType ?? '').toUpperCase() === 'SMTP' ? smtpOk(data.senderEmail) : null)
            ?? smtpOk(hdrFrom?.email) ?? smtpOk(data.creatorSMTPAddress);
        const from: BuildAddress | null = senderEmail ? { name: (data.senderName ?? hdrFrom?.name ?? '').toString().slice(0, 200), email: senderEmail } : null;
        if (!from) warnings.push('msg_no_sender');

        // Destinatarios
        const hdrByType: Record<'to' | 'cc', BuildAddress[]> = { to: parseAddressList(hrec['to']), cc: parseAddressList(hrec['cc']) };
        const all = [...hdrByType.to, ...hdrByType.cc];
        const rec: Record<'to' | 'cc' | 'bcc', BuildAddress[]> = { to: [], cc: [], bcc: [] };
        let unresolved = 0;
        for (const r of (data.recipients ?? []).slice(0, 500)) {
            const type = (r.recipType ?? 'to') as 'to' | 'cc' | 'bcc';
            const isSmtp = String(r.addressType ?? '').toUpperCase() === 'SMTP';
            let email = smtpOk(r.smtpAddress) ?? (isSmtp ? smtpOk(r.email) : null) ?? (!r.addressType ? smtpOk(r.email) : null);
            const name = (r.name ?? '').toString().slice(0, 200);
            if (!email && name) email = smtpOk(all.find((a) => a.name && a.name.toLowerCase() === name.toLowerCase())?.email) ?? smtpOk(name);
            if (!email) { unresolved++; continue; }
            (rec[type] ?? rec.to).push({ name: name && name.toLowerCase() !== email ? name : '', email });
        }
        if (unresolved) warnings.push(`msg_recipients_unresolved:${unresolved}`);
        if (rec.to.length + rec.cc.length + rec.bcc.length === 0) { rec.to = hdrByType.to; rec.cc = hdrByType.cc; }

        // Cuerpos
        const bodyCs = charsetOfCodepage(typeof (data as any).internetCodepage === 'number' ? (data as any).internetCodepage : cp) ?? 'utf-8';
        let text = typeof data.body === 'string' ? data.body : '';
        let html = typeof data.bodyHtml === 'string' ? data.bodyHtml : '';
        if (!html) {
            const hb = u8(data.html);
            if (hb && hb.length) html = decodeCharset(hb, bodyCs);
        }
        if (!html && data.compressedRtf) {
            const crtf = decompressRtf(data.compressedRtf);
            if (crtf) {
                const x = rtfExtract(crtf);
                if (x.html) html = x.html;
                else if (!text && x.text) text = x.text;
            } else if (!text) {
                warnings.push('msg_rtf_undecodable');
            }
        }
        html = html.slice(0, 20 * 1024 * 1024);
        text = text.slice(0, 20 * 1024 * 1024);

        // Adjuntos
        const attachments: BuildAttachment[] = [];
        let total = 0;
        const maxTotal = opts.maxTotalBytes ?? 120 * 1024 * 1024;
        const atts = data.attachments ?? [];
        if (atts.length > opts.maxAttachments) warnings.push(`msg_attachments_truncated:${atts.length - opts.maxAttachments}`);
        for (const a of atts.slice(0, opts.maxAttachments)) {
            try {
                const cid = a.pidContentId ? String(a.pidContentId).replace(/[<>\s]/g, '').slice(0, 255) : '';
                const inline = !!cid && !!html && html.toLowerCase().includes(`cid:${cid.toLowerCase()}`);
                const baseName = (a.fileName || a.fileNameShort || a.name || 'attachment').toString().replace(/[\\/\u0000-\u001f]+/g, '_').slice(0, 200) || 'attachment';
                if (a.innerMsgContent === true) {
                    if (depth + 1 > MAX_DEPTH) { warnings.push('msg_nested_too_deep'); continue; }
                    const inner = Buffer.from(reader.getAttachment(a).content);
                    const conv = msgToMime(inner, { ...opts, depth: depth + 1 });
                    if (!conv) { warnings.push('msg_nested_unreadable'); continue; }
                    if (conv.raw.length > opts.maxAttachmentBytes || total + conv.raw.length > maxTotal) { warnings.push('msg_attachment_too_large'); continue; }
                    total += conv.raw.length;
                    for (const w of conv.warnings) warnings.push(`nested:${w}`);
                    const nm = (conv.subject || a.name || 'message').toString().replace(/[\\/\u0000-\u001f]+/g, '_').slice(0, 120);
                    attachments.push({ filename: `${nm}.eml`, contentType: EMBEDDED_EML_TYPE, content: conv.raw, inline: false });
                    continue;
                }
                if (typeof a.dataId !== 'number') { warnings.push('msg_attachment_without_data'); continue; }
                if ((a.contentLength ?? 0) > opts.maxAttachmentBytes || total + (a.contentLength ?? 0) > maxTotal) { warnings.push('msg_attachment_too_large'); continue; }
                const content = Buffer.from(reader.getAttachment(a).content);
                if (content.length > opts.maxAttachmentBytes) { warnings.push('msg_attachment_too_large'); continue; }
                total += content.length;
                const ext = (/\.([A-Za-z0-9]{1,8})$/.exec(baseName)?.[1] ?? '').toLowerCase();
                const mime = String(a.attachMimeTag ?? '').toLowerCase();
                const contentType = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime) ? mime : (EXT_TYPES[ext] ?? 'application/octet-stream');
                attachments.push({ filename: baseName, contentType, content, contentId: cid || null, inline });
            } catch {
                warnings.push('msg_attachment_unreadable');
            }
        }

        // Ids y cabeceras extra
        const midHdr = hfirst('message-id')?.match(/<([^<>\s]+)>/)?.[1] ?? null;
        const midProp = typeof data.messageId === 'string' ? data.messageId.match(/<?([^<>\s]+)>?/)?.[1] ?? null : null;
        const seed = `${subject}|${date?.getTime() ?? 0}|${senderEmail ?? ''}|${rec.to.map((x) => x.email).join(',')}`;
        const messageId = midHdr ?? midProp ?? `msg-${createHash('sha1').update(seed).digest('hex').slice(0, 24)}@bloomx.local`;
        const irt = hfirst('in-reply-to')?.match(/<([^<>\s]+)>/)?.[1] ?? null;
        const refs = (hfirst('references') ?? '').match(/<[^<>\s]+>/g)?.map((r) => r.slice(1, -1)) ?? [];
        const extra: Array<[string, string]> = [];
        let receivedCount = 0;
        for (const h of parsedHeaders) {
            const canon = KEEP_HEADERS[h.name];
            if (!canon || !h.value) continue;
            if (h.name === 'received' && ++receivedCount > 30) continue;
            extra.push([canon, h.value]);
        }

        // Banderas
        const mf = typeof (data as any).messageFlags === 'number' ? ((data as any).messageFlags as number) : null;
        const fs = flagStatus.get(data) ?? null;
        const unread = mf === null ? null : (mf & 0x1) === 0;
        const flagged = fs === null ? null : fs === 2;
        let folderHint: string | undefined;
        if (mf !== null && (mf & 0x8) !== 0) folderHint = 'Drafts';
        else if (mf !== null && (mf & 0x20) !== 0) folderHint = 'Sent';

        const replyTo = parseAddressList(hrec['reply-to'])[0] ?? null;
        const raw = buildMime({
            from,
            to: rec.to,
            cc: rec.cc,
            bcc: rec.bcc,
            replyTo: replyTo && smtpOk(replyTo.email) ? replyTo : null,
            subject,
            date: date ?? new Date(0),
            messageId,
            inReplyTo: irt,
            references: refs,
            text: text || (html ? null : ''),
            html: html || null,
            attachments,
            extraHeaders: extra,
        });
        return { raw, date, from: senderEmail, subject, folderHint, unread, flagged, warnings };
    } catch {
        return null;
    }
}
