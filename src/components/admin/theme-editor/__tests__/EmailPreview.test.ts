// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '@/components/I18nProvider';
import { getEmailBrand } from '@/lib/calendar/email-brand';
import { contrast } from '@/lib/color';
import { EMAIL_PREVIEW_VARIANTS, EmailPreview, buildEmailPreviewHtml } from '../EmailPreview';
import { docFromDomain } from '../model';

const h = React.createElement as unknown as (type: unknown, props: object | null, ...children: unknown[]) => React.ReactElement;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LOGO = 'https://cdn.acme.example/logo.png';
const NOW = new Date('2030-01-10T12:00:00Z');

describe('buildEmailPreviewHtml: las mismas plantillas que los envios reales', () => {
    const brand = getEmailBrand({ displayName: 'Acme', theme: { palette: { light: { primary: '#7c3aed' } }, landing: { logo: { light: LOGO }, footer: { text: 'Av. 1' } } } });

    for (const variant of EMAIL_PREVIEW_VARIANTS) {
        for (const locale of ['es', 'en'] as const) {
            it(`${variant}/${locale}: marca, logo e idioma`, () => {
                const html = buildEmailPreviewHtml({ variant, brand, locale, scheme: 'light', now: NOW });
                expect(html).toContain(`<html lang="${locale}"`);
                expect(html).toContain(`<img src="${LOGO}" alt="Acme"`);
                expect(html).toContain('#7c3aed');
                expect(html).toContain('Av. 1');
                expect(html).not.toMatch(/undefined|\[object|\{actor\}/);
                expect(html).toContain(locale === 'es' ? 'Cuándo' : '>When<');
            });
        }
    }

    it('cada variante usa su plantilla: invitacion, confirmacion (cancelar cita), anfitrion (invitado) y cancelacion (tachada)', () => {
        const get = (variant: (typeof EMAIL_PREVIEW_VARIANTS)[number]) => buildEmailPreviewHtml({ variant, brand, locale: 'en', scheme: 'light', now: NOW });
        expect(get('invitation')).toContain('>Invitation<');
        expect(get('invitation')).toContain('>Join Google Meet</a>');
        expect(get('confirmation')).toContain('>Cancel appointment</a>');
        expect(get('confirmation')).toContain('>Join Zoom</a>');
        expect(get('host')).toContain('>New booking<');
        expect(get('host')).toContain('>Guest<');
        expect(get('cancellation')).toContain('>Cancelled<');
        expect(get('cancellation')).toContain('line-through');
    });

    it('esquema oscuro simulado: las reglas oscuras van sin media query', () => {
        const dark = buildEmailPreviewHtml({ variant: 'invitation', brand, locale: 'es', scheme: 'dark', now: NOW });
        const light = buildEmailPreviewHtml({ variant: 'invitation', brand, locale: 'es', scheme: 'light', now: NOW });
        expect(dark).not.toContain('prefers-color-scheme');
        expect(dark).toContain('.bxm-card{background-color:');
        expect(light).not.toContain('.bxm-card{background-color:');
    });

    it('marca clara sin logo: la cabecera y el boton conservan el tono exacto; el texto encima se elige por contraste; solo el enlace se corrige', () => {
        const yellow = getEmailBrand({ displayName: 'Sol', theme: { palette: { light: { primary: '#ffcc00' } } } });
        const html = buildEmailPreviewHtml({ variant: 'invitation', brand: yellow, locale: 'es', scheme: 'light', now: NOW });
        expect(html).not.toContain('<img');
        expect(html).toContain('>Sol<');
        expect(yellow.color).toBe('#ffcc00');
        expect(html).toContain('bgcolor="#ffcc00"');
        expect(contrast(yellow.color, yellow.onColor)).toBeGreaterThanOrEqual(4.5);
        expect(html).toContain(`color:${yellow.onColor};`);
        // Como texto/enlace sobre blanco se usa la version corregida.
        expect(contrast(yellow.linkColor, '#ffffff')).toBeGreaterThanOrEqual(4.5);
        expect(html).toContain(`color:${yellow.linkColor};`);
    });
});

describe('<EmailPreview>', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => { act(() => root.unmount()); container.remove(); });

    const render = (domain: Record<string, unknown>, locale: 'es' | 'en' = 'es') => {
        const doc = docFromDomain(domain);
        act(() => { root.render(h(I18nProvider, { locale }, h(EmailPreview, { doc }))); });
    };
    const frame = () => container.querySelector('iframe[data-testid="email-preview-frame"]') as HTMLIFrameElement;
    const button = (label: string) => Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
    const click = (label: string) => act(() => { button(label).click(); });

    const domain = { name: 'acme.example', displayName: 'Acme', theme: { palette: { light: { primary: '#7c3aed' } }, landing: { logo: { light: LOGO } } } };

    it('renderiza un iframe sandbox (sin scripts ni same-origin) con srcdoc de la marca elegida', () => {
        render(domain);
        const f = frame();
        expect(f).toBeTruthy();
        expect(f.getAttribute('sandbox')).toBe('');
        expect(f.hasAttribute('src')).toBe(false);
        const srcdoc = f.getAttribute('srcdoc') ?? '';
        expect(srcdoc).toContain(`<img src="${LOGO}" alt="Acme"`);
        expect(srcdoc).toContain('#7c3aed');
        expect(srcdoc).toContain('<html lang="es"');
        expect(container.querySelector('[data-testid="email-brand-color"]')?.textContent).toBe('#7c3aed');
        expect(container.textContent).toContain('Vista previa de correos');
        expect(container.textContent).toContain('Se usa el logo claro');
    });

    it('cambia de variante, idioma, esquema y dispositivo', () => {
        render(domain);
        click('Aviso al anfitrión');
        expect(frame().getAttribute('srcdoc')).toContain('>Nueva reserva<');
        click('Cancelación');
        expect(frame().getAttribute('srcdoc')).toContain('>Evento cancelado<');
        click('Confirmación');
        expect(frame().getAttribute('srcdoc')).toContain('Cancelar cita');
        click('English');
        expect(frame().getAttribute('srcdoc')).toContain('<html lang="en"');
        expect(frame().getAttribute('srcdoc')).toContain('Cancel appointment');
        click('Oscuro');
        expect(frame().getAttribute('srcdoc')).not.toContain('prefers-color-scheme');
        expect(frame().style.width).toBe('680px');
        click('Móvil');
        expect(frame().style.width).toBe('375px');
        click('Escritorio');
        expect(frame().style.width).toBe('680px');
    });

    it('interfaz en ingles y avisos de color/logo', () => {
        render({ name: 'acme.example', displayName: 'Sol', theme: { palette: { light: { primary: '#ffcc00' } } } }, 'en');
        expect(container.textContent).toContain('Email preview');
        expect(container.textContent).toContain('The header and button use your exact color');
        expect(container.querySelector('[data-testid="email-brand-note"]')?.textContent).toMatch(/darkened to #[0-9a-f]{6} to meet AA/);
        expect(container.textContent).toContain('No https logo for light backgrounds');
        expect(button('Invitation')).toBeTruthy();
        expect(frame().getAttribute('title')).toBe('Email preview: Invitation');
        const shown = container.querySelector('[data-testid="email-brand-color"]')?.textContent ?? '';
        expect(shown).toBe('#ffcc00');
    });

    it('el idioma inicial sigue al de la empresa (landing.locale) y la vista se actualiza con la marca', () => {
        render({ ...domain, theme: { ...domain.theme, landing: { logo: { light: LOGO }, locale: 'en' } } });
        expect(frame().getAttribute('srcdoc')).toContain('<html lang="en"');
        render({ ...domain, displayName: 'Nuevo Nombre', theme: { palette: { light: { primary: '#0a1f44' } }, landing: { locale: 'en' } } });
        expect(frame().getAttribute('srcdoc')).toContain('>Nuevo Nombre<');
        expect(frame().getAttribute('srcdoc')).toContain('#0a1f44');
    });
});
