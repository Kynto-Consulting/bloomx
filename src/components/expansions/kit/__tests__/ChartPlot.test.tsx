// @vitest-environment jsdom
import React, { act } from 'react';
import { describe, expect, it } from 'vitest';
import { installCleanup, kitSuite, mount, click, key, q, qa } from './harness';
import { Chart, niceScale, formatChartValue, cleanSeries, cleanSlices, linePath, areaPath, slicePath, CHART_MAX_POINTS, CHART_MAX_SERIES } from '../ChartPlot';

const labels = ['Lun', 'Mar', 'Mie', 'Jue'];
const series = [{ label: 'Recibidos', data: [12, 19, 7, 15] }, { label: 'Enviados', data: [5, 8, null, 9], tone: 'success' }];
const slices = [{ label: 'Activos', value: 60, tone: 'success' }, { label: 'Pendientes', value: 25, tone: 'warning' }, { label: 'Inactivos', value: 15 }];

kitSuite('Chart line', () => <Chart kind="line" title="Correos" labels={labels} series={series} unit="correos" />);
kitSuite('Chart bar apilado', () => <Chart kind="bar" stacked labels={labels} series={series} valueFormat="compact" />);
kitSuite('Chart area', () => <Chart kind="area" labels={labels} series={series} showGrid={false} height="lg" />);
kitSuite('Chart pie', () => <Chart kind="pie" data={slices} title="Estados" />);
kitSuite('Chart donut', () => <Chart kind="donut" data={slices} centerLabel="100" />);
kitSuite('Chart estados', () => <><Chart loading /><Chart error="Fallo" /><Chart kind="line" labels={[]} series={[]} emptyText="Nada" /></>);

describe('funciones puras del grafico', () => {
    it('niceScale: maximo redondeado, base en 0 y paso positivo', () => {
        expect(niceScale(0, 97)).toEqual({ min: 0, max: 100, step: 25 });
        expect(niceScale(0, 0)).toMatchObject({ min: 0, max: 1 });
        const neg = niceScale(-30, 40);
        expect(neg.min).toBeLessThanOrEqual(-30);
        expect(neg.max).toBeGreaterThanOrEqual(40);
        expect(neg.step).toBeGreaterThan(0);
        expect(niceScale(0, 1_234_567).max).toBeGreaterThanOrEqual(1_234_567);
    });

    it('formatChartValue: number, compact y percent', () => {
        expect(formatChartValue(1234.567, 'number', 'en')).toBe('1,234.57');
        expect(formatChartValue(1500, 'compact', 'en')).toBe('1.5K');
        expect(formatChartValue(42.25, 'percent', 'en')).toBe('42.3%');
        expect(formatChartValue(5, 'number', 'no-existe-xx-zz')).toBeTruthy();
    });

    it('cleanSeries: tope de series, huecos null, nombres y tonos validos; datos hostiles', () => {
        const many = Array.from({ length: 20 }, (_, i) => ({ label: `S${i}`, data: [1, 2] }));
        expect(cleanSeries(many, 2).length).toBe(CHART_MAX_SERIES);
        const out = cleanSeries([{ label: 'A', data: [1, 'x', NaN, null, Infinity], tone: 'arcoiris' }, 5, null, { data: 'no' }], 5);
        expect(out.length).toBe(2);
        expect(out[0].values).toEqual([1, null, null, null, null]);
        expect(out[0].tone).toBe('primary');
        expect(out[1].name).toBe('#2');
        expect(cleanSeries('x', 3)).toEqual([]);
    });

    it('cleanSlices: descarta negativos y no numericos; agrupa el resto en "Otros" a partir de 12', () => {
        expect(cleanSlices([{ label: 'a', value: -1 }, { label: 'b', value: 'x' }, { label: 'c', value: 3 }], 'Otros').map((p) => p.label)).toEqual(['c']);
        const many = cleanSlices(Array.from({ length: 30 }, (_, i) => ({ label: `L${i}`, value: 1 })), 'Otros');
        expect(many.length).toBe(12);
        expect(many[11]).toMatchObject({ label: 'Otros', value: 19 });
    });

    it('linePath rompe el trazo en los huecos y areaPath cierra cada tramo', () => {
        const pts = [{ x: 0, y: 10 }, { x: 10, y: null }, { x: 20, y: 5 }, { x: 30, y: 6 }];
        expect(linePath(pts)).toBe('M0.00 10.00 M20.00 5.00 L30.00 6.00');
        expect(linePath([])).toBe('');
        const area = areaPath(pts, pts.map((p) => ({ x: p.x, y: 50 })));
        expect(area.match(/Z/g)?.length).toBe(2);
    });

    it('slicePath: un sector entero no degenera (circulo completo) y el anillo tiene dos arcos', () => {
        expect(slicePath(50, 50, 40, 0, 0, Math.PI * 2)).toMatch(/^M50 50 L/);
        expect((slicePath(50, 50, 40, 20, 0, Math.PI) .match(/A/g) ?? []).length).toBe(2);
    });
});

