// @vitest-environment jsdom
/**
 * (C) Controles sueltos y restos de overlays de extensiones: se eliminan del correo recibido (sanitizeHtml) y NUNCA entran
 * en el cuerpo enviado desde el redactor (cleanOutgoingHtml).
 */
import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '@/lib/sanitizeHtml';
import { cleanOutgoingHtml } from '@/lib/outgoing-html';

const text = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return (d.textContent || '').replace(/\s+/g, ' ').trim(); };

describe('sanitizeHtml: controles y botones', () => {
    it('un <button> sin enlace se elimina por completo (texto incluido)', () => {
        const out = sanitizeHtml('<p>Hola</p><button>Close</button><button type="button" style="width:100%">Close</button>');
        expect(out).not.toMatch(/button|Close/i);
        expect(text(out)).toBe('Hola');
    });

    it('bloques cuyo unico contenido son botones "Close"/"Cerrar" desaparecen enteros', () => {
        const out = sanitizeHtml('<p>Texto</p><div class="wrap"><div><button>Close</button></div><button>Cerrar</button></div><p>Fin</p>');
        expect(out).not.toContain('wrap');
        expect(out).not.toMatch(/<div/);
        expect(text(out)).toBe('TextoFin');
    });

    it('elimina input/select/textarea/form/dialog y role=button', () => {
        const out = sanitizeHtml('<form action="https://x.test"><input name="q"><select><option>Uno</option></select><textarea>abc</textarea><button>Enviar</button></form><div role="button">Cerrar</div><dialog open><p>Modal</p></dialog><p>ok</p>');
        expect(out).not.toMatch(/<(form|input|select|option|textarea|button|dialog)/i);
        expect(out).not.toContain('role=');
        expect(text(out)).toBe('ok');
    });

    it('un formulario que envuelve contenido real conserva ese contenido', () => {
        const out = sanitizeHtml('<form><p>Texto util</p><input name="x"><button>Enviar</button></form>');
        expect(text(out)).toBe('Texto util');
        expect(out).not.toMatch(/<(form|input|button)/i);
    });

    it('un <button> dentro de un enlace conserva su texto como contenido del enlace', () => {
        const out = sanitizeHtml('<a href="https://ejemplo.test/x"><button>Ver pedido</button></a>');
        expect(out).toContain('href="https://ejemplo.test/x"');
        expect(text(out)).toBe('Ver pedido');
        expect(out).not.toMatch(/<button/i);
    });

    it('elementos con role=button que contienen un enlace real se conservan (botones "bulletproof")', () => {
        const out = sanitizeHtml('<div role="button"><a href="https://ejemplo.test">Comprar</a></div>');
        expect(out).toContain('Comprar');
    });
});

describe('sanitizeHtml: restos de overlays de extensiones', () => {
    it('elimina data-bx-ui y clases de overlay del redactor con todo su contenido', () => {
        const out = sanitizeHtml('<p>Mensaje</p><div data-bx-ui="zoom-overlay"><p>Zoom</p><a href="https://z.test">Unirse</a></div><div class="bx-overlay bx-zoom-form"><span>Meet</span></div><div class="bloomx-gif-picker">GIF</div>');
        expect(text(out)).toBe('Mensaje');
    });

    it('no toca clases ajenas parecidas (iconos boxicons, bx-linkwarn)', () => {
        const out = sanitizeHtml('<p class="bx-home">Casa</p><span class="bx-linkwarn">x</span>');
        expect(text(out)).toBe('Casax');
    });

    it('conserva el HTML normal de un correo (tablas, imagenes, enlaces)', () => {
        const html = '<table width="100%"><tr><td><img src="https://ejemplo.test/a.png" alt="a"><a href="https://ejemplo.test">Enlace</a></td></tr></table>';
        const out = sanitizeHtml(html);
        expect(out).toContain('<table');
        expect(out).toContain('<img');
        expect(out).toContain('Enlace');
    });
});

describe('cleanOutgoingHtml: el cuerpo enviado nunca lleva overlays ni controles', () => {
    it('quita [data-bx-ui], controles y dialogos que una extension haya insertado', () => {
        const out = cleanOutgoingHtml('<p>Hola equipo</p><div data-bx-ui="zoom-overlay"><form><input><button>Close</button></form></div><dialog open><button>Close</button></dialog><button>Close</button><p>Adios</p>');
        expect(out).toBe('<p>Hola equipo</p><p>Adios</p>');
    });

    it('conserva el contenido normal (enlaces, botones dentro de enlaces, imagenes)', () => {
        const html = '<p>Reunion: <a href="https://zoom.test/j/1">Unirse</a></p><img src="https://a.test/i.png"><a href="https://x.test"><button>Ir</button></a>';
        expect(text(cleanOutgoingHtml(html))).toBe('Reunion: UnirseIr');
        expect(cleanOutgoingHtml(html)).toContain('<img');
    });

    it('HTML sin marcadores se devuelve tal cual (camino rapido)', () => {
        const html = '<p>Solo texto <b>simple</b></p>';
        expect(cleanOutgoingHtml(html)).toBe(html);
    });
});
