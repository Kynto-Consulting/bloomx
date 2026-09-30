// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sidebarMounts = vi.hoisted(() => ({ n: 0, ever: 0 }));
vi.mock('@/components/Sidebar', async () => {
    const R = await import('react');
    return { Sidebar: () => { R.useEffect(() => { sidebarMounts.n++; sidebarMounts.ever++; return () => { sidebarMounts.n--; }; }, []); return R.createElement('nav', { 'data-testid': 'sidebar' }); } };
});
vi.mock('@/contexts/ComposeContext', () => ({ useCompose: () => ({ openCompose: vi.fn() }) }));
vi.mock('@/components/I18nProvider', () => ({ useI18n: () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k), locale: 'es' }) }));

import { AppShell, useAppSidebar } from '../AppShell';
import { SIDEBAR_COOKIE, SIDEBAR_STORAGE_KEY } from '@/lib/layout/sidebar-width';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;

let host: HTMLDivElement;
let root: Root;
const setViewport = async (w: number) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
    await act(async () => { window.dispatchEvent(new Event('resize')); });
};
const aside = () => document.querySelector<HTMLElement>('[data-app-sidebar]')!;
const sep = () => document.querySelector<HTMLElement>('[role="separator"][data-sidebar-resizer]')!;
const widthOf = () => parseInt(aside().style.width, 10);
const key = async (el: HTMLElement, k: string, init: KeyboardEventInit = {}) => { await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })); }); };
const pointer = async (el: HTMLElement, type: string, x: number) => {
    await act(async () => {
        const ev = new MouseEvent(type, { clientX: x, button: 0, bubbles: true, cancelable: true });
        Object.assign(ev, { pointerId: 1 });
        el.dispatchEvent(ev);
    });
};
const cookieWidth = () => document.cookie.split('; ').find((c) => c.startsWith(`${SIDEBAR_COOKIE}=`))?.split('=')[1] ?? null;

const PageA = () => h('main', { id: 'page-a' }, 'A');
const PageB = () => h('main', { id: 'page-b' }, 'B');
const renderShell = async (children: React.ReactNode, initial: number | null = null) => { await act(async () => { root.render(h(AppShell, { initialSidebarWidth: initial, children })); }); };

beforeEach(async () => {
    sidebarMounts.n = 0; sidebarMounts.ever = 0;
    window.localStorage.clear();
    document.cookie = `${SIDEBAR_COOKIE}=; Max-Age=0; Path=/`;
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1280 });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('separador redimensionable: ARIA', () => {
    it('role=separator vertical con valuenow/min/max, valuetext, foco por teclado y nombre accesible', async () => {
        await renderShell(h(PageA));
        const s = sep();
        expect(s.getAttribute('aria-orientation')).toBe('vertical');
        expect(s.getAttribute('aria-valuenow')).toBe('256');
        expect(s.getAttribute('aria-valuemin')).toBe('208');
        expect(s.getAttribute('aria-valuemax')).toBe('409');
        expect(s.getAttribute('aria-label')).toBe('sidebar.resize');
        expect(s.getAttribute('aria-valuetext')).toContain('256');
        expect(s.tabIndex).toBe(0);
        expect(s.className).toContain('cursor-col-resize');
        expect(s.className).toMatch(/\bw-2\b/); // 8 px de area de agarre
        expect(widthOf()).toBe(256);
    });
});

