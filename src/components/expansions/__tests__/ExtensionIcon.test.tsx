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
/** Color en linea del placeholder de marca (jsdom lo serializa en el atributo style). */
const fillOf = (el: Element): string => /(?:^|;|\s)color:\s*([^;]+)/.exec(el.getAttribute('style') ?? '')?.[1] ?? '';
/** Letras del placeholder (van en data-initial, no como texto del DOM: no contaminan el nombre accesible del contenedor). */
const letters = (el: Element): string => [el, ...Array.from(el.querySelectorAll('[data-initial]'))].map((n) => n.getAttribute('data-initial') ?? '').join('');
const BACKEND = 'https://backend.bloomx.arubik.dev';
const fire = async (el: Element, type: 'load' | 'error') => { await act(async () => { el.dispatchEvent(new Event(type)); }); };
const PNG_1PX = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]).toString('base64')}`;
const svgData = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
function cssHex(value: string): string | null {
    const rgb = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/.exec(value.trim());
    return rgb ? rgbToHex({ r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) }) : normalizeHex(value);
}

describe('ExtensionIcon: marca', () => {
    installCleanup();

    it('marca: placeholder instantaneo (inicial en el color de marca), decorativo, y <img> async del backend (sin dibujo en el bundle)', async () => {
        await mount(h('button', { 'aria-label': 'Zoom' }, h(ExtensionIcon, { icon: 'brand:zoom' })));
        const wrap = q('[data-extension-icon]')!;
        expect(wrap.getAttribute('aria-hidden')).toBe('true');
        expect(wrap.getAttribute('data-extension-icon')).toBe('brand');
        const placeholder = q('[data-brand="zoom"]')!;
        expect(letters(placeholder)).toBe('Z');
        expect(placeholder.querySelector('path')).toBeNull();
        const img = q<HTMLImageElement>('img[data-extension-icon-img]')!;
        expect(img.getAttribute('src')).toBe(`${BACKEND}/api/extensions/icons/brand.zoom`);
        expect(img.getAttribute('loading')).toBe('lazy');
        expect(img.getAttribute('decoding')).toBe('async');
        expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
        expect(img.getAttribute('alt')).toBe('');
        expect(img.getAttribute('aria-hidden')).toBe('true');
        expect(document.body.querySelector('use, foreignObject, script, [href]')).toBeNull();
        expect(q('button')!.getAttribute('aria-label')).toBe('Zoom');
        expect(wrap.getAttribute('role')).toBeNull();
    });

    it('placeholder -> img cargada: el placeholder se oculta (invisible, mantiene el espacio) y la imagen aparece', async () => {
        await mount(h(ExtensionIcon, { icon: 'brand:trello', iconUrl: '/api/extensions/icons/core-trello?h=0123456789abcdef' }));
        const img = q<HTMLImageElement>('img[data-extension-icon-img]')!;
        expect(img.getAttribute('src')).toBe(`${BACKEND}/api/extensions/icons/core-trello?h=0123456789abcdef`); // iconUrl gana a brand.<slug>
        expect(img.className).toMatch(/opacity-0/);
        expect(q('[data-brand="trello"]')!.parentElement!.className).not.toMatch(/invisible/);
        await fire(img, 'load');
        expect(q('img[data-extension-icon-img]')!.className).toMatch(/opacity-100/);
        expect(q('[data-brand="trello"]')!.parentElement!.className).toMatch(/invisible/);
        expect(q<HTMLElement>('[data-extension-icon]')!.style.width).toBe('24px');
    });

    it('error de carga (404/red): se retira la imagen y queda el placeholder; sin saltos', async () => {
        await mount(h(ExtensionIcon, { icon: 'brand:giphy', iconUrl: '/api/extensions/icons/core-giphy?h=aaaaaaaaaaaaaaaa', size: 32 }));
        await fire(q('img[data-extension-icon-img]')!, 'error');
        expect(q('img')).toBeNull();
        expect(q('[data-brand="giphy"]')!.parentElement!.className).not.toMatch(/invisible/);
        expect(q<HTMLElement>('[data-extension-icon]')!.style.width).toBe('32px');
    });

    it('iconUrl invalido o de otro origen se ignora (solo rutas del backend)', async () => {
        await mount(h('div', null,
            h(ExtensionIcon, { icon: 'lucide:Zap', iconUrl: 'https://evil.test/x.svg' }),
            h(ExtensionIcon, { icon: 'lucide:Zap', iconUrl: '/api/extensions/icons/../../x' }),
            h(ExtensionIcon, { icon: 'lucide:Zap', iconUrl: 'javascript:alert(1)' }),
        ));
        expect(q('img')).toBeNull();
    });

    it('sin iconUrl, un lucide: no pide imagen; con iconUrl, la imagen sustituye al Lucide al cargar', async () => {
        await mount(h(ExtensionIcon, { icon: 'lucide:Zap' }));
        expect(q('img')).toBeNull();
        await mount(h(ExtensionIcon, { icon: 'lucide:Zap', iconUrl: '/api/extensions/icons/core-dlp?h=bbbbbbbbbbbbbbbb' }));
        expect(qa('img').length).toBe(1);
    });

    it('data URL valido (png/svg): imagen directa; invalido (prefijo, firma, tamano, SVG activo): respaldo de letra, sin <img>', async () => {
        await mount(h(ExtensionIcon, { icon: PNG_1PX, label: 'Acme' }));
        expect(q<HTMLImageElement>('img')!.getAttribute('src')).toBe(PNG_1PX);
        await mount(h(ExtensionIcon, { icon: svgData('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>'), label: 'Acme' }));
        expect(qa('img').length).toBe(2);
        const bad = [
            'data:text/html;base64,PHNjcmlwdD4=',
            'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
            'data:image/png;base64,AAAAAAAAAAAAAAAA', // sin firma PNG
            svgData('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
            svgData('<svg xmlns="http://www.w3.org/2000/svg"><path onload="x()" d="M0 0"/></svg>'),
            `data:image/png;base64,${Buffer.alloc(70 * 1024, 1).toString('base64')}`, // > 64 KB
        ];
        for (const icon of bad) {
            await mount(h(ExtensionIcon, { icon, label: 'Acme Corp' }));
            const el = qa('[data-extension-icon]').at(-1)!;
            expect(letters(el), icon.slice(0, 30)).toBe('AC');
            expect(el.querySelector('img')).toBeNull();
        }
    });

    it('modo oscuro: SVG de data URL con currentColor hereda el color de texto del tema; los de marca con colores propios no se tocan', async () => {
        const mono = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M0 0h24v24H0z"/></svg>';
        const brand = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#0b5cff" d="M0 0h24v24H0z"/></svg>';
        const decode = (src: string) => Buffer.from(src.split(',')[1], 'base64').toString();
        await setTheme({ foreground: '#f1f5f9', background: '#0b1020', card: '#111827', muted: '#1f2937', accent: '#1f2937' });
        await mount(h('div', null, h(ExtensionIcon, { icon: svgData(mono) }), h(ExtensionIcon, { icon: svgData(brand) })));
        const [m, b] = qa<HTMLImageElement>('img');
        expect(decode(m.getAttribute('src')!)).toContain('fill="#f1f5f9"');
        expect(decode(m.getAttribute('src')!)).not.toMatch(/currentColor/);
        expect(b.getAttribute('src')).toBe(svgData(brand));
        await setTheme({ foreground: '#0f172a', background: '#ffffff', card: '#ffffff', muted: '#f1f5f9', accent: '#f1f5f9' });
        expect(decode(qa<HTMLImageElement>('img')[0].getAttribute('src')!)).toContain('fill="#0f172a"');
        clearTheme();
    });

    it('modo mono: un icono remoto con colores propios NO se recolorea (queda el placeholder monocromo, sin <img>)', async () => {
        await mount(h(ExtensionIcon, { icon: 'brand:zoom', mode: 'mono', iconUrl: '/api/extensions/icons/core-zoom?h=cccccccccccccccc' }));
        expect(q('img')).toBeNull();
        expect(q('[data-brand="zoom"]')!.getAttribute('style')).toBeNull();
    });

    it('Meet y Zoom se distinguen a primera vista: color distinto en el placeholder y URL distinta', async () => {
        await mount(h('div', null, h(ExtensionIcon, { icon: 'brand:zoom' }), h(ExtensionIcon, { icon: 'brand:googlemeet' })));
        const [zoom, meet] = qa('[data-brand]');
        expect(fillOf(zoom)).not.toBe(fillOf(meet));
        const [i1, i2] = qa('img');
        expect(i1.getAttribute('src')).not.toBe(i2.getAttribute('src'));
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

    it('modo mono: sin ficha ni color en linea (hereda el color de texto)', async () => {
        await mount(h('span', { className: 'text-muted-foreground' }, h(ExtensionIcon, { icon: 'brand:hubspot', mode: 'mono' })));
        const mark = q('[data-brand]')!;
        expect(mark.getAttribute('style')).toBeNull();
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
        expect(cssHex(fillOf(q('[data-brand]')!))).toBe(BRAND_ICONS.zoom.hex);
        clearTheme();
    });

    it('cargando: spinner ENCIMA con el glifo atenuado; deshabilitado: desaturado', async () => {
        await mount(h('div', null, h(ExtensionIcon, { icon: 'brand:trello', loading: true }), h(ExtensionIcon, { icon: 'brand:trello', disabled: true })));
        const [loading, disabled] = qa('[data-extension-icon]');
        expect(loading.querySelector('[data-extension-icon-loading] svg')).toBeTruthy();
        expect(loading.querySelector('[data-brand]')!.closest('.transition-opacity')!.className).toMatch(/opacity-30/);
        expect(loading.querySelector('[data-extension-icon-loading] svg')!.getAttribute('class')).toMatch(/animate-spin/);
        expect(disabled.className).toMatch(/grayscale/);
        expect(disabled.className).toMatch(/opacity-50/);
        expect(disabled.querySelector('[data-extension-icon-loading]')).toBeNull();
    });

    it('slack, teams y discord sin iconUrl propio: el catalogo pide brand.<slug> al backend (logo, sin letra en el texto)', async () => {
        await mount(h('div', null, ...['brand:slack', 'brand:microsoftteams', 'brand:discord'].map((icon) => h(ExtensionIcon, { key: icon, icon, size: 32 }))));
        const srcs = qa<HTMLImageElement>('img[data-extension-icon-img]').map((i) => i.getAttribute('src'));
        expect(srcs).toEqual(['slack', 'microsoftteams', 'discord'].map((slug) => `${BACKEND}/api/extensions/icons/brand.${slug}`));
        expect(document.body.textContent).toBe('');
    });

    it('marca sin logotipo (Salesforce): ficha neutra con la inicial, sin logotipo inventado', async () => {
        await mount(h(ExtensionIcon, { icon: 'brand:salesforce' }));
        expect(q('[data-extension-icon]')!.getAttribute('data-extension-icon')).toBe('neutral');
        expect(letters(q('[data-extension-icon]')!)).toBe('S');
        expect(q('[data-brand]')).toBeNull();
        expect(q('img')).toBeNull();
    });

    it('respaldo: icono no resoluble + etiqueta -> iniciales; sin etiqueta -> rompecabezas; nunca una imagen', async () => {
        await mount(h('div', null,
            h(ExtensionIcon, { icon: 'https://evil.test/logo.png', label: 'Acme Corp' }),
            h(ExtensionIcon, { icon: undefined }),
            h(ExtensionIcon, { icon: 'initials:zx' }),
            h(ExtensionIcon, { icon: 'brand:desconocida' }),
        ));
        const icons = qa('[data-extension-icon]');
        expect(letters(icons[0])).toBe('AC');
        expect(icons[1].getAttribute('data-extension-icon')).toBe('fallback');
        expect(icons[1].querySelector('svg')).toBeTruthy();
        expect(letters(icons[2])).toBe('ZX');
        expect(letters(icons[3])).toBe('D');
        expect(document.body.querySelector('img, image')).toBeNull(); // una URL arbitraria en `icon` nunca se carga
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

    const fill = () => cssHex(fillOf(q('[data-brand]')!));

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
            const svgs = qa('[data-brand]', m.container);
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
        expect(q('[data-brand="googledrive"]')).toBeTruthy();
        expect(q('[role="img"][aria-label="Zoom"]')).toBeTruthy();
        expect(letters(qa('[data-extension-icon="initials"]')[0])).toBe('QA');
        // Lucide y desconocido: sin componente de marca
        const spans = Array.from(m.container.firstElementChild!.children);
        expect(spans.length).toBe(6);
        expect(spans[3].querySelector('[data-extension-icon]')).toBeNull();
        expect(spans[4].querySelector('[data-extension-icon]')).toBeNull();
        expect(spans[5].querySelector('svg')).toBeTruthy();
    });

    it('ProviderIcon: Zoom y Google Meet ya no son dos camaras casi iguales', async () => {
        await mount(h('div', null, h(ProviderIcon, { icon: 'zoom', className: 'h-5 w-5' }), h(ProviderIcon, { icon: 'google-meet' }), h(ProviderIcon, { icon: 'link' }), h(MeetingProviderIcon, { provider: 'teams' }), h(MeetingProviderIcon, { provider: 'zoom' })));
        const zoom = q('[data-provider-icon="zoom"] [data-brand]')!;
        const meet = q('[data-provider-icon="google-meet"] [data-brand]')!;
        expect(zoom.getAttribute('style')).not.toBe(meet.getAttribute('style'));
        expect(q('[data-provider-icon="zoom"] [data-extension-icon]')!.getAttribute('data-size')).toBe('20');
        expect(q('[data-provider-icon="link"]')!.tagName.toLowerCase()).toBe('svg');
        expect(q('[data-provider-icon="teams"] [data-extension-icon]')!.getAttribute('data-extension-icon')).toBe('brand');
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
