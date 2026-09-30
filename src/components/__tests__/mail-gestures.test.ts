// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { usePullToRefresh } from '../mail/usePullToRefresh';
import { MailRow, type MailRowProps } from '../mail/MailRow';
import {
    PULL_IDLE, PULL_LOCK_PX, PULL_TRIGGER, SWIPE_DISTANCE, SWIPE_FLICK_DISTANCE, SWIPE_FLICK_VELOCITY,
    SWIPE_VELOCITY_WINDOW_MS, createVelocityTracker, defaultClock, eventTime,
    pullEnd, pullMove, pullStart, resolveSwipe, swipeProgress,
} from '@/lib/mail-gestures';

// Mismas secuencias que se verificaron en el navegador integrado con emulacion movil (touchstart/move/end reales sobre la
// lista y pointerdown/move/up de tipo "touch" sobre la fila), reproducidas en jsdom.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });
const render = (el: ReactElement) => act(() => { root.render(el); });

describe('swipe: decision pura', () => {
    it('confirma al superar la distancia, en cualquiera de los dos lados', () => {
        expect(resolveSwipe({ offsetX: SWIPE_DISTANCE, offsetY: 0 })).toBe('right');
        expect(resolveSwipe({ offsetX: -SWIPE_DISTANCE, offsetY: 4 })).toBe('left');
        expect(resolveSwipe({ offsetX: SWIPE_DISTANCE - 1, offsetY: 0 })).toBeNull();
        expect(resolveSwipe({ offsetX: -60, offsetY: 0 })).toBeNull();
    });
    it('un gesto rapido (flick) confirma con menos recorrido, solo en la misma direccion', () => {
        expect(resolveSwipe({ offsetX: SWIPE_FLICK_DISTANCE, offsetY: 0, velocityX: SWIPE_FLICK_VELOCITY })).toBe('right');
        expect(resolveSwipe({ offsetX: -SWIPE_FLICK_DISTANCE, offsetY: 0, velocityX: -900 })).toBe('left');
        expect(resolveSwipe({ offsetX: SWIPE_FLICK_DISTANCE, offsetY: 0, velocityX: -900 })).toBeNull(); // rebote contrario
        expect(resolveSwipe({ offsetX: SWIPE_FLICK_DISTANCE - 1, offsetY: 0, velocityX: 5000 })).toBeNull();
        expect(resolveSwipe({ offsetX: 70, offsetY: 0, velocityX: 100 })).toBeNull(); // lento
    });
    it('un gesto vertical o diagonal es scroll, no swipe', () => {
        expect(resolveSwipe({ offsetX: 20, offsetY: 140 })).toBeNull();
        expect(resolveSwipe({ offsetX: 120, offsetY: 100 })).toBeNull();
        expect(resolveSwipe({ offsetX: 150, offsetY: 90 })).toBe('right'); // 150 >= 90 * 1.5
        expect(resolveSwipe({ offsetX: 140, offsetY: 100 })).toBeNull();
    });
    it('un toque cancelado por el navegador nunca ejecuta la accion', () => {
        expect(resolveSwipe({ offsetX: 300, offsetY: 0, velocityX: 3000, cancelled: true })).toBeNull();
    });
    it('progreso 0..1 por lado (opacidad de la capa)', () => {
        expect(swipeProgress(SWIPE_DISTANCE / 2, 'right')).toBeCloseTo(0.5);
        expect(swipeProgress(-SWIPE_DISTANCE / 2, 'left')).toBeCloseTo(0.5);
        expect(swipeProgress(-40, 'right')).toBe(0);
        expect(swipeProgress(999, 'right')).toBe(1);
    });
});

