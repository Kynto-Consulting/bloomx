// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
const nav = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => nav.params, useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { ExtensionsScreen } from '../ExtensionsScreen';
import { I18nProvider } from '@/components/I18nProvider';
import { ConsoleContext } from '@/components/admin/console';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const calls: { url: string; method: string; body: any }[] = [];
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const res = (status: number, body: any) => ({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(JSON.stringify(body)) });

const BLOOMX = { id: 'bloomx', name: 'Bloomx', official: true, verified: true };
const GOOGLE = { id: 'google', name: 'Google', icon: 'brand:google' };
const mk = (id: string, name: string, extra: any = {}, market: any = {}, template: any = {}) => ({
    id, name, description: `${name} descripcion`, version: '1.0.0', authType: null, isPaid: false, price: '0', currency: 'USD',
    template: { permissions: [], mounts: [], ...template },
    market: { publisher: BLOOMX, suite: null, categories: ['other'], tags: [], screenshots: [], installCount: 0, history: [], ...market },
    ...extra,
});
const catalog = () => [
    mk('core-googlelib', 'GoogleLib', {}, { suite: GOOGLE, categories: ['integrations'], installCount: 9, history: [{ version: '1.0.0', status: 'published', date: '2026-09-01', compatible: true, notes: ['Primera version'] }] }, { permissions: ['OAUTH_SHARED:google'] }),
    mk('core-calendar', 'Google Calendar', { version: '2.0.0' }, { suite: GOOGLE, categories: ['calendar'], installCount: 7, tags: ['eventos'], history: [{ version: '2.0.0', status: 'published', date: '2026-09-10', compatible: true, notes: ['Usa GoogleLib', 'Mejor sincronizacion'] }, { version: '1.4.0', status: 'published', date: '2026-05-01', compatible: false, notes: [] }] }, { permissions: ['CALENDAR_READ'], dependencies: { 'core-googlelib': '^1.0.0' } }),
    mk('core-google-meet', 'Google Meet', {}, { suite: GOOGLE, categories: ['calendar'], installCount: 3 }, { permissions: ['NOTIFY'], dependencies: { 'core-googlelib': '^1.0.0' } }),
    mk('core-dlp', 'Prevencion de fugas', {}, { categories: ['mail'], installCount: 12, tags: ['dlp'] }, { permissions: ['READ_EMAIL'] }),
];

let installed: any[] = [];
let starsStored: string[] = [];
let starsStatus = 200;
const inst = (id: string, over: any = {}) => ({ extensionId: id, name: id, description: null, enabled: true, state: 'enabled', installedVersion: '1.0.0', catalogVersion: '1.0.0', isPaid: false, ui: {}, hasCredentials: false, template: null, ...over });

function route(url: string, init: any) {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    const p = new URL(url, 'https://f.test').pathname;
    if (p === '/api/admin/extensions/catalog') return res(200, { extensions: catalog() });
    if (p === '/api/admin/extensions/installed') return res(200, { managerSessionRequired: false, extensions: installed, errorExtensionIds: [], capabilities: { test: false } });
    if (p === '/api/config') return res(200, { config: { id: 'dom1' }, extensions: [] });
    if (p === '/api/admin/extensions/stars') {
        if (method === 'PUT') {
            if (starsStatus !== 200) return res(starsStatus, { error: 'x', code: starsStatus === 409 ? 'star_limit' : 'internal' });
            starsStored = body.starred ? [...starsStored.filter((s) => s !== body.extensionId), body.extensionId] : starsStored.filter((s) => s !== body.extensionId);
            return res(200, { stars: starsStored });
        }
        return res(200, { stars: starsStored });
    }
    if (p === '/api/admin/extensions/install') {
        const c = catalog().find((x) => x.id === body.extensionId)!;
        installed.push(inst(c.id, { name: c.name, installedVersion: c.version, catalogVersion: c.version }));
        return res(200, { success: true });
    }
    if (p === '/api/admin/extensions/toggle') {
        const e = installed.find((i) => i.extensionId === body.extensionId);
        Object.assign(e, { enabled: body.enabled, state: body.enabled ? 'enabled' : 'deactivated' });
        return res(200, { success: true, enabled: body.enabled });
    }
    return res(404, {});
}

