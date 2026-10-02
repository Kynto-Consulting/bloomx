// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { installCleanup, kitSuite, mount, click, key, typeInto, q, qa } from './harness';
import { Table, type TableColumn } from '../Data';

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => React.createElement('a', { href, ...rest }, children) }));

const columns: TableColumn[] = [
    { key: 'title', label: 'Tarea', format: 'link' as const, hrefKey: 'url', sortable: true },
    { key: 'status', label: 'Estado', format: 'status' as const, filter: true, toneMap: { Abierta: 'warning' as const, Hecha: 'success' as const } },
    { key: 'kind', label: 'Tipo', format: 'badge' as const, toneMap: { bug: 'danger' as const } },
    { key: 'created', label: 'Creada', format: 'date' as const, sortable: true },
];
const rows = [
    { id: 'a', title: 'Revisar informe', status: 'Abierta', kind: 'bug', url: 'https://example.com/a', created: '2026-03-01' },
    { id: 'b', title: 'Enviar resumen', status: 'Hecha', kind: 'tarea', url: '/extensions/notes', created: '2026-03-04' },
    { id: 'c', title: 'Llamar a Luis', status: 'Abierta', kind: 'tarea', url: 'javascript:alert(1)', created: '2026-03-07' },
];
const titles = () => qa('tbody tr td:nth-child(1)').map((t) => t.textContent);

kitSuite('Table avanzada', () => (
    <Table
        columns={columns} rows={rows} searchable selectable="multiple" caption="Tareas" pageSize={2} defaultSort={{ key: 'created', dir: 'desc' }}
        bulkActions={[{ label: 'Archivar', icon: 'Archive' }]} actions={[{ label: 'Ver' }]}
    />
));
kitSuite('Table con error', () => <Table columns={columns} rows={[]} error="No se pudo cargar" onRetry={() => { }} />);

