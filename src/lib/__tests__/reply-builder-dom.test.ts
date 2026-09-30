// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import ImageExtension from '@tiptap/extension-image';
import { quoteExtensions } from '@/components/editor/quote-extensions';
import { buildForwardQuote, buildReplyQuote } from '../reply-builder';
import { sanitizeHtml } from '../sanitizeHtml';
import { cleanOutgoingHtml } from '../outgoing-html';

const deps = { locale: 'en-US', timeZone: 'UTC', sanitize: sanitizeHtml };
const src = { from: '"Ana" <ana@ejemplo.test>', to: 'yo@ejemplo.test', subject: 'Hola', createdAt: '2025-09-29T19:30:00.000Z' };
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function parse(html: string) {
    return new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
}

function roundTrip(html: string) {
    const editor = new Editor({
        extensions: [StarterKit.configure({ link: false, underline: false }), ImageExtension.configure({ inline: true, allowBase64: true }), ...quoteExtensions],
        content: html,
    });
    const out = editor.getHTML();
    editor.destroy();
    return out;
}

describe('sanitizacion con DOMPurify real (jsdom)', () => {
    const dirty = '<p onclick="x()">Hola</p><script>alert(1)</script><link rel="stylesheet" href="https://x.test/a.css"><style>@import url(https://x.test/b.css);</style>'
        + '<form><input name="a"><button>Ir</button></form><img src="https://t.test/open?id=1" width="1" height="1"><img src="https://cdn.test/logo.png" alt="Logo">'
        + `<img src="${PNG}" alt="inline">`;

    it('la cita no contiene scripts, estilos externos, controles ni pixeles de tracking', () => {
        const r = buildReplyQuote(src, dirty, deps);
        const dom = parse(r.html);
        expect(dom.querySelector('script,link,style,form,input,button')).toBeNull();
        expect(r.html).not.toMatch(/onclick|@import|t\.test/);
        expect(dom.querySelector('img[src="https://cdn.test/logo.png"]')).not.toBeNull();
        expect(dom.querySelector('img[data-bx-inline="1"]')?.getAttribute('src')).toBe(PNG);
        expect(dom.querySelectorAll('img').length).toBe(2);
    });

    it('selectores de plegado: .gmail_quote > .gmail_attr + blockquote.gmail_quote', () => {
        const dom = parse(buildReplyQuote(src, '<p>x</p>', deps).html);
        const root = dom.querySelector('div.gmail_quote')!;
        expect(root).not.toBeNull();
        expect(root.firstElementChild!.matches('div.gmail_attr[dir="ltr"]')).toBe(true);
        expect(root.lastElementChild!.matches('blockquote.gmail_quote')).toBe(true);
        expect(root.querySelector(':scope > blockquote.gmail_quote')!.getAttribute('style')).toContain('border-left:1px solid');
    });

    it('forward estilo Outlook: hr + #divRplyFwdMsg con 4 etiquetas', () => {
        const dom = parse(buildForwardQuote(src, '<p>x</p>', { ...deps, forwardStyle: 'outlook' }).html);
        expect(dom.querySelector('hr + div#divRplyFwdMsg')).not.toBeNull();
        expect(Array.from(dom.querySelectorAll('#divRplyFwdMsg b')).map((b) => b.textContent)).toEqual(['From:', 'Sent:', 'To:', 'Subject:']);
    });

    it('data-bx-inline sobrevive al saneado de salida (cleanOutgoingHtml)', () => {
        const r = buildReplyQuote(src, `<img src="${PNG}">`, deps);
        expect(cleanOutgoingHtml(r.html)).toContain('data-bx-inline="1"');
    });
});

describe('el editor TipTap conserva la estructura de la cita', () => {
    it('respuesta: gmail_quote, gmail_attr, blockquote con clase y estilo, e imagen inline marcada', () => {
        const r = buildReplyQuote(src, `<div>Hola</div><blockquote><div>Historia</div></blockquote><img src="${PNG}">`, deps);
        const dom = parse(roundTrip(r.body));
        expect(dom.querySelector('div.gmail_quote > div.gmail_attr[dir="ltr"]')).not.toBeNull();
        const bq = dom.querySelector('div.gmail_quote > blockquote.gmail_quote')!;
        expect(bq).not.toBeNull();
        expect(bq.getAttribute('style')).toMatch(/padding-left:\s*1ex/);
        expect(bq.querySelector('blockquote')).not.toBeNull(); // historial anidado
        expect(dom.querySelector('img[data-bx-inline="1"]')).not.toBeNull();
        const root = dom.querySelector('div.gmail_quote')!;
        expect(root.firstElementChild!.className).toBe('gmail_attr');
    });

    it('reenvio Gmail y Outlook sobreviven al editor', () => {
        const g = parse(roundTrip(buildForwardQuote(src, '<p>Cuerpo</p>', { ...deps, forwardStyle: 'gmail' }).body));
        expect(g.querySelector('div.gmail_quote > div.gmail_attr')?.textContent).toContain('---------- Forwarded message ---------');
        const o = parse(roundTrip(buildForwardQuote(src, '<p>Cuerpo</p>', { ...deps, forwardStyle: 'outlook' }).body));
        expect(o.querySelector('hr')).not.toBeNull();
        expect(o.querySelector('div#divRplyFwdMsg')?.textContent).toContain('From:');
        expect(o.querySelector('div#divRplyFwdMsg')?.textContent).toContain('Subject:');
    });

    it('los div fuera de una cita siguen siendo parrafos (pegado normal)', () => {
        expect(roundTrip('<div>uno</div><div>dos</div>')).toBe('<p>uno</p><p>dos</p>');
    });
});