const click = async (el: Element | null | undefined) => {
    if (!el) throw new Error('elemento no encontrado');
    await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
};
const setValue = async (el: HTMLInputElement | HTMLSelectElement, value: string) => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    await act(async () => {
        Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
        el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    });
    await flush();
};
const buttonNamed = (name: string) => Array.from(document.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || b.textContent || '').trim() === name) as HTMLButtonElement | undefined;
const cardNames = () => Array.from(document.querySelectorAll('article')).map((a) => a.getAttribute('aria-label'));
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
const posts = (path: string) => calls.filter((c) => c.method === 'POST' && c.url.includes(path));
const tab = (name: string) => Array.from(document.querySelectorAll('[role="tab"]')).find((t) => t.textContent === name) as HTMLElement | undefined;

async function render(locale: 'es' | 'en' = 'es') {
    await act(async () => {
        root.render(
            React.createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } },
                React.createElement(I18nProvider, {
                    locale,
                    children: React.createElement(ConsoleContext.Provider,
                        { value: { me: null, domain: { id: 'dom1', name: 'mail.test', displayName: 'Mail', logo: null }, setDirty: () => undefined, setCrumbTail: () => undefined } },
                        React.createElement(ExtensionsScreen)),
                })),
        );
    });
    await flush();
    await flush();
}

beforeEach(() => {
    calls.length = 0;
    installed = [];
    starsStored = [];
    starsStatus = 200;
    window.history.replaceState(null, '', '/');
    nav.params = new URLSearchParams();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => route(String(url), init)));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

describe('navegacion del marketplace', () => {
    it('aterriza en Descubrir con secciones y una barra lateral accesible; las categorias abren la lista', async () => {
        await render();
        const nav1 = document.querySelector('nav[aria-label="Explorar el marketplace"]')!;
        expect(nav1).not.toBeNull();
        expect(nav1.querySelector('[aria-current="page"]')!.textContent).toContain('Descubrir');
        expect(document.body.textContent).toContain('Destacadas');
        expect(document.body.textContent).toContain('Populares');
        expect(cardNames()).toEqual([]); // Descubrir usa mini-tarjetas, no la lista
        await click(Array.from(nav1.querySelectorAll('button')).find((b) => b.textContent!.startsWith('Calendario'))!);
        expect(cardNames()).toEqual(['Google Calendar', 'Google Meet']);
        expect(window.location.search).toContain('cat=calendar');
        expect(document.querySelector('p[role="status"]')!.textContent).toContain('2 extensión(es) en «Calendario»');
    });

    it('en pantallas estrechas hay un selector de seccion (sustituye a la columna lateral)', async () => {
        await render();
        const select = Array.from(document.querySelectorAll('select')).find((s) => s.previousElementSibling?.textContent === 'Sección')!;
        expect(select).toBeTruthy();
        await setValue(select, 'installed');
        expect(document.body.textContent).toContain('Todavía no hay extensiones instaladas');
    });

    it('URLs profundas: ?suite=, ?publisher= y ?cat= abren su vista', async () => {
        nav.params = new URLSearchParams('suite=google');
        await render();
        expect(cardNames()!.sort()).toEqual(['Google Calendar', 'Google Meet', 'GoogleLib']);
        expect(document.body.textContent).toContain('0 de 3 instaladas');
        expect(buttonNamed('Instalar la suite')).toBeTruthy();
    });

    it('?publisher=bloomx muestra la pagina del editor con la insignia Oficial', async () => {
        nav.params = new URLSearchParams('publisher=bloomx');
        await render();
        const header = document.querySelector('header h3')!;
        expect(header.textContent).toContain('Bloomx');
        expect(header.textContent).toContain('Oficial');
        expect(cardNames()).toHaveLength(4);
    });

    it('Comunidad esta vacia con un texto explicativo y Del proveedor muestra las oficiales', async () => {
        nav.params = new URLSearchParams('sec=community');
        await render();
        expect(document.body.textContent).toContain('Aún no hay extensiones de la comunidad');
        await click(buttonNamed('Del proveedor') ?? Array.from(document.querySelectorAll('nav button')).find((b) => b.textContent!.startsWith('Del proveedor')) as HTMLElement);
        expect(cardNames()).toHaveLength(4);
        expect(document.body.textContent).toContain('Publicadas y mantenidas por la plataforma');
    });

    it('«/» enfoca la busqueda salvo que ya se este escribiendo', async () => {
        await render();
        const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
        await act(async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true })); });
        expect(document.activeElement).toBe(search);
    });

    it('buscar desde Descubrir lleva a la lista, filtra por etiqueta y editor y escribe ?q= en la URL', async () => {
        await render();
        await setValue(document.querySelector<HTMLInputElement>('input[type="search"]')!, 'dlp');
        expect(cardNames()).toEqual(['Prevencion de fugas']);
        expect(window.location.search).toContain('q=dlp');
        expect(document.querySelector('p[role="status"]')!.getAttribute('aria-live')).toBe('polite');
    });

    it('en ingles', async () => {
        await render('en');
        expect(document.querySelector('nav[aria-label="Browse the marketplace"]')).not.toBeNull();
        expect(document.body.textContent).toContain('Featured');
    });
});

