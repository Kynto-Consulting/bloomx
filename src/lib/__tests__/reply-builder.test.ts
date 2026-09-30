import { describe, expect, it } from 'vitest';
import {
    buildForwardQuote,
    buildForwardSubject,
    buildReplyQuote,
    buildReplySubject,
    cleanQuotedHtml,
    displayFrom,
    formatLongDate,
    getStoredForwardStyle,
    isTrackingImage,
    parseFromHeader,
    trimHtmlToBytes,
    utf8Length,
    type ReplyDeps,
} from '../reply-builder';
import { tokenizeHtml } from '../html-tokenize';

// Textos i18n sinteticos (es).
const ES: Record<string, string> = {
    'emailList.quoteHeader': 'El {date}, {from} escribió:',
    'mailView.replyQuote.trimmed': 'Se recortó el historial anterior',
    'mailView.replyQuote.fwdTitle': 'Mensaje reenviado',
    'mailView.replyQuote.from': 'De',
    'mailView.replyQuote.date': 'Fecha',
    'mailView.replyQuote.subject': 'Asunto',
    'mailView.replyQuote.to': 'Para',
    'mailView.replyQuote.cc': 'Cc',
    'mailView.replyQuote.sent': 'Enviado el',
};
const tEs: ReplyDeps['t'] = (key, params) => {
    let s = ES[key] ?? key;
    if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
    return s;
};
const base: ReplyDeps = { t: tEs, locale: 'es-PE', timeZone: 'America/Lima' };
const src = { from: 'Ana Perez <ana@ejemplo.test>', to: 'yo@ejemplo.test', subject: 'Hola', createdAt: '2025-09-29T19:30:00.000Z' };

/** Comprueba que cada etiqueta abierta se cierra en orden (sin abiertas ni cierres sueltos). */
function isBalanced(html: string): boolean {
    const stack: string[] = [];
    const VOID = new Set(['br', 'hr', 'img', 'meta', 'link', 'input', 'wbr']);
    for (const t of tokenizeHtml(html)) {
        if (t.type === 'open' && !VOID.has(t.name) && !t.selfClosing) stack.push(t.name);
        else if (t.type === 'close') { if (stack.pop() !== t.name) return false; }
    }
    return stack.length === 0;
}

describe('formatLongDate', () => {
    it('fecha larga con zona segun locale y timeZone inyectados', () => {
        const es = formatLongDate('2025-09-29T19:30:00.000Z', 'es-PE', 'America/Lima');
        expect(es).toMatch(/lunes/i);
        expect(es).toMatch(/septiembre|setiembre/i);
        expect(es).toContain('2025');
        expect(es).toMatch(/GMT-5|UTC-5/);
        const en = formatLongDate('2025-09-29T19:30:00.000Z', 'en-US', 'UTC');
        expect(en).toMatch(/Monday, September 29, 2025/);
        expect(en).toMatch(/GMT|UTC/);
    });
    it('valor invalido: devuelve el original; zona invalida: no lanza', () => {
        expect(formatLongDate('no-fecha')).toBe('no-fecha');
        expect(formatLongDate('2025-09-29T19:30:00.000Z', 'en-US', 'Zona/Invalida')).toContain('2025');
    });
});

describe('parseFromHeader / displayFrom', () => {
    it('variantes de cabecera From', () => {
        expect(parseFromHeader('"Ana \\"La Jefa\\"" <a@b.test>')).toEqual({ name: 'Ana "La Jefa"', email: 'a@b.test' });
        expect(parseFromHeader("O'Brien <o@b.test>")).toEqual({ name: "O'Brien", email: 'o@b.test' });
        expect(parseFromHeader('a@b.test')).toEqual({ name: '', email: 'a@b.test' });
        expect(parseFromHeader('<a@b.test>')).toEqual({ name: '', email: 'a@b.test' });
        expect(displayFrom('"Ana" <a@b.test>')).toBe('Ana <a@b.test>');
    });
});

