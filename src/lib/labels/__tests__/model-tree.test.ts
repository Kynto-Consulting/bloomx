import { describe, it, expect } from 'vitest';
import {
    MAX_LABEL_DEPTH, buildTree, checkMove, depthOf, descendantsOf, flattenVisible, pathMatchesFilter, pathOf, rollupCounts, splitPath, subtreeHeight, validateSegment,
    type LabelRow,
} from '../model';
import { applyPlan, planDrop, planIndent, planMoveSibling, planOutdent, planPlace } from '../tree-ops';

const L = (id: string, name: string, parentId: string | null = null, sortOrder = 0): LabelRow => ({
    id, name, parentId, sortOrder, color: '#000', userId: 'u', behavior: 'tag', icon: null, showInSidebar: true, showUnread: true, fullPath: name,
});
const sample = () => [L('w', 'Trabajo'), L('a', 'Proyecto A', 'w', 0), L('b', 'Proyecto B', 'w', 1), L('p', 'Personal', null, 1), L('c', 'Sub', 'a')];

describe('modelo de etiquetas jerarquicas', () => {
    it('validateSegment', () => {
        expect(validateSegment('  Mi   etiqueta ')).toEqual({ ok: true, name: 'Mi etiqueta' });
        for (const bad of ['', '   ', 'a/b', 'a,b', 'x'.repeat(51), '..', 'a\u0000b', 5 as any]) expect(validateSegment(bad).ok).toBe(false);
    });

    it('rutas, profundidad, descendientes y altura', () => {
        const ls = sample();
        const by = new Map(ls.map((l) => [l.id, l]));
        expect(pathOf('c', by)).toBe('Trabajo/Proyecto A/Sub');
        expect(depthOf('c', by)).toBe(3);
        expect(descendantsOf('w', ls).sort()).toEqual(['a', 'b', 'c']);
        expect(subtreeHeight('w', ls)).toBe(3);
        expect(splitPath(' A / B //C ')).toEqual(['A', 'B', 'C']);
        expect(pathMatchesFilter('Trabajo/Proyecto A', 'trabajo')).toBe(true);
        expect(pathMatchesFilter('Trabajo/Proyecto A', 'trabajo', false)).toBe(false);
        expect(pathMatchesFilter('Trabajos', 'trabajo')).toBe(false);
    });

    it('checkMove: ciclos, si mismo, profundidad y padre inexistente', () => {
        const ls = sample();
        expect(checkMove(ls, 'w', 'c')).toMatchObject({ ok: false, code: 'cycle' });
        expect(checkMove(ls, 'w', 'w')).toMatchObject({ ok: false, code: 'self' });
        expect(checkMove(ls, 'w', 'nope')).toMatchObject({ ok: false, code: 'parent_missing' });
        expect(checkMove(ls, 'c', null)).toEqual({ ok: true });
        let chain = [L('n0', 'n0')];
        for (let i = 1; i < MAX_LABEL_DEPTH; i++) chain.push(L(`n${i}`, `n${i}`, `n${i - 1}`));
        expect(checkMove([...chain, L('x', 'x')], 'x', `n${MAX_LABEL_DEPTH - 1}`)).toMatchObject({ ok: false, code: 'depth' });
        expect(checkMove([...chain, L('x', 'x')], 'x', `n${MAX_LABEL_DEPTH - 2}`)).toEqual({ ok: true });
    });

    it('buildTree ordena, rompe ciclos y huerfanas; flattenVisible da posicion y nivel', () => {
        const cyc = [L('x', 'X', 'y'), L('y', 'Y', 'x'), L('o', 'Huerfana', 'nope')];
        const t = buildTree(cyc);
        expect(t.map((n) => n.label.id).sort()).toEqual(['o', 'x', 'y']); // nadie desaparece
        const tree = buildTree(sample());
        expect(tree.map((n) => n.label.name)).toEqual(['Trabajo', 'Personal']);
        const flat = flattenVisible(tree, new Set(['w']));
        expect(flat.map((r) => r.node.label.id)).toEqual(['w', 'a', 'b', 'p']);
        expect(flat[1]).toMatchObject({ posInSet: 1, setSize: 2, parentId: 'w', hasChildren: true, expanded: false });
        expect(flattenVisible(tree, new Set(['w', 'a'])).map((r) => r.node.label.id)).toEqual(['w', 'a', 'c', 'b', 'p']);
    });

    it('rollupCounts acumula en los padres', () => {
        const r = rollupCounts(sample(), { c: 2, b: 1, p: 4 });
        expect(r).toMatchObject({ c: 2, a: 2, b: 1, w: 3, p: 4 });
    });
});

describe('planes de reordenar / re-anidar (arrastre y teclado)', () => {
    it('drop antes / despues / dentro', () => {
        const ls = sample();
        const before = planDrop(ls, 'b', 'a', 'before');
        expect(before.ok && before.items.filter((i) => i.parentId === 'w').sort((x, y) => x.sortOrder - y.sortOrder).map((i) => i.id)).toEqual(['b', 'a']);
        const inside = planDrop(ls, 'p', 'w', 'inside');
        expect(inside.ok && inside.items.find((i) => i.id === 'p')).toMatchObject({ parentId: 'w', sortOrder: 2 });
        const after = planDrop(ls, 'p', 'w', 'after');
        expect(after.ok && after.items.find((i) => i.id === 'p')).toMatchObject({ parentId: null });
        expect(planDrop(ls, 'w', 'c', 'inside')).toMatchObject({ ok: false, code: 'cycle' });
        expect(planDrop(ls, 'w', 'w', 'inside')).toMatchObject({ ok: false, code: 'self' });
    });

    it('nombre repetido en el destino se rechaza antes de llamar al servidor', () => {
        const ls = [...sample(), L('d', 'Proyecto A', 'p')];
        expect(planPlace(ls, 'd', 'w', null)).toMatchObject({ ok: false, code: 'conflict' });
    });

    it('alternativas de teclado: subir/bajar, sangrar, des-sangrar', () => {
        const ls = sample();
        const down = planMoveSibling(ls, 'a', 1);
        expect(down.ok && down.items.map((i) => i.id)).toEqual(['b', 'a']);
        expect(planMoveSibling(ls, 'a', -1)).toMatchObject({ ok: false, code: 'noop' });
        const ind = planIndent(ls, 'b'); // b pasa a ser hija de a
        expect(ind.ok && ind.items.find((i) => i.id === 'b')).toMatchObject({ parentId: 'a' });
        expect(planIndent(ls, 'a')).toMatchObject({ ok: false, code: 'noop' });
        const out = planOutdent(ls, 'c'); // c sale de a y queda tras a en Trabajo
        expect(out.ok && out.items.find((i) => i.id === 'c')).toMatchObject({ parentId: 'w', sortOrder: 1 });
        expect(planOutdent(ls, 'w')).toMatchObject({ ok: false, code: 'noop' });
    });

    it('applyPlan actualiza la lista local', () => {
        const ls = sample();
        const p = planDrop(ls, 'p', 'w', 'inside');
        if (!p.ok) throw new Error('plan');
        const next = applyPlan(ls, p.items);
        expect(next.find((l) => l.id === 'p')!.parentId).toBe('w');
    });
});
