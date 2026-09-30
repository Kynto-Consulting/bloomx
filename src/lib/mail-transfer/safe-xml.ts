/**
 * safe-xml.ts - lector XML MINIMO y SEGURO para entrada no confiable (mailFilters.xml de Gmail, .olm de Outlook Mac).
 *
 * Diseno defensivo (sin XXE ni "billion laughs"):
 *  - NO admite DOCTYPE/DTD: cualquier `<!DOCTYPE` o `<!ENTITY` aborta con XmlError('xml_doctype'). Por tanto no existen
 *    entidades definidas por el documento ni externas (SYSTEM/PUBLIC) ni parametricas;
 *  - solo entidades predefinidas (&lt; &gt; &amp; &quot; &apos;) y referencias numericas &#N; / &#xH; (validadas);
 *    el resto de `&nombre;` se deja literal (nunca se resuelve ni se descarga nada);
 *  - limites: tamano del documento, profundidad, nº de nodos, nº de atributos por elemento y longitud de nombres/valores;
 *  - sin E/S: recibe un string y devuelve un arbol de objetos planos (sin prototipos peligrosos).
 */

export class XmlError extends Error {
    constructor(public code: string) {
        super(code);
        this.name = 'XmlError';
    }
}

export interface XmlElement {
    name: string;
    /** Nombre sin prefijo de espacio de nombres (`gmail:label` -> `label`). */
    local: string;
    attrs: Record<string, string>;
    children: Array<XmlElement | string>;
}

export interface XmlLimits {
    maxBytes: number;
    maxDepth: number;
    maxNodes: number;
    maxAttrs: number;
    maxTextBytes: number;
}

export const DEFAULT_XML_LIMITS: XmlLimits = {
    maxBytes: 32 * 1024 * 1024,
    maxDepth: 64,
    maxNodes: 500_000,
    maxAttrs: 64,
    maxTextBytes: 16 * 1024 * 1024,
};

const NAME_START = /[A-Za-z_:À-￿]/;
const NAME_CHAR = /[A-Za-z0-9_:.\-·À-￿]/;

function decodeEntities(s: string): string {
    if (!s.includes('&')) return s;
    return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|lt|gt|amp|quot|apos);/g, (whole, body: string) => {
        switch (body) {
            case 'lt': return '<';
            case 'gt': return '>';
            case 'amp': return '&';
            case 'quot': return '"';
            case 'apos': return "'";
        }
        const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        // Solo caracteres validos de XML 1.0 (sin controles ni sustitutos)
        if (!Number.isFinite(code) || code > 0x10ffff || (code < 0x20 && code !== 9 && code !== 10 && code !== 13) || (code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff) return '�';
        return String.fromCodePoint(code);
    });
}

/** Decodifica bytes a texto (UTF-8 por defecto; UTF-16 con BOM; declaracion de encoding latin1/windows-1252). */
export function xmlBytesToString(buf: Buffer): string {
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
    if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
        const swapped = Buffer.from(buf.subarray(2));
        swapped.swap16();
        return swapped.toString('utf16le');
    }
    const start = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0;
    const head = buf.toString('latin1', start, Math.min(buf.length, start + 200));
    const enc = /^<\?xml[^>]*encoding\s*=\s*["']([A-Za-z0-9._-]+)["']/i.exec(head)?.[1]?.toLowerCase();
    if (enc && /^(iso-8859-1|latin1|windows-1252|cp1252|us-ascii)$/.test(enc)) return buf.toString('latin1', start);
    return buf.toString('utf8', start);
}

