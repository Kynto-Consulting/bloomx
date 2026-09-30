import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertLocalPg, createUser, createEmail, uid } from './helpers/pg';
import { prisma } from '../prisma';
import { createLabel } from '../labels/store';
import { insertRule, loadRules, migrateLegacyLabelRules, getRule } from '../rules/store';
import { applyRulesToEmailIds, countMatchesForRules, createBatch, addBatchProgress, latestEmailIds, previewConditions, scanPage, undoBatch, getBatch } from '../rules/apply';
import { computeInboundEffects } from '../rules/inbound';
import { saveEmailHdrs } from '../rules/headers';

beforeAll(() => assertLocalPg());
afterAll(async () => { await prisma.$disconnect(); });

const cond = (...children: any[]) => ({ v: 2, root: { type: 'group', op: 'and', children } });
const st = (id: string) => prisma.$queryRawUnsafe<any[]>(`SELECT "folder","previousFolder","read","starred" FROM "Email" WHERE "id"=$1`, id).then((r) => r[0]);
const labelsOf = (id: string) => prisma.$queryRawUnsafe<any[]>(`SELECT "B" FROM "_EmailToLabel" WHERE "A"=$1`, id).then((r) => r.map((x) => x.B).sort());

async function seed() {
    const u = await createUser(prisma);
    const fol = await createLabel(u.id, { name: 'Facturas', behavior: 'folder' });
    const match = await createEmail(prisma, u.id, { from: 'Ventas <ventas@empresa.com>', subject: 'Su factura de octubre' });
    await prisma.attachment.create({ data: { emailId: match.id, filename: 'f.pdf', mimeType: 'application/pdf', size: 1000, key: uid('k') } });
    await saveEmailHdrs(match.id, { 'list-id': '<x>' });
    const noAtt = await createEmail(prisma, u.id, { from: 'ventas@empresa.com', subject: 'Su factura' });
    const other = await createEmail(prisma, u.id, { from: 'x@otro.com', subject: 'Su factura' });
    const rule = await insertRule(u.id, {
        name: 'Facturas', enabled: true, priority: 1, labelId: fol.id, stopProcessing: false,
        conditions: cond({ field: 'fromDomain', op: 'equals', value: 'empresa.com' }, { field: 'subject', op: 'contains', value: 'factura' }, { field: 'attachmentType', op: 'equals', value: 'pdf' }),
        actions: [{ type: 'addLabel', labelId: fol.id }],
    });
    return { u, fol, match, noAtt, other, rule };
}

