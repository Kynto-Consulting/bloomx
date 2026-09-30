import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertLocalPg, createUser, createEmail } from './helpers/pg';
import { prisma } from '../prisma';
import { LabelError, createLabel, deleteLabel, ensureLabelPath, listLabels, planDelete, reorderLabels, updateLabel } from '../labels/store';
import { afterLabelsAdded, afterLabelsRemoved, moveEmailsToLabel, releaseFolderEmails } from '../labels/behavior';
import { getBadges, getSqlOptions, resetSqlOptionsCache } from '../mail-store';
import { buildLabelBadgesSql, emptyScope, scopeClauses, SqlParams } from '../mail-list-sql';

beforeAll(() => assertLocalPg());
afterAll(async () => { await prisma.$disconnect(); });

const code = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e instanceof LabelError ? e.code : 'other'; } };
const folderOf = async (id: string) => (await prisma.$queryRawUnsafe<any[]>(`SELECT "folder","previousFolder" FROM "Email" WHERE "id"=$1`, id))[0];
const link = (emailId: string, labelId: string) => prisma.$executeRawUnsafe(`INSERT INTO "_EmailToLabel" ("A","B") VALUES ($1,$2) ON CONFLICT DO NOTHING`, emailId, labelId);

describe('jerarquia de etiquetas', () => {
    it('crea anidadas, fullPath, unicidad por padre y profundidad maxima', async () => {
        const u = await createUser(prisma);
        const w = await createLabel(u.id, { name: 'Trabajo' });
        const a = await createLabel(u.id, { name: 'Proyecto A', parentId: w.id });
        const other = await createLabel(u.id, { name: 'Personal' });
        const a2 = await createLabel(u.id, { name: 'Proyecto A', parentId: other.id }); // mismo segmento, otro padre
        expect(a.fullPath).toBe('Trabajo/Proyecto A');
        expect(a2.fullPath).toBe('Personal/Proyecto A');
        expect(await code(createLabel(u.id, { name: 'proyecto a', parentId: w.id }))).toBe('conflict');
        expect(await code(createLabel(u.id, { name: 'x/y' }))).toBe('invalid');
        expect(await code(createLabel(u.id, { name: 'x', parentId: 'nope' }))).toBe('parent_missing');
        let p = w;
        for (let i = 0; i < 4; i++) p = await createLabel(u.id, { name: `n${i}`, parentId: p.id });
        expect(await code(createLabel(u.id, { name: 'demasiado', parentId: p.id }))).toBe('depth');
    });

    it('mover: ciclos, profundidad, renombrar actualiza el subarbol', async () => {
        const u = await createUser(prisma);
        const a = await createLabel(u.id, { name: 'A' });
        const b = await createLabel(u.id, { name: 'B', parentId: a.id });
        const c = await createLabel(u.id, { name: 'C', parentId: b.id });
        expect(await code(updateLabel(u.id, a.id, { parentId: c.id }))).toBe('cycle');
        expect(await code(updateLabel(u.id, a.id, { parentId: a.id }))).toBe('self');
        await updateLabel(u.id, a.id, { name: 'Alfa' });
        expect((await listLabels(u.id)).find((l) => l.id === c.id)!.fullPath).toBe('Alfa/B/C');
        const r = await updateLabel(u.id, b.id, { parentId: null });
        expect(r.fullPath).toBe('B');
        expect((await listLabels(u.id)).find((l) => l.id === c.id)!.fullPath).toBe('B/C');
        const stored = await prisma.$queryRawUnsafe<any[]>(`SELECT "fullPath" FROM "Label" WHERE "id"=$1`, c.id);
        expect(stored[0].fullPath).toBe('B/C');
        // reorder todo o nada
        expect(await code(reorderLabels(u.id, [{ id: c.id, sortOrder: 5 }, { id: b.id, parentId: c.id }]))).toBe('cycle');
        expect((await listLabels(u.id)).find((l) => l.id === c.id)!.sortOrder).toBe(0);
    });

    it('borrar con hijos: reubicar o borrar el subarbol; correos intactos', async () => {
        const u = await createUser(prisma);
        const a = await createLabel(u.id, { name: 'A' });
        const b = await createLabel(u.id, { name: 'B', parentId: a.id });
        await createLabel(u.id, { name: 'B', parentId: null });
        const e = await createEmail(prisma, u.id);
        await link(e.id, a.id);
        const r = await deleteLabel(u.id, a.id, { children: 'reparent' });
        expect(r.reparented).toEqual([b.id]);
        const after = (await listLabels(u.id)).find((l) => l.id === b.id)!;
        expect(after.parentId).toBeNull();
        expect(after.name).toBe('B (2)'); // conflicto resuelto sin perder la etiqueta
        expect(await prisma.email.findUnique({ where: { id: e.id } })).not.toBeNull();
        const x = await createLabel(u.id, { name: 'X' });
        await createLabel(u.id, { name: 'Y', parentId: x.id });
        expect((await planDelete(u.id, x.id, { children: 'delete' }))!.deleteIds).toHaveLength(2);
        expect((await deleteLabel(u.id, x.id, { children: 'delete' })).deleted).toHaveLength(2);
    });

    it('ensureLabelPath crea la jerarquia, es idempotente y aplana lo que supere 5 niveles', async () => {
        const u = await createUser(prisma);
        const one = await ensureLabelPath(u.id, 'Trabajo/Proyecto A', { behavior: 'folder' });
        const two = await ensureLabelPath(u.id, 'trabajo/proyecto a', { behavior: 'folder' });
        expect(two.id).toBe(one.id);
        const deep = await ensureLabelPath(u.id, 'a/b/c/d/e/f/g');
        expect((await listLabels(u.id)).find((l) => l.id === deep.id)!.fullPath).toBe('a/b/c/d/e - f - g');
    });

    it('aislamiento: parentId ajeno y etiquetas ajenas', async () => {
        const u1 = await createUser(prisma);
        const u2 = await createUser(prisma);
        const mine = await createLabel(u1.id, { name: 'Mia' });
        const theirs = await createLabel(u2.id, { name: 'Suya' });
        expect(await code(createLabel(u1.id, { name: 'hija', parentId: theirs.id }))).toBe('parent_missing');
        expect(await code(updateLabel(u1.id, theirs.id, { name: 'hack' }))).toBe('not_found');
        expect(await code(updateLabel(u1.id, mine.id, { parentId: theirs.id }))).toBe('parent_missing');
        expect(await code(deleteLabel(u1.id, theirs.id))).toBe('not_found');
        expect((await listLabels(u2.id)).map((l) => l.name)).toEqual(['Suya']);
    });
});

