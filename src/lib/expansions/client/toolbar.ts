/**
 * Logica PURA de las barras de acciones de extensiones (EMAIL_TOOLBAR, COMPOSER_TOOLBAR, CALENDAR_TOOLBAR, CONTACTS_TOOLBAR):
 * claves estables, orden, que acciones estan ancladas, cuantas caben y que glifo se pinta cuando el icono no existe.
 * Sin React ni DOM: se prueba con vitest en node (ver __tests__/toolbar.test.ts).
 */
import { resolveIconRef } from '../icon-ref';

/** Puntos de montaje que usan la presentacion "barra compacta". */
export const TOOLBAR_MOUNT_POINTS: ReadonlySet<string> = new Set(['EMAIL_TOOLBAR', 'COMPOSER_TOOLBAR', 'CALENDAR_TOOLBAR', 'CONTACTS_TOOLBAR']);
export const isToolbarMountPoint = (point: string): boolean => TOOLBAR_MOUNT_POINTS.has(point);

/** Lado del boton de icono (px). 36 con puntero grueso (tactil). */
export const TOOLBAR_BUTTON_PX = 32;
export const TOOLBAR_BUTTON_COARSE_PX = 36;
export const TOOLBAR_GAP_PX = 2;
/** Cuantas acciones se anclan por defecto cuando el manifest no lo indica (y tope de las que el manifest ancla). */
export const DEFAULT_PINNED = 2;
export const MAX_DEFAULT_PINNED = 3;
/** Nombre accesible/visible maximo de una accion. */
const MAX_LABEL = 60;

export interface ToolbarHint { pinned?: boolean; priority?: number; label?: string; description?: string }

export interface ToolbarItem {
    /** Clave estable (extension + punto + id del mount): es la que se guarda en las preferencias. */
    key: string;
    extensionId: string;
    extensionName: string;
    label: string;
    description?: string;
    /** Nombre de icono tal como lo declara el manifest (puede no existir): Lucide, brand:<slug>, lucide:<Nombre> o initials:<XY>. */
    icon?: string;
    /** Icono de la EXTENSION (manifest.icon): respaldo cuando la accion no declara el suyo. */
    extensionIcon?: string;
    /** El manifest la ancla por defecto. */
    manifestPinned: boolean;
    priority: number;
    /** Posicion original (desempate estable). */
    order: number;
}

const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';

/** Clave estable de una accion: `<extension>:<punto>:<id|destino|label>` saneada (segura para guardar en prefs). */
export function toolbarItemKey(extensionId: string, point: string, discriminator: string): string {
    return `${slug(extensionId)}:${point.toLowerCase().replace(/[^a-z0-9_]/g, '')}:${slug(discriminator)}`.slice(0, 190);
}

export const clampLabel = (v: unknown, fallback = ''): string => (typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_LABEL) : fallback);

/** Orden de las acciones: prioridad ascendente y, a igualdad, el orden original. */
export function sortItems<T extends Pick<ToolbarItem, 'priority' | 'order'>>(items: T[]): T[] {
    return items.slice().sort((a, b) => a.priority - b.priority || a.order - b.order);
}

/** Claves ancladas por defecto: las que el manifest ancla (max 3) o, si ninguna, las 2 primeras. */
export function defaultPinnedKeys(items: ToolbarItem[]): string[] {
    const ordered = sortItems(items);
    const declared = ordered.filter((i) => i.manifestPinned);
    return (declared.length > 0 ? declared.slice(0, MAX_DEFAULT_PINNED) : ordered.slice(0, DEFAULT_PINNED)).map((i) => i.key);
}

/** Claves ancladas efectivas (en el orden de la barra): el valor por defecto con las decisiones explicitas del usuario encima. */
export function resolvePinnedKeys(items: ToolbarItem[], pins: Record<string, boolean> | undefined): string[] {
    const base = new Set(defaultPinnedKeys(items));
    const out: string[] = [];
    for (const item of sortItems(items)) {
        const explicit = pins?.[item.key];
        if (explicit === true || (explicit === undefined && base.has(item.key))) out.push(item.key);
    }
    return out;
}

/**
 * Cuantos botones anclados caben. `available` = ancho del contenedor; `reserved` = lo que ocupan el boton "Extensiones" y el
 * separador (siempre visibles). Nunca devuelve mas de `count` ni menos de 0.
 */
