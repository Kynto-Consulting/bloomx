// @vitest-environment jsdom
/**
 * Dialogos de extension del compositor, renderizados con los manifests REALES del repo hermano (bloomx-extensions):
 * "Help me write" (composer-helper), "Search GIFs" (giphy) e "Invite to event" (calendar). Se simula el backend y el selector de
 * videoconferencia; se comprueba el comportamiento (estados, acciones, datos enviados) y que no haya colores crudos.
 */
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { toastFn, pickerMeeting } = vi.hoisted(() => ({
    toastFn: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }) as any,
    pickerMeeting: { provider: 'google-meet', joinUrl: 'https://meet.google.com/abc-defg-hij', providerName: 'Google Meet', meetingId: 'abc-defg-hij' },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: toastFn }));
vi.mock('@/lib/expansions/api', () => ({ executeExtensionAction: vi.fn(), fetchExpansions: vi.fn(async () => []) }));
vi.mock('@/components/expansions/ExtensionLoader', () => ({ ExtensionLoader: () => null }));
// El selector real consulta la red; aqui basta un sustituto que devuelve una reunion al pulsar "Crear".
vi.mock('@/components/conferencing/ConferencingPicker', () => ({
    ConferencingPicker: ({ value, onChange, context }: any) => (
        <div data-testid="picker" data-ctx={JSON.stringify(context)}>
            <button type="button" onClick={() => onChange(pickerMeeting)}>crear-meet</button>
            <button type="button" onClick={() => onChange(null)}>quitar</button>
            <span data-testid="picker-value">{value ? value.joinUrl : ''}</span>
        </div>
    ),
}));

import { JsonRenderer } from '../renderer/JsonRenderer';
import { PALETTES, BRAND_MODES, applyBrand, assertThemeSafe, click, flush, installCleanup, mount, q, qa, typeInto } from '../kit/__tests__/harness';

const EXT_ROOT = path.resolve(__dirname, '../../../../../bloomx-extensions');
const available = fs.existsSync(path.join(EXT_ROOT, 'giphy', 'manifest.json'));
const overlayOf = (ext: string, id: string) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(EXT_ROOT, ext, 'manifest.json'), 'utf8'));
    return manifest.mounts.find((m: any) => m.id === id).component;
};
const h = React.createElement;
const textOf = () => document.body.textContent || '';
/** Los SELECT del kit usan el indice de la opcion como valor del <option>: se elige por texto visible. */
const choose = (select: HTMLSelectElement | undefined, text: RegExp) => typeInto(select ?? null, String(Array.from(select?.options ?? []).findIndex((o) => text.test(o.textContent || '')) - 1));
const byLabel = (label: string) => qa<HTMLButtonElement>('button').find((b) => b.textContent?.trim() === label) ?? null;

const callBackend = vi.fn();
const insertBody = vi.fn();
const closeOverlay = vi.fn();
const render = (component: any, context: Record<string, any> = {}) => mount(h(JsonRenderer, {
    component,
    context: { extensionId: 'core-test', insertBody, onClose: closeOverlay, ...context },
    runtime: { callBackend: callBackend as any },
}));

