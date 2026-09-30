// Gestos tactiles de la bandeja (logica pura, sin React ni DOM): decidir cuando un arrastre horizontal es un "swipe" y cuando
// un arrastre vertical desde arriba es "tirar para actualizar". Verificados con eventos tactiles reales en el navegador
// integrado (emulacion movil) y reproducidos en jsdom (src/components/__tests__/mail-gestures.test.ts).

// ---------------------------------------------------------------------------
// Swipe sobre una fila
// ---------------------------------------------------------------------------

/** Desplazamiento horizontal (px) a partir del cual soltar confirma la accion. */
export const SWIPE_DISTANCE = 96;
/** Un gesto rapido ("flick") confirma con menos recorrido, si va en la misma direccion. */
export const SWIPE_FLICK_DISTANCE = 56;
export const SWIPE_FLICK_VELOCITY = 500; // px/s
/** El movimiento debe ser claramente horizontal: |dx| >= |dy| * ratio. Un gesto diagonal es un scroll, no un swipe. */
export const SWIPE_AXIS_RATIO = 1.5;

export type SwipeSide = 'left' | 'right';

// ---------------------------------------------------------------------------
// Velocidad del gesto (flick) con reloj inyectable
// ---------------------------------------------------------------------------

/** Ventana (ms) sobre la que se mide la velocidad al soltar: lo que hizo el dedo justo antes de levantarse. */
export const SWIPE_VELOCITY_WINDOW_MS = 100;
/** Menos separacion (ms) entre la primera y la ultima muestra que esto no da una velocidad fiable. */
export const SWIPE_MIN_SAMPLE_SPAN_MS = 8;

export type Clock = () => number;

/** Reloj por defecto (ms de alta resolucion, el mismo origen que Event.timeStamp). Las pruebas pasan uno propio. */
export const defaultClock: Clock = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

/**
 * Instante de un evento: su `timeStamp` si es valido (eventos reales y sinteticos con timestamps simulados); si no (0 o ausente),
 * el reloj inyectado.
 */
export function eventTime(event: { timeStamp?: number } | null | undefined, clock: Clock = defaultClock): number {
    const ts = event?.timeStamp;
    return typeof ts === 'number' && Number.isFinite(ts) && ts > 0 ? ts : clock();
}

export interface VelocityTracker {
    /** Empieza un gesto nuevo (borra las muestras anteriores). */
    reset(x: number, t: number): void;
    push(x: number, t: number): void;
    /** px/s con signo (positivo = hacia la derecha) sobre la ventana final; 0 si no hay datos suficientes. */
    velocity(): number;
    /** Muestras acumuladas (menos de 2 = el gesto no aporto movimiento medible). */
    count(): number;
}

/**
 * Velocidad horizontal como pendiente entre la primera y la ultima muestra de los ultimos `windowMs` ms. Si el dedo se detuvo antes de
 * levantarse, la ventana solo contiene el instante de soltar y la velocidad es 0 (un arrastre lento con una pausa no es un flick).
 */
export function createVelocityTracker(windowMs: number = SWIPE_VELOCITY_WINDOW_MS): VelocityTracker {
    let samples: Array<{ x: number; t: number }> = [];
    return {
        reset(x, t) { samples = [{ x, t }]; },
        push(x, t) {
            const last = samples[samples.length - 1];
            if (last && t < last.t) return; // eventos desordenados: se ignoran
            samples.push({ x, t });
            const min = t - windowMs;
            while (samples.length > 2 && samples[1].t < min) samples.shift();
            if (samples.length > 1 && samples[0].t < min) samples.shift();
        },
        count() { return samples.length; },
        velocity() {
            if (samples.length < 2) return 0;
            const first = samples[0];
            const last = samples[samples.length - 1];
            const span = last.t - first.t;
            if (span < SWIPE_MIN_SAMPLE_SPAN_MS) return 0;
            return ((last.x - first.x) / span) * 1000;
        },
    };
}

export interface SwipeRelease {
    offsetX: number;
    offsetY: number;
    velocityX?: number;
    /** El navegador cancelo el gesto (empezo a hacer scroll, llamada entrante...): nunca ejecuta la accion. */
    cancelled?: boolean;
}

