// @vitest-environment jsdom
/**
 * Barra lateral del correo con entradas de navegacion de extensiones (`navEntries`): secciones main / workspace / tools, menu movil (el cajon es la
 * misma barra con `onClose`), preferencias de orden del usuario, estados (bloqueada por la IA) e insignias. Las dependencias pesadas se simulan.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 30000 });

let pathname = '/';
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => pathname, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => React.createElement('a', { href, ...rest }, children) }));
const motionCache: Record<string, any> = {};
vi.mock('framer-motion', () => ({
    motion: new Proxy({}, { get: (_t, tag: string) => (motionCache[tag] ??= React.forwardRef(({ children, whileHover, whileTap, initial, animate, exit, transition, layoutId, ...rest }: any, ref) => React.createElement(tag, { ref, ...rest }, children))) }),
    AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), loading: vi.fn() }) }));
vi.mock('@/hooks/useExpansions', () => ({ useExpansions: () => ({}) }));
vi.mock('../expansions/ExtensionLoader', () => ({ ExtensionLoader: () => null }));
vi.mock('@/components/CronTrigger', () => ({ CronTrigger: () => null }));
vi.mock('@/contexts/ComposeContext', () => ({ useCompose: () => ({ openCompose: vi.fn() }) }));
// Referencias ESTABLES (como el proveedor real): si cambiaran en cada render, el efecto de carga de la barra volveria a ejecutarse sin fin.
const cacheApi = { getData: async () => null, setData: async () => undefined, subscribe: () => () => undefined, invalidate: async () => undefined };
vi.mock('@/contexts/CacheContext', () => ({ useCache: () => cacheApi }));
const sessionValue = { status: 'authenticated', data: { user: { id: 'u1', email: 'ana@acme.test', name: 'Ana' } } };
vi.mock('@/components/SessionProvider', () => ({ useSession: () => sessionValue }));
vi.mock('../SettingsModal', () => ({ SettingsModal: () => null }));
const mailActions = {};
vi.mock('@/components/mail/useMailActions', () => ({ useMailActions: () => mailActions }));
vi.mock('@/components/mail/ui', () => ({ Avatar: () => null }));
vi.mock('@/components/mail/QuotaMeter', () => ({ QuotaMeter: () => null }));
vi.mock('@/components/labels/SidebarLabelGroups', () => ({ LabelsHelp: () => null, NewLabelMenu: () => null, SidebarLabelGroups: () => null }));
vi.mock('@/lib/account-manager', () => ({ AccountManager: { getAccounts: () => [], setActive: vi.fn(), removeAccount: vi.fn() } }));
const prefsValue = { isEnabled: (id: string) => !disabled.has(id) };
vi.mock('@/hooks/useExtensionPrefs', () => ({ useExtensionPrefs: () => prefsValue }));

const disabled = new Set<string>();
const template = (id: string, entries: any[], extra: Record<string, any> = {}) => ({
    manifestVersion: '1.0', id, name: id, version: '1.0.0', permissions: [],
    requires: { clientApi: 8, capabilities: ['nav.entries.v1', 'ext.pages.auth.v1', 'ext.routes.v1', 'ext.routes.auth.v1', 'ui.pages.v1'] },
    api: { functions: { b: { handler: 'b' } } }, backendRoutes: [{ path: '/badge', handler: 'b', method: 'GET' }],
    mounts: [
        { point: 'PAGE', path: `${id}-p`, component: { type: 'PAGE_HEADER', props: { title: 'P' } } },
        { point: 'PAGE', path: `${id}-admin`, auth: 'admin', component: { type: 'PAGE_HEADER', props: { title: 'A' } } },
    ],
    navEntries: entries, ...extra,
});
let config: { allExtensions: any[]; viewerLevel: number | null };
vi.mock('@/hooks/useDomainConfig', () => ({
    useDomainConfig: () => ({ config: { name: 'Acme', displayName: 'Acme Mail', logo: null }, extensions: config.allExtensions, allExtensions: config.allExtensions, viewerLevel: config.viewerLevel, isLoading: false }),
}));

import { I18nProvider } from '@/components/I18nProvider';
import { Sidebar } from '../Sidebar';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
const h = React.createElement;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const qa = <T extends Element = HTMLElement>(sel: string) => Array.from(document.querySelectorAll<T>(sel));
const click = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click(); }); await flush(); };
const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const fetchCalls: string[] = [];

async function mountSidebar(onClose?: () => void) {
    await act(async () => { root.render(h(I18nProvider, { locale: 'es', children: h(Sidebar, onClose ? { onClose } : {}) })); });
    // El idioma se carga con un import dinamico: la primera vez tarda mas que un par de ciclos.
    const end = Date.now() + 15000;
    while (!q('[data-testid="sidebar-ready"], button[aria-expanded][class*="uppercase"]') && Date.now() < end) await flush();
    await flush();
    await flush();
}
const sectionTitles = () => qa('button[aria-expanded][class*="uppercase"] span').map((s) => s.textContent);

const full = () => template('ext-notes', [
    { id: 'notes', section: 'workspace', label: { es: 'Notas', en: 'Notes' }, icon: 'StickyNote', order: 20, target: 'page:ext-notes-p', badge: { route: '/badge' } },
    { id: 'inbox-extra', section: 'main', label: 'Bandeja extra', target: 'page:ext-notes-p', order: 5 },
    { id: 'tool', section: 'tools', label: 'Herramienta', target: 'page:ext-notes-p' },
    { id: 'desk', section: 'tools', label: 'Solo escritorio', target: 'page:ext-notes-p', order: 200, mobile: false },
    { id: 'adm', section: 'admin', label: 'Solo consola', target: 'page:ext-notes-admin' },
]);

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    pathname = '/';
    disabled.clear();
    fetchCalls.length = 0;
    window.localStorage.clear();
    config = { allExtensions: [{ id: 'ext-notes', version: '1.0.0', template: full() }], viewerLevel: null };
    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
        const url = String(input);
        fetchCalls.push(url);
        if (url.includes('/api/counts')) return json({ counts: { inbox: 0, drafts: 0, sent: 0, spam: 0, trash: 0, archive: 0, scheduled: 0 }, labels: [] });
        if (url.includes('/api/settings')) return json({ expansionSettings: {} });
        if (url.includes('/api/ext/')) return json({ count: 12 });
        return json({});
    }));
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

describe('barra lateral con entradas de extensiones', () => {
    it('las entradas van en su seccion, ordenadas y con la ruta final /extensions/<path>', async () => {
        await mountSidebar();
        const nav = qa('[data-extension-nav]');
        expect(nav.length).toBe(3);
        const mainLinks = nav[0].querySelectorAll('a');
        expect(mainLinks[0].getAttribute('href')).toBe('/extensions/ext-notes-p');
        expect(mainLinks[0].textContent).toContain('Bandeja extra');
        expect(nav[1].querySelector('a')!.textContent).toContain('Notas');
        expect(nav[2].textContent).toContain('Herramienta');
        expect(sectionTitles()).toEqual(['Carpetas', 'Espacio de trabajo', 'Herramientas', 'Etiquetas y carpetas']);
    });

    it('las entradas de administracion NUNCA salen en la barra del correo (viven en la consola)', async () => {
        config.viewerLevel = 4;
        await mountSidebar();
        expect(document.body.textContent).not.toContain('Solo consola');
    });

    it('la pagina activa se marca con aria-current', async () => {
        pathname = '/extensions/ext-notes-p';
        await mountSidebar();
        expect(qa('[data-extension-nav] a[aria-current="page"]').length).toBe(4); // las 4 entradas visibles apuntan a la misma pagina
    });

    it('menu movil (cajon con onClose): oculta las entradas con mobile:false y cierra el cajon al navegar', async () => {
        const onClose = vi.fn();
        await mountSidebar(onClose);
        expect(document.body.textContent).not.toContain('Solo escritorio');
        expect(document.body.textContent).toContain('Herramienta');
        await click(q('[data-extension-nav] a'));
        expect(onClose).toHaveBeenCalled();
    });

    it('escritorio: aparece la entrada solo de escritorio', async () => {
        await mountSidebar();
        expect(document.body.textContent).toContain('Solo escritorio');
    });

    it('sin entradas de herramientas no existe la seccion "Herramientas"', async () => {
        config.allExtensions = [{ id: 'ext-notes', version: '1.0.0', template: template('ext-notes', [{ id: 'notes', section: 'workspace', label: 'Notas', target: 'page:ext-notes-p' }]) }];
        await mountSidebar();
        expect(sectionTitles()).toEqual(['Carpetas', 'Espacio de trabajo', 'Etiquetas y carpetas']);
    });

    it('extension desactivada por el usuario: sus entradas desaparecen', async () => {
        disabled.add('ext-notes');
        await mountSidebar();
        expect(qa('[data-extension-nav]').length).toBe(0);
        expect(sectionTitles()).toEqual(['Carpetas', 'Espacio de trabajo', 'Etiquetas y carpetas']);
    });

    it('bloqueada por la IA: entradas deshabilitadas con el motivo, no son enlaces y no consultan la insignia', async () => {
        config.allExtensions = [{ id: 'ext-notes', version: '1.0.0', aiBlock: { blocked: true }, template: full() }];
        await mountSidebar();
        const off = qa('[data-extension-nav] [aria-disabled="true"]');
        expect(off.length).toBe(4);
        expect(off[0].getAttribute('title')).toBe('En pausa: la IA está desactivada');
        expect(qa('[data-extension-nav] a').length).toBe(0);
        expect(fetchCalls.some((u) => u.includes('/api/ext/'))).toBe(false);
    });

    it('insignia: consulta GET /api/ext/<id>/badge y la anuncia a lectores de pantalla', async () => {
        await mountSidebar();
        expect(fetchCalls).toContain('/api/ext/ext-notes/badge');
        const link = qa('[data-extension-nav] a').find((a) => a.textContent?.includes('Notas'))!;
        expect(link.textContent).toContain('12');
        expect(link.getAttribute('aria-label')).toBe('Notas, 12 pendientes');
    });

    it('respeta el orden de secciones del usuario: "Herramientas" entra tras el espacio de trabajo y las flechas saltan las secciones ocultas', async () => {
        window.localStorage.setItem('bloomx:sidebar:section-order:v1', JSON.stringify(['labels', 'main', 'workspace']));
        await mountSidebar();
        expect(sectionTitles()).toEqual(['Etiquetas y carpetas', 'Carpetas', 'Espacio de trabajo', 'Herramientas']);
        // bajar "Etiquetas" una posicion: pasa por delante de "Carpetas"
        await click(qa('button').find((b) => b.getAttribute('aria-label') === 'Bajar la sección Etiquetas y carpetas') ?? q('button[title="Bajar"]'));
        expect(sectionTitles()[0]).toBe('Carpetas');
    });
});
