import { describe, expect, it } from 'vitest';
import { buildForwardHeaderHtml } from '../forward-header';

describe('buildForwardHeaderHtml (regresion E2E: el remitente perdia la direccion)', () => {
    it('escapa "Nombre <correo>" para que la direccion sea visible', () => {
        const html = buildForwardHeaderHtml({ from: 'Facturacion <billing@ext.test>', date: 'Sep 29', subject: 'Hola', to: 'a@b.test' });
        expect(html).toContain('From: Facturacion &lt;billing@ext.test&gt;');
        expect(html).not.toContain('<billing@ext.test>');
    });
    it('neutraliza HTML en asunto y destinatarios', () => {
        const html = buildForwardHeaderHtml({ from: 'x', date: 'd', subject: '<img src=x onerror=alert(1)>', to: '"A, B" <a@b.test>' });
        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;img');
    });
});
