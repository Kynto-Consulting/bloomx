/**
 * Acceso a datos de reglas (servidor). Usa SQL crudo para no depender de que el
 * cliente Prisma se haya regenerado ni de que la tabla "Rule" exista todavia:
 * todas las lecturas toleran su ausencia y devuelven [] (feature-guard).
 *
 * Las condiciones se GUARDAN y DEVUELVEN siempre en v2 ({v:2, root}); las filas v1 antiguas
 * se leen y convierten sin migrar la BD.
 */
import { prisma } from '@/lib/prisma';
import { toV2, type ConditionsV2 } from './conditions';
import { normalizeConditions, type Action, type Rule } from './engine';

export const MAX_RULES_PER_USER = 100;

export interface StoredRule extends Rule {
    userId: string;
    name: string;
    conditions: ConditionsV2;
    createdAt: Date;
    updatedAt: Date;
    labelId: string | null;
    matchedCount: number;
    lastMatchedAt: Date | null;
}

const FULL_COLS = `"id","userId","name","enabled","priority","conditions","actions","stopProcessing","createdAt","updatedAt","labelId","matchedCount","lastMatchedAt"`;
const LEGACY_COLS = `"id","userId","name","enabled","priority","conditions","actions","stopProcessing","createdAt","updatedAt"`;

function mapRow(r: any): StoredRule {
    const actions = Array.isArray(r.actions) ? r.actions : [];
    return {
        id: r.id,
        userId: r.userId,
        name: r.name,
        enabled: !!r.enabled,
        priority: Number(r.priority) || 0,
        conditions: toV2(r.conditions),
        actions: actions as Action[],
        stopProcessing: !!r.stopProcessing,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        labelId: r.labelId ?? null,
        matchedCount: Number(r.matchedCount) || 0,
        lastMatchedAt: r.lastMatchedAt ?? null,
    };
}

/** true si el error indica que la tabla/columna aun no existe (BD sin migrar). */
export function isMissingRelation(e: unknown): boolean {
    const msg = String((e as any)?.message || e || '');
    const code = String((e as any)?.code || (e as any)?.meta?.code || '');
    return code === '42P01' || code === '42703' || /relation "?(Rule|RuleRun|RuleBatch|RuleBatchItem)"? does not exist/i.test(msg) || /does not exist/i.test(msg);
}

const isMissingColumn = (e: unknown) => /42703|column .* does not exist/i.test(`${(e as any)?.code ?? ''} ${(e as any)?.meta?.code ?? ''} ${(e as any)?.message ?? ''}`);

export async function loadRules(userId: string, onlyEnabled = false, filter: { labelId?: string | null } = {}): Promise<StoredRule[]> {
    try {
        let rows: any[];
        try {
            rows = await prisma.$queryRawUnsafe(
                `SELECT ${FULL_COLS} FROM "Rule" WHERE "userId" = $1 ORDER BY "priority" ASC, "createdAt" ASC, "id" ASC`, userId);
        } catch (e) {
            if (!isMissingColumn(e)) throw e;
            rows = await prisma.$queryRawUnsafe(
                `SELECT ${LEGACY_COLS} FROM "Rule" WHERE "userId" = $1 ORDER BY "priority" ASC, "createdAt" ASC, "id" ASC`, userId);
        }
        let rules = rows.map(mapRow);
        if (onlyEnabled) rules = rules.filter((r) => r.enabled);
        if (filter.labelId !== undefined) rules = rules.filter((r) => r.labelId === filter.labelId);
        return rules;
    } catch (e) {
        if (!isMissingRelation(e)) console.error('[rules] loadRules failed:', (e as any)?.message);
        return [];
    }
}

export async function getRule(userId: string, id: string): Promise<StoredRule | null> {
    return (await loadRules(userId)).find((r) => r.id === id) ?? null;
}

export interface RuleInput {
    name: string; enabled: boolean; priority: number; conditions: ConditionsV2 | unknown; actions: Action[]; stopProcessing: boolean; labelId?: string | null;
}

export async function insertRule(userId: string, input: RuleInput): Promise<StoredRule> {
    const id = `rul_${crypto.randomUUID().replace(/-/g, '')}`;
    const cond = JSON.stringify(toV2(input.conditions));
    let rows: any[];
    try {
        rows = await prisma.$queryRawUnsafe(
            `INSERT INTO "Rule" ("id","userId","name","enabled","priority","conditions","actions","stopProcessing","labelId")
             VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9) RETURNING ${FULL_COLS}`,
            id, userId, input.name, input.enabled, input.priority, cond, JSON.stringify(input.actions), input.stopProcessing, input.labelId ?? null);
    } catch (e) {
        if (!isMissingColumn(e) || input.labelId) throw e;
        rows = await prisma.$queryRawUnsafe(
            `INSERT INTO "Rule" ("id","userId","name","enabled","priority","conditions","actions","stopProcessing")
             VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8) RETURNING ${LEGACY_COLS}`,
            id, userId, input.name, input.enabled, input.priority, cond, JSON.stringify(input.actions), input.stopProcessing);
    }
    return mapRow(rows[0]);
}