describe('Table avanzada', () => {
    installCleanup();

    it('formato link: usa hrefKey, los enlaces externos abren fuera y un destino peligroso NO es un enlace', async () => {
        await mount(<Table columns={columns} rows={rows} />);
        const links = qa<HTMLAnchorElement>('tbody a');
        expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://example.com/a', '/extensions/notes']);
        expect(links[0].getAttribute('target')).toBe('_blank');
        expect(links[0].getAttribute('rel')).toContain('noopener');
        expect(qa('tbody a').some((a) => (a.getAttribute('href') || '').startsWith('javascript:'))).toBe(false);
        expect(titles()).toContain('Llamar a Luis');
    });

    it('formato status: punto decorativo + texto con el tono de toneMap; badge tambien usa toneMap', async () => {
        await mount(<Table columns={columns} rows={rows} />);
        const dots = qa('tbody td:nth-child(2) [aria-hidden="true"]');
        expect(dots[0].className).toContain('bg-warning');
        expect(dots[1].className).toContain('bg-success');
        expect(qa('tbody td:nth-child(3) span')[0].className).toContain('border-destructive');
    });

    it('busqueda: filtra por cualquier columna, anuncia el numero de resultados y vacia con "Sin resultados"', async () => {
        await mount(<Table columns={columns} rows={rows} searchable />);
        const input = q<HTMLInputElement>('input[type="search"]')!;
        expect(input.getAttribute('aria-label')).toBe('Buscar...');
        await typeInto(input, 'luis');
        expect(titles()).toEqual(['Llamar a Luis']);
        expect(q('[role="status"]')?.textContent).toBe('1 resultados');
        await typeInto(input, 'zzz');
        expect(document.body.textContent).toContain('Sin resultados');
        await typeInto(input, '');
        expect(titles().length).toBe(3);
    });

    it('filtro por columna: desplegable con los valores distintos; combina con la busqueda', async () => {
        await mount(<Table columns={columns} rows={rows} searchable />);
        const select = q<HTMLSelectElement>('select')!;
        expect(select.getAttribute('aria-label')).toBe('Filtrar por Estado');
        expect(qa('option', select).map((o) => o.textContent)).toEqual(['Estado: Todos', 'Abierta', 'Hecha']);
        await typeInto(select, 'Abierta');
        expect(titles()).toEqual(['Revisar informe', 'Llamar a Luis']);
        await typeInto(q<HTMLInputElement>('input[type="search"]'), 'informe');
        expect(titles()).toEqual(['Revisar informe']);
    });

    it('sin filtro desplegable si la columna tiene mas de 30 valores distintos', async () => {
        const many = Array.from({ length: 40 }, (_, i) => ({ id: String(i), status: `s${i}` }));
        await mount(<Table columns={[{ key: 'status', label: 'Estado', filter: true }]} rows={many} />);
        expect(q('select')).toBeNull();
    });

    it('defaultSort aplica el orden inicial y se puede cambiar', async () => {
        await mount(<Table columns={columns} rows={rows} defaultSort={{ key: 'created', dir: 'desc' }} />);
        expect(titles()).toEqual(['Llamar a Luis', 'Enviar resumen', 'Revisar informe']);
        expect(q('th:nth-child(4)')?.getAttribute('aria-sort')).toBe('descending');
        await click(q('th:nth-child(4) button'));
        expect(q('th:nth-child(4)')?.getAttribute('aria-sort')).toBe('none');
        await click(q('th:nth-child(1) button'));
        expect(titles()).toEqual(['Enviar resumen', 'Llamar a Luis', 'Revisar informe']);
    });

    it('acciones masivas: solo con seleccion multiple y filas elegidas; reciben filas y claves', async () => {
        const onPress = vi.fn();
        await mount(<Table columns={columns} rows={rows} rowKey="id" selectable="multiple" bulkActions={[{ label: 'Archivar', onPress }]} />);
        expect(q('[role="toolbar"]')).toBeNull();
        const boxes = qa<HTMLInputElement>('tbody input[type="checkbox"]');
        await click(boxes[0]);
        await click(boxes[2]);
        const bar = q('[role="toolbar"]')!;
        expect(bar.textContent).toContain('2 seleccionadas');
        await click(qa('button', bar).find((b) => b.textContent === 'Archivar') ?? null);
        expect(onPress).toHaveBeenCalledWith([rows[0], rows[2]], ['a', 'c']);
        await click(qa('button', bar).find((b) => b.textContent === 'Quitar seleccion') ?? null);
        expect(q('[role="toolbar"]')).toBeNull();
    });

    it('acciones masivas no aparecen con seleccion simple ni sin seleccion', async () => {
        await mount(<Table columns={columns} rows={rows} rowKey="id" selectable="single" bulkActions={[{ label: 'Archivar' }]} />);
        await click(qa('tbody input')[0]);
        expect(q('[role="toolbar"]')).toBeNull();
    });

    it('error: role=alert en lugar de las filas y Reintentar', async () => {
        const onRetry = vi.fn();
        await mount(<Table columns={columns} rows={rows} error="No se pudo cargar" onRetry={onRetry} />);
        expect(q('[role="alert"]')?.textContent).toContain('No se pudo cargar');
        expect(qa('tbody tr').length).toBe(1);
        await click(qa('button').find((b) => b.textContent === 'Reintentar') ?? null);
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('cargando tiene prioridad sobre el error y muestra esqueleto', async () => {
        await mount(<Table columns={columns} rows={rows} loading error="x" />);
        expect(q('table')?.getAttribute('aria-busy')).toBe('true');
        expect(q('[role="alert"]')).toBeNull();
    });

    it('paginacion + filtro: vuelve a la primera pagina y el teclado sigue funcionando', async () => {
        await mount(<Table columns={columns} rows={rows} searchable pageSize={2} onRowPress={() => { }} />);
        await click(qa('button').find((b) => b.querySelector('.sr-only')?.textContent === 'Pagina siguiente') ?? null);
        expect(titles()).toEqual(['Llamar a Luis']);
        await typeInto(q<HTMLInputElement>('input[type="search"]'), 'resumen');
        expect(titles()).toEqual(['Enviar resumen']);
        await key(q('tbody tr'), 'Enter');
    });

    it('datos hostiles: toneMap con claves raras, hrefKey inexistente y valores no texto', async () => {
        const hostile = [{ id: 1, title: { a: 1 }, status: ['x'], kind: null, url: 5, created: 'no-fecha' }];
        await mount(<Table columns={[{ key: 'title', format: 'link', hrefKey: 'nope' }, { key: 'status', format: 'status', toneMap: { __proto__: 'danger', x: 'rainbow' } as any }, { key: 'kind', format: 'badge' }]} rows={hostile as any} />);
        expect(q('tbody')).not.toBeNull();
        expect(q('script')).toBeNull();
    });
});
