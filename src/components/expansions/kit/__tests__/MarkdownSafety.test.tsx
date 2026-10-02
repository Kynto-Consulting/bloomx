// @vitest-environment jsdom
/**
 * Sandbox de MARKDOWN: el contenido es un dato de terceros (una extension). Nunca debe producir HTML vivo, atributos de evento, enlaces
 * peligrosos ni imagenes remotas; el HTML crudo se muestra como texto.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { installCleanup, kitSuite, mount, q, qa } from './harness';
import { Markdown, MARKDOWN_MAX_CHARS } from '../Typography';

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => React.createElement('a', { href, ...rest }, children) }));

kitSuite('Markdown', () => <Markdown content={'# Titulo\n\n**negrita** *cursiva* `codigo` [enlace](https://example.com)\n\n- uno\n- dos\n\n```\nbloque\n```'} />);

const html = () => document.body.innerHTML;

describe('Markdown seguro', () => {
    installCleanup();

    const hostile = [
        '<script>alert(1)</script>',
        '<img src=x onerror=alert(1)>',
        '<iframe src="https://evil.example"></iframe>',
        '<a href="javascript:alert(1)" onclick="alert(2)">x</a>',
        '<svg onload=alert(1)><circle/></svg>',
        '<style>body{display:none}</style>',
        '<form action="https://evil.example"><input name=p></form>',
        '<object data="x"></object><embed src="x">',
        '<meta http-equiv="refresh" content="0;url=https://evil.example">',
        '<base href="https://evil.example/">',
        '<link rel="stylesheet" href="https://evil.example/x.css">',
        '<details open ontoggle=alert(1)>',
    ];

    it.each(hostile)('el HTML crudo se ve como TEXTO y no crea elementos: %s', async (source) => {
        await mount(<Markdown content={source} />);
        for (const tag of ['script', 'img', 'iframe', 'svg', 'style', 'form', 'input', 'object', 'embed', 'meta', 'base', 'link', 'details']) {
            expect(q(tag), `<${tag}>`).toBeNull();
        }
        expect(qa('[onerror], [onclick], [onload], [ontoggle]').length).toBe(0);
        expect(qa<HTMLAnchorElement>('a').filter((a) => /^\s*javascript:/i.test(a.getAttribute('href') || '')).length).toBe(0);
        expect(document.body.textContent).toContain(source.slice(0, 8));
    });

    const badLinks = [
        'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:msgbox(1)',
        'file:///etc/passwd', 'blob:https://x/y', '//evil.example/x', 'jav&#x61;script:alert(1)', '%6Aavascript:alert(1)', '\\\\evil\\share',
    ];
    it.each(badLinks)('un enlace con destino peligroso no es un enlace: %s', async (url) => {
        await mount(<Markdown content={`[pulsa aqui](${url}) y [otro](${url})`} />);
        const hrefs = qa<HTMLAnchorElement>('a').map((a) => a.getAttribute('href') || '');
        expect(hrefs.filter((h) => !/^(https?:|mailto:|tel:|\/(?!\/)|#)/i.test(h))).toEqual([]);
        expect(hrefs.some((h) => /script|data:|blob:|file:/i.test(h))).toBe(false);
        expect(document.body.textContent).toContain('pulsa aqui');
    });

    it('enlaces seguros: https abre fuera con noopener noreferrer; relativos e internos sin target', async () => {
        await mount(<Markdown content={'[web](https://example.com/a?b=1) [mail](mailto:a@b.co) [tel](tel:+34600000000) [int](/extensions/notes) [ancla](#top)'} />);
        const a = qa<HTMLAnchorElement>('a');
        expect(a.map((x) => x.getAttribute('href'))).toEqual(['https://example.com/a?b=1', 'mailto:a@b.co', 'tel:+34600000000', '/extensions/notes', '#top']);
        expect(a[0].getAttribute('target')).toBe('_blank');
        expect(a[0].getAttribute('rel')).toBe('noopener noreferrer');
        expect(a[3].hasAttribute('target')).toBe(false);
    });

    it('las imagenes en Markdown no se cargan (sin <img>, sin peticion remota)', async () => {
        await mount(<Markdown content={'![tracker](https://evil.example/pixel.gif) ![x](javascript:alert(1))'} />);
        expect(q('img')).toBeNull();
        expect(qa('[src]').length).toBe(0);
    });

    it('formato permitido: cabeceras (nunca h1/h2: cuelgan bajo el h1 de la pagina), listas, codigo y bloques', async () => {
        await mount(<Markdown content={'# Uno\n## Dos\n### Tres\n\n1. a\n2. b\n\n- x\n- y\n\n```js\nconst x = "<b>";\n```'} />);
        expect(qa('h1, h2').length).toBe(0);
        expect(qa('h3, h4, h5').map((n) => n.tagName)).toEqual(['H3', 'H4', 'H5']);
        expect(q('ol')?.querySelectorAll('li').length).toBe(2);
        expect(q('ul')?.querySelectorAll('li').length).toBe(2);
        expect(q('pre code')?.textContent).toBe('const x = "<b>";');
        expect(q('pre code b')).toBeNull();
    });

    it('limite de tamano: se recorta a MARKDOWN_MAX_CHARS y no se cuelga con entradas patologicas', async () => {
        const started = Date.now();
        const nasty = `${'*'.repeat(5000)}${'['.repeat(5000)}${'`'.repeat(5000)}${'a'.repeat(MARKDOWN_MAX_CHARS)}`;
        await mount(<Markdown content={nasty} />);
        expect((document.body.textContent || '').length).toBeLessThanOrEqual(MARKDOWN_MAX_CHARS + 10);
        expect(Date.now() - started).toBeLessThan(5000);
    });

    it('nada de style en linea con color y ninguna clase fuera de los tokens (el contenido no puede elegir estilos)', async () => {
        await mount(<Markdown content={'<span style="color:red">x</span> **a** [b](https://c.d)'} />);
        expect(qa('[style]').length).toBe(0);
        expect(html()).not.toMatch(/class="[^"]*\bevil\b/);
    });
});
