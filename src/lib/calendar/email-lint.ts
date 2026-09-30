/**
 * LINTER DE COMPATIBILIDAD DE CORREO (Gmail, Outlook de escritorio / motor Word, Apple Mail, Yahoo).
 *
 * Las plantillas de reuniones (`invite-template.js`) se envian a clientes que NO son navegadores. Este linter, puro y sin
 * DOM, comprueba el HTML generado contra reglas basadas en https://www.caniemail.com (cada regla cita la funcion de
 * caniemail que la respalda) y corre en `__tests__/email-lint.test.ts` sobre TODAS las variantes x idiomas x marcas: una
 * violacion de severidad `error` rompe el test.
 *
 * ── Reglas (id · severidad · clientes · caniemail) ──────────────────────────────────────────────────────────────────
 *  css-external             error  gmail outlook yahoo apple  · `<link rel=stylesheet>`, `@import` (html-link-rel, css-at-import)
 *  web-fonts                error  gmail outlook yahoo        · `@font-face`; font-family solo de la lista segura y con familia generica
 *  layout-flex-grid         error  outlook gmail yahoo        · display:flex/grid/contents, gap, flex-*, grid-* (css-display-flex, css-display-grid, css-gap)
 *  layout-position          error  outlook yahoo gmail        · position (css-position)
 *  layout-float             error  outlook                    · float (css-float)
 *  css-modern-unsupported   error  outlook gmail yahoo        · calc(), var(), clamp(), @supports, transform, filter, object-fit, aspect-ratio
 *  background-image-fallback error outlook gmail yahoo        · background-image / url() sin bgcolor + background-color (css-background-image)
 *  max-width-needs-width    error  outlook                    · max-width sin atributo width en table/td/img (css-max-width)
 *  rgba-hsla                error  outlook                    · rgba(), hsla(), hex de 8 digitos, opacity (css-rgb-hsl-alpha?, css-opacity)
 *  border-radius-degrade    error  outlook                    · border-radius + overflow:hidden (el recorte no existe en Word); sin overflow = info (se degrada a cuadrado)
 *  img-attrs                error  outlook gmail apple yahoo  · img sin alt, sin width/height, sin display:block; data: URI (Gmail las bloquea)
 *  button-bulletproof       error  outlook                    · un <a> con relleno/padding/borde exige <td> con bgcolor y mso-padding-alt (boton "a prueba de balas")
 *  dark-color-scheme-meta   error  apple outlook gmail        · prefers-color-scheme exige <meta name=color-scheme> y supported-color-schemes (css-at-media-prefers-color-scheme)
 *  size-102kb               error  gmail                      · Gmail recorta el mensaje a partir de ~102 KB (aviso "Ver mensaje completo")
 *  style-block-size         error  gmail                      · el <style> supera 16 KB (Gmail lo descarta)
 *  insecure-links           error  todos                      · href/src http:, //, javascript:, data: (enlaces y recursos solo https/mailto/tel)
 *  forbidden-elements       error  todos                      · script, iframe, form, input, button, video, audio, svg, canvas, object, embed, base, link
 *  tables-presentation      error  outlook gmail apple        · <table> sin role=presentation, cellpadding=0, cellspacing=0, border=0
 *  bgcolor-mirror           error  outlook yahoo              · background-color en table/td/body sin atributo bgcolor
 *  inline-critical-styles   error  gmail yahoo                · Gmail (cuentas no Google) descarta <style>: cada clase bxm-* exige su propiedad en linea
 *  inline-font-family       error  outlook                    · texto sin font-family en linea (Outlook cae a Times New Roman)
 *  link-inline-color        error  outlook apple gmail        · <a> con texto sin color en linea (Outlook lo pinta azul por defecto)
 *  style-selectors-portable error  gmail yahoo                · un selector o at-rule no portable invalida TODO el <style> en Gmail
 *  document-basics          error  todos                      · falta doctype, lang, charset, viewport o title
 *  min-font-size            error  apple gmail                · font-size < 11 px (iOS lo amplia y rompe el layout)
 *  fixed-width-table        error  outlook                    · ninguna tabla con width numerico <= 640
 *  inline-table             info   outlook                    · display:inline-table: Outlook apila los botones (se degrada bien)
 *
 * ── Modo oscuro (`lintDarkMode`) ────────────────────────────────────────────────────────────────────────────────────
 * Tres simulaciones sobre los pares texto/fondo del correo (se resuelven color y fondo por herencia desde el HTML):
 *  - palette : clientes que respetan `prefers-color-scheme` / `[data-ogsc]` (Apple Mail, iOS Mail, Outlook.com, Thunderbird):
 *              se aplican las reglas oscuras `.bxm-*` de la propia plantilla. Exige >= 4.5:1 en todos los pares.
 *  - partial : inversion PARCIAL automatica (Gmail Android/iOS, Outlook movil): solo los fondos CLAROS se invierten (L -> 1-L en
 *              HSL, mismo matiz); el texto se invierte solo si la clase clara/oscura de su fondo cambia. Fondos oscuros intactos.
 *  - full    : inversion TOTAL (Outlook de escritorio / Windows Mail): TODOS los fondos y textos se invierten con la misma regla.
 *  Minimos: palette 4.5:1 en todos los pares; inversion automatica: texto principal (`bxm-ink`) 4.5:1, boton y banda de marca
 *  4.0:1 (las marcas de gris medio no pueden mantener 4.5 en el original y en el invertido a la vez), muted y enlaces 3:1. Es un modelo (los clientes no publican su algoritmo): su valor es detectar diseños que
 *  dependen de un fondo claro concreto. Los hallazgos se listan en `DarkFinding`.
 */
