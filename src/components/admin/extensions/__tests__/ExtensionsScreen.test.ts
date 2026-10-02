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
const fetchMock = vi.fn();
const calls: { url: string; method: string; body: any }[] = [];

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const res = (status: number, body: any) => ({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(JSON.stringify(body)) });

// ---- datos ----
const catalog = () => [
    {
        id: 'notion', name: 'Notion', description: 'Sincroniza páginas', version: '1.3.0', authType: 'API_KEY', isPaid: false, price: '0', currency: 'USD',
        template: {
            permissions: ['ENV_READ:NOTION_API_KEY', 'READ_EMAIL', 'NOTIFY'], auth: { type: 'API_KEY' }, category: 'productivity',
            mounts: [{ point: 'SETTINGS_PANEL' }, { point: 'EMAIL_TOOLBAR' }],
            api: { functions: { testConnection: {}, sync: {} } }, testConnection: true,
            settingsFields: [{ name: 'apiBase', type: 'INPUT', label: 'Base URL', defaultValue: 'https://x' }],
        },
    },
    { id: 'giphy', name: 'Giphy', description: 'GIFs en el editor', version: '2.0.0', authType: null, isPaid: false, price: '0', currency: 'USD', template: { permissions: ['HTTP_REQUEST'], mounts: [{ point: 'COMPOSER_TOOLBAR' }], api: { functions: { search: {} } } } },
    { id: 'pro', name: 'Pro IA', description: 'Asistente de pago', version: '1.0.0', authType: null, isPaid: true, price: '5', currency: 'USD', template: { permissions: ['AI_GENERATE'] } },
    { id: 'cal', name: 'Agenda', description: 'Calendario extra', version: '1.0.0', authType: null, isPaid: false, price: '0', currency: 'USD', template: { permissions: ['CALENDAR_READ', 'READ_USER'] } },
];

interface State {
    installed: any[];
    managerSessionRequired: boolean;
    capabilities: { test: boolean; testReason?: string };
    errorExtensionIds: string[];
    catalogStatus: number;
    configExtensions: any[];
    testResult: { status: number; body: any };
    mandatoryStatus: number;
}
let state: State;
const inst = (over: any) => ({ description: null, enabled: true, state: 'enabled', installedVersion: '1.0.0', catalogVersion: '1.0.0', isPaid: false, ui: {}, hasCredentials: false, template: null, ...over });

const freshState = (): State => ({
    installed: [
        inst({ extensionId: 'notion', name: 'Notion', installedVersion: '1.2.0', catalogVersion: '1.3.0', hasCredentials: true, ui: { order: 0 }, template: catalog()[0].template }),
        inst({ extensionId: 'giphy', name: 'Giphy', enabled: false, state: 'deactivated', installedVersion: '2.0.0', catalogVersion: '2.0.0', ui: { order: 10 }, template: catalog()[1].template }),
    ],
    managerSessionRequired: false,
    capabilities: { test: true },
    errorExtensionIds: [],
    catalogStatus: 200,
    configExtensions: [],
    testResult: { status: 200, body: { ok: true } },
    mandatoryStatus: 200,
});