describe.skipIf(!available)('dialogos de extension del compositor (manifests reales)', () => {
    installCleanup();
    beforeEach(() => {
        callBackend.mockReset(); insertBody.mockReset(); closeOverlay.mockReset();
        Object.values(toastFn).forEach((fn: any) => fn?.mockClear?.());
        vi.spyOn(console, 'warn').mockImplementation(() => { });
        vi.spyOn(console, 'error').mockImplementation(() => { });
    });
    afterEach(() => { vi.restoreAllMocks(); });

    describe('Search GIFs (giphy)', () => {
        const gif = (id: string) => ({ id, title: `gif ${id}`, images: { fixed_height_small: { url: `https://media.giphy.com/${id}-s.gif` }, original: { url: `https://media.giphy.com/${id}.gif` } } });

        it('muestra barra de busqueda con lupa, esqueleto al cargar y la rejilla de resultados', async () => {
            let resolve!: (v: any) => void;
            callBackend.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
            await render(overlayOf('giphy', 'giphy-modal'));
            expect(q<HTMLInputElement>('input[type=search]')).toBeTruthy();
            expect(q('svg.lucide-search')).toBeTruthy();
            expect(byLabel('Buscar')).toBeTruthy();
            expect(qa('.animate-pulse').length).toBeGreaterThan(0); // esqueleto
            expect(textOf()).not.toContain('Loading');
            resolve({ success: true, result: { data: [gif('a'), gif('b'), gif('c')] } });
            await flush();
            expect(qa('img').length).toBe(3);
            expect(qa('.animate-pulse').length).toBe(0);
            expect(callBackend.mock.calls[0][1]).toBe('getTrending');
        });

        it('buscar con Enter o con el boton llama a searchGifs con la consulta; insertar un GIF cierra el dialogo', async () => {
            callBackend.mockResolvedValue({ success: true, result: { data: [gif('a')] } });
            await render(overlayOf('giphy', 'giphy-modal'));
            await flush();
            const input = q<HTMLInputElement>('input[type=search]')!;
            await typeInto(input, 'gatos');
            const { act } = await import('react');
            await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
            await flush();
            expect(callBackend).toHaveBeenLastCalledWith('core-test', 'searchGifs', { q: 'gatos' }, expect.anything());
            await click(byLabel('Buscar'));
            await flush();
            expect(callBackend.mock.calls.filter((c) => c[1] === 'searchGifs').length).toBe(2);
            await click(q('img')!.closest('button'));
            expect(insertBody).toHaveBeenCalledWith(expect.stringContaining('https://media.giphy.com/a.gif'));
            expect(closeOverlay).toHaveBeenCalled();
        });

        it('sin resultados: estado vacio; con error de red: aviso con reintento y sin toast', async () => {
            callBackend.mockResolvedValueOnce({ success: true, result: { data: [] } });
            await render(overlayOf('giphy', 'giphy-modal'));
            await flush();
            expect(textOf()).toContain('No se encontraron GIF');
            callBackend.mockResolvedValueOnce({ success: false, error: 'Failed to search Giphy' });
            await click(byLabel('Buscar'));
            await flush();
            expect(textOf()).toContain('No se pudieron cargar los GIF');
            expect(byLabel('Reintentar')).toBeTruthy();
            expect(toastFn.error).not.toHaveBeenCalled();
        });

        it('Giphy sin configurar: explicacion para el admin DENTRO del dialogo (sin toast ni buscador)', async () => {
            callBackend.mockResolvedValue({ success: false, error: 'Giphy is not configured for this domain' });
            await render(overlayOf('giphy', 'giphy-modal'));
            await flush();
            expect(textOf()).toContain('Los GIF no están configurados en este dominio');
            expect(textOf()).toContain('clave de API de Giphy');
            expect(q('input[type=search]')).toBeNull();
            expect(toastFn.error).not.toHaveBeenCalled();
        });
    });

    describe('Help me write (composer-helper)', () => {
        it('textarea con contador, tono y longitud; Generate envia los parametros y muestra la vista previa', async () => {
            callBackend.mockResolvedValue({ success: true, result: { success: true, content: 'Hola Ana,\n\nGracias.' } });
            await render(overlayOf('composer-helper', 'composer-helper-modal'), { subject: 'Contrato', to: ['ana@x.com'], locale: 'es' });
            expect(textOf()).toContain('Ayúdame a escribir');
            const textarea = q<HTMLTextAreaElement>('textarea')!;
            expect(textOf()).toContain('0/2000');
            await typeInto(textarea, 'pide el contrato');
            expect(textOf()).toContain('16/2000');
            const selects = qa<HTMLSelectElement>('select');
            expect(selects.length).toBe(2);
            await choose(selects[0], /Cercano/);
            await click(byLabel('Generar'));
            await flush();
            const [, fn, args] = callBackend.mock.calls[0];
            expect(fn).toBe('generateContent');
            expect(args).toMatchObject({ prompt: 'pide el contrato', tone: 'friendly', length: 'medium', lang: 'es', subject: 'Contrato' });
            expect(textOf()).toContain('Vista previa');
            expect(textOf()).toContain('Gracias.');
            expect(byLabel('Insertar')).toBeTruthy();
            expect(byLabel('Regenerar')).toBeTruthy();
            expect(byLabel('Descartar')).toBeTruthy();
            await click(byLabel('Insertar'));
            expect(insertBody).toHaveBeenCalledWith('Hola Ana,\n\nGracias.');
            expect(closeOverlay).toHaveBeenCalled();
        });

        it('Regenerar vuelve a llamar y Descartar oculta la vista previa', async () => {
            callBackend.mockResolvedValue({ success: true, result: { success: true, content: 'Texto' } });
            await render(overlayOf('composer-helper', 'composer-helper-modal'));
            await typeInto(q<HTMLTextAreaElement>('textarea'), 'algo');
            await click(byLabel('Generar'));
            await flush();
            await click(byLabel('Regenerar'));
            await flush();
            expect(callBackend).toHaveBeenCalledTimes(2);
            await click(byLabel('Descartar'));
            expect(textOf()).not.toContain('Vista previa');
            expect(byLabel('Generar')).toBeTruthy();
        });

        it('un fallo de la IA se muestra como aviso amable dentro del dialogo (sin toast)', async () => {
            callBackend.mockResolvedValue({ success: true, result: { success: false, error: 'AI unavailable' } });
            await render(overlayOf('composer-helper', 'composer-helper-modal'));
            await typeInto(q<HTMLTextAreaElement>('textarea'), 'algo');
            await click(byLabel('Generar'));
            await flush();
            expect(textOf()).toContain('No se pudo generar el texto');
            expect(textOf()).toContain('AI unavailable');
            expect(toastFn.error).not.toHaveBeenCalled();
            callBackend.mockResolvedValue({ success: false, error: 'boom' });
            await click(byLabel('Generar'));
            await flush();
            expect(textOf()).toContain('boom');
            expect(toastFn.error).not.toHaveBeenCalled();
        });
    });

    describe('Invite to event (calendar)', () => {
        const fill = async (start: string, end: string) => {
            // Los selectores de fecha son botones: el valor inicial llega por `state.event` (extractEvent); aqui se simula.
            callBackend.mockImplementation(async (_id: string, fn: string) => fn === 'extractEvent'
                ? { success: true, result: { title: 'Reunion', startsAt: start, endsAt: end } }
                : { success: true, result: { attachment: { filename: 'r.ics' }, subject: 'Invitacion', messageHtml: '<p>x</p>' } });
            await render(overlayOf('calendar', 'calendar-modal'), { emailContent: 'quedamos', timeZone: 'UTC' });
            await flush();
        };

        it('formulario localizado con ubicacion + selector de videoconferencia y selectores de fecha del calendario', async () => {
            await fill('2030-05-06T10:00', '2030-05-06T11:00');
            for (const word of ['Invitar a un evento', 'Comienza', 'Termina', 'Zona horaria', 'Ubicación', 'Descripción', 'Adjuntar .ics', 'Cancelar']) expect(textOf()).toContain(word);
            for (const english of ['Invite To Event', 'Starts', 'Attach .ics']) expect(textOf()).not.toContain(english);
            expect(qa('input[type=datetime-local]').length).toBe(0);
            expect(qa('button[aria-haspopup=dialog]').length).toBe(2);
            expect(q('[data-testid=picker]')).toBeTruthy();
            expect(qa<HTMLSelectElement>('select').some((s) => Array.from(s.options).length > 10)).toBe(true); // zonas horarias
        });

        it('elegir Meet escribe el enlace en Ubicacion y viaja como conferencing; se envia en la zona elegida', async () => {
            await fill('2030-05-06T10:00', '2030-05-06T11:00');
            await click(byLabel('crear-meet'));
            await flush();
            expect(q<HTMLInputElement>('input[name=location]')!.value).toBe(pickerMeeting.joinUrl);
            const tz = qa<HTMLSelectElement>('select').find((s) => Array.from(s.options).some((o) => /^Europe[/]Madrid/.test(o.textContent || '')))!;
            await choose(tz, /^Europe[/]Madrid/);
            await click(byLabel('Adjuntar .ics'));
            await flush();
            const call = callBackend.mock.calls.find((c) => c[1] === 'createEvent')!;
            expect(call[2]).toMatchObject({
                title: 'Reunion',
                location: pickerMeeting.joinUrl,
                timeZone: 'Europe/Madrid',
                startsAt: '2030-05-06T08:00:00.000Z',
                endsAt: '2030-05-06T09:00:00.000Z',
                conferencing: { provider: 'google-meet', joinUrl: pickerMeeting.joinUrl, meetingId: 'abc-defg-hij' },
            });
        });

        it('fin anterior o igual al inicio: error en el campo y no se llama al backend', async () => {
            await fill('2030-05-06T10:00', '2030-05-06T10:00');
            await click(byLabel('Adjuntar .ics'));
            await flush();
            expect(textOf()).toContain('El fin debe ser posterior al inicio');
            expect(callBackend.mock.calls.some((c) => c[1] === 'createEvent')).toBe(false);
        });

        it('Cancelar cierra el dialogo', async () => {
            await fill('2030-05-06T10:00', '2030-05-06T11:00');
            await click(byLabel('Cancelar'));
            expect(closeOverlay).toHaveBeenCalled();
        });
    });

    describe('tema: sin colores crudos en ninguna paleta', () => {
        for (const palette of PALETTES) {
            for (const mode of BRAND_MODES) {
                it(`${palette} / ${mode}`, async () => {
                    const css = applyBrand(palette, mode);
                    callBackend.mockResolvedValue({ success: true, result: { success: true, content: 'Vista', data: [] } });
                    for (const [ext, id] of [['composer-helper', 'composer-helper-modal'], ['giphy', 'giphy-modal'], ['calendar', 'calendar-modal']] as const) {
                        await render(overlayOf(ext, id));
                        await flush();
                    }
                    assertThemeSafe(document.body, css);
                });
            }
        }
    });
});
