// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { Stack, Row, Grid, Card, Section, Divider, Spacer } from '../Layout';
import { assertThemeSafe, applyBrand, click, installCleanup, kitSuite, mount, q, qa } from './harness';

const any = (v: unknown) => v as never;

kitSuite('Layout', () => (
    <div>
        <Stack gap={4} align="center" justify="between" wrap padding={2} fullWidth={false}><span>a</span><span>b</span></Stack>
        <Row gap={3} align="baseline" justify="around" wrap padding={1}><span>a</span></Row>
        <Grid columns={3} gap={4} maxHeight="md"><span>a</span><span>b</span></Grid>
        {(['neutral', 'primary', 'success', 'warning', 'danger', 'info'] as const).map((tone) => (
            <Card key={tone} tone={tone} title={`Card ${tone}`} description="desc" icon="Star" footer={<button>ok</button>}>cuerpo</Card>
        ))}
        <Card variant="flat" density="compact">plana</Card>
        <Card variant="elevated" density="spacious" title="Elevada">x</Card>
        <Section title="Sec" description="d" collapsible gap={2}>contenido</Section>
        <Divider label="o" /><Divider /><Divider orientation="vertical" spacing={2} />
        <Spacer size={6} />
    </div>
));

describe('Layout', () => {
    installCleanup();

    it('props hostiles no rompen y no inyectan nada', async () => {
        const evil = '<script>alert(1)</script><img src=x onerror=alert(1)>';
        await mount(
            <div>
                <Stack gap={any('url(x)')} align={any('rainbow')} justify={any({})} padding={any({})}>hola</Stack>
                <Row gap={any({})} align={any(null)}>x</Row>
                <Grid columns={any('rainbow')} gap={any('url(x)')} maxHeight={any({})}>g</Grid>
                <Card tone={any('rainbow')} variant={any({})} density={any('x')} title={evil} description={any({})} icon={any({})}>c</Card>
                <Section title={evil} description={evil} collapsible>s</Section>
                <Divider label={evil} orientation={any('x')} spacing={any({})} />
                <Spacer size={any('url(x)')} />
            </div>,
        );
        expect(document.body.textContent).toContain(evil);
        expect(qa('script, img')).toHaveLength(0);
        expect(document.body.innerHTML).not.toMatch(/url\(|rainbow/);
    });

    it('no emite clases fuera de tokens', async () => {
        const css = applyBrand('pastel', 'brand-dark');
        await mount(<Card tone="danger" title="t" footer={<span>f</span>}><Stack><Row>x</Row></Stack></Card>);
        assertThemeSafe(document.body, css);
    });

    it('Card: grupo con nombre accesible, acento de tono y radio heredado', async () => {
        await mount(<Card tone="success" title="Titulo" description="Sub">x</Card>);
        const card = q('[role="group"]')!;
        expect(card.getAttribute('aria-labelledby')).toBeTruthy();
        expect(document.getElementById(card.getAttribute('aria-labelledby')!)!.textContent).toBe('Titulo');
        expect(card.className).toContain('rounded-lg');
        expect(card.className).toContain('border-l-success');
    });

    it('Section: semantica <section> con aria-labelledby y plegado con aria-expanded', async () => {
        await mount(<Section title="Datos" collapsible defaultOpen={false}><p>dentro</p></Section>);
        const section = q('section')!;
        expect(document.getElementById(section.getAttribute('aria-labelledby')!)!.textContent).toBe('Datos');
        const btn = q<HTMLButtonElement>('button')!;
        expect(btn.getAttribute('aria-expanded')).toBe('false');
        expect(document.getElementById(btn.getAttribute('aria-controls')!)!.hidden).toBe(true);
        await click(btn);
        expect(btn.getAttribute('aria-expanded')).toBe('true');
        expect(document.getElementById(btn.getAttribute('aria-controls')!)!.hidden).toBe(false);
        expect(btn.className).toContain('focus-visible:ring-ring');
    });

    it('Section sin collapsible no pinta boton y queda abierta', async () => {
        await mount(<Section title="Fija">x</Section>);
        expect(q('button')).toBeNull();
        expect(q<HTMLElement>('section > div:last-child')!.hidden).toBe(false);
    });

    it('Divider: role separator con etiqueta y orientacion; Spacer oculto a lectores', async () => {
        await mount(<div><Divider label="o bien" /><Divider orientation="vertical" /><Spacer /></div>);
        const seps = qa('[role="separator"]');
        expect(seps).toHaveLength(2);
        expect(seps[0].getAttribute('aria-label')).toBe('o bien');
        expect(seps[1].getAttribute('aria-orientation')).toBe('vertical');
        expect(qa('[aria-hidden="true"]').length).toBeGreaterThan(0);
        expect(q('[role="separator"]:not([aria-label]) + div')!.getAttribute('aria-hidden')).toBe('true');
    });

    it('Grid usa la escala responsiva y el limite de altura', async () => {
        await mount(<Grid columns={3} maxHeight="sm">x</Grid>);
        const g = q('.grid')!;
        expect(g.className).toContain('grid-cols-2 sm:grid-cols-3');
        expect(g.className).toContain('max-h-40');
    });
});