function route(url: string, init: any) {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    const u = new URL(url, 'https://f.test');
    const p = u.pathname;
    if (p === '/api/admin/extensions/catalog') return state.catalogStatus === 200 ? res(200, { extensions: catalog() }) : res(state.catalogStatus, { error: 'x', code: 'backend_unavailable' });
    if (p === '/api/admin/extensions/installed')
        return res(200, { managerSessionRequired: state.managerSessionRequired, extensions: state.managerSessionRequired ? [] : state.installed, errorExtensionIds: state.errorExtensionIds, capabilities: state.capabilities });
    if (p === '/api/config') return res(200, { config: { id: 'dom1' }, extensions: state.configExtensions });
    if (p.endsWith('/status')) return res(200, { extensionId: 'x', lastEvent: null, lastError: null, errors24h: 0, entries: [] });
    if (p === '/api/admin/extensions/install') {
        const c = catalog().find((x) => x.id === body.extensionId)!;
        const existing = state.installed.find((i) => i.extensionId === body.extensionId);
        if (existing) Object.assign(existing, { installedVersion: c.version, enabled: true, state: 'enabled' });
        else state.installed.push(inst({ extensionId: c.id, name: c.name, installedVersion: c.version, catalogVersion: c.version, template: c.template }));
        return res(200, { success: true });
    }
    if (p === '/api/admin/extensions/update') {
        const c = catalog().find((x) => x.id === body.extensionId)!;
        const existing = state.installed.find((i) => i.extensionId === body.extensionId)!;
        Object.assign(existing, { installedVersion: c.version });
        return res(200, { success: true, updated: true, from: '1.2.0', to: c.version });
    }
    if (p === '/api/admin/extensions/uninstall') {
        state.installed = state.installed.filter((i) => i.extensionId !== body.extensionId);
        return res(200, { success: true });
    }
    if (p === '/api/admin/extensions/toggle') {
        const e = state.installed.find((i) => i.extensionId === body.extensionId);
        Object.assign(e, { enabled: body.enabled, state: body.enabled ? 'enabled' : 'deactivated' });
        return res(200, { success: true, enabled: body.enabled });
    }
    if (p === '/api/admin/extensions/mandatory') {
        if (state.mandatoryStatus !== 200) return res(state.mandatoryStatus, { error: 'x', code: 'EXTENSION_NOT_ENABLED' });
        const e = state.installed.find((i) => i.extensionId === body.extensionId);
        e.mandatory = body.mandatory;
        return res(200, { success: true, mandatory: body.mandatory, effective: body.mandatory || e.mandatoryByManifest === true });
    }
    if (p === '/api/admin/extensions/order') {
        for (const it of body.items) state.installed.find((i) => i.extensionId === it.extensionId).ui = { order: it.order };
        return res(200, { success: true, updated: body.items.length });
    }
    if (p === '/api/admin/extensions/test') return res(state.testResult.status, state.testResult.body);
    if (p === '/api/admin/extensions/settings') return res(200, { keys: [{ name: 'NOTION_API_KEY', configured: true, source: 'domain', movable: false }] });
    if (p === '/api/admin/billing/orders') return res(201, { kind: 'order', id: 'ord1', approveUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=T1', amountCents: 500, currency: 'USD' });
    return res(404, {});
}

// ---- utilidades de DOM ----
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
const key = async (el: Element, k: string) => {
    await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });
    await flush();
};
const buttonNamed = (name: string) =>
    Array.from(document.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || b.textContent || '').trim() === name) as HTMLButtonElement | undefined;
const cardNames = () => Array.from(document.querySelectorAll('article')).map((a) => a.getAttribute('aria-label'));
const card = (name: string) => document.querySelector(`article[aria-label="${name}"]`) as HTMLElement;
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
const live = () => Array.from(document.querySelectorAll('[role="status"]')).map((n) => n.textContent).join('|');
const posts = (path: string) => calls.filter((c) => c.method === 'POST' && c.url.includes(path));

async function render(locale: 'es' | 'en' = 'es') {
    await act(async () => {
        root.render(
            React.createElement(
                SWRConfig,
                { value: { provider: () => new Map(), dedupingInterval: 0 } },
                React.createElement(
                    I18nProvider,
                    {
                        locale,
                        children: React.createElement(
                            ConsoleContext.Provider,
                            { value: { me: null, domain: { id: 'dom1', name: 'mail.test', displayName: 'Mail', logo: null }, setDirty: () => undefined, setCrumbTail: () => undefined } },
                            React.createElement(ExtensionsScreen),
                        ),
                    },
                ),
            ),
        );
    });
    await flush();
    await flush();
}

beforeEach(() => {
    calls.length = 0;
    state = freshState();
    window.history.replaceState(null, '', '/');
    nav.params = new URLSearchParams('sec=categories');
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init: any) => route(String(url), init));
    vi.stubGlobal('fetch', fetchMock);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

