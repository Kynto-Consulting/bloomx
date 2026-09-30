// @vitest-environment jsdom
/** Arbol de etiquetas/carpetas: roles ARIA (tree/treeitem), teclado, alternativas al arrastre, menu, borrado y contadores acumulados. */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click, flush, installCleanup, key, mount, q, qa, typeInto } from '@/components/expansions/kit/__tests__/harness';
import { RAW_CLASS } from '@/lib/__tests__/helpers/raw-colors';

vi.mock('@/components/I18nProvider', async () => {
    const { getTranslator } = await import('@/lib/i18n');
    return { useI18n: () => ({ locale: 'es', t: getTranslator('es').t }) };
});
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { LabelTree, LABEL_DND_TYPE } from '../LabelTree';
import type { LabelRef } from '@/lib/mail-list';

const L = (id: string, name: string, extra: Partial<LabelRef> = {}): LabelRef => ({ id, name, color: '#123456', fullPath: name, parentId: null, behavior: 'tag', sortOrder: 0, count: 0, total: 0, ...extra });
const labels = (): LabelRef[] => [
    L('w', 'Trabajo', { count: 3, total: 10 }),
    L('a', 'Proyecto A', { parentId: 'w', fullPath: 'Trabajo/Proyecto A', count: 2, total: 6, sortOrder: 0 }),
    L('b', 'Proyecto B', { parentId: 'w', fullPath: 'Trabajo/Proyecto B', count: 1, total: 4, sortOrder: 1 }),
    L('p', 'Personal', { sortOrder: 1, total: 2 }),
    L('f', 'Facturas', { behavior: 'folder', sortOrder: 2, count: 5, total: 5, icon: 'receipt' }),
    L('h', 'Oculta', { sortOrder: 3, showInSidebar: false }),
];

let calls: Array<{ url: string; method: string; body: any }>;
let reply: (url: string, method: string) => { ok: boolean; status?: number; json: any };
beforeEach(() => {
    calls = [];
    reply = () => ({ ok: true, json: { success: true, deleted: ['x'] } });
    localStorage.clear();
    vi.stubGlobal('CSS', { escape: (s: string) => s });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any = {}) => {
        const body = init.body ? JSON.parse(init.body) : undefined;
        calls.push({ url, method: init.method ?? 'GET', body });
        const r = reply(url, init.method ?? 'GET');
        return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 400), json: async () => r.json };
    }));
    toast.error.mockClear(); toast.success.mockClear();
    (window as any).requestAnimationFrame = (cb: any) => { cb(0); return 0; };
});
afterEach(() => vi.unstubAllGlobals());

const items = () => qa('[role="treeitem"]');
const ids = () => items().map((e) => e.getAttribute('data-label-id'));
const item = (id: string) => q(`[role="treeitem"][data-label-id="${id}"]`)!;
const dt = () => { const store: Record<string, string> = {}; return { setData: (k: string, v: string) => { store[k] = v; }, getData: (k: string) => store[k] ?? '', types: [LABEL_DND_TYPE], effectAllowed: '', dropEffect: '' }; };
async function fire(el: Element, type: string, data: any, init: Record<string, unknown> = {}) {
    await act(async () => { const e = Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer: data }, init); el.dispatchEvent(e); });
}

function tree(props: Partial<React.ComponentProps<typeof LabelTree>> = {}) {
    return <LabelTree labels={labels()} onChanged={props.onChanged ?? vi.fn()} getHref={(l) => `/mail?label=${l.fullPath}`} {...props} />;
}