describe('buildReplyQuote: estructura compatible con el plegado de clientes', () => {
    const q = buildReplyQuote(src, '<p>Original</p>', base);

    it('div.gmail_quote > div.gmail_attr y luego blockquote.gmail_quote (orden atribucion -> cita)', () => {
        expect(q.html.startsWith('<div class="gmail_quote"><div dir="ltr" class="gmail_attr">')).toBe(true);
        const attrAt = q.html.indexOf('class="gmail_attr"');
        const quoteAt = q.html.indexOf('<blockquote class="gmail_quote"');
        expect(attrAt).toBeGreaterThan(0);
        expect(quoteAt).toBeGreaterThan(attrAt);
        expect(q.html).toContain('<br></div><blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex"><p>Original</p></blockquote></div>');
        expect(isBalanced(q.html)).toBe(true);
    });

    it('atribucion en el idioma del usuario con fecha larga y zona, y remitente escapado', () => {
        expect(q.html).toMatch(/El lunes, 29 de (?:septiembre|setiembre) de 2025.*GMT-5, Ana Perez &lt;ana@ejemplo\.test&gt; escribió:/);
        const en = buildReplyQuote(src, 'x', { locale: 'en-US', timeZone: 'UTC' });
        expect(en.html).toMatch(/On Monday, September 29, 2025.*(?:GMT|UTC), Ana Perez &lt;ana@ejemplo\.test&gt; wrote:/);
    });

    it('body = parrafo vacio + cita', () => {
        expect(q.body).toBe(`<p></p>${q.html}`);
    });

    it('escapa nombres con comillas, apostrofes, HTML, &, unicode y RTL', () => {
        const cases = [
            '"Ana \\"La Jefa\\"" <a@b.test>',
            "O'Brien <o@b.test>",
            '<script>alert(1)</script> <x@b.test>',
            'Tom & Jerry <tj@b.test>',
            'José Ñandú \u{1F600} <j@b.test>',
            'שלום مرحبا <rtl@b.test>',
        ];
        for (const from of cases) {
            const r = buildReplyQuote({ ...src, from }, 'x', base);
            expect(r.html).not.toContain('<script');
            expect(r.html).not.toMatch(/<x@b\.test>/);
            expect(isBalanced(r.html)).toBe(true);
        }
        const amp = buildReplyQuote({ ...src, from: 'Tom & Jerry <tj@b.test>' }, 'x', base);
        expect(amp.html).toContain('Tom &amp; Jerry &lt;tj@b.test&gt;');
        const scr = buildReplyQuote({ ...src, from: '<script>alert(1)</script> <x@b.test>' }, 'x', base);
        expect(scr.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        const quoted = buildReplyQuote({ ...src, from: '"Ana \\"La Jefa\\"" <a@b.test>' }, 'x', base);
        expect(quoted.html).toContain('Ana "La Jefa" &lt;a@b.test&gt;');
        const rtl = buildReplyQuote({ ...src, from: 'שלום <rtl@b.test>' }, 'x', base);
        expect(rtl.html).toContain('שלום &lt;rtl@b.test&gt;');
    });

    it('version texto: atribucion + cita con "> " por nivel, coherente con el HTML', () => {
        const nested = '<div>Nivel 1</div><div class="gmail_quote"><div class="gmail_attr">Antes, Beto escribió:<br></div><blockquote class="gmail_quote"><div>Nivel 2</div></blockquote></div>';
        const r = buildReplyQuote(src, nested, base);
        const lines = r.text.split('\n');
        expect(lines[0]).toMatch(/^El lunes.* Ana Perez <ana@ejemplo\.test> escribió:$/);
        expect(lines.slice(1)).toEqual(['> Nivel 1', '> Antes, Beto escribió:', '> > Nivel 2']);
        // Mismo contenido en ambas versiones.
        for (const s of ['Nivel 1', 'Antes, Beto escribió:', 'Nivel 2']) {
            expect(r.html).toContain(s);
            expect(r.text).toContain(s);
        }
    });

    it('conserva el historial anidado del original (Outlook/Gmail) dentro de la cita', () => {
        const orig = '<div class="gmail_quote"><blockquote class="gmail_quote"><p>Viejo</p></blockquote></div>';
        const r = buildReplyQuote(src, orig, base);
        expect((r.html.match(/<blockquote/g) || []).length).toBe(2);
        expect(isBalanced(r.html)).toBe(true);
    });
});

describe('limpieza del original', () => {
    it('quita scripts, estilos, link, @import, meta, comentarios y handlers', () => {
        const dirty = '<html><head><meta charset="utf-8"><link rel="stylesheet" href="https://x.test/a.css"><style>@import url(https://x.test/b.css); p{color:red}</style></head>'
            + '<body onload="x()"><!--[if mso]><p>mso</p><![endif]--><script>alert(1)</script><p onclick="x()" style="color:red;@import url(x);behavior:url(a)">Hola<iframe src="https://x.test"></iframe></p></body></html>';
        const out = cleanQuotedHtml(dirty);
        expect(out).toBe('<p style="color:red;">Hola</p>');
    });

    it('quita controles de formulario pero conserva el texto util', () => {
        const out = cleanQuotedHtml('<form action="https://x.test"><p>Dato</p><input type="text" name="a"><select><option>1</option></select><button>Enviar</button><textarea>t</textarea></form>');
        expect(out).toBe('<p>Dato</p>Enviar');
        expect(out).not.toMatch(/<(form|input|select|option|textarea|button)/);
    });

    it('neutraliza javascript:, data:text y onerror', () => {
        const out = cleanQuotedHtml('<a href="javascript:alert(1)">x</a><img src="https://x.test/a.png" onerror="alert(1)"><a href=" JaVa\tScript:alert(1)">y</a>');
        expect(out).not.toMatch(/javascript/i);
        expect(out).not.toMatch(/onerror/i);
    });

    it('quita pixeles de tracking pero conserva imagenes reales remotas', () => {
        const html = [
            '<img src="https://t.test/open?id=1" width="1" height="1">',
            '<img src="https://t.test/a.gif" style="display:none">',
            '<img src="https://t.test/a.gif" style="width:1px;height:1px">',
            '<img src="https://t.test/wf/open?upn=abc">',
            '<img src="https://t.test/pixel.png">',
            '<img src="https://t.test/beacon/x.gif" width="10" height="10">',
            '<img src="https://cdn.test/logo.png" width="120" height="40" alt="Logo">',
            '<img src="https://cdn.test/foto-grande.jpg">',
        ].join('');
        const out = cleanQuotedHtml(html);
        expect(out).toContain('https://cdn.test/logo.png');
        expect(out).toContain('https://cdn.test/foto-grande.jpg');
        expect(out).not.toContain('t.test');
        expect((out.match(/<img/g) || []).length).toBe(2);
    });

    it('isTrackingImage no confunde imagenes normales', () => {
        expect(isTrackingImage([{ name: 'src', value: 'https://cdn.test/opened-door.jpg' }])).toBe(false);
        expect(isTrackingImage([{ name: 'src', value: 'https://cdn.test/banner.png' }, { name: 'width', value: '600' }])).toBe(false);
        expect(isTrackingImage([{ name: 'src', value: 'https://cdn.test/x.png' }, { name: 'width', value: '1' }])).toBe(true);
    });

    it('imagenes data: se marcan data-bx-inline; cid se resuelve o se sustituye por [alt]', () => {
        const png = 'data:image/png;base64,iVBORw0KGgo=';
        const out = cleanQuotedHtml(`<img src="${png}" alt="a"><img src="cid:logo@x" alt="Logo"><img src="cid:otra@x" alt="Otra">`, {
            resolveCid: (cid) => (cid === 'logo@x' ? 'data:image/gif;base64,R0lGOD==' : null),
        });
        expect((out.match(/data-bx-inline="1"/g) || []).length).toBe(2);
        expect(out).toContain(`src="${png}"`);
        expect(out).not.toContain('cid:');
        expect(out).toContain('[Otra]');
    });

    it('descarta data: de tipos no imagen, svg y demasiado grandes', () => {
        const out = cleanQuotedHtml('<img src="data:image/svg+xml;base64,PHN2Zz4=" alt="s"><img src="data:text/html;base64,AAAA" alt="h"><img src="data:image/png;base64,' + 'A'.repeat(50) + '" alt="grande">', { maxInlineImageChars: 40 });
        expect(out).not.toContain('<img');
        expect(out).toContain('[grande]');
    });

    it('equilibra etiquetas: un cierre suelto no puede escapar de la cita', () => {
        const out = cleanQuotedHtml('<div><p>a</div></blockquote></div><b>x');
        expect(isBalanced(out)).toBe(true);
        const r = buildReplyQuote(src, '</blockquote></div><p>fuera?</p>', base);
        expect(r.html.endsWith('<p>fuera?</p></blockquote></div>')).toBe(true);
        expect(isBalanced(r.html)).toBe(true);
    });

    it('usa el sanitizador inyectado y tolera que lance', () => {
        const calls: string[] = [];
        const out = cleanQuotedHtml('<p>x</p>', { sanitize: (h) => { calls.push(h); return h.replace('x', 'y'); } });
        expect(calls.length).toBe(1);
        expect(out).toBe('<p>y</p>');
        expect(cleanQuotedHtml('<p>x</p>', { sanitize: () => { throw new Error('boom'); } })).toBe('x');
    });
});

describe('recorte por tamano', () => {
    const para = (i: number) => `<p>Parrafo numero ${i} con texto de relleno suficiente para ocupar bytes.</p>`;
    const history = (n: number) => Array.from({ length: n }, (_, i) => `<blockquote>${para(i)}<div>${'palabra '.repeat(40)}</div>`).join('') + '</blockquote>'.repeat(n);

    it('no toca lo que cabe', () => {
        const r = trimHtmlToBytes('<p>corto</p>', 1000);
        expect(r).toEqual({ html: '<p>corto</p>', trimmed: false });
    });

    it('recorta el historico mas antiguo sin dejar etiquetas abiertas y anade el marcador i18n', () => {
        const html = history(30);
        expect(isBalanced(html)).toBe(true);
        const r = trimHtmlToBytes(html, 4000, base);
        expect(r.trimmed).toBe(true);
        expect(utf8Length(r.html)).toBeLessThanOrEqual(4000);
        expect(isBalanced(r.html)).toBe(true);
        expect(r.html).toContain('[...] Se recortó el historial anterior');
        expect(r.html).toContain('Parrafo numero 0');
        expect(r.html).not.toContain('Parrafo numero 29');
    });

    it('corta dentro de un texto enorme sin partir entidades ni dejar abiertas', () => {
        const html = `<div><p>${'a &amp; b '.repeat(2000)}</p></div>`;
        const r = trimHtmlToBytes(html, 500, {});
        expect(utf8Length(r.html)).toBeLessThanOrEqual(500);
        expect(isBalanced(r.html)).toBe(true);
        expect(r.html).not.toMatch(/&(?!amp;|lt;|gt;)[a-z]*$/);
        expect(r.html).toContain('[...] Earlier history was trimmed');
    });

    it('una imagen enorme unica no revienta el tope', () => {
        const html = `<p><img src="data:image/png;base64,${'A'.repeat(5000)}"></p>`;
        const r = trimHtmlToBytes(html, 800, {});
        expect(utf8Length(r.html)).toBeLessThanOrEqual(800);
        expect(isBalanced(r.html)).toBe(true);
    });

    it('buildReplyQuote respeta maxQuoteBytes (100 KB por defecto)', () => {
        const big = Array.from({ length: 4000 }, (_, i) => `<p>Linea ${i} ${'x'.repeat(60)}</p>`).join('');
        const r = buildReplyQuote(src, big, { ...base, maxQuoteBytes: 20_000 });
        expect(utf8Length(r.html)).toBeLessThan(21_500);
        expect(isBalanced(r.html)).toBe(true);
        expect(r.text).toContain('Se recortó el historial anterior');
        const def = buildReplyQuote(src, big, base);
        expect(utf8Length(def.html)).toBeLessThan(102_400 + 1500);
        expect(def.html).toContain('bx-quote-trimmed');
    });
});

describe('reenviar', () => {
    const fsrc = { from: '"Ana Perez" <ana@ejemplo.test>', to: 'yo@ejemplo.test, otra@ejemplo.test', cc: 'copia@ejemplo.test', subject: 'Factura <urgente> & mas', createdAt: '2025-09-29T19:30:00.000Z' };

    it('estilo Gmail: div.gmail_quote > div.gmail_attr con Forwarded message, From (sendername), Date, Subject, To', () => {
        const r = buildForwardQuote(fsrc, '<p>Cuerpo</p>', { ...base, forwardStyle: 'gmail' });
        expect(r.html.startsWith('<div class="gmail_quote"><div dir="ltr" class="gmail_attr">---------- Mensaje reenviado ---------<br>')).toBe(true);
        expect(r.html).toContain('De: <strong class="gmail_sendername" dir="auto">Ana Perez</strong> <span dir="auto">&lt;ana@ejemplo.test&gt;</span><br>');
        expect(r.html).toMatch(/<br>Fecha: [^<]*2025[^<]*<br>Asunto: Factura &lt;urgente&gt; &amp; mas<br>Para: yo@ejemplo\.test, otra@ejemplo\.test<br>Cc: copia@ejemplo\.test<br><\/div><br><br><p>Cuerpo<\/p><\/div>$/);
        expect(r.html).not.toContain('<urgente>');
        expect(isBalanced(r.html)).toBe(true);
        expect(r.html).not.toContain('<blockquote');
    });

    it('en ingles usa las etiquetas de Gmail', () => {
        const r = buildForwardQuote(fsrc, 'x', { forwardStyle: 'gmail', locale: 'en-US', timeZone: 'UTC' });
        expect(r.html).toContain('---------- Forwarded message ---------<br>From: <strong');
        expect(r.html).toContain('<br>Date: ');
        expect(r.html).toContain('<br>Subject: ');
        expect(r.html).toContain('<br>To: ');
    });

    it('estilo Outlook: hr + div#divRplyFwdMsg con De/Enviado el/Para/Asunto', () => {
        const r = buildForwardQuote(fsrc, '<p>Cuerpo</p>', { ...base, forwardStyle: 'outlook' });
        expect(r.html.startsWith('<hr style="display:inline-block;width:98%" tabindex="-1"><div id="divRplyFwdMsg" dir="ltr"><font face="Calibri, sans-serif" style="font-size:11pt" color="#000000">')).toBe(true);
        expect(r.html).toContain('<b>De:</b> Ana Perez &lt;ana@ejemplo.test&gt;<br><b>Enviado el:</b> ');
        expect(r.html).toContain('<br><b>Para:</b> yo@ejemplo.test, otra@ejemplo.test<br><b>Cc:</b> copia@ejemplo.test<br><b>Asunto:</b> Factura &lt;urgente&gt; &amp; mas</font><div>&nbsp;</div></div><div class="bx-fwd-body"><p>Cuerpo</p></div>');
        expect(isBalanced(r.html)).toBe(true);
    });

    it('texto coherente con el HTML en ambos estilos (sin prefijo ">")', () => {
        const g = buildForwardQuote(fsrc, '<p>Cuerpo</p>', { ...base, forwardStyle: 'gmail' });
        expect(g.text.split('\n').slice(0, 5)).toEqual(['---------- Mensaje reenviado ---------', 'De: Ana Perez <ana@ejemplo.test>', expect.stringMatching(/^Fecha: .*2025/), 'Asunto: Factura <urgente> & mas', 'Para: yo@ejemplo.test, otra@ejemplo.test']);
        expect(g.text.endsWith('\n\nCuerpo')).toBe(true);
        const o = buildForwardQuote(fsrc, '<p>Cuerpo</p>', { ...base, forwardStyle: 'outlook' });
        expect(o.text).toContain('De: Ana Perez <ana@ejemplo.test>');
        expect(o.text).toContain('Enviado el: ');
        expect(o.text.endsWith('Cuerpo')).toBe(true);
    });

    it('sin preferencia guardada usa gmail (y no falla sin localStorage)', () => {
        expect(getStoredForwardStyle()).toBe('gmail');
        const r = buildForwardQuote(fsrc, 'x', base);
        expect(r.html).toContain('gmail_attr');
    });

    it('remitente solo con correo', () => {
        const r = buildForwardQuote({ ...fsrc, from: 'solo@ejemplo.test' }, 'x', { ...base, forwardStyle: 'gmail' });
        expect(r.html).toContain('De: <strong class="gmail_sendername" dir="auto">solo@ejemplo.test</strong><br>');
    });
});

describe('asuntos multilingues', () => {
    it('respuesta: un solo prefijo, sin acumulacion ni idiomas mezclados', () => {
        const cases: Array<[string, string]> = [
            ['Hola', 'Re: Hola'],
            ['Re: Hola', 'Re: Hola'],
            ['RE: RE: Hola', 'Re: Hola'],
            ['Re[2]: Hola', 'Re: Hola'],
            ['Re(3): Hola', 'Re: Hola'],
            ['Res: Hola', 'Res: Hola'],
            ['RES: Re: Hola', 'Res: Hola'],
            ['AW: Re: Hola', 'AW: Hola'],
            ['AW: AW: Hola', 'AW: Hola'],
            ['SV: Hola', 'SV: Hola'],
            ['VS: Hola', 'VS: Hola'],
            ['Antw: Hola', 'Antw: Hola'],
            ['Odp: Hola', 'Odp: Hola'],
            ['YNT: Hola', 'YNT: Hola'],
            ['ynt: Hola', 'YNT: Hola'],
            ['R: Hola', 'Re: Hola'],
            ['Rif: Hola', 'Re: Hola'],
            ['回复：Hola', 'Re: Hola'],
            ['答复: Hola', 'Re: Hola'],
            ['回覆: Hola', 'Re: Hola'],
            ['RV: Hola', 'Re: Hola'],
            ['Fwd: Hola', 'Re: Hola'],
            ['Re: Re: AW: Res: Hola', 'Re: Hola'],
            ['', 'Re:'],
            ['Re:', 'Re:'],
        ];
        for (const [input, expected] of cases) expect(buildReplySubject(input), input).toBe(expected);
        expect(buildReplySubject(null)).toBe('Re:');
        expect(buildReplySubject('Reunion de equipo')).toBe('Re: Reunion de equipo');
        expect(buildReplySubject('Ivan: plan')).toBe('Re: Ivan: plan');
    });

    it('reenvio: un solo prefijo, conserva el de reenvio conocido del original', () => {
        const cases: Array<[string, string]> = [
            ['Hola', 'Fwd: Hola'],
            ['Fwd: Hola', 'Fwd: Hola'],
            ['FW: Fwd: Hola', 'FW: Hola'],
            ['Fw: Hola', 'FW: Hola'],
            ['WG: Hola', 'WG: Hola'],
            ['TR: Hola', 'TR: Hola'],
            ['RV: Hola', 'RV: Hola'],
            ['ENC: Hola', 'ENC: Hola'],
            ['VB: Hola', 'VB: Hola'],
            ['PD: Hola', 'PD: Hola'],
            ['VL: Hola', 'VL: Hola'],
            ['FS: Hola', 'FS: Hola'],
            ['I: Hola', 'I: Hola'],
            ['Re: Hola', 'Fwd: Hola'],
            ['AW: Hola', 'Fwd: Hola'],
            ['Re: FW: Hola', 'Fwd: Hola'],
            ['转发: Hola', 'Fwd: Hola'],
            ['Fwd: Fwd: Fwd: Hola', 'Fwd: Hola'],
            ['', 'Fwd:'],
        ];
        for (const [input, expected] of cases) expect(buildForwardSubject(input), input).toBe(expected);
    });
});

describe('coherencia con threading.normalizeSubject', () => {
    it('el asunto generado se agrupa en el mismo hilo que el original', async () => {
        const { normalizeSubject } = await import('../threading');
        for (const s of ['Hola', 'AW: Re: Presupuesto', 'RV: Fwd: Informe', 'Res[2]: Plan', '\u56de\u590d\uff1aTema', 'Rif: Ordine']) {
            expect(normalizeSubject(buildReplySubject(s)), s).toBe(normalizeSubject(s));
            expect(normalizeSubject(buildForwardSubject(s)), s).toBe(normalizeSubject(s));
        }
    });
});
