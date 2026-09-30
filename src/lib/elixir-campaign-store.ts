/**
 * elixir-campaign-store.ts — acceso a datos (SQL crudo, Postgres) de plantillas y campanas de Elixir.
 * Las tablas ElixirTemplate / ElixirCampaign / ElixirCampaignRow son nuevas y aditivas (db:ensure): las lecturas
 * toleran su ausencia (devuelven vacio/null) y las escrituras lanzan `ElixirTablesMissingError`, que las rutas
 * traducen en 503 `elixir_tables_missing`. NO probado contra Postgres real en esta ronda.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isMissingRelation } from '@/lib/rules/store';
import {
    countsFromGroups, emptyCounts, type CampaignCounts, type CampaignOptions, type CampaignRecord, type CampaignRowStatus,
    type CampaignStatus, type ClassifiedRow, type SenderConfigStored,
} from '@/lib/elixir-campaigns';
import type { CampaignStore, ClaimedRow, RowPatch } from '@/lib/elixir-worker';

export class ElixirTablesMissingError extends Error {
    constructor() { super('Las tablas de Elixir no existen; ejecute db:ensure'); this.name = 'ElixirTablesMissingError'; }
}

async function guarded<T>(fn: () => Promise<T>, onMissing: T | 'throw'): Promise<T> {
    try { return await fn(); }
    catch (e) {
        if (isMissingRelation(e)) {
            if (onMissing === 'throw') throw new ElixirTablesMissingError();
            return onMissing;
        }
        throw e;
    }
}

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;

// ── Plantillas ───────────────────────────────────────────────────────────────

export interface TemplateRecord {
    id: string; userId: string; name: string; subject: string; body: string;
    senderConfig: SenderConfigStored; createdAt: Date; updatedAt: Date;
}
export interface TemplateInput { name: string; subject: string; body: string; senderConfig: SenderConfigStored }

const TPL_COLS = Prisma.raw('"id","userId","name","subject","body","senderConfig","createdAt","updatedAt"');

function mapTemplate(r: any): TemplateRecord {
    return { ...r, senderConfig: r.senderConfig && typeof r.senderConfig === 'object' ? r.senderConfig : {} };
}

export const templates = {
    list: (userId: string) => guarded(async () => {
        const rows: any[] = await prisma.$queryRaw`SELECT ${TPL_COLS} FROM "ElixirTemplate" WHERE "userId" = ${userId} ORDER BY "updatedAt" DESC, "id" DESC LIMIT 500`;
        return rows.map(mapTemplate);
    }, [] as TemplateRecord[]),

    get: (userId: string, id: string) => guarded(async () => {
        const rows: any[] = await prisma.$queryRaw`SELECT ${TPL_COLS} FROM "ElixirTemplate" WHERE "id" = ${id} AND "userId" = ${userId}`;
        return rows[0] ? mapTemplate(rows[0]) : null;
    }, null as TemplateRecord | null),

    count: (userId: string) => guarded(async () => {
        const rows: any[] = await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM "ElixirTemplate" WHERE "userId" = ${userId}`;
        return Number(rows[0]?.n ?? 0);
    }, 0),

    /** null = nombre duplicado. */
    create: (userId: string, input: TemplateInput) => guarded(async () => {
        const id = newId('etp');
        const rows: any[] = await prisma.$queryRaw`
            INSERT INTO "ElixirTemplate" ("id","userId","name","subject","body","senderConfig")
            VALUES (${id}, ${userId}, ${input.name}, ${input.subject}, ${input.body}, ${JSON.stringify(input.senderConfig)}::jsonb)
            ON CONFLICT ("userId","name") DO NOTHING
            RETURNING ${TPL_COLS}`;
        return rows[0] ? mapTemplate(rows[0]) : null;
    }, 'throw'),

    /** 'duplicate' si el nombre choca con otra plantilla; null si no existe. */
    update: (userId: string, id: string, input: TemplateInput) => guarded(async (): Promise<TemplateRecord | null | 'duplicate'> => {
        const clash: any[] = await prisma.$queryRaw`SELECT "id" FROM "ElixirTemplate" WHERE "userId" = ${userId} AND "name" = ${input.name} AND "id" <> ${id}`;
        if (clash.length) return 'duplicate';
        const rows: any[] = await prisma.$queryRaw`
            UPDATE "ElixirTemplate" SET "name" = ${input.name}, "subject" = ${input.subject}, "body" = ${input.body},
                "senderConfig" = ${JSON.stringify(input.senderConfig)}::jsonb, "updatedAt" = CURRENT_TIMESTAMP
            WHERE "id" = ${id} AND "userId" = ${userId}
            RETURNING ${TPL_COLS}`;
        return rows[0] ? mapTemplate(rows[0]) : null;
    }, 'throw'),

    remove: (userId: string, id: string) => guarded(async () => {
        const n = await prisma.$executeRaw`DELETE FROM "ElixirTemplate" WHERE "id" = ${id} AND "userId" = ${userId}`;
        return n > 0;
    }, false),
};