describe('favoritas (optimistas, por administrador)', () => {
    it('marcar la estrella es inmediato, se guarda con PUT y aparece en Favoritas', async () => {
        nav.params = new URLSearchParams('sec=categories');
        await render();
        await click(buttonNamed('Marcar GoogleLib como favorita'));
        expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ extensionId: 'core-googlelib', starred: true });
        expect(buttonNamed('Quitar GoogleLib de favoritas')!.getAttribute('aria-pressed')).toBe('true');
        expect(document.body.textContent).toContain('GoogleLib añadida a favoritas');
        // las favoritas van primero
        expect(cardNames()![0]).toBe('GoogleLib');
        await click(Array.from(document.querySelectorAll('nav button')).find((b) => b.textContent!.startsWith('Favoritas')) as HTMLElement);
        expect(cardNames()).toEqual(['GoogleLib']);
    });

    it('si el servidor falla, la estrella vuelve atras y se avisa', async () => {
        nav.params = new URLSearchParams('sec=categories');
        starsStatus = 500;
        await render();
        await click(buttonNamed('Marcar GoogleLib como favorita'));
        expect(buttonNamed('Marcar GoogleLib como favorita')!.getAttribute('aria-pressed')).toBe('false');
        expect(document.body.textContent).toContain('No se pudo guardar la favorita');
    });

    it('las estrellas ya guardadas se cargan del servidor', async () => {
        starsStored = ['core-dlp'];
        nav.params = new URLSearchParams('sec=starred');
        await render();
        expect(cardNames()).toEqual(['Prevencion de fugas']);
    });
});