export function fitPinnedCount(opts: { available: number; count: number; button?: number; gap?: number; reserved: number }): number {
    const button = opts.button ?? TOOLBAR_BUTTON_PX;
    const gap = opts.gap ?? TOOLBAR_GAP_PX;
    if (!Number.isFinite(opts.available) || opts.available <= 0) return 0;
    const room = opts.available - opts.reserved;
    if (room < button) return 0;
    return Math.max(0, Math.min(opts.count, Math.floor((room + gap) / (button + gap))));
}

// ------------------------------------------------------------------ glifo (icono o insignia de texto)
export type ToolbarGlyph = { kind: 'icon'; name: string } | { kind: 'text'; text: string } | { kind: 'ref'; icon: string };

/** Iniciales para la insignia: dos palabras -> 2 letras; una palabra corta (<=3) -> tal cual en mayusculas; si no, sus 2 primeras. */
export function initialsFor(label: string): string {
    const words = label.trim().split(/[\s\-_/]+/).filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) {
        const w = Array.from(words[0]).filter((c) => /\p{L}|\p{N}/u.test(c)).join('');
        if (!w) return '?';
        return (w.length <= 3 ? w : w.slice(0, 2)).toUpperCase();
    }
    return (Array.from(words[0])[0] + Array.from(words[1])[0]).toUpperCase();
}

/**
 * Que pintar dentro del cuadrado del boton. Un nombre Lucide valido -> icono. Un emoji o simbolo corto -> tal cual. Un nombre
 * que no existe (p. ej. "GIF", "HubSpot") -> insignia contenida con iniciales, nunca texto suelto ni un icono de ayuda.
 */
export function toolbarGlyph(icon: string | undefined, label: string, isKnownIcon: (name: string) => boolean): ToolbarGlyph {
    // Logotipo de marca / ficha de iniciales (brand:zoom, initials:AB, y nombres antiguos como "Zoom").
    const ref = icon ? resolveIconRef(icon) : null;
    if (icon && ref && ref.kind !== 'lucide') return { kind: 'ref', icon };
    if (icon && isKnownIcon(icon)) return { kind: 'icon', name: icon.startsWith('lucide:') ? icon.slice(7) : icon };
    if (icon && icon.length <= 4 && !/^[A-Za-z0-9]+$/.test(icon)) return { kind: 'text', text: icon };
    return { kind: 'text', text: initialsFor(icon && /^[A-Za-z0-9]{1,3}$/.test(icon) ? icon : label || icon || '') };
}

// ------------------------------------------------------------------ agrupacion para el menu
export interface ToolbarGroup { extensionId: string; extensionName: string; items: ToolbarItem[] }

/** Agrupa por extension conservando el orden de la primera aparicion de cada una. */
export function groupByExtension(items: ToolbarItem[]): ToolbarGroup[] {
    const groups = new Map<string, ToolbarGroup>();
    for (const item of items) {
        const g = groups.get(item.extensionId) ?? { extensionId: item.extensionId, extensionName: item.extensionName, items: [] };
        g.items.push(item);
        groups.set(item.extensionId, g);
    }
    return Array.from(groups.values());
}

/** Busqueda del menu: coincidencia sin acentos ni mayusculas sobre nombre, extension y descripcion. */
export function matchesQuery(item: ToolbarItem, query: string): boolean {
    const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const q = fold(query.trim());
    if (!q) return true;
    return [item.label, item.extensionName, item.description ?? ''].some((s) => fold(s).includes(q));
}

/** Umbral a partir del cual el menu muestra el cuadro de busqueda. */
export const SEARCH_THRESHOLD = 7;

// ------------------------------------------------------------------ ultima accion usada (indicador discreto)
export const LAST_USED_STORAGE_KEY = 'bloomx:ext-toolbar:last:v1';

export function readLastUsed(point: string, storage: Pick<Storage, 'getItem'> | null = safeStorage()): string | null {
    try {
        const raw = storage?.getItem(LAST_USED_STORAGE_KEY);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        const v = obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[point] : null;
        return typeof v === 'string' && /^[A-Za-z0-9._:-]{1,190}$/.test(v) ? v : null;
    } catch { return null; }
}

export function writeLastUsed(point: string, key: string, storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()): void {
    try {
        if (!storage) return;
        const raw = storage.getItem(LAST_USED_STORAGE_KEY);
        const obj = raw ? JSON.parse(raw) : {};
        const next = obj && typeof obj === 'object' && !Array.isArray(obj) ? { ...obj } : {};
        (next as Record<string, string>)[point] = key;
        storage.setItem(LAST_USED_STORAGE_KEY, JSON.stringify(next));
    } catch { /* almacenamiento bloqueado */ }
}

function safeStorage(): Storage | null {
    try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}
