import { describe, it, expect } from 'vitest';
import { applyBatch, getEmail, listRecent, undoRun, type MailDb, type MailDeps } from '../mail-service';
import { internalMailRequest } from '../schemas';
import type { Rule } from '@/lib/rules/engine';

// ---------------------------------------------------------------------------------------------------------------
// Doble en memoria del subconjunto de Prisma que usa el servicio. HONRA los filtros por userId: si el servicio
// olvidara acotar una consulta por propietario, las pruebas de IDOR lo delatarian.
// ---------------------------------------------------------------------------------------------------------------
type EmailRow = { id: string; userId: string; from: string; to: string; subject: string; snippet: string; folder: string; createdAt: Date; labels: string[]; attachments: number };

function makeDb(seed: { emails: EmailRow[]; labels?: Array<{ id: string; userId: string; name: string; color?: string }> }) {
    const emails = new Map(seed.emails.map((e) => [e.id, { ...e, labels: [...e.labels] }]));
    const labels = [...(seed.labels || [])].map((l) => ({ color: '#000000', ...l }));
    const events: Array<{ id: string; emailId: string | null; type: string; data: any; createdAt: Date }> = [];
    let seq = 0;
    const updates: Array<{ id: string; data: any }> = [];

    const inList = (value: any, cond: any) => (cond === undefined ? true : typeof cond === 'string' ? value === cond : Array.isArray(cond.in) ? cond.in.includes(value) : true);

    const matchEmail = (e: EmailRow, where: any) => {
        if (where.userId !== undefined && e.userId !== where.userId) return false;
        if (!inList(e.id, where.id)) return false;
        if (where.folder !== undefined && e.folder !== where.folder) return false;
        if (where.createdAt?.gte && e.createdAt < where.createdAt.gte) return false;
        if (where.labels?.none && e.labels.length > 0) return false;
        if (where.events?.none) {
            const types: string[] = where.events.none.type.in;
            if (events.some((ev) => ev.emailId === e.id && types.includes(ev.type))) return false;
        }
        return true;
    };
    const shape = (e: EmailRow) => ({ ...e, labels: e.labels.map((id) => ({ id })), _count: { attachments: e.attachments } });
    const matchEvent = (ev: (typeof events)[number], where: any) => {
        if (!inList(ev.emailId, where.emailId)) return false;
        if (!inList(ev.type, where.type)) return false;
        if (where.email?.userId !== undefined) {
            const owner = ev.emailId ? emails.get(ev.emailId)?.userId : undefined;
            if (owner !== where.email.userId) return false;
        }
        if (where.data?.path) {
            if (ev.data?.[where.data.path[0]] !== where.data.equals) return false;
        }
        return true;
    };

    const db: MailDb = {
        email: {
            findMany: async ({ where, take, orderBy }) => {
                let rows = [...emails.values()].filter((e) => matchEmail(e, where));
                if (orderBy?.createdAt === 'desc') rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
                if (take) rows = rows.slice(0, take);
                return rows.map(shape);
            },
            count: async ({ where }) => [...emails.values()].filter((e) => matchEmail(e, where)).length,
            update: async ({ where, data }) => {
                updates.push({ id: where.id, data });
                const e = emails.get(where.id);
                if (!e) throw new Error('not found');
                for (const c of data.labels?.connect || []) if (!e.labels.includes(c.id)) e.labels.push(c.id);
                for (const d of data.labels?.disconnect || []) e.labels = e.labels.filter((id) => id !== d.id);
                return shape(e);
            },
        },
        label: {
            findMany: async ({ where }) => labels.filter((l) => l.userId === where.userId && inList(l.id, where.id)),
            create: async ({ data }) => {
                if (labels.some((l) => l.userId === data.userId && l.name === data.name)) throw new Error('Unique constraint');
                const row = { id: `lbl${labels.length + 1}`, color: data.color, ...data };
                labels.push(row);
                return row;
            },
        },
        emailEvent: {
            findMany: async ({ where, take }) => events.filter((ev) => matchEvent(ev, where)).slice(0, take || 10_000),
            findFirst: async ({ where }) => [...events].reverse().find((ev) => matchEvent(ev, where)) ?? null,
            create: async ({ data }) => {
                const row = { id: `ev${++seq}`, createdAt: new Date(), ...data };
                events.push(row);
                return row;
            },
        },
    };
    return { db, emails, labels, events, updates };
}