describe('Instalar la suite', () => {
    it('muestra orden, permisos y la aprobacion explicita ANTES de instalar; instala en orden con las acciones de siempre', async () => {
        nav.params = new URLSearchParams('suite=google');
        await render();
        await click(buttonNamed('Instalar la suite'));
        const d = dialog()!;
        expect(d.textContent).toContain('Instalar la suite Google');
        const steps = Array.from(d.querySelectorAll('[data-testid="suite-steps"] li')).map((li) => li.textContent!.split('(')[0].trim());
        expect(steps).toEqual(['GoogleLib', 'Google Calendar', 'Google Meet']);
        expect(d.querySelector('[data-testid="permission-list"]')!.textContent).toContain('OAUTH_SHARED:google');
        expect(posts('/install')).toHaveLength(0);
        const confirm = Array.from(d.querySelectorAll('button')).find((b) => b.textContent === 'Instalar 3') as HTMLButtonElement;
        expect(confirm.disabled).toBe(true); // OAUTH_SHARED exige aprobacion explicita
        await click(d.querySelector('input[type="checkbox"]'));
        expect(confirm.disabled).toBe(false);
        await click(confirm);
        expect(posts('/extensions/install').map((c) => c.body.extensionId)).toEqual(['core-googlelib', 'core-calendar', 'core-google-meet']);
        expect(posts('/extensions/install')[0].body.approvePublicRoutes).toBe(true);
        expect(dialog()).toBeNull();
        expect(document.body.textContent).toContain('Suite Google instalada: 3 extensiones.');
        expect(document.body.textContent).toContain('3 de 3 instaladas');
    });

    it('cancelar no instala nada', async () => {
        nav.params = new URLSearchParams('suite=google');
        await render();
        await click(buttonNamed('Instalar la suite'));
        await click(buttonNamed('Cancelar'));
        expect(dialog()).toBeNull();
        expect(posts('/install')).toHaveLength(0);
    });
});

describe('ficha de extension', () => {
    const open = async (name: string) => click(buttonNamed(`Detalles de ${name}`));

    it('cabecera con editor y suite, y pestanas Versiones, Dependencias e Informacion', async () => {
        nav.params = new URLSearchParams('sec=categories');
        await render();
        await open('Google Calendar');
        const d = dialog()!;
        const header = d.querySelector('[data-testid="market-header"]')!;
        expect(header.textContent).toContain('de Bloomx');
        expect(header.textContent).toContain('Oficial');
        expect(header.textContent).toContain('Google');
        expect(header.textContent).toContain('7 instalaciones');
        expect(header.textContent).toContain('Se instalará con GoogleLib');
        expect(window.location.search).toContain('ext=core-calendar');

        await click(tab('Versiones'));
        const versions = Array.from(d.querySelectorAll('[data-testid="version-history"] > li')).map((li) => li.textContent!);
        expect(versions).toHaveLength(2);
        expect(versions[0]).toContain('v2.0.0');
        expect(versions[0]).toContain('Mejor sincronizacion');
        expect(versions[1]).toContain('Requiere un cliente más nuevo');

        await click(tab('Dependencias'));
        expect(d.querySelector('[data-testid="dependency-tree"]')!.textContent).toContain('GoogleLib');
        expect(d.querySelector('[data-testid="dependency-tree"]')!.textContent).toContain('No instalada');

        await click(tab('Información'));
        expect(d.textContent).toContain('core-calendar');
        expect(d.textContent).toContain('Suite');
    });

    it('«Otras de esta suite» abre la ficha de la vecina', async () => {
        nav.params = new URLSearchParams('sec=categories');
        await render();
        await open('Google Calendar');
        const d = dialog()!;
        expect(d.textContent).toContain('Otras de esta suite');
        await click(Array.from(d.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Detalles de GoogleLib')!);
        expect(window.location.search).toContain('ext=core-googlelib');
        expect(dialog()!.textContent).toContain('GoogleLib');
    });

    it('?ext= abre la ficha directamente y el boton del editor lleva a su pagina', async () => {
        nav.params = new URLSearchParams('sec=categories&ext=core-dlp');
        await render();
        expect(dialog()!.textContent).toContain('Prevencion de fugas');
        await click(Array.from(dialog()!.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Ver el editor Bloomx')!);
        await act(async () => { await new Promise((r) => setTimeout(r, 700)); }); // salida animada del panel
        expect(window.location.search).toContain('publisher=bloomx');
        expect(document.querySelector('header h3')!.textContent).toContain('Oficial');
    });
});
