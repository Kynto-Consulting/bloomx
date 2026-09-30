// @vitest-environment jsdom
/**
 * Tooltip de acciones de extension: el texto largo ENVUELVE (nunca se corta con puntos suspensivos), ancho maximo 280 px, retardo
 * 400 ms, Escape lo cierra, aria-describedby, no bloquea el clic, atajo visible y posicion sin salirse de la ventana (flip + shift).
 */
import React, { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ToolbarTooltip, TOOLTIP_DELAY_MS, TOOLTIP_MAX_WIDTH_PX, placeTooltip } from '../ToolbarTooltip';
import { installCleanup, key, mount, q } from '../../kit/__tests__/harness';

// createElement tipado como any: ToolbarTooltip acepta una funcion (render-prop) como hijo, que ReactNode no admite.
const h: any = React.createElement;
installCleanup();

const LONG = 'Crea videollamadas de Google Meet desde el redactor y los eventos del calendario, con enlace y acceso para invitados.';

describe('ToolbarTooltip', () => {
    it('muestra nombre y descripcion COMPLETOS y envueltos a los 400 ms; Escape cierra; aria-describedby enlazado', async () => {
        vi.useFakeTimers();
        const onClick = vi.fn();
        await mount(h(ToolbarTooltip, { label: 'Google Meet', hint: LONG, shortcut: 'Ctrl+M' }, (aria: any) => h('button', { ...aria, onClick, 'aria-label': 'Google Meet' }, 'x')));
        const btn = q<HTMLButtonElement>('button')!;
        await act(async () => { btn.parentElement!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); btn.parentElement!.dispatchEvent(new Event('mouseenter')); });
        // React escucha mouseenter mediante mouseover/out: se dispara con eventos que React traduce
        await act(async () => { btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })); });
        expect(q('[role="tooltip"]')).toBeNull();
        await act(async () => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS + 5); });
        const tip = q('[role="tooltip"]')!;
        expect(tip).toBeTruthy();
        expect(TOOLTIP_DELAY_MS).toBe(400);
        expect(tip.textContent).toContain(LONG); // completo, no cortado
        expect(tip.className).toMatch(/whitespace-normal/);
        expect(tip.className).not.toMatch(/truncate|line-clamp|text-ellipsis|overflow-hidden/);
        expect(tip.innerHTML).not.toMatch(/truncate|…/);
        expect(tip.style.maxWidth).toContain(`${TOOLTIP_MAX_WIDTH_PX}px`);
        expect(tip.className).toMatch(/pointer-events-none/); // no bloquea el clic
        expect(tip.querySelector('kbd')!.textContent).toBe('Ctrl+M');
        expect(btn.getAttribute('aria-describedby')).toBe(tip.id);
        await key(document.body, 'Escape');
        expect(q('[role="tooltip"]')).toBeNull();
        expect(btn.getAttribute('aria-describedby')).toBeNull();
        await act(async () => { btn.click(); });
        expect(onClick).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });
});

describe('placeTooltip (flip + shift)', () => {
    const vp = { width: 400, height: 600 };
    const tip = { width: 280, height: 90 };
    it('centrado bajo el boton cuando cabe', () => {
        const p = placeTooltip({ left: 180, right: 212, top: 20, bottom: 52 }, tip, vp);
        expect(p.placement).toBe('bottom');
        expect(p.top).toBe(58);
        expect(p.left).toBe(196 - 140);
    });
    it('se desplaza para no salirse por la izquierda ni por la derecha', () => {
        const left = placeTooltip({ left: 0, right: 32, top: 20, bottom: 52 }, tip, vp);
        expect(left.left).toBe(8);
        const right = placeTooltip({ left: 368, right: 400, top: 20, bottom: 52 }, tip, vp);
        expect(right.left).toBe(400 - 280 - 8);
    });
    it('se voltea encima del boton si abajo no cabe', () => {
        const p = placeTooltip({ left: 100, right: 132, top: 540, bottom: 572 }, tip, vp);
        expect(p.placement).toBe('top');
        expect(p.top).toBe(540 - 6 - 90);
    });
    it('un tooltip mas ancho que la ventana se limita a la ventana', () => {
        const p = placeTooltip({ left: 10, right: 40, top: 20, bottom: 52 }, { width: 500, height: 40 }, { width: 320, height: 600 });
        expect(p.left).toBeGreaterThanOrEqual(8);
    });
});
