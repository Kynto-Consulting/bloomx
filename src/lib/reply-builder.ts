/**
 * Cita al RESPONDER / REENVIAR (puro, sin DOM, isomorfo). La UI (MailView, EmailList, ComposeModal) solo lo invoca.
 *
 * Genera HTML con la estructura que los clientes usan para plegar el historial:
 *  - Gmail / Apple Mail / Thunderbird / Titan / Zoho / Yahoo: `div.gmail_quote > div.gmail_attr + blockquote.gmail_quote`.
 *  - Outlook / Hotmail (reenvio estilo Outlook): `hr` + `div#divRplyFwdMsg` con De/Enviado el/Para/Asunto.
 * y su version en texto plano coherente (lineas con "> " por nivel, via htmlToPlainText).
 *
 * Todo lo dependiente del entorno se INYECTA (`ReplyDeps`): i18n, zona/idioma, sanitizador (DOMPurify en el cliente),
 * resolucion de imagenes cid:. Asi se prueba sin DOM real. Sin sanitizador inyectado igualmente se aplica una limpieza
 * propia basada en tokenizador (scripts, estilos, controles, handlers on*, tracking pixels), que es la que garantiza
 * el minimo; DOMPurify se ejecuta ademas cuando esta disponible.
 */
import { escapeHtmlAttr, escapeHtmlContent, getAttr, tokenizeHtml, VOID_TAGS, type HtmlAttr } from '@/lib/html-tokenize';
import { htmlToPlainText } from '@/lib/html-to-text';
import { leadingPrefixWord, stripReplyForwardPrefixes } from '@/lib/threading';

// ---------------------------------------------------------------------------
// Tipos publicos
// ---------------------------------------------------------------------------

export type ForwardStyle = 'gmail' | 'outlook';

export interface ReplyDeps {
    /** i18n de la app: t('emailList.quoteHeader', { date, from }). Si devuelve la propia clave se usa el texto por defecto (en). */
    t?: (key: string, params?: Record<string, string | number>) => string;
    /** Locale Intl de la fecha (p. ej. 'es-PE', 'en-US'). */
    locale?: string;
    /** Zona horaria IANA de la fecha (por defecto, la del entorno). */
    timeZone?: string;
    /** Sanitizador de HTML (DOMPurify en el cliente: `sanitizeHtml`). */
    sanitize?: (html: string) => string;
    /** Resuelve `cid:` a una data URI (o null si no se puede). Las cid sin resolver se descartan. */
    resolveCid?: (cid: string) => string | null;
    /** Tope del HTML citado, en bytes UTF-8 (por defecto 100 KB). */
    maxQuoteBytes?: number;
    /** Tope de una imagen data: dentro de la cita, en caracteres (por defecto 600 000). Las mayores se descartan. */
    maxInlineImageChars?: number;
    /** Estilo del bloque "Forwarded message" (por defecto, el guardado con getStoredForwardStyle o 'gmail'). */
    forwardStyle?: ForwardStyle;
    /** Formateo de fecha propio (tests); por defecto formatLongDate con locale/timeZone. */
    formatDate?: (value: string | Date) => string;
}

export interface QuoteSource {
    from: string;
    to?: string | null;
    cc?: string | null;
    subject?: string | null;
    createdAt: string;
}

export interface QuoteResult {
    /** Bloque de la cita (sin el hueco de escritura previo). */
    html: string;
    /** Version texto plano (atribucion + cita con "> "). */
    text: string;
    /** Cuerpo listo para el redactor: parrafo vacio donde escribir + cita. */
    body: string;
}

export const DEFAULT_MAX_QUOTE_BYTES = 100 * 1024;
export const DEFAULT_MAX_INLINE_IMAGE_CHARS = 600_000;
export const FORWARD_STYLE_STORAGE_KEY = 'bloomx:forward-style';
/** Atributo con el que se marcan las imagenes data: que el servidor convierte en adjuntos inline (cid). */
export const INLINE_IMAGE_ATTR = 'data-bx-inline';

