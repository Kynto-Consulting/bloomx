// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { installCleanup, kitSuite, mount, click, key, q, qa } from './harness';
import { Table, List, ListItem, FormShell } from '../Data';

const columns = [
    { key: 'name', label: 'Nombre', sortable: true },
    { key: 'qty', label: 'Cantidad', sortable: true, format: 'number' as const, align: 'end' as const },
    { key: 'on', label: 'Activo', format: 'boolean' as const },
    { key: 'st', label: 'Estado', format: 'badge' as const, tone: 'success' as const },
    { key: 'sku', label: 'SKU', format: 'code' as const },
    { key: 'd', label: 'Fecha', format: 'date' as const, sortable: true },
];
const rows = [
    { id: 'a', name: 'Beta', qty: 10, on: true, st: 'ok', sku: 'X1', d: '2024-01-05' },
    { id: 'b', name: 'Alfa', qty: 2, on: false, st: 'mal', sku: 'X2', d: 'no-fecha' },
    { id: 'c', name: 'Gamma', qty: 1500, on: true, st: 'ok', sku: 'X3', d: '2023-12-01' },
];
const names = () => qa('tbody tr td:nth-child(1)').map((t) => t.textContent);

kitSuite('Table', () => <Table columns={columns} rows={rows} selectable="multiple" actions={[{ label: 'Borrar', icon: 'Trash2', tone: 'danger' }]} pageSize={2} caption="Demo" onRowPress={() => {}} />);
kitSuite('Table cargando', () => <Table columns={columns} loading />);
kitSuite('List', () => <List variant="cards" columns={2}><ListItem title="A" description="d" meta="m" icon="Mail" tone="info" selected onPress={() => {}}><span>x</span></ListItem><ListItem title="B" /></List>);
kitSuite('FormShell', () => <FormShell status="error" errorMessage="Mal" onCancel={() => {}}><input aria-label="x" /></FormShell>);

describe('Table', () => {
    installCleanup();

    it('semantica: caption, th scope, aria-sort y formatos', async () => {
        await mount(<Table columns={columns} rows={rows} caption="Demo" />);
        expect(q('caption')?.textContent).toBe('Demo');
        expect(qa('th[scope="col"]').length).toBe(6);
        expect(q('th')?.getAttribute('aria-sort')).toBe('none');
        expect(q('th:nth-child(3)')?.hasAttribute('aria-sort')).toBe(false);
        expect(document.body.textContent).toContain(new Intl.NumberFormat('es').format(1500));
        expect(q('code')?.textContent).toBe('X1');
        expect(document.body.textContent).toContain('no-fecha');
    });

    it('ordena asc, desc y vuelve al original', async () => {
        await mount(<Table columns={columns} rows={rows} />);
        const btn = () => q<HTMLButtonElement>('thead th:nth-child(1) button');
        await click(btn());
        expect(names()).toEqual(['Alfa', 'Beta', 'Gamma']);
        expect(q('th')?.getAttribute('aria-sort')).toBe('ascending');
        await click(btn());
        expect(names()).toEqual(['Gamma', 'Beta', 'Alfa']);
        expect(q('th')?.getAttribute('aria-sort')).toBe('descending');
        await click(btn());
        expect(names()).toEqual(['Beta', 'Alfa', 'Gamma']);
        await click(q('thead th:nth-child(2) button'));
        expect(names()).toEqual(['Alfa', 'Beta', 'Gamma']); // 2 < 10 < 1500 (numerico, no textual)
    });

    it('seleccion multiple controlada con indeterminado y seleccionar todo', async () => {
        const onSel = vi.fn();
        const m = await mount(<Table columns={columns} rows={rows} rowKey="id" selectable="multiple" selected={['a']} onSelectionChange={onSel} />);
        const all = q<HTMLInputElement>('input[aria-label="Seleccionar todo"]')!;
        expect(all.indeterminate).toBe(true);
        expect(qa('input[aria-label="Seleccionar fila"]').length).toBe(3);
        expect(qa('tbody tr')[0].getAttribute('aria-selected')).toBe('true');
        expect(qa('tbody tr')[0].className).toContain('bg-row-selected');
        await click(qa('input[aria-label="Seleccionar fila"]')[1]);
        expect(onSel).toHaveBeenLastCalledWith(['a', 'b']);
        await click(all);
        expect(onSel).toHaveBeenLastCalledWith(['a', 'b', 'c']);
        await m.render(<Table columns={columns} rows={rows} rowKey="id" selectable="multiple" selected={['a', 'b', 'c']} />);
        expect(q<HTMLInputElement>('input[aria-label="Seleccionar todo"]')!.checked).toBe(true);
    });

    it('seleccion single usa radio', async () => {
        const onSel = vi.fn();
        await mount(<Table columns={columns} rows={rows} rowKey="id" selectable="single" onSelectionChange={onSel} />);
        await click(qa('input[type="radio"]')[2]);
        expect(onSel).toHaveBeenCalledWith(['c']);
        expect(qa('tbody tr')[2].getAttribute('aria-selected')).toBe('true');
    });

    it('paginacion', async () => {
        await mount(<Table columns={columns} rows={rows} pageSize={2} />);
        expect(qa('tbody tr').length).toBe(2);
        expect(q('[aria-live="polite"]')?.textContent).toBe('Pagina 1 de 2');
        await click(qa('button').find((b) => b.textContent === 'Pagina siguiente')!);
        expect(qa('tbody tr').length).toBe(1);
        expect(q('[aria-live="polite"]')?.textContent).toBe('Pagina 2 de 2');
    });

    it('fila pulsable por teclado y acciones sin disparar la fila', async () => {
        const press = vi.fn(), act = vi.fn();
        await mount(<Table columns={columns} rows={rows} onRowPress={press} actions={[{ label: 'Editar', icon: 'Pencil', onPress: act }]} />);
        const tr = qa('tbody tr')[1];
        expect(tr.tabIndex).toBe(0);
        await key(tr, 'Enter');
        await key(tr, ' ');
        expect(press).toHaveBeenCalledTimes(2);
        expect(press.mock.calls[0][0].name).toBe('Alfa');
        await click(q('button[aria-label="Editar"]'));
        expect(act).toHaveBeenCalledWith(rows[0]);
        expect(press).toHaveBeenCalledTimes(2);
    });

    it('vacio, cargando y entradas hostiles', async () => {
        await mount(<Table columns={columns} rows={[]} emptyText="Nada" />);
        expect(document.body.textContent).toContain('Nada');
        const m = await mount(<Table columns={columns} loading />);
        expect(qa('.animate-pulse', m.container).length).toBeGreaterThan(0);
        expect(q('table', m.container)?.getAttribute('aria-busy')).toBe('true');
        await mount(<Table columns={[null, 3, { key: 7 }, { key: 'o', format: 'zzz', align: 'q', tone: 'x' }] as any} rows={[null, 'x', { o: { a: 1 } }, { o: () => 1 }] as any} density={'x' as any} selectable={'z' as any} pageSize={-3} />);
        expect(document.body.textContent).toContain('{"a":1}');
    });

    it('recorta a 5000 filas con aviso', async () => {
        const many = Array.from({ length: 5200 }, (_, i) => ({ n: i }));
        await mount(<Table columns={[{ key: 'n' }]} rows={many} />);
        expect(qa('tbody tr').length).toBe(5000);
        expect(q('[role="status"]')).toBeTruthy();
    }, 60000);
});

