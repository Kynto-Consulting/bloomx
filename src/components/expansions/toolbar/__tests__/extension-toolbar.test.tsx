// @vitest-environment jsdom
/**
 * Barra de acciones de extensiones: iconos compactos anclados + menu "Extensiones". Desbordamiento por ancho, pin/unpin persistido,
 * teclado del menu, tooltip accesible, insignias en lugar de texto suelto, y REGRESION: ninguna accion de extension usa el primario solido.
 */
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { executeExtensionAction, toastFn } = vi.hoisted(() => ({
    executeExtensionAction: vi.fn(),
    toastFn: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }) as any,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', async () => {
    const R = await import('react');
    return { default: ({ href, children, ...rest }: any) => R.createElement('a', { href, ...rest }, children) };
});
vi.mock('sonner', () => ({ toast: toastFn }));
vi.mock('@/lib/expansions/api', () => ({ executeExtensionAction: (...args: any[]) => executeExtensionAction(...args), fetchExpansions: vi.fn(async () => []) }));
vi.mock('@/components/ExtensionLoader', () => ({ ExtensionLoader: () => null }));

import { ExtensionToolbar, buildToolbarItems, type ToolbarMount } from '../ExtensionToolbar';
import { __resetPrefsStore, getPrefs } from '@/lib/expansions/client/prefs';
import { PALETTES, BRAND_MODES, applyBrand, assertThemeSafe, click, installCleanup, key, mount, q, qa } from '../../kit/__tests__/harness';

const h = React.createElement;

// ---- ancho medido: ResizeObserver + clientWidth del contenedor
const state = { width: 900 };
const observers = new Set<() => void>();
class FakeRO {
    cb: () => void;
    constructor(cb: () => void) { this.cb = cb; observers.add(cb); }
    observe() { /* el ancho se lee de state */ }
    disconnect() { observers.delete(this.cb); }
    unobserve() { /* no-op */ }
}
const setWidth = async (w: number) => { state.width = w; await act(async () => { observers.forEach((cb) => cb()); }); };

const btn = (label: string, icon: string, extra: Record<string, any> = {}, id?: string) => ({
    ...(id ? { id } : {}),
    component: { type: 'BUTTON', props: { label, icon, onClick: { action: 'TOAST', message: `hecho ${label}` }, ...extra } },
});
const ext = (extensionId: string, extensionName: string, entries: Array<ReturnType<typeof btn>>, description?: string): ToolbarMount[] =>
    entries.map((e) => ({ extensionId, extensionName, extensionDescription: description, overlays: {}, ...e }));

/** 8 acciones como las de la captura del dueno (mas Extract actions, HubSpot y un icono que no existe). */
const MOUNTS: ToolbarMount[] = [
    ...ext('core-notion', 'Notion Integration', [btn('Notion', 'Database')], 'Guarda correos en Notion'),
    ...ext('core-summarizer', 'Summarizer', [btn('Summarize', 'Sparkles'), btn('Extract actions', 'ListChecks', { variant: 'ghost' })]),
    ...ext('core-translator', 'Translator', [btn('Translate', 'Languages')], 'Traduce correos'),
    ...ext('core-trello', 'Trello Integration', [btn('Trello', 'KanbanSquare')], 'Crea tarjetas'),
    ...ext('core-hubspot', 'HubSpot CRM', [btn('HubSpot', 'HubSpot', { variant: 'ghost' })]),
    ...ext('core-giphy', 'Giphy', [btn('GIF', 'GIF', { tone: 'primary', variant: 'solid', toolbar: { tone: 'primary', variant: 'solid', className: 'bg-primary text-primary-foreground' } })]),
    ...ext('core-calendar', 'Calendar', [btn('Agendar', 'CalendarPlus')]),
];