describe('comportamiento tag / folder', () => {
    it('asignar y quitar etiqueta-carpeta saca y devuelve a Entrada; tag no mueve', async () => {
        const u = await createUser(prisma);
        const tag = await createLabel(u.id, { name: 'Etiq' });
        const fol = await createLabel(u.id, { name: 'Facturas', behavior: 'folder' });
        const e = await createEmail(prisma, u.id);
        await link(e.id, tag.id);
        expect(await afterLabelsAdded([u.id], [e.id], [tag.id])).toBe(0);
        expect((await folderOf(e.id)).folder).toBe('inbox');
        await link(e.id, fol.id);
        expect(await afterLabelsAdded([u.id], [e.id], [fol.id])).toBe(1);
        expect(await folderOf(e.id)).toEqual({ folder: 'archive', previousFolder: 'inbox' });
        expect(await afterLabelsAdded([u.id], [e.id], [fol.id])).toBe(0); // idempotente
        await prisma.$executeRawUnsafe(`DELETE FROM "_EmailToLabel" WHERE "A"=$1 AND "B"=$2`, e.id, fol.id);
        expect(await afterLabelsRemoved([u.id], [e.id], [fol.id])).toBe(1);
        expect(await folderOf(e.id)).toEqual({ folder: 'inbox', previousFolder: null });
    });

    it('mover a etiqueta-carpeta deja las otras carpetas; IDOR de correo y etiqueta', async () => {
        const u = await createUser(prisma);
        const other = await createUser(prisma);
        const f1 = await createLabel(u.id, { name: 'F1', behavior: 'folder' });
        const f2 = await createLabel(u.id, { name: 'F2', behavior: 'folder' });
        const e = await createEmail(prisma, u.id);
        const foreign = await createEmail(prisma, other.id);
        const r1 = await moveEmailsToLabel([u.id], [e.id, foreign.id], f1.id);
        expect(r1!.moved).toEqual([e.id]);
        await moveEmailsToLabel([u.id], [e.id], f2.id);
        const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT "B" FROM "_EmailToLabel" WHERE "A"=$1`, e.id);
        expect(rows.map((r) => r.B)).toEqual([f2.id]);
        expect((await folderOf(e.id)).folder).toBe('archive');
        expect((await folderOf(foreign.id)).folder).toBe('inbox');
        expect(await moveEmailsToLabel([other.id], [foreign.id], f1.id)).toBeNull(); // etiqueta ajena
        expect(await releaseFolderEmails(u.id, [f2.id])).toBe(1);
        expect(await folderOf(e.id)).toEqual({ folder: 'inbox', previousFolder: null });
    });
});

describe('contadores y filtros con jerarquia (espejo SQL)', () => {
    it('padre acumula hijos sin duplicar, filtro con y sin subetiquetas, Archivo excluye carpetas', async () => {
        resetSqlOptionsCache();
        const u = await createUser(prisma);
        const w = await createLabel(u.id, { name: 'Trabajo' });
        const a = await createLabel(u.id, { name: 'Proyecto A', parentId: w.id });
        const fol = await createLabel(u.id, { name: 'Fact', behavior: 'folder' });
        const e1 = await createEmail(prisma, u.id, { subject: 'uno' });
        const e2 = await createEmail(prisma, u.id, { subject: 'dos' });
        const e3 = await createEmail(prisma, u.id, { subject: 'tres' });
        await link(e1.id, w.id); await link(e1.id, a.id); // padre + hija: cuenta una vez
        await link(e2.id, a.id);
        await link(e3.id, fol.id);
        await afterLabelsAdded([u.id], [e3.id], [fol.id]);
        const opt = await getSqlOptions();
        expect(opt.labelTree).toBe(true);
        const b = await getBadges([u.id], true);
        expect(b.labelsById[w.id].messages).toBe(2);
        expect(b.labelsById[w.id].unreadMessages).toBe(2);
        expect(b.labelsById[a.id].messages).toBe(2);
        expect(b.labels['trabajo'].messages).toBe(2);
        expect(b.labelsById[fol.id].messages).toBe(1);
        expect(b.folders['archive']?.messages ?? 0).toBe(0); // e3 vive en su etiqueta-carpeta
        expect(b.folders['inbox'].messages).toBe(2);
        // filtro por ruta
        const run = async (labels: string[], exact: boolean, folder: string | null = null) => {
            const p = new SqlParams();
            const sc = { ...emptyScope([u.id], folder), labels, labelExact: exact };
            const where = scopeClauses(sc, p, opt).join(' AND ');
            return (await prisma.$queryRawUnsafe<any[]>(`SELECT e."id" FROM "Email" e WHERE ${where}`, ...p.values)).map((r) => r.id).sort();
        };
        expect(await run(['trabajo'], false)).toEqual([e1.id, e2.id].sort());
        expect(await run(['trabajo'], true)).toEqual([e1.id]);
        expect(await run(['trabajo/proyecto a'], false)).toEqual([e1.id, e2.id].sort());
        expect(await run(['proyecto a'], false)).toEqual([]); // el segmento suelto no es una ruta
        expect(await run([], false, 'archive')).toEqual([]);
        expect(buildLabelBadgesSql([u.id], true, { ...opt, labelTree: false }).sql).not.toContain('lp."id"');
    });
});

describe('esquema de Prisma sin DEFAULT en updatedAt (produccion)', () => {
    it('crear etiqueta funciona aunque "updatedAt" no tenga valor por defecto', async () => {
        await prisma.$executeRawUnsafe(`ALTER TABLE "Label" ALTER COLUMN "updatedAt" DROP DEFAULT`);
        try {
            const u = await createUser(prisma);
            const l = await createLabel(u.id, { name: 'Sin default' });
            expect(l.fullPath).toBe('Sin default');
        } finally {
            await prisma.$executeRawUnsafe(`ALTER TABLE "Label" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP`);
        }
    });
});
