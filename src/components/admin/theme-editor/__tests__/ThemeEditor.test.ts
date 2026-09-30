// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const mutateMock = vi.fn(async () => undefined);
vi.mock('swr', async (orig) => ({ ...(await orig<typeof import('swr')>()), mutate: (...a: unknown[]) => (mutateMock as (...x: unknown[]) => unknown)(...a) }));

import { I18nProvider } from '@/components/I18nProvider';
import { ThemeEditor } from '../ThemeEditor';
import { ThemeLivePreview } from '../ThemeLivePreview';
import { previewCssVars } from '../preview-style';
import { buildBrandThemes } from '@/lib/brand-theme';
import type { DomainThemeConfig } from '@/lib/theme-config';

// createElement sin la sobrecarga estricta de children (los proveedores lo reciben como 3er argumento).
const h = React.createElement as unknown as (type: unknown, props: object | null, ...children: unknown[]) => React.ReactElement;

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let puts: { url: string; body: any }[] = [];
let domain: Record<string, unknown>;
let putResponse: { status: number; body: unknown };

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    puts = [];
    mutateMock.mockClear();
    putResponse = { status: 200, body: { success: true } };
    domain = { name: 'acme.com', displayName: 'Acme', logo: '', theme: { palette: { light: { primary: '#1d4ed8', background: '#ffffff' } }, landing: { layout: 'center', hero: { title: 'Hola' } } } };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
            puts.push({ url, body: JSON.parse(String(init.body)) });
            return new Response(JSON.stringify(putResponse.body), { status: putResponse.status });
        }
        return new Response(JSON.stringify(domain), { status: 200 });
    }));
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

const qa = (sel: string) => Array.from(container.querySelectorAll(sel)) as HTMLElement[];
const q = (sel: string) => container.querySelector(sel) as HTMLElement;
const byText = (sel: string, text: string | RegExp) =>
    qa(sel).find((e) => (typeof text === 'string' ? e.textContent?.trim() === text : text.test(e.textContent || ''))) as HTMLElement;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
}
const click = (el: HTMLElement) => act(() => { el.click(); });
const openTab = (label: string) => click(byText('[role=tab]', label));

async function mount(locale: 'es' | 'en' = 'es') {
    act(() => { root.render(h(I18nProvider, { locale }, h(ThemeEditor, {}))); });
    await flush();
}
const hex = (mode: string, token: string) => q(`#tok-${mode}-${token}`) as HTMLInputElement;
const saveBtn = () => byText('button', /^Guardar$|^Save$/) as HTMLButtonElement;
const dirtyText = () => q('[data-testid=dirty-state]').textContent;