import { backgroundScheme, contrast, hexToHsl, hexToRgb, hslToHex, isHexColor, normalizeHex } from '@/lib/color';

export type LintClient = 'gmail' | 'outlook' | 'apple-mail' | 'yahoo';
export type LintSeverity = 'error' | 'warn' | 'info';

export interface LintRule {
    id: string;
    severity: LintSeverity;
    clients: LintClient[];
    /** Funcion(es) de https://www.caniemail.com que respaldan la regla. */
    caniemail: string[];
    summary: string;
}

export interface LintIssue {
    rule: string;
    severity: LintSeverity;
    clients: LintClient[];
    message: string;
    /** Fragmento (<= 100 caracteres) del HTML afectado. */
    snippet: string;
}

const ALL: LintClient[] = ['gmail', 'outlook', 'apple-mail', 'yahoo'];

export const EMAIL_LINT_RULES: readonly LintRule[] = [
    { id: 'css-external', severity: 'error', clients: ALL, caniemail: ['html-link-rel', 'css-at-import'], summary: 'Sin hojas de estilo externas (<link rel=stylesheet>, @import).' },
    { id: 'web-fonts', severity: 'error', clients: ['gmail', 'outlook', 'yahoo'], caniemail: ['css-at-font-face', 'css-font-family'], summary: 'Sin @font-face; font-family solo de la lista segura y con familia generica.' },
    { id: 'layout-flex-grid', severity: 'error', clients: ['outlook', 'gmail', 'yahoo'], caniemail: ['css-display-flex', 'css-display-grid', 'css-gap'], summary: 'Sin flex, grid, gap ni display:contents: el layout es de tablas.' },
    { id: 'layout-position', severity: 'error', clients: ['outlook', 'yahoo', 'gmail'], caniemail: ['css-position'], summary: 'Sin position.' },
    { id: 'layout-float', severity: 'error', clients: ['outlook'], caniemail: ['css-float'], summary: 'Sin float: la columna se resuelve con tablas y align.' },
    { id: 'css-modern-unsupported', severity: 'error', clients: ['outlook', 'gmail', 'yahoo'], caniemail: ['css-function-calc', 'css-variables', 'css-at-supports', 'css-transform', 'css-filter', 'css-object-fit', 'css-aspect-ratio'], summary: 'Sin calc(), var(), clamp(), @supports, transform, filter, object-fit ni aspect-ratio.' },
    { id: 'background-image-fallback', severity: 'error', clients: ['outlook', 'gmail', 'yahoo'], caniemail: ['css-background-image', 'html-background'], summary: 'background-image / url() solo con bgcolor + background-color de respaldo.' },
    { id: 'max-width-needs-width', severity: 'error', clients: ['outlook'], caniemail: ['css-max-width'], summary: 'max-width exige el atributo width en la misma table/td/img (Word ignora max-width).' },
    { id: 'rgba-hsla', severity: 'error', clients: ['outlook'], caniemail: ['css-rgb', 'css-hsl', 'css-opacity'], summary: 'Sin rgba()/hsla()/hex de 8 digitos/opacity: Outlook los ignora; colores solo en hex opaco.' },
    { id: 'border-radius-degrade', severity: 'error', clients: ['outlook'], caniemail: ['css-border-radius', 'css-overflow'], summary: 'border-radius solo como adorno (se degrada a cuadrado); nunca con overflow:hidden.' },
    { id: 'img-attrs', severity: 'error', clients: ALL, caniemail: ['html-img', 'html-alt', 'css-display-block', 'html-img-data-uri'], summary: 'img con alt, width y/o height, display:block, border:0; sin data: URI.' },
    { id: 'button-bulletproof', severity: 'error', clients: ['outlook'], caniemail: ['css-padding', 'css-mso-padding-alt', 'html-bgcolor'], summary: 'Botones a prueba de balas: <td bgcolor> con mso-padding-alt alrededor del <a>.' },
    { id: 'dark-color-scheme-meta', severity: 'error', clients: ['apple-mail', 'outlook', 'gmail'], caniemail: ['css-at-media-prefers-color-scheme', 'html-color-scheme'], summary: 'prefers-color-scheme exige <meta name=color-scheme> y supported-color-schemes.' },
    { id: 'size-102kb', severity: 'error', clients: ['gmail'], caniemail: ['gmail-clipping'], summary: 'El HTML no supera 102 KB (Gmail recorta el mensaje).' },
    { id: 'style-block-size', severity: 'error', clients: ['gmail'], caniemail: ['html-style'], summary: 'El <style> no supera 16 KB.' },
    { id: 'insecure-links', severity: 'error', clients: ALL, caniemail: ['html-a-href-protocol'], summary: 'Enlaces y recursos solo https / mailto / tel: nada de http, // ni javascript:.' },
    { id: 'forbidden-elements', severity: 'error', clients: ALL, caniemail: ['html-script', 'html-iframe', 'html-form', 'html-svg', 'html-video', 'html-canvas'], summary: 'Sin script, iframe, form, input, button, video, audio, svg, canvas, object, embed, base ni link.' },
    { id: 'tables-presentation', severity: 'error', clients: ['outlook', 'gmail', 'apple-mail'], caniemail: ['html-role', 'html-table-cellspacing'], summary: 'Tablas de layout con role=presentation, cellpadding/cellspacing/border = 0.' },
    { id: 'bgcolor-mirror', severity: 'error', clients: ['outlook', 'yahoo'], caniemail: ['html-bgcolor'], summary: 'background-color en table/td/body acompañado del atributo bgcolor.' },
    { id: 'inline-critical-styles', severity: 'error', clients: ['gmail', 'yahoo'], caniemail: ['html-style'], summary: 'Cada clase bxm-* tiene su propiedad en linea (el <style> es solo una mejora).' },
    { id: 'inline-font-family', severity: 'error', clients: ['outlook'], caniemail: ['css-font-family'], summary: 'Todo texto hereda un font-family en linea.' },
    { id: 'link-inline-color', severity: 'error', clients: ['outlook', 'apple-mail', 'gmail'], caniemail: ['css-color'], summary: 'Todo <a> con texto lleva color en linea.' },
    { id: 'style-selectors-portable', severity: 'error', clients: ['gmail', 'yahoo'], caniemail: ['html-style', 'css-selector-class', 'css-selector-attribute'], summary: 'Solo selectores .bxm-*, [data-ogsc]/[data-ogsb] .bxm-* y @media (max-width | prefers-color-scheme).' },
    { id: 'document-basics', severity: 'error', clients: ALL, caniemail: ['html-doctype', 'html-lang', 'html-meta-viewport'], summary: 'doctype, lang, charset, viewport y title presentes.' },
    { id: 'min-font-size', severity: 'error', clients: ['apple-mail', 'gmail'], caniemail: ['css-font-size'], summary: 'font-size >= 11 px.' },
    { id: 'fixed-width-table', severity: 'error', clients: ['outlook'], caniemail: ['html-width'], summary: 'Una tabla contenedora con width numerico <= 640.' },
    { id: 'inline-table', severity: 'info', clients: ['outlook'], caniemail: ['css-display'], summary: 'display:inline-table: Outlook apila los botones; se degrada bien.' },
];

