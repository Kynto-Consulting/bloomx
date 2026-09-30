// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Badge, Chip, Avatar, Stat, Progress, Skeleton, Empty, Alert, Callout, Spinner } from '../Feedback';
import { resolveIcon } from '../Icon';
import { assertThemeSafe, applyBrand, click, installCleanup, key, kitSuite, mount, q, qa } from './harness';

const any = (v: unknown) => v as never;
const TONES = ['neutral', 'primary', 'success', 'warning', 'danger', 'info'] as const;
const EVIL = '<script>alert(1)</script><img src=x onerror=alert(1)>';

kitSuite('Feedback', () => (
    <div>
        {TONES.flatMap((tone) => (['solid', 'soft', 'outline'] as const).map((variant) => <Badge key={`${tone}${variant}`} tone={tone} variant={variant} label={`${tone}`} />))}
        <Badge size="sm" label="sm" />
        {TONES.map((tone) => <Chip key={tone} tone={tone} label={tone} icon="Star" selected removable onPress={() => {}} onRemove={() => {}} />)}
        <Chip label="libre" /><Chip label="sel" selected />
        {TONES.map((tone) => <Avatar key={tone} tone={tone} name="Ada Lovelace" size="lg" />)}
        <Avatar src="https://example.com/a.png" name="Ada" />
        {(['up', 'down', 'flat'] as const).map((trend) => <Stat key={trend} label="Ventas" value="1.200" delta="+5%" trend={trend} description="mes" icon="Star" tone="primary" />)}
        {TONES.map((tone) => <Progress key={tone} tone={tone} value={40} label="carga" size="lg" />)}
        <Progress indeterminate label="i" />
        <Skeleton lines={3} /><Skeleton variant="circle" size="lg" /><Skeleton variant="rect" size="sm" />
        <Empty icon="Inbox" title="Nada" description="vacio" actionLabel="Crear" onAction={() => {}}>extra</Empty>
        {TONES.map((tone) => <Alert key={tone} tone={tone} title="t" message="m" dismissible />)}
        {TONES.map((tone) => <Callout key={tone} tone={tone} title="t" icon="Lightbulb">texto</Callout>)}
        <Spinner label="Cargando" size="lg" />
    </div>
));