const bar = () => q('[data-extension-toolbar]')!;
const slots = () => qa('[data-toolbar-slot] button', bar());
const trigger = () => q<HTMLButtonElement>('[data-extensions-menu-trigger]')!;
const menu = () => q('[data-extensions-menu]')!;
const menuOpen = () => !menu().hasAttribute('hidden');
const render = (mounts: ToolbarMount[] = MOUNTS, mountPoint = 'EMAIL_TOOLBAR') => mount(h(ExtensionToolbar, { mountPoint, mounts, context: { extensionId: 'x' } }));
const openMenu = async () => { await click(trigger()); };
const rows = () => qa('[data-menu-row]', menu()).filter((r) => !r.hasAttribute('hidden'));
const focused = () => document.activeElement as HTMLElement;
const raf = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

installCleanup();
beforeEach(() => {
    state.width = 900;
    observers.clear();
    (globalThis as any).ResizeObserver = FakeRO;
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return (this as HTMLElement).hasAttribute?.('data-extension-toolbar') ? state.width : 0; } });
    window.localStorage.clear();
    __resetPrefsStore();
    executeExtensionAction.mockReset();
    Object.values(toastFn).forEach((fn: any) => fn?.mockClear?.());
    vi.spyOn(console, 'warn').mockImplementation(() => { });
    vi.spyOn(console, 'error').mockImplementation(() => { });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('barra: solo las acciones ancladas, como iconos compactos', () => {
    it('por defecto se anclan 2 (las 2 primeras) y el resto vive en el menu; cada icono tiene nombre accesible y ningun texto', async () => {
        await render();
        expect(slots().map((b) => b.getAttribute('aria-label'))).toEqual(['Notion', 'Summarize']);
        for (const b of slots()) {
            expect(b.textContent?.trim()).toBe('');
            expect(b.className).toMatch(/\bh-8\b/);
            expect(b.className).toMatch(/\bw-8\b/);
            expect(b.className).toContain('[@media(pointer:coarse)]:h-9'); // 36 px en tactil
        }
        expect(trigger().getAttribute('aria-label')).toBe('Extensiones (8)');
        expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
        expect(trigger().getAttribute('aria-expanded')).toBe('false');
    });

    it('el manifest puede anclar (toolbar.pinned) y ordenar (toolbar.priority); maximo 3 por defecto', async () => {
        const mounts: ToolbarMount[] = [
            ...ext('a', 'A', [btn('Uno', 'Star', { toolbar: { priority: 30 } })]),
            ...ext('b', 'B', [btn('Dos', 'Star', { toolbar: { pinned: true, priority: 20 } })]),
            ...ext('c', 'C', [btn('Tres', 'Star', { toolbar: { pinned: true, priority: 10 } })]),
            ...ext('d', 'D', [btn('Cuatro', 'Star', { toolbar: { pinned: true, priority: 40 } }), btn('Cinco', 'Star', { toolbar: { pinned: true, priority: 50 } })]),
        ];
        await render(mounts);
        expect(slots().map((b) => b.getAttribute('aria-label'))).toEqual(['Tres', 'Dos', 'Cuatro']);
    });

    it('toolbar.label sustituye al nombre visible', async () => {
        await render(ext('a', 'A', [btn('Texto largo del boton', 'Star', { toolbar: { label: 'Corto' } })]));
        expect(slots()[0].getAttribute('aria-label')).toBe('Corto');
    });

    it('sin extensiones no pinta nada; con solo piezas a medida (no BUTTON) las pinta sin menu', async () => {
        await render([]);
        expect(q('[data-extension-toolbar]')).toBeNull();
        await render([{ extensionId: 'x', component: { type: 'BADGE', props: { label: 'Nuevo' } } }]);
        expect(q('[data-extensions-menu-trigger]')).toBeNull();
    });
});

