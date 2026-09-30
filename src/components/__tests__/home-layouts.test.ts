// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Un solo arbol montado segun el modo del shell (barra fija / riel / movil): sin ids duplicados, sin doble suscripcion
// (atajos / escuchas / peticiones) y con la barra lateral compartida por todas las pantallas.

const mounts = vi.hoisted(() => ({ list: 0, listEver: 0, view: 0, sidebar: 0, unmounts: 0 }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('id=e1'), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('react-resizable-panels', async () => {
    const R = await import('react');
    const Pass = ({ children }: { children?: React.ReactNode }) => R.createElement('div', null, children);
    return { Group: Pass, Panel: Pass, Separator: () => null };
});
vi.mock('@/components/Sidebar', async () => {
    const R = await import('react');
    return { Sidebar: () => { R.useEffect(() => { mounts.sidebar++; return () => { mounts.sidebar--; }; }, []); return R.createElement('nav', { id: 'sidebar-nav' }); } };
});
vi.mock('@/components/EmailList', async () => {
    const R = await import('react');
    return {
        EmailList: () => {
            R.useEffect(() => { mounts.list++; mounts.listEver++; return () => { mounts.list--; mounts.unmounts++; }; }, []);
            return R.createElement('div', null, R.createElement('div', { id: 'email-row-e1' }), R.createElement('div', { id: 'email-row-e2' }));
        },
    };
});
vi.mock('@/components/MailView', async () => {
    const R = await import('react');
    return { MailView: () => { R.useEffect(() => { mounts.view++; return () => { mounts.view--; }; }, []); return R.createElement('article', { id: 'mail-view' }); } };
});
vi.mock('@/components/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('@/contexts/ComposeContext', () => ({ useCompose: () => ({ openCompose: vi.fn() }) }));
vi.mock('@/components/I18nProvider', () => ({ useI18n: () => ({ t: (k: string) => k, locale: 'es' }) }));

import { LIST_PANEL, LoadingScreen, MainApp, READER_PANEL } from '../HomeLayouts';
import { AppShell } from '../layout/AppShell';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const duplicateIds = () => {
    const seen = new Map<string, number>();
    document.querySelectorAll('[id]').forEach((el) => seen.set(el.id, (seen.get(el.id) ?? 0) + 1));
    return Array.from(seen).filter(([, n]) => n > 1).map(([id]) => id);
};
const setWidth = async (w: number) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
    await act(async () => { window.dispatchEvent(new Event('resize')); });
};
const app = () => React.createElement(AppShell, null, React.createElement(MainApp));
const mountApp = async (w: number) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
    await act(async () => { root.render(app()); });
};

beforeEach(() => {
    Object.assign(mounts, { list: 0, listEver: 0, view: 0, sidebar: 0, unmounts: 0 });
    window.localStorage.clear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
});
afterEach(() => {
    act(() => root.unmount());
    host.remove();
});

describe('Home: un solo arbol montado segun el modo del shell', () => {
    it('escritorio: barra, lista y lector UNA vez y sin ids duplicados', async () => {
        await mountApp(1280);
        expect(mounts).toMatchObject({ list: 1, view: 1, sidebar: 1, listEver: 1 });
        expect(document.querySelector('[data-app-sidebar]')).not.toBeNull();
        expect(document.querySelectorAll('[id^="email-row-"]')).toHaveLength(2);
        expect(duplicateIds()).toEqual([]);
    });

    it('movil: sin barra fija; el lector sustituye a la lista y el menu abre la barra en un cajon (una sola vez)', async () => {
        await mountApp(375);
        expect(mounts).toMatchObject({ list: 0, view: 1, sidebar: 0 });
        expect(document.querySelector('[data-app-sidebar]')).toBeNull();
        const menu = document.querySelector<HTMLButtonElement>('button[aria-label="emailList.mobile.openMenu"]')!;
        await act(async () => { menu.click(); });
        expect(mounts.sidebar).toBe(1);
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
        expect(duplicateIds()).toEqual([]);
    });

    it('riel (768-899 px): riel de iconos, lista y lector; la barra completa solo existe dentro del cajon', async () => {
        await mountApp(800);
        expect(document.querySelector('[data-app-rail]')).not.toBeNull();
        expect(document.querySelector('[data-app-sidebar]')).toBeNull();
        expect(mounts).toMatchObject({ list: 1, view: 1, sidebar: 0 });
        const open = document.querySelector<HTMLButtonElement>('[data-app-rail] button[aria-haspopup="dialog"]')!;
        await act(async () => { open.click(); });
        expect(mounts.sidebar).toBe(1);
        expect(open.getAttribute('aria-expanded')).toBe('true');
    });

    it('al cruzar los puntos de corte se monta lo que toca y no queda nada colgado', async () => {
        await mountApp(1280);
        expect(mounts.list).toBe(1);
        await setWidth(375);
        expect(mounts).toMatchObject({ list: 0, view: 1, sidebar: 0 });
        await setWidth(800);
        expect(mounts).toMatchObject({ list: 1, view: 1, sidebar: 0 });
        await setWidth(1280);
        expect(mounts).toMatchObject({ list: 1, view: 1, sidebar: 1 });
        expect(duplicateIds()).toEqual([]);
        act(() => root.unmount());
        expect(mounts).toMatchObject({ list: 0, view: 0, sidebar: 0 });
        root = createRoot(host);
    });

    it('el indicador de carga es el mismo del fallback de Suspense', async () => {
        await act(async () => { root.render(React.createElement(LoadingScreen)); });
        expect(document.querySelector('svg.animate-spin')).not.toBeNull();
    });
});

describe('Tamanos de los paneles: explicitos (en v4 un numero son PIXELES)', () => {
    it('porcentajes como texto y minimos en px: nunca numeros sueltos', () => {
        for (const p of [LIST_PANEL, READER_PANEL]) {
            expect(p.defaultSize).toMatch(/^\d+%$/);
            expect(p.minSize).toMatch(/^\d+px$/);
        }
        expect(parseInt(LIST_PANEL.defaultSize) + parseInt(READER_PANEL.defaultSize)).toBe(100);
        // 900 (borde del modo fijo) - 208 (barra minima) = 692 px para lista + lector: los minimos deben caber.
        expect(parseInt(LIST_PANEL.minSize) + parseInt(READER_PANEL.minSize)).toBeLessThanOrEqual(900 - 208);
    });
});
