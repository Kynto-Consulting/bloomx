// @vitest-environment jsdom
/**
 * Regresion de la barra del lector: acciones nativas a la izquierda (shrink-0), acciones de extensiones en su propio hueco (min-w-0,
 * flex-1) y NADA superpuesto (ni absolute, ni margenes negativos, ni scroll horizontal). El hueco de las extensiones se reserva
 * al calcular cuantas acciones nativas caben.
 */
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/I18nProvider', () => ({ useI18n: () => ({ t: (k: string) => k, locale: 'es' }) }));

import { ReaderToolbar } from '../ReaderToolbar';
import { click, installCleanup, mount, q, qa } from '../../expansions/kit/__tests__/harness';

const h = React.createElement;
const noop = () => undefined;
const widthState = { w: 900 };
class FakeRO {
    static all = new Set<() => void>();
    cb: () => void;
    constructor(cb: () => void) { this.cb = cb; FakeRO.all.add(cb); }
    observe() { /* ancho de widthState */ }
    disconnect() { FakeRO.all.delete(this.cb); }
    unobserve() { /* no-op */ }
}
const setBar = async (w: number) => { widthState.w = w; await act(async () => { FakeRO.all.forEach((cb) => cb()); }); };

const toolbar = (extra?: React.ReactNode) => h(ReaderToolbar, {
    variant: 'top', folder: 'inbox', read: true, starred: false, hasPrev: true, hasNext: true, threadSize: 1, allExpanded: false,
    onBack: noop, onClose: noop, onPrev: noop, onNext: noop, onAction: noop, onMenu: noop, onToggleStar: noop, onToggleRead: noop, onPrint: noop, onToggleExpandAll: noop, extra,
});
const bar = () => q('[data-reader-bar="top"]')!;
const nativeActions = () => qa('[data-reader-action]', bar()).map((b) => b.getAttribute('data-reader-action'));

installCleanup();
beforeEach(() => {
    widthState.w = 900;
    FakeRO.all.clear();
    (globalThis as any).ResizeObserver = FakeRO;
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return (this as HTMLElement).getAttribute?.('data-reader-bar') === 'top' ? widthState.w : 0; } });
});
afterEach(() => vi.restoreAllMocks());

describe('ReaderToolbar: reparto del ancho', () => {
    it('las acciones nativas no se encogen y el hueco de extensiones puede encogerse (min-w-0 flex-1)', async () => {
        await mount(toolbar(h('span', { id: 'ext' }, 'ext')));
        const ext = q('[data-reader-extensions]', bar())!;
        expect(ext.className).toContain('min-w-0');
        expect(ext.className).toContain('flex-1');
        expect(ext.contains(q('#ext')!)).toBe(true);
        const nativeGroup = qa('div', bar()).find((d) => d.className.includes('md:flex') && d.querySelector('[data-reader-action]'))!;
        expect(nativeGroup.className).toContain('shrink-0');
        // el bloque final (destacar / mas) tampoco se encoge
        expect(q('[data-reader-action="star"]', bar())!.parentElement!.className).toContain('shrink-0');
    });

    it('nada superpuesto: sin absolute/fixed ni margenes negativos entre los controles de la barra, y sin scroll horizontal', async () => {
        await mount(toolbar(h('span', null, 'ext')));
        for (const w of [900, 600, 400]) {
            await setBar(w);
            for (const el of [bar(), ...qa('div, button', bar())]) {
                expect(el.className, `${w}px ${el.tagName}`).not.toMatch(/(^|\s)(?:absolute|fixed)(\s|$)/);
                expect(el.className).not.toMatch(/(^|\s)-m[lrxse]?-\d/);
            }
            expect(bar().className).not.toMatch(/overflow-x-(?:auto|scroll)|\bscroll-x\b/);
        }
    });

    it('al estrecharse la barra, las acciones nativas ceden (van a "Mas") y se reserva sitio para las extensiones', async () => {
        await mount(toolbar());
        await setBar(900);
        const wide = nativeActions().filter((a) => a !== 'star' && a !== 'more' && a !== 'prev' && a !== 'next');
        await setBar(420);
        const narrow = nativeActions().filter((a) => a !== 'star' && a !== 'more' && a !== 'prev' && a !== 'next');
        expect(narrow.length).toBeLessThan(wide.length);
        expect(narrow.length).toBeGreaterThanOrEqual(2);
        // (420 - 215 - 48) / 34 = 4 -> con la reserva de 48 px para el boton de extensiones
        expect(narrow).toHaveLength(4);
    });

    it('el menu "Mas" sigue accesible (aria-haspopup=menu) y la barra es un toolbar con nombre', async () => {
        await mount(toolbar());
        expect(bar().getAttribute('role')).toBe('toolbar');
        expect(bar().getAttribute('aria-label')).toBe('mailView.toolbar.actions');
        const more = q('[data-reader-action="more"]', bar())!;
        expect(more.getAttribute('aria-haspopup')).toBe('menu');
        await click(more);
        expect(more.getAttribute('aria-expanded')).toBe('true');
    });
});