// ── Campanas ─────────────────────────────────────────────────────────────────

const CAMP_COLS = Prisma.raw('"id","userId","name","status","subject","template","senderConfig","options","total","lockedUntil","lastError","startedAt","finishedAt","createdAt","updatedAt"');

function mapCampaign(r: any): CampaignRecord {
    return {
        ...r,
        senderConfig: r.senderConfig && typeof r.senderConfig === 'object' ? r.senderConfig : {},
        options: r.options && typeof r.options === 'object' ? r.options : { recipientColumn: '' },
        total: Number(r.total) || 0,
    };
}

export interface NewCampaign {
    name: string; subject: string; template: string; senderConfig: SenderConfigStored; options: CampaignOptions;
}

export const campaigns = {
    create: (userId: string, input: NewCampaign) => guarded(async () => {
        const id = newId('ecp');
        const rows: any[] = await prisma.$queryRaw`
            INSERT INTO "ElixirCampaign" ("id","userId","name","status","subject","template","senderConfig","options")
            VALUES (${id}, ${userId}, ${input.name}, 'draft', ${input.subject}, ${input.template},
                    ${JSON.stringify(input.senderConfig)}::jsonb, ${JSON.stringify(input.options)}::jsonb)
            RETURNING ${CAMP_COLS}`;
        return mapCampaign(rows[0]);
    }, 'throw'),

    get: (userId: string, id: string) => guarded(async () => {
        const rows: any[] = await prisma.$queryRaw`SELECT ${CAMP_COLS} FROM "ElixirCampaign" WHERE "id" = ${id} AND "userId" = ${userId}`;
        return rows[0] ? mapCampaign(rows[0]) : null;
    }, null as CampaignRecord | null),

    list: (userId: string, limit = 50, offset = 0) => guarded(async () => {
        const rows: any[] = await prisma.$queryRaw`
            SELECT ${CAMP_COLS} FROM "ElixirCampaign" WHERE "userId" = ${userId}
            ORDER BY "createdAt" DESC, "id" DESC LIMIT ${limit} OFFSET ${offset}`;
        return rows.map(mapCampaign);
    }, [] as CampaignRecord[]),

    counts: (campaignId: string) => guarded(async (): Promise<CampaignCounts> => {
        const groups: any[] = await prisma.$queryRaw`
            SELECT "status", COUNT(*)::int AS n FROM "ElixirCampaignRow" WHERE "campaignId" = ${campaignId} GROUP BY "status"`;
        return countsFromGroups(groups);
    }, emptyCounts()),

    countsFor: (campaignIds: string[]) => guarded(async (): Promise<Record<string, CampaignCounts>> => {
        const out: Record<string, CampaignCounts> = {};
        if (campaignIds.length === 0) return out;
        const groups: any[] = await prisma.$queryRaw`
            SELECT "campaignId", "status", COUNT(*)::int AS n FROM "ElixirCampaignRow"
            WHERE "campaignId" IN (${Prisma.join(campaignIds)}) GROUP BY "campaignId", "status"`;
        const byId = new Map<string, any[]>();
        for (const g of groups) { const a = byId.get(g.campaignId) ?? []; a.push(g); byId.set(g.campaignId, a); }
        for (const id of campaignIds) out[id] = countsFromGroups(byId.get(id) ?? []);
        return out;
    }, {} as Record<string, CampaignCounts>),

    remove: (userId: string, id: string) => guarded(async () => {
        const n = await prisma.$executeRaw`DELETE FROM "ElixirCampaign" WHERE "id" = ${id} AND "userId" = ${userId} AND "status" <> 'running'`;
        return n > 0;
    }, false),

    /** Actualiza el estado solo si sigue en `from` (evita carreras entre pausa/cancelacion/worker). */
    transition: (userId: string, id: string, from: CampaignStatus[], to: CampaignStatus) => guarded(async () => {
        const startedSet = to === 'running' ? Prisma.sql`, "startedAt" = COALESCE("startedAt", CURRENT_TIMESTAMP), "finishedAt" = NULL, "lastError" = NULL` : Prisma.empty;
        const finishedSet = to === 'cancelled' || to === 'done' || to === 'failed' ? Prisma.sql`, "finishedAt" = CURRENT_TIMESTAMP` : Prisma.empty;
        const n = await prisma.$executeRaw`
            UPDATE "ElixirCampaign" SET "status" = ${to}, "updatedAt" = CURRENT_TIMESTAMP ${startedSet} ${finishedSet}
            WHERE "id" = ${id} AND "userId" = ${userId} AND "status" IN (${Prisma.join(from)})`;
        return n > 0;
    }, 'throw'),

    /** Recalcula `total` como el numero de filas cargadas. */
    syncTotal: (id: string) => guarded(async () => {
        await prisma.$executeRaw`
            UPDATE "ElixirCampaign" SET "total" = (SELECT COUNT(*) FROM "ElixirCampaignRow" WHERE "campaignId" = ${id}), "updatedAt" = CURRENT_TIMESTAMP
            WHERE "id" = ${id}`;
    }, 'throw'),

    /** Filas en error -> pending (reintento). Usa la misma clave de idempotencia: no duplica lo ya aceptado por Resend. */
    requeueErrors: (id: string) => guarded(async () => {
        return Number(await prisma.$executeRaw`
            UPDATE "ElixirCampaignRow" SET "status" = 'pending', "attempts" = 0, "nextAttemptAt" = CURRENT_TIMESTAMP, "message" = NULL, "code" = NULL, "updatedAt" = CURRENT_TIMESTAMP
            WHERE "campaignId" = ${id} AND "status" = 'error' AND "recipient" IS NOT NULL`);
    }, 'throw'),

    /** Ids de campanas `running` con filas listas (para el cron). */
    runnable: (limit: number) => guarded(async () => {
        const rows: any[] = await prisma.$queryRaw`
            SELECT c."id" FROM "ElixirCampaign" c
            WHERE c."status" = 'running' AND (c."lockedUntil" IS NULL OR c."lockedUntil" < CURRENT_TIMESTAMP)
              AND EXISTS (
                  SELECT 1 FROM "ElixirCampaignRow" r WHERE r."campaignId" = c."id" AND (
                      (r."status" = 'pending' AND r."nextAttemptAt" <= CURRENT_TIMESTAMP)
                      OR (r."status" = 'sending' AND r."updatedAt" < CURRENT_TIMESTAMP - INTERVAL '5 minutes')))
            ORDER BY c."updatedAt" ASC LIMIT ${limit}`;
        return rows.map(r => r.id as string);
    }, [] as string[]),
};

