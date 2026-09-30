/**
 * Registro ligero de decisiones (tabla SpamEvent): SIN contenido (ni asunto ni cuerpo): remitente, destinatario, decision, puntuacion,
 * regla y motivos (ids de senal). Retencion configurable (30 dias por defecto). Tolerante a tabla ausente.
 */
import { randomUUID } from 'node:crypto';
import { execute, isMissingRelation, num, query, toIso } from '@/lib/admin/sql';
import { domainOf } from './text';

export const EVENT_DECISIONS = ['delivered', 'warned', 'spam', 'blocked', 'notspam', 'markspam'] as const;
export type EventDecision = (typeof EVENT_DECISIONS)[number];

export interface CompactReason { i: string; w: number }
export interface SpamEventInput {
    userId?: string | null;
    recipient?: string | null;
    sender: string;
    decision: EventDecision;
    score?: number | null;
    /** Id de la entrada de lista que acerto (bloqueo/permitido). */
    ruleId?: string | null;
    /** Etiqueta de la regla, p. ej. 'block.domain:example.com' (sin contenido del correo). */
    ruleLabel?: string | null;
    reasons?: CompactReason[];
    external?: boolean;
}

const MAX_REASONS_BYTES = 2048;
export function boundReasons(reasons: CompactReason[] | undefined): CompactReason[] {
    const out: CompactReason[] = [];
    let bytes = 2;
    for (const r of reasons ?? []) {
        const s = JSON.stringify({ i: r.i.slice(0, 40), w: Math.round(r.w) });
        if (bytes + s.length + 1 > MAX_REASONS_BYTES) break;
        bytes += s.length + 1;
        out.push({ i: r.i.slice(0, 40), w: Math.round(r.w) });
    }
    return out;
}

