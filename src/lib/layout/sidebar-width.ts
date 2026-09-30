/**
 * Ancho de la barra lateral (escritorio): calculo puro y persistencia saneada. Sin React ni DOM (excepto el `Storage`
 * que se le pasa), para poder probarlo con vitest en node.
 *
 * Regla: por defecto ~20 % del viewport, con minimo 208 px y maximo min(420 px, 32 % del viewport). El usuario puede
 * arrastrar el borde (o usar el teclado) dentro de ese rango; el ancho elegido se guarda en px con clave versionada.
 * Por debajo de COLLAPSE_BELOW_PX la barra deja de ser fija: se sustituye por un riel de iconos + cajon.
 */

export const SIDEBAR_MIN_PX = 208;
export const SIDEBAR_MAX_PX = 420;
export const SIDEBAR_DEFAULT_RATIO = 0.2;
export const SIDEBAR_MAX_RATIO = 0.32;
/** Por debajo de este ancho de viewport (y por encima del layout movil) la barra pasa a riel + cajon. */
export const COLLAPSE_BELOW_PX = 900;
/** Ancho del riel de iconos cuando la barra esta colapsada. */
export const RAIL_PX = 56;
/** Paso de las flechas (Mayus multiplica por 4). */
export const KEYBOARD_STEP_PX = 16;
export const SIDEBAR_STORAGE_KEY = 'bloomx:sidebar:width:v1';

/** Limites sanos para lo leido de localStorage (cualquier cosa fuera de rango se descarta, no se recorta). */
const STORED_MIN_PX = 100;
const STORED_MAX_PX = 4000;

export interface SidebarBounds { min: number; max: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** true si el viewport es demasiado estrecho para una barra fija (riel de iconos + cajon). */
export function isRailViewport(viewportWidth: number): boolean {
    return Number.isFinite(viewportWidth) && viewportWidth < COLLAPSE_BELOW_PX;
}

/** Rango permitido para un viewport dado. El maximo nunca baja del minimo. */
export function sidebarBounds(viewportWidth: number): SidebarBounds {
    const vw = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 1280;
    return { min: SIDEBAR_MIN_PX, max: clamp(Math.floor(vw * SIDEBAR_MAX_RATIO), SIDEBAR_MIN_PX, SIDEBAR_MAX_PX) };
}

export function clampSidebarWidth(width: number, viewportWidth: number): number {
    const { min, max } = sidebarBounds(viewportWidth);
    if (!Number.isFinite(width)) return defaultSidebarWidth(viewportWidth);
    return Math.round(clamp(width, min, max));
}

/** ~20 % del viewport dentro del rango. */
export function defaultSidebarWidth(viewportWidth: number): number {
    const vw = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 1280;
    const { min, max } = sidebarBounds(vw);
    return Math.round(clamp(vw * SIDEBAR_DEFAULT_RATIO, min, max));
}

/** Valor guardado -> px validos, o null si esta corrupto (no numerico, fuera de rango, decimales raros, NaN...). */
export function sanitizeStoredWidth(raw: unknown): number | null {
    let n: number;
    if (typeof raw === 'number') n = raw;
    else if (typeof raw === 'string' && /^\d{1,5}(\.\d+)?$/.test(raw.trim())) n = Number(raw.trim());
    else return null;
    if (!Number.isFinite(n) || n < STORED_MIN_PX || n > STORED_MAX_PX) return null;
    return Math.round(n);
}

/** Ancho a usar: el guardado (recortado al rango actual) o el de por defecto. */
export function resolveSidebarWidth(stored: number | null | undefined, viewportWidth: number): number {
    return stored == null ? defaultSidebarWidth(viewportWidth) : clampSidebarWidth(stored, viewportWidth);
}

/**
 * Siguiente ancho para una tecla del separador, o null si la tecla no aplica. `rtl` invierte las flechas (la barra queda
 * a la derecha). Home = minimo, End = maximo, Enter = valor por defecto.
 */
export function nextWidthForKey(current: number, key: string, viewportWidth: number, opts: { shift?: boolean; rtl?: boolean } = {}): number | null {
    const step = KEYBOARD_STEP_PX * (opts.shift ? 4 : 1);
    const grow = opts.rtl ? 'ArrowLeft' : 'ArrowRight';
    const shrink = opts.rtl ? 'ArrowRight' : 'ArrowLeft';
    switch (key) {
        case grow: return clampSidebarWidth(current + step, viewportWidth);
        case shrink: return clampSidebarWidth(current - step, viewportWidth);
        case 'Home': return sidebarBounds(viewportWidth).min;
        case 'End': return sidebarBounds(viewportWidth).max;
        case 'Enter': return defaultSidebarWidth(viewportWidth);
        default: return null;
    }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): StorageLike | null {
    try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

export function readStoredSidebarWidth(storage: StorageLike | null = defaultStorage()): number | null {
    if (!storage) return null;
    try { return sanitizeStoredWidth(storage.getItem(SIDEBAR_STORAGE_KEY)); } catch { return null; }
}

/** Guarda el ancho (o borra la clave si es null = "restablecer"). Nunca lanza. */
export function writeStoredSidebarWidth(width: number | null, storage: StorageLike | null = defaultStorage()): void {
    if (!storage) return;
    try {
        if (width == null) storage.removeItem(SIDEBAR_STORAGE_KEY);
        else storage.setItem(SIDEBAR_STORAGE_KEY, String(Math.round(width)));
    } catch { /* cuota / modo privado: el ancho solo dura la sesion */ }
}

// ------------------------------------------------------------------ cookie (para que el servidor pinte el ancho correcto)
export const SIDEBAR_COOKIE = 'bloomx-sidebar-w';
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365;

/** Valor de `Set-Cookie`/`document.cookie` para el ancho (o su borrado si es null). No es un dato sensible. */
export function serializeSidebarCookie(width: number | null, secure = false): string {
    const base = width == null ? `${SIDEBAR_COOKIE}=; Max-Age=0` : `${SIDEBAR_COOKIE}=${Math.round(width)}; Max-Age=${COOKIE_MAX_AGE_S}`;
    return `${base}; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** Valor de la cookie (ya extraido) -> px validos o null. */
export function parseSidebarCookie(value: string | null | undefined): number | null {
    return typeof value === 'string' ? sanitizeStoredWidth(value) : null;
}

/** Escribe la cookie desde el navegador. Nunca lanza. */
export function writeSidebarCookie(width: number | null): void {
    if (typeof document === 'undefined') return;
    try { document.cookie = serializeSidebarCookie(width, typeof location !== 'undefined' && location.protocol === 'https:'); } catch { /* cookies bloqueadas */ }
}

/**
 * Ancho CSS para el primer HTML (antes de conocer el viewport): el px guardado en la cookie, o el 20 % del viewport
 * con los mismos limites que el calculo en JS. Evita saltos al navegar o recargar.
 */
export function sidebarCssWidth(stored: number | null): string {
    const max = `max(${SIDEBAR_MIN_PX}px, min(${SIDEBAR_MAX_PX}px, ${SIDEBAR_MAX_RATIO * 100}vw))`;
    const base = stored == null ? `${SIDEBAR_DEFAULT_RATIO * 100}vw` : `${stored}px`;
    return `clamp(${SIDEBAR_MIN_PX}px, ${base}, ${max})`;
}