/** Analiza un documento XML. Lanza XmlError si es invalido, excede limites o declara DOCTYPE/ENTITY. */
export function parseXml(input: string | Buffer, limits: Partial<XmlLimits> = {}): XmlElement {
    const lim = { ...DEFAULT_XML_LIMITS, ...limits };
    if ((typeof input === 'string' ? Buffer.byteLength(input) : input.length) > lim.maxBytes) throw new XmlError('xml_too_large');
    const s = typeof input === 'string' ? input : xmlBytesToString(input);
    let i = 0;
    let nodes = 0;
    let textBytes = 0;
    const root: XmlElement = { name: '#document', local: '#document', attrs: Object.create(null), children: [] };
    const stack: XmlElement[] = [root];
    const n = s.length;

    const readName = (): string => {
        const st = i;
        if (i >= n || !NAME_START.test(s[i])) throw new XmlError('xml_bad_name');
        i++;
        while (i < n && NAME_CHAR.test(s[i])) i++;
        if (i - st > 256) throw new XmlError('xml_bad_name');
        return s.slice(st, i);
    };
    const skipWs = () => { while (i < n && (s[i] === ' ' || s[i] === '\n' || s[i] === '\r' || s[i] === '\t')) i++; };

    while (i < n) {
        const lt = s.indexOf('<', i);
        if (lt < 0) {
            const tail = s.slice(i);
            if (tail.trim()) {
                if (stack.length === 1) throw new XmlError('xml_text_outside_root');
                throw new XmlError('xml_unclosed');
            }
            i = n;
            break;
        }
        if (lt > i) {
            const raw = s.slice(i, lt);
            if (stack.length > 1) {
                textBytes += raw.length;
                if (textBytes > lim.maxTextBytes) throw new XmlError('xml_too_large');
                stack[stack.length - 1].children.push(decodeEntities(raw));
            } else if (raw.trim()) {
                throw new XmlError('xml_text_outside_root');
            }
        }
        i = lt;
        if (s.startsWith('<!--', i)) {
            const end = s.indexOf('-->', i + 4);
            if (end < 0) throw new XmlError('xml_unclosed');
            i = end + 3;
            continue;
        }
        if (s.startsWith('<![CDATA[', i)) {
            const end = s.indexOf(']]>', i + 9);
            if (end < 0) throw new XmlError('xml_unclosed');
            if (stack.length === 1) throw new XmlError('xml_text_outside_root');
            const raw = s.slice(i + 9, end);
            textBytes += raw.length;
            if (textBytes > lim.maxTextBytes) throw new XmlError('xml_too_large');
            stack[stack.length - 1].children.push(raw);
            i = end + 3;
            continue;
        }
        if (s.startsWith('<!', i)) {
            // <!DOCTYPE, <!ENTITY, <!ELEMENT...: jamas se procesan
            throw new XmlError('xml_doctype');
        }
        if (s.startsWith('<?', i)) {
            const end = s.indexOf('?>', i + 2);
            if (end < 0) throw new XmlError('xml_unclosed');
            i = end + 2;
            continue;
        }
        if (s.startsWith('</', i)) {
            i += 2;
            const name = readName();
            skipWs();
            if (s[i] !== '>') throw new XmlError('xml_bad_tag');
            i++;
            const top = stack.pop();
            if (!top || stack.length === 0 || top.name !== name) throw new XmlError('xml_mismatched');
            continue;
        }
        // Etiqueta de apertura
        i++;
        const name = readName();
        if (++nodes > lim.maxNodes) throw new XmlError('xml_too_many_nodes');
        const attrs: Record<string, string> = Object.create(null);
        let count = 0;
        let selfClose = false;
        for (;;) {
            skipWs();
            if (i >= n) throw new XmlError('xml_unclosed');
            if (s[i] === '>') { i++; break; }
            if (s[i] === '/' && s[i + 1] === '>') { i += 2; selfClose = true; break; }
            const an = readName();
            skipWs();
            if (s[i] !== '=') throw new XmlError('xml_bad_attr');
            i++;
            skipWs();
            const q = s[i];
            if (q !== '"' && q !== "'") throw new XmlError('xml_bad_attr');
            const end = s.indexOf(q, i + 1);
            if (end < 0) throw new XmlError('xml_unclosed');
            const val = s.slice(i + 1, end);
            if (val.includes('<')) throw new XmlError('xml_bad_attr');
            if (++count > lim.maxAttrs) throw new XmlError('xml_too_many_attrs');
            if (an === '__proto__') { i = end + 1; continue; }
            attrs[an] = decodeEntities(val).slice(0, 64 * 1024);
            i = end + 1;
        }
        const colon = name.indexOf(':');
        const el: XmlElement = { name, local: colon >= 0 ? name.slice(colon + 1) : name, attrs, children: [] };
        if (stack.length === 1 && stack[0].children.some((c) => typeof c !== 'string')) throw new XmlError('xml_multiple_roots');
        stack[stack.length - 1].children.push(el);
        if (!selfClose) {
            if (stack.length > lim.maxDepth) throw new XmlError('xml_too_deep');
            stack.push(el);
        }
    }
    if (stack.length !== 1) throw new XmlError('xml_unclosed');
    const rootEl = root.children.find((c): c is XmlElement => typeof c !== 'string');
    if (!rootEl) throw new XmlError('xml_empty');
    return rootEl;
}

/** Hijos elemento (opcionalmente solo los de nombre local `local`). */
export function childElements(el: XmlElement, local?: string): XmlElement[] {
    return el.children.filter((c): c is XmlElement => typeof c !== 'string' && (!local || c.local === local));
}

export function firstChild(el: XmlElement | null | undefined, local: string): XmlElement | null {
    return el ? childElements(el, local)[0] ?? null : null;
}

/** Texto concatenado de un elemento (incluye descendientes). */
export function textOf(el: XmlElement | null | undefined): string {
    if (!el) return '';
    let out = '';
    for (const c of el.children) out += typeof c === 'string' ? c : textOf(c);
    return out;
}

/** Descendientes (profundidad primero) con ese nombre local, hasta `max`. */
export function findAll(el: XmlElement, local: string, max = 100_000): XmlElement[] {
    const out: XmlElement[] = [];
    const walk = (e: XmlElement) => {
        for (const c of e.children) {
            if (typeof c === 'string') continue;
            if (c.local === local) { out.push(c); if (out.length >= max) return; }
            if (out.length >= max) return;
            walk(c);
        }
    };
    walk(el);
    return out;
}

/** Escapa texto para generar XML. */
export function escapeXml(v: string): string {
    // eslint-disable-next-line no-control-regex
    return String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
