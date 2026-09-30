import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertLocalPg, createUser, createEmail, uid } from './helpers/pg';
import { prisma } from '../prisma';
import { deleteRule, insertRule, loadRules, markRuleRun, updateRule } from '../rules/store';
import { applyRulesToEmails } from '../rules/apply';
import { toV2 } from '../rules/conditions';

beforeAll(() => assertLocalPg());
afterAll(async () => { await prisma.$disconnect(); });

const cond = { match: 'any' as const, items: [{ field: 'from' as const, op: 'contains' as const, value: 'news' }, { field: 'hasAttachment' as const, value: true }] };

describe('lib/rules/store.ts contra Postgres', () => {
    it('insertRule/loadRules: jsonb round-trip, orden por prioridad y aislamiento por usuario', async () => {
        const a = await createUser(prisma);
        const b = await createUser(prisma);
        const r2 = await insertRule(a.id, { name: 'segunda', enabled: true, priority: 20, conditions: cond, actions: [{ type: 'markRead' }], stopProcessing: false });
        const r1 = await insertRule(a.id, { name: 'primera', enabled: false, priority: 5, conditions: cond, actions: [{ type: 'star' }, { type: 'moveToFolder', folder: 'archive' }], stopProcessing: true });
        await insertRule(b.id, { name: 'ajena', enabled: true, priority: 1, conditions: cond, actions: [], stopProcessing: false });

        expect(r1.id).toMatch(/^rul_/);
        expect(r1.createdAt).toBeInstanceOf(Date);
        const all = await loadRules(a.id);
        expect(all.map((r) => r.name)).toEqual(['primera', 'segunda']);
        expect(all[0].conditions).toEqual(toV2(cond));
        expect(all[0].actions).toEqual([{ type: 'star' }, { type: 'moveToFolder', folder: 'archive' }]);
        expect(all[0]).toMatchObject({ enabled: false, priority: 5, stopProcessing: true, userId: a.id });
        expect((await loadRules(a.id, true)).map((r) => r.id)).toEqual([r2.id]);
        expect(await loadRules(uid('nadie'))).toEqual([]);
    });

    it('updateRule solo actua sobre reglas propias y bumpea updatedAt', async () => {
        const a = await createUser(prisma);
        const b = await createUser(prisma);
        const r = await insertRule(a.id, { name: 'x', enabled: true, priority: 1, conditions: cond, actions: [], stopProcessing: false });
        const input = { name: 'y', enabled: false, priority: 9, conditions: { match: 'all' as const, items: [] }, actions: [{ type: 'archive' as const }], stopProcessing: true };
        expect(await updateRule(b.id, r.id, input)).toBeNull();
        await new Promise((res) => setTimeout(res, 15));
        const up = await updateRule(a.id, r.id, input);
        expect(up).toMatchObject({ name: 'y', enabled: false, priority: 9, stopProcessing: true });
        expect(up!.updatedAt.getTime()).toBeGreaterThan(r.updatedAt.getTime());
        expect(up!.actions).toEqual([{ type: 'archive' }]);
    });

    it('deleteRule: true si borra, false si no existe o es ajena', async () => {
        const a = await createUser(prisma);
        const b = await createUser(prisma);
        const r = await insertRule(a.id, { name: 'x', enabled: true, priority: 1, conditions: cond, actions: [], stopProcessing: false });
        expect(await deleteRule(b.id, r.id)).toBe(false);
        expect(await deleteRule(a.id, r.id)).toBe(true);
        expect(await deleteRule(a.id, r.id)).toBe(false);
    });

    it('markRuleRun es idempotente (ON CONFLICT DO NOTHING) y cae con el correo (FK cascade)', async () => {
        const a = await createUser(prisma);
        const e = await createEmail(prisma, a.id);
        await markRuleRun(e.id, a.id);
        await markRuleRun(e.id, a.id);
        await Promise.all([markRuleRun(e.id, a.id), markRuleRun(e.id, a.id)]);
        const rows: any[] = await prisma.$queryRaw`SELECT * FROM "RuleRun" WHERE "emailId" = ${e.id}`;
        expect(rows).toHaveLength(1);
        expect(rows[0].userId).toBe(a.id);
        expect(rows[0].appliedAt).toBeInstanceOf(Date);
        await prisma.email.delete({ where: { id: e.id } });
        expect(await prisma.$queryRaw`SELECT 1 FROM "RuleRun" WHERE "emailId" = ${e.id}`).toHaveLength(0);
    });

    it('markRuleRun con FK inexistente no propaga (best effort) y no deja fila', async () => {
        const a = await createUser(prisma);
        await expect(markRuleRun(uid('fantasma'), a.id)).resolves.toBeUndefined();
    });

    it('applyRulesToEmails aplica reglas reales (etiqueta + leido + carpeta) y marca RuleRun', async () => {
        const a = await createUser(prisma);
        const label = await prisma.label.create({ data: { name: 'Noticias', userId: a.id } });
        const e = await createEmail(prisma, a.id, { from: 'news@x.test', subject: 'boletin' });
        const rule = await insertRule(a.id, {
            name: 'r', enabled: true, priority: 1, conditions: { match: 'all', items: [{ field: 'from', op: 'contains', value: 'news' }] },
            actions: [{ type: 'addLabel', labelId: label.id }, { type: 'markRead' }, { type: 'archive' }], stopProcessing: false,
        });
        const res = await applyRulesToEmails(a.id, [rule], [{ id: e.id }]);
        expect(res).toEqual({ processed: 1, changed: 1 });
        const after = await prisma.email.findUnique({ where: { id: e.id }, include: { labels: true } });
        expect(after).toMatchObject({ read: true, folder: 'archive' });
        expect(after!.labels.map((l) => l.id)).toEqual([label.id]);
        expect(await prisma.$queryRaw`SELECT 1 FROM "RuleRun" WHERE "emailId" = ${e.id}`).toHaveLength(1);
    });
});
