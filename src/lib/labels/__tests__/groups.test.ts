import { describe, expect, it } from 'vitest';
import { groupLabelIds, groupOf, splitLabelsByGroup } from '../groups';

const L = (id: string, behavior: 'tag' | 'folder', parentId: string | null = null) => ({ id, behavior, parentId });

describe('groupLabelIds (regla: grupo del nodo raiz visible; los hijos lo heredan)', () => {
    it('separa raices por su behavior y conserva el orden', () => {
        const ls = [L('a', 'tag'), L('b', 'folder'), L('c', 'tag')];
        const { folders, tags } = splitLabelsByGroup(ls);
        expect(folders.map((l) => l.id)).toEqual(['b']);
        expect(tags.map((l) => l.id)).toEqual(['a', 'c']);
    });
    it('una carpeta hija de una etiqueta se queda en el grupo Etiquetas (y viceversa)', () => {
        const ls = [L('t', 'tag'), L('f', 'folder', 't'), L('F', 'folder'), L('x', 'tag', 'F'), L('y', 'tag', 'x')];
        const g = groupLabelIds(ls);
        expect([...g.tag].sort()).toEqual(['f', 't']);
        expect([...g.folder].sort()).toEqual(['F', 'x', 'y']);
        expect(groupOf('f', g)).toBe('tag');
        expect(groupOf('y', g)).toBe('folder');
        expect(groupOf('nope', g)).toBeNull();
    });
    it('cada etiqueta cae en exactamente un grupo', () => {
        const ls = [L('t', 'tag'), L('f', 'folder', 't'), L('F', 'folder'), L('x', 'tag', 'F')];
        const g = groupLabelIds(ls);
        expect(g.tag.size + g.folder.size).toBe(ls.length);
        for (const l of ls) expect(g.tag.has(l.id) && g.folder.has(l.id)).toBe(false);
    });
    it('padre ausente: el hijo es raiz; ciclos no cuelgan', () => {
        const g = groupLabelIds([L('o', 'folder', 'missing'), L('p', 'tag', 'q'), L('q', 'folder', 'p')]);
        expect(g.folder.has('o')).toBe(true);
        expect(g.tag.size + g.folder.size).toBe(3);
    });
    it('behavior desconocido o ausente cuenta como etiqueta', () => {
        expect(groupLabelIds([{ id: 'z' }, { id: 'w', behavior: 'weird' }]).tag.size).toBe(2);
    });
});