describe('ThemeEditor: carga, edicion y guardado', () => {
    it('carga el dominio, muestra las 5 pestanas y arranca sin cambios', async () => {
        await mount();
        expect(qa('[role=tab]').map((t) => t.textContent)).toEqual(['Colores', 'Tipografía y forma', 'Logos', 'Landing', 'Avanzado']);
        expect(dirtyText()).toBe('Sin cambios');
        expect(saveBtn().disabled).toBe(true);
        expect(container.textContent).toContain('acme.com');
        expect(hex('light', 'primary').value).toBe('#1d4ed8');
    });

    it('muestra los 49 tokens agrupados, con indicador explicito/derivado', async () => {
        await mount();
        expect(qa('input[id^="tok-light-"]')).toHaveLength(49);
        expect(q('#tok-light-primary').closest('div.min-w-0')!.querySelector('[data-status]')!.getAttribute('data-status')).toBe('explicit');
        expect(q('#tok-light-sidebar').closest('div.min-w-0')!.querySelector('[data-status]')!.getAttribute('data-status')).toBe('derived');
        expect(container.textContent).toContain('Bandeja: no leído, hover, seleccionado');
        expect(container.textContent).toContain('Barra lateral y cabecera');
    });

    it('editar un token ensucia, Guardar envia el tema COMPLETO (palette + landing) y limpia el estado', async () => {
        await mount();
        act(() => setValue(hex('light', 'sidebar'), '#eef2ff'));
        expect(dirtyText()).toBe('Cambios sin guardar');
        expect(saveBtn().disabled).toBe(false);
        await act(async () => { saveBtn().click(); });
        await flush();
        expect(puts).toHaveLength(1);
        expect(puts[0].url).toBe('/api/admin/domain');
        const b = puts[0].body;
        expect(b.displayName).toBe('Acme');
        expect(b.theme.palette.light).toMatchObject({ primary: '#1d4ed8', background: '#ffffff', sidebar: '#eef2ff' });
        expect(b.theme.landing).toMatchObject({ layout: 'center', hero: { title: 'Hola' } });
        expect(Object.keys(b.theme).some((k) => /Color$/.test(k))).toBe(false);
        expect(dirtyText()).not.toBe('Cambios sin guardar');
        expect(mutateMock).toHaveBeenCalledWith('/api/config');
    });

    it('restablecer a derivado quita el valor explicito de ese token', async () => {
        await mount();
        act(() => setValue(hex('light', 'sidebar'), '#eef2ff'));
        expect(hex('light', 'sidebar').value).toBe('#eef2ff');
        const reset = qa('button').find((b) => b.getAttribute('aria-label') === 'Restablecer a derivado: Barra lateral')!;
        click(reset);
        expect(q('#tok-light-sidebar').closest('div.min-w-0')!.querySelector('[data-status]')!.getAttribute('data-status')).toBe('derived');
        expect(dirtyText()).toBe('Sin cambios');
    });

    it('hex invalido no cambia el tema y muestra el error accesible', async () => {
        await mount();
        act(() => setValue(hex('light', 'primary'), '#12'));
        expect(q('#tok-light-primary-err').textContent).toContain('Hex no válido');
        expect(hex('light', 'primary').getAttribute('aria-invalid')).toBe('true');
        expect(dirtyText()).toBe('Sin cambios');
    });

    it('deshacer y rehacer', async () => {
        await mount();
        act(() => setValue(hex('light', 'sidebar'), '#eef2ff'));
        const undo = qa('button').find((b) => b.getAttribute('aria-label') === 'Deshacer') as HTMLButtonElement;
        const redo = qa('button').find((b) => b.getAttribute('aria-label') === 'Rehacer') as HTMLButtonElement;
        expect(undo.disabled).toBe(false);
        click(undo);
        expect(dirtyText()).toBe('Sin cambios');
        expect(redo.disabled).toBe(false);
        click(redo);
        expect(dirtyText()).toBe('Cambios sin guardar');
    });

    it('cambios sin guardar registran beforeunload; sin cambios no', async () => {
        const add = vi.spyOn(window, 'addEventListener');
        await mount();
        expect(add.mock.calls.some((c) => c[0] === 'beforeunload')).toBe(false);
        act(() => setValue(hex('light', 'sidebar'), '#eef2ff'));
        expect(add.mock.calls.some((c) => c[0] === 'beforeunload')).toBe(true);
        add.mockRestore();
    });

    it('error del servidor: se conserva el estado sucio y se ubica el campo', async () => {
        putResponse = { status: 400, body: { error: 'Invalid logo (use https URL, relative path or PNG/JPEG/WebP/GIF data URI)' } };
        await mount();
        act(() => setValue(hex('light', 'sidebar'), '#eef2ff'));
        await act(async () => { saveBtn().click(); });
        await flush();
        expect(dirtyText()).toBe('Cambios sin guardar');
        expect(q('[data-testid=save-errors]').textContent).toContain('logo');
        expect(mutateMock).not.toHaveBeenCalled();
    });

    it('Restablecer a valores por defecto: confirma, limpia colores y conserva landing', async () => {
        await mount();
        click(byText('button', 'Restablecer a valores por defecto'));
        expect(q('[role=dialog]')).toBeTruthy();
        click(byText('[role=dialog] button', 'Restablecer'));
        expect(dirtyText()).toBe('Cambios sin guardar');
        await act(async () => { saveBtn().click(); });
        await flush();
        expect(puts[0].body.theme).toEqual({ landing: { layout: 'center', hero: { title: 'Hola' } } });
    });

    it('carga con campos ANTIGUOS: se migran a palette sin marcar cambios', async () => {
        domain = { name: 'x.com', displayName: 'X', theme: { primaryColor: '#7c3aed', backgroundColor: '#faf5ff', textColor: '#2e1065' } };
        await mount();
        expect(dirtyText()).toBe('Sin cambios');
        expect(hex('light', 'primary').value).toBe('#7c3aed');
        act(() => setValue(hex('light', 'sidebar'), '#eef2ff'));
        await act(async () => { saveBtn().click(); });
        await flush();
        expect(puts[0].body.theme.primaryColor).toBeUndefined();
        expect(puts[0].body.theme.palette.light.primary).toBe('#7c3aed');
    });

    it('en ingles', async () => {
        await mount('en');
        expect(qa('[role=tab]').map((t) => t.textContent)).toEqual(['Colors', 'Typography and shape', 'Logos', 'Landing', 'Advanced']);
        expect(container.textContent).toContain('From 3 colors');
    });

    it('error de carga ofrece reintentar', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
        await mount();
        expect(q('[role=alert]').textContent).toContain('No se pudo cargar');
        expect(byText('button', 'Reintentar')).toBeTruthy();
    });
});