const RULE = new Map(EMAIL_LINT_RULES.map((r) => [r.id, r]));

// ─── Mini analizador de HTML (suficiente para el HTML que generan las plantillas) ─────────────────────────────────

export interface HtmlEl {
    tag: string;
    attrs: Record<string, string>;
    style: Record<string, string>;
    parent: HtmlEl | null;
    children: Array<HtmlEl | string>;
    /** HTML de la etiqueta de apertura. */
    open: string;
    /** Posicion (offset) de la etiqueta de apertura en el HTML original. */
    start: number;
}

const VOID = new Set(['meta', 'link', 'img', 'br', 'hr', 'input', 'base', 'col', 'area', 'source', 'track', 'wbr', 'embed']);
const RAW = new Set(['style', 'script']);

export function parseInlineStyle(css: string): Record<string, string> {
    const out: Record<string, string> = {};
    let depth = 0;
    let quote = '';
    let cur = '';
    const parts: string[] = [];
    for (const ch of css) {
        if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
        if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
        if (ch === '(') depth++;
        if (ch === ')') depth = Math.max(0, depth - 1);
        if (ch === ';' && depth === 0) { parts.push(cur); cur = ''; continue; }
        cur += ch;
    }
    parts.push(cur);
    for (const part of parts) {
        const i = part.indexOf(':');
        if (i < 1) continue;
        out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).replace(/\s*!important\s*$/i, '').trim();
    }
    return out;
}