describe('reglas v2 contra Postgres', () => {
    it('regla de etiqueta-carpeta: preview sin efectos, aplicar saca de Entrada, estadisticas, idempotencia y deshacer', async () => {
        const { u, fol, match, noAtt, other, rule } = await seed();
        const ids = await latestEmailIds(u.id, 50);
        const pv = await previewConditions(u.id, rule.conditions, ids);
        expect(pv.matched).toBe(1);
        expect(pv.samples[0].id).toBe(match.id);
        expect((await st(match.id)).folder).toBe('inbox'); // la vista previa no modifica nada
        expect(await labelsOf(match.id)).toEqual([]);

        const rules = await loadRules(u.id, true);
        expect((await countMatchesForRules(u.id, rules, ids)).matched).toBe(1);
        const batch = await createBatch(u.id, rule.id, fol.id);
        const page = await scanPage(u.id, null, 200);
        const r = await applyRulesToEmailIds(u.id, rules, page.ids, { batchId: batch });
        await addBatchProgress(u.id, batch, r.processed, r.changed);
        expect(r).toMatchObject({ processed: 3, changed: 1, matched: 1 });
        expect(await labelsOf(match.id)).toEqual([fol.id]);
        expect(await st(match.id)).toMatchObject({ folder: 'archive', previousFolder: 'inbox' });
        expect((await st(noAtt.id)).folder).toBe('inbox');
        expect((await st(other.id)).folder).toBe('inbox');
        const stats = await getRule(u.id, rule.id);
        expect(stats!.matchedCount).toBe(1);
        expect(stats!.lastMatchedAt).not.toBeNull();

        // idempotente
        const again = await applyRulesToEmailIds(u.id, rules, page.ids);
        expect(again.changed).toBe(0);

        // deshacer restaura, una sola vez, y no pisa cambios posteriores
        expect((await getBatch(u.id, batch))!.changed).toBe(1);
        expect(await undoBatch(u.id, batch)).toEqual({ restored: 1 });
        expect(await labelsOf(match.id)).toEqual([]);
        expect(await st(match.id)).toMatchObject({ folder: 'inbox', previousFolder: null });
        expect(await undoBatch(u.id, batch)).toBeNull();
    });

    it('deshacer no pisa una carpeta cambiada despues por el usuario ni lotes ajenos', async () => {
        const { u, match, rule, fol } = await seed();
        const other = await createUser(prisma);
        const rules = await loadRules(u.id, true);
        const batch = await createBatch(u.id, rule.id, fol.id);
        await applyRulesToEmailIds(u.id, rules, [match.id], { batchId: batch });
        await prisma.$executeRawUnsafe(`UPDATE "Email" SET "folder"='trash' WHERE "id"=$1`, match.id);
        expect(await undoBatch(other.id, batch)).toBeNull(); // IDOR
        await undoBatch(u.id, batch);
        expect((await st(match.id)).folder).toBe('trash');
        expect(await labelsOf(match.id)).toEqual([]);
    });

    it('acciones: quitar etiqueta, marcar leido/destacado, posponer, archivar; no toca enviados', async () => {
        const u = await createUser(prisma);
        const l = await createLabel(u.id, { name: 'Viejo' });
        const e = await createEmail(prisma, u.id, { subject: 'promo' });
        const sent = await createEmail(prisma, u.id, { subject: 'promo', folder: 'sent' });
        await prisma.$executeRawUnsafe(`INSERT INTO "_EmailToLabel" ("A","B") VALUES ($1,$2)`, e.id, l.id);
        const rule = await insertRule(u.id, {
            name: 'promo', enabled: true, priority: 0, stopProcessing: false,
            conditions: cond({ field: 'subject', op: 'contains', value: 'promo' }),
            actions: [{ type: 'removeLabel', labelId: l.id }, { type: 'markRead' }, { type: 'star' }, { type: 'snooze', hours: 3 }],
        });
        await applyRulesToEmailIds(u.id, [rule], [e.id, sent.id]);
        expect(await labelsOf(e.id)).toEqual([]);
        const s = await st(e.id);
        expect(s).toMatchObject({ folder: 'snoozed', read: true, starred: true });
        expect((await st(sent.id)).folder).toBe('sent');
    });

    it('migracion perezosa de aliasSuffix/filterRegex a reglas equivalentes (sin perder comportamiento)', async () => {
        const u = await createUser(prisma);
        const l = await createLabel(u.id, { name: 'Legado', aliasSuffix: 'compras', filterRegex: 'pedido \\d+' });
        expect(await migrateLegacyLabelRules(u.id)).toBe(1);
        expect(await migrateLegacyLabelRules(u.id)).toBe(0); // idempotente
        const row = (await prisma.$queryRawUnsafe<any[]>(`SELECT "aliasSuffix","filterRegex" FROM "Label" WHERE "id"=$1`, l.id))[0];
        expect(row).toEqual({ aliasSuffix: null, filterRegex: null });
        const rules = await loadRules(u.id, true, { labelId: l.id });
        expect(rules).toHaveLength(1);
        const input = (o: object = {}) => ({
            userId: u.id, userEmail: 'yo@mio.test', recipients: [] as string[], from: 'a@b.com', to: 'yo@mio.test', subject: 'hola', text: 'nada', html: '', hasAttachment: false, deliveryFolder: 'inbox', ...o,
        });
        // por alias
        expect((await computeInboundEffects(input({ recipients: ['yo+compras@mio.test'], userEmail: 'yo@mio.test' }))).labelIds).toEqual([l.id]);
        // por regex en asunto y en cuerpo
        expect((await computeInboundEffects(input({ subject: 'Pedido 123 enviado' }))).labelIds).toEqual([l.id]);
        expect((await computeInboundEffects(input({ text: 'su pedido 9' }))).labelIds).toEqual([l.id]);
        expect((await computeInboundEffects(input())).labelIds).toEqual([]);
    });

    it('recepcion: etiqueta-carpeta saca de Entrada, cabeceras y adjuntos en las condiciones, regla explicita de carpeta gana', async () => {
        const { u, fol } = await seed();
        const base = {
            userId: u.id, userEmail: u.email, recipients: [u.email], from: 'Ventas <ventas@empresa.com>', to: u.email, subject: 'Su factura de noviembre',
            text: 'hola', html: '', hasAttachment: true, deliveryFolder: 'inbox', attachments: [{ filename: 'F.PDF', mimeType: 'application/pdf', size: 10 }],
        };
        const ok = await computeInboundEffects(base);
        expect(ok.labelIds).toEqual([fol.id]);
        expect(ok).toMatchObject({ folder: 'archive', previousFolder: 'inbox' });
        const noPdf = await computeInboundEffects({ ...base, attachments: [{ filename: 'a.png', mimeType: 'image/png', size: 1 }] });
        expect(noPdf.labelIds).toEqual([]);
        expect(noPdf.folder).toBe('inbox');
        // cabeceras de la lista blanca, con "no coincide" si faltan
        await insertRule(u.id, { name: 'news', enabled: true, priority: 5, stopProcessing: false,
            conditions: cond({ field: 'header', name: 'list-unsubscribe', op: 'exists' }), actions: [{ type: 'markRead' }, { type: 'markSpam' }] });
        const withH = await computeInboundEffects({ ...base, from: 'n@x.com', subject: 's', headers: { 'List-Unsubscribe': '<mailto:u@x.com>', 'X-Secret': 'no' } });
        expect(withH.read).toBe(true);
        expect(withH.folder).toBe('spam');
        expect(withH.hdrs).toEqual({ 'list-unsubscribe': '<mailto:u@x.com>' });
        const without = await computeInboundEffects({ ...base, from: 'n@x.com', subject: 's', headers: {} });
        expect(without.read).toBe(false);
        // spam detectado por cabeceras: la regla no lo saca de spam
        const spam = await computeInboundEffects({ ...base, deliveryFolder: 'spam' });
        expect(spam.folder).toBe('spam');
    });

    it('reglas ajenas nunca se cargan ni aplican', async () => {
        const a = await seed();
        const b = await createUser(prisma);
        expect(await loadRules(b.id)).toEqual([]);
        const fx = await applyRulesToEmailIds(b.id, a.rule ? [a.rule] : [], [a.match.id]);
        expect(fx.processed).toBe(0);
        expect((await st(a.match.id)).folder).toBe('inbox');
    });
});
