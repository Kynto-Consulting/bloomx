// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Text, Heading, Code, Link, Markdown, IconGlyph } from '../Typography';
import { assertThemeSafe, applyBrand, click, flush, installCleanup, kitSuite, mount, q, qa } from './harness';

const any = (v: unknown) => v as never;
const EVIL = '<script>alert(1)</script><img src=x onerror=alert(1)>';

kitSuite('Typography', () => (
    <div>
        {(['default', 'muted', 'caption', 'label', 'quote'] as const).map((v) => <Text key={v} variant={v} lines={2} mono>{`variante ${v}`}</Text>)}
        {(['neutral', 'primary', 'success', 'warning', 'danger', 'info'] as const).map((tone) => (
            <div key={tone}><Text tone={tone} size="lg" weight="bold" align="center" content={tone} /><Heading level={2} tone={tone} content={tone} /><IconGlyph name="Star" tone={tone} label="estrella" /></div>
        ))}
        <Text truncate content="truncado" />
        {[1, 2, 3, 4, 5, 6].map((l) => <Heading key={l} level={l as 1} content={`h${l}`} />)}
        <Heading size="xl" content="grande" />
        <Code content="const a = 1" /><Code block copyable content={'linea1\nlinea2'} language="ts" /><Code copyable content="x" />
        <Link label="web" url="https://example.com" /><Link label="neutral" tone="neutral" url="/ruta" /><Link label="mail" url="mailto:a@b.co" />
        <Markdown content={'# T\n\n**negrita** *cursiva* `codigo` [l](https://a.co)\n\n- a\n- b\n\n1. uno\n2. dos'} />
    </div>
));