describe('catalogo: busqueda y filtros', () => {
    it('muestra tarjetas con nombre, version, estado y precio, y el resumen', async () => {
        await render();
        // Orden por defecto del marketplace: relevancia (sin consulta: populares y luego nombre) => alfabetico mientras no haya datos de uso.
        expect(cardNames()).toEqual(['Agenda', 'Giphy', 'Notion', 'Pro IA']);
        const notion = card('Notion');
        expect(notion.textContent).toContain('v1.2.0 → v1.3.0 disponible');
        expect(notion.textContent).toContain('Activada');
        expect(notion.textContent).toContain('Gratis');
        expect(notion.textContent).toContain('Credenciales configuradas');
        expect(card('Giphy').textContent).toContain('Desactivada');
        expect(card('Pro IA').textContent).toContain('5 USD');
        expect(card('Pro IA').textContent).toContain('De pago');
        expect(card('Agenda').textContent).toContain('Disponible');
        const summary = document.querySelector('section[aria-label="Resumen de extensiones"]')!;
        expect(summary.textContent).toMatch(/Instaladas\s*2/);
        expect(summary.textContent).toMatch(/Con actualización\s*1/);
    });

    it('la busqueda filtra por nombre/descripcion (sin acentos) y se puede limpiar', async () => {
        await render();
        const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
        expect(search.getAttribute('aria-label')).toBe('Buscar extensiones');
        await setValue(search, 'paginas');
        expect(cardNames()).toEqual(['Notion']);
        await setValue(search, 'zzz');
        expect(cardNames()).toEqual([]);
        expect(document.body.textContent).toContain('Ninguna extensión coincide');
        await click(buttonNamed('Quitar filtros'));
        expect(cardNames()).toHaveLength(4);
    });

    it('filtros de categoria y de estado', async () => {
        await render();
        const selects = Array.from(document.querySelectorAll('select'));
        const category = selects.find((s) => s.previousElementSibling?.textContent === 'Categoría')!;
        const status = selects.find((s) => s.previousElementSibling?.textContent === 'Estado')!;
        await setValue(category, 'calendar');
        expect(cardNames()).toEqual(['Agenda']);
        await setValue(category, 'all');
        await setValue(status, 'disabled');
        expect(cardNames()).toEqual(['Giphy']);
        await setValue(status, 'available');
        expect(cardNames()).toEqual(['Agenda', 'Pro IA']);
        await setValue(status, 'paid');
        expect(cardNames()).toEqual(['Pro IA']);
        await setValue(status, 'errors');
        expect(cardNames()).toEqual([]);
    });

    it('el filtro "con errores" usa los errores de auditoria de 24 h', async () => {
        state.errorExtensionIds = ['giphy'];
        await render();
        expect(card('Giphy').textContent).toContain('Con errores');
        const status = Array.from(document.querySelectorAll('select')).find((s) => s.previousElementSibling?.textContent === 'Estado')!;
        await setValue(status, 'errors');
        expect(cardNames()).toEqual(['Giphy']);
    });

    it('error del catalogo => ErrorState con Reintentar que vuelve a pedirlo', async () => {
        state.catalogStatus = 502;
        await render();
        const alert = document.querySelector('[role="alert"]')!;
        expect(alert.textContent).toContain('No se pudo cargar el catálogo');
        state.catalogStatus = 200;
        await click(buttonNamed('Reintentar'));
        await flush();
        expect(cardNames()).toHaveLength(4);
    });

    it('en ingles', async () => {
        await render('en');
        expect(document.querySelector('h1')!.textContent).toBe('Extensions');
        expect(card('Notion').textContent).toContain('v1.2.0 → v1.3.0 available');
    });
});