describe('desbordamiento: medir el ancho y mandar lo que no cabe al menu', () => {
    it('cabe todo lo anclado con ancho holgado; si se estrecha, cae al menu sin perder nada', async () => {
        await render();
        // Anclamos 5 para forzar el desbordamiento
        await openMenu();
        for (const label of ['Translate', 'Trello', 'HubSpot']) {
            const pin = qa<HTMLButtonElement>('[data-toolbar-pin]', menu()).find((b) => b.getAttribute('aria-label')?.endsWith(label))!;
            await click(pin);
        }
        expect(slots()).toHaveLength(5);
        await setWidth(140); // 140 - (32+2+9 reservado) = 97 -> 2 botones (34 c/u)
        expect(slots()).toHaveLength(2);
        await setWidth(175); // 132 -> 3
        expect(slots()).toHaveLength(3);
        await setWidth(60); // 60 - 43 = 17 < 32 -> ninguno
        expect(slots()).toHaveLength(0);
        expect(trigger()).toBeTruthy(); // el menu SIEMPRE esta
        expect(rows()).toHaveLength(8); // y sigue teniendo las 8 acciones
        await setWidth(900);
        expect(slots()).toHaveLength(5);
    });

    it('ningun boton, ranura ni el contenedor usan posicion absoluta, margenes negativos ni scroll horizontal', async () => {
        await render();
        for (const w of [900, 200, 80]) {
            await setWidth(w);
            const all = [bar(), ...qa('[data-toolbar-slot]', bar()), ...qa('button', bar())];
            for (const el of all) {
                if (el === trigger()) continue; // la insignia numerica del menu es un hijo, no el boton
                expect(el.className, el.outerHTML.slice(0, 80)).not.toMatch(/(^|\s)(?:absolute|fixed)(\s|$)/);
                expect(el.className).not.toMatch(/(^|\s)-m[lrxse]?-\d/);
            }
            expect(bar().className).toContain('min-w-0');
            expect(bar().className).not.toMatch(/overflow-x-(?:auto|scroll)|\bscroll-x\b/);
            expect(qa('[data-toolbar-slot]', bar()).every((s) => s.className.includes('shrink-0'))).toBe(true);
        }
    });

    it('separacion uniforme: gap de 2 px entre iconos y separador sutil respecto a las acciones nativas', async () => {
        await render();
        expect(bar().className).toContain('gap-0.5');
        const sep = q('[role="separator"]', bar())!;
        expect(sep.getAttribute('aria-orientation')).toBe('vertical');
        expect(sep.className).toMatch(/\bw-px\b/);
        expect(sep.className).toContain('bg-border');
    });
});

describe('carga tardia: las extensiones llegan despues del primer render', () => {
    it('el observador de ancho se engancha cuando aparece el contenedor (no solo al montar)', async () => {
        const m = await render([]);
        expect(q('[data-extension-toolbar]')).toBeNull();
        expect(observers.size).toBe(0);
        state.width = 140;
        await m.render(h(ExtensionToolbar, { mountPoint: 'EMAIL_TOOLBAR', mounts: MOUNTS, context: { extensionId: 'x' } }));
        expect(observers.size).toBeGreaterThan(0);
        // 140 px -> caben 2 (o menos): nunca las 2 + el resto desbordando
        expect(slots().length).toBeLessThanOrEqual(2);
        await setWidth(60);
        expect(slots()).toHaveLength(0);
    });
});

