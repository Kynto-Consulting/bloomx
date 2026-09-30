import { describe, it, expect } from 'vitest';
import { acceptProposal, applyBatch, dismissProposal, listProposals, undoRun, type MailDb, type MailDeps } from '../mail-service';
import { CATEGORY_LABELS } from '../schemas';
import { labelDisplayName, organizerLabelKey, ORGANIZER_LABEL_KEYS } from '../labels';
import { dictionaries, flattenMessages, createTranslator } from '@/lib/i18n';

type EmailRow = { id: string; userId: string; from: string; subject: string; folder: string; labels: string[] };

function makeDb(emailsSeed: EmailRow[], labelsSeed: Array<{ id: string; userId: string; name: string }> = []) {
    const emails = new Map(emailsSeed.map((e) => [e.id, { ...e, labels: [...e.labels] }]));
    const labels = labelsSeed.map((l) => ({ color: '#000', ...l }));
    const events: Array<{ id: string; emailId: string | null; type: string; data: any; createdAt: Date }> = [];
    let seq = 0;
    const inList = (v: any, c: any) => (c === undefined ? true : typeof c === 'string' ? v === c : Array.isArray(c.in) ? c.in.includes(v) : true);
    const shape = (e: EmailRow) => ({ ...e, snippet: '', createdAt: new Date(), labels: e.labels.map((id) => ({ id })) });
    const db: MailDb = {
        email: {
            findMany: async ({ where }) => [...emails.values()].filter((e) => (where.userId === undefined || e.userId === where.userId) && inList(e.id, where.id)).map(shape),
            count: async () => 0,
            update: async ({ where, data }) => {
                const e = emails.get(where.id)!;
                for (const c of data.labels?.connect || []) if (!e.labels.includes(c.id)) e.labels.push(c.id);
                for (const c of data.labels?.disconnect || []) e.labels = e.labels.filter((id) => id !== c.id);
                return shape(e);
            },
        },
        label: {
            findMany: async ({ where }) => labels.filter((l) => l.userId === where.userId && inList(l.id, where.id)),
            create: async ({ data }) => { const row = { id: `lbl${labels.length + 1}`, ...data }; labels.push(row); return row; },
        },
        emailEvent: {
            findMany: async ({ where }) => events.filter((ev) => {
                if (!inList(ev.emailId, where.emailId) || !inList(ev.type, where.type)) return false;
                if (where.email?.userId !== undefined && (ev.emailId ? emails.get(ev.emailId)?.userId : undefined) !== where.email.userId) return false;
                return true;
            }),
            findFirst: async () => null,
            create: async ({ data }) => { const row = { id: `ev${++seq}`, createdAt: new Date(Date.now() + seq), ...data }; events.push(row); return row; },
        },
    };
    return { db, emails, labels, events };
}

const mail = (id: string, userId: string, o: Partial<EmailRow> = {}): EmailRow => ({ id, userId, from: 'a@x.com', subject: `S ${id}`, folder: 'inbox', labels: [], ...o });
const deps = (db: MailDb): MailDeps => { let n = 0; return { db, loadRules: async () => [], newRunId: () => `run_test${String(++n).padStart(8, '0')}` }; };
const item = (emailId: string, category: any, confidence: number) => ({ emailId, category, confidence, method: 'ai' as const });

async function seedProposals() {
    const w = makeDb([mail('a1', 'A'), mail('a2', 'A'), mail('a3', 'A'), mail('a4', 'A'), mail('b1', 'B')]);
    const d = deps(w.db);
    await applyBatch(d, 'A', { source: 'manual', minConfidence: 0.9, items: [
        item('a1', 'finance', 0.75),     // propuesta (por debajo del minimo del usuario)
        item('a2', 'spam', 0.8),          // propuesta sin etiqueta
        item('a3', 'work', 0.3),          // por debajo del piso: examinado (no es propuesta)
        item('a4', 'none', 0.9),          // sin categoria: examinado
    ] });
    await applyBatch(d, 'B', { source: 'manual', minConfidence: 0.9, items: [item('b1', 'work', 0.8)] });
    return { w, d };
}