describe('instalar, desinstalar, activar, actualizar (siempre con confirmacion)', () => {
    it('instalar pide confirmacion con los permisos y solo entonces llama a la API', async () => {
        await render();
        await click(buttonNamed('Instalar Agenda'));
        const d = dialog()!;
        expect(d.getAttribute('aria-modal')).toBe('true');
        expect(d.textContent).toContain('Instalar Agenda');
        expect(d.querySelector('[data-testid="permission-list"]')!.textContent).toContain('CALENDAR_READ');
        expect(posts('/install')).toHaveLength(0);

        await click(buttonNamed('Cancelar'));
        expect(dialog()).toBeNull();
        expect(posts('/install')).toHaveLength(0);

        await click(buttonNamed('Instalar Agenda'));
        await click(Array.from(dialog()!.querySelectorAll('button')).find((b) => b.textContent === 'Instalar')!);
        expect(posts('/extensions/install')).toHaveLength(1);
        expect(posts('/extensions/install')[0].body).toEqual({ domainId: 'dom1', extensionId: 'cal' });
        expect(dialog()).toBeNull();
        expect(live()).toContain('Agenda instalada.');
        expect(card('Agenda').textContent).toContain('Activada');
    });

    it('Escape cierra el dialogo sin instalar', async () => {
        await render();
        await click(buttonNamed('Instalar Agenda'));
        await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        await flush();
        expect(dialog()).toBeNull();
        expect(posts('/extensions/install')).toHaveLength(0);
    });

    it('desinstalar avisa de que se borran credenciales y tokens OAuth, y solo entonces llama', async () => {
        await render();
        await click(buttonNamed('Desinstalar Notion'));
        const d = dialog()!;
        expect(d.textContent).toContain('Las credenciales que configuraste');
        expect(d.textContent).toContain('tokens OAuth');
        expect(d.textContent).toContain('Desactivar');
        expect(posts('/uninstall')).toHaveLength(0);
        await click(Array.from(d.querySelectorAll('button')).find((b) => b.textContent === 'Desinstalar')!);
        expect(posts('/uninstall')[0].body).toEqual({ domainId: 'dom1', extensionId: 'notion' });
        expect(live()).toContain('Notion desinstalada');
        expect(card('Notion').textContent).toContain('Disponible');
    });

    it('desactivar pide confirmacion (no borra nada) y activar es directo', async () => {
        await render();
        await click(buttonNamed('Desactivar Notion'));
        expect(dialog()!.textContent).toContain('se conservan sus credenciales');
        await click(Array.from(dialog()!.querySelectorAll('button')).find((b) => b.textContent === 'Desactivar')!);
        expect(posts('/toggle')[0].body).toEqual({ domainId: 'dom1', extensionId: 'notion', enabled: false });
        expect(card('Notion').textContent).toContain('Desactivada');
        expect(live()).toContain('Notion desactivada');

        await click(buttonNamed('Activar Giphy'));
        expect(dialog()).toBeNull();
        expect(posts('/toggle')[1].body).toEqual({ domainId: 'dom1', extensionId: 'giphy', enabled: true });
        expect(card('Giphy').textContent).toContain('Activada');
    });

    it('actualizar: muestra v1.2.0 -> v1.3.0, confirma y llama a la ruta update (no reinstala); despues queda al dia', async () => {
        await render();
        await click(buttonNamed('Actualizar Notion'));
        expect(dialog()!.textContent).toContain('de la v1.2.0 a la v1.3.0');
        await click(Array.from(dialog()!.querySelectorAll('button')).find((b) => b.textContent === 'Actualizar')!);
        expect(posts('/extensions/update')[0].body).toEqual({ domainId: 'dom1', extensionId: 'notion' });
        expect(posts('/extensions/install')).toHaveLength(0);
        expect(live()).toContain('Notion actualizada a la versión 1.3.0');
        expect(card('Notion').textContent).not.toContain('disponible');
        expect(buttonNamed('Actualizar Notion')).toBeUndefined();
    });

    it('extension de pago: orden por el proxy de facturacion y redireccion a PayPal (sin llamar a install)', async () => {
        await render();
        await click(buttonNamed('Instalar Pro IA'.replace('Instalar', 'Instalar')));
        const d = dialog()!;
        expect(d.textContent).toContain('Comprar e instalar Pro IA');
        expect(d.textContent).toContain('5 USD');
        await click(Array.from(d.querySelectorAll('button')).find((b) => b.textContent === 'Continuar al pago')!);
        const pay = calls.find((c) => c.url.includes('/api/admin/billing/orders'))!;
        expect(pay.body).toEqual({ extensionId: 'pro' });
        expect(posts('/extensions/install')).toHaveLength(0);
    });

    it('errores de la API se muestran en el dialogo (PAYMENT_REQUIRED) sin cerrarlo', async () => {
        fetchMock.mockImplementation(async (url: string, init: any) =>
            new URL(String(url), 'https://f.test').pathname === '/api/admin/extensions/install' ? res(402, { error: 'x', code: 'PAYMENT_REQUIRED' }) : route(String(url), init));
        await render();
        await click(buttonNamed('Instalar Agenda'));
        await click(Array.from(dialog()!.querySelectorAll('button')).find((b) => b.textContent === 'Instalar')!);
        expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain('de pago');
    });
});