describe('ThemeEditor: contraste, generador y presets', () => {
    it('aviso de contraste en vivo con valor corregido y "Aplicar correccion"', async () => {
        domain = { name: 'a.com', displayName: 'A', theme: { palette: { light: { primary: '#ffb6c1', background: '#ffffff' } }, autoFixContrast: false } };
        await mount();
        const status = q('[data-testid=contrast-status]');
        expect(status.getAttribute('aria-live')).toBe('polite');
        const item = qa('[data-token=primary][data-mode=light]')[0];
        expect(item).toBeTruthy();
        expect(item.textContent).toContain('#ffb6c1');
        click(byText('[data-token=primary][data-mode=light] button', 'Aplicar corrección'));
        expect(qa('[data-token=primary][data-mode=light]')).toHaveLength(0);
        expect(hex('light', 'primary').value).not.toBe('#ffb6c1');
        expect(dirtyText()).toBe('Cambios sin guardar');
    });

    it('interruptor autoFixContrast: apagado se envia false', async () => {
        await mount();
        click(qa('button[role=switch]').find((b) => b.getAttribute('aria-checked') === 'true')!);
        await act(async () => { saveBtn().click(); });
        await flush();
        expect(puts[0].body.theme.autoFixContrast).toBe(false);
    });

    it('generador desde 3 colores rellena ambos modos', async () => {
        await mount();
        act(() => setValue(q('#gen-primary') as HTMLInputElement, '#047857'));
        act(() => setValue(q('#gen-background') as HTMLInputElement, '#f0fdf4'));
        act(() => setValue(q('#gen-text') as HTMLInputElement, '#052e16'));
        click(byText('button', 'Generar paleta'));
        await act(async () => { saveBtn().click(); });
        await flush();
        const pal = puts[0].body.theme.palette;
        expect(pal.light.background).toBe('#f0fdf4');
        expect(pal.dark.background).toBeTruthy();
        expect(pal.dark.background).not.toBe('#f0fdf4');
    });

    it('un preset aplica paleta, radio y fuente', async () => {
        await mount();
        click(q('[data-preset=violet]'));
        await act(async () => { saveBtn().click(); });
        await flush();
        expect(puts[0].body.theme).toMatchObject({ radius: 'xl', fontFamily: 'rounded' });
        expect(puts[0].body.theme.palette.dark.primary).toBeTruthy();
    });

    it('el conmutador de modo cambia los campos al modo oscuro', async () => {
        await mount();
        click(byText('button[aria-pressed]', 'Oscuro'));
        expect(qa('input[id^="tok-dark-"]')).toHaveLength(49);
    });
});