describe('LabelTree', () => {
    installCleanup();

    it('roles ARIA: tree/treeitem con nivel, posicion, tamano y estado expandido; las ocultas no se dibujan en la barra', async () => {
        await mount(tree());
        expect(q('[role="tree"]')!.getAttribute('aria-label')).toBe('Etiquetas y carpetas');
        expect(ids()).toEqual(['w', 'p', 'f']); // subetiquetas colapsadas; 'h' oculta de la barra
        const w = item('w');
        expect(w.getAttribute('aria-level')).toBe('1');
        expect(w.getAttribute('aria-posinset')).toBe('1');
        expect(w.getAttribute('aria-setsize')).toBe('3');
        expect(w.getAttribute('aria-expanded')).toBe('false');
        expect(item('p').hasAttribute('aria-expanded')).toBe(false);
        expect(w.getAttribute('aria-label')).toBe('Trabajo, 3 sin leer'); // acumulado de los hijos que trae el servidor
        expect(qa('[role="treeitem"][tabindex="0"]')).toHaveLength(1); // roving tabindex
    });

    it('teclado: flechas, Home/End, expandir y contraer, ir al padre', async () => {
        await mount(tree());
        item('w').focus();
        await key(item('w'), 'ArrowRight');
        expect(item('w').getAttribute('aria-expanded')).toBe('true');
        expect(ids()).toEqual(['w', 'a', 'b', 'p', 'f']);
        expect(item('a').getAttribute('aria-level')).toBe('2');
        await key(item('w'), 'ArrowRight'); // ya abierto: entra al primer hijo
        expect(document.activeElement).toBe(item('a'));
        await key(item('a'), 'ArrowDown');
        expect(document.activeElement).toBe(item('b'));
        await key(item('b'), 'ArrowLeft'); // sin hijos: va al padre
        expect(document.activeElement).toBe(item('w'));
        await key(item('w'), 'End');
        expect(document.activeElement).toBe(item('f'));
        await key(item('f'), 'Home');
        expect(document.activeElement).toBe(item('w'));
        await key(item('w'), 'ArrowLeft');
        expect(item('w').getAttribute('aria-expanded')).toBe('false');
        expect(JSON.parse(localStorage.getItem('bloomx.labelTree.expanded')!)).toEqual([]);
    });

    it('alternativa de teclado al arrastre: Alt+Abajo reordena, Alt+Derecha anida, Alt+Izquierda sube', async () => {
        const onChanged = vi.fn();
        await mount(tree({ onChanged }));
        await key(item('w'), 'ArrowRight');
        await key(item('a'), 'ArrowDown', { altKey: true });
        await flush();
        const c1 = calls.find((c) => c.url === '/api/labels/reorder')!;
        expect(c1.body.items.filter((i: any) => i.parentId === 'w').sort((x: any, y: any) => x.sortOrder - y.sortOrder).map((i: any) => i.id)).toEqual(['b', 'a']);
        expect(onChanged).toHaveBeenCalled();

        calls.length = 0;
        await key(item('p'), 'ArrowRight', { altKey: true }); // p pasa a ser hija de w (hermana anterior)
        await flush();
        expect(calls[0].body.items.find((i: any) => i.id === 'p')).toMatchObject({ parentId: 'w' });
    });

    it('arrastrar y soltar: dentro (anida), antes/despues (reordena); ciclos rechazados sin llamar al servidor', async () => {
        await mount(tree());
        const rect = (top: number) => ({ getBoundingClientRect: () => ({ top, height: 40, left: 0, right: 100, bottom: top + 40, width: 100 }) });
        const target = item('w');
        Object.assign(target, rect(0));
        const d = dt();
        await fire(item('p'), 'dragstart', d);
        await fire(target, 'dragover', d, { clientY: 20 });
        await fire(target, 'drop', d);
        await flush();
        expect(calls.at(-1)!.body.items.find((i: any) => i.id === 'p')).toMatchObject({ parentId: 'w' });

        calls.length = 0;
        await key(item('w'), 'ArrowRight');
        const d2 = dt();
        Object.assign(item('f'), rect(0));
        await fire(item('b'), 'dragstart', d2);
        await fire(item('f'), 'dragover', d2, { clientY: 2 }); // borde superior = antes
        await fire(item('f'), 'drop', d2);
        await flush();
        expect(calls[0].body.items.find((i: any) => i.id === 'b')).toMatchObject({ parentId: null });

        calls.length = 0;
        const d3 = dt();
        Object.assign(item('a'), rect(0));
        await fire(item('w'), 'dragstart', d3);
        await fire(item('a'), 'dragover', d3, { clientY: 20 });
        await fire(item('a'), 'drop', d3);
        await flush();
        expect(calls).toHaveLength(0);
        expect(toast.error).toHaveBeenCalledWith('No se puede mover una etiqueta dentro de sus propias subetiquetas.');
    });

    it('el servidor rechaza el movimiento: se revierte y se avisa', async () => {
        reply = () => ({ ok: false, status: 400, json: { error: 'x', code: 'conflict' } });
        await mount(tree());
        await key(item('p'), 'ArrowUp', { altKey: true });
        await flush();
        expect(toast.error).toHaveBeenCalledWith('Ya existe una etiqueta con ese nombre en ese nivel.');
        expect(ids()).toEqual(['w', 'p', 'f']);
    });

    it('menu contextual: abre con la tecla de menu, navega con flechas, cambia comportamiento y cierra con Escape', async () => {
        await mount(tree());
        await key(item('p'), 'ContextMenu');
        const menu = q('[role="menu"]')!;
        expect(menu).toBeTruthy();
        const mi = qa('[role="menuitem"]', menu);
        expect(mi[0].textContent).toBe('Renombrar');
        expect(document.activeElement).toBe(mi[0]);
        await key(menu, 'ArrowDown');
        expect(document.activeElement).toBe(mi[1]);
        await click(mi.find((e) => e.textContent?.includes('Usar como carpeta'))!);
        await flush();
        expect(calls.at(-1)).toMatchObject({ url: '/api/labels/p', method: 'PATCH', body: { behavior: 'folder' } });
        expect(q('[role="menu"]')).toBeNull();
        await key(item('p'), 'F10', { shiftKey: true });
        await key(q('[role="menu"]'), 'Escape');
        expect(q('[role="menu"]')).toBeNull();
    });

    it('mover a... no ofrece la propia etiqueta ni sus descendientes', async () => {
        await mount(tree());
        await key(item('w'), 'ContextMenu');
        await click(qa('[role="menuitem"]').find((e) => e.textContent === 'Mover a…')!);
        const opts = qa('[role="menuitem"]').map((e) => e.textContent);
        expect(opts).toContain('Personal');
        expect(opts).not.toContain('Trabajo');
        expect(opts).not.toContain('Proyecto A');
    });

    it('renombrar con F2 (Intro confirma, Escape cancela) y nueva subetiqueta', async () => {
        await mount(tree());
        await key(item('p'), 'F2');
        const input = q<HTMLInputElement>('input[aria-label="Renombrar"]')!;
        await typeInto(input, 'Casa');
        await key(input, 'Enter');
        await flush();
        expect(calls.at(-1)).toMatchObject({ url: '/api/labels/p', method: 'PATCH', body: { name: 'Casa' } });

        calls.length = 0;
        await key(item('p'), 'ContextMenu');
        await click(qa('[role="menuitem"]').find((e) => e.textContent === 'Nueva subetiqueta')!);
        const sub = q<HTMLInputElement>('input[aria-label="Nombre de la subetiqueta"]')!;
        await typeInto(sub, 'Viajes');
        await key(sub, 'Enter');
        await flush();
        expect(calls.at(-1)).toMatchObject({ url: '/api/labels', method: 'POST', body: { name: 'Viajes', parentId: 'p' } });
    });

    it('eliminar: confirmacion que explica los correos y las subetiquetas; modo reubicar / eliminar todo', async () => {
        await mount(tree());
        await key(item('w'), 'Delete');
        const dialog = q('[role="dialog"]')!;
        expect(dialog.textContent).toContain('Los correos no se borran');
        expect(dialog.textContent).toContain('Tiene 2 subetiquetas');
        await click(qa<HTMLInputElement>('input[name="del-children"]')[1]);
        await click(qa<HTMLButtonElement>('button', dialog).find((b) => b.textContent === 'Eliminar')!);
        await flush();
        expect(calls.at(-1)).toMatchObject({ url: '/api/labels/w?children=delete', method: 'DELETE' });
        expect(toast.success).toHaveBeenCalled();

        await key(item('f'), 'Delete');
        expect(q('[role="dialog"]')!.textContent).toContain('vuelven a la Bandeja de entrada'); // etiqueta-carpeta
        expect(q('input[name="del-children"]')).toBeNull(); // sin hijos: no hay pregunta
    });

    it('en Ajustes se muestran tambien las ocultas (atenuadas) y se selecciona en lugar de navegar', async () => {
        const onEdit = vi.fn();
        await mount(<LabelTree mode="settings" labels={labels()} onChanged={vi.fn()} onEdit={onEdit} selectedId="p" />);
        expect(ids()).toEqual(['w', 'p', 'f', 'h']);
        expect(item('p').getAttribute('aria-selected')).toBe('true');
        expect(q('a[href]')).toBeNull();
        await click(item('f').querySelector('button:not([aria-haspopup]):not([aria-label])'));
        expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'f' }));
    });

    it('etiqueta activa: abre a sus ancestros y marca aria-current', async () => {
        await mount(tree({ activePaths: ['trabajo/proyecto a'] }));
        expect(ids()).toEqual(['w', 'a', 'b', 'p', 'f']);
        expect(item('a').getAttribute('aria-selected')).toBe('true');
        expect(item('a').querySelector('a')!.getAttribute('aria-current')).toBe('page');
    });

    it('sin paleta cruda en el marcado (los colores de etiqueta son datos del usuario)', async () => {
        await mount(tree());
        expect(document.body.innerHTML.match(RAW_CLASS) ?? []).toEqual([]);
    });

    it('vacio: muestra el mensaje y no un arbol', async () => {
        await mount(<LabelTree labels={[]} onChanged={vi.fn()} />);
        expect(q('[role="tree"]')).toBeNull();
        expect(document.body.textContent).toContain('Sin etiquetas');
    });
});