function parseAttrs(source: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const re = /([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
    return attrs;
}

export interface ParsedEmail {
    root: HtmlEl;
    all: HtmlEl[];
    styleText: string;
    doctype: boolean;
}

export function parseEmailHtml(html: string): ParsedEmail {
    const root: HtmlEl = { tag: '#root', attrs: {}, style: {}, parent: null, children: [], open: '', start: 0 };
    const all: HtmlEl[] = [];
    let styleText = '';
    let cur = root;
    const re = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s"'=<>`/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>|([^<]+|<)/g;
    let m: RegExpExecArray | null;
    let doctype = false;
    while ((m = re.exec(html))) {
        const token = m[0];
        if (/^<!DOCTYPE/i.test(token)) { doctype = true; continue; }
        if (token.startsWith('<!--')) continue;
        if (m[5] !== undefined) { cur.children.push(m[5]); continue; }
        const closing = m[1] === '/';
        const tag = m[2].toLowerCase();
        if (closing) {
            let n: HtmlEl | null = cur;
            while (n && n.tag !== tag) n = n.parent;
            if (n && n.parent) cur = n.parent;
            continue;
        }
        const attrs = parseAttrs(m[3] || '');
        const el: HtmlEl = { tag, attrs, style: parseInlineStyle(attrs.style || ''), parent: cur, children: [], open: token, start: m.index };
        cur.children.push(el);
        all.push(el);
        if (RAW.has(tag)) {
            const end = html.toLowerCase().indexOf('</' + tag, re.lastIndex);
            const stop = end < 0 ? html.length : end;
            const body = html.slice(re.lastIndex, stop);
            if (tag === 'style') styleText += body;
            el.children.push(body);
            re.lastIndex = stop;
            const close = /^<\/[^>]*>/.exec(html.slice(stop));
            if (close) re.lastIndex = stop + close[0].length;
            continue;
        }
        if (!VOID.has(tag) && !m[4]) cur = el;
    }
    return { root, all, styleText, doctype };
}

const snip = (s: string) => s.replace(/\s+/g, ' ').slice(0, 100);
const textOf = (el: HtmlEl): string => el.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
const directText = (el: HtmlEl): string => el.children.filter((c): c is string => typeof c === 'string').join('').replace(/&nbsp;/g, ' ').trim();
const classes = (el: HtmlEl) => (el.attrs.class || '').split(/\s+/).filter(Boolean);

function ancestors(el: HtmlEl): HtmlEl[] {
    const out: HtmlEl[] = [];
    for (let n: HtmlEl | null = el; n && n.tag !== '#root'; n = n.parent) out.push(n);
    return out;
}

const hidden = (el: HtmlEl) => ancestors(el).some((a) => /^none$/i.test(a.style.display || '') || a.tag === 'title' || a.tag === 'style' || a.tag === 'head');

/** Reglas del bloque <style>: [{ media, selector, decls }] (sin anidar mas de un nivel de @media). */
interface CssRule { media: string | null; selector: string; decls: Record<string, string> }

export function parseStyleBlock(css: string): { rules: CssRule[]; atRules: string[]; bad: string[] } {
    const rules: CssRule[] = [];
    const atRules: string[] = [];
    const bad: string[] = [];
    const walk = (text: string, media: string | null) => {
        let i = 0;
        while (i < text.length) {
            const open = text.indexOf('{', i);
            if (open < 0) break;
            const head = text.slice(i, open).trim();
            let depth = 1;
            let j = open + 1;
            while (j < text.length && depth > 0) {
                if (text[j] === '{') depth++;
                else if (text[j] === '}') depth--;
                j++;
            }
            const body = text.slice(open + 1, j - 1);
            if (head.startsWith('@')) {
                atRules.push(head.replace(/\s+/g, ''));
                if (/^@media/i.test(head)) walk(body, head.replace(/\s+/g, ''));
                else bad.push(head);
            } else if (head) {
                for (const sel of head.split(',')) rules.push({ media, selector: sel.trim(), decls: parseInlineStyle(body) });
            }
            i = j;
        }
    };
    walk(css, null);
    return { rules, atRules, bad };
}

// ─── El linter ───────────────────────────────────────────────────────────────────────────────────────────────────

const SAFE_FONTS = new Set(['arial', 'helvetica', 'sans-serif', 'georgia', 'times new roman', 'times', 'serif', 'verdana', 'tahoma', 'trebuchet ms', 'courier new', 'courier', 'monospace']);
const GENERIC = new Set(['sans-serif', 'serif', 'monospace']);
const CLASS_INLINE: Record<string, string[]> = {
    'bxm-ink': ['color'],
    'bxm-muted': ['color'],
    'bxm-olink': ['color'],
    'bxm-card': ['background-color'],
    'bxm-page': ['background-color'],
    'bxm-band': ['background-color'],
    'bxm-btn': ['border'],
    'bxm-rule': ['border-top', 'border'],
    'bxm-pad': ['padding'],
    'bxm-outer': ['padding'],
};

export function lintEmailHtml(html: string): LintIssue[] {
    const issues: LintIssue[] = [];
    const add = (rule: string, message: string, at: string) => {
        const r = RULE.get(rule)!;
        issues.push({ rule, severity: r.severity, clients: r.clients, message, snippet: snip(at) });
    };
    const doc = parseEmailHtml(html);
    const styleCss = parseStyleBlock(doc.styleText);
    const allStyles = doc.all.map((e) => ({ e, s: e.style }));
    const inlineCss = doc.all.map((e) => e.attrs.style || '').join(';');
    const cssAll = `${doc.styleText}\n${inlineCss}`;

    // css-external
    doc.all.filter((e) => e.tag === 'link' && /stylesheet/i.test(e.attrs.rel || '')).forEach((e) => add('css-external', '<link rel="stylesheet"> no se admite', e.open));
    if (/@import/i.test(doc.styleText)) add('css-external', '@import no se admite', '@import');

    // web-fonts
    if (/@font-face/i.test(cssAll) || /fonts\.(googleapis|gstatic)\.com/i.test(html)) add('web-fonts', 'Fuentes web no soportadas', '@font-face');
    const fontDecls = [...cssAll.matchAll(/font-family\s*:\s*([^;}]+)/gi)].map((m) => m[1]);
    for (const decl of fontDecls) {
        const names = decl.split(',').map((n) => n.replace(/["']|!important/gi, '').trim().toLowerCase()).filter(Boolean);
        if (!names.every((n) => SAFE_FONTS.has(n)) || !names.some((n) => GENERIC.has(n))) add('web-fonts', `font-family fuera de la lista segura o sin familia generica: ${decl}`, decl);
    }

    // layout
    if (/display\s*:\s*(inline-)?(flex|grid|contents)|(^|[;\s{])(gap|row-gap|column-gap|flex(-[a-z]+)?|grid(-[a-z-]+)?|justify-content|align-items|align-content)\s*:/i.test(cssAll)) add('layout-flex-grid', 'flex/grid/gap en el CSS', 'display:flex');
    if (/(^|[;\s{])position\s*:/i.test(cssAll)) add('layout-position', 'position en el CSS', 'position:');
    if (/(^|[;\s{])float\s*:/i.test(cssAll)) add('layout-float', 'float en el CSS', 'float:');
    if (/\b(calc|var|clamp|min|max)\(|@supports|(^|[;\s{])(transform|filter|backdrop-filter|object-fit|aspect-ratio)\s*:|:root|@container/i.test(cssAll)) add('css-modern-unsupported', 'Funcion o propiedad CSS moderna no soportada', 'calc()/var()/transform');

    // background-image
    for (const { e, s } of allStyles) {
        const bg = `${s['background-image'] || ''} ${s.background || ''}`;
        if (/url\(/i.test(bg) || e.attrs.background) {
            const hasFallback = !!(e.attrs.bgcolor && (s['background-color'] || /#[0-9a-f]{3,8}/i.test(s.background || '')));
            if (!hasFallback) add('background-image-fallback', 'background-image sin bgcolor + background-color de respaldo', e.open);
        }
    }
    if (/url\(/i.test(doc.styleText)) add('background-image-fallback', 'url() en <style>: usa imagenes <img> con alt', 'url(');

    // max-width
    for (const { e, s } of allStyles) {
        if (!s['max-width'] || /^0/.test(s['max-width']) || /^none$/i.test(s.display || '')) continue;
        if (['table', 'td', 'img'].includes(e.tag) && !e.attrs.width && !e.attrs.height) add('max-width-needs-width', 'max-width sin atributo width (Outlook lo ignora)', e.open);
        if (!['table', 'td', 'img'].includes(e.tag)) add('max-width-needs-width', 'max-width en un elemento que no es table/td/img', e.open);
    }

    // rgba / hsla / opacity
    if (/rgba?\([^)]*[,/]\s*[\d.]+%?\s*\)\s*(?=[;}"']|$)/i.test(cssAll) && /rgba\(|hsla\(/i.test(cssAll)) add('rgba-hsla', 'rgba()/hsla() no soportados en Outlook', 'rgba(');
    if (/rgba\(|hsla\(|#[0-9a-f]{8}\b|(^|[;\s{])opacity\s*:/i.test(cssAll)) add('rgba-hsla', 'rgba()/hsla()/hex de 8 digitos/opacity no soportados en Outlook', 'rgba(');

    // border-radius
    for (const { e, s } of allStyles) {
        if (s['border-radius'] && /hidden|clip/i.test(s.overflow || '')) add('border-radius-degrade', 'border-radius con overflow:hidden no se recorta en Outlook', e.open);
    }
    if (/border-radius[^}]*overflow\s*:\s*hidden/i.test(doc.styleText)) add('border-radius-degrade', 'border-radius con overflow:hidden en <style>', 'border-radius');

    // imgs
    for (const e of doc.all.filter((x) => x.tag === 'img')) {
        if (e.attrs.alt === undefined) add('img-attrs', 'img sin alt', e.open);
        if (!e.attrs.width && !e.attrs.height) add('img-attrs', 'img sin width/height (Outlook no la dimensiona)', e.open);
        if (!/block/i.test(e.style.display || '')) add('img-attrs', 'img sin display:block (huecos en Gmail/Outlook)', e.open);
        if (!/^0|none/i.test(e.style.border || '') && e.attrs.border !== '0') add('img-attrs', 'img sin border:0', e.open);
        if (/^data:/i.test(e.attrs.src || '')) add('img-attrs', 'data: URI en img (Gmail las bloquea)', e.open);
    }

    // botones a prueba de balas
    for (const a of doc.all.filter((x) => x.tag === 'a')) {
        if (!textOf(a).trim()) continue;
        const s = a.style;
        const looksLikeButton = !!(s.padding || s['background-color'] || (s.border && !/^0|none/i.test(s.border))) && /block/i.test(s.display || '');
        if (!looksLikeButton) continue;
        const td = ancestors(a).find((x) => x !== a && x.tag === 'td');
        if (!td) { add('button-bulletproof', 'Boton fuera de un <td>', a.open); continue; }
        const padOk = !!td.style['mso-padding-alt'] || !!td.style.padding;
        if (!padOk) add('button-bulletproof', 'El <td> del boton no lleva mso-padding-alt (Outlook ignora el padding del <a>)', td.open);
        const bg = s['background-color'];
        if (bg && normalizeHex(td.attrs.bgcolor) !== normalizeHex(bg)) add('button-bulletproof', 'El <td> del boton no repite el fondo en bgcolor', td.open);
        if (s.border && !/^0|none/i.test(s.border) && !td.style['mso-border-alt'] && !bg) add('button-bulletproof', 'Boton de contorno sin mso-border-alt en el <td>', td.open);
        const table = ancestors(td).find((x) => x.tag === 'table');
        if (!table || table.attrs.role !== 'presentation') add('button-bulletproof', 'La tabla del boton no es role=presentation', a.open);
    }

    // modo oscuro: metas
    const hasDark = /prefers-color-scheme/i.test(doc.styleText);
    const metaScheme = doc.all.find((e) => e.tag === 'meta' && e.attrs.name === 'color-scheme');
    const metaSupported = doc.all.find((e) => e.tag === 'meta' && e.attrs.name === 'supported-color-schemes');
    if (hasDark && (!metaScheme || !/light/.test(metaScheme.attrs.content || '') || !/dark/.test(metaScheme.attrs.content || '') || !metaSupported)) add('dark-color-scheme-meta', 'prefers-color-scheme sin <meta name="color-scheme"> + supported-color-schemes', 'prefers-color-scheme');

    // tamaños
    const bytes = new TextEncoder().encode(html).length;
    if (bytes > 102 * 1024) add('size-102kb', `HTML de ${(bytes / 1024).toFixed(1)} KB: Gmail lo recorta a partir de 102 KB`, `${bytes} bytes`);
    if (doc.styleText.length > 16 * 1024) add('style-block-size', `<style> de ${doc.styleText.length} caracteres (> 16 KB)`, 'style');

    // enlaces y recursos
    for (const e of doc.all) {
        for (const attr of ['href', 'src', 'background', 'action']) {
            const v = (e.attrs[attr] || '').replace(/&amp;/g, '&').trim();
            if (!v) continue;
            if (/^(https:|mailto:|tel:|#)/i.test(v)) continue;
            add('insecure-links', `${attr}="${v.slice(0, 60)}" no es https/mailto/tel`, e.open);
        }
    }

    // elementos prohibidos
    for (const e of doc.all) {
        if (['script', 'iframe', 'form', 'input', 'button', 'video', 'audio', 'svg', 'canvas', 'object', 'embed', 'base', 'select', 'textarea'].includes(e.tag)) add('forbidden-elements', `<${e.tag}> no se admite en correo`, e.open);
        if (e.tag === 'link') add('forbidden-elements', '<link> no se admite en correo', e.open);
        if (e.tag === 'meta' && /refresh/i.test(e.attrs['http-equiv'] || '')) add('forbidden-elements', 'meta refresh', e.open);
        if (/\son[a-z]+\s*=/i.test(e.open)) add('forbidden-elements', 'atributo de evento (on*)', e.open);
    }

    // tablas
    for (const t of doc.all.filter((x) => x.tag === 'table')) {
        if (t.attrs.role !== 'presentation') add('tables-presentation', 'table sin role="presentation"', t.open);
        for (const k of ['cellpadding', 'cellspacing', 'border']) if (t.attrs[k] !== '0') add('tables-presentation', `table sin ${k}="0"`, t.open);
    }
    if (!doc.all.some((t) => t.tag === 'table' && /^\d+$/.test(t.attrs.width || '') && Number(t.attrs.width) <= 640)) add('fixed-width-table', 'Sin tabla contenedora con width numerico <= 640', 'table');

    // bgcolor-mirror
    for (const { e, s } of allStyles) {
        if (['table', 'td', 'body'].includes(e.tag) && s['background-color'] && !e.attrs.bgcolor) add('bgcolor-mirror', `<${e.tag}> con background-color sin bgcolor`, e.open);
    }

    // inline-critical-styles
    for (const e of doc.all) {
        for (const c of classes(e)) {
            const need = CLASS_INLINE[c];
            if (need && !need.some((p) => e.style[p] || (p === 'background-color' && e.attrs.bgcolor))) add('inline-critical-styles', `class="${c}" sin ${need.join(' / ')} en linea`, e.open);
        }
    }

    // fuente y color en linea del texto
    for (const e of doc.all) {
        if (hidden(e)) continue;
        const t = directText(e);
        if (!t) continue;
        const chain = ancestors(e);
        if (!chain.some((n) => n.style['font-family'])) add('inline-font-family', `texto sin font-family en linea: "${t.slice(0, 40)}"`, e.open);
        if (e.tag === 'a' && !e.style.color) add('link-inline-color', `<a> sin color en linea: "${t.slice(0, 40)}"`, e.open);
        const fs = chain.map((n) => n.style['font-size']).find(Boolean);
        const px = fs ? /^([\d.]+)px$/i.exec(fs) : null;
        if (px && Number(px[1]) < 11) add('min-font-size', `font-size ${fs} < 11px: "${t.slice(0, 40)}"`, e.open);
    }
    for (const e of doc.all.filter((x) => x.tag === 'a' && !hidden(x))) {
        if (textOf(e).trim() && !e.style.color && !directText(e)) add('link-inline-color', '<a> con texto anidado sin color en linea', e.open);
    }

    // selectores portables
    if (styleCss.bad.length) styleCss.bad.forEach((b) => add('style-selectors-portable', `at-rule no portable: ${b}`, b));
    for (const at of styleCss.atRules) {
        if (!/^@media(\(max-width:\d+px\)|\(prefers-color-scheme:dark\))$/i.test(at)) add('style-selectors-portable', `@media no portable: ${at}`, at);
    }
    for (const r of styleCss.rules) {
        if (!/^(\[data-ogs[cb]\]\s+)?\.bxm-[a-z]+$/.test(r.selector)) add('style-selectors-portable', `selector no portable: ${r.selector}`, r.selector);
    }

    // documento
    if (!doc.doctype) add('document-basics', 'Falta <!DOCTYPE html>', 'doctype');
    const htmlEl = doc.all.find((e) => e.tag === 'html');
    if (!htmlEl || !/^[a-z]{2}(-[A-Za-z]{2})?$/.test(htmlEl.attrs.lang || '')) add('document-basics', 'Falta lang en <html>', htmlEl?.open ?? '<html>');
    if (!doc.all.some((e) => e.tag === 'meta' && (e.attrs.charset || /charset/i.test(e.attrs.content || '')))) add('document-basics', 'Falta meta charset', 'meta');
    if (!doc.all.some((e) => e.tag === 'meta' && e.attrs.name === 'viewport')) add('document-basics', 'Falta meta viewport', 'meta');
    const title = doc.all.find((e) => e.tag === 'title');
    if (!title || !textOf(title).trim()) add('document-basics', 'Falta <title>', '<title>');

    // info
    if (allStyles.some(({ s }) => /inline-table/i.test(s.display || ''))) add('inline-table', 'display:inline-table: Outlook apila los botones', 'inline-table');

    return issues;
}

/** Errores (los que rompen el test) agrupados por cliente. */
export function issuesByClient(issues: LintIssue[]): Record<LintClient, LintIssue[]> {
    const out: Record<LintClient, LintIssue[]> = { gmail: [], outlook: [], 'apple-mail': [], yahoo: [] };
    for (const i of issues) for (const c of i.clients) out[c].push(i);
    return out;
}

// ─── Modo oscuro ─────────────────────────────────────────────────────────────────────────────────────────────────

export type DarkMode = 'palette' | 'partial' | 'full';
export type PairRole = 'ink' | 'muted' | 'link' | 'button' | 'band' | 'text';

export interface TextPair { role: PairRole; text: string; fg: string; bg: string }
export interface DarkFinding extends TextPair { mode: DarkMode; ratio: number; min: number; fgAfter: string; bgAfter: string }

function colorOf(value: string | undefined): string | null {
    if (!value) return null;
    const v = value.trim();
    return isHexColor(v) ? normalizeHex(v) : null;
}

/** Reglas oscuras `.bxm-*` de la plantilla (del @media prefers-color-scheme o, en la vista previa oscura forzada, de nivel superior). */
export function darkClassOverrides(styleText: string): Map<string, Record<string, string>> {
    const { rules } = parseStyleBlock(styleText);
    const inDark = rules.filter((r) => r.media && /prefers-color-scheme:dark/i.test(r.media));
    const source = inDark.length ? inDark : rules.filter((r) => !r.media);
    const map = new Map<string, Record<string, string>>();
    for (const r of source) {
        const m = /^\.(bxm-[a-z]+)$/.exec(r.selector);
        if (!m) continue;
        map.set(m[1], { ...(map.get(m[1]) || {}), ...r.decls });
    }
    return map;
}

/** Pares texto/fondo resueltos por herencia; con `dark` se aplican las reglas oscuras `.bxm-*`. */
export function resolveTextPairs(html: string, dark = false): TextPair[] {
    const doc = parseEmailHtml(html);
    const overrides = dark ? darkClassOverrides(doc.styleText) : new Map<string, Record<string, string>>();
    const styleOf = (e: HtmlEl, prop: string): string | undefined => {
        for (const c of classes(e)) { const o = overrides.get(c); if (o && o[prop]) return o[prop]; }
        return e.style[prop];
    };
    const pairs: TextPair[] = [];
    for (const e of doc.all) {
        if (hidden(e)) continue;
        const text = directText(e);
        if (!text) continue;
        const chain = ancestors(e);
        let fg: string | null = null;
        let bg: string | null = null;
        for (const n of chain) {
            if (!fg) fg = colorOf(styleOf(n, 'color'));
            if (!bg) bg = colorOf(styleOf(n, 'background-color')) ?? (dark ? null : colorOf(n.attrs.bgcolor)) ?? colorOf(n.attrs.bgcolor);
        }
        const cls = chain.flatMap(classes);
        const anchor = chain.find((n) => n.tag === 'a');
        const anchorBg = anchor ? colorOf(styleOf(anchor, 'background-color')) : null;
        let role: PairRole = 'text';
        if (anchorBg) role = 'button';
        else if (cls.includes('bxm-band') || chain.some((n) => n.tag === 'td' && classes(n).includes('bxm-band'))) role = 'band';
        else if (anchor) role = 'link';
        else if (cls.includes('bxm-ink')) role = 'ink';
        else if (cls.includes('bxm-muted')) role = 'muted';
        // El texto de la banda sin logo: fondo de banda por herencia; el "band" solo aplica si no es boton.
        pairs.push({ role, text: text.slice(0, 50), fg: fg ?? '#000000', bg: bg ?? '#ffffff' });
    }
    return pairs;
}

/** L -> 1-L en HSL (mismo matiz y saturacion). */
export function flipLightness(hex: string): string {
    const { h, s, l } = hexToHsl(hex);
    return hslToHex(h, s * 100, (1 - l) * 100);
}

/** Aplica una inversion automatica a un par (ver la descripcion del modelo en la cabecera). */
export function simulateAutoInversion(pair: { fg: string; bg: string }, mode: 'partial' | 'full'): { fg: string; bg: string } {
    const before = backgroundScheme(pair.bg);
    const invertBg = mode === 'full' || before === 'light';
    const bg = invertBg ? flipLightness(pair.bg) : pair.bg;
    const fg = backgroundScheme(bg) !== before ? flipLightness(pair.fg) : pair.fg;
    return { fg, bg };
}

const MIN_PALETTE: Record<PairRole, number> = { ink: 4.5, muted: 4.5, link: 4.5, button: 4.5, band: 4.5, text: 4.5 };
// Tras una inversion automatica (algoritmo aproximado, fuera de nuestro control) las superficies de marca cerca del cruce
// L=0.5 (gris medio) no pueden mantener 4.5:1 en el original Y en el invertido a la vez (maximo alcanzable ~4.5): se exige 4.0.
const MIN_AUTO: Record<PairRole, number> = { ink: 4.5, muted: 3, link: 3, button: 4, band: 4, text: 3 };

/** Hallazgos de legibilidad en modo oscuro (palette propia + inversion parcial + inversion total). Vacio = todo legible. */
export function lintDarkMode(html: string, modes: DarkMode[] = ['palette', 'partial', 'full']): DarkFinding[] {
    const findings: DarkFinding[] = [];
    for (const mode of modes) {
        const pairs = resolveTextPairs(html, mode === 'palette');
        for (const p of pairs) {
            const after = mode === 'palette' ? { fg: p.fg, bg: p.bg } : simulateAutoInversion(p, mode);
            const min = (mode === 'palette' ? MIN_PALETTE : MIN_AUTO)[p.role];
            const ratio = contrast(after.fg, after.bg);
            if (ratio < min) findings.push({ ...p, mode, ratio, min, fgAfter: after.fg, bgAfter: after.bg });
        }
    }
    return findings;
}

/**
 * HTML del correo tal como quedaria tras una inversion automatica (para la vista previa visual): reescribe color, fondo (incluido
 * bgcolor) y bordes de cada elemento con el MISMO modelo que `lintDarkMode` y elimina la paleta oscura propia (el cliente no la usa).
 */
export function simulateInvertedHtml(html: string, mode: 'partial' | 'full'): string {
    const doc = parseEmailHtml(html);
    const effectiveBg = (el: HtmlEl): string => {
        for (const n of ancestors(el)) {
            const c = colorOf(n.style['background-color']) ?? colorOf(n.attrs.bgcolor);
            if (c) return c;
        }
        return '#ffffff';
    };
    const edits: Array<{ start: number; len: number; text: string }> = [];
    for (const el of doc.all) {
        if (['style', 'script', 'meta', 'title', 'html', 'head'].includes(el.tag)) continue;
        const bgSelf = colorOf(el.style['background-color']) ?? colorOf(el.attrs.bgcolor);
        const parentBg = el.parent && el.parent.tag !== '#root' ? effectiveBg(el.parent) : '#ffffff';
        const baseBg = bgSelf ?? parentBg;
        const inverted = simulateAutoInversion({ fg: '#000000', bg: baseBg }, mode);
        const newBg = bgSelf ? inverted.bg : null;
        let open = el.open;
        if (bgSelf && newBg) {
            open = open.replace(/\sbgcolor="#[0-9a-fA-F]{3,6}"/, ` bgcolor="${newBg}"`);
        }
        if (el.attrs.style) {
            const hexRe = /#[0-9a-fA-F]{3,6}(?![0-9a-zA-Z])/g;
            const map = (value: string, prop: string): string => {
                if (prop === 'background-color' || prop === 'background') return value.replace(hexRe, (c) => (isHexColor(c) && bgSelf ? (newBg as string) : c));
                if (prop === 'color' || prop.startsWith('border') || prop === 'outline') {
                    return value.replace(hexRe, (c) => (isHexColor(c) ? simulateAutoInversion({ fg: normalizeHex(c) as string, bg: baseBg }, mode).fg : c));
                }
                return value;
            };
            const style = Object.entries(el.style).map(([k, v]) => `${k}:${map(v, k)}`).join(';') + ';';
            open = open.replace(/style="[^"]*"/, `style="${style}"`);
        }
        if (open !== el.open) edits.push({ start: el.start, len: el.open.length, text: open });
    }
    let out = html;
    for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.start + e.len);
    // La paleta oscura propia (@media prefers-color-scheme:dark{...}) termina en "}}": el cliente que invierte no la usa.
    return out.replace(/@media \(prefers-color-scheme:dark\)\{[\s\S]*?\}\}/, '');
}

/** Contrastes minimos por modo, para documentacion y para el panel de desarrollo. */
export const DARK_MIN_RATIO = { palette: MIN_PALETTE, auto: MIN_AUTO } as const;

/** Utilidad para pruebas: luminancia aproximada 0-1 de un hex (para clasificar colores en informes). */
export function approxLightness(hex: string): number {
    const { r, g, b } = hexToRgb(hex);
    return (r * 0.299 + g * 0.587 + b * 0.114) / 255;
}
