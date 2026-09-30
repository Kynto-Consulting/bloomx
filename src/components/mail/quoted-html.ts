// Separa el texto citado (respuestas anteriores) del resto de un correo HTML para poder plegarlo tras un "...".
// Trabaja sobre HTML ya saneado; solo en el cliente (usa <template>). Devuelve null si no hay nada que plegar.
//
// REGLA DE ORO: nunca se deja un mensaje sin contenido visible. Si tras quitar la cita lo que queda no tiene texto
// legible (solo <style>/<title>/comentarios/espacios/<br>/nodos ocultos/caracteres de ancho cero) ni imagenes reales,
// se devuelve null y el mensaje se muestra completo.

import {
    countMessageStarts, hasReadableOutsideSignature, isAttributionLine, isHeaderBlockAt, isMobileSignatureLine, isSeparatorLine,
    isSignatureDelimiter, isUnderscoreRule, splitQuotedText,
} from './quoted-text';

// Contenedores de cita propios de cada cliente (el elemento ENTERO es historial):
//   Gmail/Samsung/Spark: .gmail_quote (+ .gmail_quote_container, .gmail_attr)   Apple Mail/Thunderbird/iCloud: blockquote[type=cite]
//   Thunderbird: div.moz-cite-prefix, .moz-forward-container   Yahoo: .yahoo_quoted, #yahoo_quoted_*, .yahoo-quoted-begin
//   Proton: .protonmail_quote   Zoho: .zmail_quote (y .zmail_extra si contiene una cita)   Titan/Flock/otros: ver clase generica
const CONTAINER_SELECTORS = [
    '.gmail_quote', '.gmail_quote_container', '.gmail_attr',
    'blockquote[type="cite"]', 'div.moz-cite-prefix', '.moz-forward-container',
    '.yahoo_quoted', '[id^="yahoo_quoted"]', '.yahoo_quoted_msg', '.yahoo-quoted-begin',
    '.protonmail_quote', '.zmail_quote',
].join(',');
/** Marcadores tras los cuales TODO lo que sigue es historial (el cuerpo citado es hermano, no hijo). */
const TAIL_MARKERS = '#divRplyFwdMsg,.OutlookMessageHeader';
const WEAK_TAIL_MARKER = '#appendonsend';
/** Bloques de firma que se conservan y no cuentan como contenido propio. */
const SIGNATURE_SELECTOR = [
    '.gmail_signature', '[data-smartmail="gmail_signature"]', '.moz-signature', '.protonmail_signature_block', '#Signature', '#x_Signature',
    '#ms-outlook-mobile-signature', '#composer_signature', '.yahoo_signature', '#ymail_android_signature', '[id^="ymail_"][id$="signature"]', '.zmail_signature', '.apple-signature',
].join(',');
/** Clase generica de cita ("titan-quote", "spark_quote", "quoted-reply"...): solo vale en posicion final o tras una atribucion. */
const GENERIC_QUOTE_CLASS = /(?:^|[_-])(?:quote|quoted|quotation|cite|citation|replied)(?:$|[_-])/i;
const BLOCK_TAGS = new Set(['DIV', 'P', 'TABLE', 'TR', 'TD', 'TH', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'HR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'ADDRESS', 'CENTER', 'DL', 'DT', 'DD', 'FIELDSET', 'FORM', 'BODY', 'HTML']);

/** Elementos cuyo texto nunca se ve. */
const NON_RENDERED = new Set(['STYLE', 'SCRIPT', 'TITLE', 'TEMPLATE', 'NOSCRIPT', 'HEAD', 'META', 'LINK', 'BASE', 'DATALIST', 'OPTION']);
/** Espacios "invisibles" que \s no cubre (ancho cero, joiners, BOM, relleno de preheader) mas nbsp y similares. */
const INVISIBLE_CHARS = /[\s\u00a0\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u2028-\u202f\u2060-\u206f\u3164\ufeff\uffa0]/g;

/** true si el estilo en linea oculta el elemento (display:none, visibility:hidden, tamano 0 con overflow oculto, opacity:0). */
function hiddenByStyle(el: Element): boolean {
    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return true;
    const style = (el.getAttribute('style') || '').toLowerCase().replace(/\s+/g, '');
    if (!style) return false;
    if (/display:none|visibility:hidden|opacity:0(?![.\d])|font-size:0(px|pt|em|%)?(;|$)/.test(style)) return true;
    if (/(max-height|height):0(px|pt|em)?(;|$)/.test(style) && /overflow:hidden/.test(style)) return true;
    if (/mso-hide:all/.test(style)) return true;
    return false;
}

/** Imagen "real": no es un pixel de seguimiento ni un espaciador de 1-2 px. */
function isRealImage(img: Element): boolean {
    if (hiddenByStyle(img)) return false;
    const dim = (attr: string) => {
        const v = img.getAttribute(attr);
        const n = v ? parseInt(v, 10) : NaN;
        return Number.isFinite(n) ? n : null;
    };
    const w = dim('width');
    const h = dim('height');
    if ((w !== null && w <= 2) || (h !== null && h <= 2)) return false;
    return Boolean(img.getAttribute('src'));
}

/** Longitud del texto REALMENTE visible (sin style/script/title/ocultos/comentarios/espacios/ancho cero). */
export function visibleTextLength(root: Node): number {
    let total = 0;
    const walk = (node: Node) => {
        if (node.nodeType === 3) {
            total += (node.nodeValue || '').replace(INVISIBLE_CHARS, '').length;
            return;
        }
        if (node.nodeType !== 1 && node.nodeType !== 11) return; // comentarios y demas: no cuentan
        if (node.nodeType === 1) {
            const el = node as Element;
            if (NON_RENDERED.has(el.tagName) || hiddenByStyle(el)) return;
        }
        node.childNodes.forEach(walk);
    };
    walk(root);
    return total;
}

/** true si queda algo que el lector realmente ve: texto legible o una imagen real. */
export function hasVisibleContent(root: DocumentFragment | HTMLElement): boolean {
    if (visibleTextLength(root) > 0) return true;
    return Array.from(root.querySelectorAll('img')).some((img) => isRealImage(img) && !img.closest('style,script,template,[hidden]'));
}

/** true si un HTML (ya saneado) tiene algo visible. En servidor (sin DOM) asume que si, para no mostrar un vacio falso. */
export function htmlHasVisibleContent(html: string): boolean {
    if (typeof document === 'undefined') return true;
    const tpl = document.createElement('template');
    tpl.innerHTML = html || '';
    return hasVisibleContent(tpl.content);
}

export interface QuotedSplit {
    /** HTML sin el bloque citado (ni su linea "El ..., X escribio:"). */
    main: string;
    /** Cantidad de bloques citados plegados. */
    blocks: number;
    /** HTML retirado (historial), por si se quiere mostrar aparte. */
    quotedHtml?: string;
    /** Texto legible del historial retirado (espacios normalizados). */
    quotedText?: string;
    /** Texto legible del contenido propio que queda (para comparar con otros mensajes del hilo). */
    mainText?: string;
    /** Profundidad del historial: mensajes anteriores anidados (1 = una sola cita). */
    levels?: number;
}

// --- Utilidades de nodos --------------------------------------------------------------------------------------------
const normSpace = (s: string) => s.replace(/\s+/g, ' ').trim();
const isEl = (n: Node): n is Element => n.nodeType === 1;
const isBr = (n: Node) => n.nodeName === 'BR';
const isBlockEl = (n: Node) => isEl(n) && BLOCK_TAGS.has(n.tagName);
const isNonRenderedEl = (n: Node) => isEl(n) && (NON_RENDERED.has(n.tagName) || hiddenByStyle(n));

/** Nodo sin nada que el lector vea (espacios, comentarios, <style>, <br>, <hr>, contenedores vacios). */
function isIgnorable(n: Node): boolean {
    if (n.nodeType === 8) return true;
    if (n.nodeType === 3) return visibleTextLength(n) === 0;
    if (!isEl(n)) return true;
    if (NON_RENDERED.has(n.tagName) || hiddenByStyle(n)) return true;
    return !hasVisibleContent(n as HTMLElement);
}

function serialize(n: Node): string {
    if (isEl(n)) return n.outerHTML;
    if (n.nodeType === 3) { const d = document.createElement('div'); d.textContent = n.nodeValue || ''; return d.innerHTML; }
    return '';
}

interface Line { text: string; node: Node }
/** Lineas de texto visible en orden de documento; cada una recuerda su primer nodo de texto (punto de corte). */
function linearize(root: Node): Line[] {
    const out: Line[] = [];
    let cur = '';
    let first: Node | null = null;
    const flush = () => {
        const text = cur.replace(/\s+/g, ' ').trim();
        if (text && first) out.push({ text, node: first });
        cur = ''; first = null;
    };
    const walk = (n: Node) => {
        if (n.nodeType === 3) {
            const v = n.nodeValue || '';
            if (visibleTextLength(n) > 0 && !first) first = n;
            cur += v;
            return;
        }
        if (n.nodeType !== 1 && n.nodeType !== 11) return;
        if (isEl(n)) {
            if (NON_RENDERED.has(n.tagName) || hiddenByStyle(n)) return;
            if (isBr(n)) { flush(); return; }
            const block = BLOCK_TAGS.has(n.tagName);
            if (block) flush();
            n.childNodes.forEach(walk);
            if (block) flush();
            return;
        }
        n.childNodes.forEach(walk);
    };
    walk(root);
    flush();
    return out;
}

/** Texto legible de un HTML (lineas unidas con salto), o el texto tal cual si es solo un <pre>. Para comparar mensajes. */
export function htmlToComparableText(html: string): string {
    if (typeof document === 'undefined' || !html) return '';
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const pre = plainPre(tpl.content);
    if (pre) return pre.textContent || '';
    return linearize(tpl.content).map((l) => l.text).join('\n');
}

/** Si el fragmento es solo un <pre> (asi llegan los correos text/plain), lo devuelve. */
function plainPre(frag: DocumentFragment): Element | null {
    const meaningful = Array.from(frag.childNodes).filter((n) => !isIgnorable(n));
    if (meaningful.length !== 1) return null;
    const el = meaningful[0];
    return isEl(el) && el.tagName === 'PRE' && el.children.length === 0 ? el : null;
}

// --- Firma y posicion final -----------------------------------------------------------------------------------------
/** true si todo lo que sigue a `el` en el documento es invisible o firma (el bloque es el ultimo contenido real). */
function isTail(el: Node, root: Node): boolean {
    for (let a: Node | null = el; a && a !== root; a = a.parentNode) {
        for (let s = a.nextSibling; s; s = s.nextSibling) {
            if (isIgnorable(s)) continue;
            if (s.nodeType === 3 && (isMobileSignatureLine(normSpace(s.nodeValue || '')) || isSignatureDelimiter((s.nodeValue || '').trim()))) continue;
            if (isEl(s)) {
                if (s.matches(SIGNATURE_SELECTOR) || isMobileSignatureLine(normSpace(s.textContent || ''))) continue;
                const c = s.cloneNode(true) as Element;
                c.querySelectorAll(SIGNATURE_SELECTOR).forEach((x) => x.remove());
                if (!hasVisibleContent(c as HTMLElement)) continue;
            }
            return false;
        }
    }
    return true;
}

/** Regla de oro tras plegar: texto legible propio (la firma sola no cuenta) o una imagen real. */
function hasOwnContent(frag: DocumentFragment): boolean {
    const c = frag.cloneNode(true) as DocumentFragment;
    c.querySelectorAll(SIGNATURE_SELECTOR).forEach((x) => x.remove());
    if (!hasVisibleContent(c)) return false;
    if (hasReadableOutsideSignature(linearize(c).map((l) => l.text))) return true;
    return Array.from(c.querySelectorAll('img')).some(isRealImage);
}

// --- Atribucion ("El ..., X escribio:") ------------------------------------------------------------------------------
function hasMeaningfulPrev(n: Node): boolean {
    for (let s = n.previousSibling; s; s = s.previousSibling) if (!isIgnorable(s)) return true;
    return false;
}
function scanBack(cur: Node): Node[] | null {
    let n = cur.previousSibling;
    while (n && (isIgnorable(n) || isBr(n))) n = n.previousSibling;
    if (!n) return null;
    if (isBlockEl(n)) return isAttributionLine(n.textContent || '') ? [n] : null;
    // En linea: "texto<br>El lunes, Ana escribio:<br><blockquote>" -> recoge hasta el <br> o bloque anterior
    const nodes: Node[] = [];
    for (let m: Node | null = n; m && !isBr(m) && !isBlockEl(m); m = m.previousSibling) nodes.unshift(m);
    return isAttributionLine(nodes.map((x) => x.textContent || '').join('')) ? nodes : null;
}
/** Nodos de la linea de atribucion que precede a `q` (mirando tambien fuera de su contenedor si es lo primero de el). */
function findAttribution(q: Node, root: Node): Node[] | null {
    let cur: Node = q;
    for (let up = 0; up < 3; up++) {
        const found = scanBack(cur);
        if (found) return found;
        if (hasMeaningfulPrev(cur)) return null;
        const p = cur.parentNode;
        if (!p || p === root || p.nodeType !== 1) return null;
        cur = p;
    }
    return null;
}

// --- Corte "desde aqui hasta el final" ---------------------------------------------------------------------------------
function firstMeaningful(parent: Node): Node | null {
    for (const c of Array.from(parent.childNodes)) if (!isIgnorable(c)) return c;
    return null;
}
const earliest = (a: Node | null, b: Node | null): Node | null => {
    if (!a) return b;
    if (!b) return a;
    return a.compareDocumentPosition(b) & 4 /* FOLLOWING */ ? a : b;
};

/** Quita `start` y todo lo que le sigue en el documento (menos <style>), y limpia separadores (hr/br/____) justo antes. */
function cutFrom(start: Node, root: Node, take: (n: Node) => void): void {
    let n: Node = start;
    while (n.parentNode && n.parentNode !== root && firstMeaningful(n.parentNode) === n) n = n.parentNode;
    let prev: Node | null = n.previousSibling;
    const parent0 = n.parentNode;
    const drop = (from: Node | null) => {
        for (let s = from; s;) {
            const next: Node | null = s.nextSibling;
            if (!(isEl(s) && NON_RENDERED.has(s.tagName))) { take(s); s.parentNode?.removeChild(s); }
            s = next;
        }
    };
    drop(n);
    for (let a = parent0; a && a !== root; a = a.parentNode) drop(a.nextSibling);
    while (prev && (prev.nodeName === 'HR' || isBr(prev) || (prev.nodeType === 3 && visibleTextLength(prev) === 0) || (isEl(prev) && isUnderscoreRule(prev.textContent || '')))) {
        const p2: Node | null = prev.previousSibling;
        prev.parentNode?.removeChild(prev);
        prev = p2;
    }
}

/** Profundidad de blockquotes anidados dentro de `el` (incluido el mismo). */
function blockquoteDepth(el: Element): number {
    let max = el.tagName === 'BLOCKQUOTE' ? 1 : 0;
    el.querySelectorAll('blockquote').forEach((b) => {
        let c = 1;
        for (let p = b.parentElement; p && p !== el; p = p.parentElement) if (p.tagName === 'BLOCKQUOTE') c++;
        if (el.tagName === 'BLOCKQUOTE') c++;
        max = Math.max(max, c);
    });
    return Math.max(1, max);
}


function splitPlainPre(pre: Element): QuotedSplit | null {
    const r = splitQuotedText(pre.textContent || '');
    if (!r) return null;
    const wrap = (t: string) => { const c = pre.cloneNode(false) as Element; c.textContent = t; return c.outerHTML; };
    return { main: wrap(r.main), blocks: r.blocks, levels: r.levels, quotedHtml: wrap(r.quoted), quotedText: r.quoted, mainText: r.main };
}

export function splitQuotedHtml(html: string): QuotedSplit | null {
    if (typeof document === 'undefined' || !html || html.length < 20) return null;
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const frag = tpl.content;

    // Nada que plegar si el mensaje completo no se ve (evita mostrar un boton "..." sobre nada).
    if (!hasVisibleContent(frag)) return null;

    // Correo text/plain (llega como <pre>): plegado por lineas ">" / atribucion / separadores.
    const pre = plainPre(frag);
    if (pre) return splitPlainPre(pre);

    const removedHtml: string[] = [];
    const removedText: string[] = [];
    const take = (n: Node) => { removedHtml.push(serialize(n)); const t = normSpace(n.textContent || ''); if (t) removedText.push(t); };
    let blocks = 0;
    let levels = 1;

    // 1) Contenedores de cita: por cliente (selector) o genericos (blockquote / clase *quote* con atribucion o en posicion final).
    const found = new Set<Element>(Array.from(frag.querySelectorAll(CONTAINER_SELECTORS)));
    frag.querySelectorAll('.zmail_extra').forEach((el) => { if (el.querySelector('blockquote')) found.add(el); });
    frag.querySelectorAll('blockquote,[class]').forEach((el) => {
        if (found.has(el)) return;
        const bq = el.tagName === 'BLOCKQUOTE';
        const generic = !bq && ['DIV', 'SECTION', 'ARTICLE', 'TABLE', 'P'].includes(el.tagName) && Array.from(el.classList).some((c) => GENERIC_QUOTE_CLASS.test(c));
        if ((bq || generic) && (isTail(el, frag) || findAttribution(el, frag))) found.add(el);
    });
    // Solo el nivel superior: los anidados se van con su padre. Orden de documento.
    const all = Array.from(found);
    const top = all
        .filter((el) => !all.some((o) => o !== el && o.contains(el)))
        .sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1));
    const attributions = top.map((q) => (findAttribution(q, frag) || []).filter((n) => !top.some((t) => t === n || t.contains(n))));
    top.forEach((q, i) => {
        levels = Math.max(levels, blockquoteDepth(q));
        take(q);
        attributions[i].forEach(take);
        q.remove();
        attributions[i].forEach((n) => n.parentNode?.removeChild(n));
        blocks++;
    });

    // 2) Historial sin contenedor: cabeceras De:/From:, separadores "-----Original Message-----", #divRplyFwdMsg...
    const lines = linearize(frag);
    const texts = lines.map((l) => l.text);
    let lineCut: number | null = null;
    for (let i = 0; i < texts.length; i++) {
        const next = i + 1 < texts.length && isUnderscoreRule(texts[i]) ? i + 1 : -1;
        if (isSeparatorLine(texts[i]) || isHeaderBlockAt(texts, i) || (next >= 0 && isHeaderBlockAt(texts, next))) { lineCut = i; break; }
    }
    const strong = frag.querySelector(TAIL_MARKERS);
    let cut = earliest(strong, lineCut !== null ? lines[lineCut].node : null);
    if (!cut) {
        const weak = frag.querySelector(WEAK_TAIL_MARKER);
        if (weak && !isTail(weak, frag)) cut = weak;
    }
    if (cut) {
        const target: Node = cut;
        const from = lines.findIndex((l) => target === l.node || target.contains(l.node) || (target.compareDocumentPosition(l.node) & 4) !== 0);
        const tailTexts = from >= 0 ? texts.slice(from) : [];
        const before = removedText.length;
        cutFrom(target, frag, take);
        if (removedText.length > before) {
            blocks++;
            levels = Math.max(levels, 1 + Math.max(0, countMessageStarts(tailTexts) - 1));
        }
    }

    if (blocks === 0) return null;
    if (!hasOwnContent(frag)) return null; // solo habia cita (o el resto es invisible/firma): se muestra completa

    const mainText = linearize(frag).map((l) => l.text).join('\n');
    const holder = document.createElement('div');
    holder.appendChild(frag);
    return { main: holder.innerHTML, blocks, quotedHtml: removedHtml.join(''), quotedText: removedText.join('\n'), mainText, levels };
}
