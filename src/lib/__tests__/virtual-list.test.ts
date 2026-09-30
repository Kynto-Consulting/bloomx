import { describe, expect, it } from 'vitest';
import {
    VIRTUALIZE_THRESHOLD,
    anchoredScrollTop,
    listItemAria,
    pickAnchor,
    pinRange,
    shouldLoadMore,
    shouldVirtualize,
} from '../virtual-list';

describe('shouldVirtualize', () => {
    it('las listas cortas no se virtualizan (se renderizan completas como siempre)', () => {
        expect(shouldVirtualize(0)).toBe(false);
        expect(shouldVirtualize(20)).toBe(false);
        expect(shouldVirtualize(VIRTUALIZE_THRESHOLD)).toBe(false);
        expect(shouldVirtualize(VIRTUALIZE_THRESHOLD + 1)).toBe(true);
        expect(shouldVirtualize(5, 3)).toBe(true);
    });
});

describe('pinRange', () => {
    it('anade el indice anclado en orden y sin duplicar', () => {
        expect(pinRange([0, 1, 2, 3], 10, 100)).toEqual([0, 1, 2, 3, 10]);
        expect(pinRange([20, 21, 22], 3, 100)).toEqual([3, 20, 21, 22]);
        expect(pinRange([0, 1, 2], 1, 100)).toEqual([0, 1, 2]);
    });
    it('ignora indices invalidos', () => {
        expect(pinRange([0, 1], -1, 100)).toEqual([0, 1]);
        expect(pinRange([0, 1], 100, 100)).toEqual([0, 1]);
        expect(pinRange([], 0, 0)).toEqual([]);
    });
});

describe('listItemAria', () => {
    it('posicion 1-based y tamano conocido', () => {
        expect(listItemAria(0, 50, false)).toEqual({ 'aria-posinset': 1, 'aria-setsize': 50 });
        expect(listItemAria(9, 50, false)).toEqual({ 'aria-posinset': 10, 'aria-setsize': 50 });
    });
    it('con mas paginas el total es desconocido (-1, segun WAI-ARIA)', () => {
        expect(listItemAria(3, 50, true)).toEqual({ 'aria-posinset': 4, 'aria-setsize': -1 });
    });
});

describe('ancla de scroll', () => {
    const items = [
        { index: 4, start: 400, end: 500 },
        { index: 5, start: 500, end: 600 },
        { index: 6, start: 600, end: 700 },
    ];
    const ids = Array.from({ length: 20 }, (_, i) => `id${i}`);

    it('pickAnchor elige la primera fila cuyo final queda bajo scrollTop y el desfase dentro de ella', () => {
        expect(pickAnchor(items, ids, 430)).toEqual({ id: 'id4', delta: 30 });
        expect(pickAnchor(items, ids, 500)).toEqual({ id: 'id5', delta: 0 });
        expect(pickAnchor(items, ids, 5000)).toBeNull();
        expect(pickAnchor([], ids, 0)).toBeNull();
    });

    it('anchoredScrollTop compensa las filas insertadas por encima', () => {
        const newIds = ['n1', 'n2', ...ids]; // id4 pasa al indice 6
        const startOf = (i: number) => i * 100;
        expect(anchoredScrollTop({ ids: newIds, anchor: { id: 'id4', delta: 30 }, scrollTop: 430, startOf })).toBe(630);
    });

    it('no ajusta si esta arriba del todo, si el ancla desaparecio o si ya esta en su sitio', () => {
        const startOf = (i: number) => i * 100;
        expect(anchoredScrollTop({ ids, anchor: { id: 'id4', delta: 0 }, scrollTop: 0, startOf })).toBeNull();
        expect(anchoredScrollTop({ ids, anchor: { id: 'borrado', delta: 0 }, scrollTop: 500, startOf })).toBeNull();
        expect(anchoredScrollTop({ ids, anchor: { id: 'id4', delta: 30 }, scrollTop: 430, startOf })).toBeNull();
        expect(anchoredScrollTop({ ids, anchor: null, scrollTop: 500, startOf })).toBeNull();
        expect(anchoredScrollTop({ ids, anchor: { id: 'id4', delta: 0 }, scrollTop: 500, startOf: () => undefined })).toBeNull();
    });

    it('nunca devuelve un scroll negativo', () => {
        expect(anchoredScrollTop({ ids, anchor: { id: 'id0', delta: -50 }, scrollTop: 10, startOf: () => 0 })).toBe(0);
    });
});

describe('shouldLoadMore', () => {
    it('pide mas cuando la ultima fila renderizada esta cerca del final y hay mas paginas', () => {
        expect(shouldLoadMore(95, 100, true)).toBe(true);
        expect(shouldLoadMore(99, 100, true)).toBe(true);
        expect(shouldLoadMore(50, 100, true)).toBe(false);
        expect(shouldLoadMore(99, 100, false)).toBe(false);
        expect(shouldLoadMore(-1, 0, true)).toBe(false);
    });
});
