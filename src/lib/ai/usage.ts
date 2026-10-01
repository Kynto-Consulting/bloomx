import { randomUUID } from 'node:crypto';
import { execute, isMissingRelation, num, query, toIso } from '@/lib/admin/sql';
import type { AiConfig, ModelPrice, QuotaSet } from './types';

/**
 * Uso de IA (tabla AiUsage): una fila por llamada al proveedor, SIN prompts ni respuestas. Cuotas por usuario y globales
 * (peticiones y tokens por dia/mes UTC), resumenes para /admin/ai, exportacion CSV y retencion configurable.
 */
export interface UsageEntry {
    userId: string; feature: string; extensionId: string | null; provider: string; model: string;
    tokensIn: number; tokensOut: number; ok: boolean; errorCode?: string | null; flags?: string[]; costUsd?: number;
}

export function estimateCost(price: ModelPrice | undefined, tokensIn: number, tokensOut: number): number {
    if (!price) return 0;
    return (tokensIn / 1000) * price.inPer1k + (tokensOut / 1000) * price.outPer1k;
}

export async function recordUsage(e: UsageEntry): Promise<void> {
    try {
        await execute(
            `INSERT INTO "AiUsage" ("id","userId","feature","extensionId","provider","model","tokensIn","tokensOut","ok","errorCode","flags","costUsd")
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            randomUUID(), e.userId.slice(0, 64), e.feature, e.extensionId?.slice(0, 128) ?? null, e.provider.slice(0, 40), e.model.slice(0, 120),
            Math.max(0, Math.round(e.tokensIn)), Math.max(0, Math.round(e.tokensOut)), e.ok, e.errorCode ?? null, e.flags?.length ? e.flags.join(',').slice(0, 200) : null, e.costUsd ?? 0,
        );
    } catch (err) { if (!isMissingRelation(err)) console.error('[AI_USAGE] record failed:', String((err as Error)?.message).slice(0, 120)); }
}

const dayStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export interface Counters { requestsDay: number; requestsMonth: number; tokensDay: number; tokensMonth: number }

/** Contadores del periodo. `userId` = null => globales. Solo cuentan llamadas que llegaron al proveedor (no las rechazadas antes). */
export async function getCounters(userId: string | null, now = new Date()): Promise<Counters> {
    try {
        const rows = await query<{ rd: unknown; rm: unknown; td: unknown; tm: unknown }>(
            `SELECT COUNT(*) FILTER (WHERE "ts" >= $2) AS rd, COUNT(*) AS rm,
                    COALESCE(SUM("tokensIn"+"tokensOut") FILTER (WHERE "ts" >= $2),0) AS td, COALESCE(SUM("tokensIn"+"tokensOut"),0) AS tm
             FROM "AiUsage" WHERE "ts" >= $1 AND ("errorCode" IS NULL OR "errorCode" NOT IN ('quota_exceeded','guardrail_blocked','ai_disabled','feature_disabled','not_configured'))
               AND ($3::text IS NULL OR "userId" = $3)`,
            monthStart(now), dayStart(now), userId,
        );
        const r = rows[0];
        return { requestsDay: num(r?.rd), requestsMonth: num(r?.rm), tokensDay: num(r?.td), tokensMonth: num(r?.tm) };
    } catch (e) { if (isMissingRelation(e)) return { requestsDay: 0, requestsMonth: 0, tokensDay: 0, tokensMonth: 0 }; throw e; }
}

export type QuotaScope = 'user' | 'global';
export interface QuotaBreach { scope: QuotaScope; metric: keyof QuotaSet; period: 'day' | 'month'; retryAfter: number }

const secondsUntil = (d: Date) => Math.max(1, Math.ceil((d.getTime() - Date.now()) / 1000));

/** Devuelve el primer limite superado (null = dentro de cuota). `plannedTokens` = salida maxima que se pedira (reserva). */
export function checkCounters(c: Counters, q: QuotaSet, scope: QuotaScope, plannedTokens = 0, now = new Date()): QuotaBreach | null {
    const nextDay = new Date(dayStart(now).getTime() + 86_400_000);
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    if (q.requestsDay > 0 && c.requestsDay + 1 > q.requestsDay) return { scope, metric: 'requestsDay', period: 'day', retryAfter: secondsUntil(nextDay) };
    if (q.requestsMonth > 0 && c.requestsMonth + 1 > q.requestsMonth) return { scope, metric: 'requestsMonth', period: 'month', retryAfter: secondsUntil(nextMonth) };
    if (q.tokensDay > 0 && c.tokensDay >= q.tokensDay) return { scope, metric: 'tokensDay', period: 'day', retryAfter: secondsUntil(nextDay) };
    if (q.tokensMonth > 0 && c.tokensMonth >= q.tokensMonth) return { scope, metric: 'tokensMonth', period: 'month', retryAfter: secondsUntil(nextMonth) };
    void plannedTokens;
    return null;
}

export async function checkQuotas(userId: string, config: AiConfig, plannedTokens: number): Promise<QuotaBreach | null> {
    const u = config.quotas.perUser, g = config.quotas.global;
    const anyUser = Object.values(u).some((v) => v > 0), anyGlobal = Object.values(g).some((v) => v > 0);
    if (anyUser) { const b = checkCounters(await getCounters(userId), u, 'user', plannedTokens); if (b) return b; }
    if (anyGlobal) { const b = checkCounters(await getCounters(null), g, 'global', plannedTokens); if (b) return b; }
    return null;
}

/** Cuota restante de un usuario (para `ai.status()`). -1 = ilimitado. */
export async function remainingFor(userId: string, config: AiConfig): Promise<Record<keyof QuotaSet, number>> {
    const c = await getCounters(userId);
    const u = config.quotas.perUser;
    const rem = (lim: number, used: number) => (lim > 0 ? Math.max(0, lim - used) : -1);
    return { requestsDay: rem(u.requestsDay, c.requestsDay), requestsMonth: rem(u.requestsMonth, c.requestsMonth), tokensDay: rem(u.tokensDay, c.tokensDay), tokensMonth: rem(u.tokensMonth, c.tokensMonth) };
}

// ------------------------------------------------------------------------------------------------------------------
// Resumenes para la vista /admin/ai (Uso)
// ------------------------------------------------------------------------------------------------------------------
export interface UsageSummary {
    from: string; to: string;
    totals: { requests: number; errors: number; tokensIn: number; tokensOut: number; costUsd: number };
    byDay: Array<{ day: string; requests: number; tokens: number; costUsd: number }>;
    byFeature: Array<{ feature: string; requests: number; tokens: number; costUsd: number }>;
    byUser: Array<{ userId: string; email: string | null; requests: number; tokens: number; costUsd: number }>;
    byExtension: Array<{ extensionId: string; requests: number; tokens: number }>;
}

export async function usageSummary(days = 30, now = new Date()): Promise<UsageSummary> {
    const d = Math.min(366, Math.max(1, Math.floor(days)));
    const from = new Date(dayStart(now).getTime() - (d - 1) * 86_400_000);
    const empty: UsageSummary = { from: from.toISOString(), to: now.toISOString(), totals: { requests: 0, errors: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 }, byDay: [], byFeature: [], byUser: [], byExtension: [] };
    try {
        const [t, byDay, byFeature, byUser, byExt] = await Promise.all([
            query<any>(`SELECT COUNT(*) AS r, COUNT(*) FILTER (WHERE NOT "ok") AS e, COALESCE(SUM("tokensIn"),0) AS ti, COALESCE(SUM("tokensOut"),0) AS "to", COALESCE(SUM("costUsd"),0) AS c FROM "AiUsage" WHERE "ts" >= $1`, from),
            query<any>(`SELECT to_char(date_trunc('day',"ts" AT TIME ZONE 'UTC'),'YYYY-MM-DD') AS day, COUNT(*) AS r, COALESCE(SUM("tokensIn"+"tokensOut"),0) AS t, COALESCE(SUM("costUsd"),0) AS c FROM "AiUsage" WHERE "ts" >= $1 GROUP BY 1 ORDER BY 1`, from),
            query<any>(`SELECT "feature", COUNT(*) AS r, COALESCE(SUM("tokensIn"+"tokensOut"),0) AS t, COALESCE(SUM("costUsd"),0) AS c FROM "AiUsage" WHERE "ts" >= $1 GROUP BY 1 ORDER BY r DESC`, from),
            query<any>(`SELECT u."userId", usr."email", COUNT(*) AS r, COALESCE(SUM(u."tokensIn"+u."tokensOut"),0) AS t, COALESCE(SUM(u."costUsd"),0) AS c
                        FROM "AiUsage" u LEFT JOIN "User" usr ON usr."id" = u."userId" WHERE u."ts" >= $1 GROUP BY u."userId", usr."email" ORDER BY t DESC LIMIT 200`, from),
            query<any>(`SELECT COALESCE("extensionId",'') AS x, COUNT(*) AS r, COALESCE(SUM("tokensIn"+"tokensOut"),0) AS t FROM "AiUsage" WHERE "ts" >= $1 GROUP BY 1 ORDER BY r DESC`, from),
        ]);
        return {
            ...empty,
            totals: { requests: num(t[0]?.r), errors: num(t[0]?.e), tokensIn: num(t[0]?.ti), tokensOut: num(t[0]?.to), costUsd: Number(t[0]?.c ?? 0) },
            byDay: byDay.map((r) => ({ day: r.day, requests: num(r.r), tokens: num(r.t), costUsd: Number(r.c) })),
            byFeature: byFeature.map((r) => ({ feature: r.feature, requests: num(r.r), tokens: num(r.t), costUsd: Number(r.c) })),
            byUser: byUser.map((r) => ({ userId: r.userId, email: r.email ?? null, requests: num(r.r), tokens: num(r.t), costUsd: Number(r.c) })),
            byExtension: byExt.filter((r) => r.x).map((r) => ({ extensionId: r.x, requests: num(r.r), tokens: num(r.t) })),
        };
    } catch (e) { if (isMissingRelation(e)) return empty; throw e; }
}

const csvCell = (v: unknown): string => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // inyeccion de formulas en hojas de calculo
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV de uso por dia/usuario/funcion/extension/modelo (sin contenido). Maximo 50.000 filas. */
export async function usageCsv(days = 30, now = new Date()): Promise<string> {
    const from = new Date(dayStart(now).getTime() - (Math.min(366, Math.max(1, Math.floor(days))) - 1) * 86_400_000);
    let rows: any[] = [];
    try {
        rows = await query<any>(
            `SELECT to_char(date_trunc('day',"ts" AT TIME ZONE 'UTC'),'YYYY-MM-DD') AS day, "userId", "feature", COALESCE("extensionId",'') AS ext, "provider", "model",
                    COUNT(*) AS r, COUNT(*) FILTER (WHERE NOT "ok") AS e, SUM("tokensIn") AS ti, SUM("tokensOut") AS tout, SUM("costUsd") AS c
             FROM "AiUsage" WHERE "ts" >= $1 GROUP BY 1,2,3,4,5,6 ORDER BY 1 DESC, 2 LIMIT 50000`, from);
    } catch (e) { if (!isMissingRelation(e)) throw e; }
    const head = ['day', 'userId', 'feature', 'extensionId', 'provider', 'model', 'requests', 'errors', 'tokensIn', 'tokensOut', 'costUsd'];
    return [head.join(','), ...rows.map((r) => [r.day, r.userId, r.feature, r.ext, r.provider, r.model, num(r.r), num(r.e), num(r.ti), num(r.tout), Number(r.c ?? 0).toFixed(6)].map(csvCell).join(','))].join('\r\n') + '\r\n';
}

/** Borra filas anteriores a la retencion configurada. Devuelve cuantas. */
export async function purgeUsage(retentionDays: number, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - Math.max(1, retentionDays) * 86_400_000);
    try { return await execute(`DELETE FROM "AiUsage" WHERE "ts" < $1`, cutoff); } catch (e) { if (isMissingRelation(e)) return 0; throw e; }
}

let lastPurge = 0;
/** Purga oportunista (como mucho 1 vez por hora y proceso) tras registrar uso: no hace falta cron. */
export async function maybePurge(retentionDays: number): Promise<void> {
    if (Date.now() - lastPurge < 3_600_000) return;
    lastPurge = Date.now();
    await purgeUsage(retentionDays).catch(() => 0);
}
export const __resetPurge = () => { lastPurge = 0; };
export { toIso };
