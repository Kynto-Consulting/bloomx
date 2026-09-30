// @vitest-environment jsdom
/**
 * ExtensionIcon: logotipos de marca (color oficial + garantia de contraste con el tema activo), modo monocromo, tamanos fijos,
 * cargando/deshabilitado, respaldo con iniciales, sin imagenes remotas, y KitIcon / ProviderIcon apoyados en el.
 */
import React, { act } from 'react';
import { describe, expect, it } from 'vitest';
import { ExtensionIcon, nearestIconSize, type ExtensionIconSize } from '../ExtensionIcon';
import { KitIcon } from '../kit/Icon';
import { ProviderIcon } from '@/components/conferencing/ProviderIcon';
import { MeetingProviderIcon } from '@/components/MeetingProviderIcon';
import { BRAND_ICONS } from '@/lib/expansions/brand-icons';
import { BRAND_SURFACE_TOKENS } from '@/lib/expansions/icon-ref';
import { contrast, normalizeHex, rgbToHex } from '@/lib/color';
import { THEMES } from '@/lib/themes';
import { installCleanup, kitSuite, mount, q, qa } from '../kit/__tests__/harness';

const h = React.createElement;
const SIZES: ExtensionIconSize[] = [16, 20, 24, 32];

/** Pinta los tokens de un tema en el <html> (como hace el CSS de temas) y espera al MutationObserver. */
async function setTheme(tokens: Record<string, string>) {
    await act(async () => {
        for (const [k, v] of Object.entries(tokens)) document.documentElement.style.setProperty(`--color-${k}`, v);
        await new Promise((r) => setTimeout(r, 0));
    });
}
const clearTheme = () => document.documentElement.removeAttribute('style');
/** jsdom serializa el color en linea como rgb(r, g, b): se normaliza a #rrggbb. */
/** Color de relleno en linea del logotipo (jsdom no expone style.fill: se lee del atributo). */
const fillOf = (svg: Element): string => /fill:\s*([^;]+)/.exec(svg.getAttribute('style') ?? '')?.[1] ?? '';
function cssHex(value: string): string | null {
    const rgb = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/.exec(value.trim());
    return rgb ? rgbToHex({ r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) }) : normalizeHex(value);
}