describe('tirar para actualizar: maquina de estados pura', () => {
    it('solo arranca arriba del todo y con un dedo', () => {
        expect(pullStart(0, 1, 10, 10).phase).toBe('undecided');
        expect(pullStart(5, 1, 10, 10).phase).toBe('ignored');
        expect(pullStart(0, 2, 10, 10).phase).toBe('ignored');
    });
    it('decide una sola vez: vertical hacia abajo = tirar; horizontal, diagonal o hacia arriba = ignorar', () => {
        const s = pullStart(0, 1, 100, 100);
        expect(pullMove(s, 100 + PULL_LOCK_PX - 1, 100, 0, 1)).toBe(s); // aun sin decidir
        expect(pullMove(s, 100, 100 + 40, 0, 1)).toMatchObject({ phase: 'pulling', distance: 20 });
        expect(pullMove(s, 100 + 40, 100 + 10, 0, 1).phase).toBe('ignored');
        expect(pullMove(s, 100 + 30, 100 + 30, 0, 1).phase).toBe('ignored');
        expect(pullMove(s, 100, 100 - 40, 0, 1).phase).toBe('ignored');
        const ignored = pullMove(s, 140, 110, 0, 1);
        expect(pullMove(ignored, 140, 400, 0, 1)).toBe(ignored); // ya no se reactiva en este toque
    });
    it('varios dedos o lista desplazada cancelan; soltar refresca solo desde "tirando" y pasado el umbral', () => {
        let s = pullMove(pullStart(0, 1, 0, 0), 0, 60, 0, 1);
        expect(pullMove(s, 0, 100, 0, 2).phase).toBe('ignored');
        expect(pullMove(s, 0, 100, 3, 1).phase).toBe('ignored');
        expect(pullEnd(s).refresh).toBe(false); // 30 < PULL_TRIGGER
        s = pullMove(s, 0, 200, 0, 1);
        expect(s.distance).toBeGreaterThanOrEqual(PULL_TRIGGER);
        expect(pullEnd(s)).toEqual({ refresh: true, next: PULL_IDLE });
        expect(pullEnd(pullStart(0, 1, 0, 0)).refresh).toBe(false);
        expect(pullEnd({ ...s, phase: 'ignored' }).refresh).toBe(false);
    });
});

/** TouchEvent de jsdom sin el constructor Touch: se anaden las listas a mano. */
function touch(type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel', target: Element, x = 0, y = 0, count = 1) {
    const ev = new Event(type, { bubbles: true, cancelable: true }) as any;
    const t = { identifier: 1, target, clientX: x, clientY: y, pageX: x, pageY: y };
    const list = type === 'touchend' || type === 'touchcancel' ? [] : Array.from({ length: count }, (_, i) => ({ ...t, identifier: i + 1 }));
    ev.touches = list; ev.targetTouches = list; ev.changedTouches = [t];
    act(() => { target.dispatchEvent(ev); });
    return ev;
}

function PullHarness({ onRefresh, enabled = true }: { onRefresh: () => Promise<void> | void; enabled?: boolean }) {
    const ref = useRef<HTMLDivElement | null>(null);
    const { indicator, refreshing } = usePullToRefresh(ref, onRefresh, enabled);
    return createElement('div', { 'data-scroller': true, ref, 'data-refreshing': String(refreshing) }, indicator, createElement('div', { 'data-row': true }, 'fila'));
}
const indicatorHeight = () => {
    const n = document.querySelector<HTMLElement>('[data-pull-indicator]');
    return n ? parseFloat(n.style.height) : 0;
};
async function pull(list: Element, row: Element, moves: Array<[number, number]>, end: 'touchend' | 'touchcancel') {
    touch('touchstart', row, 100, 100);
    let max = 0;
    for (const [dx, dy] of moves) { touch('touchmove', row, 100 + dx, 100 + dy); max = Math.max(max, indicatorHeight()); }
    touch(end, row, 100 + moves.at(-1)![0], 100 + moves.at(-1)![1]);
    await act(async () => { await Promise.resolve(); });
    return max;
}
const seq = (n: number, fx: number, fy: number): Array<[number, number]> => Array.from({ length: n }, (_, i) => [fx * (i + 1), fy * (i + 1)]);