describe('ThemeEditor: vista previa fiel', () => {
    it('refleja los cambios al instante (variables CSS del contenedor)', async () => {
        await mount();
        const frame = () => q('[data-preview-scene]') as HTMLElement;
        expect(frame().style.getPropertyValue('--color-primary')).toBe('#1d4ed8');
        act(() => setValue(hex('light', 'primary'), '#047857'));
        expect(frame().style.getPropertyValue('--color-primary')).toBe('#047857');
        act(() => setValue(hex('light', 'unread'), '#fff7ed'));
        expect(frame().style.getPropertyValue('--color-unread')).toBe('#fff7ed');
        expect(frame().querySelector('[data-row=unread]')!.className).toContain('bg-unread');
        expect(frame().querySelector('[data-row=hover]')!.className).toContain('bg-row-hover');
        expect(frame().querySelector('[data-row=selected]')!.className).toContain('bg-row-selected');
        expect(frame().querySelector('aside')!.className).toContain('bg-sidebar');
    });

    it('modo oscuro, dispositivo y pantallas', async () => {
        await mount();
        const frame = () => q('[data-preview-scene]') as HTMLElement;
        const lightBg = frame().style.getPropertyValue('--color-background');
        click(qa('[data-testid=theme-live-preview] button').find((b) => b.textContent === 'Oscuro')!);
        expect(frame().getAttribute('data-scheme')).toBe('dark');
        expect(frame().style.getPropertyValue('--color-background')).not.toBe(lightBg);
        click(qa('[data-testid=theme-live-preview] button').find((b) => b.textContent === 'Móvil')!);
        expect(frame().getAttribute('data-preview-device')).toBe('mobile');
        expect(frame().querySelector('aside')).toBeNull();
        for (const [label, needle] of [['Redactar', 'Mensaje nuevo'], ['Diálogo', 'Eliminar dominio'], ['Componentes', 'Formulario']] as const) {
            click(qa('[data-testid=theme-live-preview] button').find((b) => b.textContent === label)!);
            expect(frame().textContent).toContain(needle);
        }
    });

    it('radio y fuente de la empresa llegan al contenedor', () => {
        const style = previewCssVars('light', { palette: { light: { primary: '#123456' } }, radius: 'xl', fontFamily: 'serif' } as DomainThemeConfig) as Record<string, string>;
        expect(style['--radius']).toBe('1rem');
        expect(style['--radius-xl']).toBe('1.25rem');
        expect(style['--font-body']).toContain('Georgia');
        const none = previewCssVars('light', { radius: 'none' } as DomainThemeConfig) as Record<string, string>;
        expect(none['--radius-md']).toBe('0rem');
    });

    it('usa EXACTAMENTE los tokens que genera buildBrandThemes', () => {
        const cfg = { palette: { light: { primary: '#0f766e' }, dark: { background: '#0b1220' } } } as DomainThemeConfig;
        const bt = buildBrandThemes(cfg, { name: 'X' })!;
        for (const m of ['light', 'dark'] as const) {
            const st = previewCssVars(m, cfg, 'X') as Record<string, string>;
            for (const [k, v] of Object.entries(bt[m].tokens)) expect(st[`--color-${k}`]).toBe(v);
        }
    });

    it('ThemeLivePreview aislado se monta solo con tema, nombre y modo', () => {
        act(() => {
            root.render(h(I18nProvider, { locale: 'es' }, h(ThemeLivePreview, { theme: {}, name: 'Zeta', mode: 'light', onModeChange: () => { } })));
        });
        expect(container.textContent).toContain('Zeta');
    });
});