describe('detalle con pestanas', () => {
    const open = async (name: string) => click(buttonNamed(`Detalles de ${name}`));
    const tab = (name: string) => Array.from(document.querySelectorAll('[role="tab"]')).find((t) => t.textContent === name) as HTMLElement | undefined;

    it('abre un panel accesible con Resumen, y cambia de pestana con clic y con flechas', async () => {
        await render();
        await open('Notion');
        const d = dialog()!;
        expect(d.textContent).toContain('Notion');
        expect(d.querySelector('[role="tablist"]')).not.toBeNull();
        expect(tab('Resumen')!.getAttribute('aria-selected')).toBe('true');
        expect(d.querySelector('[role="tabpanel"]')!.textContent).toContain('v1.3.0');
        expect(d.querySelector('[role="tabpanel"]')!.textContent).toContain('v1.2.0 → v1.3.0 disponible');

        await click(tab('Permisos'));
        expect(tab('Permisos')!.getAttribute('aria-selected')).toBe('true');
        expect(tab('Resumen')!.getAttribute('tabindex')).toBe('-1');

        await key(tab('Permisos')!, 'ArrowRight');
        expect(tab('Versiones')!.getAttribute('aria-selected')).toBe('true');
        await key(tab('Versiones')!, 'End');
        expect(tab('Estado y registro')!.getAttribute('aria-selected')).toBe('true');
        await key(tab('Estado y registro')!, 'Home');
        expect(tab('Resumen')!.getAttribute('aria-selected')).toBe('true');
        expect(document.activeElement).toBe(tab('Resumen'));
    });

    it('Permisos: lista legible con riesgo (texto), autenticacion, donde aparece (traducido) y funciones', async () => {
        await render();
        await open('Notion');
        await click(tab('Permisos'));
        const panel = dialog()!.querySelector('[role="tabpanel"]')!;
        const list = panel.querySelector('[data-testid="permission-list"]')!;
        const items = Array.from(list.querySelectorAll('li')).map((li) => li.textContent!);
        expect(items[0]).toContain('Riesgo alto');
        expect(items.some((t) => t.includes('READ_EMAIL') && t.includes('Riesgo alto'))).toBe(true);
        expect(items.some((t) => t.includes('NOTIFY') && t.includes('Riesgo bajo'))).toBe(true);
        expect(panel.textContent).toContain('API_KEY');
        expect(panel.textContent).toContain('Panel de ajustes');
        expect(panel.textContent).toContain('Barra de herramientas del correo');
        expect(panel.textContent).toContain('testConnection');
        expect(panel.textContent).toContain('sync');
    });

    it('Credenciales: solo si declara ENV_READ; abre ExtensionCredentialsModal con el dominio', async () => {
        await render();
        await open('Giphy');
        expect(tab('Credenciales')).toBeUndefined();
        await click(buttonNamed('Cerrar'));
        await open('Notion');
        await click(tab('Credenciales'));
        expect(dialog()!.textContent).toContain('NOTION_API_KEY');
        expect(dialog()!.textContent).toContain('Hay credenciales guardadas');
        await click(buttonNamed('Configurar credenciales'));
        const settingsGet = calls.find((c) => c.url.includes('/api/admin/extensions/settings?'))!;
        expect(settingsGet.url).toContain('domainId=dom1');
        expect(settingsGet.url).toContain('extensionId=notion');
    });

    it('Ajustes: resumen de solo lectura del esquema del SETTINGS_PANEL', async () => {
        await render();
        await open('Notion');
        await click(tab('Ajustes'));
        const panel = dialog()!.querySelector('[role="tabpanel"]')!;
        expect(panel.textContent).toContain('apiBase');
        expect(panel.textContent).toContain('Base URL');
        expect(panel.textContent).toContain('https://x');
        expect(panel.textContent).toContain('Cada usuario edita sus propios valores');
        expect(panel.querySelector('input')).toBeNull();
        await click(buttonNamed('Cerrar'));
        await open('Giphy');
        await click(tab('Ajustes'));
        expect(dialog()!.textContent).toContain('no declara un panel de ajustes');
    });

    it('Estado: "sin registros" cuando no hay auditoria', async () => {
        await render();
        await open('Giphy');
        await click(tab('Estado y registro'));
        expect(dialog()!.textContent).toContain('Sin registros');
        expect(dialog()!.textContent).toContain('Sin errores registrados');
    });

    it('?open=<id> (busqueda global) abre el detalle', async () => {
        nav.params = new URLSearchParams('sec=categories&open=giphy');
        await render();
        expect(dialog()!.textContent).toContain('Giphy');
    });
});

