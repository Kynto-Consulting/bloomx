/**
 * Extensiones TipTap que conservan la ESTRUCTURA de la cita al responder / reenviar.
 *
 * Sin ellas el editor aplana `div.gmail_quote` / `div.gmail_attr` y descarta la clase y el estilo del blockquote, y la
 * cita saldria sin la estructura que Gmail, Outlook, Apple Mail, Thunderbird, Titan o Yahoo usan para plegar el
 * historial (ver lib/reply-builder.ts). Solo se conservan los `div` que pertenecen a una cita (dentro de blockquote /
 * .gmail_quote / #divRplyFwdMsg / .bx-fwd-body): el resto del contenido escrito o pegado sigue siendo parrafos.
 *
 *  - divInline: `div` con solo contenido en linea (p. ej. `div.gmail_attr`: texto + `<br>`).
 *  - divBlock:  `div` con bloques dentro (p. ej. `div.gmail_quote`).
 *  - atributos globales: class/style/dir/type en blockquote, style/tabindex en hr y `data-bx-inline` en imagenes
 *    (marca que el servidor usa para convertir la data URI en adjunto inline cid).
 */
import { Extension, Node, mergeAttributes } from '@tiptap/react';

const QUOTE_SELECTOR = 'blockquote,.gmail_quote,.gmail_attr,#divRplyFwdMsg,.bx-fwd-body';
const BLOCK_CHILD = /^(?:div|p|blockquote|ul|ol|li|table|tbody|thead|tfoot|tr|td|th|h[1-6]|pre|hr|section|article|header|footer|center|dl|address)$/i;

function inQuote(el: HTMLElement): boolean {
    return el.matches(QUOTE_SELECTOR) || !!el.closest(QUOTE_SELECTOR);
}

function hasBlockChild(el: HTMLElement): boolean {
    return Array.from(el.children).some((c) => BLOCK_CHILD.test(c.tagName));
}

function passthrough(names: string[], keepOnSplit: boolean) {
    const attrs: Record<string, any> = {};
    for (const name of names) {
        attrs[name] = {
            default: null,
            keepOnSplit,
            parseHTML: (el: HTMLElement) => el.getAttribute(name),
            renderHTML: (a: Record<string, any>) => (a[name] ? { [name]: a[name] } : {}),
        };
    }
    return attrs;
}

const DIV_ATTRS = ['class', 'dir', 'style', 'id'];

export const QuoteDivInline = Node.create({
    name: 'quoteDivInline',
    group: 'block',
    content: 'inline*',
    defining: true,
    addAttributes: () => passthrough(DIV_ATTRS, false),
    parseHTML: () => [{ tag: 'div', priority: 60, getAttrs: (el) => (inQuote(el as HTMLElement) && !hasBlockChild(el as HTMLElement) ? null : false) }],
    renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes), 0],
});

export const QuoteDivBlock = Node.create({
    name: 'quoteDivBlock',
    group: 'block',
    content: 'block+',
    defining: true,
    addAttributes: () => passthrough(DIV_ATTRS, false),
    parseHTML: () => [{ tag: 'div', priority: 60, getAttrs: (el) => (inQuote(el as HTMLElement) && hasBlockChild(el as HTMLElement) ? null : false) }],
    renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes), 0],
});

export const QuoteAttributes = Extension.create({
    name: 'quoteAttributes',
    addGlobalAttributes() {
        return [
            { types: ['blockquote'], attributes: passthrough(['class', 'style', 'dir', 'type'], false) },
            { types: ['horizontalRule'], attributes: passthrough(['style', 'tabindex'], false) },
            { types: ['image'], attributes: passthrough(['data-bx-inline'], false) },
        ];
    },
});

/** Lista lista para `extensions: [...]` del editor del redactor. */
export const quoteExtensions = [QuoteDivInline, QuoteDivBlock, QuoteAttributes];