describe('ExtensionIcon: marca', () => {
    installCleanup();

    it('logotipo: svg viewBox 24 con la ruta del registro, decorativo (aria-hidden) y sin imagenes remotas', async () => {
        await mount(h('button', { 'aria-label': 'Zoom' }, h(ExtensionIcon, { icon: 'brand:zoom' })));
        const wrap = q('[data-extension-icon]')!;
        expect(wrap.getAttribute('aria-hidden')).toBe('true');
        expect(wrap.getAttribute('data-extension-icon')).toBe('brand');
        const svg = q<SVGSVGElement>('svg[data-brand="zoom"]')!;
        expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
        expect(svg.getAttribute('aria-hidden')).toBe('true');
        expect(svg.querySelector('path')!.getAttribute('d')).toBe(BRAND_ICONS.zoom.path);
        expect(document.body.querySelector('img, image, use, foreignObject, script, [href], [src]')).toBeNull();
        // el nombre accesible lo da el boton padre, no el icono
        expect(q('button')!.getAttribute('aria-label')).toBe('Zoom');
        expect(wrap.getAttribute('role')).toBeNull();
    });

    it('Meet y Zoom se distinguen a primera vista: ruta y color distintos', async () => {
        await mount(h('div', null, h(ExtensionIcon, { icon: 'brand:zoom' }), h(ExtensionIcon, { icon: 'brand:googlemeet' })));
        const [zoom, meet] = qa<SVGSVGElement>('svg[data-brand]');
        expect(zoom.querySelector('path')!.getAttribute('d')).not.toBe(meet.querySelector('path')!.getAttribute('d'));
        expect(fillOf(zoom)).not.toBe(fillOf(meet));
    });

    it('dimensiones FIJAS por tamano (16/20/24/32) en cualquier estado: sin salto de maquetacion', async () => {
        for (const size of SIZES) {
            const states = [{}, { loading: true }, { disabled: true }, { mode: 'mono' as const }, { icon: 'lucide:Users' }, { icon: 'no-existe-xyz' }];
            for (const state of states) {
                await mount(h(ExtensionIcon, { icon: 'brand:notion', size, ...state }));
                const box = q('[data-extension-icon]:last-of-type', document.body) ?? qa('[data-extension-icon]').at(-1)!;
                const last = qa('[data-extension-icon]').at(-1)!;
                expect(box).toBeTruthy();
                expect(last.style.width, `${size} ${JSON.stringify(state)}`).toBe(`${size}px`);
                expect(last.style.height).toBe(`${size}px`);
                expect(last.getAttribute('data-size')).toBe(String(size));
            }
        }
        expect(nearestIconSize(14)).toBe(16);
        expect(nearestIconSize(23)).toBe(24);
        expect(nearestIconSize(40)).toBe(32);
    });

    it('modo mono: currentColor, sin ficha ni color en linea', async () => {
        await mount(h('span', { className: 'text-muted-foreground' }, h(ExtensionIcon, { icon: 'brand:hubspot', mode: 'mono' })));
        const svg = q<SVGSVGElement>('svg[data-brand]')!;
        expect(svg.getAttribute('fill')).toBe('currentColor');
        expect(svg.getAttribute('style')).toBeNull();
        expect(q('[data-extension-icon]')!.className).not.toMatch(/bg-card|border/);
        expect(q('[data-extension-icon]')!.getAttribute('data-mode')).toBe('mono');
    });

    it('modo brand: ficha neutra (tarjeta + borde) y color oficial cuando contrasta', async () => {
        clearTheme();
        const light = THEMES.find((t) => t.id === 'light')!.tokens as Record<string, string>;
        await setTheme(light);
        await mount(h(ExtensionIcon, { icon: 'brand:zoom' }));
        expect(q('[data-extension-icon]')!.className).toMatch(/bg-card/);
        expect(q('[data-extension-icon]')!.className).toMatch(/border-border/);
        expect(cssHex(fillOf(q('svg[data-brand]')!))).toBe(BRAND_ICONS.zoom.hex);
        clearTheme();
    });

    it('cargando: spinner ENCIMA con el glifo atenuado; deshabilitado: desaturado', async () => {
        await mount(h('div', null, h(ExtensionIcon, { icon: 'brand:trello', loading: true }), h(ExtensionIcon, { icon: 'brand:trello', disabled: true })));
        const [loading, disabled] = qa('[data-extension-icon]');
        expect(loading.querySelector('[data-extension-icon-loading] svg')).toBeTruthy();
        expect(loading.querySelector('svg[data-brand]')!.parentElement!.className).toMatch(/opacity-30/);
        expect(loading.querySelector('[data-extension-icon-loading] svg')!.getAttribute('class')).toMatch(/animate-spin/);
        expect(disabled.className).toMatch(/grayscale/);
        expect(disabled.className).toMatch(/opacity-50/);
        expect(disabled.querySelector('[data-extension-icon-loading]')).toBeNull();
    });

    it('marca sin logotipo (Slack): ficha neutra con la inicial, sin logotipo inventado', async () => {
        await mount(h(ExtensionIcon, { icon: 'brand:slack' }));
        expect(q('[data-extension-icon]')!.getAttribute('data-extension-icon')).toBe('neutral');
        expect(q('[data-extension-icon]')!.textContent).toBe('S');
        expect(q('svg[data-brand]')).toBeNull();
    });

    it('respaldo: icono no resoluble + etiqueta -> iniciales; sin etiqueta -> rompecabezas; nunca una imagen', async () => {
        await mount(h('div', null,
            h(ExtensionIcon, { icon: 'https://evil.test/logo.png', label: 'Acme Corp' }),
            h(ExtensionIcon, { icon: undefined }),
            h(ExtensionIcon, { icon: 'initials:zx' }),
            h(ExtensionIcon, { icon: 'brand:desconocida' }),
        ));
        const icons = qa('[data-extension-icon]');
        expect(icons[0].textContent).toBe('AC');
        expect(icons[1].getAttribute('data-extension-icon')).toBe('fallback');
        expect(icons[1].querySelector('svg')).toBeTruthy();
        expect(icons[2].textContent).toBe('ZX');
        expect(icons[3].textContent).toBe('D');
        expect(document.body.querySelector('img, image')).toBeNull();
    });

    it('icono Lucide (con y sin prefijo): monocromo, sin ficha', async () => {
        await mount(h('div', null, h(ExtensionIcon, { icon: 'lucide:ShieldCheck' }), h(ExtensionIcon, { icon: 'Languages' })));
        const [a, b] = qa('[data-extension-icon]');
        for (const el of [a, b]) {
            expect(el.getAttribute('data-extension-icon')).toBe('lucide');
            expect(el.querySelector('svg')).toBeTruthy();
            expect(el.className).not.toMatch(/bg-card/);
        }
    });
});

