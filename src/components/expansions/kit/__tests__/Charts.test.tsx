// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { BarChart, Donut, Sparkline } from '../Charts';
import { installCleanup, kitSuite, mount, q, qa } from './harness';

const DATA = [
    { label: 'Ene', value: 10 }, { label: 'Feb', value: 25, tone: 'success' as const }, { label: 'Mar', value: 5, tone: 'danger' as const },
    { label: 'Abr', value: 18, tone: 'warning' as const }, { label: 'May', value: 7, tone: 'info' as const }, { label: 'Jun', value: 3, tone: 'neutral' as const },
];

kitSuite('Charts', () => (
    <div>
        <BarChart data={DATA} title="Ventas" showValues />
        <BarChart data={DATA} orientation="horizontal" tone="info" height="lg" />
        <Sparkline values={[1, 3, 2, 5, 4]} area tone="success" height="md" />
        <Donut data={DATA} centerLabel="Total" size="lg" />
    </div>
));

describe('BarChart', () => {
    installCleanup();
    it('role=img con aria-label que resume los datos, <title> y fill de tokens', async () => {
        await mount(<BarChart data={DATA} title="Ventas" />);
        const svg = q('svg')!;
        expect(svg.getAttribute('role')).toBe('img');
        const label = svg.getAttribute('aria-label')!;
        expect(label).toContain('Ventas');
        expect(label).toContain('Feb: 25');
        expect(svg.querySelector('title')!.textContent).toBe(label);
        expect(qa('rect', svg)).toHaveLength(6);
        expect(svg.innerHTML).toContain('fill-success');
        expect(svg.innerHTML).toContain('fill-primary');
    });
    it('datos vacios -> mensaje; ignora no numericos; limita a 200', async () => {
        const m = await mount(<BarChart data={[]} />);
        expect(q('svg')).toBeNull();
        expect(m.container.textContent).toBeTruthy();
        await m.render(<BarChart data={[{ label: 'a', value: 'x' as never }, { label: 'b', value: NaN }, null as never, { label: 'c', value: 4 }]} />);
        expect(qa('rect')).toHaveLength(1);
        await m.render(<BarChart data={Array.from({ length: 500 }, (_, i) => ({ label: `l${i}`, value: i }))} orientation="horizontal" />);
        expect(qa('rect')).toHaveLength(200);
    });
    it('props hostiles y texto con HTML como texto', async () => {
        await mount(<BarChart data={[{ label: '<img src=x onerror=alert(1)>', value: 3, tone: 'rainbow' as never }]} tone={'x' as never} height={{} as never} orientation={5 as never} title={{} as never} />);
        expect(q('img')).toBeNull();
        expect(q('svg')!.getAttribute('aria-label')).toContain('<img');
        await mount(<BarChart data={'nope' as never} />);
    });
    it('todo cero no divide por cero', async () => {
        await mount(<BarChart data={[{ label: 'a', value: 0 }, { label: 'b', value: -3 }]} />);
        expect(q('svg')!.innerHTML).not.toContain('NaN');
    });
});

describe('Sparkline', () => {
    installCleanup();
    it('aria-label con minimo, maximo y ultimo; area con opacity-20', async () => {
        await mount(<Sparkline values={[4, 9, 2, 6]} area label="Visitas" tone="danger" />);
        const svg = q('svg')!;
        expect(svg.getAttribute('role')).toBe('img');
        const l = svg.getAttribute('aria-label')!;
        expect(l).toContain('Visitas');
        expect(l).toContain('2');
        expect(l).toContain('9');
        expect(l).toContain('6');
        expect(svg.innerHTML).toContain('stroke-destructive');
        expect(svg.innerHTML).toContain('opacity-20');
        expect(svg.innerHTML).not.toContain('NaN');
    });
    it('un punto, constantes, vacio y basura no rompen', async () => {
        await mount(<Sparkline values={[5]} />);
        await mount(<Sparkline values={[3, 3, 3]} />);
        expect(qa('svg')).toHaveLength(2);
        expect(document.body.innerHTML).not.toContain('NaN');
        await mount(<Sparkline values={[]} />);
        await mount(<Sparkline values={['a', null, {}, 2, 4] as never} tone={'rainbow' as never} height={{} as never} />);
        await mount(<Sparkline values={'x' as never} />);
    });
});

describe('Donut', () => {
    installCleanup();
    it('arcos, leyenda con porcentaje y etiqueta central', async () => {
        await mount(<Donut data={[{ label: 'A', value: 1 }, { label: 'B', value: 3 }]} centerLabel="Total" />);
        const svg = q('svg')!;
        expect(svg.getAttribute('role')).toBe('img');
        expect(svg.getAttribute('aria-label')).toContain('B: 75%');
        expect(qa('circle[stroke-dasharray]', svg)).toHaveLength(2);
        expect(svg.textContent).toContain('Total');
        const items = qa('li');
        expect(items).toHaveLength(2);
        expect(items[0].textContent).toContain('25%');
        expect(items[0].innerHTML).toContain('bg-primary');
        expect(items[1].innerHTML).toContain('bg-info');
    });
    it('suma 0 -> anillo vacio; showLegend=false; hostil', async () => {
        await mount(<Donut data={[{ label: 'A', value: 0 }]} showLegend={false} />);
        expect(qa('circle[stroke-dasharray]')).toHaveLength(0);
        expect(q('li')).toBeNull();
        expect(q('svg')!.innerHTML).toContain('stroke-muted');
        await mount(<Donut data={[{ label: '<script>x</script>', value: 2, tone: 'rainbow' as never }]} size={{} as never} centerLabel={{} as never} />);
        expect(q('script')).toBeNull();
        await mount(<Donut data={undefined} />);
        expect(document.body.innerHTML).not.toContain('NaN');
    });
});