const NOW = new Date();
const mail = (id: string, userId: string, o: Partial<EmailRow> = {}): EmailRow => ({
    id, userId, from: 'Shop <newsletter@shop.com>', to: `${userId}@x.com`, subject: 'Weekly', snippet: 'unsubscribe',
    folder: 'inbox', createdAt: NOW, labels: [], attachments: 0, ...o,
});

function deps(db: MailDb, rules: Rule[] = []): MailDeps {
    let n = 0;
    return { db, loadRules: async () => rules, newRunId: () => `run_test${String(++n).padStart(8, '0')}` };
}
const item = (emailId: string, category: any = 'newsletter', confidence = 0.9) => ({ emailId, category, confidence, method: 'heuristic' as const });
const apply = (d: MailDeps, userId: string, items: any[], extra: any = {}) => applyBatch(d, userId, { source: 'manual', minConfidence: 0.7, items, ...extra });

describe('servicios de correo del sandbox: propiedad (IDOR)', () => {
    const world = () => makeDb({
        emails: [mail('a1', 'userA'), mail('a2', 'userA'), mail('b1', 'userB'), mail('b2', 'userB')],
        labels: [{ id: 'lblB', userId: 'userB', name: 'Newsletters' }],
    });

    it('applyBatch: un id de correo ajeno es not_found y NO se toca (ni etiquetas, ni update, ni eventos)', async () => {
        const w = world();
        const res = await apply(deps(w.db), 'userA', [item('b1'), item('b2')]);
        expect(res.applied).toBe(0);
        expect(res.reasons).toEqual({ not_found: 2 });
        expect(w.emails.get('b1')!.labels).toEqual([]);
        expect(w.emails.get('b2')!.labels).toEqual([]);
        expect(w.updates).toHaveLength(0);
        expect(w.events).toHaveLength(0);
        // y tampoco se crea/usa una etiqueta por el hecho de intentarlo
        expect(w.labels.filter((l) => l.userId === 'userA')).toHaveLength(0);
    });

    it('mezcla propio + ajeno: solo el propio se etiqueta, con la etiqueta del PROPIO usuario', async () => {
        const w = world();
        const res = await apply(deps(w.db), 'userA', [item('a1'), item('b1')]);
        expect(res.applied).toBe(1);
        expect(res.reasons).toEqual({ not_found: 1 });
        const labelA = w.labels.find((l) => l.userId === 'userA' && l.name === 'Newsletters')!;
        expect(labelA).toBeTruthy();
        expect(w.emails.get('a1')!.labels).toEqual([labelA.id]);
        expect(w.emails.get('b1')!.labels).toEqual([]);
        expect(labelA.id).not.toBe('lblB'); // no reutiliza la etiqueta de otro usuario
    });

    it('getEmail y listRecent solo ven el buzon del usuario', async () => {
        const w = world();
        const d = deps(w.db);
        expect((await getEmail(d, 'userA', { emailId: 'b1' })).email).toBeNull();
        expect((await getEmail(d, 'userA', { emailId: 'a1' })).email?.id).toBe('a1');
        const list = await listRecent(d, 'userA', { limit: 50, maxAgeDays: 30 });
        expect(list.emails.map((e) => e.id).sort()).toEqual(['a1', 'a2']);
        expect(list.candidates).toBe(2);
    });

    it('undoRun no puede deshacer decisiones de otro usuario (aunque conozca su runId)', async () => {
        const w = world();
        const runB = await apply(deps(w.db), 'userB', [item('b1')], { runId: 'run_bbbbbbbb' });
        expect(runB.applied).toBe(1);
        const labelsAfterB = [...w.emails.get('b1')!.labels];

        const undoA = await undoRun(deps(w.db), 'userA', { runId: 'run_bbbbbbbb' });
        expect(undoA.undone).toBe(0);
        expect(w.emails.get('b1')!.labels).toEqual(labelsAfterB);

        // "ultima corrida" de A no ve la de B
        expect(await undoRun(deps(w.db), 'userA', {})).toEqual({ runId: null, undone: 0 });
        expect((await undoRun(deps(w.db), 'userB', {})).undone).toBe(1);
        expect(w.emails.get('b1')!.labels).toEqual([]);
    });
});

