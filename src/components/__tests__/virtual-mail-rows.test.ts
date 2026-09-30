// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, createRef, type MutableRefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { VirtualMailRows, type VirtualMailRowsHandle } from '../VirtualMailRows';
import { listItemAria } from '@/lib/virtual-list';

// jsdom no hace layout: se inyectan el tamano del viewport y el alto de cada fila.
const ROW = 100;
const VIEWPORT = 600;
const observeElementRect = (_i: unknown, cb: (r: { width: number; height: number }) => void) => {
    cb({ width: 400, height: VIEWPORT });
    return () => {};
};
const measureElement = () => ROW;

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const makeIds = (n: number, prefix = 'm') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

let host: HTMLDivElement;
let scroller: HTMLDivElement;
let root: Root;

function mount(props: Partial<React.ComponentProps<typeof VirtualMailRows>> & { ids: string[] }) {
    const scrollRef = { current: scroller } as React.RefObject<HTMLDivElement>;
    const { ids } = props;
    const el = createElement(VirtualMailRows, {
        scrollRef,
        pinnedIndex: -1,
        hasMore: false,
        onNearEnd: () => {},
        label: 'Bandeja de entrada',
        estimateSize: ROW,
        observeElementRect: observeElementRect as any,
        measureElement: measureElement as any,
        renderRow: (index: number) =>
            createElement('div', { role: 'listitem', id: `row-${ids[index]}`, ...listItemAria(index, ids.length, props.hasMore ?? false) }, ids[index]),
        ...props,
    } as any);
    act(() => { root.render(el); });
}

beforeEach(() => {
    host = document.createElement('div');
    scroller = document.createElement('div');
    // Element.scrollTo no existe en jsdom: simulamos el desplazamiento asignando scrollTop.
    (scroller as any).scrollTo = (opts: { top?: number }) => { scroller.scrollTop = opts?.top ?? 0; scroller.dispatchEvent(new Event('scroll')); };
    // jsdom no calcula scrollHeight/clientHeight; el virtualizador los usa para acotar el scroll maximo.
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => VIEWPORT });
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => 1_000_000 });
    scroller.appendChild(host);
    document.body.appendChild(scroller);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    scroller.remove();
});

