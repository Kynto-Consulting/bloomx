// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LandingEditor } from '../LandingEditor';
import { LandingPreview, previewThemeStyle } from '../LandingPreview';
import type { LandingConfig } from '@/lib/landing-config';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

const qa = (sel: string) => Array.from(container.querySelectorAll(sel)) as HTMLElement[];
const byText = (sel: string, text: string | RegExp) =>
    qa(sel).find((e) => (typeof text === 'string' ? e.textContent?.trim() === text : text.test(e.textContent || ''))) as HTMLElement;
function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Editor controlado: guarda lo que emite onChange para inspeccionarlo. */
function Harness({ initial, onEmit, showPreview = false, locale = 'es' as const }: { initial?: LandingConfig; onEmit: (c: LandingConfig) => void; showPreview?: boolean; locale?: 'es' | 'en' }) {
    const [value, setValue2] = useState<LandingConfig>(initial || {});
    return React.createElement(LandingEditor, { value, locale, showPreview, brandName: 'Acme', onChange: (c) => { setValue2(c); onEmit(c); } });
}
function mount(initial: LandingConfig | undefined, showPreview = false, locale: 'es' | 'en' = 'es') {
    const emitted: LandingConfig[] = [];
    act(() => { root.render(React.createElement(Harness, { initial, onEmit: (c) => emitted.push(c), showPreview, locale })); });
    return emitted;
}
const openSection = (title: string | RegExp) => { act(() => { byText('h3 button', typeof title === 'string' ? new RegExp('^' + title) : title).click(); }); };

describe('LandingEditor', () => {
    it('renderiza en es y en en', () => {
        mount(undefined);
        expect(container.textContent).toContain('Pantalla de acceso');
        act(() => root.unmount());
        root = createRoot(container);
        mount(undefined, false, 'en');
        expect(container.textContent).toContain('Sign-in screen');
    });

    it('selector visual de layout: emite el layout elegido', () => {
        const emitted = mount(undefined);
        const radios = qa('[role="radio"]');
        expect(radios).toHaveLength(5);
        expect(radios.find((r) => r.getAttribute('aria-checked') === 'true')?.textContent).toContain('derecha');
        act(() => { byText('[role="radio"]', /Centrado/).click(); });
        expect(emitted.at(-1)).toEqual({ layout: 'center' });
        expect(byText('[role="radio"]', /Centrado/).getAttribute('aria-checked')).toBe('true');
    });

    it('textos por idioma: base y es/en se guardan en su sitio', () => {
        const emitted = mount(undefined);
        openSection('Textos');
        const title = () => qa('input[type="text"]').find((i) => i.id && qa('label').find((l) => l.getAttribute('for') === i.id)?.textContent === 'Título del hero') as HTMLInputElement;
        act(() => setValue(title(), 'Hola'));
        expect(emitted.at(-1)).toEqual({ hero: { title: 'Hola' } });
        act(() => { byText('[role="tab"]', 'EN').click(); });
        act(() => setValue(title(), 'Hello'));
        expect(emitted.at(-1)).toEqual({ hero: { title: 'Hola' }, i18n: { en: { heroTitle: 'Hello' } } });
        // vaciar quita la clave (JSON compacto)
        act(() => setValue(title(), ''));
        expect(emitted.at(-1)).toEqual({ hero: { title: 'Hola' } });
    });

    it('contador de caracteres y validacion en vivo (URL http, HTML)', () => {
        mount({ hero: { title: 'abc', imageUrl: 'http://x.com/a.png' } });
        // aviso global de validacion
        expect(container.textContent).toContain('Solo se admite https');
        // barra de tamano
        expect(qa('[role="progressbar"]')).toHaveLength(1);
        expect(container.textContent).toMatch(/KB/);
    });

    it('testimonios: anadir, editar, reordenar y borrar', () => {
        const emitted = mount({ testimonials: { enabled: true, items: [{ quote: 'Uno', author: 'A' }, { quote: 'Dos', author: 'B' }] } });
        openSection('Testimonios');
        expect(qa('fieldset')).toHaveLength(2);
        // subir el 2o
        act(() => { qa('button').find((b) => b.getAttribute('aria-label') === 'Subir 2')!.click(); });
        expect((emitted.at(-1)!.testimonials!.items!).map((i) => i.quote)).toEqual(['Dos', 'Uno']);
        // borrar el 1o
        act(() => { qa('button').find((b) => b.getAttribute('aria-label') === 'Eliminar 1')!.click(); });
        expect((emitted.at(-1)!.testimonials!.items!).map((i) => i.quote)).toEqual(['Uno']);
        // anadir uno nuevo (queda visible aunque vacio)
        act(() => { byText('button', /Añadir/).click(); });
        expect(qa('fieldset')).toHaveLength(2);
        expect(container.textContent).toContain('2/8');
    });

    it('respeta el maximo de testimonios (8): el boton Anadir se deshabilita', () => {
        mount({ testimonials: { enabled: true, items: Array.from({ length: 8 }, (_, i) => ({ quote: 'q' + i })) } });
        openSection('Testimonios');
        expect((byText('button', /Añadir/) as HTMLButtonElement).disabled).toBe(true);
    });

    it('documentacion y registro: los interruptores emiten docs.* y registration.*', () => {
        const emitted = mount(undefined);
        openSection('Documentación');
        const sw = (label: RegExp) => qa('label').find((l) => label.test(l.textContent || ''))!;
        act(() => { (container.querySelector(`#${sw(/Documentación visible/).getAttribute('for')}`) as HTMLInputElement).click(); });
        expect(emitted.at(-1)).toEqual({ docs: { visible: false } });
        openSection('Registro');
        act(() => { (container.querySelector(`#${sw(/Permitir registro/).getAttribute('for')}`) as HTMLInputElement).click(); });
        expect(emitted.at(-1)).toEqual({ docs: { visible: false }, registration: { enabled: false } });
    });

    it('degradado: activar crea from/to/angle validos', () => {
        const emitted = mount(undefined);
        openSection('Imagen y fondo del hero');
        const toggle = qa('label').find((l) => /Usar degradado/.test(l.textContent || ''))!;
        act(() => { (container.querySelector(`#${toggle.getAttribute('for')}`) as HTMLInputElement).click(); });
        expect(emitted.at(-1)!.hero!.gradient).toEqual({ from: '#1e3a8a', to: '#7c3aed', angle: 135 });
    });
});

