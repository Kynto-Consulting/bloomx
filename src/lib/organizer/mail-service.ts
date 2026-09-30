/**
 * Servicio de correo para el sandbox de extensiones (`services.mail.*`), lado frontend.
 *
 * Solo lo invoca /api/internal/mail con el secreto de servicio. Garantias:
 *  - PROPIEDAD: toda consulta lleva `userId` (el que fijo el backend). Un id de correo ajeno es indistinguible de uno
 *    inexistente (`not_found`): no hay oraculo de existencia entre buzones.
 *  - MINIMO PRIVILEGIO: solo lectura de metadatos (from/subject/snippet), solo la carpeta inbox, y una unica escritura:
 *    conectar/desconectar una etiqueta de la lista cerrada CATEGORY_LABELS. No mueve, borra, marca ni envia.
 *  - REGLAS DEL USUARIO PRIMERO: si una regla ya etiqueta/mueve el correo, el organizer se abstiene.
 *  - SIN BUCLES / IDEMPOTENTE: un correo con etiquetas, o que ya tiene una decision del organizer (aplicada, propuesta o
 *    deshecha), no se vuelve a tocar. Aplicar etiquetas no dispara EMAIL_RECEIVED.
 *  - UNDO: cada decision se registra en EmailEvent (type organizer.applied / organizer.proposed / organizer.undone).
 */
import { rulesOwnEmail } from '@/lib/rules/organizer-guard';
import type { Rule, RuleEmail } from '@/lib/rules/engine';
import {
    CATEGORY_LABELS, MIN_CONFIDENCE_FLOOR,
    type ItemCategory, type OrganizerCategory,
} from './schemas';

export const EVENT_APPLIED = 'organizer.applied';
export const EVENT_PROPOSED = 'organizer.proposed';
export const EVENT_UNDONE = 'organizer.undone';
const ORGANIZER_EVENTS = [EVENT_APPLIED, EVENT_PROPOSED, EVENT_UNDONE];

/** Subconjunto de Prisma que se usa (permite un doble en pruebas). */
export interface MailDb {
    email: { findMany: (args: any) => Promise<any[]>; count: (args: any) => Promise<number>; update: (args: any) => Promise<any> };
    label: { findMany: (args: any) => Promise<any[]>; create: (args: any) => Promise<any> };
    emailEvent: { findMany: (args: any) => Promise<any[]>; findFirst: (args: any) => Promise<any>; create: (args: any) => Promise<any> };
}

export interface MailDeps {
    db: MailDb;
    loadRules: (userId: string) => Promise<Rule[]>;
    newRunId: () => string;
}

export async function defaultDeps(): Promise<MailDeps> {
    const [{ prisma }, store] = await Promise.all([import('@/lib/prisma'), import('@/lib/rules/store')]);
    return {
        db: prisma as unknown as MailDb,
        loadRules: (userId) => store.loadRules(userId, true),
        newRunId: () => `run_${globalThis.crypto.randomUUID().replace(/-/g, '')}`,
    };
}

const clip = (value: unknown, max: number) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);

export interface EmailSummary {
    id: string;
    from: string;
    subject: string;
    snippet: string;
    folder: string;
    hasLabels: boolean;
    createdAt: string;
}

function summarize(row: any): EmailSummary {
    return {
        id: String(row.id),
        from: clip(row.from, 200),
        subject: clip(row.subject, 200),
        snippet: clip(row.snippet, 300),
        folder: String(row.folder || ''),
        hasLabels: Array.isArray(row.labels) && row.labels.length > 0,
        createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt || ''),
    };
}

const SUMMARY_SELECT = {
    id: true, from: true, subject: true, snippet: true, folder: true, createdAt: true,
    labels: { select: { id: true } },
};

/** Candidatos del organizer: bandeja de entrada reciente, sin etiquetas y sin decision previa del organizer. */
function candidateWhere(userId: string, maxAgeDays: number) {
    return {
        userId,
        folder: 'inbox',
        createdAt: { gte: new Date(Date.now() - maxAgeDays * 24 * 3600 * 1000) },
        labels: { none: {} },
        events: { none: { type: { in: ORGANIZER_EVENTS } } },
    };
}

export async function listRecent(deps: MailDeps, userId: string, args: { limit: number; maxAgeDays: number }) {
    const where = candidateWhere(userId, args.maxAgeDays);
    const [rows, candidates] = await Promise.all([
        deps.db.email.findMany({ where, select: SUMMARY_SELECT, orderBy: { createdAt: 'desc' }, take: args.limit }),
        deps.db.email.count({ where }),
    ]);
    return { emails: rows.map(summarize), candidates, limit: args.limit };
}

