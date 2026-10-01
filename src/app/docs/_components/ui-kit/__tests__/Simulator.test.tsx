// @vitest-environment jsdom
/**
 * Simulador de /docs/extension-ui/<componente> de punta a punta (jsdom): valida JSON invalido con ruta, registra los
 * eventos de un BUTTON con onClick TOAST / CALL_BACKEND simulado (ambos caminos), sin red y sin ejecutar avisos reales.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { toastFn } = vi.hoisted(() => ({ toastFn: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }) as any }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/docs/extension-ui/button' }));
vi.mock('sonner', () => ({ toast: toastFn }));
vi.mock('@/lib/expansions/api', () => ({ executeExtensionAction: vi.fn(async () => { throw new Error('backend real invocado'); }), fetchExpansions: vi.fn(async () => []) }));

import Simulator from '../Simulator';
import { click, flush, installCleanup, mount, q, qa, typeInto } from '../../../../../components/expansions/kit/__tests__/harness';

const h = React.createElement;
installCleanup();

const log = () => qa<HTMLElement>('[data-testid="sim-log"] li[data-kind]');
const names = (kind?: string) => log().filter((li) => !kind || li.dataset.kind === kind).map((li) => li.dataset.name);
const choosePreset = async (id: string) => { await typeInto(q<HTMLSelectElement>('#sim-preset'), id); };
const waitFor = async (cond: () => boolean, tries = 40) => { for (let i = 0; i < tries && !cond(); i++) await flush(); };

beforeEach(() => {
    Object.values(toastFn).forEach((fn: any) => fn?.mockClear?.());
    vi.spyOn(console, 'warn').mockImplementation(() => { });
    vi.spyOn(console, 'error').mockImplementation(() => { });
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('el simulador no debe usar la red'); }));
});

describe('Simulador de BUTTON', () => {
    it('renderiza el componente real y registra clic, TOAST, SET_STATE y CALL_BACKEND (exito) con argumentos interpolados', async () => {
        await mount(h(Simulator, { type: 'BUTTON' }));
        await choosePreset('action-direct');
        // retraso 0 para que el test sea rapido
        await typeInto(q<HTMLInputElement>('#sim-mock-delay'), '0');
        const button = q<HTMLButtonElement>('[data-testid="sim-preview"] button');
        expect(button).toBeTruthy();
        await click(button);
        await waitFor(() => names('backend').length > 0);
        await waitFor(() => names('action').includes('CALL_BACKEND') && (q('[data-testid="sim-toasts"]')?.textContent ?? '').includes('CALL_BACKEND OK'));

        expect(names('interaction')[0]).toBe('clic');
        expect(names('action')).toEqual(expect.arrayContaining(['SET_STATE', 'TOAST', 'CALL_BACKEND']));
        const toastEntry = log().find((li) => li.dataset.name === 'TOAST')!;
        expect(toastEntry.textContent).toContain('BUTTON.onClick'); // mensaje ya interpolado
        const backend = log().find((li) => li.dataset.kind === 'backend')!;
        expect(backend.dataset.name).toBe('demoCall');
        expect(backend.textContent).toContain('"ok":true');
        // camino onSuccess: el segundo TOAST (anidado) se registra y se muestra como aviso simulado
        expect(names('action').filter((n) => n === 'TOAST').length).toBe(2);
        expect(q('[data-testid="sim-toasts"]')!.textContent).toContain('CALL_BACKEND OK');
        // estado visible
        expect(q('[data-testid="sim-live-state"]')!.textContent).toContain('"lastEvent": "BUTTON.onClick"');
        // ni avisos reales ni backend real ni red
        expect(toastFn).not.toHaveBeenCalled();
        expect(toastFn.error).not.toHaveBeenCalled();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('camino onError: con el backend simulado en error se registra el fallo y el TOAST de onError', async () => {
        await mount(h(Simulator, { type: 'BUTTON' }));
        await choosePreset('action-direct');
        await click(qa<HTMLButtonElement>('button[role="radio"]').find((b) => /Error/.test(b.textContent ?? ''))!);
        await typeInto(q<HTMLInputElement>('#sim-mock-error'), 'Fallo simulado 503');
        await typeInto(q<HTMLInputElement>('#sim-mock-delay'), '0');
        await click(q<HTMLButtonElement>('[data-testid="sim-preview"] button'));
        await waitFor(() => (q('[data-testid="sim-toasts"]')?.textContent ?? '').includes('Fallo simulado 503'));

        const backend = log().find((li) => li.dataset.kind === 'backend')!;
        expect(backend.textContent).toContain('Fallo simulado 503');
        expect(backend.textContent).toContain('error');
        expect(q('[data-testid="sim-toasts"]')!.textContent).toContain('CALL_BACKEND error: Fallo simulado 503');
        expect(toastFn.error).not.toHaveBeenCalled(); // el aviso real NO se ejecuta
    });

    it('JSON invalido: muestra el error con su ruta y la vista previa conserva la ultima version valida', async () => {
        await mount(h(Simulator, { type: 'BUTTON' }));
        await click(qa<HTMLButtonElement>('button[role="tab"]').find((b) => b.id === 'sim-tab-json')!);
        const before = q('[data-testid="sim-preview"]')!.textContent;
        expect(before).toBeTruthy();

        await typeInto(q<HTMLTextAreaElement>('#sim-json'), JSON.stringify({ type: 'BUTTON', props: { label: 'X', tone: 'sucsess' } }));
        await flush();
        const issues = q('#sim-issues')!.textContent ?? '';
        expect(issues).toContain('props.tone');
        expect(q('[data-testid="sim-preview"]')!.textContent).toBe(before);

        await typeInto(q<HTMLTextAreaElement>('#sim-json'), '{ "type": "BUTTON", ');
        await flush();
        expect(q('#sim-issues')!.textContent).toMatch(/línea 1/);
        expect(q('[data-testid="sim-preview"]')!.textContent).toBe(before);

        // y al corregirlo se vuelve a renderizar
        await typeInto(q<HTMLTextAreaElement>('#sim-json'), JSON.stringify({ type: 'BUTTON', props: { label: 'Nuevo texto' } }));
        await flush();
        expect(q('[data-testid="sim-preview"]')!.textContent).toContain('Nuevo texto');
    });

    it('el formulario generado del esquema edita el JSON y Restablecer vuelve al preset', async () => {
        await mount(h(Simulator, { type: 'BUTTON' }));
        const label = q<HTMLInputElement>('#sim-f-label')!;
        await typeInto(label, 'Etiqueta editada');
        await flush();
        expect(q('[data-testid="sim-preview"]')!.textContent).toContain('Etiqueta editada');
        await typeInto(q<HTMLSelectElement>('#sim-f-tone'), 'danger');
        await flush();
        await click(qa<HTMLButtonElement>('button').find((b) => b.textContent === 'Restablecer')!);
        await flush();
        expect(q('[data-testid="sim-preview"]')!.textContent).not.toContain('Etiqueta editada');
    });

    it('el estado inicial editable alimenta las expresiones y las condiciones (hidden)', async () => {
        await mount(h(Simulator, { type: 'BUTTON' }));
        await choosePreset('condition-hidden');
        const preview = () => q('[data-testid="sim-preview"]')!;
        expect(qa('button', preview()).length).toBeGreaterThan(0);
        await typeInto(q<HTMLTextAreaElement>('#sim-state'), JSON.stringify({ show: false }));
        await flush();
        // con show:false el boton queda oculto (solo queda el interruptor)
        expect(qa('button', preview()).filter((b) => b.getAttribute('role') !== 'switch').length).toBe(0);
        expect(q('[data-testid="sim-live-state"]')!.textContent).toContain('"show": false');
    });

    it('el contexto simulado cambia con el punto de montaje y el modo compacto solo aplica a las barras', async () => {
        await mount(h(Simulator, { type: 'BUTTON' }));
        const toolbar = q<HTMLSelectElement>('#sim-toolbar')!;
        expect(toolbar.disabled).toBe(false); // EMAIL_TOOLBAR es una barra
        await typeInto(toolbar, 'compact');
        expect(q<HTMLTextAreaElement>('#sim-context')!.value).toContain('"toolbarButtonMode": "compact"');
        await typeInto(q<HTMLSelectElement>('#sim-point'), 'SIDEBAR_PANEL');
        expect(q<HTMLSelectElement>('#sim-toolbar')!.disabled).toBe(true);
        expect(q<HTMLTextAreaElement>('#sim-context')!.value).not.toContain('toolbarButtonMode');
        expect(q<HTMLTextAreaElement>('#sim-context')!.value).toContain('"folder": "INBOX"');
    });

    it('un enlace del componente no navega: se registra como bloqueado', async () => {
        await mount(h(Simulator, { type: 'LINK' }));
        const anchor = q<HTMLAnchorElement>('[data-testid="sim-preview"] a[href]');
        if (!anchor) return; // el primer ejemplo de LINK puede usar solo onClick
        await click(anchor);
        expect(names('interaction')).toContain('navegación bloqueada');
    });
});