describe('usePullToRefresh con eventos tactiles', () => {
    it('tirar 200 px hacia abajo desde arriba y soltar refresca una vez y muestra el estado (role=status)', async () => {
        let resolve!: () => void;
        const onRefresh = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
        render(createElement(PullHarness, { onRefresh }));
        const list = document.querySelector('[data-scroller]')!; const row = list.querySelector('[data-row]')!;
        const max = await pull(list, row, seq(8, 0, 25), 'touchend');
        expect(max).toBeGreaterThan(PULL_TRIGGER);
        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(document.querySelector('[data-pull-indicator]')?.getAttribute('role')).toBe('status');
        await act(async () => { resolve(); await Promise.resolve(); });
        expect(document.querySelector('[data-pull-indicator]')).toBeNull();
    });

    it('un tiron corto no refresca', async () => {
        const onRefresh = vi.fn();
        render(createElement(PullHarness, { onRefresh }));
        const list = document.querySelector('[data-scroller]')!;
        await pull(list, list.querySelector('[data-row]')!, seq(4, 0, 10), 'touchend');
        expect(onRefresh).not.toHaveBeenCalled();
    });

    it('un swipe horizontal con deriva hacia abajo NO muestra el indicador ni refresca', async () => {
        const onRefresh = vi.fn();
        render(createElement(PullHarness, { onRefresh }));
        const list = document.querySelector('[data-scroller]')!;
        const max = await pull(list, list.querySelector('[data-row]')!, seq(8, 20, 5), 'touchend');
        expect(max).toBe(0);
        expect(onRefresh).not.toHaveBeenCalled();
    });

    it('cancelar el toque (touchcancel) tras tirar mucho NO refresca y oculta el indicador', async () => {
        const onRefresh = vi.fn();
        render(createElement(PullHarness, { onRefresh }));
        const list = document.querySelector('[data-scroller]')!;
        const max = await pull(list, list.querySelector('[data-row]')!, seq(8, 0, 25), 'touchcancel');
        expect(max).toBeGreaterThan(0);
        expect(onRefresh).not.toHaveBeenCalled();
        expect(document.querySelector('[data-pull-indicator]')).toBeNull();
    });

    it('con la lista desplazada, con dos dedos o si la lista empieza a moverse a mitad del gesto no se tira', async () => {
        const onRefresh = vi.fn();
        render(createElement(PullHarness, { onRefresh }));
        const list = document.querySelector<HTMLElement>('[data-scroller]')!; const row = list.querySelector('[data-row]')!;
        list.scrollTop = 40;
        await pull(list, row, seq(8, 0, 25), 'touchend');
        list.scrollTop = 0;
        // dos dedos
        touch('touchstart', row, 100, 100, 2);
        touch('touchmove', row, 100, 300, 2);
        touch('touchend', row, 100, 300);
        // el scroll empieza a mitad del gesto
        touch('touchstart', row, 100, 100);
        touch('touchmove', row, 100, 160);
        list.scrollTop = 20; act(() => { list.dispatchEvent(new Event('scroll')); });
        touch('touchmove', row, 100, 400);
        touch('touchend', row, 100, 400);
        await act(async () => { await Promise.resolve(); });
        expect(onRefresh).not.toHaveBeenCalled();
    });

    it('deshabilitado (escritorio): ningun listener', async () => {
        const onRefresh = vi.fn();
        render(createElement(PullHarness, { onRefresh, enabled: false }));
        const list = document.querySelector('[data-scroller]')!;
        await pull(list, list.querySelector('[data-row]')!, seq(8, 0, 25), 'touchend');
        expect(onRefresh).not.toHaveBeenCalled();
    });

    it('registra los listeners de movimiento como pasivos (no bloquean el scroll nativo)', () => {
        const spy = vi.spyOn(HTMLElement.prototype, 'addEventListener');
        render(createElement(PullHarness, { onRefresh: vi.fn() }));
        const moveCalls = spy.mock.calls.filter((c) => c[0] === 'touchmove' || c[0] === 'touchstart');
        expect(moveCalls.length).toBe(2);
        for (const c of moveCalls) expect(c[2]).toMatchObject({ passive: true });
        spy.mockRestore();
    });
});

// --- Fila: swipe con eventos de puntero de tipo "touch" -------------------------------------------------------------
function pointer(type: string, target: Element, x: number, y: number, timeStamp?: number) {
    const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1 }) as any;
    if (timeStamp !== undefined) Object.defineProperty(ev, 'timeStamp', { value: timeStamp }); // instante SIMULADO del evento
    Object.defineProperties(ev, { pointerId: { value: 3 }, pointerType: { value: 'touch' }, isPrimary: { value: true }, width: { value: 1 }, height: { value: 1 }, pressure: { value: 0.5 } });
    act(() => { target.dispatchEvent(ev); });
}
const rowProps = (over: Partial<MailRowProps> = {}): MailRowProps => ({
    email: { id: 'e1', from: 'Ana <ana@x.com>', subject: 'Hola', createdAt: '2025-01-01T00:00:00.000Z', read: false, starred: false, snippet: 'texto', to: 'me@x.com' },
    index: 0, threadCount: 1, participants: { names: [], extra: 0 }, attachments: { count: 0, names: [] }, labels: [], labelsKey: '',
    folder: 'inbox', density: 'comfortable', snippetLines: 1, isSelected: false, isFocused: false, isOpen: false,
    swipeRight: 'archive', swipeLeft: 'trash', swipeEnabled: true,
    onFocusRow: vi.fn(), onSelect: vi.fn(), onSelectToggle: vi.fn(), onPrefetch: vi.fn(), onAction: vi.fn(), onMenu: vi.fn(), ...over,
});
async function drag(el: Element, dx: number, dy: number, end: 'pointerup' | 'pointercancel' = 'pointerup') {
    pointer('pointerdown', el, 200, 100);
    for (let i = 1; i <= 8; i++) {
        pointer('pointermove', el, 200 + (dx * i) / 8, 100 + (dy * i) / 8);
        await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    }
    pointer(end, el, 200 + dx, 100 + dy);
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
}