describe('Typography', () => {
    installCleanup();
    afterEach(() => { vi.restoreAllMocks(); });

    it('props hostiles: texto plano, nada inyectado', async () => {
        await mount(
            <div>
                <Text tone={any('rainbow')} size={any({})} variant={any('x')} weight={any({})} align={any('y')} lines={any({})} content={EVIL} />
                <Heading level={any('9')} size={any('url(x)')} tone={any('rainbow')} content={EVIL} />
                <Code content={EVIL} block language={any('"><script>')} />
                <Link label={EVIL} url="javascript:alert(1)" tone={any('rainbow')} />
                <Markdown content={`${EVIL}\n\n<b>hola</b>`} size={any({})} />
                <IconGlyph name={any({})} size={any('x')} tone={any('rainbow')} label={any({})} />
                <Text content={any({ a: 1 })} />
            </div>,
        );
        expect(document.body.textContent).toContain(EVIL);
        expect(qa('script, img, b')).toHaveLength(0);
        expect(document.body.innerHTML).not.toMatch(/rainbow|url\(x\)/);
        expect(q('h3')).toBeTruthy();
    });

    it('no emite clases fuera de tokens', async () => {
        const css = applyBrand('saturada (texto malo)', 'brand-light');
        await mount(<div><Text tone="danger" variant="quote">x</Text><Code block copyable content="x" /><Link url="/a" label="a" /><Markdown content="**x**" /></div>);
        assertThemeSafe(document.body, css);
    });

    it('Heading genera h1..h6 reales', async () => {
        await mount(<div>{[1, 2, 3, 4, 5, 6].map((l) => <Heading key={l} level={l as 1} content={`t${l}`} />)}</div>);
        for (let l = 1; l <= 6; l++) expect(q(`h${l}`)!.textContent).toBe(`t${l}`);
    });

    it('Text conserva saltos de linea, trunca y limita lineas', async () => {
        await mount(<div><Text content={'a\nb'} lines={3} /><Text content="t" truncate /><Text variant="quote" content="cita" /></div>);
        const [p1, p2] = qa('p');
        expect(p1.className).toContain('whitespace-pre-wrap');
        expect(p1.className).toContain('line-clamp-3');
        expect(p2.className).toContain('truncate');
        expect(q('blockquote')!.textContent).toBe('cita');
    });

    it('Code: copiar usa el portapapeles y avisa "Copiado" de forma accesible', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        await mount(<Code block copyable content="npm run dev" />);
        const btn = q<HTMLButtonElement>('button')!;
        expect(btn.textContent).toContain('Copiar');
        expect(q('[role="status"]')!.textContent).toBe('');
        await click(btn);
        await flush();
        expect(writeText).toHaveBeenCalledWith('npm run dev');
        expect(q('[role="status"]')!.textContent).toBe('Copiado');
        expect(q('pre code')!.textContent).toBe('npm run dev');
        expect(btn.className).toContain('focus-visible:ring-ring');
    });

    it('Code: sin portapapeles no rompe', async () => {
        Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
        await mount(<Code copyable content="x" />);
        await click(q('button'));
        await flush();
        expect(q('[role="status"]')!.textContent).toBe('');
    });

    it('Link: externo con target/rel, interno, ancla, onPress y URL insegura como texto', async () => {
        const onPress = vi.fn();
        await mount(
            <div>
                <Link label="ext" url="https://example.com/x" />
                <Link label="mail" url="mailto:a@b.co" />
                <Link label="tel" url="tel:+34600000000" />
                <Link label="int" url="/ajustes" />
                <Link label="anc" url="#seccion" />
                <Link label="js" url="javascript:alert(1)" />
                <Link label="data" url="data:text/html,<b>x</b>" />
                <Link label="proto" url="//evil.com" />
                <Link label="rel" url="foo/bar" />
                <Link label="press" url="https://example.com" onPress={onPress} />
            </div>,
        );
        const byLabel = (t: string) => qa<HTMLAnchorElement>('a').find((a) => a.textContent === t)!;
        expect(byLabel('ext').target).toBe('_blank');
        expect(byLabel('ext').rel).toBe('noopener noreferrer');
        expect(byLabel('mail').getAttribute('target')).toBeNull();
        expect(byLabel('tel').getAttribute('href')).toBe('tel:+34600000000');
        expect(byLabel('int').getAttribute('href')).toBe('/ajustes');
        expect(byLabel('int').getAttribute('target')).toBeNull();
        expect(byLabel('anc').getAttribute('href')).toBe('#seccion');
        for (const t of ['js', 'data', 'proto', 'rel']) expect(qa('a').some((a) => a.textContent === t)).toBe(false);
        expect(document.body.textContent).toContain('js');
        await click(byLabel('press'));
        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('Markdown: formato basico como elementos React', async () => {
        await mount(<Markdown content={'# Titulo\n## Sub\n\nhola **fuerte** y *suave* con `code`\nsegunda linea\n\n- uno\n- dos\n\n1. a\n2. b\n\n[ok](https://a.co) [mal](javascript:alert(1)) [int](/x)'} />);
        expect(q('h3')!.textContent).toBe('Titulo');
        expect(q('h4')!.textContent).toBe('Sub');
        expect(q('strong')!.textContent).toBe('fuerte');
        expect(q('em')!.textContent).toBe('suave');
        expect(q('p code')!.textContent).toBe('code');
        expect(q('p br')).toBeTruthy();
        expect(qa('ul li')).toHaveLength(2);
        expect(qa('ol li')).toHaveLength(2);
        const links = qa<HTMLAnchorElement>('a');
        expect(links.map((a) => a.textContent)).toEqual(['ok', 'int']);
        expect(links[0].rel).toBe('noopener noreferrer');
        expect(document.body.textContent).toContain('mal');
    });

    it('Markdown: HTML crudo como texto y limite de tamano', async () => {
        await mount(<Markdown content={`<b>x</b> ${EVIL}`} />);
        expect(document.body.textContent).toContain('<b>x</b>');
        expect(qa('b, script, img')).toHaveLength(0);
        await mount(<Markdown content={'a'.repeat(50000)} />);
        const texts = qa('p').map((p) => p.textContent!.length);
        expect(Math.max(...texts)).toBe(20000);
    });

    it('IconGlyph: decorativo sin label, img con nombre accesible con label', async () => {
        await mount(<div><IconGlyph name="Star" /><IconGlyph name="Star" label="Favorito" tone="warning" /></div>);
        expect(qa('[role="img"]')).toHaveLength(1);
        expect(q('[role="img"]')!.getAttribute('aria-label')).toBe('Favorito');
        expect(q('[role="img"]')!.className).toContain('text-warning');
    });
});