describe('boton Probar (testConnection)', () => {
    const tab = (name: string) => Array.from(document.querySelectorAll('[role="tab"]')).find((t) => t.textContent === name) as HTMLElement;

    it('solo aparece si el manifest declara la funcion; con soporte ejecuta y muestra el resultado', async () => {
        await render();
        await click(buttonNamed('Detalles de Giphy'));
        await click(tab('Estado y registro'));
        expect(buttonNamed('Probar conexión')).toBeUndefined();
        expect(dialog()!.textContent).not.toContain('Prueba de conexión');
        await click(buttonNamed('Cerrar'));

        await click(buttonNamed('Detalles de Notion'));
        await click(tab('Estado y registro'));
        expect(dialog()!.textContent).toContain('Prueba de conexión');
        await click(buttonNamed('Probar conexión'));
        expect(posts('/extensions/test')[0].body).toEqual({ extensionId: 'notion' });
        expect(dialog()!.textContent).toContain('La prueba terminó correctamente.');
    });

    it('fallo: mensaje traducido desde un codigo estable', async () => {
        state.testResult = { status: 200, body: { ok: false, message: 'auth_required' } };
        await render();
        await click(buttonNamed('Detalles de Notion'));
        await click(tab('Estado y registro'));
        await click(buttonNamed('Probar conexión'));
        expect(dialog()!.textContent).toContain('hace falta conectar o autorizar la cuenta');
    });

    it('sin soporte (sesion de gestor): el boton no se ofrece y se explica por que', async () => {
        state.capabilities = { test: false, testReason: 'user_context_required' };
        await render();
        await click(buttonNamed('Detalles de Notion'));
        await click(tab('Estado y registro'));
        expect(buttonNamed('Probar conexión')).toBeUndefined();
        expect(dialog()!.textContent).toContain('No disponible con sesión de gestor');
    });

    it('un 501 del servidor se muestra como no soportado', async () => {
        state.testResult = { status: 501, body: { error: 'Not supported', code: 'not_supported' } };
        await render();
        await click(buttonNamed('Detalles de Notion'));
        await click(tab('Estado y registro'));
        await click(buttonNamed('Probar conexión'));
        expect(dialog()!.textContent).toContain('No se puede ejecutar la prueba de forma segura');
    });
});

