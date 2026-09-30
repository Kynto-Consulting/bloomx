import { describe, expect, it } from 'vitest';
import { htmlToPlainText } from '../html-to-text';

describe('htmlToPlainText', () => {
    it('separa bloques y respeta <br>', () => {
        expect(htmlToPlainText('<p>Hola</p><p>Mundo<br>otra linea</p><div>fin</div>')).toBe('Hola\n\nMundo\notra linea\n\nfin');
    });

    it('marca listas con "- " y sangra las anidadas', () => {
        expect(htmlToPlainText('<ul><li>uno</li><li>dos<ul><li>sub</li></ul></li></ul>')).toBe('- uno\n- dos\n  - sub');
    });

    it('titulos y filas de tabla', () => {
        const t = htmlToPlainText('<h1>Titulo</h1><table><tr><td>A</td><td>B</td></tr><tr><td>C</td></tr></table>');
        expect(t).toBe('Titulo\n\nA B\nC');
    });

    it('enlaces: "texto (url)" solo cuando difieren', () => {
        expect(htmlToPlainText('<a href="https://x.test/a">ver</a>')).toBe('ver (https://x.test/a)');
        expect(htmlToPlainText('<a href="https://x.test/">https://x.test</a>')).toBe('https://x.test');
        expect(htmlToPlainText('<a href="mailto:a@x.test">a@x.test</a>')).toBe('a@x.test');
        expect(htmlToPlainText('<a href="mailto:a@x.test">Escribeme</a>')).toBe('Escribeme (a@x.test)');
        expect(htmlToPlainText('<a href="javascript:alert(1)">malo</a>')).toBe('malo');
    });

    it('decodifica entidades', () => {
        expect(htmlToPlainText('<p>a &amp; b &lt;c&gt; &#233; &#x1F600; &nbsp;fin &copy;</p>')).toBe('a & b <c> é \u{1F600} fin ©');
    });

    it('descarta style, script, head y comentarios (incluidos los condicionales de Outlook)', () => {
        const html = '<html><head><title>T</title><style>p{color:red}</style></head><body><!--[if mso]><p>solo outlook</p><![endif]--><script>alert(1)</script><p>visible</p><!-- nota --></body></html>';
        expect(htmlToPlainText(html)).toBe('visible');
    });

    it('imagenes como [alt]', () => {
        expect(htmlToPlainText('<p>Logo <img src="https://x.test/l.png" alt="Acme"> <img src="https://x.test/t.gif"></p>')).toBe('Logo [Acme]');
    });

    it('citas: prefijo "> " por nivel y atribucion como linea normal previa', () => {
        const html = '<div>Respuesta</div><div class="gmail_quote"><div dir="ltr" class="gmail_attr">El lun, Ana &lt;ana@x.test&gt; escribió:<br></div>'
            + '<blockquote class="gmail_quote"><div>Nivel uno</div><div class="gmail_quote"><div class="gmail_attr">El dom, Beto escribió:<br></div><blockquote class="gmail_quote"><div>Nivel dos</div></blockquote></div></blockquote></div>';
        expect(htmlToPlainText(html)).toBe([
            'Respuesta',
            'El lun, Ana <ana@x.test> escribió:',
            '> Nivel uno',
            '> El dom, Beto escribió:',
            '> > Nivel dos',
        ].join('\n'));
    });

    it('lineas en blanco dentro de la cita conservan el prefijo sin espacio final', () => {
        const t = htmlToPlainText('<blockquote><p>a</p><p>b</p></blockquote>');
        expect(t).toBe('> a\n>\n> b');
    });

    it('pre conserva saltos', () => {
        expect(htmlToPlainText('<pre>a\n  b\nc</pre>')).toBe('a\n  b\nc');
    });

    it('maxLength corta y marca', () => {
        const t = htmlToPlainText('<p>' + 'palabra '.repeat(100) + '</p>', { maxLength: 50 });
        expect(t.length).toBeLessThanOrEqual(50);
        expect(t.endsWith('…')).toBe(true);
    });

    it('es robusto ante HTML roto', () => {
        expect(htmlToPlainText('a < b <p>c')).toBe('a < b\n\nc');
        expect(htmlToPlainText('<div><span>sin cerrar')).toBe('sin cerrar');
        expect(htmlToPlainText('')).toBe('');
    });
});