// ── Filas ────────────────────────────────────────────────────────────────────

export interface RowView {
    idx: number; email: string; status: CampaignRowStatus; attempts: number; message: string | null; code: string | null; sentAt: Date | null; updatedAt: Date;
}

export const rows = {
    /** Destinatarios (minusculas) ya aceptados en la campana, para marcar duplicados entre trozos. */
    existingRecipients: (campaignId: string, candidates: string[]) => guarded(async () => {
        if (candidates.length === 0) return new Set<string>();
        const found: any[] = await prisma.$queryRaw`
            SELECT "recipient" FROM "ElixirCampaignRow" WHERE "campaignId" = ${campaignId} AND "recipient" IN (${Prisma.join(candidates)})`;
        return new Set<string>(found.map(f => String(f.recipient)));
    }, 'throw'),

    insertChunk: (campaignId: string, items: Array<ClassifiedRow & { data: Record<string, string> }>) => guarded(async () => {
        if (items.length === 0) return 0;
        const json = JSON.stringify(items.map(i => ({
            idx: i.index, email: i.email, recipient: i.recipient, data: i.data, status: i.status, message: i.message, code: i.code,
        })));
        return Number(await prisma.$executeRaw`
            INSERT INTO "ElixirCampaignRow" ("campaignId","idx","email","recipient","data","status","message","code")
            SELECT ${campaignId}, x."idx", x."email", x."recipient", x."data", x."status", x."message", x."code"
            FROM jsonb_to_recordset(${json}::jsonb) AS x("idx" int, "email" text, "recipient" text, "data" jsonb, "status" text, "message" text, "code" text)
            ON CONFLICT DO NOTHING`);
    }, 'throw'),

    page: (campaignId: string, status: CampaignRowStatus | null, limit: number, offset: number) => guarded(async () => {
        const where = status ? Prisma.sql`AND "status" = ${status}` : Prisma.empty;
        const found: any[] = await prisma.$queryRaw`
            SELECT "idx","email","status","attempts","message","code","sentAt","updatedAt" FROM "ElixirCampaignRow"
            WHERE "campaignId" = ${campaignId} ${where} ORDER BY "idx" ASC LIMIT ${limit} OFFSET ${offset}`;
        return found as RowView[];
    }, [] as RowView[]),
};