describe('menu "Extensiones"', () => {
    it('agrupa por extension, con icono + nombre + descripcion, roles menu/menuitem y pie "Gestionar extensiones"', async () => {
        await render();
        await openMenu();
        expect(menuOpen()).toBe(true);
        expect(trigger().getAttribute('aria-expanded')).toBe('true');
        expect(menu().getAttribute('role')).toBe('menu');
        const groups = qa('[role="group"]', menu()).map((g) => g.getAttribute('aria-label'));
        expect(groups).toEqual(['Notion Integration', 'Summarizer', 'Translator', 'Trello Integration', 'HubSpot CRM', 'Giphy', 'Calendar']);
        const items = qa('[role="menuitem"][data-toolbar-menu-item]', menu());
        expect(items.map((i) => i.querySelector('.font-medium')?.textContent).filter(Boolean)).toEqual(['Notion', 'Summarize', 'Extract actions', 'Translate', 'Trello', 'HubSpot', 'GIF', 'Agendar']);
        expect(menu().textContent).toContain('Guarda correos en Notion'); // descripcion de una linea
        const manage = q<HTMLAnchorElement>('[data-menu-footer]', menu())!;
        expect(manage.getAttribute('href')).toBe('/extensions');
        expect(manage.textContent).toContain('Gestionar extensiones');
        // cada fila tiene su chincheta como menuitemcheckbox
        expect(qa('[role="menuitemcheckbox"]', menu())).toHaveLength(8);
    });

    it('teclado: al abrir enfoca el buscador; flechas mueven; Derecha/Izquierda saltan a la chincheta; P ancla; Esc cierra y devuelve el foco', async () => {
        await render();
        await click(trigger());
        await raf();
        expect(focused().getAttribute('aria-label')).toBe('Buscar acciones'); // >7 acciones: hay buscador
        await key(focused(), 'ArrowDown');
        expect(focused().closest('[data-menu-row]')?.getAttribute('data-menu-row')).toBe(rows()[0].getAttribute('data-menu-row'));
        await key(focused(), 'ArrowDown');
        expect(focused().closest('[data-menu-row]')).toBe(rows()[1]);
        await key(focused(), 'ArrowRight');
        expect(focused().hasAttribute('data-toolbar-pin')).toBe(true);
        await key(focused(), 'ArrowLeft');
        expect(focused().hasAttribute('data-toolbar-menu-item')).toBe(true);
        await key(focused(), 'End');
        expect(focused().closest('[data-menu-row]')).toBe(rows().at(-1));
        await key(focused(), 'ArrowDown'); // tras la ultima fila, el pie
        expect(focused().hasAttribute('data-menu-footer')).toBe(true);
        await key(focused(), 'ArrowUp');
        expect(focused().closest('[data-menu-row]')).toBe(rows().at(-1));
        await key(focused(), 'Home');
        const first = rows()[0];
        expect(focused().closest('[data-menu-row]')).toBe(first);
        const wasPinned = first.querySelector('[data-toolbar-pin]')!.getAttribute('aria-checked');
        await key(focused(), 'p');
        expect(first.querySelector('[data-toolbar-pin]')!.getAttribute('aria-checked')).toBe(wasPinned === 'true' ? 'false' : 'true');
        await key(focused(), 'Escape');
        await raf();
        expect(menuOpen()).toBe(false);
        expect(document.activeElement).toBe(trigger());
    });

    it('Enter ejecuta la accion, cierra el menu y marca la ultima usada con un punto (no un relleno)', async () => {
        await render();
        await click(trigger());
        await raf();
        const target = rows().find((r) => r.textContent?.includes('Translate'))!;
        await act(async () => { target.querySelector<HTMLElement>('[data-toolbar-menu-item]')!.focus(); });
        await click(target.querySelector('[data-toolbar-menu-item]'));
        expect(toastFn).toHaveBeenCalled();
        expect(menuOpen()).toBe(false);
        expect(window.localStorage.getItem('bloomx:ext-toolbar:last:v1')).toContain('core-translator:email_toolbar:translate');
    });

    it('buscador (>7): filtra por nombre, extension o descripcion sin acentos, sin desmontar el resto; con <=7 no aparece', async () => {
        await render();
        await openMenu();
        const search = q<HTMLInputElement>('input[type="search"]', menu())!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'TRADUCE');
            search.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(rows().map((r) => r.textContent)).toHaveLength(1);
        expect(rows()[0].textContent).toContain('Translate');
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'zzzz');
            search.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(rows()).toHaveLength(0);
        expect(menu().textContent).toContain('Sin resultados');
    });

    it('con 7 acciones o menos no hay buscador', async () => {
        await render(MOUNTS.slice(0, 3));
        await openMenu();
        expect(q('input[type="search"]', menu())).toBeNull();
    });

    it('un clic fuera cierra el menu', async () => {
        await render();
        await openMenu();
        await act(async () => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
        expect(menuOpen()).toBe(false);
    });
});

