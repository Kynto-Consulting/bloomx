// @vitest-environment jsdom
/**
 * Round-trip: la respuesta que construye reply-builder (lo que enviamos) es reconocida por NUESTRO plegado (splitQuotedHtml /
 * splitQuotedText) y expone la estructura que los detectores de Gmail, Apple Mail, Thunderbird, Outlook/Titan/Zoho/Yahoo esperan
 * (contenedor .gmail_quote con .gmail_attr justo antes de blockquote.gmail_quote, atribucion en el idioma, cita saneada), sobre el
 * historial real de cada proveedor (fixtures sinteticos de mail-providers). Ademas, el texto plano equivale al HTML.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildForwardQuote, buildReplyQuote } from '@/lib/reply-builder';
import { sanitizeHtml } from '@/lib/sanitizeHtml';
import { splitQuotedHtml } from '../mail/quoted-html';
import { splitQuotedText } from '../mail/quoted-text';
import { htmlToPlainText } from '@/lib/html-to-text';

const DIR = path.resolve(__dirname, '../../lib/__tests__/fixtures/mail-providers');
const htmlFixtures = fs.readdirSync(DIR).filter((f) => f.endsWith('.html'));
const dom = (html: string) => new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
const OWN = 'Mi respuesta nueva 12345';

const src = { from: '"Ana \\"la jefa\\" O\'Brien" <ana@ejemplo.test>', to: 'yo@ejemplo.test', subject: 'Presupuesto', createdAt: '2026-09-01T09:00:00.000Z' };
const es = { locale: 'es-PE', timeZone: 'America/Lima', sanitize: sanitizeHtml, t: (k: string, p?: Record<string, string | number>) => (k === 'emailList.quoteHeader' ? `El ${p?.date}, ${p?.from} escribió:` : k) };
const en = { locale: 'en-US', timeZone: 'UTC', sanitize: sanitizeHtml, t: (k: string, p?: Record<string, string | number>) => (k === 'emailList.quoteHeader' ? `On ${p?.date}, ${p?.from} wrote:` : k) };

describe('estructura que esperan los clientes', () => {
    const r = buildReplyQuote(src, '<p>Texto original</p>', es);
    const root = dom(r.html);

    it('div.gmail_quote > div.gmail_attr (atribucion) + blockquote.gmail_quote, en ese orden, con el estilo de cita de Gmail', () => {
        const wrap = root.querySelector('div.gmail_quote')!;
        expect(wrap).toBeTruthy();
        const kids = Array.from(wrap.children);
        expect(kids[0].matches('div.gmail_attr[dir="ltr"]')).toBe(true);
        expect(kids[1].matches('blockquote.gmail_quote')).toBe(true);
        const style = kids[1].getAttribute('style') || '';
        expect(style).toMatch(/margin:\s*0(px)?\s+0(px)?\s+0(px)?\s+0?\.8ex/);
        expect(style).toMatch(/border-left:\s*1px solid rgb\(204,\s*204,\s*204\)/);
        expect(style).toMatch(/padding-left:\s*1ex/);
    });
    it('atribucion en el idioma del usuario, con fecha larga en su zona y el nombre escapado (comillas, apostrofes, <>)', () => {
        const attr = root.querySelector('.gmail_attr')!;
        expect(attr.textContent).toMatch(/^El .+ escribió:$/);
        expect(attr.textContent).toContain('ana@ejemplo.test');
        expect(attr.textContent).toContain('O\'Brien');
        expect(attr.innerHTML).toContain('&lt;ana@ejemplo.test&gt;');
        expect(attr.querySelector('a,script,img')).toBeNull();
        const attrEn = dom(buildReplyQuote(src, '<p>x</p>', en).html).querySelector('.gmail_attr')!.textContent;
        expect(attrEn).toMatch(/^On .+ wrote:$/);
    });
    it('un nombre hostil no inyecta HTML', () => {
        const hostile = buildReplyQuote({ ...src, from: '"<img src=x onerror=alert(1)>" <a@b.test>' }, '<p>x</p>', es);
        expect(dom(hostile.html).querySelector('img,script')).toBeNull();
        expect(hostile.html).not.toMatch(/<img/i); // el nombre queda como texto inerte
    });
    it('el texto plano lleva la atribucion y la cita con "> " y equivale al HTML', () => {
        expect(r.text).toMatch(/^El .+ escribió:$/m);
        expect(r.text).toMatch(/^> Texto original$/m);
        expect(htmlToPlainText(r.html).replace(/\s+/g, ' ')).toContain('Texto original');
    });
});

describe('nuestra respuesta sobre el historial de cada proveedor', () => {
    it('hay fixtures por proveedor', () => expect(htmlFixtures.length).toBeGreaterThanOrEqual(10));

    for (const file of htmlFixtures) {
        it(`${file}: la respuesta se pliega en nuestro lector (contenido propio visible, historial plegado) y el texto tambien`, () => {
            const original = fs.readFileSync(path.join(DIR, file), 'utf8');
            const reply = buildReplyQuote(src, original, es);
            const full = `<p>${OWN}</p>${reply.body}`;
            const split = splitQuotedHtml(sanitizeHtml(full));
            expect(split, file).not.toBeNull();
            expect(split!.main).toContain(OWN);
            // el historial (atribucion incluida) no queda en el contenido propio
            expect(split!.main).not.toContain('escribió:');
            expect(split!.blocks).toBe(1);
            // y la version texto se pliega igual
            const t = splitQuotedText(`${OWN}\n\n${reply.text}`);
            expect(t, file).not.toBeNull();
            expect(t!.main).toContain(OWN);
            expect(t!.main).not.toMatch(/escribió:/);
        });
    }

    it('responder a una respuesta nuestra (3 niveles) sigue siendo UN bloque de primer nivel y conserva los niveles', () => {
        const l1 = buildReplyQuote(src, '<p>Mensaje original</p>', es);
        const l2 = buildReplyQuote({ ...src, from: 'Bea <bea@ejemplo.test>' }, `<p>Respuesta de Bea</p>${l1.body}`, es);
        const l3 = buildReplyQuote({ ...src, from: 'Carlos <carlos@ejemplo.test>' }, `<p>Respuesta de Carlos</p>${l2.body}`, en);
        const split = splitQuotedHtml(sanitizeHtml(`<p>${OWN}</p>${l3.body}`))!;
        expect(split.blocks).toBe(1);
        expect(split.main).toContain(OWN);
        expect(split.main).not.toContain('Respuesta de Carlos');
        expect(dom(l3.html).querySelectorAll('blockquote.gmail_quote').length).toBe(3);
        expect((l3.text.match(/^> > > /gm) || []).length).toBeGreaterThan(0); // texto: un nivel mas de "> " por cita anidada
        const t = splitQuotedText(`${OWN}\n\n${l3.text}`)!;
        expect(t.levels).toBeGreaterThanOrEqual(2);
    });

    it('reenviar: el bloque Forwarded message (estilo Gmail y estilo Outlook) se reconoce y el original no queda en el contenido propio', () => {
        for (const style of ['gmail', 'outlook'] as const) {
            const fwd = buildForwardQuote(src, '<p>Contenido reenviado</p>', { ...en, forwardStyle: style });
            const root = dom(fwd.html);
            if (style === 'gmail') {
                expect(root.querySelector('div.gmail_quote div.gmail_attr')?.textContent).toContain('ana@ejemplo.test');
                expect(fwd.html).toMatch(/Forwarded message/i);
            } else {
                expect(root.querySelector('hr + div#divRplyFwdMsg')).toBeTruthy();
                expect(root.querySelector('#divRplyFwdMsg')?.textContent).toMatch(/From:[\s\S]*Sent:[\s\S]*To:[\s\S]*Subject:/);
            }
            expect(fwd.text).toContain('Contenido reenviado');
            const split = splitQuotedHtml(sanitizeHtml(`<p>${OWN}</p>${fwd.body}`));
            expect(split).not.toBeNull();
            expect(split!.main).toContain(OWN);
            expect(split!.main).not.toContain('Contenido reenviado');
        }
    });

    it('la cita queda saneada aunque el original traiga scripts, controles, estilos externos y pixeles de seguimiento', () => {
        const hostile = '<p>Hola</p><script>alert(1)</script><link rel="stylesheet" href="https://x.test/a.css"><form><input name="q"></form><img src="https://t.test/p.gif?id=9" width="1" height="1">';
        const r = buildReplyQuote(src, hostile, es);
        const root = dom(r.html);
        expect(root.querySelector('script,link,form,input')).toBeNull();
        expect(root.querySelector('img[src*="t.test"]')).toBeNull();
        expect(root.textContent).toContain('Hola');
    });

    it('un historico enorme se recorta con marcador visible y HTML bien formado', () => {
        const big = Array.from({ length: 4000 }, (_, i) => `<p>Linea numero ${i} del historial largo</p>`).join('');
        const r = buildReplyQuote(src, big, { ...es, maxQuoteBytes: 20 * 1024 });
        expect(new TextEncoder().encode(r.html).length).toBeLessThan(40 * 1024);
        expect(r.html).toContain('[...]');
        const root = dom(r.html);
        expect(root.querySelectorAll('blockquote').length).toBe(1);
        expect(splitQuotedHtml(sanitizeHtml(`<p>${OWN}</p>${r.body}`))!.main).toContain(OWN);
    });
});
