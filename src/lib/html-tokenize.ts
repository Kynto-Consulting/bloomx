/**
 * Tokenizador HTML minimo, puro y sin DOM (isomorfo: servidor y cliente).
 * No valida ni corrige el arbol: solo parte el texto en tokens para poder (a) convertir a texto plano
 * (html-to-text.ts) y (b) limpiar / recortar el HTML de una cita (reply-builder.ts) sin depender de jsdom.
 */

export interface HtmlAttr { name: string; value: string }

export type HtmlToken =
    | { type: 'text'; raw: string }
    | { type: 'open'; name: string; attrs: HtmlAttr[]; raw: string; selfClosing: boolean }
    | { type: 'close'; name: string; raw: string }
    /** Comentarios, doctype, `<![if ...]>`, `<?xml ?>`: nunca aportan contenido visible. */
    | { type: 'comment'; raw: string };

export const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT_TAGS = new Set(['script', 'style']);

function parseAttrs(inner: string): HtmlAttr[] {
    const attrs: HtmlAttr[] = [];
    const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(inner))) {
        attrs.push({ name: m[1].toLowerCase(), value: decodeEntities(m[2] ?? m[3] ?? m[4] ?? '') });
    }
    return attrs;
}

/** Indice del `>` que cierra la etiqueta que empieza en `start`, respetando comillas; -1 si no cierra. */
function findTagEnd(html: string, start: number): number {
    let quote = '';
    for (let i = start; i < html.length; i++) {
        const c = html[i];
        if (quote) { if (c === quote) quote = ''; continue; }
        if (c === '"' || c === "'") {
            // Solo abre comilla si va tras un '=' (evita que un apostrofe suelto trague la etiqueta).
            let j = i - 1;
            while (j > start && /\s/.test(html[j])) j--;
            if (html[j] === '=') quote = c;
            continue;
        }
        if (c === '>') return i;
    }
    return -1;
}

export function tokenizeHtml(html: string): HtmlToken[] {
    const tokens: HtmlToken[] = [];
    const len = html.length;
    let i = 0;
    let textStart = 0;
    const pushText = (end: number) => {
        if (end > textStart) tokens.push({ type: 'text', raw: html.slice(textStart, end) });
    };
    while (i < len) {
        const lt = html.indexOf('<', i);
        if (lt === -1) break;
        const next = html[lt + 1] || '';
        if (next === '!' || next === '?') {
            pushText(lt);
            let end: number;
            if (html.startsWith('<!--', lt)) {
                const close = html.indexOf('-->', lt + 4);
                end = close === -1 ? len : close + 3;
            } else {
                const close = html.indexOf('>', lt + 2);
                end = close === -1 ? len : close + 1;
            }
            tokens.push({ type: 'comment', raw: html.slice(lt, end) });
            i = textStart = end;
            continue;
        }
        if (next === '/' && /[a-zA-Z]/.test(html[lt + 2] || '')) {
            const end = findTagEnd(html, lt + 2);
            pushText(lt);
            if (end === -1) { tokens.push({ type: 'text', raw: '&lt;' }); textStart = i = lt + 1; continue; }
            const name = (/^[a-zA-Z][^\s>\/]*/.exec(html.slice(lt + 2, end)) || [''])[0].toLowerCase();
            tokens.push({ type: 'close', name, raw: html.slice(lt, end + 1) });
            i = textStart = end + 1;
            continue;
        }
        if (/[a-zA-Z]/.test(next)) {
            const end = findTagEnd(html, lt + 1);
            pushText(lt);
            if (end === -1) { tokens.push({ type: 'text', raw: '&lt;' }); textStart = i = lt + 1; continue; }
            const body = html.slice(lt + 1, end);
            const nameMatch = /^[a-zA-Z][^\s>\/]*/.exec(body)!;
            const name = nameMatch[0].toLowerCase();
            const selfClosing = /\/\s*$/.test(body);
            tokens.push({ type: 'open', name, attrs: parseAttrs(body.slice(nameMatch[0].length)), raw: html.slice(lt, end + 1), selfClosing });
            i = textStart = end + 1;
            if (RAW_TEXT_TAGS.has(name) && !selfClosing) {
                const closeRe = new RegExp(`</${name}[\\s>/]`, 'i');
                const m = closeRe.exec(html.slice(i));
                const stop = m ? i + m.index : len;
                if (stop > i) tokens.push({ type: 'text', raw: html.slice(i, stop) });
                i = textStart = stop;
            }
            continue;
        }
        // '<' suelto: es texto.
        pushText(lt);
        tokens.push({ type: 'text', raw: '&lt;' });
        i = textStart = lt + 1;
    }
    pushText(len);
    return tokens;
}

const NAMED_ENTITIES: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™',
    hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
    sbquo: '‚', bdquo: '„', bull: '•', middot: '·', euro: '€', pound: '£', yen: '¥', cent: '¢',
    laquo: '«', raquo: '»', times: '×', divide: '÷', deg: '°', plusmn: '±', para: '¶', sect: '§',
    iexcl: '¡', iquest: '¿', shy: '', zwnj: '‌', zwj: '‍', ensp: ' ', emsp: ' ', thinsp: ' ',
    larr: '←', rarr: '→', uarr: '↑', darr: '↓',
    aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
    Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü',
    agrave: 'à', egrave: 'è', igrave: 'ì', ograve: 'ò', ugrave: 'ù', acirc: 'â', ecirc: 'ê',
    icirc: 'î', ocirc: 'ô', ucirc: 'û', atilde: 'ã', otilde: 'õ', auml: 'ä', euml: 'ë',
    iuml: 'ï', ouml: 'ö', ccedil: 'ç', Ccedil: 'Ç', szlig: 'ß', aring: 'å', aelig: 'æ', oslash: 'ø',
    Auml: 'Ä', Ouml: 'Ö', Agrave: 'À', Egrave: 'È',
};

/** Decodifica entidades numericas (&#233; &#xE9;) y las nombradas mas comunes en correo. Lo desconocido se deja tal cual. */
export function decodeEntities(value: string): string {
    if (value.indexOf('&') === -1) return value;
    return value.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,9});/g, (whole, body: string) => {
        if (body[0] === '#') {
            const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
            if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
            try { return String.fromCodePoint(code); } catch { return ''; }
        }
        return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : whole;
    });
}

export function escapeHtmlAttr(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeHtmlContent(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function getAttr(token: { attrs: HtmlAttr[] }, name: string): string | undefined {
    const a = token.attrs.find((x) => x.name === name);
    return a ? a.value : undefined;
}
