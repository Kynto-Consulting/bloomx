/**
 * store.ts - acceso a datos (SQL crudo parametrizado) de MailTransferJob / MailTransferItem.
 *
 * Tablas aditivas (db:ensure). Las lecturas toleran su ausencia (vacio/null); las escrituras lanzan
 * MailTransferTablesMissingError, que las rutas traducen en 503 `mail_transfer_tables_missing`.
 * Nunca se interpola texto del usuario: solo columnas de una lista blanca y parametros $n.
 */
import { randomUUID } from 'node:crypto';
import { execute, isMissingRelation, num, query, toIso } from '@/lib/admin/sql';

export class MailTransferTablesMissingError extends Error {
    code = 'mail_transfer_tables_missing';
    constructor() {
        super('Las tablas de importacion/exportacion no existen; ejecute db:ensure');
        this.name = 'MailTransferTablesMissingError';
    }
}

async function guarded<T>(fn: () => Promise<T>, onMissing: T | 'throw'): Promise<T> {
    try {
        return await fn();
    } catch (e) {
        if (isMissingRelation(e)) {
            if (onMissing === 'throw') throw new MailTransferTablesMissingError();
            return onMissing;
        }
        throw e;
    }
}

export type JobKind = 'import' | 'export';
export type JobScope = 'domain' | 'mailboxes' | 'self';
export type JobStatus = 'created' | 'uploading' | 'uploaded' | 'analyzing' | 'ready' | 'queued' | 'running' | 'done' | 'failed' | 'canceled' | 'expired';
export const TERMINAL_STATUSES: readonly JobStatus[] = ['done', 'failed', 'canceled', 'expired'];
/** Estados en los que el worker tiene trabajo que hacer. */
export const RUNNABLE_STATUSES: readonly JobStatus[] = ['analyzing', 'queued', 'running'];
/** Estados que cuentan para el tope de trabajos concurrentes. */
export const ACTIVE_STATUSES: readonly JobStatus[] = ['analyzing', 'queued', 'running'];