describe('MailRow: swipe tactil', () => {
    it('la fila solo se arrastra en X (touch-action: pan-y deja el scroll vertical al navegador)', () => {
        render(createElement(MailRow, rowProps()));
        const el = document.querySelector<HTMLElement>('#email-row-e1')!;
        expect(el.style.touchAction).toBe('pan-y');
    });

    it.each([
        ['derecha 160 px -> accion de la derecha', 160, 4, 'archive'],
        ['izquierda 160 px -> accion de la izquierda', -160, 6, 'trash'],
    ])('%s', async (_n, dx, dy, expected) => {
        const props = rowProps();
        render(createElement(MailRow, props));
        await drag(document.querySelector('#email-row-e1')!, dx, dy);
        expect(props.onAction).toHaveBeenCalledTimes(1);
        expect(props.onAction).toHaveBeenCalledWith(expected, 'e1');
    });

    it.each([
        ['corto (60 px)', 60, 0, 'pointerup'],
        ['vertical (scroll)', 20, 140, 'pointerup'],
        ['diagonal', 120, 100, 'pointerup'],
        ['cancelado por el navegador a mitad del gesto', 160, 0, 'pointercancel'],
    ] as const)('no ejecuta nada: %s', async (_n, dx, dy, end) => {
        const props = rowProps();
        render(createElement(MailRow, props));
        await drag(document.querySelector('#email-row-e1')!, dx, dy, end);
        expect(props.onAction).not.toHaveBeenCalled();
        expect(props.onSelect).not.toHaveBeenCalled(); // el arrastre tampoco "abre" el correo
    });

    it('sin accion en un lado: ese lado no confirma (programados no tienen gestos)', async () => {
        const props = rowProps({ swipeLeft: null });
        render(createElement(MailRow, props));
        await drag(document.querySelector('#email-row-e1')!, -160, 0);
        expect(props.onAction).not.toHaveBeenCalled();
        const none = rowProps({ swipeRight: null, swipeLeft: null, folder: 'scheduled' });
        render(createElement(MailRow, none));
        expect(document.querySelector<HTMLElement>('#email-row-e1')!.style.touchAction).not.toBe('pan-y');
    });
});

// --- Flick medido con timestamps controlados -------------------------------------------------------------------------
describe('velocidad del gesto: reloj inyectable y timeStamp simulados', () => {
    it('createVelocityTracker: pendiente sobre la ventana final, con signo; pausa antes de soltar = 0', () => {
        const fast = createVelocityTracker();
        fast.reset(0, 1000);
        for (let i = 1; i <= 5; i++) fast.push(14 * i, 1000 + 14 * i); // 1000 px/s
        expect(fast.velocity()).toBeCloseTo(1000, 0);
        const left = createVelocityTracker();
        left.reset(0, 0); left.push(-50, 50);
        expect(left.velocity()).toBeCloseTo(-1000, 0);
        const slow = createVelocityTracker();
        slow.reset(0, 0);
        for (let i = 1; i <= 7; i++) slow.push(10 * i, 100 * i); // 100 px/s
        expect(slow.velocity()).toBeCloseTo(100, 0);
        const paused = createVelocityTracker();
        paused.reset(0, 0); paused.push(70, 70); paused.push(70, 400); // se detuvo 330 ms y levanto
        expect(paused.velocity()).toBe(0);
        expect(SWIPE_VELOCITY_WINDOW_MS).toBe(100);
    });

    it('sin datos suficientes o desordenadas: velocidad 0 y sin excepciones', () => {
        const t = createVelocityTracker();
        expect(t.velocity()).toBe(0);
        t.reset(5, 100);
        expect(t.velocity()).toBe(0);
        t.push(50, 103); // menos de 8 ms de recorrido: no es fiable
        expect(t.velocity()).toBe(0);
        t.push(90, 60); // llega "del pasado": se ignora
        expect(t.count()).toBe(2);
    });

    it('eventTime usa el timeStamp del evento y, si no lo hay, el reloj inyectado', () => {
        expect(eventTime({ timeStamp: 1234.5 }, () => 9)).toBe(1234.5);
        expect(eventTime({ timeStamp: 0 }, () => 9)).toBe(9);
        expect(eventTime({}, () => 7)).toBe(7);
        expect(eventTime(null, () => 5)).toBe(5);
        expect(eventTime({ timeStamp: NaN }, () => 3)).toBe(3);
        expect(typeof defaultClock()).toBe('number');
    });

    it('resolveSwipe con la velocidad medida: corto y rapido confirma; corto y lento no; direccion contraria no', () => {
        const fast = createVelocityTracker(); fast.reset(0, 0); fast.push(70, 70);
        expect(resolveSwipe({ offsetX: 70, offsetY: 0, velocityX: fast.velocity() })).toBe('right');
        const slow = createVelocityTracker(); slow.reset(0, 0); slow.push(70, 700);
        expect(resolveSwipe({ offsetX: 70, offsetY: 0, velocityX: slow.velocity() })).toBeNull();
        expect(resolveSwipe({ offsetX: 70, offsetY: 0, velocityX: -fast.velocity() })).toBeNull();
    });
});