// ── Implementacion de CampaignStore (worker) ─────────────────────────────────

export const pgCampaignStore: CampaignStore = {
    async lockCampaign(id, lockUntil, now) {
        const found: any[] = await prisma.$queryRaw`
            UPDATE "ElixirCampaign" SET "lockedUntil" = ${lockUntil}, "updatedAt" = CURRENT_TIMESTAMP
            WHERE "id" = ${id} AND "status" = 'running' AND ("lockedUntil" IS NULL OR "lockedUntil" < ${now})
            RETURNING ${CAMP_COLS}`;
        return found[0] ? mapCampaign(found[0]) : null;
    },
    async unlockCampaign(id) {
        await prisma.$executeRaw`UPDATE "ElixirCampaign" SET "lockedUntil" = NULL WHERE "id" = ${id}`;
    },
    async getStatus(id) {
        const found: any[] = await prisma.$queryRaw`SELECT "status" FROM "ElixirCampaign" WHERE "id" = ${id}`;
        return found[0]?.status ?? null;
    },
    async reclaimStaleRows(id, staleBefore) {
        return Number(await prisma.$executeRaw`
            UPDATE "ElixirCampaignRow" SET "status" = 'pending', "updatedAt" = CURRENT_TIMESTAMP
            WHERE "campaignId" = ${id} AND "status" = 'sending' AND "updatedAt" < ${staleBefore}`);
    },
    async claimRows(id, limit, now) {
        const found: any[] = await prisma.$queryRaw`
            UPDATE "ElixirCampaignRow" r SET "status" = 'sending', "attempts" = r."attempts" + 1, "updatedAt" = CURRENT_TIMESTAMP
            WHERE r."campaignId" = ${id} AND r."idx" IN (
                SELECT "idx" FROM "ElixirCampaignRow"
                WHERE "campaignId" = ${id} AND "status" = 'pending' AND "nextAttemptAt" <= ${now}
                ORDER BY "idx" ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED)
            RETURNING r."idx", r."email", r."recipient", r."data", r."attempts"`;
        return (found as any[]).map((r): ClaimedRow => ({
            idx: Number(r.idx), email: r.email, recipient: r.recipient,
            data: r.data && typeof r.data === 'object' ? r.data : {}, attempts: Number(r.attempts),
        })).sort((a, b) => a.idx - b.idx);
    },
    async markRow(id, idx, patch: RowPatch) {
        await prisma.$executeRaw`
            UPDATE "ElixirCampaignRow" SET
                "status" = ${patch.status},
                "message" = ${patch.message ?? null},
                "code" = ${patch.code ?? null},
                "resendEmailId" = COALESCE(${patch.resendEmailId ?? null}, "resendEmailId"),
                "sentAt" = COALESCE(${patch.sentAt ?? null}::timestamptz, "sentAt"),
                "nextAttemptAt" = COALESCE(${patch.nextAttemptAt ?? null}::timestamptz, "nextAttemptAt"),
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE "campaignId" = ${id} AND "idx" = ${idx}`;
    },
    async releaseRows(id, idxs) {
        if (idxs.length === 0) return;
        await prisma.$executeRaw`
            UPDATE "ElixirCampaignRow" SET "status" = 'pending', "attempts" = GREATEST("attempts" - 1, 0), "updatedAt" = CURRENT_TIMESTAMP
            WHERE "campaignId" = ${id} AND "status" = 'sending' AND "idx" IN (${Prisma.join(idxs)})`;
    },
    async countSentSince(userId, since) {
        const found: any[] = await prisma.$queryRaw`
            SELECT COUNT(*)::int AS n FROM "ElixirCampaignRow" r JOIN "ElixirCampaign" c ON c."id" = r."campaignId"
            WHERE c."userId" = ${userId} AND r."sentAt" > ${since}`;
        return Number(found[0]?.n ?? 0);
    },
    async countRemaining(id, now) {
        const found: any[] = await prisma.$queryRaw`
            SELECT
                COUNT(*) FILTER (WHERE "status" = 'pending' AND "nextAttemptAt" <= ${now})::int AS ready,
                COUNT(*) FILTER (WHERE "status" = 'pending')::int AS pending,
                COUNT(*) FILTER (WHERE "status" = 'sending')::int AS sending
            FROM "ElixirCampaignRow" WHERE "campaignId" = ${id}`;
        const r = found[0] ?? {};
        return { ready: Number(r.ready ?? 0), pending: Number(r.pending ?? 0), sending: Number(r.sending ?? 0) };
    },
    async finishCampaign(id, status, lastError) {
        await prisma.$executeRaw`
            UPDATE "ElixirCampaign" SET "status" = ${status}, "finishedAt" = CURRENT_TIMESTAMP, "lastError" = ${lastError ?? null}, "updatedAt" = CURRENT_TIMESTAMP
            WHERE "id" = ${id} AND "status" = 'running'`;
    },
    async setLastError(id, message) {
        await prisma.$executeRaw`UPDATE "ElixirCampaign" SET "lastError" = ${message} WHERE "id" = ${id}`;
    },
};

