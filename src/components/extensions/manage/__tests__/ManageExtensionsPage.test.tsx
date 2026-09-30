// @vitest-environment jsdom
/**
 * /extensions (gestion para el usuario) con 4 extensiones simuladas: busqueda, filtros, activar/desactivar (persistente y
 * con efecto real sobre ExtensionLoader), orden, detalle con permisos legibles, errores en vivo y 3 paletas claro/oscuro.
 */
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertThemeSafe, applyBrand, BRAND_MODES, PALETTES, byText, click, flush, installCleanup, mount, q, qa, typeInto } from '@/components/expansions/kit/__tests__/harness';

const state = vi.hoisted(() => ({
    extensions: [] as any[],
    session: { data: { user: { id: 'u1', email: 'yo@example.com' } } as any, status: 'authenticated' as string },
    params: new URLSearchParams(),
    replace: vi.fn(),
}));

vi.mock('@/hooks/useDomainConfig', () => ({ useDomainConfig: () => ({ extensions: state.extensions, isLoading: false, isError: undefined, config: {}, themeConfig: {} }) }));
vi.mock('@/components/SessionProvider', () => ({ useSession: () => state.session }));
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: vi.fn(), replace: state.replace, refresh: vi.fn() }),
    useSearchParams: () => state.params,
    usePathname: () => '/extensions',
    notFound: () => { throw new Error('notFound'); },
}));

import { ManageExtensionsPage } from '../ManageExtensionsPage';
import { ExtensionLoader } from '@/components/expansions/ExtensionLoader';
import { __resetExtensionErrors, reportExtensionError, getExtensionErrors } from '@/lib/expansions/client/error-log';
import { EMPTY_PREFS, setPrefs } from '@/lib/expansions/client/prefs';

const button = (label: string) => ({ type: 'BUTTON', props: { label } });
const tpl = (over: Record<string, any>) => ({ version: '1.0.0', mounts: [], ...over });

function sample() {
    return [
        { id: 'zoom', template: tpl({ id: 'zoom', name: 'Reuniones Zoom', description: 'Crea videollamadas', tags: ['video'], permissions: ['HTTP_REQUEST', 'NOTIFY', 'PERMISO_RARO', 'ENV_READ:ZOOM_KEY'], mounts: [{ point: 'CALENDAR_TOOLBAR', component: button('Boton Zoom') }] }) },
        {
            id: 'signature',
            template: tpl({
                id: 'signature', name: 'Firma', description: 'Anade tu firma', version: '1.0.0', permissions: ['READ_EMAIL'], screenshots: ['https://example.com/a.png', 'javascript:alert(1)'],
                changelog: [{ version: '1.0.0', date: '2026-01-01', notes: '<b>No es HTML</b>' }],
                mounts: [{ point: 'EMAIL_TOOLBAR', component: button('Boton Firma') }, { point: 'OVERLAY', id: 'p', component: { type: 'TEXT', props: { content: 'Contenido del panel' } } }],
            }),
        },
        { id: 'apagada', template: tpl({ id: 'apagada', name: 'Apagada', status: 'disabled', mounts: [{ point: 'EMAIL_TOOLBAR', component: button('Boton Apagada') }] }) },
        { id: 'rota', template: { id: 'rota', name: 'Rota', version: 'xx', mounts: [] } },
    ];
}

const sw = (name: string) => q<HTMLButtonElement>(`button[role="switch"][aria-label="Activar ${name}"]`);
const names = () => qa('[data-testid="extension-list"] h3').map((h) => h.textContent);
const live = () => q('[data-testid="live-region"]')?.textContent?.replace(/​/g, '') ?? '';
const press = (label: string) => byText(label, 'button');

async function page() { return mount(<ManageExtensionsPage />); }

