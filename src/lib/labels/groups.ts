/**
 * Agrupacion de la barra lateral: "Carpetas" (behavior folder) y "Etiquetas" (behavior tag).
 *
 * REGLA: un nodo raiz visible (sin padre, o cuyo padre no esta en la lista) se agrupa por SU behavior; todos sus
 * descendientes heredan el grupo de esa raiz, aunque su propio behavior sea el otro. Asi el arbol nunca se rompe
 * (una carpeta hija de una etiqueta se ve dentro de la etiqueta, con su icono de carpeta, y viceversa).
 * Funcion pura: sin BD ni React; protegida frente a ciclos.
 */
import type { LabelBehavior } from './model';

export interface GroupableLabel { id: string; parentId?: string | null; behavior?: LabelBehavior | string | null }

export type LabelGroupKey = 'folder' | 'tag';

export interface LabelGroups { folder: Set<string>; tag: Set<string> }

export function groupLabelIds(labels: GroupableLabel[]): LabelGroups {
    const byId = new Map(labels.map((l) => [l.id, l]));
    const out: LabelGroups = { folder: new Set(), tag: new Set() };
    const rootOf = (l: GroupableLabel): GroupableLabel => {
        const seen = new Set<string>([l.id]);
        let cur = l;
        while (cur.parentId && byId.has(cur.parentId) && !seen.has(cur.parentId)) { cur = byId.get(cur.parentId)!; seen.add(cur.id); }
        return cur;
    };
    for (const l of labels) out[rootOf(l).behavior === 'folder' ? 'folder' : 'tag'].add(l.id);
    return out;
}

export function groupOf(id: string, groups: LabelGroups): LabelGroupKey | null {
    return groups.folder.has(id) ? 'folder' : groups.tag.has(id) ? 'tag' : null;
}

/** Separa la lista conservando el orden original. */
export function splitLabelsByGroup<T extends GroupableLabel>(labels: T[]): { folders: T[]; tags: T[] } {
    const g = groupLabelIds(labels);
    return { folders: labels.filter((l) => g.folder.has(l.id)), tags: labels.filter((l) => g.tag.has(l.id)) };
}