describe('Organizer: propuestas de baja confianza', () => {
    it('lista solo propuestas reales del usuario (no examinados ni ajenas)', async () => {
        const { d } = await seedProposals();
        const { proposals } = await listProposals(d, 'A');
        expect(proposals.map((p) => [p.emailId, p.category, p.labelName, p.confidence]).sort()).toEqual([
            ['a1', 'finance', 'Finance', 0.75],
            ['a2', 'spam', null, 0.8],
        ]);
        expect((await listProposals(d, 'B')).proposals.map((p) => p.emailId)).toEqual(['b1']);
    });

    it('aceptar aplica la etiqueta (propia), registra applied deshacible y la propuesta deja de listarse', async () => {
        const { w, d } = await seedProposals();
        const res = await acceptProposal(d, 'A', { emailId: 'a1' });
        expect(res).toMatchObject({ ok: true, label: 'Finance' });
        const lbl = w.labels.find((l) => l.userId === 'A' && l.name === 'Finance')!;
        expect(w.emails.get('a1')!.labels).toEqual([lbl.id]);
        const applied = w.events.filter((e) => e.type === 'organizer.applied');
        expect(applied).toHaveLength(1);
        expect(applied[0].data).toMatchObject({ accepted: true, category: 'finance', labelIds: [lbl.id] });
        expect((await listProposals(d, 'A')).proposals.map((p) => p.emailId)).toEqual(['a2']);
        // Idempotente / no se puede aceptar dos veces
        expect(await acceptProposal(d, 'A', { emailId: 'a1' })).toEqual({ ok: false, reason: 'not_found' });
        // Y se puede deshacer con el runId
        const runId = (res as any).runId;
        expect(await undoRun(d, 'A', { runId })).toMatchObject({ undone: 1 });
        expect(w.emails.get('a1')!.labels).toEqual([]);
        // Tras deshacer no reaparece como propuesta
        expect((await listProposals(d, 'A')).proposals.map((p) => p.emailId)).toEqual(['a2']);
    });

    it('aceptar spam no etiqueta (no hay etiqueta para la categoria)', async () => {
        const { w, d } = await seedProposals();
        expect(await acceptProposal(d, 'A', { emailId: 'a2' })).toEqual({ ok: false, reason: 'no_label_for_category' });
        expect(w.emails.get('a2')!.labels).toEqual([]);
    });

    it('rechazar registra dismissed, no etiqueta y no vuelve a listarse ni a analizarse', async () => {
        const { w, d } = await seedProposals();
        expect(await dismissProposal(d, 'A', { emailId: 'a1' })).toEqual({ ok: true });
        expect(w.emails.get('a1')!.labels).toEqual([]);
        expect(w.events.filter((e) => e.type === 'organizer.dismissed')).toHaveLength(1);
        expect((await listProposals(d, 'A')).proposals.map((p) => p.emailId)).toEqual(['a2']);
        expect(await dismissProposal(d, 'A', { emailId: 'a1' })).toEqual({ ok: false, reason: 'not_found' });
        const again = await applyBatch(d, 'A', { source: 'manual', minConfidence: 0.7, items: [item('a1', 'finance', 0.99)] });
        expect(again.reasons).toEqual({ already_organized: 1 });
    });

    it('IDOR: no se puede aceptar ni rechazar la propuesta de otro usuario', async () => {
        const { w, d } = await seedProposals();
        expect(await acceptProposal(d, 'A', { emailId: 'b1' })).toEqual({ ok: false, reason: 'not_found' });
        expect(await dismissProposal(d, 'A', { emailId: 'b1' })).toEqual({ ok: false, reason: 'not_found' });
        expect(w.emails.get('b1')!.labels).toEqual([]);
        expect(w.events.filter((e) => e.type === 'organizer.dismissed' || e.type === 'organizer.applied')).toHaveLength(0);
    });

    it('no ofrece la propuesta si el correo ya salio de inbox o ya tiene etiquetas', async () => {
        const { w, d } = await seedProposals();
        w.emails.get('a1')!.folder = 'trash';
        w.emails.get('a2')!.labels.push('x');
        expect((await listProposals(d, 'A')).proposals).toEqual([]);
        expect(await acceptProposal(d, 'A', { emailId: 'a1' })).toEqual({ ok: false, reason: 'not_found' });
    });
});

describe('Organizer: etiquetas localizadas es/en', () => {
    const es = createTranslator('es', dictionaries).t;
    const en = createTranslator('en', dictionaries).t;

    it('cada etiqueta del Organizer tiene traduccion en es y en; la clave interna no cambia', () => {
        const flat = { es: flattenMessages(dictionaries.es!), en: flattenMessages(dictionaries.en!) };
        for (const [cat, def] of Object.entries(CATEGORY_LABELS)) {
            if (!def) continue;
            expect(organizerLabelKey(def.name)).toBe(`organizer.labels.${cat}`);
            expect(flat.es[`organizer.labels.${cat}`]).toBeTruthy();
            expect(flat.en[`organizer.labels.${cat}`]).toBe(def.name); // en == nombre interno
        }
        expect(Object.keys(ORGANIZER_LABEL_KEYS)).toHaveLength(Object.values(CATEGORY_LABELS).filter(Boolean).length);
    });

    it('traduce solo al mostrar; nombres propios del usuario quedan intactos', () => {
        expect(labelDisplayName('Work', es)).toBe('Trabajo');
        expect(labelDisplayName('Newsletters', es)).toBe('Boletines');
        expect(labelDisplayName('Finance', en)).toBe('Finance');
        expect(labelDisplayName('Clientes', es)).toBe('Clientes');
        expect(labelDisplayName('Work', (k) => k)).toBe('organizer.labels.work');
    });

    it('las claves de la UI de propuestas existen en es y en', () => {
        const es2 = flattenMessages(dictionaries.es!);
        const en2 = flattenMessages(dictionaries.en!);
        for (const k of ['title', 'description', 'accept', 'acceptAria', 'dismiss', 'confidence', 'noSubject', 'failed']) {
            expect(es2[`organizer.proposals.${k}`]).toBeTruthy();
            expect(en2[`organizer.proposals.${k}`]).toBeTruthy();
        }
    });
});
