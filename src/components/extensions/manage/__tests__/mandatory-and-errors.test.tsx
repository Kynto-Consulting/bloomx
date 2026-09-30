// @vitest-environment jsdom
/**
 * /extensions y ExtensionLoader ante (1) extensiones OBLIGATORIAS (bloqueadas con explicacion, no se pueden desactivar aunque las
 * prefs lo pidan) y (2) FALLO de carga (estado de error con Reintentar en lugar de "sin extensiones"; se conservan los datos buenos).
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, installCleanup, mount, q, qa } from '@/components/expansions/kit/__tests__/harness';

const state = vi.hoisted(() => ({
    extensions: [] as any[],
    isError: false,
    isStale: false,
    isRetrying: false,
    extensionsLoaded: true,
    retry: vi.fn(),
    session: { data: { user: { id: 'u1', email: 'yo@example.com' } } as any, status: 'authenticated' as string },
    params: new URLSearchParams(),
}));

vi.mock('@/hooks/useDomainConfig', () => ({
    useDomainConfig: () => ({
        extensions: state.extensions, isLoading: false, isError: state.isError, isStale: state.isStale, isRetrying: state.isRetrying,
        extensionsLoaded: state.extensionsLoaded, retry: state.retry, error: state.isError ? { kind: 'http', status: 500 } : null, config: {}, themeConfig: {},
    }),
}));
vi.mock('@/components/SessionProvider', () => ({ useSession: () => state.session }));
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
    useSearchParams: () => state.params,
    usePathname: () => '/extensions',
    notFound: () => { throw new Error('notFound'); },
}));

import { ManageExtensionsPage } from '../ManageExtensionsPage';
import { ExtensionLoader } from '@/components/expansions/ExtensionLoader';
import { __resetExtensionErrors } from '@/lib/expansions/client/error-log';
import { EMPTY_PREFS, getPrefs, setPrefs } from '@/lib/expansions/client/prefs';

const button = (label: string) => ({ type: 'BUTTON', props: { label } });
const tpl = (over: Record<string, any>) => ({ version: '1.0.0', mounts: [], ...over });

function sample() {
    return [
        { id: 'dlp', template: tpl({ id: 'dlp', name: 'Proteccion DLP', description: 'Evita fugas', mandatory: true, mounts: [{ point: 'EMAIL_TOOLBAR', component: button('Boton DLP') }] }) },
        { id: 'audit', mandatory: true, settings: { meta: { mandatory: true } }, template: tpl({ id: 'audit', name: 'Auditoria', mounts: [{ point: 'EMAIL_TOOLBAR', component: button('Boton Auditoria') }] }) },
        { id: 'zoom', template: tpl({ id: 'zoom', name: 'Zoom', mounts: [{ point: 'EMAIL_TOOLBAR', component: button('Boton Zoom') }] }) },
    ];
}

const sw = (name: string) => q<HTMLButtonElement>(`button[role="switch"][aria-label="${name}"]`);
const loader = (mountPoint = 'EMAIL_TOOLBAR') => <ExtensionLoader mountPoint={mountPoint} />;

describe('extensiones obligatorias', () => {
    installCleanup();
    beforeEach(() => {
        localStorage.clear();
        __resetExtensionErrors();
        setPrefs(EMPTY_PREFS, { sync: false });
        Object.assign(state, { extensions: sample(), isError: false, isStale: false, isRetrying: false, extensionsLoaded: true });
        state.retry.mockClear();
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('el interruptor de una obligatoria esta bloqueado, con explicacion y etiqueta propia; pulsarlo no la desactiva', async () => {
        await mount(<ManageExtensionsPage />);
        for (const [id, name] of [['dlp', 'Proteccion DLP'], ['audit', 'Auditoria']] as const) {
            const article = q(`[data-extension-id="${id}"]`)!;
            const toggle = sw(`${name} es obligatoria y no se puede desactivar`)!;
            expect(toggle, id).toBeTruthy();
            expect(toggle.getAttribute('aria-disabled')).toBe('true');
            expect(toggle.getAttribute('aria-checked')).toBe('true');
            expect(toggle.getAttribute('aria-describedby')).toBeTruthy();
            expect(article.textContent).toContain('Obligatoria');
            expect(q('[data-testid="mandatory-note"]', article)!.textContent).toMatch(/no se puede desactivar/i);
            await click(toggle);
            expect(getPrefs().disabled).not.toContain(id);
            expect(toggle.getAttribute('aria-checked')).toBe('true');
        }
        // una normal sigue funcionando
        await click(sw('Activar Zoom'));
        expect(getPrefs().disabled).toEqual(['zoom']);
    });

    it('aunque las preferencias la tengan como desactivada (p. ej. se marco despues), sigue activa y su boton se monta', async () => {
        setPrefs({ disabled: ['dlp', 'audit', 'zoom'], order: [] }, { sync: false });
        await mount(<div><ManageExtensionsPage />{loader()}</div>);
        expect(q('[data-extension-id="dlp"]')!.getAttribute('data-state')).toBe('active');
        expect(q('[data-extension-id="audit"]')!.getAttribute('data-state')).toBe('active');
        expect(q('[data-extension-id="zoom"]')!.getAttribute('data-state')).toBe('user-disabled');
        expect(byText('Boton DLP', 'button')).toBeTruthy();
        expect(byText('Boton Auditoria', 'button')).toBeTruthy();
        expect(byText('Boton Zoom', 'button')).toBeNull();
    });

    it('el detalle tambien muestra el interruptor bloqueado con la explicacion', async () => {
        state.params = new URLSearchParams('ext=dlp');
        await mount(<ManageExtensionsPage />);
        const dialog = q('[role="dialog"]')!;
        expect(dialog).toBeTruthy();
        const toggle = q<HTMLButtonElement>('button[role="switch"][aria-label*="obligatoria"]', dialog)!;
        expect(toggle.getAttribute('aria-disabled')).toBe('true');
        expect(dialog.textContent).toMatch(/Tu organizacion la exige/);
        state.params = new URLSearchParams();
    });
});

describe('fallo de carga de extensiones', () => {
    installCleanup();
    beforeEach(() => {
        localStorage.clear();
        setPrefs(EMPTY_PREFS, { sync: false });
        Object.assign(state, { extensions: [], isError: true, isStale: false, isRetrying: false, extensionsLoaded: false });
        state.retry.mockClear();
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('/extensions: muestra el error con "Reintentar" y NO dice que no hay extensiones', async () => {
        await mount(<ManageExtensionsPage />);
        const alert = q('[role="alert"]')!;
        expect(alert.textContent).toContain('No se pudieron cargar las extensiones');
        expect(document.body.textContent).not.toContain('Todavia no hay extensiones instaladas');
        await click(byText('Reintentar', 'button'));
        expect(state.retry).toHaveBeenCalledTimes(1);
    });

    it('/extensions con datos buenos previos: se siguen mostrando y el aviso explica que son los ultimos conocidos', async () => {
        Object.assign(state, { extensions: sample(), isStale: true, extensionsLoaded: true });
        await mount(<ManageExtensionsPage />);
        expect(qa('[data-testid="extension-list"] h3').length).toBe(3);
        expect(q('[role="alert"]')!.textContent).toMatch(/ultima informacion conocida/i);
    });

    it('/extensions: durante el reintento el boton se deshabilita y lo dice', async () => {
        state.isRetrying = true;
        await mount(<ManageExtensionsPage />);
        const retrying = byText('Reintentando...', 'button') as HTMLButtonElement;
        expect(retrying).toBeTruthy();
        expect(retrying.disabled).toBe(true);
    });

    it('ExtensionLoader en una barra: boton "Reintentar" accesible en lugar de nada', async () => {
        await mount(loader('EMAIL_TOOLBAR'));
        const btn = q<HTMLButtonElement>('[data-testid="extensions-load-error"]')!;
        expect(btn.tagName).toBe('BUTTON');
        expect(btn.getAttribute('aria-label')).toBe('Las extensiones no se pudieron cargar. Reintentar');
        await click(btn);
        expect(state.retry).toHaveBeenCalledTimes(1);
    });

    it('ExtensionLoader en un punto sin espacio para controles: no pinta nada (no llena la pantalla de avisos)', async () => {
        const m = await mount(loader('EMAIL_FOOTER'));
        expect(q('[data-testid="extensions-load-error"]', m.container)).toBeNull();
        expect(m.container.textContent).toBe('');
    });

    it('ExtensionLoader con datos buenos previos (stale): monta las extensiones y NO el error', async () => {
        Object.assign(state, { extensions: sample(), isStale: true, extensionsLoaded: true });
        await mount(loader('EMAIL_TOOLBAR'));
        expect(byText('Boton Zoom', 'button')).toBeTruthy();
        expect(q('[data-testid="extensions-load-error"]')).toBeNull();
    });

    it('sin error y con lista vacia SI es "sin extensiones": el cargador no pinta error', async () => {
        Object.assign(state, { extensions: [], isError: false, extensionsLoaded: true });
        await mount(loader('EMAIL_TOOLBAR'));
        expect(q('[data-testid="extensions-load-error"]')).toBeNull();
    });
});
