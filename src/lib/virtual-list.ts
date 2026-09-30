// Logica pura de la virtualizacion de la lista de correo (sin React ni DOM) para probarla con vitest.

/** Por debajo de este numero de hilos la lista se renderiza completa, igual que siempre. */
export const VIRTUALIZE_THRESHOLD = 40;

export function shouldVirtualize(count: number, threshold = VIRTUALIZE_THRESHOLD): boolean {
    return count > threshold;
}

/**
 * Anade `pinned` (p. ej. la fila con foco de teclado) a los indices visibles para que
 * siga montada (y conserve el foco del DOM) aunque salga de la ventana. Devuelve
 * indices unicos, ascendentes y dentro de [0, count).
 */
export function pinRange(indexes: number[], pinned: number, count: number): number[] {
    if (pinned < 0 || pinned >= count || indexes.includes(pinned)) return indexes;
    const out = [...indexes, pinned].sort((a, b) => a - b);
    return out.filter((v, i) => v >= 0 && v < count && out.indexOf(v) === i);
}

/**
 * Atributos ARIA de posicion de un elemento de lista virtualizada. Con paginacion pendiente
 * el total real se desconoce: la especificacion pide aria-setsize = -1 en ese caso.
 */
export function listItemAria(index: number, count: number, hasMore: boolean): { 'aria-posinset': number; 'aria-setsize': number } {
    return { 'aria-posinset': index + 1, 'aria-setsize': hasMore ? -1 : count };
}

export interface ScrollAnchor {
    /** Id de la primera fila visible cuando se hizo la captura. */
    id: string;
    /** Cuanto estaba desplazado el scroll respecto al inicio de esa fila (px). */
    delta: number;
}

/** Fila ancla: la primera cuyo final queda por debajo de scrollTop. */
export function pickAnchor(
    items: Array<{ index: number; start: number; end: number }>,
    ids: string[],
    scrollTop: number,
): ScrollAnchor | null {
    const first = items.find((it) => it.end > scrollTop && ids[it.index] !== undefined);
    if (!first) return null;
    return { id: ids[first.index], delta: scrollTop - first.start };
}

/**
 * Scroll destino para que el ancla siga en el mismo lugar tras cambiar la lista
 * (correos nuevos arriba, filas quitadas). null = no hace falta ajustar.
 * Si el usuario esta arriba del todo no se ajusta: que vea lo nuevo.
 */
export function anchoredScrollTop(opts: {
    ids: string[];
    anchor: ScrollAnchor | null;
    scrollTop: number;
    startOf: (index: number) => number | undefined;
    epsilon?: number;
}): number | null {
    const { ids, anchor, scrollTop, startOf, epsilon = 1 } = opts;
    if (!anchor || scrollTop <= 2) return null;
    const index = ids.indexOf(anchor.id);
    if (index < 0) return null;
    const start = startOf(index);
    if (start === undefined) return null;
    const target = Math.max(0, start + anchor.delta);
    return Math.abs(target - scrollTop) > epsilon ? target : null;
}

/** Debe pedirse la siguiente pagina? (ultima fila renderizada cerca del final.) */
export function shouldLoadMore(lastRenderedIndex: number, count: number, hasMore: boolean, lookahead = 5): boolean {
    return hasMore && count > 0 && lastRenderedIndex >= count - lookahead;
}
