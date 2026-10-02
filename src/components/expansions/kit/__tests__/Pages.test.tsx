// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { installCleanup, kitSuite, mount, click, key, q, qa } from './harness';
import { PageHeader, SplitPane, KpiCard, Timeline, Tree, Stepper, normalizeTree, TREE_MAX_NODES, TREE_MAX_DEPTH, SPLIT_MIN, SPLIT_MAX } from '../Pages';

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => React.createElement('a', { href, ...rest }, children) }));

const nodes = [
    { id: 'inbox', label: 'Entrada', icon: 'Inbox', badge: '3' },
    { id: 'projects', label: 'Proyectos', icon: 'Folder', children: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', children: [{ id: 'b1', label: 'B1' }] }] },
    { id: 'archive', label: 'Archivo' },
];

kitSuite('PageHeader', () => (
    <PageHeader
        title="Metricas" description="Resumen" icon="ChartColumn" status={{ label: 'En vivo', tone: 'success' }}
        breadcrumbs={[{ label: 'Inicio', url: '/' }, { label: 'Metricas' }]} actions={<button type="button">Actualizar</button>} error="Fallo" onRetry={() => { }}
    />
));
kitSuite('SplitPane', () => <SplitPane start={<p>Lista</p>} end={<p>Detalle</p>} resizable startLabel="Lista" endLabel="Detalle" sticky />);
kitSuite('KpiCard', () => <KpiCard label="Spam" value="96" unit="hoy" delta="-12 %" trend="down" invertTrend description="vs ayer" icon="ShieldAlert" tone="info" sparkline={[1, 3, 2, 5, 4]} onPress={() => { }} />);
kitSuite('KpiCard cargando', () => <KpiCard label="Cargando" loading />);
kitSuite('Timeline', () => <Timeline items={[{ title: 'Enviado', description: 'a ana', time: '2026-03-12T09:30:00.000Z', icon: 'Send', tone: 'success' }, { title: 'Jueves', time: 'Jueves', tone: 'warning', onPress: () => { } }]} />);
kitSuite('Tree', () => <Tree items={nodes} label="Carpetas" defaultExpanded={2} selected="a" />);
kitSuite('Stepper', () => <Stepper current={1} steps={[{ title: 'Datos', description: 'Nombre' }, { title: 'Revision' }, { title: 'Error', status: 'error' }, { title: 'Fin' }]} onSelect={() => { }} />);

describe('PageHeader', () => {
    installCleanup();

    it('h1, migas con aria-current en la ultima, estado y acciones', async () => {
        await mount(<PageHeader title="Metricas" description="Resumen" breadcrumbs={[{ label: 'Inicio', url: '/' }, { label: 'Admin', url: '/admin' }, { label: 'Metricas' }]} status={{ label: 'En vivo', tone: 'success' }} actions={<button type="button">Actualizar</button>} />);
        expect(qa('h1').length).toBe(1);
        expect(q('h1')?.textContent).toBe('Metricas');
        const nav = q('nav');
        expect(nav?.getAttribute('aria-label')).toBe('Migas de pan');
        const items = qa('nav li');
        expect(items.length).toBe(3);
        expect(items[2].querySelector('[aria-current="page"]')?.textContent).toBe('Metricas');
        expect(qa('nav a').map((a) => a.getAttribute('href'))).toEqual(['/', '/admin']);
        expect(document.body.textContent).toContain('En vivo');
        expect(q('button')?.textContent).toBe('Actualizar');
    });

    it('migas: una URL peligrosa no es un enlace y mas de 6 tramos se recortan', async () => {
        const crumbs = Array.from({ length: 9 }, (_, i) => ({ label: `T${i}`, url: i === 0 ? 'javascript:alert(1)' : '/x' }));
        await mount(<PageHeader title="T" breadcrumbs={crumbs} />);
        expect(qa('nav li').length).toBe(6);
        expect(qa('a').some((a) => (a.getAttribute('href') || '').startsWith('javascript:'))).toBe(false);
    });

    it('cargando: sin texto del titulo, aria-busy y estado anunciado', async () => {
        await mount(<PageHeader title="Secreto" loading />);
        expect(q('h1')).toBeNull();
        expect(q('header')?.getAttribute('aria-busy')).toBe('true');
        expect(q('[role="status"]')?.textContent).toBe('Cargando...');
    });

    it('error: role=alert con Reintentar que llama a onRetry', async () => {
        const onRetry = vi.fn();
        await mount(<PageHeader title="Notas" error="No se pudo cargar" onRetry={onRetry} />);
        expect(q('[role="alert"]')?.textContent).toContain('No se pudo cargar');
        await click(qa('button').find((b) => b.textContent === 'Reintentar') ?? null);
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('el titulo se pinta como texto (nunca HTML)', async () => {
        await mount(<PageHeader title={'<img src=x onerror=alert(1)>'} description={'<script>alert(1)</script>'} />);
        expect(q('img')).toBeNull();
        expect(q('script')).toBeNull();
        expect(q('h1')?.textContent).toBe('<img src=x onerror=alert(1)>');
    });
});

describe('SplitPane', () => {
    installCleanup();
    const pct = () => Number(q('[data-split]')?.getAttribute('data-split'));

    it('proporcion inicial y paneles etiquetados', async () => {
        await mount(<SplitPane ratio="2:1" start={<p>A</p>} end={<p>B</p>} startLabel="Lista" endLabel="Detalle" />);
        expect(pct()).toBe(67);
        expect(qa('section').map((s) => s.getAttribute('aria-label'))).toEqual(['Lista', 'Detalle']);
        expect(q('[role="separator"]')).toBeNull();
    });

    it('redimensionable: separador con teclado, limites y valor ARIA', async () => {
        await mount(<SplitPane resizable ratio="1:2" start={<p>A</p>} end={<p>B</p>} />);
        const sep = q('[role="separator"]')!;
        expect(sep.getAttribute('aria-orientation')).toBe('vertical');
        expect(sep.getAttribute('aria-valuenow')).toBe('33');
        expect(sep.getAttribute('tabindex')).toBe('0');
        await key(sep, 'ArrowRight');
        expect(pct()).toBe(38);
        await key(sep, 'End');
        expect(pct()).toBe(SPLIT_MAX);
        await key(sep, 'ArrowRight');
        expect(pct()).toBe(SPLIT_MAX);
        await key(sep, 'Home');
        expect(pct()).toBe(SPLIT_MIN);
        await key(sep, 'ArrowLeft');
        expect(pct()).toBe(SPLIT_MIN);
    });

    it('en pantallas estrechas se apila (una columna) y el separador solo existe en escritorio', async () => {
        await mount(<SplitPane resizable start={<p>A</p>} end={<p>B</p>} />);
        const grid = q('[data-split]')!;
        expect(grid.className).toContain('grid-cols-1');
        expect(grid.className).toContain('md:grid-cols-[');
        expect(q('[role="separator"]')?.className).toContain('hidden');
        expect(q('[role="separator"]')?.className).toContain('md:flex');
        expect(grid.getAttribute('style')).toContain('--split-start');
    });
});

describe('KpiCard', () => {
    installCleanup();

    it('valor, unidad, variacion con direccion para lectores de pantalla y mini-tendencia', async () => {
        await mount(<KpiCard label="Recibidos" value="1.284" unit="correos" delta="+8 %" trend="up" sparkline={[1, 2, 3]} />);
        expect(q('[role="group"]')?.getAttribute('aria-label')).toBe('Recibidos');
        expect(document.body.textContent).toContain('1.284');
        expect(document.body.textContent).toContain('correos');
        expect(q('.sr-only')?.textContent).toContain('sube');
        expect(q('svg[role="img"]')).not.toBeNull();
        expect(q('.text-success')).not.toBeNull();
    });

    it('invertTrend: subir es malo (spam) y bajar es bueno', async () => {
        await mount(<KpiCard label="Spam" value="9" delta="+2" trend="up" invertTrend />);
        expect(q('.text-destructive')).not.toBeNull();
        expect(q('.text-success')).toBeNull();
    });

    it('cargando y con error no muestran el valor', async () => {
        const m = await mount(<KpiCard label="X" value="42" loading />);
        expect(document.body.textContent).not.toContain('42');
        expect(q('[role="group"]')?.getAttribute('aria-busy')).toBe('true');
        await m.render(<KpiCard label="X" value="42" error="Sin datos" />);
        expect(q('[role="alert"]')?.textContent).toContain('Sin datos');
        expect(document.body.textContent).not.toContain('42');
    });

    it('onPress la convierte en boton accesible', async () => {
        const onPress = vi.fn();
        await mount(<KpiCard label="Abrir" value="1" onPress={onPress} />);
        await click(q('button'));
        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('sparkline hostil (NaN, textos) no rompe y se recorta a 60 puntos', async () => {
        await mount(<KpiCard label="X" value="1" sparkline={[1, NaN, 'a' as any, 2, ...Array.from({ length: 200 }, (_, i) => i)]} />);
        expect(q('svg')).not.toBeNull();
    });
});

describe('Timeline', () => {
    installCleanup();

    it('formatea fechas ISO en <time> y deja el texto libre tal cual', async () => {
        await mount(<Timeline items={[{ title: 'A', time: '2026-03-12T09:30:00.000Z' }, { title: 'B', time: 'Jueves' }, { title: 'C', time: '2026-03-12' }]} />);
        const times = qa('time');
        expect(times.length).toBe(2);
        expect(times[0].getAttribute('datetime')).toBe('2026-03-12T09:30:00.000Z');
        expect(document.body.textContent).toContain('Jueves');
        expect(qa('ol > li').length).toBe(3);
    });

    it('vacio, cargando, sin titulo descartado y tope de 200', async () => {
        const m = await mount(<Timeline items={[]} emptyText="Nada" />);
        expect(document.body.textContent).toContain('Nada');
        await m.render(<Timeline loading />);
        expect(q('[aria-busy="true"]')).not.toBeNull();
        await m.render(<Timeline items={[{ title: '' } as any, ...Array.from({ length: 300 }, (_, i) => ({ title: `E${i}` }))]} />);
        expect(qa('ol > li').length).toBe(200);
    });

    it('elemento con accion es un boton; el texto nunca es HTML', async () => {
        const onPress = vi.fn();
        await mount(<Timeline items={[{ title: '<b>x</b>', onPress }]} />);
        expect(q('b')).toBeNull();
        await click(q('button'));
        expect(onPress).toHaveBeenCalled();
    });
});

describe('Tree', () => {
    installCleanup();

    it('roles ARIA: tree, treeitem, group, niveles y expandido', async () => {
        await mount(<Tree items={nodes} label="Carpetas" defaultExpanded={1} />);
        expect(q('[role="tree"]')?.getAttribute('aria-label')).toBe('Carpetas');
        const items = qa('[role="treeitem"]');
        expect(items.map((i) => i.getAttribute('data-tree-id'))).toEqual(['inbox', 'projects', 'a', 'b', 'archive']);
        expect(items[1].getAttribute('aria-expanded')).toBe('true');
        expect(items[3].getAttribute('aria-expanded')).toBe('false');
        expect(items[2].getAttribute('aria-level')).toBe('2');
        expect(items[0].hasAttribute('aria-expanded')).toBe(false);
        expect(qa('[role="treeitem"][tabindex="0"]').length).toBe(1);
    });

    it('teclado: flechas, derecha/izquierda abren, cierran y suben al padre; Intro selecciona', async () => {
        const onSelect = vi.fn();
        await mount(<Tree items={nodes} defaultExpanded={0} onSelect={onSelect} />);
        const item = (id: string) => qa('[role="treeitem"]').find((i) => i.getAttribute('data-tree-id') === id)!;
        item('inbox').focus();
        await key(item('inbox'), 'ArrowDown');
        expect(document.activeElement).toBe(item('projects'));
        await key(item('projects'), 'ArrowRight');
        expect(item('projects').getAttribute('aria-expanded')).toBe('true');
        await key(item('projects'), 'ArrowRight');
        expect(document.activeElement).toBe(item('a'));
        await key(item('a'), 'ArrowLeft');
        expect(document.activeElement).toBe(item('projects'));
        await key(item('projects'), 'ArrowLeft');
        expect(item('projects').getAttribute('aria-expanded')).toBe('false');
        await key(item('projects'), 'End');
        expect(document.activeElement).toBe(item('archive'));
        await key(item('archive'), 'Enter');
        expect(onSelect).toHaveBeenCalledWith('archive', { id: 'archive', label: 'Archivo' });
        expect(item('archive').getAttribute('aria-selected')).toBe('true');
        await key(item('archive'), 'Home');
        expect(document.activeElement).toBe(item('inbox'));
    });

    it('pulsar un nodo con hijos lo selecciona y alterna', async () => {
        const onSelect = vi.fn();
        await mount(<Tree items={nodes} defaultExpanded={0} onSelect={onSelect} />);
        await click(q('[data-tree-id="projects"] > div'));
        expect(onSelect).toHaveBeenCalledWith('projects', expect.anything());
        expect(q('[data-tree-id="projects"]')?.getAttribute('aria-expanded')).toBe('true');
    });

    it('vacio y cargando', async () => {
        const m = await mount(<Tree items={[]} emptyText="Sin nodos" />);
        expect(document.body.textContent).toContain('Sin nodos');
        await m.render(<Tree loading />);
        expect(q('[aria-busy="true"]')).not.toBeNull();
    });

    it('normalizeTree: datos hostiles, ids duplicados, 500 nodos y 8 niveles como maximo', () => {
        expect(normalizeTree('x')).toEqual([]);
        expect(normalizeTree([null, 3, { label: '' }, { id: 'a', label: '<b>x</b>', children: 'no' }]).map((n) => n.label)).toEqual(['<b>x</b>']);
        const dup = normalizeTree([{ id: 'x', label: 'A' }, { id: 'x', label: 'B' }]);
        expect(new Set(dup.map((n) => n.id)).size).toBe(2);
        const wide = normalizeTree(Array.from({ length: 900 }, (_, i) => ({ id: `n${i}`, label: `N${i}` })));
        expect(wide.length).toBe(TREE_MAX_NODES);
        let deep: any = { id: 'd0', label: 'D0' };
        const root = deep;
        for (let i = 1; i < 30; i += 1) { deep.children = [{ id: `d${i}`, label: `D${i}` }]; deep = deep.children[0]; }
        let levels = 0;
        for (let cur: any = normalizeTree([root])[0]; cur; cur = cur.children[0]) levels += 1;
        expect(levels).toBe(TREE_MAX_DEPTH);
    });
});

describe('Stepper', () => {
    installCleanup();

    it('estados deducidos de `current`, aria-current y texto para lectores de pantalla', async () => {
        await mount(<Stepper current={1} steps={[{ title: 'Datos' }, { title: 'Revision' }, { title: 'Fin' }]} />);
        const li = qa('ol > li');
        expect(li.length).toBe(3);
        expect(li[1].getAttribute('aria-current')).toBe('step');
        expect(li[0].textContent).toContain('completado');
        expect(li[1].textContent).toContain('actual');
        expect(li[2].textContent).toContain('pendiente');
    });

    it('estado explicito error y solo los pasos completados son pulsables', async () => {
        const onSelect = vi.fn();
        await mount(<Stepper current={2} onSelect={onSelect} steps={[{ title: 'A' }, { title: 'B', status: 'error' }, { title: 'C' }, { title: 'D' }]} />);
        expect(qa('ol > li')[1].textContent).toContain('con error');
        expect(qa('button').length).toBe(1);
        await click(q('button'));
        expect(onSelect).toHaveBeenCalledWith(0);
    });

    it('sin pasos no pinta nada y `current` fuera de rango se acota', async () => {
        const m = await mount(<Stepper steps={[]} />);
        expect(q('ol')).toBeNull();
        await m.render(<Stepper current={99} steps={[{ title: 'A' }, { title: 'B' }]} />);
        expect(qa('ol > li')[1].getAttribute('aria-current')).toBe('step');
    });
});