describe('orden con teclado', () => {
    it('lista instaladas por orden; Bajar/Subir guardan el orden normalizado y anuncian el cambio', async () => {
        await render();
        const items = () => Array.from(document.querySelectorAll('ol[aria-label="Extensiones instaladas en orden"] li')).map((li) => li.textContent!);
        expect(items()[0]).toContain('Notion');
        expect(items()[1]).toContain('Giphy');
        expect(buttonNamed('Subir Notion')!.getAttribute('aria-disabled')).toBe('true');
        expect(document.body.textContent).toContain('settings.ui.order');
        expect(document.body.textContent).toContain('puede no reflejarse todavía');

        const down = buttonNamed('Bajar Notion')!;
        down.focus();
        await click(down);
        expect(posts('/extensions/order')[0].body).toEqual({ domainId: 'dom1', items: [{ extensionId: 'giphy', order: 0 }, { extensionId: 'notion', order: 10 }] });
        expect(live()).toContain('Notion movida a la posición 2 de 2');
        expect(items()[0]).toContain('Giphy');
        expect(document.activeElement).toBe(buttonNamed('Bajar Notion')); // el foco se conserva para poder repetir con el teclado

        await click(buttonNamed('Subir Notion'));
        expect(posts('/extensions/order')).toHaveLength(2);
        expect(items()[0]).toContain('Notion');
    });

    it('un boton en el limite no hace nada', async () => {
        await render();
        await click(buttonNamed('Subir Notion'));
        expect(posts('/extensions/order')).toHaveLength(0);
    });
});

describe('modo solo lectura (sin sesion de gestor)', () => {
    it('explica la limitacion, oculta acciones y muestra lo instalado desde /api/config', async () => {
        state.managerSessionRequired = true;
        state.configExtensions = [{ id: 'notion', name: 'Notion', template: { permissions: ['READ_EMAIL'], version: '1.3.0' }, settings: { meta: { installedVersion: '1.3.0' } } }];
        await render();
        const note = document.querySelector('[role="note"]')!;
        expect(note.textContent).toContain('Modo de solo lectura');
        expect(note.textContent).toContain('iniciar sesión como gestor');
        expect(card('Notion').textContent).toContain('Activada');
        expect(card('Giphy').textContent).toContain('Disponible'); // no figura entre las habilitadas
        for (const label of ['Instalar Agenda', 'Desinstalar Notion', 'Desactivar Notion', 'Actualizar Notion']) expect(buttonNamed(label)).toBeUndefined();
        expect(buttonNamed('Detalles de Notion')).toBeDefined();
        expect(document.querySelector('ol[aria-label]')).toBeNull(); // sin panel de orden
        expect(posts('/extensions/')).toHaveLength(0);
    });

    it('el detalle sigue disponible y explica que configurar credenciales requiere sesion de gestor', async () => {
        state.managerSessionRequired = true;
        state.configExtensions = [{ id: 'notion', name: 'Notion', template: { permissions: ['ENV_READ:NOTION_API_KEY'] } }];
        await render();
        await click(buttonNamed('Detalles de Notion'));
        await click(Array.from(document.querySelectorAll('[role="tab"]')).find((t) => t.textContent === 'Credenciales')!);
        expect(dialog()!.textContent).toContain('requiere sesión de gestor');
        expect(buttonNamed('Configurar credenciales')).toBeUndefined();
    });
});

