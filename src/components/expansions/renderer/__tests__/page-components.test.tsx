// @vitest-environment jsdom
/**
 * Componentes de pagina completa a traves del renderer (jsdom): datos simulados en `state`, expresiones, acciones con su carga util
 * (`value`, `rows`, `item`), slots de nodos, estados de carga/error y props hostiles.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => React.createElement('a', { href, ...rest }, children) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }) }));
vi.mock('@/lib/expansions/api', () => ({ executeExtensionAction: vi.fn(), fetchExpansions: vi.fn(async () => []) }));
vi.mock('@/components/expansions/ExtensionLoader', () => ({ ExtensionLoader: () => null }));

import { JsonRenderer } from '../JsonRenderer';
import { click, installCleanup, key, mount, q, qa, typeInto } from '../../kit/__tests__/harness';

const h = React.createElement;
const render = (component: any, initialState: Record<string, any> = {}) => mount(h(JsonRenderer, { component, context: { extensionId: 'core-test' }, initialState }));
const text = () => document.body.textContent || '';
const set = (key: string, value: unknown) => ({ action: 'SET_STATE', key, value });

installCleanup();
beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => { });
    vi.spyOn(console, 'error').mockImplementation(() => { });
});

describe('PAGE_HEADER', () => {
    it('titulo por idioma, migas, estado, acciones (nodos) y Reintentar con su accion', async () => {
        await render({
            type: 'PAGE_HEADER',
            props: {
                title: { es: 'Notas rapidas', en: 'Quick notes' }, breadcrumbs: [{ label: 'Inicio', url: '/' }, { label: 'Notas' }], status: { label: 'Al dia', tone: 'success' },
                actions: [{ type: 'BUTTON', props: { label: 'Nueva', onClick: set('creating', true) } }], error: '${state.err}', onRetry: set('err', ''),
            },
        }, { err: 'Fallo de red' });
        expect(q('h1')?.textContent).toBe('Notas rapidas');
        expect(q('[role="alert"]')?.textContent).toContain('Fallo de red');
        await click(qa('button').find((b) => b.textContent === 'Reintentar') ?? null);
        expect(q('[role="alert"]')).toBeNull();
        expect(qa('button').some((b) => b.textContent === 'Nueva')).toBe(true);
    });
});

describe('KPI_CARD y CHART con datos del estado', () => {
    it('los valores salen de `state` y reaccionan a SET_STATE', async () => {
        await render({
            type: 'STACK', children: [
                { type: 'KPI_CARD', props: { label: 'Recibidos', value: '${state.kpi.received}', delta: '${state.kpi.delta}', trend: 'up', loading: '${state.loading}' } },
                { type: 'CHART', props: { kind: 'line', labels: '${state.days}', series: [{ label: { es: 'Recibidos', en: 'Received' }, data: '${state.series}' }], loading: '${state.loading}' } },
                { type: 'BUTTON', props: { label: 'Cargar', onClick: [set('loading', false), set('kpi', { received: 321, delta: '+4 %' }), set('days', ['L', 'M']), set('series', [3, 9])] } },
            ],
        }, { loading: true, kpi: {}, days: [], series: [] });
        expect(q('[aria-busy="true"]')).not.toBeNull();
        await click(qa('button').find((b) => b.textContent === 'Cargar') ?? null);
        expect(q('[aria-busy="true"]')).toBeNull();
        expect(text()).toContain('321');
        expect(text()).toContain('+4 %');
        expect(qa('table.sr-only tbody tr').map((r) => r.textContent)).toEqual(['L3', 'M9']);
    });

    it('CHART ignora estilos crudos y un tipo desconocido cae al valor por defecto (linea)', async () => {
        await render({ type: 'CHART', props: { kind: 'radar', className: 'evil', style: { color: 'red' }, color: '#f00', labels: ['A', 'B'], series: [{ label: 'S', data: [1, 2] }] } });
        expect(q('svg')).not.toBeNull();
        expect(document.querySelector('[class*="evil"]')).toBeNull();
        expect(document.body.innerHTML).not.toMatch(/#f00|color:\s*red/);
    });
});

describe('SPLIT_PANE', () => {
    it('renderiza los dos slots con sus componentes y el estado compartido', async () => {
        await render({
            type: 'SPLIT_PANE', props: {
                ratio: '1:1', startPane: [{ type: 'BUTTON', props: { label: 'Elegir', onClick: set('pick', 'B') } }],
                endPane: [{ type: 'TEXT', props: { content: 'Elegido: ${state.pick}' } }],
            },
        }, { pick: 'ninguno' });
        expect(text()).toContain('Elegido: ninguno');
        await click(qa('button').find((b) => b.textContent === 'Elegir') ?? null);
        expect(text()).toContain('Elegido: B');
    });
});

describe('TREE', () => {
    it('bind guarda el id elegido en state y onSelect recibe `value` e `item`', async () => {
        await render({
            type: 'STACK', children: [
                { type: 'TREE', props: { bind: 'sel', defaultExpanded: 2, items: '${state.nodes}', onSelect: set('label', '${item.label}') } },
                { type: 'TEXT', props: { content: 'sel=${state.sel} label=${state.label}' } },
            ],
        }, { nodes: [{ id: 'p', label: 'Proyectos', children: [{ id: 'p1', label: 'Alfa' }] }], sel: '', label: '' });
        await click(q('[data-tree-id="p1"] > div'));
        expect(text()).toContain('sel=p1 label=Alfa');
        expect(q('[data-tree-id="p1"]')?.getAttribute('aria-selected')).toBe('true');
        await key(q('[data-tree-id="p"]'), 'ArrowLeft');
        expect(q('[data-tree-id="p"]')?.getAttribute('aria-expanded')).toBe('false');
    });
});

describe('TABLE avanzada', () => {
    const rows = [{ id: 'a', n: 'Uno', s: 'Abierta' }, { id: 'b', n: 'Dos', s: 'Hecha' }, { id: 'c', n: 'Tres', s: 'Abierta' }];

    it('busqueda + acciones masivas: la accion recibe `value` (claves) y `rows`', async () => {
        await render({
            type: 'STACK', children: [
                {
                    type: 'TABLE', props: {
                        data: '${state.rows}', rowKey: 'id', searchable: true, selectable: 'multiple', columns: [{ key: 'n', label: 'Nombre' }, { key: 's', label: 'Estado', format: 'status', filter: true }],
                        bulkActions: [{ label: 'Borrar', onClick: [set('deleted', '${value}'), set('count', '${rows.length}')] }],
                    },
                },
                { type: 'TEXT', props: { content: 'borradas=${state.deleted} n=${state.count}' } },
            ],
        }, { rows, deleted: '', count: 0 });
        await typeInto(q<HTMLInputElement>('input[type="search"]'), 'o');
        expect(qa('tbody tr td:nth-child(2)').map((t) => t.textContent)).toEqual(['Uno', 'Dos']);
        const boxes = qa<HTMLInputElement>('tbody input[type="checkbox"]');
        await click(boxes[0]);
        await click(boxes[1]);
        await click(qa('[role="toolbar"] button').find((b) => b.textContent === 'Borrar') ?? null);
        expect(text()).toContain('borradas=a,b n=2');
    });

    it('error con Reintentar ejecuta onRetry y el estado de carga lo reemplaza', async () => {
        await render({
            type: 'TABLE', props: { data: [], columns: [{ key: 'n', label: 'N' }], error: '${state.err}', loading: '${state.busy}', onRetry: [set('err', ''), set('busy', true)] },
        }, { err: 'Sin conexion', busy: false });
        expect(q('[role="alert"]')?.textContent).toContain('Sin conexion');
        await click(qa('button').find((b) => b.textContent === 'Reintentar') ?? null);
        expect(q('table')?.getAttribute('aria-busy')).toBe('true');
        expect(q('[role="alert"]')).toBeNull();
    });
});

describe('TIMELINE y STEPPER', () => {
    it('TIMELINE: onClick por elemento; STEPPER: avanza con `current` desde el estado y los pasos completados son pulsables', async () => {
        await render({
            type: 'STACK', children: [
                { type: 'TIMELINE', props: { items: [{ title: 'Primero', onClick: set('seen', 'primero') }, { title: 'Segundo' }] } },
                { type: 'STEPPER', props: { current: '${state.step}', steps: [{ title: 'A' }, { title: 'B' }, { title: 'C' }], onSelect: set('step', '${value}') } },
                { type: 'BUTTON', props: { label: 'Siguiente', onClick: set('step', '${state.step + 1}') } },
                { type: 'TEXT', props: { content: 'seen=${state.seen} step=${state.step}' } },
            ],
        }, { step: 0, seen: '-' });
        await click(qa('button').find((b) => b.textContent === 'Primero') ?? null);
        expect(text()).toContain('seen=primero');
        await click(qa('button').find((b) => b.textContent === 'Siguiente') ?? null);
        await click(qa('button').find((b) => b.textContent === 'Siguiente') ?? null);
        expect(qa('ol > li').filter((li) => li.getAttribute('aria-current') === 'step').length).toBe(1);
        const done = qa('ol button').find((b) => b.textContent?.includes('A'));
        await click(done ?? null);
        expect(text()).toContain('step=0');
    });
});

describe('sandbox: nada de HTML ni scripts por los componentes nuevos', () => {
    it('textos hostiles se muestran como texto y las URLs peligrosas no son enlaces', async () => {
        const evil = '<img src=x onerror=alert(1)><script>alert(1)</script>';
        await render({
            type: 'STACK', children: [
                { type: 'PAGE_HEADER', props: { title: evil, description: evil, breadcrumbs: [{ label: evil, url: 'javascript:alert(1)' }, { label: 'x' }] } },
                { type: 'KPI_CARD', props: { label: evil, value: evil, delta: evil } },
                { type: 'TIMELINE', props: { items: [{ title: evil, description: evil, time: evil }] } },
                { type: 'TREE', props: { items: [{ id: 'a', label: evil, icon: 'javascript:alert(1)', badge: evil }] } },
                { type: 'STEPPER', props: { steps: [{ title: evil, description: evil }] } },
                { type: 'CHART', props: { labels: [evil], series: [{ label: evil, data: [1] }], title: evil } },
                { type: 'TABLE', props: { data: [{ a: evil, u: 'javascript:alert(1)' }], columns: [{ key: 'a', format: 'link', hrefKey: 'u' }] } },
            ],
        });
        expect(q('img')).toBeNull();
        expect(q('script')).toBeNull();
        expect(qa('[onerror], [onclick]').length).toBe(0);
        expect(qa<HTMLAnchorElement>('a').some((a) => /^javascript:/i.test(a.getAttribute('href') || ''))).toBe(false);
        expect(text()).toContain('<img src=x onerror=alert(1)>');
    });
});