export async function getEmail(deps: MailDeps, userId: string, args: { emailId: string }) {
    const rows = await deps.db.email.findMany({ where: { userId, id: args.emailId }, select: SUMMARY_SELECT, take: 1 });
    if (rows.length === 0) return { email: null };
    return { email: summarize(rows[0]) };
}

export type SkipReason =
    | 'not_found' | 'not_inbox' | 'already_labeled' | 'already_organized'
    | 'user_rules' | 'no_label_for_category' | 'low_confidence';

export interface BatchResult {
    runId: string;
    applied: number;
    proposed: number;
    /** Examinados sin etiqueta ni propuesta (sin categoria, confianza minima, reglas del usuario): quedan registrados. */
    examined: number;
    skipped: number;
    reasons: Record<string, number>;
    decisions: Array<{ emailId: string; outcome: 'applied' | 'proposed' | 'examined' | 'skipped'; category?: OrganizerCategory; label?: string; reason?: SkipReason }>;
}

async function resolveLabel(deps: MailDeps, userId: string, category: OrganizerCategory, cache: Map<string, { id: string; name: string }>) {
    const def = CATEGORY_LABELS[category];
    if (!def) return null;
    const cached = cache.get(category);
    if (cached) return cached;

    const findExisting = async () => {
        const mine = await deps.db.label.findMany({ where: { userId }, select: { id: true, name: true } });
        return mine.find((l: any) => String(l.name).trim().toLowerCase() === def.name.toLowerCase()) || null;
    };

    let label = await findExisting();
    if (!label) {
        try {
            label = await deps.db.label.create({ data: { userId, name: def.name, color: def.color }, select: { id: true, name: true } });
        } catch {
            // Carrera con otra creacion (unique userId+name): se relee.
            label = await findExisting();
        }
    }
    if (!label) return null;
    const resolved = { id: String(label.id), name: String(label.name) };
    cache.set(category, resolved);
    return resolved;
}

export async function applyBatch(
    deps: MailDeps,
    userId: string,
    args: {
        source: 'manual' | 'hook';
        minConfidence: number;
        runId?: string;
        items: Array<{ emailId: string; category: ItemCategory; confidence: number; method: 'ai' | 'heuristic' }>;
    },
): Promise<BatchResult> {
    const runId = args.runId || deps.newRunId();
    const result: BatchResult = { runId, applied: 0, proposed: 0, examined: 0, skipped: 0, reasons: {}, decisions: [] };
    const skip = (emailId: string, reason: SkipReason) => {
        result.skipped++;
        result.reasons[reason] = (result.reasons[reason] || 0) + 1;
        result.decisions.push({ emailId, outcome: 'skipped', reason });
    };

    // Un correo, una decision (la primera gana).
    const seen = new Set<string>();
    const items = args.items.filter((item) => (seen.has(item.emailId) ? false : (seen.add(item.emailId), true)));

    // Propiedad: SOLO se consideran los correos del usuario. Lo demas es `not_found`.
    const owned = await deps.db.email.findMany({
        where: { userId, id: { in: items.map((i) => i.emailId) } },
        select: { ...SUMMARY_SELECT, to: true, _count: { select: { attachments: true } } },
    });
    const byId = new Map<string, any>(owned.map((row: any) => [String(row.id), row]));

    const previous = byId.size === 0 ? [] : await deps.db.emailEvent.findMany({
        where: { emailId: { in: Array.from(byId.keys()) }, type: { in: ORGANIZER_EVENTS } },
        select: { emailId: true },
    });
    const alreadyOrganized = new Set<string>(previous.map((e: any) => String(e.emailId)));

    const rules = byId.size === 0 ? [] : await deps.loadRules(userId);
    const labelCache = new Map<string, { id: string; name: string }>();

    for (const item of items) {
        const row = byId.get(item.emailId);
        // Transitorios / no le pertenece: no se deja registro (un id ajeno es igual que uno inexistente).
        if (!row) { skip(item.emailId, 'not_found'); continue; }
        if (row.folder !== 'inbox') { skip(item.emailId, 'not_inbox'); continue; }
        if (Array.isArray(row.labels) && row.labels.length > 0) { skip(item.emailId, 'already_labeled'); continue; }
        if (alreadyOrganized.has(item.emailId)) { skip(item.emailId, 'already_organized'); continue; }

        const base = { runId, category: item.category, confidence: Math.round(item.confidence * 1000) / 1000, method: item.method, source: args.source };
        // Examinado pero no aplicado: se registra (type organizer.proposed + reason) para que no reaparezca en cada corrida.
        const examine = async (reason: SkipReason | null) => {
            await deps.db.emailEvent.create({ data: { emailId: item.emailId, type: EVENT_PROPOSED, data: reason ? { ...base, reason } : base } });
            alreadyOrganized.add(item.emailId);
        };

        if (item.category === 'none') {
            await examine(null);
            result.examined++;
            result.decisions.push({ emailId: item.emailId, outcome: 'examined' });
            continue;
        }
        if (item.confidence < MIN_CONFIDENCE_FLOOR) {
            await examine('low_confidence');
            result.examined++;
            result.decisions.push({ emailId: item.emailId, outcome: 'examined', reason: 'low_confidence' });
            continue;
        }

        const ruleCtx: RuleEmail = {
            from: String(row.from || ''), to: String(row.to || ''), subject: String(row.subject || ''), body: String(row.snippet || ''),
            hasAttachment: Number(row._count?.attachments || 0) > 0,
            labelIds: [], labelNames: [],
        };
        if (rulesOwnEmail(rules, ruleCtx)) {
            await examine('user_rules');
            result.examined++;
            result.reasons.user_rules = (result.reasons.user_rules || 0) + 1;
            result.decisions.push({ emailId: item.emailId, outcome: 'examined', reason: 'user_rules' });
            continue;
        }

        // spam nunca etiqueta (no hay etiqueta para la categoria): solo se propone.
        if (!CATEGORY_LABELS[item.category as OrganizerCategory] || item.confidence < args.minConfidence) {
            await examine(null);
            result.proposed++;
            result.decisions.push({ emailId: item.emailId, outcome: 'proposed', category: item.category as OrganizerCategory });
            continue;
        }

        const label = await resolveLabel(deps, userId, item.category as OrganizerCategory, labelCache);
        if (!label) { skip(item.emailId, 'no_label_for_category'); continue; }

        // `row` salio de una consulta con userId: el update opera sobre un correo verificado como propio.
        await deps.db.email.update({ where: { id: item.emailId }, data: { labels: { connect: [{ id: label.id }] } } });
        await deps.db.emailEvent.create({
            data: { emailId: item.emailId, type: EVENT_APPLIED, data: { ...base, labelIds: [label.id], labelNames: [label.name] } },
        });
        alreadyOrganized.add(item.emailId);
        result.applied++;
        result.decisions.push({ emailId: item.emailId, outcome: 'applied', category: item.category, label: label.name });
    }

    return result;
}