describe('LandingPreview', () => {
    it('renderiza el mismo AuthLanding con la config en edicion y cambia de dispositivo/modo', () => {
        act(() => { root.render(React.createElement(LandingPreview, { value: { layout: 'center', hero: { title: 'Vista previa' } }, brandName: 'Acme' })); });
        expect(container.querySelector('[data-landing-layout="center"]')).toBeTruthy();
        expect(container.textContent).toContain('Vista previa');
        const frame = () => container.querySelector('[data-preview-device]') as HTMLElement;
        expect(frame().dataset.previewDevice).toBe('desktop');
        act(() => { byText('button', /Móvil/).click(); });
        expect(frame().dataset.previewDevice).toBe('mobile');
        expect(frame().style.width).toBe('390px');
        act(() => { byText('button', /Oscuro/).click(); });
        expect(frame().dataset.scheme).toBe('dark');
        expect(frame().style.getPropertyValue('--color-background')).toBeTruthy();
    });
    it('los enlaces de la vista previa son inertes y el formulario esta deshabilitado', () => {
        act(() => { root.render(React.createElement(LandingPreview, { value: {} })); });
        for (const a of qa('a')) expect(a.getAttribute('href')).toBe('#');
        for (const i of qa('input')) expect((i as HTMLInputElement).disabled).toBe(true);
    });
    it('muestra las opciones de Google/olvide/recordarme cuando la empresa las activa (demo)', () => {
        act(() => { root.render(React.createElement(LandingPreview, { value: { form: { showGoogle: true, showForgotLink: true, showRememberMe: true } } })); });
        expect(container.textContent).toMatch(/Google/);
        expect(container.textContent).toMatch(/Olvidaste/);
        expect(container.textContent).toMatch(/Recordarme/);
    });
    it('config.locale fuerza el idioma tambien en la vista previa', () => {
        act(() => { root.render(React.createElement(LandingPreview, { locale: 'es', value: { locale: 'en' } })); });
        expect(container.textContent).toContain('Sign in');
    });
    it('previewThemeStyle emite variables --color-* del tema claro/oscuro', () => {
        const light = previewThemeStyle('light') as Record<string, string>;
        const dark = previewThemeStyle('dark') as Record<string, string>;
        expect(light['--color-background']).toBeTruthy();
        expect(dark['--color-background']).not.toBe(light['--color-background']);
    });
});
