/**
 * Escaner de HTML LINEAL (sin regex con cuantificadores perezosos sobre entrada hostil). El motor de spam corre en la ruta de entrada del
 * webhook: con cuerpos como `'<a '.repeat(100000)` una regex `<a[^>]*?...` seria cuadratica. Aqui cada posicion se examina una sola
 * vez, las etiquetas tienen un largo maximo y el numero de etiquetas esta acotado.
 */

export interface Tag { name: string; closing: boolean; attrs: string; start: number; end: number }

export const MAX_TAG_LEN = 4000;
export const MAX_TAGS = 30_000;

/** Devuelve las etiquetas (abiertas y de cierre) en orden, sin interpretar comentarios ni CDATA dentro de ellas. */
export function scanTags(html: string, limit = MAX_TAGS): Tag[] {
    const out: Tag[] = [];
    const n = html.length;
    let pos = 0;
    let gt = -2; // cache del siguiente '>' (evita reexplorar)
    while (pos < n && out.length < limit) {
        const lt = html.indexOf('<', pos);
        if (lt < 0) break;
        if (html.startsWith('<!--', lt)) {
            const close = html.indexOf('-->', lt + 4);
            pos = close < 0 ? n : close + 3;
            continue;
        }
        if (gt < lt) { gt = html.indexOf('>', lt); if (gt < 0) break; }
        if (gt - lt > MAX_TAG_LEN) { pos = lt + 1; continue; }
        const inner = html.slice(lt + 1, gt);
        const m = /^(\/?)([a-zA-Z][a-zA-Z0-9:-]{0,30})(?=[\s/]|$)/.exec(inner);
        if (!m) { pos = lt + 1; continue; }
        out.push({ name: m[2].toLowerCase(), closing: m[1] === '/', attrs: inner.slice(m[0].length), start: lt, end: gt + 1 });
        pos = gt + 1;
    }
    return out;
}

/** Valor de un atributo dentro de la cadena de atributos de una etiqueta (comillas dobles, simples o sin comillas). Acotado. */
export function attrValue(attrs: string, name: string): string | null {
    const a = attrs.length > MAX_TAG_LEN ? attrs.slice(0, MAX_TAG_LEN) : attrs;
    const lower = a.toLowerCase();
    let from = 0;
    for (let guard = 0; guard < 40; guard++) {
        const i = lower.indexOf(name, from);
        if (i < 0) return null;
        from = i + name.length;
        const before = i === 0 ? ' ' : a[i - 1];
        if (!/[\s"'/]/.test(before)) continue;
        let j = from;
        while (j < a.length && /\s/.test(a[j])) j++;
        if (a[j] !== '=') continue;
        j++;
        while (j < a.length && /\s/.test(a[j])) j++;
        const q = a[j];
        if (q === '"' || q === "'") {
            const end = a.indexOf(q, j + 1);
            return a.slice(j + 1, end < 0 ? a.length : end);
        }
        let k = j;
        while (k < a.length && !/\s/.test(a[k])) k++;
        return a.slice(j, k);
    }
    return null;
}

const SKIP_CONTENT = new Set(['script', 'style', 'head', 'title', 'noscript']);
const BLOCK = new Set(['br', 'p', 'div', 'tr', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** Texto visible aproximado (sin script/style/head/comentarios): una pasada sobre las etiquetas. */
export function htmlToText(html: string): string {
    const src = html.length > 200_000 ? html.slice(0, 200_000) : html;
    const tags = scanTags(src);
    let out = '';
    let pos = 0;
    for (let i = 0; i < tags.length; i++) {
        const t = tags[i];
        if (t.start < pos) continue;
        out += src.slice(pos, t.start);
        pos = t.end;
        if (!t.closing && SKIP_CONTENT.has(t.name)) {
            // salta hasta la etiqueta de cierre correspondiente (o hasta el final)
            let j = i + 1;
            while (j < tags.length && !(tags[j].closing && tags[j].name === t.name)) j++;
            if (j < tags.length) { pos = tags[j].end; i = j; } else { pos = src.length; break; }
            out += ' ';
            continue;
        }
        out += BLOCK.has(t.name) && (t.closing || t.name === 'br') ? '\n' : ' ';
    }
    out += src.slice(pos);
    return out;
}

/** Texto de un elemento: desde el fin de su etiqueta de apertura hasta su cierre (acotado a `max` caracteres), sin etiquetas. */
export function innerTextAfter(html: string, tag: Tag, max = 4000): string {
    const close = html.indexOf(`</${tag.name}`, tag.end);
    const end = close < 0 || close - tag.end > max ? Math.min(html.length, tag.end + max) : close;
    const raw = html.slice(tag.end, end);
    let out = '';
    let inTag = false;
    for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (c === '<') inTag = true;
        else if (c === '>' && inTag) { inTag = false; out += ' '; }
        else if (!inTag) out += c;
    }
    return out.replace(/\s+/g, ' ').trim();
}