/** Deshace una corrida (o la ultima si no se indica). Solo quita las etiquetas que ese run agrego. Idempotente. */
export async function undoRun(deps: MailDeps, userId: string, args: { runId?: string }) {
    let runId = args.runId;
    if (!runId) {
        const last = await deps.db.emailEvent.findFirst({
            where: { type: EVENT_APPLIED, email: { userId } },
            orderBy: { createdAt: 'desc' },
            select: { data: true },
        });
        runId = typeof last?.data?.runId === 'string' ? last.data.runId : undefined;
    }
    if (!runId) return { runId: null, undone: 0 };

    const applied = await deps.db.emailEvent.findMany({
        where: { type: EVENT_APPLIED, email: { userId }, data: { path: ['runId'], equals: runId } },
        select: { id: true, emailId: true, data: true },
        take: 500,
    });
    const undoneRows = await deps.db.emailEvent.findMany({
        where: { type: EVENT_UNDONE, email: { userId }, data: { path: ['runId'], equals: runId } },
        select: { data: true },
        take: 1000,
    });
    const alreadyUndone = new Set<string>(undoneRows.map((e: any) => String(e.data?.decisionId)));

    const pending = applied.filter((e: any) => e.emailId && !alreadyUndone.has(String(e.id)));
    const wanted = new Set<string>();
    for (const e of pending) for (const id of (Array.isArray(e.data?.labelIds) ? e.data.labelIds : [])) if (typeof id === 'string') wanted.add(id);
    const mine = wanted.size === 0 ? [] : await deps.db.label.findMany({ where: { userId, id: { in: Array.from(wanted) } }, select: { id: true } });
    const mineIds = new Set<string>(mine.map((l: any) => String(l.id)));

    let undone = 0;
    for (const e of pending) {
        const labelIds = (Array.isArray(e.data?.labelIds) ? e.data.labelIds : []).filter((id: unknown) => typeof id === 'string' && mineIds.has(id));
        if (labelIds.length > 0) {
            await deps.db.email.update({ where: { id: String(e.emailId) }, data: { labels: { disconnect: labelIds.map((id: string) => ({ id })) } } });
        }
        await deps.db.emailEvent.create({ data: { emailId: String(e.emailId), type: EVENT_UNDONE, data: { runId, decisionId: String(e.id) } } });
        undone++;
    }
    return { runId, undone };
}
