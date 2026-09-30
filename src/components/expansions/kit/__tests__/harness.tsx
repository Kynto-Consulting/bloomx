/**
 * Utilidades COMUNES de los tests del kit (jsdom). Cada fichero de test del kit:
 *   - lleva `// @vitest-environment jsdom` en la primera linea,
 *   - usa `kitSuite('NombreComponente', () => <Componente ... />)` para la bateria estandar de temas
 *     (3 paletas de empresa x claro/oscuro: solo tokens existentes, nada de paleta cruda, sin estilos de color),
 *   - y sus propios `it(...)` para comportamiento (roles ARIA, foco, teclado, props hostiles).
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BRAND_FIXTURES } from '@/lib/theme-fixtures';
import { buildBrandCss } from '@/lib/brand-theme';
import { TOKEN_KEYS } from '@/lib/theme-config';
import { RAW_CLASS, RAW_LITERAL } from '@/lib/__tests__/helpers/raw-colors';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

export const PALETTES = ['oscura corporativa', 'pastel', 'saturada (texto malo)'] as const;
export const BRAND_MODES = ['brand-light', 'brand-dark'] as const;

const TOKEN_CLASS = new RegExp(
    String.raw`(?<![\w-])(?:[a-z-]+:)*(?:bg|text|border|border-[trblxy]|ring|ring-offset|divide|outline|decoration|fill|stroke|accent|caret)-(${[...TOKEN_KEYS].sort((a, b) => b.length - a.length).join('|')})(?:/[0-9]+)?(?![\w-])`,
    'g',
);

export interface Mounted {
    container: HTMLDivElement;
    root: Root;
    /** Vuelve a pintar (mismo root: conserva el estado de los componentes). */
    render: (node: React.ReactElement) => Promise<void>;
    unmount: () => Promise<void>;
}

let active: Mounted[] = [];

/** Monta un elemento en el documento (los portales van a document.body). Se limpia solo en afterEach. */
export async function mount(node: React.ReactElement): Promise<Mounted> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const mounted: Mounted = {
        container, root,
        render: async (next) => { await act(async () => { root.render(next); }); },
        unmount: async () => { await act(async () => root.unmount()); container.remove(); },
    };
    active.push(mounted);
    await mounted.render(node);
    return mounted;
}

export function installCleanup() {
    beforeEach(() => { active = []; });
    afterEach(async () => {
        for (const m of active) { try { await m.unmount(); } catch { /* ya desmontado */ } }
        active = [];
        document.body.innerHTML = '';
        document.head.querySelectorAll('style[data-test]').forEach((s) => s.remove());
        document.documentElement.removeAttribute('data-theme');
    });
}

/** Inyecta el CSS de la paleta de empresa y activa su modo. Devuelve el CSS. */
export function applyBrand(palette: (typeof PALETTES)[number], mode: (typeof BRAND_MODES)[number]): string {
    const css = buildBrandCss(BRAND_FIXTURES[palette]);
    const style = document.createElement('style');
    style.setAttribute('data-test', '');
    style.textContent = css;
    document.head.appendChild(style);
    document.documentElement.setAttribute('data-theme', mode);
    return css;
}

export function tokensUsed(html: string): Set<string> {
    const used = new Set<string>();
    for (const m of html.matchAll(TOKEN_CLASS)) used.add(m[1]);
    return used;
}

/**
 * El color OFICIAL de un logotipo de marca (svg[data-brand], dato del registro brand-icons.ts) es la unica excepcion legitima al
 * "nada de color en linea": su contraste contra el tema se verifica aparte (brand-icons.test.ts / ExtensionIcon.test.tsx).
 */
function withoutBrandGlyphColors(root: ParentNode): Element {
    const clone = (root as Element).cloneNode(true) as Element;
    clone.querySelectorAll('svg[data-brand]').forEach((svg) => { svg.removeAttribute('style'); svg.removeAttribute('fill'); });
    return clone;
}

/** Ningun `style=""` puede pintar color: solo dimensiones (width, height, gridTemplateColumns...). */
export function colorStyles(root: ParentNode): string[] {
    const bad: string[] = [];
    withoutBrandGlyphColors(root).querySelectorAll('[style]').forEach((el) => {
        const style = el.getAttribute('style') || '';
        if (/(?:^|;|\s)(?:color|background|background-color|border-color|fill|stroke|outline-color|box-shadow)\s*:/i.test(style) || RAW_LITERAL.test(style)) bad.push(style);
        RAW_LITERAL.lastIndex = 0;
    });
    return bad;
}

export function assertThemeSafe(root: ParentNode, css: string) {
    const html = withoutBrandGlyphColors(root).innerHTML ?? '';
    expect(html.match(RAW_CLASS) ?? [], 'paleta cruda en el marcado').toEqual([]);
    expect(html.match(RAW_LITERAL) ?? [], 'color literal en el marcado').toEqual([]);
    expect(colorStyles(root), 'estilos con color en linea').toEqual([]);
    for (const token of tokensUsed(html)) expect(css, `--color-${token} sin definir en la paleta`).toContain(`--color-${token}:`);
    // Clases que un manifest podria haber colado
    expect(html).not.toMatch(/class="[^"]*\b(?:evil|injected)\b/);
}

/**
 * Bateria estandar por componente: 3 paletas x claro/oscuro. `make` recibe el modo y devuelve el elemento a
 * pintar; debe ejercitar las variantes/tonos principales del componente.
 */
export function kitSuite(name: string, make: () => React.ReactElement) {
    describe.each(PALETTES)(`${name} con la paleta "%s"`, (palette) => {
        installCleanup();
        it.each(BRAND_MODES)('solo tokens de la paleta, sin paleta cruda ni estilos de color (%s)', async (mode) => {
            const css = applyBrand(palette, mode);
            const m = await mount(make());
            assertThemeSafe(document.body, css);
            expect(m.container.innerHTML.length).toBeGreaterThan(0);
        });
    });
}

// ------------------------------------------------------------------ interaccion
export const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
export const click = async (el: Element | null) => { expect(el, 'elemento a pulsar').toBeTruthy(); await act(async () => { (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }); };
export async function key(el: Element | null, keyName: string, init: KeyboardEventInit = {}) {
    expect(el, 'elemento objetivo de la tecla').toBeTruthy();
    await act(async () => { (el as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true, ...init })); });
}
export async function typeInto(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null, value: string) {
    expect(el, 'campo donde escribir').toBeTruthy();
    await act(async () => {
        const target = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        const proto = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : target instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(target, value);
        target.dispatchEvent(new Event(target instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    });
}
export const q = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document.body) => root.querySelector<T>(selector);
export const qa = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document.body) => Array.from(root.querySelectorAll<T>(selector));
export const byText = (text: string, selector = '*', root: ParentNode = document.body) => qa(selector, root).find((el) => el.textContent?.trim() === text) ?? null;
export const h = React.createElement;