describe('VirtualMailRows', () => {
    it('solo monta una ventana de filas, no las 500', () => {
        mount({ ids: makeIds(500) });
        const rows = host.querySelectorAll('[role="listitem"]');
        expect(rows.length).toBeGreaterThan(5);
        expect(rows.length).toBeLessThan(30);
        expect(host.querySelector('#row-m0')).not.toBeNull();
        expect(host.querySelector('#row-m400')).toBeNull();
    });

    it('la altura total reserva espacio para todas las filas y el contenedor es una lista accesible', () => {
        mount({ ids: makeIds(500) });
        const list = host.querySelector('[role="list"]') as HTMLElement;
        expect(list.getAttribute('aria-label')).toBe('Bandeja de entrada');
        expect(list.style.height).toBe(`${500 * ROW}px`);
    });

    it('cada fila expone aria-posinset y aria-setsize (-1 si hay mas paginas por cargar)', () => {
        mount({ ids: makeIds(500), hasMore: false });
        const first = host.querySelector('#row-m0')!;
        expect(first.getAttribute('aria-posinset')).toBe('1');
        expect(first.getAttribute('aria-setsize')).toBe('500');

        mount({ ids: makeIds(500), hasMore: true });
        expect(host.querySelector('#row-m0')!.getAttribute('aria-setsize')).toBe('-1');
    });

    it('la fila con foco (pinnedIndex) se mantiene montada aunque este lejos de la ventana', () => {
        mount({ ids: makeIds(500), pinnedIndex: 300 });
        expect(host.querySelector('#row-m300')).not.toBeNull();
        expect(host.querySelector('#row-m0')).not.toBeNull();
        // ... pero no monta todo lo intermedio
        expect(host.querySelector('#row-m150')).toBeNull();
    });

    it('al hacer scroll monta las filas nuevas y desmonta las viejas', () => {
        mount({ ids: makeIds(500) });
        act(() => {
            scroller.scrollTop = 20000; // fila ~200
            scroller.dispatchEvent(new Event('scroll'));
        });
        expect(host.querySelector('#row-m200')).not.toBeNull();
        expect(host.querySelector('#row-m0')).toBeNull();
    });

    it('avisa (onNearEnd) al acercarse al final solo si hay mas paginas', () => {
        const onNearEnd = vi.fn();
        mount({ ids: makeIds(60), hasMore: true, onNearEnd });
        expect(onNearEnd).not.toHaveBeenCalled(); // arriba del todo, lejos del final
        act(() => {
            scroller.scrollTop = 60 * ROW - VIEWPORT; // final
            scroller.dispatchEvent(new Event('scroll'));
        });
        expect(onNearEnd).toHaveBeenCalled();

        const noMore = vi.fn();
        mount({ ids: makeIds(60), hasMore: false, onNearEnd: noMore });
        act(() => {
            scroller.scrollTop = 60 * ROW - VIEWPORT;
            scroller.dispatchEvent(new Event('scroll'));
        });
        expect(noMore).not.toHaveBeenCalled();
    });

    it('handleRef.scrollToIndex lleva la fila lejana a la ventana (navegacion j/k)', () => {
        const handleRef = createRef<VirtualMailRowsHandle | null>() as MutableRefObject<VirtualMailRowsHandle | null>;
        mount({ ids: makeIds(500), handleRef });
        expect(handleRef.current).not.toBeNull();
        handleRef.current!.scrollToIndex(250);
        act(() => { scroller.dispatchEvent(new Event('scroll')); });
        expect(host.querySelector('#row-m250')).not.toBeNull();
    });

    it('conserva el ancla de scroll cuando llegan correos por arriba', () => {
        const ids = makeIds(200);
        mount({ ids });
        act(() => {
            scroller.scrollTop = 5000; // primera fila visible: m50
            scroller.dispatchEvent(new Event('scroll'));
        });
        // llegan 5 correos nuevos al principio
        const next = [...makeIds(5, 'new'), ...ids];
        mount({ ids: next });
        // m50 ahora esta en el indice 55 => el scroll sube 5 filas para que no salte la vista
        expect(scroller.scrollTop).toBe(5000 + 5 * ROW);
    });

    it('no toca el scroll si el usuario esta arriba del todo (ve lo nuevo)', () => {
        const ids = makeIds(200);
        mount({ ids });
        mount({ ids: [...makeIds(5, 'new'), ...ids] });
        expect(scroller.scrollTop).toBe(0);
    });

    it('encabezados pegajosos: el ultimo encabezado antes de la ventana sigue montado y fijo arriba (position: sticky)', () => {
        const ids = makeIds(200);
        const sticky = [0, 50, 120];
        mount({ ids, stickyIndexes: sticky });
        // arriba del todo: el encabezado 0 es el activo
        const first = host.querySelector('#row-m0')!.parentElement as HTMLElement;
        expect(first.style.position).toBe('sticky');
        act(() => {
            scroller.scrollTop = 80 * ROW; // ventana ~80..86: el activo es el encabezado 50
            scroller.dispatchEvent(new Event('scroll'));
        });
        const active = host.querySelector('#row-m50')!.parentElement as HTMLElement;
        expect(active).not.toBeNull();
        expect(active.style.position).toBe('sticky');
        expect(active.style.top).toBe('0px');
        // los demas encabezados montados no son pegajosos: van en su sitio (absolutos)
        expect(host.querySelector('#row-m0')).toBeNull();
        // una fila normal lejana al activo sigue posicionada de forma absoluta
        const row = host.querySelector('#row-m82')!.parentElement as HTMLElement;
        expect(row.style.position).toBe('absolute');
    });

    it('sin encabezados pegajosos todas las filas son absolutas (sin cambios de comportamiento)', () => {
        mount({ ids: makeIds(200) });
        const positions = Array.from(host.querySelectorAll('[role="listitem"]')).map((el) => (el.parentElement as HTMLElement).style.position);
        expect(new Set(positions)).toEqual(new Set(['absolute']));
    });
});