describe('teclado', () => {
    it('flechas, Mayus, Home, End y Enter; el valor se refleja en aria y se persiste (localStorage + cookie)', async () => {
        await renderShell(h(PageA));
        await key(sep(), 'ArrowRight');
        expect(widthOf()).toBe(272);
        expect(sep().getAttribute('aria-valuenow')).toBe('272');
        expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('272');
        expect(cookieWidth()).toBe('272');
        await key(sep(), 'ArrowLeft', { shiftKey: true });
        expect(widthOf()).toBe(208);
        await key(sep(), 'ArrowLeft');
        expect(widthOf()).toBe(208); // no baja del minimo
        await key(sep(), 'End');
        expect(widthOf()).toBe(409);
        await key(sep(), 'ArrowRight');
        expect(widthOf()).toBe(409); // no supera el maximo
        await key(sep(), 'Home');
        expect(widthOf()).toBe(208);
        await key(sep(), 'Enter');
        expect(widthOf()).toBe(256);
        expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBeNull(); // restablecer = volver al valor por defecto (sin clave)
        expect(cookieWidth()).toBeNull();
    });

    it('doble clic restablece', async () => {
        await renderShell(h(PageA));
        await key(sep(), 'End');
        expect(widthOf()).toBe(409);
        await act(async () => { sep().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
        expect(widthOf()).toBe(256);
    });

    it('otras teclas no hacen nada (y no se bloquean)', async () => {
        await renderShell(h(PageA));
        const ev = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
        await act(async () => { sep().dispatchEvent(ev); });
        expect(ev.defaultPrevented).toBe(false);
        expect(widthOf()).toBe(256);
    });
});

describe('arrastre con puntero', () => {
    it('mueve la barra en vivo, se limita al rango y solo persiste al soltar', async () => {
        await renderShell(h(PageA));
        await pointer(sep(), 'pointerdown', 256);
        await pointer(sep(), 'pointermove', 300);
        expect(widthOf()).toBe(300);
        expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBeNull(); // aun no se ha soltado
        expect(sep().getAttribute('data-dragging')).toBe('true');
        expect(document.body.style.cursor).toBe('col-resize');
        await pointer(sep(), 'pointermove', 9000);
        expect(widthOf()).toBe(409);
        await pointer(sep(), 'pointermove', -50);
        expect(widthOf()).toBe(208);
        await pointer(sep(), 'pointermove', 320);
        await pointer(sep(), 'pointerup', 320);
        expect(widthOf()).toBe(320);
        expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('320');
        expect(cookieWidth()).toBe('320');
        expect(sep().getAttribute('data-dragging')).toBe('false');
        expect(document.body.style.cursor).toBe('');
    });

    it('cancelar el gesto no guarda nada', async () => {
        await renderShell(h(PageA));
        await pointer(sep(), 'pointerdown', 256);
        await pointer(sep(), 'pointermove', 330);
        await pointer(sep(), 'pointercancel', 330);
        expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBeNull();
        expect(document.body.style.cursor).toBe('');
    });

    it('arrastrar NO vuelve a montar la barra lateral (rendimiento)', async () => {
        await renderShell(h(PageA));
        const before = sidebarMounts.ever;
        await pointer(sep(), 'pointerdown', 256);
        for (const x of [270, 290, 310]) await pointer(sep(), 'pointermove', x);
        await pointer(sep(), 'pointerup', 310);
        expect(sidebarMounts.ever).toBe(before);
    });
});

describe('UNA barra y UN ancho compartido por todas las pantallas', () => {
    it('al cambiar de pagina el mismo nodo de la barra sobrevive, con el mismo ancho, sin remontarse', async () => {
        await renderShell(h(PageA));
        const node = aside();
        await key(sep(), 'ArrowRight', { shiftKey: true });
        expect(widthOf()).toBe(320);
        await renderShell(h(PageB)); // navegacion: cambian los hijos, el shell es el mismo
        expect(document.querySelector('#page-b')).not.toBeNull();
        expect(document.querySelector('#page-a')).toBeNull();
        expect(aside()).toBe(node);
        expect(widthOf()).toBe(320);
        expect(sidebarMounts.ever).toBe(1);
        expect(document.querySelectorAll('[data-app-sidebar]')).toHaveLength(1);
    });

    it('dos montajes distintos parten del mismo ancho guardado', async () => {
        await renderShell(h(PageA));
        await key(sep(), 'End');
        act(() => root.unmount());
        root = createRoot(host);
        await renderShell(h(PageB)); // otro montaje (p. ej. recarga): lee localStorage
        expect(widthOf()).toBe(409);
        expect(sep().getAttribute('aria-valuenow')).toBe('409');
    });

    it('la cookie del servidor da el ancho inicial; localStorage la corrige si difiere', async () => {
        await renderShell(h(PageA), 300);
        expect(widthOf()).toBe(300);
        act(() => root.unmount());
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, '340');
        root = createRoot(host);
        await renderShell(h(PageA), 300);
        expect(widthOf()).toBe(340);
    });

    it('un valor corrupto en localStorage se ignora (por defecto) y uno fuera de rango se recorta', async () => {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, '<script>');
        await renderShell(h(PageA));
        expect(widthOf()).toBe(256);
        act(() => root.unmount());
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, '3900');
        root = createRoot(host);
        await renderShell(h(PageA));
        expect(widthOf()).toBe(409);
    });

    it('sincroniza entre pestanas: un evento storage cambia el ancho y uno borrado lo restablece', async () => {
        await renderShell(h(PageA));
        await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: SIDEBAR_STORAGE_KEY, newValue: '360' })); });
        expect(widthOf()).toBe(360);
        await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: SIDEBAR_STORAGE_KEY, newValue: null })); });
        expect(widthOf()).toBe(256);
        await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: 'otra-clave', newValue: '999' })); });
        expect(widthOf()).toBe(256);
    });

    it('useAppSidebar expone modo/ancho a las pantallas y un valor inerte fuera del shell', async () => {
        const seen: any[] = [];
        const Probe = () => { seen.push(useAppSidebar()); return null; };
        await act(async () => { root.render(h(Probe)); });
        expect(seen[0]).toMatchObject({ mode: 'full', drawerOpen: false });
        expect(() => seen[0].openDrawer()).not.toThrow();
        seen.length = 0;
        await renderShell(h(Probe));
        expect(seen.at(-1)).toMatchObject({ mode: 'full', width: 256 });
        await setViewport(375);
        expect(seen.at(-1).mode).toBe('drawer');
    });
});

describe('ventanas estrechas', () => {
    it('768-899: riel de 56 px con menu accesible; sin separador; el cajon abre y cierra con Escape', async () => {
        await setViewport(800);
        await renderShell(h(PageA));
        const rail = document.querySelector<HTMLElement>('[data-app-rail]')!;
        expect(rail).not.toBeNull();
        expect(rail.style.width).toBe('56px');
        expect(document.querySelector('[data-sidebar-resizer]')).toBeNull();
        const menu = rail.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
        expect(menu.getAttribute('aria-label')).toBe('emailList.mobile.openMenu');
        await act(async () => { menu.click(); });
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
        await key(document.querySelector('[role="dialog"]') as HTMLElement, 'Escape');
        for (let i = 0; i < 40 && document.querySelector('[role="dialog"]'); i++) await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it('sin scroll horizontal por construccion: el contenedor no desborda y el contenido tiene min-w-0', async () => {
        await renderShell(h(PageA));
        const content = document.querySelector('[data-app-content]')!;
        expect(content.className).toContain('min-w-0');
        expect((content.parentElement as HTMLElement).className).toContain('overflow-hidden');
    });

    it('al volver de un viewport estrecho la barra recupera el ancho elegido', async () => {
        await renderShell(h(PageA));
        await key(sep(), 'ArrowRight', { shiftKey: true });
        await setViewport(500);
        expect(document.querySelector('[data-app-sidebar]')).toBeNull();
        await setViewport(1280);
        expect(widthOf()).toBe(320);
    });
});
