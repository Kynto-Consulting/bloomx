import { isMissingRelation, num, query, tolerant, toIso } from '@/lib/admin/sql';
import { pageMeta, type PageMeta, type Paging } from '@/lib/admin/paging';
import { ownDomains } from '@/lib/backend-auth';

/**
 * Datos de la seccion CORREO de la consola. PRIVACIDAD: solo METADATOS AGREGADOS (conteos, series, estados) y, por usuario,
 * conteos. Nunca asuntos, cuerpos, adjuntos ni listas de remitentes/destinatarios de correos normales. La unica lista con
 * direcciones es la de SUPRESION (hace falta para poder quitar entradas).
 *
 * Todo SQL va parametrizado y tolerante a tablas ausentes (despliegue sin `db:ensure`).
 */

/**
 * Limite de envios por usuario y hora. DUPLICADO deliberadamente de `src/app/api/emails/route.ts` (misma variable de entorno y
 * mismo defecto 200): extraerlo obligaria a tocar esa ruta, que edita otro equipo. Un test vigila que sigan iguales.
 */
export const MAX_SENDS_PER_HOUR = Number.parseInt(process.env.MAX_SENDS_PER_HOUR || '200', 10) || 200;

export const MAIL_RANGES = ['24h', '7d', '30d'] as const;
export type MailRange = (typeof MAIL_RANGES)[number];
export type Granularity = 'hour' | 'day';

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** `sent` = carpetas en las que POST /api/emails guarda los envios propios. */
const SENT_FOLDERS_SQL = `("folder" IN ('sent','scheduled'))`;

