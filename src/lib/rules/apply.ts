/**
 * Aplicacion retroactiva de reglas (servidor): vista previa sin efectos, aplicar por lotes/paginas con registro para
 * DESHACER y las reglas "de recuperacion" del cron. Idempotente: aplicar dos veces deja el mismo estado.
 *
 * Nunca se reenvia correo ni se borra definitivamente (forwardTo solo actua al RECIBIR; "delete" = papelera).
 */
import { prisma } from '@/lib/prisma';
import { evaluateConditions, countLeaves, type Tri } from './conditions';
import { evaluateRules, type Rule, type RuleEffects } from './engine';
import { loadRuleContexts, needsFromRules, type LoadOptions, type StoredEmailContext } from './context';
import { bumpRuleStats, isMissingRelation, markRuleRun } from './store';

export const SCAN_FOLDERS = ['inbox', 'archive'] as const;
export const MAX_PAGE = 200;
export const PREVIEW_LIMITS = [50, 200] as const;

export interface ScanCursor { t: string; id: string }

export const encodeCursor = (c: ScanCursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
export function decodeCursor(raw: unknown): ScanCursor | null {
    if (typeof raw !== 'string' || !raw || raw.length > 300) return null;
    try {
        const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
        if (typeof v?.t === 'string' && typeof v?.id === 'string' && !Number.isNaN(new Date(v.t).getTime())) return { t: v.t, id: v.id };
    } catch { /* cursor invalido */ }
    return null;
}

/** Pagina de ids de correo (mas nuevos primero) por keyset (createdAt, id). Solo bandeja y archivo. */
export async function scanPage(userId: string, cursor: ScanCursor | null, pageSize: number): Promise<{ ids: string[]; next: ScanCursor | null }> {
    const size = Math.max(1, Math.min(MAX_PAGE, Math.trunc(pageSize) || MAX_PAGE));
    const rows: Array<{ id: string; t: string }> = cursor
        ? await prisma.$queryRawUnsafe(
            `SELECT "id", to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS t FROM "Email"
             WHERE "userId" = $1 AND "folder" = ANY($2::text[]) AND ("createdAt", "id") < ($3::timestamptz, $4::text)
             ORDER BY "createdAt" DESC, "id" DESC LIMIT ${size + 1}`, userId, [...SCAN_FOLDERS], cursor.t, cursor.id)
        : await prisma.$queryRawUnsafe(
            `SELECT "id", to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS t FROM "Email"
             WHERE "userId" = $1 AND "folder" = ANY($2::text[])
             ORDER BY "createdAt" DESC, "id" DESC LIMIT ${size + 1}`, userId, [...SCAN_FOLDERS]);
    const page = rows.slice(0, size);
    const more = rows.length > size;
    const last = page[page.length - 1];
    return { ids: page.map((r) => r.id), next: more && last ? { t: last.t, id: last.id } : null };
}

export interface PreviewSample { id: string; from: string; subject: string; date: string | null; folder: string; state: 'match' | 'unknown' }
export interface PreviewResult {
    evaluated: number;
    matched: number;
    /** Correos donde la regla no se pudo decidir por falta de datos (p. ej. cabeceras de correos antiguos). */
    unknown: number;
    samples: PreviewSample[];
    /** Campos de la regla que dependen de datos que algunos correos no tienen. */
    missingData: boolean;
}

const HDR_FIELDS = new Set(['header', 'auth', 'spamScore']);

/** Evalua unas condiciones contra correos reales (sin ningun efecto). */
export async function previewConditions(userId: string, conditions: unknown, emailIds: string[], sampleLimit = 50): Promise<PreviewResult> {
    const needs = needsFromRules([{ conditions }]);
    const ctxs = await loadRuleContexts(userId, emailIds, { needBody: needs.body, needHtml: needs.html });
    const samples: PreviewSample[] = [];
    let matched = 0;
    let unknown = 0;
    for (const id of emailIds) {
        const ctx = ctxs.get(id);
        if (!ctx) continue;
        const r: Tri = evaluateConditions(conditions, ctx);
        if (r === true) matched++;
        else if (r === null) unknown++;
        if ((r === true || r === null) && samples.length < sampleLimit) {
            samples.push({
                id, from: ctx.from, subject: ctx.subject, date: ctx.date ? new Date(ctx.date as any).toISOString() : null, folder: ctx.folder ?? '',
                state: r === true ? 'match' : 'unknown',
            });
        }
    }
    return { evaluated: ctxs.size, matched, unknown, samples: samples.filter((s) => s.state === 'match').concat(samples.filter((s) => s.state === 'unknown')).slice(0, sampleLimit), missingData: unknown > 0 };
}

/** Ultimos N correos del usuario (bandeja y archivo) para "Probar". */
export async function latestEmailIds(userId: string, limit: number): Promise<string[]> {
    const rows: Array<{ id: string }> = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "Email" WHERE "userId" = $1 AND "folder" = ANY($2::text[]) ORDER BY "createdAt" DESC, "id" DESC LIMIT ${Math.max(1, Math.min(200, Math.trunc(limit) || 50))}`,
        userId, [...SCAN_FOLDERS]);
    return rows.map((r) => r.id);
}

// ---------- Efectos sobre correos ya guardados ----------

interface PrevState {
    addedLabelIds: string[];
    removedLabelIds: string[];
    folder?: string;
    previousFolder?: string | null;
    scheduledAt?: string | null;
    read?: boolean;
    starred?: boolean;
    after?: { folder?: string; read?: boolean; starred?: boolean };
}

export interface ApplyPageResult {
    processed: number;
    changed: number;
    matched: number;
    perRule: Record<string, number>;
}

/** Comportamiento de las etiquetas involucradas: ids de las que son carpeta. */
async function folderLabelIds(userId: string, ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    try {
        const rows: Array<{ id: string }> = await prisma.$queryRawUnsafe(
            `SELECT "id" FROM "Label" WHERE "userId" = $1 AND "id" = ANY($2::text[]) AND "behavior" = 'folder'`, userId, ids);
        return new Set(rows.map((r) => r.id));
    } catch { return new Set(); }
}

async function ownedLabelIds(userId: string): Promise<Set<string>> {
    const rows: Array<{ id: string }> = await prisma.$queryRawUnsafe(`SELECT "id" FROM "Label" WHERE "userId" = $1`, userId);
    return new Set(rows.map((r) => r.id));
}

/**
 * Aplica `rules` a los correos `emailIds` del usuario. Si se pasa `batchId`, guarda el estado previo de cada correo
 * modificado en RuleBatchItem para poder deshacer.
 */
export async function applyRulesToEmailIds(
    userId: string,
    rules: Rule[],
    emailIds: string[],
    opts: { batchId?: string; load?: Pick<LoadOptions, 'readObject'> } = {},
): Promise<ApplyPageResult> {
    const result: ApplyPageResult = { processed: 0, changed: 0, matched: 0, perRule: {} };
    if (rules.length === 0 || emailIds.length === 0) return result;
    const needs = needsFromRules(rules);
    const ctxs = await loadRuleContexts(userId, emailIds, { needBody: needs.body, needHtml: needs.html, readObject: opts.load?.readObject });
    const valid = await ownedLabelIds(userId);

    for (const id of emailIds) {
        const ctx = ctxs.get(id);
        if (!ctx) continue;
        result.processed++;
        const fx: RuleEffects = evaluateRules(ctx, rules);
        if (fx.appliedRuleIds.length === 0) { await markRuleRun(id, userId); continue; }
        result.matched++;

        const add = fx.addLabelIds.filter((l) => valid.has(l) && !ctx.currentLabelIds.includes(l));
        const remove = fx.removeLabelIds.filter((l) => valid.has(l) && ctx.currentLabelIds.includes(l));
        const folderLabels = await folderLabelIds(userId, [...fx.addLabelIds.filter((l) => valid.has(l))]);
        const willBeFolderLabelled = fx.addLabelIds.some((l) => folderLabels.has(l));

        // Carpeta destino: la explicita de la regla gana; si no, una etiqueta-carpeta saca el correo de Entrada.
        const movable = ctx.folder === 'inbox' || ctx.folder === 'archive';
        let target: string | null = null;
        if (movable && fx.folder && fx.folder !== ctx.folder) target = fx.folder;
        else if (movable && !fx.folder && willBeFolderLabelled && ctx.folder === 'inbox') target = 'archive';
        const snoozeAt = movable && ctx.folder === 'inbox' && fx.snoozeHours && !target
            ? new Date(Date.now() + fx.snoozeHours * 3_600_000) : null;
        const setRead = fx.markRead && !ctx.read;
        const setStar = fx.star && !ctx.starred;

        if (!add.length && !remove.length && !target && !snoozeAt && !setRead && !setStar) { await markRuleRun(id, userId); continue; }

        const prev: PrevState = {
            addedLabelIds: add, removedLabelIds: remove, read: ctx.read, starred: ctx.starred, folder: ctx.folder,
            after: {},
        };
        const cur: Array<{ folder: string; previousFolder: string | null; scheduledAt: Date | null }> = await prisma.$queryRawUnsafe(
            `SELECT "folder","previousFolder","scheduledAt" FROM "Email" WHERE "id" = $1 AND "userId" = $2`, id, userId);
        if (!cur[0]) continue;
        prev.previousFolder = cur[0].previousFolder;
        prev.scheduledAt = cur[0].scheduledAt ? new Date(cur[0].scheduledAt).toISOString() : null;

        await prisma.$transaction(async (tx) => {
            if (add.length) {
                await tx.$executeRawUnsafe(`INSERT INTO "_EmailToLabel" ("A","B") SELECT $1, x FROM unnest($2::text[]) AS x ON CONFLICT DO NOTHING`, id, add);
            }
            if (remove.length) {
                await tx.$executeRawUnsafe(`DELETE FROM "_EmailToLabel" WHERE "A" = $1 AND "B" = ANY($2::text[])`, id, remove);
            }
            if (target) {
                await tx.$executeRawUnsafe(
                    `UPDATE "Email" SET "previousFolder" = CASE WHEN $2::text IN ('archive','trash','spam') AND "folder" <> $2::text THEN "folder" WHEN $2::text = 'inbox' THEN NULL ELSE "previousFolder" END,
                        "folder" = $2::text WHERE "id" = $1 AND "userId" = $3`, id, target, userId);
                prev.after!.folder = target;
            } else if (snoozeAt) {
                await tx.$executeRawUnsafe(`UPDATE "Email" SET "folder" = 'snoozed', "scheduledAt" = $2 WHERE "id" = $1 AND "userId" = $3`, id, snoozeAt, userId);
                prev.after!.folder = 'snoozed';
            }
            if (setRead) { await tx.$executeRawUnsafe(`UPDATE "Email" SET "read" = TRUE WHERE "id" = $1 AND "userId" = $2`, id, userId); prev.after!.read = true; }
            if (setStar) { await tx.$executeRawUnsafe(`UPDATE "Email" SET "starred" = TRUE WHERE "id" = $1 AND "userId" = $2`, id, userId); prev.after!.starred = true; }
            if (opts.batchId) {
                await tx.$executeRawUnsafe(
                    `INSERT INTO "RuleBatchItem" ("batchId","emailId","prev") VALUES ($1,$2,$3::jsonb) ON CONFLICT ("batchId","emailId") DO NOTHING`,
                    opts.batchId, id, JSON.stringify(prev));
            }
        });
        result.changed++;
        for (const rid of fx.appliedRuleIds) result.perRule[rid] = (result.perRule[rid] ?? 0) + 1;
        await markRuleRun(id, userId);
    }
    await bumpRuleStats(userId, result.perRule);
    return result;
}

// ---------- Lotes ----------

export interface BatchRow { id: string; ruleId: string | null; labelId: string | null; status: string; processed: number; changed: number; createdAt: string; undoneAt: string | null }

export async function createBatch(userId: string, ruleId: string | null, labelId: string | null): Promise<string> {
    const id = `rb_${crypto.randomUUID().replace(/-/g, '')}`;
    await prisma.$executeRawUnsafe(`INSERT INTO "RuleBatch" ("id","userId","ruleId","labelId") VALUES ($1,$2,$3,$4)`, id, userId, ruleId, labelId);
    return id;
}

export async function getBatch(userId: string, batchId: string): Promise<BatchRow | null> {
    try {
        const rows: any[] = await prisma.$queryRawUnsafe(`SELECT * FROM "RuleBatch" WHERE "id" = $1 AND "userId" = $2`, batchId, userId);
        return rows[0] ? mapBatch(rows[0]) : null;
    } catch (e) {
        if (isMissingRelation(e)) return null;
        throw e;
    }
}

const mapBatch = (r: any): BatchRow => ({
    id: r.id, ruleId: r.ruleId ?? null, labelId: r.labelId ?? null, status: r.status, processed: Number(r.processed) || 0, changed: Number(r.changed) || 0,
    createdAt: new Date(r.createdAt).toISOString(), undoneAt: r.undoneAt ? new Date(r.undoneAt).toISOString() : null,
});

export async function listBatches(userId: string, limit = 10): Promise<BatchRow[]> {
    try {
        const rows: any[] = await prisma.$queryRawUnsafe(
            `SELECT * FROM "RuleBatch" WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT ${Math.max(1, Math.min(50, limit))}`, userId);
        return rows.map(mapBatch);
    } catch (e) {
        if (isMissingRelation(e)) return [];
        throw e;
    }
}

export async function addBatchProgress(userId: string, batchId: string, processed: number, changed: number): Promise<void> {
    await prisma.$executeRawUnsafe(
        `UPDATE "RuleBatch" SET "processed" = "processed" + $1, "changed" = "changed" + $2 WHERE "id" = $3 AND "userId" = $4 AND "status" = 'applied'`, processed, changed, batchId, userId);
}

/**
 * Deshace un lote: quita las etiquetas que anadio, repone las que quito y restaura carpeta / leido / destacado SOLO si el
 * correo sigue como lo dejo el lote (no pisa cambios posteriores del usuario). Devuelve cuantos correos se restauraron.
 */
export async function undoBatch(userId: string, batchId: string): Promise<{ restored: number } | null> {
    const batch = await getBatch(userId, batchId);
    if (!batch || batch.status !== 'applied') return null;
    const claimed = await prisma.$executeRawUnsafe(`UPDATE "RuleBatch" SET "status" = 'undone', "undoneAt" = CURRENT_TIMESTAMP WHERE "id" = $1 AND "userId" = $2 AND "status" = 'applied'`, batchId, userId);
    if (Number(claimed) === 0) return null; // carrera: otro deshacer ya lo tomo
    const items: Array<{ emailId: string; prev: PrevState }> = await prisma.$queryRawUnsafe(
        `SELECT i."emailId", i."prev" FROM "RuleBatchItem" i JOIN "Email" e ON e."id" = i."emailId" WHERE i."batchId" = $1 AND e."userId" = $2`, batchId, userId);
    const valid = await ownedLabelIds(userId);
    let restored = 0;
    for (const it of items) {
        const p = it.prev;
        await prisma.$transaction(async (tx) => {
            if (p.addedLabelIds?.length) await tx.$executeRawUnsafe(`DELETE FROM "_EmailToLabel" WHERE "A" = $1 AND "B" = ANY($2::text[])`, it.emailId, p.addedLabelIds);
            const back = (p.removedLabelIds ?? []).filter((l) => valid.has(l));
            if (back.length) await tx.$executeRawUnsafe(`INSERT INTO "_EmailToLabel" ("A","B") SELECT $1, x FROM unnest($2::text[]) AS x ON CONFLICT DO NOTHING`, it.emailId, back);
            if (p.after?.folder && p.folder) {
                await tx.$executeRawUnsafe(
                    `UPDATE "Email" SET "folder" = $2, "previousFolder" = $3, "scheduledAt" = $4 WHERE "id" = $1 AND "userId" = $5 AND "folder" = $6`,
                    it.emailId, p.folder, p.previousFolder ?? null, p.scheduledAt ? new Date(p.scheduledAt) : null, userId, p.after.folder);
            }
            if (p.after?.read && p.read === false) await tx.$executeRawUnsafe(`UPDATE "Email" SET "read" = FALSE WHERE "id" = $1 AND "userId" = $2 AND "read" = TRUE`, it.emailId, userId);
            if (p.after?.starred && p.starred === false) await tx.$executeRawUnsafe(`UPDATE "Email" SET "starred" = FALSE WHERE "id" = $1 AND "userId" = $2 AND "starred" = TRUE`, it.emailId, userId);
        });
        restored++;
    }
    await prisma.$executeRawUnsafe(`DELETE FROM "RuleBatchItem" WHERE "batchId" = $1`, batchId);
    return { restored };
}

export { countLeaves };
export type { StoredEmailContext };

/** Compatibilidad: aplica reglas a correos indicados por id (antes recibia filas ya cargadas). */
export async function applyRulesToEmails(userId: string, rules: Rule[], emails: Array<{ id: string }>): Promise<{ processed: number; changed: number }> {
    const r = await applyRulesToEmailIds(userId, rules, emails.map((e) => e.id));
    return { processed: r.processed, changed: r.changed };
}

/** Cuenta coincidencias de un conjunto de reglas (cualquiera) sobre correos, sin efectos. */
export async function countMatchesForRules(userId: string, rules: Rule[], emailIds: string[]): Promise<{ processed: number; matched: number; unknown: number }> {
    const needs = needsFromRules(rules);
    const ctxs = await loadRuleContexts(userId, emailIds, { needBody: needs.body, needHtml: needs.html });
    let matched = 0;
    let unknown = 0;
    for (const id of emailIds) {
        const ctx = ctxs.get(id);
        if (!ctx) continue;
        const results = rules.map((r) => evaluateConditions(r.conditions, ctx));
        if (results.includes(true)) matched++;
        else if (results.includes(null)) unknown++;
    }
    return { processed: ctxs.size, matched, unknown };
}