describe('organizer: reglas primero, idempotencia, confianza y undo', () => {
    it('las reglas del usuario ganan: si una regla etiqueta o mueve el correo, el organizer se abstiene', async () => {
        const w = makeDb({ emails: [mail('a1', 'userA'), mail('a2', 'userA', { from: 'boss@acme.com', subject: 'Plan' })] });
        const rule: Rule = {
            id: 'r1', enabled: true, priority: 0, stopProcessing: false,
            conditions: { match: 'all', items: [{ field: 'from', op: 'contains', value: 'shop.com' }] },
            actions: [{ type: 'addLabel', labelId: 'someLabel' }],
        };
        const res = await apply(deps(w.db, [rule]), 'userA', [item('a1'), item('a2', 'work')]);
        expect(res.reasons.user_rules).toBe(1);
        expect(w.emails.get('a1')!.labels).toEqual([]);
        expect(w.emails.get('a2')!.labels).toHaveLength(1); // a2 no coincide con la regla
        // a1 queda registrado como examinado: no reaparece
        expect((await listRecent(deps(w.db), 'userA', { limit: 10, maxAgeDays: 30 })).emails.map((e) => e.id)).toEqual([]);

        // Una regla que solo marca leido/destaca no bloquea al organizer
        const w2 = makeDb({ emails: [mail('a1', 'userA')] });
        const soft: Rule = { ...rule, actions: [{ type: 'markRead' }] };
        expect((await apply(deps(w2.db, [soft]), 'userA', [item('a1')])).applied).toBe(1);
        // Una regla que mueve de carpeta si bloquea
        const w3 = makeDb({ emails: [mail('a1', 'userA')] });
        const mover: Rule = { ...rule, actions: [{ type: 'archive' }] };
        expect((await apply(deps(w3.db, [mover]), 'userA', [item('a1')])).applied).toBe(0);
    });

    it('sin bucles: un correo con etiquetas o ya examinado no se vuelve a tocar', async () => {
        const w = makeDb({ emails: [mail('a1', 'userA'), mail('a2', 'userA', { labels: ['own'] })], labels: [{ id: 'own', userId: 'userA', name: 'Mine' }] });
        const d = deps(w.db);
        const first = await apply(d, 'userA', [item('a1'), item('a2')]);
        expect([first.applied, first.reasons.already_labeled]).toEqual([1, 1]);
        const second = await apply(d, 'userA', [item('a1', 'finance')]);
        expect(second.applied).toBe(0);
        expect(second.reasons).toEqual({ already_labeled: 1 });
        expect(w.emails.get('a2')!.labels).toEqual(['own']);
        expect(w.events.filter((e) => e.type === 'organizer.applied')).toHaveLength(1);
    });

    it('solo actua sobre la bandeja de entrada', async () => {
        const w = makeDb({ emails: [mail('s1', 'userA', { folder: 'spam' }), mail('t1', 'userA', { folder: 'trash' })] });
        const res = await apply(deps(w.db), 'userA', [item('s1'), item('t1')]);
        expect(res.reasons).toEqual({ not_inbox: 2 });
        expect(w.updates).toHaveLength(0);
    });

    it('confianza: >= minConfidence aplica; entre 0.5 y min propone (registrado); < 0.5 y spam nunca etiquetan', async () => {
        const w = makeDb({ emails: ['a', 'b', 'c', 'd', 'e'].map((id) => mail(id, 'userA')) });
        const res = await apply(deps(w.db), 'userA', [
            item('a', 'finance', 0.95),  // aplica
            item('b', 'finance', 0.6),   // propone
            item('c', 'finance', 0.3),   // examinado (bajo el piso)
            item('d', 'spam', 0.99),     // propone (sin etiqueta para spam)
            item('e', 'none', 0.5),      // examinado
        ], { minConfidence: 0.7 });
        expect([res.applied, res.proposed, res.examined]).toEqual([1, 2, 2]);
        expect(w.emails.get('a')!.labels).toHaveLength(1);
        for (const id of ['b', 'c', 'd', 'e']) expect(w.emails.get(id)!.labels).toEqual([]);
        expect(w.labels.map((l) => l.name)).toEqual(['Finance']); // ni 'Spam' ni etiquetas arbitrarias
        // Todos quedan registrados => ninguno reaparece como candidato
        expect((await listRecent(deps(w.db), 'userA', { limit: 10, maxAgeDays: 30 })).candidates).toBe(0);
    });

    it('reutiliza una etiqueta existente del usuario (sin distinguir mayusculas) y no crea duplicados', async () => {
        const w = makeDb({ emails: [mail('a1', 'userA'), mail('a2', 'userA')], labels: [{ id: 'mine', userId: 'userA', name: 'newsletters' }] });
        await apply(deps(w.db), 'userA', [item('a1'), item('a2')]);
        expect(w.labels).toHaveLength(1);
        expect(w.emails.get('a1')!.labels).toEqual(['mine']);
        expect(w.emails.get('a2')!.labels).toEqual(['mine']);
    });

    it('dedupe: el mismo correo repetido en el lote se procesa una vez', async () => {
        const w = makeDb({ emails: [mail('a1', 'userA')] });
        const res = await apply(deps(w.db), 'userA', [item('a1', 'finance'), item('a1', 'work')]);
        expect(res.applied).toBe(1);
        expect(w.labels.map((l) => l.name)).toEqual(['Finance']);
    });

    it('undo: quita solo lo que agrego el run, deja constancia y es idempotente', async () => {
        const w = makeDb({ emails: [mail('a1', 'userA'), mail('a2', 'userA')] });
        const d = deps(w.db);
        const run = await apply(d, 'userA', [item('a1'), item('a2', 'work')]);
        // el usuario agrego luego otra etiqueta a mano a a1: no se debe perder
        w.emails.get('a1')!.labels.push('manual');
        w.labels.push({ id: 'manual', userId: 'userA', name: 'Manual', color: '#111111' });

        const undone = await undoRun(d, 'userA', {});
        expect(undone).toEqual({ runId: run.runId, undone: 2 });
        expect(w.emails.get('a1')!.labels).toEqual(['manual']);
        expect(w.emails.get('a2')!.labels).toEqual([]);
        expect(w.events.filter((e) => e.type === 'organizer.undone')).toHaveLength(2);

        expect((await undoRun(d, 'userA', { runId: run.runId })).undone).toBe(0); // idempotente

        // Lo deshecho no se reaplica (el usuario lo rechazo)
        const again = await apply(d, 'userA', [item('a2', 'work')]);
        expect(again.applied).toBe(0);
        expect(again.reasons).toEqual({ already_organized: 1 });
    });
});