/** Escapa %, _ y \ para ILIKE ... ESCAPE '\'. */
function escapeLike(input: string): string {
    return `%${input.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Rango y cubos (UTC, deterministas)
// ---------------------------------------------------------------------------------------------------------------------
export interface RangeWindow {
    range: MailRange;
    granularity: Granularity;
    /** Inicio (inclusive) del primer cubo. */
    since: Date;
    buckets: string[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const hourKey = (d: Date) => `${dayKey(d)}T${pad(d.getUTCHours())}`;

/** 24h -> 24 cubos por hora; 7d/30d -> N cubos por dia (incluye el dia en curso). Alineado a UTC. */
export function resolveRange(range: MailRange, now: Date = new Date()): RangeWindow {
    const buckets: string[] = [];
    if (range === '24h') {
        const end = Math.floor(now.getTime() / HOUR) * HOUR;
        const start = end - 23 * HOUR;
        for (let t = start; t <= end; t += HOUR) buckets.push(hourKey(new Date(t)));
        return { range, granularity: 'hour', since: new Date(start), buckets };
    }
    const days = range === '7d' ? 7 : 30;
    const end = Math.floor(now.getTime() / DAY) * DAY;
    const start = end - (days - 1) * DAY;
    for (let t = start; t <= end; t += DAY) buckets.push(dayKey(new Date(t)));
    return { range, granularity: 'day', since: new Date(start), buckets };
}

// ---------------------------------------------------------------------------------------------------------------------
// Metricas
// ---------------------------------------------------------------------------------------------------------------------
export interface SeriesPoint {
    bucket: string;
    sent: number;
    received: number;
    bounces: number;
    complaints: number;
    unsubscribes: number;
    spam: number;
    blocked: number;
}

export interface UserQuota {
    userId: string;
    email: string;
    sentLastHour: number;
    limit: number;
    percent: number;
}

export interface UserVolume {
    userId: string;
    email: string;
    sent: number;
    received: number;
    total: number;
}

export interface MailMetrics {
    range: MailRange;
    granularity: Granularity;
    since: string;
    generatedAt: string;
    /** Dominio activo de la instancia (todos los usuarios de esta BD pertenecen a el). */
    domain: string | null;
    series: SeriesPoint[];
    totals: { sent: number; received: number; bounces: number; complaints: number; unsubscribes: number; spam: number; blocked: number };
    /** `available:false` = no hay registro persistente de adjuntos bloqueados (tabla Attachment ausente). */
    blockedAttachments: { available: boolean };
    scheduled: ScheduledQueue;
    quota: { limit: number; windowMinutes: 60; topLastHour: UserQuota[]; topRange: UserVolume[] };
}

export interface ScheduledQueue {
    pending: number;
    overdue: number;
    oldest: string | null;
}

const bucketFmt = (g: Granularity) => (g === 'hour' ? `YYYY-MM-DD"T"HH24` : 'YYYY-MM-DD');
// El ancho del cubo sale de una lista blanca fija del codigo (nunca del cliente).
const truncUnit = (g: Granularity) => (g === 'hour' ? 'hour' : 'day');

export async function getScheduledQueue(now: Date = new Date()): Promise<ScheduledQueue> {
    const rows = await tolerant(
        () => query<{ pending: unknown; overdue: unknown; oldest: unknown }>(
            `SELECT COUNT(*) FILTER (WHERE "scheduledAt" > $1::timestamptz) AS pending,
                    COUNT(*) FILTER (WHERE "scheduledAt" <= $1::timestamptz) AS overdue,
                    MIN("scheduledAt") AS oldest
               FROM "Email" WHERE "folder" = 'scheduled' AND "scheduledAt" IS NOT NULL`,
            now.toISOString(),
        ),
        [],
    );
    const r = rows[0];
    return { pending: num(r?.pending), overdue: num(r?.overdue), oldest: toIso(r?.oldest) };
}

export async function getMailMetrics(range: MailRange, now: Date = new Date()): Promise<MailMetrics> {
    const win = resolveRange(range, now);
    const since = win.since.toISOString();
    const g = win.granularity;
    const unit = truncUnit(g);
    const fmt = bucketFmt(g);
    const hourAgo = new Date(now.getTime() - HOUR).toISOString();

    const [mailRows, eventRows, blockedRows, scheduled, lastHour, byRange] = await Promise.all([
        tolerant(
            () => query<{ bucket: string; sent: unknown; received: unknown; spam: unknown }>(
                `SELECT to_char(date_trunc('${unit}', "createdAt" AT TIME ZONE 'UTC'), '${fmt}') AS bucket,
                        COUNT(*) FILTER (WHERE ${SENT_FOLDERS_SQL}) AS sent,
                        COUNT(*) FILTER (WHERE "status" = 'received') AS received,
                        COUNT(*) FILTER (WHERE "folder" = 'spam') AS spam
                   FROM "Email" WHERE "createdAt" >= $1::timestamptz GROUP BY 1`,
                since,
            ),
            [],
        ),
        tolerant(
            () => query<{ bucket: string; reason: string | null; n: unknown }>(
                `SELECT to_char(date_trunc('${unit}', "createdAt" AT TIME ZONE 'UTC'), '${fmt}') AS bucket,
                        COALESCE("data"->>'reason', 'unsubscribe') AS reason, COUNT(*) AS n
                   FROM "EmailEvent" WHERE "type" = 'unsubscribe' AND "createdAt" >= $1::timestamptz GROUP BY 1, 2`,
                since,
            ),
            [],
        ),
        // Los adjuntos bloqueados por el filtro de contenido se guardan como fila Attachment { key: 'BLOCKED', status: 'failed' }.
        tolerant<{ bucket: string; n: unknown }[] | null>(
            () => query<{ bucket: string; n: unknown }>(
                `SELECT to_char(date_trunc('${unit}', "createdAt" AT TIME ZONE 'UTC'), '${fmt}') AS bucket, COUNT(*) AS n
                   FROM "Attachment" WHERE "key" = 'BLOCKED' AND "createdAt" >= $1::timestamptz GROUP BY 1`,
                since,
            ),
            null,
        ),
        getScheduledQueue(now),
        tolerant(
            () => query<{ id: string; email: string; n: unknown }>(
                `SELECT u."id" AS id, u."email" AS email, COUNT(*) AS n
                   FROM "Email" e JOIN "User" u ON u."id" = e."userId"
                  WHERE e."folder" IN ('sent','scheduled') AND e."createdAt" >= $1::timestamptz
                  GROUP BY u."id", u."email" ORDER BY n DESC, u."email" ASC LIMIT 10`,
                hourAgo,
            ),
            [],
        ),
        tolerant(
            () => query<{ id: string; email: string; sent: unknown; received: unknown }>(
                `SELECT u."id" AS id, u."email" AS email,
                        COUNT(*) FILTER (WHERE e."folder" IN ('sent','scheduled')) AS sent,
                        COUNT(*) FILTER (WHERE e."status" = 'received') AS received
                   FROM "Email" e JOIN "User" u ON u."id" = e."userId"
                  WHERE e."createdAt" >= $1::timestamptz
                  GROUP BY u."id", u."email"
                  ORDER BY (COUNT(*) FILTER (WHERE e."folder" IN ('sent','scheduled')) + COUNT(*) FILTER (WHERE e."status" = 'received')) DESC, u."email" ASC
                  LIMIT 10`,
                since,
            ),
            [],
        ),
    ]);

    const byBucket = new Map<string, SeriesPoint>(
        win.buckets.map((b) => [b, { bucket: b, sent: 0, received: 0, bounces: 0, complaints: 0, unsubscribes: 0, spam: 0, blocked: 0 }]),
    );
    for (const r of mailRows) {
        const p = byBucket.get(r.bucket);
        if (!p) continue;
        p.sent += num(r.sent);
        p.received += num(r.received);
        p.spam += num(r.spam);
    }
    for (const r of eventRows) {
        const p = byBucket.get(r.bucket);
        if (!p) continue;
        const n = num(r.n);
        if (r.reason === 'bounce') p.bounces += n;
        else if (r.reason === 'complaint') p.complaints += n;
        else p.unsubscribes += n;
    }
    for (const r of blockedRows ?? []) {
        const p = byBucket.get(r.bucket);
        if (p) p.blocked += num(r.n);
    }
    const series = win.buckets.map((b) => byBucket.get(b)!);
    const sum = (k: keyof Omit<SeriesPoint, 'bucket'>) => series.reduce((acc, p) => acc + p[k], 0);

    return {
        range,
        granularity: g,
        since,
        generatedAt: now.toISOString(),
        domain: ownDomains()[0] ?? null,
        series,
        totals: {
            sent: sum('sent'), received: sum('received'), bounces: sum('bounces'), complaints: sum('complaints'),
            unsubscribes: sum('unsubscribes'), spam: sum('spam'), blocked: sum('blocked'),
        },
        blockedAttachments: { available: blockedRows !== null },
        scheduled,
        quota: {
            limit: MAX_SENDS_PER_HOUR,
            windowMinutes: 60,
            topLastHour: lastHour.map((r) => {
                const sentLastHour = num(r.n);
                return {
                    userId: r.id, email: r.email, sentLastHour, limit: MAX_SENDS_PER_HOUR,
                    percent: Math.min(100, Math.round((sentLastHour / MAX_SENDS_PER_HOUR) * 100)),
                };
            }),
            topRange: byRange.map((r) => {
                const sent = num(r.sent);
                const received = num(r.received);
                return { userId: r.id, email: r.email, sent, received, total: sent + received };
            }),
        },
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// Supresion
// ---------------------------------------------------------------------------------------------------------------------
export const SUPPRESSION_REASONS = ['unsubscribe', 'bounce', 'complaint'] as const;
export type SuppressionReasonFilter = (typeof SUPPRESSION_REASONS)[number];

export interface SuppressionRow {
    id: string;
    recipient: string;
    reason: SuppressionReasonFilter;
    createdAt: string | null;
    /** Correo del usuario remitente (puede faltar si el usuario se elimino). */
    senderEmail: string | null;
}

const normReason = (r: unknown): SuppressionReasonFilter => (r === 'bounce' || r === 'complaint' ? r : 'unsubscribe');

export async function listSuppressions(opts: { q?: string; reason?: SuppressionReasonFilter; paging: Paging }): Promise<{ items: SuppressionRow[]; meta: PageMeta }> {
    const params: unknown[] = [];
    const where: string[] = [`ev."type" = 'unsubscribe'`];
    if (opts.reason) {
        params.push(opts.reason);
        where.push(`COALESCE(ev."data"->>'reason', 'unsubscribe') = $${params.length}`);
    }
    if (opts.q) {
        params.push(escapeLike(opts.q));
        const n = params.length;
        where.push(`(ev."data"->>'recipient' ILIKE $${n} ESCAPE '\\' OR u."email" ILIKE $${n} ESCAPE '\\')`);
    }
    const from = `FROM "EmailEvent" ev LEFT JOIN "User" u ON u."id" = ev."data"->>'sender' WHERE ${where.join(' AND ')}`;
    const empty = { items: [] as SuppressionRow[], meta: pageMeta(opts.paging, 0) };
    return tolerant(async () => {
        const totalRows = await query<{ n: unknown }>(`SELECT COUNT(*) AS n ${from}`, ...params);
        const total = num(totalRows[0]?.n);
        const lim = params.length + 1;
        const rows = await query<{ id: string; recipient: string | null; reason: string | null; createdAt: unknown; senderEmail: string | null }>(
            `SELECT ev."id" AS id, ev."data"->>'recipient' AS recipient, ev."data"->>'reason' AS reason, ev."createdAt" AS "createdAt", u."email" AS "senderEmail"
             ${from} ORDER BY ev."createdAt" DESC, ev."id" DESC LIMIT $${lim} OFFSET $${lim + 1}`,
            ...params, opts.paging.pageSize, opts.paging.offset,
        );
        return {
            items: rows.map((r) => ({
                id: r.id, recipient: r.recipient ?? '', reason: normReason(r.reason), createdAt: toIso(r.createdAt), senderEmail: r.senderEmail ?? null,
            })),
            meta: pageMeta(opts.paging, total),
        };
    }, empty);
}

export interface RemovedSuppression {
    id: string;
    recipient: string;
    reason: SuppressionReasonFilter;
    sender: string | null;
}

/** Borra las filas EmailEvent de tipo 'unsubscribe' con esos ids. Devuelve las realmente borradas (datos minimos para auditar). */
export async function removeSuppressions(ids: string[]): Promise<RemovedSuppression[]> {
    const unique = Array.from(new Set(ids));
    if (unique.length === 0) return [];
    const rows = await query<{ id: string; recipient: string | null; reason: string | null; sender: string | null }>(
        `DELETE FROM "EmailEvent" WHERE "type" = 'unsubscribe' AND "id" = ANY($1::text[])
         RETURNING "id" AS id, "data"->>'recipient' AS recipient, "data"->>'reason' AS reason, "data"->>'sender' AS sender`,
        unique,
    );
    return rows.map((r) => ({ id: r.id, recipient: r.recipient ?? '', reason: normReason(r.reason), sender: r.sender ?? null }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Webhooks (solo booleanos y fechas; NUNCA los secretos)
// ---------------------------------------------------------------------------------------------------------------------
export interface WebhookStatus {
    baseUrl: string | null;
    inbound: { path: string; url: string | null; signatureConfigured: boolean; lastReceivedAt: string | null };
    events: { path: string; url: string | null; signatureConfigured: boolean; lastEventAt: string | null };
}

export const INBOUND_WEBHOOK_PATH = '/api/webhooks/resend';
export const EVENTS_WEBHOOK_PATH = '/api/webhooks/resend-events';

export async function getWebhookStatus(env: Record<string, string | undefined> = process.env): Promise<WebhookStatus> {
    const base = (env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
    const baseUrl = /^https?:\/\/[^\s]+$/.test(base) ? base : null;
    const [lastIn, lastEv] = await Promise.all([
        tolerant(() => query<{ at: unknown }>(`SELECT MAX("createdAt") AS at FROM "Email" WHERE "status" = 'received'`), []),
        tolerant(
            () => query<{ at: unknown }>(
                `SELECT MAX("createdAt") AS at FROM "EmailEvent" WHERE "type" = 'unsubscribe' AND "data"->>'reason' IN ('bounce','complaint')`,
            ),
            [],
        ),
    ]);
    return {
        baseUrl,
        inbound: {
            path: INBOUND_WEBHOOK_PATH,
            url: baseUrl ? baseUrl + INBOUND_WEBHOOK_PATH : null,
            signatureConfigured: !!env.WEBHOOK_SECRET,
            lastReceivedAt: toIso(lastIn[0]?.at),
        },
        events: {
            path: EVENTS_WEBHOOK_PATH,
            url: baseUrl ? baseUrl + EVENTS_WEBHOOK_PATH : null,
            signatureConfigured: !!env.RESEND_WEBHOOK_SECRET,
            lastEventAt: toIso(lastEv[0]?.at),
        },
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// Resumen para el panel principal (lo usa el coordinador)
// ---------------------------------------------------------------------------------------------------------------------
export interface MailOverview {
    sentToday: number;
    receivedToday: number;
    bouncesWeek: number;
    complaintsWeek: number;
    elixir: { running: number; pendingRows: number; available: boolean };
    storage: { attachmentBytes: number; attachmentCount: number; emailCount: number };
    scheduled: { pending: number; overdue: number };
}

/** "Hoy" = ultimas 24 h. Tolerante: cada bloque degrada a 0 / available:false si falta su tabla. */
export async function getMailOverview(now: Date = new Date()): Promise<MailOverview> {
    const day = new Date(now.getTime() - DAY).toISOString();
    const week = new Date(now.getTime() - 7 * DAY).toISOString();
    const [today, events, elixir, attachments, emails, scheduled] = await Promise.all([
        tolerant(
            () => query<{ sent: unknown; received: unknown }>(
                `SELECT COUNT(*) FILTER (WHERE ${SENT_FOLDERS_SQL}) AS sent, COUNT(*) FILTER (WHERE "status" = 'received') AS received
                   FROM "Email" WHERE "createdAt" >= $1::timestamptz`,
                day,
            ),
            [],
        ),
        tolerant(
            () => query<{ bounces: unknown; complaints: unknown }>(
                `SELECT COUNT(*) FILTER (WHERE "data"->>'reason' = 'bounce') AS bounces, COUNT(*) FILTER (WHERE "data"->>'reason' = 'complaint') AS complaints
                   FROM "EmailEvent" WHERE "type" = 'unsubscribe' AND "createdAt" >= $1::timestamptz`,
                week,
            ),
            [],
        ),
        getElixirQueue(),
        tolerant(
            () => query<{ bytes: unknown; n: unknown }>(
                `SELECT COALESCE(SUM("size"), 0) AS bytes, COUNT(*) AS n FROM "Attachment" WHERE "key" NOT IN ('BLOCKED', 'PENDING')`,
            ),
            [],
        ),
        tolerant(() => query<{ n: unknown }>(`SELECT COUNT(*) AS n FROM "Email"`), []),
        getScheduledQueue(now),
    ]);
    return {
        sentToday: num(today[0]?.sent),
        receivedToday: num(today[0]?.received),
        bouncesWeek: num(events[0]?.bounces),
        complaintsWeek: num(events[0]?.complaints),
        elixir,
        storage: { attachmentBytes: num(attachments[0]?.bytes), attachmentCount: num(attachments[0]?.n), emailCount: num(emails[0]?.n) },
        scheduled: { pending: scheduled.pending, overdue: scheduled.overdue },
    };
}

async function getElixirQueue(): Promise<MailOverview['elixir']> {
    try {
        const running = await query<{ n: unknown }>(`SELECT COUNT(*) AS n FROM "ElixirCampaign" WHERE "status" = 'running'`);
        const pending = await query<{ n: unknown }>(
            `SELECT COUNT(*) AS n FROM "ElixirCampaignRow" r JOIN "ElixirCampaign" c ON c."id" = r."campaignId"
              WHERE c."status" = 'running' AND r."status" IN ('pending', 'sending')`,
        );
        return { running: num(running[0]?.n), pendingRows: num(pending[0]?.n), available: true };
    } catch (error) {
        if (isMissingRelation(error)) return { running: 0, pendingRows: 0, available: false };
        throw error;
    }
}
