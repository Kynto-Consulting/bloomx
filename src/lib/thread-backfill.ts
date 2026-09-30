// Relleno PEREZOSO y seguro de las cabeceras de hilo de los correos antiguos (invocable desde el cron y desde scripts/backfill-threads.ts).
//
// Por cada lote (mas antiguos primero, para que los originales existan antes que sus respuestas) lee las cabeceras de:
//   1. raw.eml (MIME original que guarda process-attachments),
//   2. raw.json (payload del webhook: data.headers + data.message_id),
//   3. Email.rawMimeUrl (descarga segura con timeout y sin hosts privados, ver raw-mime.ts), solo si `remote` esta activado,
// y llama a assignThread. Los correos sin ninguna cabecera utilizable se marcan (refs = '') para no reintentarlos: siguen agrupandose
// con la clave heuristica heredada. Nunca escribe si las columnas no existen y nunca borra nada.
import { isMissingRelation, query } from '@/lib/admin/sql';
import { rawEmlKey, createRawMimeFetcher, type RawMimeFetcher } from '@/lib/raw-mime';
import { assignThread, defaultThreadDb, headersOfInbound, type ThreadDb } from '@/lib/thread-store';
import { threadInfoFromRawMime, threadInfoFromWebhookPayload, type InboundThreadInfo } from '@/lib/thread-headers';

export interface BackfillDeps {
    db: ThreadDb;
    getText: (key: string) => Promise<string | null>;
    getBuffer: (key: string) => Promise<Buffer | null>;
    fetchRemote: RawMimeFetcher | null;
    /** Direcciones del propietario (participantes externos). */
    ownOf: (userId: string) => Promise<string[]>;
}

export interface BackfillResult {
    scanned: number;
    /** Correos a los que se les encontraron cabeceras de hilo y se les asigno threadKey. */
    assigned: number;
    /** Correos sin cabeceras utilizables (marcados, siguen con la heuristica heredada). */
    unusable: number;
    /** Pendientes de procesar despues de este lote (estimacion exacta). */
    remaining: number;
}

interface PendingRow {
    id: string;
    rawKey: string | null;
    rawMimeUrl: string | null;
    createdAt: Date | string;
    subject: string | null;
    from: string | null;
    to: string | null;
    cc: string | null;
    folder: string;
}

const PENDING_WHERE = `"userId" = $1 AND "refs" IS NULL AND "threadKey" IS NULL AND "rfcMessageId" IS NULL`;

async function defaultDeps(): Promise<BackfillDeps> {
    const storage = await import('@/lib/storage');
    const { prisma } = await import('@/lib/prisma');
    return {
        db: defaultThreadDb,
        getText: async (key) => { try { const v = await storage.getFromStorage(key); return v ?? null; } catch { return null; } },
        getBuffer: async (key) => { try { return await storage.getBufferFromStorage(key); } catch { return null; } },
        fetchRemote: createRawMimeFetcher(),
        ownOf: async (userId) => {
            const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, accounts: { select: { providerAccountId: true } } } });
            if (!u) return [];
            return [u.email, ...u.accounts.map((a) => a.providerAccountId || '')].map((s) => s.trim().toLowerCase()).filter((s) => s.includes('@'));
        },
    };
}

async function infoOf(row: PendingRow, deps: BackfillDeps): Promise<InboundThreadInfo | null> {
    const usable = (i: InboundThreadInfo | null): i is InboundThreadInfo => Boolean(i && (i.messageId || i.inReplyTo || i.refs.length > 0 || i.hints.length > 0));
    const eml = rawEmlKey(row.rawKey);
    if (eml) {
        const buf = await deps.getBuffer(eml);
        if (buf && buf.length > 0) {
            const info = threadInfoFromRawMime(buf.subarray(0, 256 * 1024));
            if (usable(info)) return info;
        }
    }
    let fromPayload: InboundThreadInfo | null = null;
    if (row.rawKey) {
        const text = await deps.getText(row.rawKey);
        if (text) {
            try { fromPayload = threadInfoFromWebhookPayload(JSON.parse(text)); } catch { fromPayload = null; }
        }
    }
    // El payload de Resend solo trae message_id; con In-Reply-To/References ya basta y se evita descargar el MIME
    if (fromPayload && (fromPayload.inReplyTo || fromPayload.refs.length > 0)) return fromPayload;
    if (deps.fetchRemote && row.rawMimeUrl) {
        const buf = await deps.fetchRemote(row.rawMimeUrl);
        if (buf && buf.length > 0) {
            const info = threadInfoFromRawMime(buf.subarray(0, 256 * 1024));
            if (usable(info)) return info;
        }
    }
    return fromPayload;
}

/**
 * Procesa hasta `batch` correos del buzon `userId` que aun no tienen cabeceras de hilo. Idempotente y acotado (un lote por llamada).
 * `remote: false` evita cualquier descarga (solo almacenamiento propio).
 */