describe('MailRow: flick medido con eventos de puntero de timestamps simulados', () => {
    /** dx px en `ms` ms de tiempo SIMULADO (el tiempo real solo deja pasar los frames de la animacion); `hold` = pausa simulada antes de soltar. */
    async function flickGesture(el: Element, dx: number, ms: number, hold = 0, dy = 0) {
        const t0 = 5000;
        pointer('pointerdown', el, 200, 100, t0);
        const steps = 7;
        for (let i = 1; i <= steps; i++) {
            pointer('pointermove', el, 200 + (dx * i) / steps, 100 + (dy * i) / steps, t0 + (ms * i) / steps);
            await act(async () => { await new Promise((r) => setTimeout(r, 15)); });
        }
        pointer('pointerup', el, 200 + dx, 100 + dy, t0 + ms + hold);
        await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    }

    it('un flick corto (70 px) y rapido (70 ms) dispara la accion de la derecha; y de la izquierda', async () => {
        for (const [dx, expected] of [[70, 'archive'], [-70, 'trash']] as const) {
            const props = rowProps();
            render(createElement(MailRow, props));
            await flickGesture(document.querySelector('#email-row-e1')!, dx, 70);
            expect(props.onAction, `dx=${dx}`).toHaveBeenCalledTimes(1);
            expect(props.onAction).toHaveBeenCalledWith(expected, 'e1');
            act(() => root.render(createElement('div')));
        }
    });

    it('el mismo recorrido corto pero LENTO (70 px en 700 ms) no hace nada', async () => {
        const props = rowProps();
        render(createElement(MailRow, props));
        await flickGesture(document.querySelector('#email-row-e1')!, 70, 700);
        expect(props.onAction).not.toHaveBeenCalled();
        expect(props.onSelect).not.toHaveBeenCalled();
    });

    it('rapido pero con pausa de 300 ms antes de soltar tampoco (ya no llevaba velocidad al levantar el dedo)', async () => {
        const props = rowProps();
        render(createElement(MailRow, props));
        await flickGesture(document.querySelector('#email-row-e1')!, 70, 70, 300);
        expect(props.onAction).not.toHaveBeenCalled();
    });

    it('por debajo de la distancia minima del flick (40 px) ni siquiera rapido confirma; un flick diagonal es scroll', async () => {
        const a = rowProps();
        render(createElement(MailRow, a));
        await flickGesture(document.querySelector('#email-row-e1')!, 40, 40);
        expect(a.onAction).not.toHaveBeenCalled();
        act(() => root.render(createElement('div')));
        const b = rowProps();
        render(createElement(MailRow, b));
        await flickGesture(document.querySelector('#email-row-e1')!, 70, 70, 0, 90);
        expect(b.onAction).not.toHaveBeenCalled();
    });

    it('un arrastre largo (160 px) confirma aunque sea lento: la distancia manda', async () => {
        const props = rowProps();
        render(createElement(MailRow, props));
        await flickGesture(document.querySelector('#email-row-e1')!, 160, 1600);
        expect(props.onAction).toHaveBeenCalledWith('archive', 'e1');
    });

    it('cancelar el toque a mitad no ejecuta la accion aunque fuera rapido, y limpia sus listeners de ventana', async () => {
        const remove = vi.spyOn(window, 'removeEventListener');
        const props = rowProps();
        render(createElement(MailRow, props));
        const el = document.querySelector('#email-row-e1')!;
        pointer('pointerdown', el, 200, 100, 9000);
        pointer('pointermove', el, 270, 100, 9060);
        pointer('pointercancel', el, 270, 100, 9061);
        await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
        expect(props.onAction).not.toHaveBeenCalled();
        expect(remove.mock.calls.filter((c) => c[0] === 'pointermove').length).toBeGreaterThan(0);
        remove.mockRestore();
    });
});