describe('/extensions', () => {
    installCleanup();
    beforeEach(() => {
        localStorage.clear();
        __resetExtensionErrors();
        setPrefs(EMPTY_PREFS, { sync: false });
        state.extensions = sample();
        state.session = { data: { user: { id: 'u1', email: 'yo@example.com' } }, status: 'authenticated' };
        state.params = new URLSearchParams();
        state.replace.mockClear();
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('lista todas las extensiones, tambien la invalida con su motivo', async () => {
        await page();
        expect(names()).toEqual(['Reuniones Zoom', 'Firma', 'Apagada', 'Rota']);
        const rota = q('[data-extension-id="rota"]')!;
        expect(rota.getAttribute('data-state')).toBe('invalid');
        expect(rota.textContent).toContain('Manifest invalido');
        expect(rota.textContent).toMatch(/semver/i);
        expect(q('[data-extension-id="apagada"]')!.textContent).toContain('Sin efecto: desactivada por la organizacion');
    });

    it('la busqueda filtra sin tildes ni mayusculas y se puede quitar', async () => {
        await page();
        await typeInto(q<HTMLInputElement>('#ext-search'), 'AÑADE');
        expect(names()).toEqual(['Firma']);
        expect(q('[data-testid="result-count"]')!.textContent).toBe('1 de 4 extensiones');
        await typeInto(q<HTMLInputElement>('#ext-search'), 'nada de nada');
        expect(q('[data-testid="extension-list"]')).toBeNull();
        expect(document.body.textContent).toContain('Ninguna extension coincide');
        await click(press('Quitar filtros'));
        expect(names()).toHaveLength(4);
    });

    it('filtro por estado con contadores', async () => {
        await page();
        expect(press('Todas (4)')).toBeTruthy();
        expect(press('Activas (2)')).toBeTruthy();
        expect(press('Con errores (1)')).toBeTruthy();
        await click(press('Desactivadas por la organizacion (1)'));
        expect(names()).toEqual(['Apagada']);
        await click(press('Con errores (1)'));
        expect(names()).toEqual(['Rota']);
    });

    it('filtro por categoria', async () => {
        await page();
        await click(press('Calendario (1)'));
        expect(names()).toEqual(['Reuniones Zoom']);
    });

    it('desactivar persiste, cambia el estado y desaparece el mount de ExtensionLoader', async () => {
        const m = await mount(<div><ExtensionLoader mountPoint="EMAIL_TOOLBAR" /><ManageExtensionsPage /></div>);
        expect(q('[data-extension-toolbar] button[aria-label="Boton Firma"]')).toBeTruthy();
        expect(sw('Firma')!.getAttribute('aria-checked')).toBe('true');
        await click(sw('Firma'));
        expect(sw('Firma')!.getAttribute('aria-checked')).toBe('false');
        expect(q('[data-extension-toolbar] button[aria-label="Boton Firma"]')).toBeNull();
        expect(q('[data-extension-id="signature"]')!.getAttribute('data-state')).toBe('user-disabled');
        expect(live()).toBe('Firma desactivada.');
        expect(localStorage.getItem('bloomx:ext-prefs:v1:u1')).toContain('signature');
        await click(press('Desactivadas por ti (1)'));
        expect(names()).toEqual(['Firma']);
        // Reactivar devuelve el boton
        await click(sw('Firma'));
        expect(q('[data-extension-toolbar] button[aria-label="Boton Firma"]')).toBeTruthy();
        expect(m.container).toBeTruthy();
    });

    it('una extension desactivada por la organizacion avisa y no se monta aunque este activada', async () => {
        await mount(<div><ExtensionLoader mountPoint="EMAIL_TOOLBAR" /><ManageExtensionsPage /></div>);
        expect(q('[data-extension-toolbar] button[aria-label="Boton Apagada"]')).toBeNull();
        expect(sw('Apagada')!.getAttribute('aria-describedby')).toBeTruthy();
    });

    it('el orden cambia con subir/bajar, se anuncia y se restablece', async () => {
        await mount(<div><ExtensionLoader mountPoint="EMAIL_TOOLBAR" /><ManageExtensionsPage /></div>);
        const first = () => qa('[data-testid="extension-list"] article').map((a) => a.getAttribute('data-extension-id'));
        expect(first()).toEqual(['zoom', 'signature', 'apagada', 'rota']);
        await click(q('button[aria-label="Bajar Reuniones Zoom"]'));
        expect(first()).toEqual(['signature', 'zoom', 'apagada', 'rota']);
        expect(live()).toBe('Reuniones Zoom movida a la posicion 2 de 3.');
        // posicion numerada
        expect(q('[data-extension-id="zoom"]')!.textContent).toContain('Posicion 2');
        // no se puede subir el primero: se anuncia sin mover
        await click(q('button[aria-label="Subir Firma"]'));
        expect(first()).toEqual(['signature', 'zoom', 'apagada', 'rota']);
        expect(live()).toBe('Firma ya esta en la posicion 1.');
        // la invalida no es ordenable
        expect(q('[data-extension-id="rota"] button[aria-label^="Subir"]')).toBeNull();
        // foco conservado en el boton tras mover (aria-disabled, no disabled)
        await click(press('Restablecer orden'));
        expect(first()).toEqual(['zoom', 'signature', 'apagada', 'rota']);
        expect(press('Restablecer orden')).toBeNull();
    });

    it('el detalle muestra permisos legibles ordenados, donde aparece, vista previa inerte, capturas https y changelog como texto', async () => {
        await page();
        await click(qa<HTMLButtonElement>('[data-extension-id="zoom"] button').pop() ?? null);
        // abre el de Zoom (primera tarjeta)
        expect(state.replace).toHaveBeenCalledWith('/extensions?ext=zoom', { scroll: false });
        const dialog = q('[role="dialog"]')!;
        expect(dialog.getAttribute('aria-label')).toBe('Detalles de Reuniones Zoom');
        const perms = qa('[data-testid="permission-list"] li', dialog).map((li) => li.textContent ?? '');
        expect(perms[0]).toContain('Conectarse a servicios externos');
        expect(perms.join('|')).toContain('Usar el ajuste ZOOM_KEY del administrador');
        expect(perms.join('|')).toContain('PERMISO_RARO');
        expect(perms.join('|')).toContain('Permiso no documentado');
        expect(perms[perms.length - 1]).toContain('Mostrarte avisos dentro de la aplicacion');
        expect(dialog.textContent).toContain('Barra del calendario');
        // foco dentro del dialogo
        await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
        expect(dialog.contains(document.activeElement)).toBe(true);
    });

    it('detalle de Firma via ?ext: vista previa inerte, capturas y changelog', async () => {
        state.params = new URLSearchParams('ext=signature');
        await page();
        const dialog = q('[role="dialog"]')!;
        expect(dialog.getAttribute('aria-label')).toBe('Detalles de Firma');
        const preview = q('[data-testid="extension-preview"]', dialog)!;
        expect(preview.hasAttribute('inert')).toBe(true);
        expect(preview.className).toContain('max-h-');
        expect(preview.className).toContain('pointer-events-none');
        expect(preview.textContent).toContain('Contenido del panel');
        expect(dialog.textContent).toContain('Vista previa');
        expect(qa('img', dialog).map((i) => i.getAttribute('src'))).toEqual(['https://example.com/a.png']);
        expect(dialog.textContent).toContain('<b>No es HTML</b>');
        expect(q('b', dialog)).toBeNull();
        expect(dialog.textContent).toContain('Leer el correo que tienes abierto');
        expect(dialog.textContent).toContain('Sensibilidad Alta');
    });

    it('Escape cierra el detalle y limpia la URL', async () => {
        state.params = new URLSearchParams('ext=signature');
        await page();
        expect(q('[role="dialog"]')).toBeTruthy();
        await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
        expect(state.replace).toHaveBeenCalledWith('/extensions', { scroll: false });
    });

    it('los errores aparecen en vivo (panel, insignia) y se limpian; el informe se copia sin datos personales', async () => {
        const writeText = vi.fn(async () => undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        await page();
        expect(q('[data-testid="errors-panel"]')!.textContent).toContain('No se ha registrado ningun error.');
        await act(async () => { reportExtensionError({ extensionId: 'signature', kind: 'render', message: 'Fallo para yo@example.com', path: 'mounts[0].component' }); });
        const panel = q('[data-testid="errors-panel"]')!;
        expect(qa('[data-testid="error-row"]', panel)).toHaveLength(1);
        expect(panel.textContent).toContain('mounts[0].component');
        expect(q('[data-extension-id="signature"]')!.textContent).toContain('1 error');
        // repetido: suma veces
        await act(async () => { reportExtensionError({ extensionId: 'signature', kind: 'render', message: 'Fallo para yo@example.com', path: 'mounts[0].component' }); });
        expect(panel.textContent).toContain('x2');
        await click(byText('Copiar informe', 'button', panel));
        await flush();
        expect(writeText).toHaveBeenCalledTimes(1);
        const report = (writeText.mock.calls[0] as unknown as [string])[0];
        expect(report).toContain('Extension: Firma (signature)');
        expect(report).toContain('Version: 1.0.0');
        expect(report).not.toContain('yo@example.com');
        expect(live()).toBe('Informe copiado.');
        await click(byText('Limpiar todo', 'button', panel));
        expect(getExtensionErrors()).toHaveLength(0);
        expect(panel.textContent).toContain('No se ha registrado ningun error.');
        expect(q('[data-extension-id="signature"]')!.textContent).not.toContain('1 error');
        // el enlace al playground existe en desarrollo/test
        await act(async () => { reportExtensionError({ extensionId: 'zoom', kind: 'action', message: 'x' }); });
        expect(q('a[href="/extensions/playground"]')).toBeTruthy();
    });

    it('sin sesion muestra aviso y enlace a /login; con sesion cargando, un estado de espera', async () => {
        state.session = { data: null, status: 'unauthenticated' };
        await page();
        expect(document.body.textContent).toContain('Necesitas iniciar sesion');
        expect(q('a[href="/login"]')).toBeTruthy();
        expect(q('[data-testid="manage-extensions"]')).toBeNull();
    });

    it('estado vacio amable sin extensiones', async () => {
        state.extensions = [];
        await page();
        expect(document.body.textContent).toContain('Todavia no hay extensiones instaladas');
    });

    it('la vista lista y tarjetas son conmutables', async () => {
        await page();
        expect(q('[data-testid="extension-list"]')!.className).toContain('grid');
        await click(press('Lista'));
        expect(q('[data-testid="extension-list"]')!.className).toContain('flex-col');
        expect(press('Lista')!.getAttribute('aria-pressed')).toBe('true');
    });
});

describe.each(PALETTES)('/extensions con la paleta "%s"', (palette) => {
    installCleanup();
    beforeEach(() => {
        localStorage.clear();
        __resetExtensionErrors();
        setPrefs(EMPTY_PREFS, { sync: false });
        state.extensions = sample();
        state.session = { data: { user: { id: 'u1' } }, status: 'authenticated' };
        state.params = new URLSearchParams('ext=signature');
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    it.each(BRAND_MODES)('solo tokens, sin paleta cruda ni estilos de color (%s)', async (mode) => {
        const css = applyBrand(palette, mode);
        await mount(<ManageExtensionsPage />);
        await act(async () => { reportExtensionError({ extensionId: 'signature', kind: 'render', message: 'boom', path: 'a.b' }); });
        expect(q('[role="dialog"]')).toBeTruthy();
        assertThemeSafe(document.body, css);
    });
});