const BLOCKQUOTE_STYLE = 'margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex';

// ---------------------------------------------------------------------------
// Textos por defecto (en) y helpers de i18n
// ---------------------------------------------------------------------------

const DEFAULT_TEXTS: Record<string, string> = {
    'emailList.quoteHeader': 'On {date}, {from} wrote:',
    'mailView.replyQuote.trimmed': 'Earlier history was trimmed',
    'mailView.replyQuote.fwdTitle': 'Forwarded message',
    'mailView.replyQuote.from': 'From',
    'mailView.replyQuote.date': 'Date',
    'mailView.replyQuote.subject': 'Subject',
    'mailView.replyQuote.to': 'To',
    'mailView.replyQuote.cc': 'Cc',
    'mailView.replyQuote.sent': 'Sent',
};

function tx(deps: ReplyDeps, key: string, params?: Record<string, string | number>): string {
    let out = '';
    try { out = deps.t ? deps.t(key, params) : ''; } catch { out = ''; }
    if (!out || out === key) {
        out = DEFAULT_TEXTS[key] || key;
        if (params) for (const [k, v] of Object.entries(params)) out = out.split(`{${k}}`).join(String(v));
    }
    return out;
}

// ---------------------------------------------------------------------------
// Fecha y remitente
// ---------------------------------------------------------------------------

/** Fecha larga con zona: "lunes, 29 de septiembre de 2025, 14:30 GMT-5". */
export function formatLongDate(value: string | Date, locale?: string, timeZone?: string): string {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || '');
    const fields: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' };
    const attempts: Array<Intl.DateTimeFormatOptions> = [
        // shortOffset ("GMT-5") es entendible en cualquier zona; 'short' ("PET") depende del ICU.
        { ...fields, timeZoneName: 'shortOffset', ...(timeZone ? { timeZone } : {}) },
        { ...fields, timeZoneName: 'short', ...(timeZone ? { timeZone } : {}) },
        // Zona invalida: se reintenta con la del entorno.
        { ...fields, timeZoneName: 'short' },
    ];
    for (const opts of attempts) {
        try { return new Intl.DateTimeFormat(locale || undefined, opts).format(date); } catch { /* siguiente intento */ }
    }
    return date.toISOString();
}

export interface ParsedFrom { name: string; email: string }