describe('ExtensionIcon: garantia de contraste con el tema ACTIVO', () => {
    installCleanup();

    const fill = () => cssHex(fillOf(q('svg[data-brand]')!));

    it('Notion (negro) se aclara en un tema oscuro y vuelve al oficial al cambiar a uno claro (sin recargar)', async () => {
        clearTheme();
        const dark = THEMES.find((t) => t.scheme === 'dark')!.tokens as Record<string, string>;
        const light = THEMES.find((t) => t.id === 'light')!.tokens as Record<string, string>;
        await setTheme(dark);
        await mount(h(ExtensionIcon, { icon: 'brand:notion' }));
        const onDark = fill()!;
        expect(onDark).not.toBe(BRAND_ICONS.notion.hex);
        for (const token of BRAND_SURFACE_TOKENS) expect(contrast(onDark, dark[token]), token).toBeGreaterThanOrEqual(3);
        await setTheme(light);
        expect(fill()).toBe(BRAND_ICONS.notion.hex);
        clearTheme();
    });

    it('en los 8 temas genericos todos los logotipos se pintan con >= 3:1 sobre las superficies', async () => {
        const slugs = Object.keys(BRAND_ICONS);
        for (const theme of THEMES) {
            clearTheme();
            await setTheme(theme.tokens as Record<string, string>);
            const m = await mount(h('div', null, slugs.map((slug) => h(ExtensionIcon, { key: slug, icon: `brand:${slug}` }))));
            const svgs = qa<SVGSVGElement>('svg[data-brand]', m.container);
            expect(svgs.length).toBe(slugs.length);
            for (const svg of svgs) {
                const color = cssHex(fillOf(svg))!;
                for (const token of BRAND_SURFACE_TOKENS) expect(contrast(color, (theme.tokens as Record<string, string>)[token]), `${theme.id} ${svg.getAttribute('data-brand')} ${token}`).toBeGreaterThanOrEqual(3);
            }
            await m.unmount();
        }
        clearTheme();
    });
});

describe('KitIcon y iconos de proveedor', () => {
    installCleanup();

    it('KitIcon: brand:, initials: y nombres antiguos de apps -> ExtensionIcon; Lucide sigue igual; accesible con label', async () => {
        const m = await mount(h('div', null,
            h(KitIcon, { name: 'brand:zoom', size: 'lg', label: 'Zoom' }),
            h(KitIcon, { name: 'GoogleDrive' }),
            h(KitIcon, { name: 'initials:QA' }),
            h(KitIcon, { name: 'Video' }),
            h(KitIcon, { name: 'lucide:Users' }),
            h(KitIcon, { name: 'NoExisteIcono' }),
        ));
        expect(qa('[data-extension-icon="brand"]').length).toBe(2);
        expect(q('svg[data-brand="googledrive"]')).toBeTruthy();
        expect(q('[role="img"][aria-label="Zoom"]')).toBeTruthy();
        expect(qa('[data-extension-icon="initials"]')[0].textContent).toBe('QA');
        // Lucide y desconocido: sin componente de marca
        const spans = Array.from(m.container.firstElementChild!.children);
        expect(spans.length).toBe(6);
        expect(spans[3].querySelector('[data-extension-icon]')).toBeNull();
        expect(spans[4].querySelector('[data-extension-icon]')).toBeNull();
        expect(spans[5].querySelector('svg')).toBeTruthy();
    });

    it('ProviderIcon: Zoom y Google Meet ya no son dos camaras casi iguales', async () => {
        await mount(h('div', null, h(ProviderIcon, { icon: 'zoom', className: 'h-5 w-5' }), h(ProviderIcon, { icon: 'google-meet' }), h(ProviderIcon, { icon: 'link' }), h(MeetingProviderIcon, { provider: 'teams' }), h(MeetingProviderIcon, { provider: 'zoom' })));
        const zoom = q('[data-provider-icon="zoom"] svg[data-brand]')!;
        const meet = q('[data-provider-icon="google-meet"] svg[data-brand]')!;
        expect(zoom.querySelector('path')!.getAttribute('d')).not.toBe(meet.querySelector('path')!.getAttribute('d'));
        expect(q('[data-provider-icon="zoom"] [data-extension-icon]')!.getAttribute('data-size')).toBe('20');
        expect(q('[data-provider-icon="link"]')!.tagName.toLowerCase()).toBe('svg');
        expect(q('[data-provider-icon="teams"] [data-extension-icon]')!.textContent).toBe('T');
    });
});

// 3 paletas de empresa x claro/oscuro: solo tokens existentes y ningun color en linea (el logotipo de marca es la unica excepcion, verificada arriba).
kitSuite('ExtensionIcon', () => h('div', null,
    h(ExtensionIcon, { icon: 'brand:zoom', size: 24 }),
    h(ExtensionIcon, { icon: 'brand:notion', size: 32 }),
    h(ExtensionIcon, { icon: 'brand:googlemeet', size: 20, loading: true }),
    h(ExtensionIcon, { icon: 'brand:trello', size: 16, disabled: true }),
    h(ExtensionIcon, { icon: 'brand:slack' }),
    h(ExtensionIcon, { icon: 'initials:AB' }),
    h(ExtensionIcon, { icon: 'lucide:Lock', mode: 'mono' }),
));