/** Lado del swipe que se confirma al soltar (o null si no se confirma nada). */
export function resolveSwipe({ offsetX, offsetY, velocityX = 0, cancelled = false }: SwipeRelease): SwipeSide | null {
    if (cancelled) return null;
    const ax = Math.abs(offsetX);
    const ay = Math.abs(offsetY);
    if (ax < ay * SWIPE_AXIS_RATIO) return null;
    const sameDirection = Math.sign(velocityX) === Math.sign(offsetX);
    const flick = ax >= SWIPE_FLICK_DISTANCE && Math.abs(velocityX) >= SWIPE_FLICK_VELOCITY && sameDirection;
    if (ax < SWIPE_DISTANCE && !flick) return null;
    return offsetX > 0 ? 'right' : 'left';
}

/** 0..1: cuanto se ha completado el gesto (opacidad de la capa de accion). */
export function swipeProgress(offsetX: number, side: SwipeSide): number {
    const signed = side === 'right' ? offsetX : -offsetX;
    return Math.min(Math.max(signed / SWIPE_DISTANCE, 0), 1);
}

// ---------------------------------------------------------------------------
// Tirar para actualizar
// ---------------------------------------------------------------------------

/** Distancia visible (px) a partir de la cual soltar dispara el refresco. */
export const PULL_TRIGGER = 48;
export const PULL_MAX = 110;
/** Recorrido minimo antes de decidir si el gesto es vertical (tirar) u horizontal (swipe / scroll lateral). */
export const PULL_LOCK_PX = 10;
/** Un gesto solo es "tirar" si es claramente vertical: dy >= dx * ratio. */
export const PULL_AXIS_RATIO = 1.2;
export const PULL_RESISTANCE = 0.5;

/** Distancia visible de "tirar": amortiguada (resistencia) y acotada. */
export function pullDistance(dy: number): number {
    if (dy <= 0) return 0;
    return Math.min(PULL_MAX, dy * PULL_RESISTANCE);
}

export type PullPhase = 'idle' | 'undecided' | 'pulling' | 'ignored';

export interface PullState {
    phase: PullPhase;
    startX: number;
    startY: number;
    /** Distancia visible actual (0 salvo en la fase `pulling`). */
    distance: number;
}

export const PULL_IDLE: PullState = { phase: 'idle', startX: 0, startY: 0, distance: 0 };
const PULL_IGNORED: PullState = { ...PULL_IDLE, phase: 'ignored' };

/** Inicio del toque: solo cuenta arriba del todo y con UN dedo. */
export function pullStart(scrollTop: number, touchCount: number, x: number, y: number): PullState {
    if (scrollTop > 0 || touchCount !== 1) return PULL_IGNORED;
    return { phase: 'undecided', startX: x, startY: y, distance: 0 };
}

/**
 * Movimiento: tras PULL_LOCK_PX se decide una sola vez. Vertical hacia abajo = tirar. Horizontal, hacia arriba o diagonal = se
 * ignora hasta soltar (asi un swipe con algo de deriva hacia abajo no muestra el indicador ni refresca). Varios dedos o una
 * lista que ya no esta arriba cancelan el gesto.
 */
export function pullMove(state: PullState, x: number, y: number, scrollTop: number, touchCount: number): PullState {
    if (state.phase === 'idle' || state.phase === 'ignored') return state;
    if (touchCount !== 1 || scrollTop > 0) return PULL_IGNORED;
    const dx = x - state.startX;
    const dy = y - state.startY;
    if (state.phase === 'undecided') {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < PULL_LOCK_PX) return state;
        if (dy <= 0 || dy < Math.abs(dx) * PULL_AXIS_RATIO) return PULL_IGNORED;
        return { ...state, phase: 'pulling', distance: pullDistance(dy) };
    }
    return { ...state, distance: pullDistance(dy) };
}

/** Soltar: refresca solo si se estaba tirando y se llego al umbral. */
export function pullEnd(state: PullState): { refresh: boolean; next: PullState } {
    return { refresh: state.phase === 'pulling' && state.distance >= PULL_TRIGGER, next: PULL_IDLE };
}