/** Separa `"Ana \"X\"" <a@b.com>`, `Ana <a@b.com>`, `<a@b.com>` o `a@b.com`. */
export function parseFromHeader(from: string): ParsedFrom {
    const raw = String(from || '').trim();
    const m = /^(.*?)<([^<>]*)>\s*$/.exec(raw);
    if (m) {
        let name = m[1].trim();
        if (name.length >= 2 && name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1).replace(/\\(["\\])/g, '$1');
        return { name: name.trim(), email: m[2].trim() };
    }
    if (raw.includes('@') && !/\s/.test(raw)) return { name: '', email: raw };
    return { name: raw, email: '' };
}

/** "Nombre <correo>" (sin comillas, como Gmail); si falta una parte, solo la otra. Sin escapar. */
export function displayFrom(from: string): string {
    const p = parseFromHeader(from);
    if (p.name && p.email) return `${p.name} <${p.email}>`;
    return p.name || p.email || String(from || '');
}

// ---------------------------------------------------------------------------
// Limpieza del original (sanea, quita tracking y equilibra etiquetas)
// ---------------------------------------------------------------------------

/** Se eliminan con todo su contenido. */
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'applet', 'head', 'title', 'template', 'noscript', 'svg', 'math', 'select', 'textarea', 'datalist', 'audio', 'video', 'canvas', 'dialog', 'noembed', 'noframes']);
/** Se elimina la etiqueta pero se conserva su contenido. */
const UNWRAP = new Set(['html', 'body', 'form', 'fieldset', 'legend', 'button', 'label', 'output', 'optgroup', 'option', 'portal']);
/** Sin contenido y peligrosas: se descartan. */
const DROP_VOID = new Set(['meta', 'link', 'base', 'input', 'embed', 'source', 'track', 'param', 'area']);
const URL_ATTRS = new Set(['href', 'src', 'action', 'background', 'poster', 'xlink:href', 'cite', 'longdesc']);
const TRACKING_URL = /(?:^|[\/?&._=-])(?:track(?:ing|er)?|pixel|beacon|impression|imp|open|opens|opentrack|email-?open|wf\/open|1x1|spacer|clear\.gif|blank\.gif|cnt\.gif|o\.gif|trk|click-?track)(?:$|[\/?&._=-])/i;

function cssLength(style: string, prop: string): number | undefined {
    const m = new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*(-?\\d*\\.?\\d+)\\s*(px|pt|em|rem|%)?`, 'i').exec(style);
    if (!m) return undefined;
    const n = parseFloat(m[1]);
    const unit = (m[2] || 'px').toLowerCase();
    if (unit === '%') return undefined;
    return unit === 'em' || unit === 'rem' ? n * 16 : n;
}

function attrLength(v: string | undefined): number | undefined {
    if (v === undefined) return undefined;
    const m = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/i.exec(v);
    return m ? parseFloat(m[1]) : undefined;
}

/** Imagen remota "invisible" (pixel de seguimiento). Las imagenes reales remotas NO cumplen esto. */
export function isTrackingImage(attrs: HtmlAttr[]): boolean {
    const get = (n: string) => attrs.find((a) => a.name === n)?.value;
    const src = (get('src') || '').trim();
    if (!/^(?:https?:)?\/\//i.test(src)) return false;
    const style = get('style') || '';
    if (attrs.some((a) => a.name === 'hidden')) return true;
    if (/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d])|font-size\s*:\s*0(?![.\d])/i.test(style)) return true;
    const w = attrLength(get('width')) ?? cssLength(style, 'width');
    const h = attrLength(get('height')) ?? cssLength(style, 'height');
    if ((w !== undefined && w <= 2) || (h !== undefined && h <= 2)) return true;
    if (w === 0 || h === 0) return true;
    return TRACKING_URL.test(src.split('#')[0]);
}

function isUnsafeUrl(value: string): boolean {
    const v = value.replace(/[\u0000-\u0020\u00a0\u200b]/g, '').toLowerCase();
    return v.startsWith('javascript:') || v.startsWith('vbscript:') || v.startsWith('livescript:') || (v.startsWith('data:') && !v.startsWith('data:image/'));
}

function cleanStyle(style: string): string {
    return style
        .replace(/@import[^;]*;?/gi, '')
        .replace(/expression\s*\([^)]*\)/gi, '')
        .replace(/behavior\s*:[^;]*;?/gi, '')
        .replace(/-moz-binding\s*:[^;]*;?/gi, '')
        .replace(/url\(\s*['"]?\s*(?:javascript|vbscript):[^)]*\)/gi, 'none');
}

function serializeOpen(name: string, attrs: HtmlAttr[]): string {
    const a = attrs.map((x) => ` ${x.name}="${escapeHtmlAttr(x.value)}"`).join('');
    return `<${name}${a}>`;
}

interface RewriteOptions {
    resolveCid?: (cid: string) => string | null;
    maxInlineImageChars: number;
    /** En la 2a pasada (tras sanear) se marcan las data: con data-bx-inline. */
    markInline: boolean;
}

/**
 * Reescribe el HTML por tokens: descarta lo peligroso/inutil, filtra atributos, resuelve cid, quita tracking y
 * devuelve un arbol equilibrado (sin cierres sueltos que escapen de la cita ni etiquetas abiertas al final).
 */
function rewriteQuotedHtml(html: string, opts: RewriteOptions): string {
    const out: string[] = [];
    const stack: string[] = [];
    let skipName = '';
    let skipCount = 0;

    const emitAlt = (alt: string) => { if (alt.trim()) out.push(escapeHtmlContent(`[${alt.trim()}]`)); };

    for (const tok of tokenizeHtml(html)) {
        if (skipName) {
            if (tok.type === 'open' && tok.name === skipName && !tok.selfClosing) skipCount++;
            else if (tok.type === 'close' && tok.name === skipName) { skipCount--; if (skipCount <= 0) skipName = ''; }
            else if (skipName === 'head' && tok.type === 'open' && tok.name === 'body') skipName = '';
            continue;
        }
        if (tok.type === 'comment') continue;
        if (tok.type === 'text') { out.push(tok.raw); continue; }

        if (tok.type === 'open') {
            const n = tok.name;
            if (DROP_WITH_CONTENT.has(n)) { if (!tok.selfClosing) { skipName = n; skipCount = 1; } continue; }
            if (DROP_VOID.has(n) || UNWRAP.has(n)) continue;

            if (n === 'img') {
                const alt = getAttr(tok, 'alt') || '';
                const src = (getAttr(tok, 'src') || '').trim();
                if (/^cid:/i.test(src)) {
                    const resolved = opts.resolveCid ? opts.resolveCid(src.slice(4).replace(/^<|>$/g, '')) : null;
                    if (!resolved || !/^data:image\//i.test(resolved)) { emitAlt(alt); continue; }
                    tok.attrs = tok.attrs.map((a) => (a.name === 'src' ? { name: 'src', value: resolved } : a));
                } else if (/^data:/i.test(src)) {
                    if (!/^data:image\/(?:png|jpe?g|gif|webp|bmp|avif|x-icon);base64,/i.test(src) || src.length > opts.maxInlineImageChars) { emitAlt(alt); continue; }
                } else if (isTrackingImage(tok.attrs)) {
                    continue;
                } else if (!/^(?:https?:)?\/\//i.test(src)) {
                    emitAlt(alt); // ruta relativa / esquema raro: no se puede mostrar
                    continue;
                }
            }

            const attrs: HtmlAttr[] = [];
            for (const a of tok.attrs) {
                const name = a.name;
                if (name.startsWith('on') || name.startsWith('data-bx-') || name === 'id' || name === 'srcdoc' || name === 'formaction' || name === 'ping' || name === 'srcset' || name === 'contenteditable' || name === 'autofocus') continue;
                if (URL_ATTRS.has(name) && isUnsafeUrl(a.value)) continue;
                if (name === 'style') { const s = cleanStyle(a.value); if (s.trim()) attrs.push({ name, value: s }); continue; }
                attrs.push(a);
            }
            if (n === 'img' && opts.markInline && /^data:image\//i.test((attrs.find((a) => a.name === 'src')?.value || ''))) {
                attrs.push({ name: INLINE_IMAGE_ATTR, value: '1' });
            }
            if (n === 'a' && attrs.some((a) => a.name === 'href')) {
                for (const k of ['target', 'rel']) { const i = attrs.findIndex((a) => a.name === k); if (i >= 0) attrs.splice(i, 1); }
                attrs.push({ name: 'target', value: '_blank' }, { name: 'rel', value: 'noopener noreferrer' });
            }
            out.push(serializeOpen(n, attrs));
            if (!VOID_TAGS.has(n) && !tok.selfClosing) stack.push(n);
            continue;
        }

        // cierre
        const n = tok.name;
        if (UNWRAP.has(n) || DROP_VOID.has(n) || VOID_TAGS.has(n)) continue;
        const idx = stack.lastIndexOf(n);
        if (idx === -1) continue; // cierre suelto: no puede cerrar la cita que lo contiene
        while (stack.length > idx + 1) out.push(`</${stack.pop()}>`);
        stack.pop();
        out.push(`</${n}>`);
    }
    while (stack.length) out.push(`</${stack.pop()}>`);
    return out.join('');
}

/**
 * Original -> HTML citable: limpieza previa, sanitizador inyectado (DOMPurify) y segunda limpieza que marca las
 * imagenes data: (`data-bx-inline="1"`) para que el servidor las convierta en adjuntos inline.
 */
export function cleanQuotedHtml(html: string, deps: ReplyDeps = {}): string {
    const ro = { resolveCid: deps.resolveCid, maxInlineImageChars: deps.maxInlineImageChars ?? DEFAULT_MAX_INLINE_IMAGE_CHARS };
    let out = rewriteQuotedHtml(String(html || ''), { ...ro, markInline: false });
    if (deps.sanitize) {
        try { out = deps.sanitize(out); } catch { out = escapeHtmlContent(htmlToPlainText(out)); }
    }
    return rewriteQuotedHtml(out, { ...ro, markInline: true });
}

// ---------------------------------------------------------------------------
// Recorte por tamano
// ---------------------------------------------------------------------------

export function utf8Length(value: string): number {
    let n = 0;
    for (let i = 0; i < value.length; i++) {
        const c = value.charCodeAt(i);
        if (c < 0x80) n += 1;
        else if (c < 0x800) n += 2;
        else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
        else n += 3;
    }
    return n;
}

const BLOCK_TAGS = new Set(['div', 'p', 'li', 'ul', 'ol', 'tr', 'table', 'tbody', 'thead', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'section', 'article']);

function trimMarker(deps: ReplyDeps): string {
    return `<div class="bx-quote-trimmed" style="font-style:italic">[...] ${escapeHtmlContent(tx(deps, 'mailView.replyQuote.trimmed'))}</div>`;
}

/**
 * Recorta el HTML (ya equilibrado) a `maxBytes` quitando el historial MAS ANTIGUO (el final), sin dejar etiquetas
 * abiertas, y anade un marcador visible. Prefiere cortar al inicio de una cita anidada / separador.
 */
export function trimHtmlToBytes(html: string, maxBytes: number, deps: ReplyDeps = {}): { html: string; trimmed: boolean } {
    if (utf8Length(html) <= maxBytes) return { html, trimmed: false };
    const marker = trimMarker(deps);
    const budget = Math.max(0, maxBytes - utf8Length(marker));
    const tokens = tokenizeHtml(html);

    interface Cut { index: number; bytes: number; closers: string[]; kind: 'quote' | 'block' }
    const stack: string[] = [];
    let bytes = 0;
    let bestQuote: Cut | null = null;
    let bestBlock: Cut | null = null;
    let closersBytes = 0;
    let textCut: { index: number; keep: string; bytes: number; closers: string[] } | null = null;

    const closersOf = () => stack.slice().reverse().map((n) => `</${n}>`);
    const candidate = (index: number, kind: 'quote' | 'block') => {
        if (bytes + closersBytes > budget) return;
        const c: Cut = { index, bytes, closers: closersOf(), kind };
        if (kind === 'quote' && bytes >= budget * 0.3) bestQuote = c;
        else bestBlock = c;
    };

    for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        const len = utf8Length(tok.type === 'comment' ? '' : tok.raw);
        if (bytes + len + closersBytes > budget) {
            if (tok.type === 'text') {
                // Corta el texto en un espacio (sin partir entidades).
                const room = budget - bytes - closersBytes;
                if (room > 0) {
                    let cut = tok.raw.slice(0, Math.min(tok.raw.length, room));
                    while (utf8Length(cut) > room) cut = cut.slice(0, -1);
                    const ws = cut.lastIndexOf(' ');
                    if (ws > 0) cut = cut.slice(0, ws);
                    const amp = cut.lastIndexOf('&');
                    if (amp !== -1 && cut.indexOf(';', amp) === -1) cut = cut.slice(0, amp);
                    if (cut.trim()) textCut = { index: i, keep: cut, bytes: bytes + utf8Length(cut), closers: closersOf() };
                }
            }
            break;
        }
        // Inicio de cita anidada / separador: buen sitio de corte (antes de abrirlo).
        if (tok.type === 'open' && (tok.name === 'blockquote' || tok.name === 'hr' || (tok.name === 'div' && /\bgmail_quote\b/.test(getAttr(tok, 'class') || '')))) {
            candidate(i, 'quote');
        }
        if (tok.type === 'open') {
            if (!VOID_TAGS.has(tok.name) && !tok.selfClosing) { stack.push(tok.name); closersBytes += tok.name.length + 3; }
        } else if (tok.type === 'close') {
            const idx = stack.lastIndexOf(tok.name);
            if (idx !== -1) {
                while (stack.length > idx) { const n = stack.pop()!; closersBytes -= n.length + 3; }
            }
        }
        bytes += len;
        if (tok.type === 'close' && BLOCK_TAGS.has(tok.name)) candidate(i + 1, 'block');
    }

    const join = (upTo: number) => tokens.slice(0, upTo).map((t) => (t.type === 'comment' ? '' : t.raw)).join('');
    let result: string;
    const q = bestQuote as Cut | null;
    const b = bestBlock as Cut | null;
    if (q) result = join(q.index) + q.closers.join('');
    else if (b && b.bytes >= budget * 0.5) result = join(b.index) + b.closers.join('');
    else if (textCut) result = join(textCut.index) + textCut.keep + textCut.closers.join('');
    else if (b) result = join(b.index) + b.closers.join('');
    else result = '';
    return { html: result + marker, trimmed: true };
}

// ---------------------------------------------------------------------------
// Texto plano
// ---------------------------------------------------------------------------

/** Prefija cada linea con "> " (linea en blanco -> ">"). */
export function quotePlainText(text: string): string {
    return text.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
}

// ---------------------------------------------------------------------------
// Responder
// ---------------------------------------------------------------------------

function prepareContent(contentHtml: string, deps: ReplyDeps): string {
    const max = deps.maxQuoteBytes ?? DEFAULT_MAX_QUOTE_BYTES;
    // Historiales de varios MB: se recorta ANTES de sanear (DOMPurify sobre megabytes es lento). El margen x4 cubre lo que el saneado quita
    // (estilos, comentarios, atributos); el recorte final ajusta al tope exacto y, al cortar por el final, se lleva el marcador previo.
    const raw = utf8Length(contentHtml) > max * 4 ? trimHtmlToBytes(contentHtml, max * 4, deps).html : contentHtml;
    const cleaned = cleanQuotedHtml(raw, deps);
    return trimHtmlToBytes(cleaned, max, deps).html;
}

function dateOf(source: QuoteSource, deps: ReplyDeps): string {
    return deps.formatDate ? deps.formatDate(source.createdAt) : formatLongDate(source.createdAt, deps.locale, deps.timeZone);
}

/** Cita para RESPONDER / RESPONDER A TODOS. */
export function buildReplyQuote(source: QuoteSource, contentHtml: string, deps: ReplyDeps = {}): QuoteResult {
    const attribution = tx(deps, 'emailList.quoteHeader', { date: dateOf(source, deps), from: displayFrom(source.from) });
    const content = prepareContent(contentHtml, deps);
    const html = `<div class="gmail_quote"><div dir="ltr" class="gmail_attr">${escapeHtmlContent(attribution)}<br></div><blockquote class="gmail_quote" style="${BLOCKQUOTE_STYLE}">${content}</blockquote></div>`;
    const quoted = quotePlainText(htmlToPlainText(content));
    return { html, text: `${attribution}\n${quoted}`, body: `<p></p>${html}` };
}

// ---------------------------------------------------------------------------
// Reenviar
// ---------------------------------------------------------------------------

export function getStoredForwardStyle(): ForwardStyle {
    try {
        if (typeof localStorage === 'undefined') return 'gmail';
        return localStorage.getItem(FORWARD_STYLE_STORAGE_KEY) === 'outlook' ? 'outlook' : 'gmail';
    } catch {
        return 'gmail';
    }
}

/** Cita para REENVIAR (bloque "Forwarded message" estilo Gmail u Outlook). */
export function buildForwardQuote(source: QuoteSource, contentHtml: string, deps: ReplyDeps = {}): QuoteResult {
    const style: ForwardStyle = deps.forwardStyle || getStoredForwardStyle();
    const content = prepareContent(contentHtml, deps);
    const date = dateOf(source, deps);
    const parsed = parseFromHeader(source.from);
    const subject = String(source.subject || '');
    const to = String(source.to || '');
    const cc = String(source.cc || '');
    const L = {
        title: tx(deps, 'mailView.replyQuote.fwdTitle'),
        from: tx(deps, 'mailView.replyQuote.from'),
        date: tx(deps, 'mailView.replyQuote.date'),
        sent: tx(deps, 'mailView.replyQuote.sent'),
        subject: tx(deps, 'mailView.replyQuote.subject'),
        to: tx(deps, 'mailView.replyQuote.to'),
        cc: tx(deps, 'mailView.replyQuote.cc'),
    };
    const e = escapeHtmlContent;
    const bodyText = htmlToPlainText(content);

    if (style === 'outlook') {
        const lines: string[] = [`<b>${e(L.from)}:</b> ${e(displayFrom(source.from))}`, `<b>${e(L.sent)}:</b> ${e(date)}`, `<b>${e(L.to)}:</b> ${e(to)}`];
        if (cc) lines.push(`<b>${e(L.cc)}:</b> ${e(cc)}`);
        lines.push(`<b>${e(L.subject)}:</b> ${e(subject)}`);
        const html = `<hr style="display:inline-block;width:98%" tabindex="-1"><div id="divRplyFwdMsg" dir="ltr"><font face="Calibri, sans-serif" style="font-size:11pt" color="#000000">${lines.join('<br>')}</font><div>&nbsp;</div></div><div class="bx-fwd-body">${content}</div>`;
        const textHeader = [`${L.from}: ${displayFrom(source.from)}`, `${L.sent}: ${date}`, `${L.to}: ${to}`, ...(cc ? [`${L.cc}: ${cc}`] : []), `${L.subject}: ${subject}`].join('\n');
        return { html, text: `________________________________\n${textHeader}\n\n${bodyText}`, body: `<p></p>${html}` };
    }

    const fromHtml = parsed.name && parsed.email
        ? `<strong class="gmail_sendername" dir="auto">${e(parsed.name)}</strong> <span dir="auto">&lt;${e(parsed.email)}&gt;</span>`
        : `<strong class="gmail_sendername" dir="auto">${e(parsed.name || parsed.email || source.from)}</strong>`;
    const rows = [`---------- ${e(L.title)} ---------`, `${e(L.from)}: ${fromHtml}`, `${e(L.date)}: ${e(date)}`, `${e(L.subject)}: ${e(subject)}`, `${e(L.to)}: ${e(to)}`];
    if (cc) rows.push(`${e(L.cc)}: ${e(cc)}`);
    const html = `<div class="gmail_quote"><div dir="ltr" class="gmail_attr">${rows.join('<br>')}<br></div><br><br>${content}</div>`;
    const textHeader = [`---------- ${L.title} ---------`, `${L.from}: ${displayFrom(source.from)}`, `${L.date}: ${date}`, `${L.subject}: ${subject}`, `${L.to}: ${to}`, ...(cc ? [`${L.cc}: ${cc}`] : [])].join('\n');
    return { html, text: `${textHeader}\n\n${bodyText}`, body: `<p></p>${html}` };
}

// ---------------------------------------------------------------------------
// Asuntos
// ---------------------------------------------------------------------------

// UNA sola definicion de prefijos y asuntos salientes para UI, servidor y SQL: lib/threading.ts.
export { buildReplySubject, buildForwardSubject } from '@/lib/threading';

/** Quita todo el prefijo acumulado; devuelve el asunto base y el prefijo mas externo (minusculas) si lo habia. */
export function stripSubjectPrefixes(subject: string): { base: string; outer: string } {
    return { base: stripReplyForwardPrefixes(subject), outer: leadingPrefixWord(subject) || '' };
}

