/**
 * Operaciones puras de reordenar / re-anidar etiquetas (las comparten el arrastre, el teclado y el menu "Mover a...").
 * Cada plan devuelve la lista de cambios para POST /api/labels/reorder (o un error que la interfaz muestra sin llamar al servidor).
 */
import { checkMove, type LabelRow } from './model';

type L = Pick<LabelRow, 'id' | 'name' | 'parentId' | 'sortOrder'>;
export interface ReorderItem { id: string; parentId: string | null; sortOrder: number }
export type Plan = { ok: true; items: ReorderItem[] } | { ok: false; code: 'cycle' | 'depth' | 'parent_missing' | 'self' | 'conflict' | 'noop'; error: string };
export type DropZone = 'before' | 'inside' | 'after';

const cmpName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

/** Hermanas de un padre en el orden de dibujo. */
export function siblingsOf<T extends L>(labels: T[], parentId: string | null): T[] {
    return labels.filter((l) => (l.parentId ?? null) === parentId).sort((a, b) => (a.sortOrder - b.sortOrder) || cmpName(a.name, b.name) || a.id.localeCompare(b.id));
}

const renumber = (ids: string[], parentId: string | null): ReorderItem[] => ids.map((id, i) => ({ id, parentId, sortOrder: i }));

function sameNameClash(labels: L[], id: string, parentId: string | null): boolean {
    const me = labels.find((l) => l.id === id);
    return !!me && labels.some((l) => l.id !== id && (l.parentId ?? null) === parentId && cmpName(l.name, me.name) === 0);
}

/** Coloca `id` bajo `parentId` en la posicion `index` entre sus hermanas (index = null: al final). */
export function planPlace(labels: L[], id: string, parentId: string | null, index: number | null): Plan {
    const chk = checkMove(labels, id, parentId);
    if (!chk.ok) return { ok: false, code: chk.code, error: chk.error };
    const me = labels.find((l) => l.id === id);
    if (!me) return { ok: false, code: 'noop', error: 'not found' };
    if ((me.parentId ?? null) !== parentId && sameNameClash(labels, id, parentId)) return { ok: false, code: 'conflict', error: 'A label with that name already exists' };
    const sibs = siblingsOf(labels, parentId).filter((l) => l.id !== id).map((l) => l.id);
    const at = index === null ? sibs.length : Math.max(0, Math.min(sibs.length, index));
    sibs.splice(at, 0, id);
    const items = renumber(sibs, parentId);
    // Si cambia de padre, renumerar tambien las hermanas del padre anterior (sin huecos).
    if ((me.parentId ?? null) !== parentId) {
        const old = siblingsOf(labels, me.parentId ?? null).filter((l) => l.id !== id).map((l) => l.id);
        items.push(...renumber(old, me.parentId ?? null));
    }
    return { ok: true, items };
}

/** Arrastrar `dragId` sobre `targetId`: antes, despues (mismo padre que el destino) o dentro (subetiqueta al final). */
export function planDrop(labels: L[], dragId: string, targetId: string, zone: DropZone): Plan {
    if (dragId === targetId) return { ok: false, code: 'self', error: 'self' };
    const target = labels.find((l) => l.id === targetId);
    if (!target) return { ok: false, code: 'noop', error: 'not found' };
    if (zone === 'inside') return planPlace(labels, dragId, target.id, null);
    const parentId = target.parentId ?? null;
    const sibs = siblingsOf(labels, parentId).filter((l) => l.id !== dragId);
    const ti = sibs.findIndex((l) => l.id === targetId);
    return planPlace(labels, dragId, parentId, zone === 'before' ? ti : ti + 1);
}

/** Alt+Arriba / Alt+Abajo: sube o baja entre hermanas. */
export function planMoveSibling(labels: L[], id: string, dir: -1 | 1): Plan {
    const me = labels.find((l) => l.id === id);
    if (!me) return { ok: false, code: 'noop', error: 'not found' };
    const sibs = siblingsOf(labels, me.parentId ?? null);
    const i = sibs.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sibs.length) return { ok: false, code: 'noop', error: 'edge' };
    return planPlace(labels, id, me.parentId ?? null, j);
}

/** Alt+Derecha: pasa a ser subetiqueta de la hermana anterior. */
export function planIndent(labels: L[], id: string): Plan {
    const me = labels.find((l) => l.id === id);
    if (!me) return { ok: false, code: 'noop', error: 'not found' };
    const sibs = siblingsOf(labels, me.parentId ?? null);
    const i = sibs.findIndex((l) => l.id === id);
    if (i <= 0) return { ok: false, code: 'noop', error: 'no previous sibling' };
    return planPlace(labels, id, sibs[i - 1].id, null);
}

/** Alt+Izquierda: sube un nivel, justo despues de su padre. */
export function planOutdent(labels: L[], id: string): Plan {
    const me = labels.find((l) => l.id === id);
    if (!me || !me.parentId) return { ok: false, code: 'noop', error: 'already at root' };
    const parent = labels.find((l) => l.id === me.parentId);
    if (!parent) return { ok: false, code: 'noop', error: 'not found' };
    const sibs = siblingsOf(labels, parent.parentId ?? null).filter((l) => l.id !== id);
    return planPlace(labels, id, parent.parentId ?? null, sibs.findIndex((l) => l.id === parent.id) + 1);
}

/** Aplica un plan a la lista local (actualizacion optimista). */
export function applyPlan<T extends L>(labels: T[], items: ReorderItem[]): T[] {
    const by = new Map(items.map((i) => [i.id, i]));
    return labels.map((l) => (by.has(l.id) ? { ...l, parentId: by.get(l.id)!.parentId, sortOrder: by.get(l.id)!.sortOrder } : l));
}