export async function recordEvent(e: SpamEventInput): Promise<void> {
    try {
        const sender = e.sender.toLowerCase().slice(0, 320);
        await execute(
            `INSERT INTO "SpamEvent" ("id","userId","recipient","sender","senderDomain","decision","score","ruleId","ruleLabel","reasons","external")
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
            randomUUID(), e.userId ?? null, e.recipient ? e.recipient.toLowerCase().slice(0, 320) : null, sender, domainOf(sender).slice(0, 255), e.decision,
            e.score === null || e.score === undefined ? null : Math.round(e.score), e.ruleId ?? null, e.ruleLabel ? e.ruleLabel.slice(0, 300) : null,
            JSON.stringify(boundReasons(e.reasons)), e.external === true,
        );
    } catch (error) {
        if (!isMissingRelation(error)) console.error('[spam-events] record failed:', error instanceof Error ? error.message.slice(0, 200) : 'error');
    }
}

/** Borra eventos anteriores a la retencion. Se llama de forma oportunista (1 de cada N escrituras) y desde el mantenimiento. */
export async function purgeEvents(days: number): Promise<number> {
    try { return await execute(`DELETE FROM "SpamEvent" WHERE "ts" < NOW() - ($1::int * INTERVAL '1 day')`, Math.max(1, Math.floor(days))); }
    catch { return 0; }
}

export interface EventRow {
    id: string; ts: string | null; recipient: string | null; sender: string; senderDomain: string | null; decision: string; score: number | null;
    ruleLabel: string | null; reasons: CompactReason[]; external: boolean;
}

export interface EventQuery { from?: Date; to?: Date; decision?: EventDecision; domain?: string; page?: number; pageSize?: number }

function whereOf(q: EventQuery): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    const w: string[] = ['TRUE'];
    if (q.from) { params.push(q.from); w.push(`"ts" >= $${params.length}`); }
    if (q.to) { params.push(q.to); w.push(`"ts" <= $${params.length}`); }
    if (q.decision) { params.push(q.decision); w.push(`"decision" = $${params.length}`); }
    if (q.domain) { params.push(`%${q.domain.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`).slice(0, 100)}%`); w.push(`"senderDomain" ILIKE $${params.length}`); }
    return { sql: w.join(' AND '), params };
}

export async function listEvents(q: EventQuery): Promise<{ rows: EventRow[]; total: number }> {
    const page = Math.max(1, Math.floor(q.page ?? 1));
    const size = Math.min(200, Math.max(1, Math.floor(q.pageSize ?? 50)));
    const { sql, params } = whereOf(q);
    try {
        const total = num((await query<{ n: bigint }>(`SELECT COUNT(*) AS n FROM "SpamEvent" WHERE ${sql}`, ...params))[0]?.n);
        const rows = await query<Record<string, unknown>>(
            `SELECT "id","ts","recipient","sender","senderDomain","decision","score","ruleLabel","reasons","external" FROM "SpamEvent" WHERE ${sql} ORDER BY "ts" DESC, "id" DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, ...params,
        );
        return {
            total,
            rows: rows.map((r) => ({
                id: String(r.id), ts: toIso(r.ts), recipient: (r.recipient as string) ?? null, sender: String(r.sender), senderDomain: (r.senderDomain as string) ?? null,
                decision: String(r.decision), score: r.score === null || r.score === undefined ? null : num(r.score), ruleLabel: (r.ruleLabel as string) ?? null,
                reasons: Array.isArray(r.reasons) ? (r.reasons as CompactReason[]) : [], external: r.external === true,
            })),
        };
    } catch (error) {
        if (isMissingRelation(error)) return { rows: [], total: 0 };
        throw error;
    }
}

export interface SpamStats {
    days: number;
    perDay: Array<{ day: string; spam: number; blocked: number; warned: number; external: number; notspam: number }>;
    topDomains: Array<{ domain: string; count: number }>;
    totals: { spam: number; blocked: number; warned: number; external: number; notspam: number; markspam: number };
}

export async function spamStats(days = 30): Promise<SpamStats> {
    const d = Math.min(365, Math.max(1, Math.floor(days)));
    const empty: SpamStats = { days: d, perDay: [], topDomains: [], totals: { spam: 0, blocked: 0, warned: 0, external: 0, notspam: 0, markspam: 0 } };
    try {
        const rows = await query<{ day: Date | string; decision: string; n: bigint }>(
            `SELECT date_trunc('day', "ts") AS day, "decision", COUNT(*) AS n FROM "SpamEvent" WHERE "ts" >= NOW() - ($1::int * INTERVAL '1 day') GROUP BY 1, 2 ORDER BY 1`, d,
        );
        const map = new Map<string, SpamStats['perDay'][number]>();
        for (const r of rows) {
            const day = (toIso(r.day) ?? '').slice(0, 10);
            const cur = map.get(day) ?? { day, spam: 0, blocked: 0, warned: 0, external: 0, notspam: 0 };
            const n = num(r.n);
            if (r.decision === 'spam') { cur.spam += n; empty.totals.spam += n; }
            else if (r.decision === 'blocked') { cur.blocked += n; empty.totals.blocked += n; }
            else if (r.decision === 'warned') { cur.warned += n; empty.totals.warned += n; }
            else if (r.decision === 'notspam') { cur.notspam += n; empty.totals.notspam += n; }
            else if (r.decision === 'markspam') empty.totals.markspam += n;
            map.set(day, cur);
        }
        try {
            const ext = await query<{ day: Date | string; n: bigint }>(
                `SELECT date_trunc('day', "createdAt") AS day, COUNT(*) AS n FROM "Email" WHERE "isExternal" = TRUE AND "createdAt" >= NOW() - ($1::int * INTERVAL '1 day') GROUP BY 1`, d,
            );
            for (const r of ext) {
                const day = (toIso(r.day) ?? '').slice(0, 10);
                const cur = map.get(day) ?? { day, spam: 0, blocked: 0, warned: 0, external: 0, notspam: 0 };
                cur.external += num(r.n); empty.totals.external += num(r.n);
                map.set(day, cur);
            }
        } catch (error) { if (!isMissingRelation(error)) throw error; }
        empty.perDay = [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
        const top = await query<{ domain: string; n: bigint }>(
            `SELECT "senderDomain" AS domain, COUNT(*) AS n FROM "SpamEvent" WHERE "ts" >= NOW() - ($1::int * INTERVAL '1 day') AND "decision" IN ('spam','blocked') AND "senderDomain" IS NOT NULL AND "senderDomain" <> ''
             GROUP BY 1 ORDER BY n DESC, 1 ASC LIMIT 10`, d,
        );
        empty.topDomains = top.map((r) => ({ domain: r.domain, count: num(r.n) }));
        return empty;
    } catch (error) {
        if (isMissingRelation(error)) return empty;
        throw error;
    }
}
