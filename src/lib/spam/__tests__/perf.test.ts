import { describe, expect, it } from 'vitest';
import { evaluateSpam } from '../engine';
import type { SpamInput } from '../types';

// Entradas hostiles: el motor corre en la ruta de entrada del webhook, asi que debe acotar tiempo y memoria con cualquier cuerpo.
const base = (over: Partial<SpamInput>): SpamInput => ({ headers: {}, from: { name: 'X', email: 'x@y.example' }, subject: 's', text: '', html: '', attachments: [], ...over });
const time = (i: SpamInput) => { const t = Date.now(); const r = evaluateSpam(i, { ownDomains: ['bloomx.test'] }); return { ms: Date.now() - t, r }; };

describe('entradas hostiles: tiempo acotado y sin excepciones', () => {
    const cases: Array<[string, Partial<SpamInput>]> = [
        ['etiquetas <a abiertas sin cerrar', { html: '<a '.repeat(100_000) }],
        ['un <a href enorme sin comilla de cierre', { html: `<a href="${'x'.repeat(250_000)}` }],
        ['miles de enlaces', { html: Array.from({ length: 20_000 }, (_, i) => `<a href="https://h${i}.example/p">t${i}</a>`).join('') }],
        ['div anidados profundos', { html: '<div>'.repeat(50_000) + 'x' + '</div>'.repeat(50_000) }],
        ['style con display:none repetido', { html: '<div style="display:none">'.repeat(20_000) }],
        ['letras separadas interminables', { text: 'a '.repeat(100_000) }],
        ['base64 de varios MB', { text: 'QUJD'.repeat(1_000_000) }],
        ['espacios y saltos', { text: ' \n'.repeat(500_000) }],
        ['unicode mezclado', { subject: 'Рayраl '.repeat(2000), text: 'ab​c'.repeat(200_000) }],
        ['asunto codificado hostil', { headers: { subject: '=?UTF-8?B?' + 'A'.repeat(300_000) + '?=' } }],
        ['cabeceras enormes', { headers: { received: Array.from({ length: 5000 }, () => 'from x ' + 'y'.repeat(5000)), to: 'a@b.c, '.repeat(50_000), 'authentication-results': 'spf=pass;'.repeat(50_000) } }],
        ['mil adjuntos con nombres largos', { attachments: Array.from({ length: 1000 }, (_, i) => ({ filename: 'a'.repeat(5000) + i + '.pdf.exe' })) }],
        ['URL con IDN y puertos', { html: '<a href="https://xn--' + 'a'.repeat(250) + '.com:99999/">x</a>' }],
    ];
    it.each(cases)('%s', (_n, over) => {
        const { ms, r } = time(base(over));
        expect(ms).toBeLessThan(1500);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(100);
    });
    it('un correo normal se evalua en pocos milisegundos', () => {
        const i = base({ text: 'Hola, te escribo para confirmar la reunion. '.repeat(50), html: '<p>' + 'Hola '.repeat(300) + '</p><a href="https://a.example/x">a</a>' });
        time(i); // calentar
        const t = Date.now();
        for (let k = 0; k < 50; k++) evaluateSpam(i, { ownDomains: ['bloomx.test'] });
        expect((Date.now() - t) / 50).toBeLessThan(25);
    });
});