describe('Chart (cartesiano)', () => {
    installCleanup();

    it('SVG con nombre accesible, tabla oculta con TODOS los datos y leyenda', async () => {
        await mount(<Chart kind="line" title="Correos" labels={labels} series={series} unit="correos" />);
        expect(q('svg')?.getAttribute('role')).toBe('img');
        expect(q('svg')?.getAttribute('aria-label')).toContain('Correos');
        expect(q('figcaption')?.textContent).toBe('Correos');
        const rows = qa('table.sr-only tbody tr');
        expect(rows.length).toBe(4);
        expect(rows[0].textContent).toContain('12 correos');
        expect(rows[2].textContent).toContain('—');
        expect(qa('ul[aria-label] li').map((li) => li.textContent)).toEqual(['Recibidos', 'Enviados']);
    });

    it('teclado: el area es focusable, las flechas recorren los puntos y se anuncian (aria-live) con tooltip', async () => {
        await mount(<Chart kind="line" labels={labels} series={series} />);
        const plot = q('svg rect[tabindex="0"]')!;
        expect(plot).not.toBeNull();
        expect(q('[data-chart-tooltip]')).toBeNull();
        await act(async () => { plot.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); });
        await key(plot, 'End');
        expect(q('[aria-live="polite"]')?.textContent).toContain('Jue: Recibidos 15, Enviados 9');
        expect(q('[data-chart-tooltip]')?.textContent).toContain('Jue');
        await key(plot, 'ArrowLeft');
        expect(q('[aria-live="polite"]')?.textContent).toContain('Mie: Recibidos 7, Enviados —');
        await key(plot, 'Home');
        expect(q('[aria-live="polite"]')?.textContent).toContain('Lun');
        await key(plot, 'ArrowLeft');
        expect(q('[aria-live="polite"]')?.textContent).toContain('Lun');
        await key(plot, 'Escape');
        expect(q('[data-chart-tooltip]')).toBeNull();
    });

    it('leyenda: alternar una serie la oculta del grafico y nunca se pueden ocultar todas', async () => {
        await mount(<Chart kind="line" labels={labels} series={series} />);
        expect(qa('svg path[fill="none"]').length).toBe(2);
        const [a, b] = qa('ul[aria-label] button');
        expect(a.getAttribute('aria-pressed')).toBe('true');
        await click(a);
        expect(a.getAttribute('aria-pressed')).toBe('false');
        expect(qa('svg path[fill="none"]').length).toBe(1);
        await click(b);
        expect(b.getAttribute('aria-pressed')).toBe('true');
        expect(qa('svg path[fill="none"]').length).toBe(1);
    });

    it('barras agrupadas y apiladas; area; sin colores crudos (solo clases de tokens)', async () => {
        const m = await mount(<Chart kind="bar" labels={labels} series={series} />);
        expect(qa('svg rect.fill-primary').length + qa('svg rect.fill-success').length).toBe(7);
        await m.render(<Chart kind="bar" stacked labels={labels} series={series} />);
        expect(qa('svg rect[rx]').length).toBe(7);
        await m.render(<Chart kind="area" labels={labels} series={series} stacked />);
        expect(qa('svg path.opacity-70').length).toBe(2);
        expect(document.body.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
    });

    it('mas de 120 puntos se recortan y las etiquetas del eje X se espacian', async () => {
        const many = Array.from({ length: 500 }, (_, i) => i);
        await mount(<Chart kind="line" labels={many.map(String)} series={[{ label: 'S', data: many }]} />);
        expect(qa('table.sr-only tbody tr').length).toBe(CHART_MAX_POINTS);
        expect(qa('svg text').length).toBeLessThan(40);
    });

    it('estados: vacio, cargando y error; datos hostiles no rompen', async () => {
        const m = await mount(<Chart kind="line" labels={[]} series={[]} emptyText="Sin datos aqui" />);
        expect(document.body.textContent).toContain('Sin datos aqui');
        await m.render(<Chart loading />);
        expect(q('[aria-busy="true"]')).not.toBeNull();
        await m.render(<Chart error="No se pudo cargar" />);
        expect(q('[role="alert"]')?.textContent).toContain('No se pudo cargar');
        await m.render(<Chart kind={'raro' as any} labels={'x' as any} series={[{ label: 7 as any, data: 'nope' as any }, null as any]} />);
        expect(document.body.textContent).toContain('Sin datos');
        await m.render(<Chart kind="bar" labels={['A', 'B']} series={[{ label: 7 as any, data: 'nope' as any }, null as any, { label: 'ok', data: [1, 'x' as any] }]} />);
        expect(q('svg')).not.toBeNull();
        await m.render(<Chart kind="line" labels={['<img src=x onerror=1>']} series={[{ label: '<script>x</script>', data: [1] }]} />);
        expect(q('img')).toBeNull();
        expect(q('script')).toBeNull();
    });
});

describe('Chart (sectores)', () => {
    installCleanup();

    it('pie y donut: sectores focusables con etiqueta y porcentaje, leyenda y texto central', async () => {
        const m = await mount(<Chart kind="donut" data={slices} centerLabel="100" title="Estados" />);
        const paths = qa('svg path[role="img"]');
        expect(paths.length).toBe(3);
        expect(paths[0].getAttribute('aria-label')).toBe('Activos: 60 (60%)');
        expect(q('svg text')?.textContent).toBe('100');
        expect(qa('ul[aria-label] li').map((li) => li.textContent)).toEqual(['Activos60%', 'Pendientes25%', 'Inactivos15%']);
        await m.render(<Chart kind="pie" data={slices} />);
        expect(q('svg text')).toBeNull();
    });

    it('foco en un sector muestra el tooltip y lo anuncia', async () => {
        await mount(<Chart kind="donut" data={slices} unit="usuarios" />);
        const first = qa('svg path[role="img"]')[0];
        await act(async () => { first.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); });
        expect(q('[data-chart-tooltip]')?.textContent).toContain('Activos');
        expect(q('[aria-live="polite"]')?.textContent).toContain('Activos: 60 usuarios (60%)');
    });

    it('sin total positivo no pinta un anillo vacio', async () => {
        await mount(<Chart kind="pie" data={[{ label: 'a', value: 0 }]} emptyText="Nada que mostrar" />);
        expect(q('svg')).toBeNull();
        expect(document.body.textContent).toContain('Nada que mostrar');
    });
});