describe('List / ListItem', () => {
    installCleanup();
    it('ul role=list con li, y vacio', async () => {
        await mount(<List><ListItem title="A" /><ListItem title="B" /></List>);
        expect(q('ul')?.getAttribute('role')).toBe('list');
        expect(qa('li').length).toBe(2);
        await mount(<List empty={<em id="e">vacio</em>} />);
        expect(q('#e')).toBeTruthy();
    });
    it('ListItem pulsable es boton y las acciones quedan fuera', async () => {
        const press = vi.fn(), inner = vi.fn();
        await mount(<ListItem title="Hola" description="desc" meta="hoy" onPress={press}><button type="button" onClick={inner}>Borrar</button></ListItem>);
        const btns = qa('button');
        expect(btns.length).toBe(2);
        expect(btns[0].textContent).toContain('Hola');
        expect(btns[0].className).toContain('hover:bg-row-hover');
        expect(btns[0].contains(btns[1])).toBe(false);
        await click(btns[0]);
        expect(press).toHaveBeenCalled();
        await click(btns[1]);
        expect(inner).toHaveBeenCalled();
        expect(press).toHaveBeenCalledTimes(1);
    });
    it('ListItem sin onPress no es boton; props hostiles no rompen', async () => {
        await mount(<ListItem title={{ a: 1 } as any} icon="NoExiste" tone={'x' as any} />);
        expect(q('button')).toBeNull();
        await mount(<List columns={9 as any} gap={7 as any} variant={'x' as any} maxHeight={'x' as any}><ListItem /></List>);
    });
});

describe('FormShell', () => {
    installCleanup();
    it('submit con preventDefault y onSubmit', async () => {
        const onSubmit = vi.fn();
        await mount(<FormShell onSubmit={onSubmit}><input aria-label="n" /></FormShell>);
        expect(q<HTMLFormElement>('form')!.noValidate).toBe(true);
        await click(q('button[type="submit"]'));
        expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    it('estados: error alert, exito status, loading', async () => {
        const m = await mount(<FormShell status="error" errorMessage="Fallo" />);
        expect(q('[role="alert"]')?.textContent).toContain('Fallo');
        await m.render(<FormShell status="success" successMessage="Listo" />);
        expect(q('[role="status"]')?.textContent).toContain('Listo');
        await m.render(<FormShell status="loading" onSubmit={() => {}} submitLabel="Ir" />);
        const b = q<HTMLButtonElement>('button[type="submit"]')!;
        expect(b.disabled).toBe(true);
        expect(b.getAttribute('aria-busy')).toBe('true');
    });
    it('cancelar solo con onCancel', async () => {
        const onCancel = vi.fn();
        const m = await mount(<FormShell />);
        expect(qa('button').length).toBe(1);
        await m.render(<FormShell onCancel={onCancel} cancelLabel="Volver" />);
        await click(qa('button').find((b) => b.textContent === 'Volver')!);
        expect(onCancel).toHaveBeenCalled();
    });
});