export async function backfillThreadHeaders(userId: string, batch = 50, opts: { remote?: boolean; deps?: Partial<BackfillDeps> } = {}): Promise<BackfillResult> {
    const base = await defaultDeps();
    const deps: BackfillDeps = { ...base, ...(opts.deps ?? {}) };
    if (opts.remote === false) deps.fetchRemote = null;
    const limit = Math.max(1, Math.min(500, Math.floor(batch) || 50));
    const result: BackfillResult = { scanned: 0, assigned: 0, unusable: 0, remaining: 0 };
    try {
        const rows = await deps.db.query<PendingRow>(
            `SELECT "id", "rawKey", "rawMimeUrl", "createdAt", "subject", "from", "to", "cc", "folder" FROM "Email"
             WHERE ${PENDING_WHERE} ORDER BY "createdAt" ASC, "id" ASC LIMIT ${limit}`, userId,
        );
        const own = rows.length > 0 ? await deps.ownOf(userId) : [];
        for (const row of rows) {
            result.scanned += 1;
            let info: InboundThreadInfo | null = null;
            try { info = await infoOf(row, deps); } catch { info = null; }
            if (!info || !(info.messageId || info.inReplyTo || info.refs.length > 0 || info.hints.length > 0)) {
                await deps.db.execute(`UPDATE "Email" SET "refs" = '' WHERE "id" = $1 AND "userId" = $2 AND "refs" IS NULL`, row.id, userId);
                result.unusable += 1;
                continue;
            }
            const res = await assignThread({
                userId, emailId: row.id, headers: headersOfInbound(info), date: new Date(row.createdAt).getTime() || 0,
                subject: row.subject, from: row.from, to: row.to, cc: row.cc, own,
                noFallback: info.autoSubmitted || info.bulk || Boolean(info.listId),
            }, deps.db);
            if (res.key) result.assigned += 1;
            else {
                // columnas ausentes u otro error tolerado: no se marca (se reintentara)
                result.scanned -= 1;
            }
        }
        const rem = await deps.db.query<{ n: number | bigint }>(`SELECT COUNT(*)::int AS n FROM "Email" WHERE ${PENDING_WHERE}`, userId);
        result.remaining = Number(rem[0]?.n ?? 0);
    } catch (error) {
        if (!isMissingRelation(error)) console.error('[thread-backfill] fallo:', (error as Error)?.message);
    }
    return result;
}

/** Usuarios con correos pendientes de relleno (para el cron global). */
export async function usersWithPendingThreads(limit = 20): Promise<string[]> {
    try {
        const rows = await query<{ userId: string }>(
            `SELECT DISTINCT "userId" FROM "Email" WHERE "refs" IS NULL AND "threadKey" IS NULL AND "rfcMessageId" IS NULL LIMIT ${Math.max(1, Math.min(200, limit))}`,
        );
        return rows.map((r) => r.userId);
    } catch (error) {
        if (isMissingRelation(error)) return [];
        throw error;
    }
}

/**
 * Asegura las cabeceras de hilo de UN correo (p. ej. antes de responderle): si nunca se procesaron, las lee del MIME/payload guardado.
 * Devuelve las cabeceras guardadas (o null si no hay columnas / el correo no existe).
 */
export async function ensureThreadHeaders(emailId: string, opts: { remote?: boolean; deps?: Partial<BackfillDeps> } = {}) {
    const { loadStoredThreadHeaders } = await import('@/lib/thread-store');
    const base = await defaultDeps();
    const deps: BackfillDeps = { ...base, ...(opts.deps ?? {}) };
    const before = await loadStoredThreadHeaders(emailId, deps.db);
    if (!before || before.rfcMessageId) return before;
    try {
        const rows = await deps.db.query<PendingRow & { userId: string; refs: string | null }>(
            `SELECT "id", "userId", "refs", "rawKey", "rawMimeUrl", "createdAt", "subject", "from", "to", "cc", "folder" FROM "Email" WHERE "id" = $1`, emailId,
        );
        const row = rows[0];
        if (!row || row.refs !== null) return before; // ya procesado (sin cabeceras utilizables)
        if (opts.remote === false) deps.fetchRemote = null;
        const info = await infoOf(row, deps);
        if (!info || !(info.messageId || info.inReplyTo || info.refs.length > 0 || info.hints.length > 0)) {
            await deps.db.execute(`UPDATE "Email" SET "refs" = '' WHERE "id" = $1 AND "refs" IS NULL`, emailId);
            return loadStoredThreadHeaders(emailId, deps.db);
        }
        await assignThread({
            userId: row.userId, emailId, headers: headersOfInbound(info), date: new Date(row.createdAt).getTime() || 0,
            subject: row.subject, from: row.from, to: row.to, cc: row.cc, own: await deps.ownOf(row.userId),
            noFallback: info.autoSubmitted || info.bulk || Boolean(info.listId),
        }, deps.db);
    } catch (error) {
        if (!isMissingRelation(error)) console.error('[thread-backfill] ensureThreadHeaders fallo:', (error as Error)?.message);
    }
    return loadStoredThreadHeaders(emailId, deps.db);
}
