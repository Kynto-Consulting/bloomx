// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Un solo arbol montado segun el viewport: sin ids duplicados, sin doble suscripcion (atajos / escuchas / peticiones).

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
vi.mock('@/components/I18nProvider', () => ({ useI18n: () => ({ t: (k: string) => k }) }));

import { DESKTOP_QUERY, LoadingScreen, MainApp } from '../HomeLayouts';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let matches = true;
const listeners = new Set<() => void>();

function stubMatchMedia() {
    vi.stubGlobal('matchMedia', (q: string) => ({
        get matches() { return q === DESKTOP_QUERY ? matches : false; },
        media: q,
        addEventListener: (_: string, cb: () => void) => listeners.add(cb),
        removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
        addListener: (cb: () => void) => listeners.add(cb),
        removeListener: (cb: () => void) => listeners.delete(cb),
    }));
    (window as any).matchMedia = (globalThis as any).matchMedia;
}
const duplicateIds = () => {
    const seen = new Map<string, number>();
    document.querySelectorAll('[id]').forEach((el) => seen.set(el.id, (seen.get(el.id) ?? 0) + 1));
    return Array.from(seen).filter(([, n]) => n > 1).map(([id]) => id);
};
const setViewport = async (desktop: boolean) => {
    matches = desktop;
    await act(async () => { listeners.forEach((cb) => cb()); });
};

beforeEach(() => {
    Object.assign(mounts, { list: 0, listEver: 0, view: 0, sidebar: 0, unmounts: 0 });
    listeners.clear();
    matches = true;
    stubMatchMedia();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
});
afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
});

describe('Home: un solo arbol montado segun el viewport', () => {
    it('escritorio: lista, lector y barra lateral UNA vez y sin ids duplicados', async () => {
        await act(async () => { root.render(React.createElement(MainApp)); });
        expect(mounts).toMatchObject({ list: 1, view: 1, sidebar: 1, listEver: 1 });
        expect(document.querySelectorAll('[id^="email-row-"]')).toHaveLength(2);
        expect(duplicateIds()).toEqual([]);
    });

    it('movil: solo el arbol movil (lector en lugar de la lista con ?id=), sin ids duplicados', async () => {
        matches = false;
        await act(async () => { root.render(React.createElement(MainApp)); });
        expect(mounts).toMatchObject({ list: 0, view: 1, sidebar: 0 });
        expect(document.querySelector('.md\\:hidden')).not.toBeNull();
        expect(duplicateIds()).toEqual([]);
    });

    it('al cruzar el punto de corte se desmonta uno y se monta el otro (sin quedar suscripciones colgadas)', async () => {
        await act(async () => { root.render(React.createElement(MainApp)); });
        expect(mounts.list).toBe(1);
        await setViewport(false);
        expect(mounts).toMatchObject({ list: 0, view: 1, sidebar: 0 });
        expect(listeners.size).toBe(1); // una sola escucha de matchMedia
        await setViewport(true);
        expect(mounts).toMatchObject({ list: 1, view: 1, sidebar: 1 });
        expect(mounts.listEver).toBe(2);
        expect(duplicateIds()).toEqual([]);
        act(() => root.unmount());
        expect(listeners.size).toBe(0);
        root = createRoot(host);
    });

    it('sin matchMedia (entorno sin navegador) se asume escritorio; el indicador de carga es el mismo del fallback', async () => {
        (window as any).matchMedia = undefined;
        vi.stubGlobal('matchMedia', undefined);
        await act(async () => { root.render(React.createElement(MainApp)); });
        expect(mounts.list).toBe(1);
        act(() => root.render(React.createElement(LoadingScreen)));
        expect(document.querySelector('svg.animate-spin')).not.toBeNull();
        expect(mounts.list).toBe(0);
    });
});