export interface JobRow {
    id: string;
    userId: string;
    actorKind: string;
    domain: string;
    kind: JobKind;
    scope: JobScope;
    targetUserId: string | null;
    format: string;
    status: JobStatus;
    phase: string;
    fileName: string | null;
    options: Record<string, any>;
    summary: Record<string, any>;
    cursor: Record<string, any>;
    totalBytes: number;
    uploadedBytes: number;
    totalItems: number;
    doneItems: number;
    importedItems: number;
    duplicateItems: number;
    skippedItems: number;
    errorItems: number;
    bytesProcessed: number;
    outputBytes: number;
    outputSha256: string | null;
    lockedUntil: Date | null;
    lastError: string | null;
    cancelRequested: boolean;
    downloadedAt: Date | null;
    expiresAt: Date | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

const JOB_COLS = [
    'id', 'userId', 'actorKind', 'domain', 'kind', 'scope', 'targetUserId', 'format', 'status', 'phase', 'fileName', 'options', 'summary', 'cursor',
    'totalBytes', 'uploadedBytes', 'totalItems', 'doneItems', 'importedItems', 'duplicateItems', 'skippedItems', 'errorItems', 'bytesProcessed',
    'outputBytes', 'outputSha256', 'lockedUntil', 'lastError', 'cancelRequested', 'downloadedAt', 'expiresAt', 'startedAt', 'finishedAt', 'createdAt', 'updatedAt',
] as const;
const JOB_SELECT = JOB_COLS.map((c) => `"${c}"`).join(', ');

const obj = (v: unknown): Record<string, any> => {
    if (typeof v === 'string') { try { const p = JSON.parse(v); return p && typeof p === 'object' ? p : {}; } catch { return {}; } }
    return v && typeof v === 'object' ? (v as Record<string, any>) : {};
};

function mapJob(r: any): JobRow {
    return {
        ...r,
        options: obj(r.options),
        summary: obj(r.summary),
        cursor: obj(r.cursor),
        totalBytes: num(r.totalBytes),
        uploadedBytes: num(r.uploadedBytes),
        totalItems: num(r.totalItems),
        doneItems: num(r.doneItems),
        importedItems: num(r.importedItems),
        duplicateItems: num(r.duplicateItems),
        skippedItems: num(r.skippedItems),
        errorItems: num(r.errorItems),
        bytesProcessed: num(r.bytesProcessed),
        outputBytes: num(r.outputBytes),
        cancelRequested: !!r.cancelRequested,
    };
}

export const newJobId = () => `mtj_${randomUUID().replace(/-/g, '')}`;

export interface NewJob {
    userId: string;
    actorKind: 'user' | 'manager';
    domain: string;
    kind: JobKind;
    scope: JobScope;
    targetUserId?: string | null;
    format?: string;
    status?: JobStatus;
    fileName?: string | null;
    options?: Record<string, unknown>;
    totalBytes?: number;
    expiresAt?: Date | null;
}

export const jobs = {
    create: (input: NewJob) => guarded(async () => {
        const id = newJobId();
        const rows = await query(
            `INSERT INTO "MailTransferJob" ("id","userId","actorKind","domain","kind","scope","targetUserId","format","status","fileName","options","totalBytes","expiresAt")
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13) RETURNING ${JOB_SELECT}`,
            id, input.userId, input.actorKind, input.domain, input.kind, input.scope, input.targetUserId ?? null, input.format ?? 'unknown',
            input.status ?? 'created', input.fileName ?? null, JSON.stringify(input.options ?? {}), input.totalBytes ?? 0, input.expiresAt ?? null,
        );
        return mapJob(rows[0]);
    }, 'throw'),

    /** Lectura SIN comprobar propiedad (uso interno del worker). */
    get: (id: string) => guarded(async () => {
        const rows = await query(`SELECT ${JOB_SELECT} FROM "MailTransferJob" WHERE "id" = $1`, id);
        return rows[0] ? mapJob(rows[0]) : null;
    }, null as JobRow | null),

    /** Propiedad estricta: solo el creador y en el dominio de la instancia. */
    getOwned: (id: string, owner: { userId: string; domain: string }) => guarded(async () => {
        const rows = await query(`SELECT ${JOB_SELECT} FROM "MailTransferJob" WHERE "id" = $1 AND "userId" = $2 AND "domain" = $3`, id, owner.userId, owner.domain);
        return rows[0] ? mapJob(rows[0]) : null;
    }, null as JobRow | null),

    listOwned: (owner: { userId: string; domain: string }, opts: { limit: number; offset: number; kind?: JobKind; scope?: JobScope }) => guarded(async () => {
        const params: unknown[] = [owner.userId, owner.domain];
        let where = `"userId" = $1 AND "domain" = $2`;
        if (opts.kind) { params.push(opts.kind); where += ` AND "kind" = $${params.length}`; }
        if (opts.scope) { params.push(opts.scope); where += ` AND "scope" = $${params.length}`; }
        const total = num((await query<{ n: unknown }>(`SELECT COUNT(*) AS n FROM "MailTransferJob" WHERE ${where}`, ...params))[0]?.n);
        params.push(Math.max(1, Math.trunc(opts.limit)), Math.max(0, Math.trunc(opts.offset)));
        const rows = await query(
            `SELECT ${JOB_SELECT} FROM "MailTransferJob" WHERE ${where} ORDER BY "createdAt" DESC, "id" DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
            ...params,
        );
        return { rows: rows.map(mapJob), total };
    }, { rows: [] as JobRow[], total: 0 }),

    /** Actualiza columnas de una lista blanca. `patch.options/summary/cursor` se guardan como jsonb. */
    update: (id: string, patch: Partial<Record<(typeof UPDATABLE)[number], unknown>>) => guarded(async () => {
        const sets: string[] = [];
        const params: unknown[] = [id];
        for (const key of UPDATABLE) {
            if (!(key in patch)) continue;
            params.push(JSONB.has(key) ? JSON.stringify(patch[key] ?? {}) : patch[key]);
            sets.push(`"${key}" = $${params.length}${JSONB.has(key) ? '::jsonb' : ''}`);
        }
        if (sets.length === 0) return false;
        return (await execute(`UPDATE "MailTransferJob" SET ${sets.join(', ')}, "updatedAt" = NOW() WHERE "id" = $1`, ...params)) > 0;
    }, 'throw'),

    /**
     * Bloquea el trabajo para un worker: solo si esta en uno de `statuses`, sin bloqueo vigente y sin cancelacion pedida.
     * Devuelve la fila o null.
     */
    lock: (id: string, statuses: readonly JobStatus[], lockMs: number) => guarded(async () => {
        const rows = await query(
            `UPDATE "MailTransferJob" SET "lockedUntil" = NOW() + ($3::int * INTERVAL '1 millisecond'), "updatedAt" = NOW()
             WHERE "id" = $1 AND "status" = ANY($2::text[]) AND ("lockedUntil" IS NULL OR "lockedUntil" < NOW())
             RETURNING ${JOB_SELECT}`,
            id, [...statuses], Math.trunc(lockMs),
        );
        return rows[0] ? mapJob(rows[0]) : null;
    }, null as JobRow | null),

    unlock: (id: string) => guarded(async () => {
        await execute(`UPDATE "MailTransferJob" SET "lockedUntil" = NULL WHERE "id" = $1`, id);
    }, undefined),

    /** Prolonga el bloqueo (latido) mientras el worker sigue trabajando. */
    extendLock: (id: string, lockMs: number) => guarded(async () => {
        await execute(`UPDATE "MailTransferJob" SET "lockedUntil" = NOW() + ($2::int * INTERVAL '1 millisecond') WHERE "id" = $1 AND "lockedUntil" IS NOT NULL`, id, Math.trunc(lockMs));
    }, undefined),

    requestCancel: (id: string) => guarded(async () => {
        return (await execute(
            `UPDATE "MailTransferJob" SET "cancelRequested" = TRUE, "updatedAt" = NOW()
             WHERE "id" = $1 AND "status" NOT IN ('done','failed','canceled','expired')`, id)) > 0;
    }, 'throw'),

    /** Trabajos con algo que hacer y sin bloqueo vigente (cron). Los mas antiguos primero. */
    runnable: (limit: number) => guarded(async () => {
        const rows = await query<{ id: string }>(
            `SELECT "id" FROM "MailTransferJob"
             WHERE "status" = ANY($1::text[]) AND ("lockedUntil" IS NULL OR "lockedUntil" < NOW())
             ORDER BY "updatedAt" ASC LIMIT $2`,
            [...RUNNABLE_STATUSES], Math.max(1, Math.trunc(limit)),
        );
        return rows.map((r) => r.id);
    }, [] as string[]),

    countActive: (domain: string) => guarded(async () => {
        const rows = await query<{ n: unknown }>(`SELECT COUNT(*) AS n FROM "MailTransferJob" WHERE "domain" = $1 AND "status" = ANY($2::text[])`, domain, [...ACTIVE_STATUSES]);
        return num(rows[0]?.n);
    }, 0),

    /** Trabajos abandonados o caducados cuyo almacenamiento hay que borrar. */
    expiredForPurge: (limit: number, idleHours = 48) => guarded(async () => {
        const rows = await query(
            `SELECT ${JOB_SELECT} FROM "MailTransferJob"
             WHERE "status" <> 'expired' AND (
                 ("kind" = 'export' AND "status" = 'done' AND "expiresAt" IS NOT NULL AND "expiresAt" < NOW())
                 OR ("status" IN ('created','uploading','uploaded','ready','failed','canceled') AND "updatedAt" < NOW() - ($2::int * INTERVAL '1 hour'))
             )
             ORDER BY "updatedAt" ASC LIMIT $1`,
            Math.max(1, Math.trunc(limit)), Math.trunc(idleHours),
        );
        return rows.map(mapJob);
    }, [] as JobRow[]),

    /** Descarga unica: reclama el archivo. true si esta llamada lo reclamo. */
    claimDownload: (id: string) => guarded(async () => {
        return (await execute(`UPDATE "MailTransferJob" SET "downloadedAt" = NOW(), "updatedAt" = NOW() WHERE "id" = $1 AND "downloadedAt" IS NULL AND "status" = 'done'`, id)) > 0;
    }, 'throw'),
    releaseDownload: (id: string) => guarded(async () => {
        await execute(`UPDATE "MailTransferJob" SET "downloadedAt" = NULL WHERE "id" = $1`, id);
    }, undefined),

    remove: (id: string) => guarded(async () => {
        await execute(`DELETE FROM "MailTransferJob" WHERE "id" = $1`, id);
    }, undefined),
};

const UPDATABLE = [
    'format', 'status', 'phase', 'fileName', 'options', 'summary', 'cursor', 'totalBytes', 'uploadedBytes', 'totalItems', 'doneItems', 'importedItems',
    'duplicateItems', 'skippedItems', 'errorItems', 'bytesProcessed', 'outputBytes', 'outputSha256', 'lastError', 'downloadedAt', 'expiresAt', 'startedAt', 'finishedAt',
    'cancelRequested', 'targetUserId',
] as const;
const JSONB = new Set<string>(['options', 'summary', 'cursor']);

// ---------------------------------------------------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------------------------------------------------

export type ItemStatus = 'pending' | 'imported' | 'duplicate' | 'skipped' | 'error' | 'done';

export interface ItemRow {
    id: number;
    jobId: string;
    mailbox: string;
    sourceKey: string;
    messageId: string | null;
    status: ItemStatus;
    error: string | null;
    emailId: string | null;
    folder: string | null;
    bytes: number;
}

export interface NewItem {
    jobId: string;
    mailbox: string;
    sourceKey: string;
    messageId?: string | null;
    status: ItemStatus;
    error?: string | null;
    emailId?: string | null;
    folder?: string | null;
    bytes?: number;
}

export const items = {
    /** Inserta o, si ya existia (reintento), conserva el resultado definitivo previo. true = fila nueva. */
    record: (it: NewItem) => guarded(async () => {
        const n = await execute(
            `INSERT INTO "MailTransferItem" ("jobId","mailbox","sourceKey","messageId","status","error","emailId","folder","bytes")
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT ("jobId","sourceKey") DO UPDATE SET
               "status" = CASE WHEN "MailTransferItem"."status" IN ('pending','error') THEN EXCLUDED."status" ELSE "MailTransferItem"."status" END,
               "error" = CASE WHEN "MailTransferItem"."status" IN ('pending','error') THEN EXCLUDED."error" ELSE "MailTransferItem"."error" END,
               "emailId" = COALESCE("MailTransferItem"."emailId", EXCLUDED."emailId"),
               "updatedAt" = NOW()
             WHERE "MailTransferItem"."status" IN ('pending','error')`,
            it.jobId, it.mailbox.slice(0, 320), it.sourceKey.slice(0, 200), it.messageId?.slice(0, 500) ?? null, it.status, it.error?.slice(0, 200) ?? null,
            it.emailId ?? null, it.folder ?? null, Math.max(0, Math.trunc(it.bytes ?? 0)),
        );
        return n > 0;
    }, 'throw'),

    get: (jobId: string, sourceKey: string) => guarded(async () => {
        const rows = await query<any>(`SELECT "id","jobId","mailbox","sourceKey","messageId","status","error","emailId","folder","bytes" FROM "MailTransferItem" WHERE "jobId" = $1 AND "sourceKey" = $2`, jobId, sourceKey);
        return rows[0] ? ({ ...rows[0], id: num(rows[0].id), bytes: num(rows[0].bytes) } as ItemRow) : null;
    }, null as ItemRow | null),

    /** Conteo por estado (fuente de verdad de los contadores: idempotente ante ticks repetidos). */
    counts: (jobId: string) => guarded(async () => {
        const rows = await query<{ status: string; n: unknown }>(`SELECT "status", COUNT(*) AS n FROM "MailTransferItem" WHERE "jobId" = $1 GROUP BY "status"`, jobId);
        const out: Record<string, number> = {};
        for (const r of rows) out[r.status] = num(r.n);
        return out;
    }, {} as Record<string, number>),

    /** Por buzon y estado (informe/resumen). */
    countsByMailbox: (jobId: string, limit = 500) => guarded(async () => {
        const rows = await query<{ mailbox: string; status: string; n: unknown }>(
            `SELECT "mailbox", "status", COUNT(*) AS n FROM "MailTransferItem" WHERE "jobId" = $1 GROUP BY "mailbox","status" ORDER BY "mailbox" LIMIT $2`, jobId, limit);
        return rows.map((r) => ({ mailbox: r.mailbox, status: r.status, n: num(r.n) }));
    }, [] as Array<{ mailbox: string; status: string; n: number }>),

    /** Pagina por id para el informe CSV. */
    page: (jobId: string, afterId: number, limit: number) => guarded(async () => {
        const rows = await query<any>(
            `SELECT "id","mailbox","sourceKey","messageId","status","error","folder","bytes" FROM "MailTransferItem" WHERE "jobId" = $1 AND "id" > $2 ORDER BY "id" ASC LIMIT $3`,
            jobId, afterId, Math.max(1, Math.trunc(limit)));
        return rows.map((r) => ({ ...r, id: num(r.id), bytes: num(r.bytes) })) as Array<{ id: number; mailbox: string; sourceKey: string; messageId: string | null; status: ItemStatus; error: string | null; folder: string | null; bytes: number }>;
    }, [] as Array<{ id: number; mailbox: string; sourceKey: string; messageId: string | null; status: ItemStatus; error: string | null; folder: string | null; bytes: number }>),

    /** Primeros errores (para mostrar en la interfaz). */
    errors: (jobId: string, limit = 50) => guarded(async () => {
        const rows = await query<any>(
            `SELECT "mailbox","sourceKey","messageId","error" FROM "MailTransferItem" WHERE "jobId" = $1 AND "status" = 'error' ORDER BY "id" ASC LIMIT $2`, jobId, limit);
        return rows as Array<{ mailbox: string; sourceKey: string; messageId: string | null; error: string | null }>;
    }, [] as Array<{ mailbox: string; sourceKey: string; messageId: string | null; error: string | null }>),
};

export function jobToPublic(j: JobRow) {
    return {
        id: j.id,
        kind: j.kind,
        scope: j.scope,
        format: j.format,
        status: j.status,
        phase: j.phase,
        fileName: j.fileName,
        totalBytes: j.totalBytes,
        uploadedBytes: j.uploadedBytes,
        totalItems: j.totalItems,
        doneItems: j.doneItems,
        importedItems: j.importedItems,
        duplicateItems: j.duplicateItems,
        skippedItems: j.skippedItems,
        errorItems: j.errorItems,
        bytesProcessed: j.bytesProcessed,
        outputBytes: j.outputBytes,
        outputSha256: j.outputSha256,
        lastError: j.lastError,
        cancelRequested: j.cancelRequested,
        downloadable: j.kind === 'export' && j.status === 'done' && !j.downloadedAt,
        downloadedAt: toIso(j.downloadedAt),
        expiresAt: toIso(j.expiresAt),
        startedAt: toIso(j.startedAt),
        finishedAt: toIso(j.finishedAt),
        createdAt: toIso(j.createdAt),
        updatedAt: toIso(j.updatedAt),
        stale: !!j.lockedUntil && j.lockedUntil.getTime() < Date.now(),
        // Opciones NO sensibles (jamas claves, contrasenas ni tokens)
        options: publicOptions(j.options),
        summary: j.summary,
    };
}

const PUBLIC_OPTION_KEYS = ['scopeMode', 'mailboxes', 'folders', 'from', 'to', 'includeAttachments', 'format', 'encrypted', 'oneTime', 'notifyUsers', 'targetMode', 'singleMailbox', 'mailboxMap', 'createMissing', 'mustChangePassword', 'importLabels', 'confirmedAt'];

export function publicOptions(o: Record<string, any>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of PUBLIC_OPTION_KEYS) if (k in o) out[k] = o[k];
    return out;
}