describe('anclar / desanclar y persistencia', () => {
    it('la chincheta ancla y desancla (aria-checked), la barra lo refleja y se guarda por usuario', async () => {
        await render();
        await openMenu();
        const pinOf = (label: string) => qa<HTMLButtonElement>('[data-toolbar-pin]', menu()).find((b) => b.getAttribute('aria-label')?.endsWith(`: ${label}`))!;
        expect(pinOf('Trello').getAttribute('aria-checked')).toBe('false');
        await click(pinOf('Trello'));
        expect(pinOf('Trello').getAttribute('aria-checked')).toBe('true');
        expect(slots().map((b) => b.getAttribute('aria-label'))).toContain('Trello');
        await click(pinOf('Notion')); // desanclar una anclada por defecto
        expect(slots().map((b) => b.getAttribute('aria-label'))).not.toContain('Notion');
        const stored = JSON.parse(window.localStorage.getItem('bloomx:ext-prefs:v1:anon')!);
        expect(Object.values(stored.pins).sort()).toEqual([false, true]);
        expect(Object.keys(stored.pins).every((k) => /^[a-z0-9._:-]+$/.test(k) && k.includes(':email_toolbar:'))).toBe(true);
    });

    it('al volver a montar (otra pantalla / recarga) se conservan las decisiones del usuario', async () => {
        const first = await render();
        await openMenu();
        await click(qa<HTMLButtonElement>('[data-toolbar-pin]', menu()).find((b) => b.getAttribute('aria-label')?.endsWith(': Agendar'))!);
        await first.unmount();
        __resetPrefsStore(); // como una recarga: el estado en memoria se pierde, localStorage no
        await render();
        expect(slots().map((b) => b.getAttribute('aria-label'))).toContain('Agendar');
    });

    it('cada barra tiene sus propios anclados (la clave incluye el punto de montaje)', async () => {
        await render(MOUNTS, 'EMAIL_TOOLBAR');
        const email = slots().map((b) => b.getAttribute('aria-label'));
        await openMenu();
        await click(qa<HTMLButtonElement>('[data-toolbar-pin]', menu())[3]);
        const composer = await render(MOUNTS, 'COMPOSER_TOOLBAR');
        expect(qa('[data-extension-toolbar="COMPOSER_TOOLBAR"] [data-toolbar-slot] button').map((b) => b.getAttribute('aria-label'))).toEqual(email);
        await composer.unmount();
    });

    it('lo guardado se sanea: claves raras y valores no booleanos se descartan', async () => {
        window.localStorage.setItem('bloomx:ext-prefs:v1:anon', JSON.stringify({ pins: { '<script>': true, 'ok:email_toolbar:notion': 'si', ['x'.repeat(400)]: true, 'core-notion:email_toolbar:notion': false } }));
        await render();
        const pins = getPrefs().pins!;
        expect(Object.keys(pins)).toEqual(['core-notion:email_toolbar:notion']);
        expect(slots().map((b) => b.getAttribute('aria-label'))).not.toContain('Notion');
    });
});