describe('contrato zod del puente interno', () => {
    it('acepta operaciones validas y rechaza claves desconocidas (userId/args estrictos)', () => {
        expect(internalMailRequest.safeParse({ op: 'listRecent', userId: 'ck1', args: { limit: 10 } }).success).toBe(true);
        expect(internalMailRequest.safeParse({ op: 'undoRun', userId: 'ck1' }).success).toBe(true);
        const bad = [
            { op: 'deleteEmail', userId: 'ck1', args: {} },
            { op: 'listRecent', userId: 'ck1', args: { limit: 1000 } },
            { op: 'listRecent', userId: 'ck1', args: { limit: 10, userId: 'other' } },
            { op: 'getEmail', userId: 'ck1', args: { emailId: '../x' } },
            { op: 'listRecent', userId: 'ck 1', args: {} },
            { op: 'applyBatch', userId: 'ck1', args: { items: [] } },
            { op: 'applyBatch', userId: 'ck1', args: { items: [{ emailId: 'a', category: 'custom-label', confidence: 0.9, method: 'ai' }] } },
            { op: 'applyBatch', userId: 'ck1', args: { minConfidence: 0.1, items: [{ emailId: 'a', category: 'work', confidence: 0.9, method: 'ai' }] } },
            { op: 'applyBatch', userId: 'ck1', args: { items: [{ emailId: 'a', category: 'work', confidence: 0.9, method: 'ai', labelName: 'X' }] } },
        ];
        for (const b of bad) expect(internalMailRequest.safeParse(b).success, JSON.stringify(b)).toBe(false);
    });
});