describe('Feedback', () => {
    installCleanup();

    it('props hostiles: texto plano, sin inyeccion ni valores de estilo', async () => {
        await mount(
            <div>
                <Badge tone={any('rainbow')} variant={any({})} size={any('x')} label={EVIL} />
                <Chip tone={any('rainbow')} label={EVIL} icon={any({})} selected={any('si')} removable={any(1)} />
                <Avatar src={any('javascript:alert(1)')} name={EVIL} size={any({})} tone={any('rainbow')} alt={any({})} />
                <Stat label={EVIL} value={any({})} delta={EVIL} trend={any('rainbow')} description={EVIL} tone={any('rainbow')} />
                <Progress value={any({})} max={any('x')} label={EVIL} tone={any('rainbow')} size={any({})} />
                <Progress value={NaN} max={-5} />
                <Skeleton variant={any('x')} lines={any({})} size={any('url(x)')} />
                <Empty title={EVIL} description={EVIL} icon={any({})} actionLabel={EVIL} />
                <Alert tone={any('rainbow')} title={EVIL} message={any({})} description={EVIL} icon={any({})} />
                <Callout tone={any('rainbow')} title={EVIL} icon={any({})}>x</Callout>
                <Spinner label={EVIL} size={any({})} />
            </div>,
        );
        expect(document.body.textContent).toContain(EVIL);
        expect(qa('script, img[onerror], img[src="x"]')).toHaveLength(0);
        expect(document.body.innerHTML).not.toMatch(/rainbow|url\(x\)|javascript:/);
    });

    it('no emite clases fuera de tokens', async () => {
        const css = applyBrand('oscura corporativa', 'brand-dark');
        await mount(<div><Badge tone="danger" variant="solid" label="x" /><Progress value={10} tone="info" /><Alert tone="warning" message="m" /><Spinner /></div>);
        assertThemeSafe(document.body, css);
    });

    it('los iconos por defecto de Alert existen en Lucide', () => {
        for (const n of ['Info', 'CircleCheck', 'TriangleAlert', 'CircleAlert', 'TrendingUp', 'TrendingDown', 'Minus', 'X', 'Check', 'Copy']) expect(resolveIcon(n), n).toBeTruthy();
    });

    it('Chip: boton con onPress, aria-pressed, quitar accesible y teclado', async () => {
        const onPress = vi.fn(); const onRemove = vi.fn();
        await mount(<Chip label="React" selected removable onPress={onPress} onRemove={onRemove} />);
        const main = q<HTMLButtonElement>('button[aria-pressed]')!;
        expect(main.getAttribute('aria-pressed')).toBe('true');
        await click(main);
        expect(onPress).toHaveBeenCalledTimes(1);
        const remove = q<HTMLButtonElement>('button[aria-label]')!;
        expect(remove.getAttribute('aria-label')).toBe('Quitar React');
        expect(remove.className).toContain('focus-visible:ring-ring');
        await click(remove);
        expect(onRemove).toHaveBeenCalledTimes(1);
        await key(main, 'Delete');
        expect(onRemove).toHaveBeenCalledTimes(2);
    });

    it('Chip sin onPress no es boton', async () => {
        await mount(<Chip label="Etiqueta" />);
        expect(q('button')).toBeNull();
    });

    it('Avatar: solo https, iniciales y alt', async () => {
        await mount(<div><Avatar src="https://example.com/a.png" name="Ada Lovelace" /><Avatar src="data:image/png;base64,AAA" name="Grace Brewster Hopper" /><Avatar /></div>);
        const img = q<HTMLImageElement>('img')!;
        expect(img.alt).toBe('Ada Lovelace');
        expect(img.getAttribute('src')).toBe('https://example.com/a.png');
        expect(qa('img')).toHaveLength(1);
        const fallback = q('[role="img"]')!;
        expect(fallback.getAttribute('aria-label')).toBe('Grace Brewster Hopper');
        expect(fallback.textContent).toBe('GH');
        expect(fallback.className).toContain('bg-secondary');
        expect(fallback.className).toContain('text-secondary-foreground');
    });

    it('Stat: tendencia con texto accesible y color semantico', async () => {
        await mount(<div><Stat label="A" value="1" delta="+2" trend="up" /><Stat label="B" value="2" delta="-2" trend="down" /></div>);
        const dd = qa('dd').filter((d) => d.querySelector('.sr-only'));
        expect(dd[0].textContent).toContain('sube');
        expect(dd[0].className).toContain('text-success');
        expect(dd[1].textContent).toContain('baja');
        expect(dd[1].className).toContain('text-destructive');
    });

    it('Progress: atributos ARIA, ancho y modo indeterminado', async () => {
        await mount(<div><Progress value={30} max={60} label="Subida" /><Progress indeterminate label="Espera" /></div>);
        const [bar, busy] = qa('[role="progressbar"]');
        expect(bar.getAttribute('aria-valuenow')).toBe('30');
        expect(bar.getAttribute('aria-valuemin')).toBe('0');
        expect(bar.getAttribute('aria-valuemax')).toBe('60');
        expect(document.getElementById(bar.getAttribute('aria-labelledby')!)!.textContent).toBe('Subida');
        expect((bar.firstElementChild as HTMLElement).style.width).toBe('50%');
        expect(document.body.textContent).toContain('50%');
        expect(busy.hasAttribute('aria-valuenow')).toBe(false);
        expect(busy.firstElementChild!.className).toContain('animate-pulse');
    });

    it('Skeleton: oculto a lectores con bg-muted animate-pulse', async () => {
        await mount(<Skeleton lines={3} />);
        expect(q('[aria-hidden="true"]')).toBeTruthy();
        expect(qa('.animate-pulse.bg-muted')).toHaveLength(3);
    });

    it('Empty: accion solo con onAction y texto', async () => {
        const onAction = vi.fn();
        await mount(<div><Empty title="Vacio" actionLabel="Crear" onAction={onAction} /><Empty title="Sin accion" actionLabel="No" /></div>);
        const buttons = qa('button');
        expect(buttons).toHaveLength(1);
        await click(buttons[0]);
        expect(onAction).toHaveBeenCalledTimes(1);
    });

    it('Alert: role segun tono, descartable, alias description', async () => {
        const onClose = vi.fn();
        await mount(<div><Alert tone="danger" message="m1" /><Alert tone="warning" message="m2" /><Alert tone="success" description="desc" dismissible onClose={onClose} /><Alert message="i" /></div>);
        const roles = qa('[role="alert"], [role="status"]').map((e) => e.getAttribute('role'));
        expect(roles).toEqual(['alert', 'alert', 'status', 'status']);
        expect(document.body.textContent).toContain('desc');
        const dismiss = q<HTMLButtonElement>('button')!;
        expect(dismiss.getAttribute('aria-label')).toBe('Descartar');
        await click(dismiss);
        expect(onClose).toHaveBeenCalled();
        expect(document.body.textContent).not.toContain('desc');
    });

    it('Callout: role note con borde izquierdo de acento y titulo asociado', async () => {
        await mount(<Callout tone="warning" title="Ojo">cuerpo</Callout>);
        const note = q('[role="note"]')!;
        expect(note.className).toContain('border-l-warning');
        expect(document.getElementById(note.getAttribute('aria-labelledby')!)!.textContent).toBe('Ojo');
    });

    it('Spinner: role status con etiqueta accesible y bordes de tokens', async () => {
        await mount(<div><Spinner /><Spinner label="Guardando" /></div>);
        const [a, b] = qa('[role="status"]');
        expect(a.textContent).toBe('Cargando...');
        expect(b.textContent).toBe('Guardando');
        expect(a.firstElementChild!.className).toContain('border-muted');
        expect(a.firstElementChild!.className).toContain('border-t-primary');
    });
});