describe('tooltip accesible', () => {
    it('con raton aparece a los 400 ms, con role=tooltip enlazado por aria-describedby; Escape lo cierra', async () => {
        vi.useFakeTimers();
        await render();
        const first = slots()[0];
        await act(async () => { first.parentElement!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
        await act(async () => { vi.advanceTimersByTime(300); });
        expect(q('[role="tooltip"]')).toBeNull(); // aun no: el retardo es de 400 ms
        await act(async () => { vi.advanceTimersByTime(150); });
        const tip = q('[role="tooltip"]')!;
        expect(tip).toBeTruthy();
        expect(tip.textContent).toContain('Notion');
        expect(first.getAttribute('aria-describedby')).toBe(tip.id);
        await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        expect(q('[role="tooltip"]')).toBeNull();
        vi.useRealTimers();
    });

    it('con el foco de teclado aparece al instante y se quita al salir', async () => {
        vi.spyOn(HTMLElement.prototype, 'matches').mockImplementation(function (this: HTMLElement, sel: string) { return sel === ':focus-visible' ? true : Element.prototype.matches.call(this, sel); });
        await render();
        const first = slots()[0];
        await act(async () => { first.focus(); first.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); });
        const tip = q('[role="tooltip"]')!;
        expect(tip).toBeTruthy();
        expect(tip.textContent).toContain('Notion');
        expect(first.getAttribute('aria-describedby')).toBe(tip.id);
        await act(async () => { first.blur(); first.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
        expect(q('[role="tooltip"]')).toBeNull();
    });
});

describe('iconos que llegan como texto: insignia contenida', () => {
    it('"GIF" y un icono desconocido (sin icono Lucide) se muestran como insignia de iniciales dentro del cuadrado, no como texto suelto', async () => {
        await render(ext('core-giphy', 'Giphy', [btn('GIF', 'GIF', { toolbar: { pinned: true } }), btn('Acme CRM', 'AcmeCrmX', { toolbar: { pinned: true } })]));
        const badges = qa('[data-toolbar-badge]', bar());
        expect(badges.map((b) => b.textContent)).toEqual(['GIF', 'AC']);
        for (const b of badges) {
            expect(b.className).toContain('rounded');
            expect(b.getAttribute('aria-hidden')).toBe('true');
            expect(b.closest('button')!.getAttribute('aria-label')).toMatch(/GIF|Acme CRM/);
        }
        // el texto del boton no se filtra fuera de la insignia
        expect(slots().every((b) => b.textContent === b.querySelector('[data-toolbar-badge]')!.textContent)).toBe(true);
    });
});

describe('REGRESION: las acciones de extension NUNCA usan el primario solido', () => {
    it('ni por defecto ni cuando el manifest pide tone primary + variant solid (caso GIF de la captura)', async () => {
        await render();
        await openMenu();
        const solid = /(^|\s)(?:bg-primary(?:\/\d+)?|text-primary-foreground|bg-brand-accent)(\s|$)/;
        const buttons = [...qa('button', bar()), ...qa('button', menu())];
        expect(buttons.length).toBeGreaterThan(8);
        for (const b of buttons) {
            expect(b.className, b.getAttribute('aria-label') ?? b.textContent ?? '').not.toMatch(solid);
            expect(b.className).not.toMatch(/(^|\s)bg-(?:primary|secondary|destructive|success|warning|info)(\s|$)/);
        }
        // el mount con tone:primary/variant:solid (GIF) esta en el menu y tampoco es solido
        const gif = qa('button', menu()).find((b) => b.textContent?.includes('GIF'))!;
        expect(gif.className).not.toMatch(solid);
    });

    it('el marcado de la barra no contiene ninguna clase de fondo primario', async () => {
        await render();
        await openMenu();
        expect(bar().innerHTML).not.toMatch(/bg-primary/);
        expect(menu().innerHTML).not.toMatch(/bg-primary/);
    });

    it('el fuente de los botones de barra no menciona el primario solido', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const dir = path.resolve(__dirname, '..');
        for (const f of ['ToolbarButtons.tsx', 'ExtensionToolbar.tsx', 'ToolbarTooltip.tsx']) {
            const src = fs.readFileSync(path.join(dir, f), 'utf8');
            expect(src, f).not.toMatch(/bg-primary|text-primary-foreground/);
        }
    });
});

describe('buildToolbarItems (claves y orden)', () => {
    it('las claves son estables, unicas y seguras; la descripcion de la extension se usa si solo tiene una accion', () => {
        const { items } = buildToolbarItems('EMAIL_TOOLBAR', MOUNTS);
        const keys = items.map((i) => i.key);
        expect(new Set(keys).size).toBe(keys.length);
        for (const k of keys) expect(k).toMatch(/^[a-z0-9._:-]{1,190}$/);
        expect(items.find((i) => i.label === 'Notion')!.description).toBe('Guarda correos en Notion');
        expect(items.find((i) => i.label === 'Summarize')!.description).toBeUndefined(); // 2 acciones: no se repite
        expect(buildToolbarItems('EMAIL_TOOLBAR', MOUNTS).items.map((i) => i.key)).toEqual(keys);
    });
});

describe.each(PALETTES)('con la paleta "%s"', (palette) => {
    it.each(BRAND_MODES)('barra y menu solo con tokens (sin paleta cruda ni estilos de color) (%s)', async (mode) => {
        const css = applyBrand(palette, mode);
        await render();
        await openMenu();
        assertThemeSafe(document.body, css);
    });
});