export async function updateRule(userId: string, id: string, input: RuleInput): Promise<StoredRule | null> {
    const cond = JSON.stringify(toV2(input.conditions));
    let rows: any[];
    try {
        rows = await prisma.$queryRawUnsafe(
            `UPDATE "Rule" SET "name" = $3, "enabled" = $4, "priority" = $5, "conditions" = $6::jsonb, "actions" = $7::jsonb,
                "stopProcessing" = $8, "labelId" = CASE WHEN $9::boolean THEN $10 ELSE "labelId" END, "updatedAt" = CURRENT_TIMESTAMP
             WHERE "id" = $1 AND "userId" = $2 RETURNING ${FULL_COLS}`,
            id, userId, input.name, input.enabled, input.priority, cond, JSON.stringify(input.actions), input.stopProcessing,
            input.labelId !== undefined, input.labelId ?? null);
    } catch (e) {
        if (!isMissingColumn(e)) throw e;
        rows = await prisma.$queryRawUnsafe(
            `UPDATE "Rule" SET "name" = $3, "enabled" = $4, "priority" = $5, "conditions" = $6::jsonb, "actions" = $7::jsonb,
                "stopProcessing" = $8, "updatedAt" = CURRENT_TIMESTAMP
             WHERE "id" = $1 AND "userId" = $2 RETURNING ${LEGACY_COLS}`,
            id, userId, input.name, input.enabled, input.priority, cond, JSON.stringify(input.actions), input.stopProcessing);
    }
    return rows[0] ? mapRow(rows[0]) : null;
}

export async function setRulesPriorities(userId: string, order: string[]): Promise<number> {
    let n = 0;
    for (let i = 0; i < order.length; i++) {
        n += Number(await prisma.$executeRawUnsafe(`UPDATE "Rule" SET "priority" = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $2 AND "userId" = $3`, i * 10, order[i], userId));
    }
    return n;
}

export async function deleteRule(userId: string, id: string): Promise<boolean> {
    const n = await prisma.$executeRawUnsafe(`DELETE FROM "Rule" WHERE "id" = $1 AND "userId" = $2`, id, userId);
    return Number(n) > 0;
}

/** Suma estadisticas de uso a una regla (best effort). */
export async function bumpRuleStats(userId: string, counts: Record<string, number>): Promise<void> {
    for (const [ruleId, n] of Object.entries(counts)) {
        if (!n) continue;
        try {
            await prisma.$executeRawUnsafe(
                `UPDATE "Rule" SET "matchedCount" = "matchedCount" + $1, "lastMatchedAt" = CURRENT_TIMESTAMP WHERE "id" = $2 AND "userId" = $3`, n, ruleId, userId);
        } catch (e) {
            if (!isMissingRelation(e)) console.error('[rules] bumpRuleStats failed:', (e as any)?.message);
            return;
        }
    }
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

// ---------- Migracion perezosa de aliasSuffix / filterRegex de Label a reglas ----------

/**
 * Cada etiqueta con alias ("usuario+sufijo@") o filtro regex (campos antiguos) recibe una regla equivalente vinculada
 * (Rule.labelId) y sus campos antiguos se vacian: el comportamiento es el mismo (la etiqueta se anade si el destinatario
 * tiene el alias O el asunto/cuerpo coincide con la regex) pero ahora es editable con el constructor de condiciones.
 * Idempotente y tolerante: mientras no se migre (o si falla), inbound.ts sigue aplicando los campos antiguos.
 * Devuelve cuantas etiquetas se migraron.
 */
export async function migrateLegacyLabelRules(userId: string): Promise<number> {
    let legacy: Array<{ id: string; name: string; aliasSuffix: string | null; filterRegex: string | null }>;
    try {
        legacy = await prisma.$queryRawUnsafe(
            `SELECT "id","name","aliasSuffix","filterRegex" FROM "Label" WHERE "userId" = $1 AND ("aliasSuffix" IS NOT NULL OR "filterRegex" IS NOT NULL)`, userId);
    } catch { return 0; }
    if (legacy.length === 0) return 0;
    let migrated = 0;
    for (const l of legacy) {
        try {
            const children: unknown[] = [];
            if (l.aliasSuffix) children.push({ field: 'toAlias', op: 'equals', value: l.aliasSuffix.toLowerCase() });
            if (l.filterRegex) {
                children.push({ field: 'subject', op: 'regex', value: l.filterRegex });
                children.push({ field: 'body', op: 'regex', value: l.filterRegex });
            }
            const conditions = toV2({ v: 2, root: { type: 'group', op: 'or', children } });
            if (conditions.root.children.length === 0) continue; // regex antigua invalida: se deja como esta
            // Prioridad muy baja (-500): los campos antiguos se aplicaban antes que cualquier regla.
            await prisma.$transaction(async (tx) => {
                const id = `rul_${crypto.randomUUID().replace(/-/g, '')}`;
                await tx.$executeRawUnsafe(
                    `INSERT INTO "Rule" ("id","userId","name","enabled","priority","conditions","actions","stopProcessing","labelId")
                     VALUES ($1,$2,$3,TRUE,-500,$4::jsonb,$5::jsonb,FALSE,$6)`,
                    id, userId, `Etiqueta ${l.name}`.slice(0, 80), JSON.stringify(conditions), JSON.stringify([{ type: 'addLabel', labelId: l.id }]), l.id);
                await tx.$executeRawUnsafe(`UPDATE "Label" SET "aliasSuffix" = NULL, "filterRegex" = NULL WHERE "id" = $1 AND "userId" = $2`, l.id, userId);
            });
            migrated++;
        } catch (e) {
            if (!isMissingRelation(e)) console.error('[rules] legacy label migration failed:', (e as any)?.message);
            return migrated;
        }
    }
    return migrated;
}

export { normalizeConditions };