describe('obligatoria para todos (politica del dominio)', () => {
    const open = async (name: string) => click(buttonNamed(`Detalles de ${name}`));
    const mandatorySwitch = () => document.querySelector<HTMLButtonElement>('section button[role="switch"]')!;
    const topDialog = () => Array.from(document.querySelectorAll('[role="dialog"]')).pop() as HTMLElement | undefined;

    it('el detalle ofrece el interruptor; marcar pide confirmacion (ConfirmDialog) y solo entonces llama; queda auditado en el proxy', async () => {
        await render();
        await open('Notion');
        const toggle = mandatorySwitch();
        expect(toggle.getAttribute('aria-checked')).toBe('false');
        expect(toggle.disabled).toBe(false);
        expect(document.body.textContent).toContain('Obligatoria para todos');
        expect(toggle.getAttribute('aria-describedby')).toBeTruthy();

        await click(toggle);
        const confirm = topDialog()!;
        expect(confirm.textContent).toContain('Marcar Notion como obligatoria');
        expect(confirm.textContent).toContain('no podrán desactivarla');
        expect(posts('/mandatory')).toHaveLength(0);

        await click(Array.from(confirm.querySelectorAll('button')).find((b) => b.textContent === 'Cancelar')!);
        expect(posts('/mandatory')).toHaveLength(0);

        await click(mandatorySwitch());
        await click(Array.from(topDialog()!.querySelectorAll('button')).find((b) => b.textContent === 'Marcar obligatoria')!);
        expect(posts('/mandatory')).toHaveLength(1);
        expect(posts('/mandatory')[0].body).toEqual({ domainId: 'dom1', extensionId: 'notion', mandatory: true });
        expect(mandatorySwitch().getAttribute('aria-checked')).toBe('true');
        expect(live()).toContain('Notion es ahora obligatoria');
        expect(card('Notion').textContent).toContain('Obligatoria');
    });

    it('una obligatoria oculta el boton Desactivar (primero hay que quitar la obligatoriedad) y quitarla tambien confirma', async () => {
        state.installed[0].mandatory = true;
        await render();
        expect(card('Notion').textContent).toContain('Obligatoria');
        expect(buttonNamed('Desactivar Notion')).toBeUndefined();
        await open('Notion');
        expect(mandatorySwitch().getAttribute('aria-checked')).toBe('true');
        await click(mandatorySwitch());
        expect(topDialog()!.textContent).toContain('Quitar la obligatoriedad de Notion');
        await click(Array.from(topDialog()!.querySelectorAll('button')).find((b) => b.textContent === 'Quitar obligatoriedad')!);
        expect(posts('/mandatory')[0].body).toEqual({ domainId: 'dom1', extensionId: 'notion', mandatory: false });
        expect(buttonNamed('Desactivar Notion')).toBeDefined();
    });

    it('si el manifest ya la declara obligatoria el interruptor esta bloqueado y lo explica', async () => {
        state.installed[0].mandatoryByManifest = true;
        await render();
        await open('Notion');
        const toggle = mandatorySwitch();
        expect(toggle.getAttribute('aria-checked')).toBe('true');
        expect(toggle.disabled).toBe(true);
        expect(document.body.textContent).toContain('La propia extensión se declara obligatoria');
        expect(buttonNamed('Desactivar Notion')).toBeUndefined();
    });

    it('una extension desactivada no se puede marcar (se explica), y en solo lectura tampoco', async () => {
        await render();
        await open('Giphy');
        expect(mandatorySwitch().disabled).toBe(true);
        expect(document.body.textContent).toContain('Activa la extensión para poder marcarla');
    });

    it('en solo lectura (sin sesion de gestor) el interruptor esta bloqueado', async () => {
        state.managerSessionRequired = true;
        state.configExtensions = [{ id: 'notion', name: 'Notion', mandatory: true, template: { permissions: ['READ_EMAIL'], version: '1.3.0' }, settings: { meta: { installedVersion: '1.3.0' } } }];
        await render();
        expect(card('Notion').textContent).toContain('Obligatoria');
        await open('Notion');
        expect(mandatorySwitch().disabled).toBe(true);
        expect(document.body.textContent).toContain('Solo el gestor');
        expect(posts('/mandatory')).toHaveLength(0);
    });

    it('un error del servidor se muestra traducido en el dialogo y no cambia el estado', async () => {
        state.mandatoryStatus = 502;
        await render();
        await open('Notion');
        await click(mandatorySwitch());
        await click(Array.from(topDialog()!.querySelectorAll('button')).find((b) => b.textContent === 'Marcar obligatoria')!);
        expect(topDialog()!.textContent).toContain('Activa la extensión antes de marcarla como obligatoria');
        expect(mandatorySwitch().getAttribute('aria-checked')).toBe('false');
    });

    it('en ingles', async () => {
        await render('en');
        await click(buttonNamed('Details of Notion'));
        expect(document.body.textContent).toContain('Mandatory for everyone');
        await click(mandatorySwitch());
        expect(topDialog()!.textContent).toContain('Mark Notion as mandatory');
    });
});
