/**
 * Acceso a datos de reglas (servidor). Usa SQL crudo para no depender de que el
 * cliente Prisma se haya regenerado ni de que la tabla "Rule" exista todavia:
 * todas las lecturas toleran su ausencia y devuelven [] (feature-guard).
 */
import { prisma } from '@/lib/prisma';
import {
    evaluateRules, normalizeConditions, type Action, type Rule, type RuleConditions, type RuleEffects, type RuleEmail,
} from './engine';

export const MAX_RULES_PER_USER = 100;

export interface StoredRule extends Rule {
    userId: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
}

function mapRow(r: any): StoredRule {
    const actions = Array.isArray(r.actions) ? r.actions : [];
    return {
        id: r.id,
        userId: r.userId,
        name: r.name,
        enabled: !!r.enabled,
        priority: Number(r.priority) || 0,
        conditions: normalizeConditions(r.conditions),
        actions: actions as Action[],
        stopProcessing: !!r.stopProcessing,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
    };
}

/** true si el error indica que la tabla/columna aun no existe (BD sin migrar). */
export function isMissingRelation(e: unknown): boolean {
    const msg = String((e as any)?.message || e || '');
    const code = String((e as any)?.code || (e as any)?.meta?.code || '');
    return code === '42P01' || /relation "?(Rule|RuleRun)"? does not exist/i.test(msg) || /does not exist/i.test(msg);
}

export async function loadRules(userId: string, onlyEnabled = false): Promise<StoredRule[]> {
    try {
        const rows: any[] = await prisma.$queryRaw`
            SELECT "id","userId","name","enabled","priority","conditions","actions","stopProcessing","createdAt","updatedAt"
            FROM "Rule" WHERE "userId" = ${userId}
            ORDER BY "priority" ASC, "createdAt" ASC, "id" ASC`;
        const rules = rows.map(mapRow);
        return onlyEnabled ? rules.filter((r) => r.enabled) : rules;
    } catch (e) {
        if (!isMissingRelation(e)) console.error('[rules] loadRules failed:', (e as any)?.message);
        return [];
    }
}

export async function insertRule(userId: string, input: {
    name: string; enabled: boolean; priority: number; conditions: RuleConditions; actions: Action[]; stopProcessing: boolean;
}): Promise<StoredRule> {
    const id = `rul_${crypto.randomUUID().replace(/-/g, '')}`;
    const rows: any[] = await prisma.$queryRaw`
        INSERT INTO "Rule" ("id","userId","name","enabled","priority","conditions","actions","stopProcessing")
        VALUES (${id}, ${userId}, ${input.name}, ${input.enabled}, ${input.priority},
                ${JSON.stringify(input.conditions)}::jsonb, ${JSON.stringify(input.actions)}::jsonb, ${input.stopProcessing})
        RETURNING "id","userId","name","enabled","priority","conditions","actions","stopProcessing","createdAt","updatedAt"`;
    return mapRow(rows[0]);
}

export async function updateRule(userId: string, id: string, input: {
    name: string; enabled: boolean; priority: number; conditions: RuleConditions; actions: Action[]; stopProcessing: boolean;
}): Promise<StoredRule | null> {
    const rows: any[] = await prisma.$queryRaw`
        UPDATE "Rule" SET "name" = ${input.name}, "enabled" = ${input.enabled}, "priority" = ${input.priority},
            "conditions" = ${JSON.stringify(input.conditions)}::jsonb, "actions" = ${JSON.stringify(input.actions)}::jsonb,
            "stopProcessing" = ${input.stopProcessing}, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${id} AND "userId" = ${userId}
        RETURNING "id","userId","name","enabled","priority","conditions","actions","stopProcessing","createdAt","updatedAt"`;
    return rows[0] ? mapRow(rows[0]) : null;
}

export async function deleteRule(userId: string, id: string): Promise<boolean> {
    const n = await prisma.$executeRaw`DELETE FROM "Rule" WHERE "id" = ${id} AND "userId" = ${userId}`;
    return n > 0;
}

/** Marca correos como ya procesados por el motor (idempotencia). Best effort. */
export async function markRuleRun(emailId: string, userId: string): Promise<void> {
    try {
        await prisma.$executeRaw`
            INSERT INTO "RuleRun" ("emailId","userId") VALUES (${emailId}, ${userId}) ON CONFLICT ("emailId") DO NOTHING`;
    } catch (e) {
        if (!isMissingRelation(e)) console.error('[rules] markRuleRun failed:', (e as any)?.message);
    }
}

export function plainTextFromHtml(html: string): string {
    return String(html || '')
        .slice(0, 200_000)
        .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Aplica reglas a correos ya existentes del usuario. Idempotente: connect de etiquetas,
 * y read/starred/folder se fijan de forma absoluta. Devuelve cuantos correos cambiaron.
 */
export async function applyRulesToEmails(
    userId: string,
    rules: Rule[],
    emails: Array<{
        id: string; from: string; to: string; subject: string | null; snippet: string | null; folder: string;
        read: boolean; starred: boolean;
        labels: Array<{ id: string; name: string }>; _attachments: number;
    }>,
): Promise<{ processed: number; changed: number }> {
    if (rules.length === 0) return { processed: 0, changed: 0 };

    const validLabels = new Set(
        (await prisma.label.findMany({ where: { userId }, select: { id: true } })).map((l) => l.id),
    );
    let changed = 0;

    for (const e of emails) {
        const ctx: RuleEmail = {
            from: e.from, to: e.to, subject: e.subject || '', body: e.snippet || '',
            hasAttachment: e._attachments > 0,
            labelIds: e.labels.map((l) => l.id), labelNames: e.labels.map((l) => l.name),
        };
        const fx: RuleEffects = evaluateRules(ctx, rules);
        const data: any = {};
        const newLabels = fx.addLabelIds.filter((id) => validLabels.has(id) && !ctx.labelIds.includes(id));
        if (newLabels.length) data.labels = { connect: newLabels.map((id) => ({ id })) };
        if (fx.markRead && !e.read) data.read = true;
        if (fx.star && !e.starred) data.starred = true;
        // Nunca sacar correos de spam/enviados/programados/pospuestos por regla retroactiva.
        if (fx.folder && fx.folder !== e.folder && ['inbox', 'archive'].includes(e.folder)) data.folder = fx.folder;

        if (Object.keys(data).length) {
            await prisma.email.update({ where: { id: e.id }, data });
            changed++;
        }
        await markRuleRun(e.id, userId);
    }
    return { processed: emails.length, changed };
}