describe('ThemeEditor: logos, politica y importacion', () => {
    it('logo no https muestra error por campo y bloquea el guardado', async () => {
        await mount();
        openTab('Logos');
        const light = qa('input[type=url]')[0] as HTMLInputElement;
        act(() => setValue(light, 'http://cdn.acme.com/logo.png'));
        expect(container.textContent).toContain('Debe ser una URL https://');
        expect(light.getAttribute('aria-invalid')).toBe('true');
        // favicon invalido: error bloqueante
        const fav = qa('input[type=url]')[2] as HTMLInputElement;
        act(() => setValue(fav, 'javascript:alert(1)'));
        await act(async () => { saveBtn().click(); });
        await flush();
        expect(puts).toHaveLength(0);
        expect(q('[data-testid=save-errors]').textContent).toContain('logo');
    });

    it('logos claro/oscuro/altura/nombre se guardan en theme.landing.logo y el favicon en logo', async () => {
        await mount();
        openTab('Logos');
        const [light, dark, fav] = qa('input[type=url]') as HTMLInputElement[];
        act(() => setValue(light, 'https://cdn.acme.com/l.png'));
        act(() => setValue(dark, 'https://cdn.acme.com/d.png'));
        act(() => setValue(fav, 'https://cdn.acme.com/f.png'));
        act(() => setValue(q('input[type=range]') as HTMLInputElement, '48'));
        click(qa('button[role=switch]').find((b) => b.getAttribute('aria-checked') === 'true')!);
        await act(async () => { saveBtn().click(); });
        await flush();
        const b = puts[0].body;
        expect(b.logo).toBe('https://cdn.acme.com/f.png');
        expect(b.theme.landing.logo).toMatchObject({ light: 'https://cdn.acme.com/l.png', dark: 'https://cdn.acme.com/d.png', height: 48, showName: false });
        expect(b.theme.landing.layout).toBe('center');
    });

    it('lockBrand y allowedThemes se envian; no se puede quitar el ultimo tema', async () => {
        await mount();
        openTab('Avanzado');
        const box = (label: RegExp) => qa('input[type=checkbox]').find((c) => label.test((c.nextElementSibling as HTMLElement)?.textContent || '')) as HTMLInputElement;
        click(box(/^Midnight/i) ?? qa('input[type=checkbox]')[2]);
        click(byText('button[role=switch]', '') ?? qa('button[role=switch]')[0]);
        await act(async () => { saveBtn().click(); });
        await flush();
        const th = puts[0].body.theme;
        expect(th.lockBrand).toBe(true);
        expect(Array.isArray(th.allowedThemes)).toBe(true);
        expect(th.allowedThemes).not.toContain('midnight');
    });

    it('defaultMode', async () => {
        await mount();
        openTab('Avanzado');
        click(byText('[role=tabpanel] button[aria-pressed]', 'Oscuro'));
        await act(async () => { saveBtn().click(); });
        await flush();
        expect(puts[0].body.theme.defaultMode).toBe('dark');
    });

    it('importar JSON hostil: valida, muestra issues y solo aplica lo saneado', async () => {
        await mount();
        openTab('Avanzado');
        const ta = q('textarea') as HTMLTextAreaElement;
        act(() => setValue(ta, JSON.stringify({
            palette: { light: { primary: '#0f766e', background: 'url(javascript:alert(1))', evil: '#000000' } },
            radius: 'lg', fontFamily: '</style><script>alert(1)</script>', primaryColor: 'red;}body{display:none}', extra: 1,
        })));
        click(byText('button', 'Validar'));
        const status = q('[data-testid=import-status]');
        expect(status.textContent).toContain('JSON válido');
        expect(status.textContent).toContain('campo desconocido');
        click(byText('button', 'Aplicar importación'));
        await act(async () => { saveBtn().click(); });
        await flush();
        const body = JSON.stringify(puts[0].body);
        expect(body).not.toMatch(/script|javascript|display:none|evil/i);
        expect(puts[0].body.theme.radius).toBe('lg');
        expect(puts[0].body.theme.palette.light.primary).toBe('#0f766e');
        expect(puts[0].body.theme.landing.layout).toBe('center');
    });

    it('importar basura muestra el error sin cambiar nada', async () => {
        await mount();
        openTab('Avanzado');
        act(() => setValue(q('textarea') as HTMLTextAreaElement, '{no json'));
        click(byText('button', 'Validar'));
        expect(q('[data-testid=import-status]').textContent).toContain('No es un JSON válido');
        expect((byText('button', 'Aplicar importación') as HTMLButtonElement).disabled).toBe(true);
        expect(dirtyText()).toBe('Sin cambios');
    });

    it('exportar produce el JSON saneado del tema', async () => {
        await mount();
        openTab('Avanzado');
        Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
        await act(async () => { byText('button', 'Exportar y copiar').click(); });
        const parsed = JSON.parse((q('textarea') as HTMLTextAreaElement).value);
        expect(parsed.palette.light.primary).toBe('#1d4ed8');
        expect(parsed.landing.layout).toBe('center');
    });

    it('la pestana Landing monta el LandingEditor con su vista previa y comparte el estado', async () => {
        await mount();
        openTab('Landing');
        expect(container.textContent).toContain('Pantalla de acceso');
        expect(q('[data-preview-device]')).toBeTruthy();
        expect(q('[aria-label="Vista previa de la pantalla de acceso"]')).toBeTruthy();
    });
});