/** Actualiza una fila por id de Resend (eventos de entrega). Devuelve la fila resuelta con su usuario. */
export async function findRowByResendId(resendEmailId: string): Promise<{ campaignId: string; idx: number; userId: string; recipient: string | null; status: string } | null> {
    return guarded(async () => {
        const found: any[] = await prisma.$queryRaw`
            SELECT r."campaignId", r."idx", r."recipient", r."status", c."userId"
            FROM "ElixirCampaignRow" r JOIN "ElixirCampaign" c ON c."id" = r."campaignId"
            WHERE r."resendEmailId" = ${resendEmailId} LIMIT 1`;
        return found[0] ? { campaignId: found[0].campaignId, idx: Number(found[0].idx), userId: found[0].userId, recipient: found[0].recipient, status: found[0].status } : null;
    }, null);
}

/** Cambia el estado de una fila enviada (bounced/complained) o anota un aviso (delayed) sin cambiar estado. Idempotente. */
export async function markRowDelivery(campaignId: string, idx: number, status: 'bounced' | 'complained' | null, message: string, code: string): Promise<void> {
    await guarded(async () => {
        if (status) {
            // Solo se degrada desde sent/bounced/complained: nunca se pisa unsubscribed/error.
            await prisma.$executeRaw`
                UPDATE "ElixirCampaignRow" SET "status" = ${status}, "message" = ${message}, "code" = ${code}, "updatedAt" = CURRENT_TIMESTAMP
                WHERE "campaignId" = ${campaignId} AND "idx" = ${idx} AND "status" IN ('sent','bounced','complained')`;
        } else {
            await prisma.$executeRaw`
                UPDATE "ElixirCampaignRow" SET "message" = ${message}, "code" = ${code}, "updatedAt" = CURRENT_TIMESTAMP
                WHERE "campaignId" = ${campaignId} AND "idx" = ${idx} AND "status" = 'sent'`;
        }
    }, undefined as void);
}
