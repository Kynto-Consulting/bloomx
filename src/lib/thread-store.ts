// Persistencia de los hilos por cabeceras (Email.rfcMessageId / inReplyTo / refs / threadKey). SQL crudo y TOLERANTE: si las columnas aun no
// existen (despliegue sin db:ensure) todo devuelve "sin cambios" y la interfaz sigue agrupando con la clave heuristica heredada.
//
// Algoritmo (pure: lib/threading.ts, ThreadIndex):
//   1. se guardan las cabeceras del correo;
//   2. se buscan los hilos vecinos (mensajes con alguno de los Message-ID citados, hijos que lo citan, hilos cuya raiz es una referencia);
//   3. se cargan TODOS los miembros de esos hilos, se recalcula la particion con el indice en memoria y se actualiza por SQL en lote el
//      threadKey de los miembros cuya clave cambia (fusion de hilos cuando llega el mensaje que une dos componentes).
import { execute, isMissingRelation, query } from '@/lib/admin/sql';
import {
    FALLBACK_WINDOW_MS,
    MAX_THREAD_MESSAGES,
    ThreadIndex,
    isGroupableSubject,
    legacyThreadKey,
    messageNeedsFallback,
    normalizeSubject,
    participantsOf,
    pickFallbackCandidate,
    serializeRefs,
    type ThreadHeaders,
    type ThreadMsg,
} from '@/lib/threading';
import { NORMALIZED_SUBJECT_LATERAL, THREAD_KEY_SQL } from '@/lib/mail-list-sql';
import { packRefs, unpackRefs, type InboundThreadInfo } from '@/lib/thread-headers';

export interface ThreadDb {
    query: <T = Record<string, unknown>>(sql: string, ...params: unknown[]) => Promise<T[]>;
    execute: (sql: string, ...params: unknown[]) => Promise<number>;
}

export const defaultThreadDb: ThreadDb = { query, execute };

interface Row {
    id: string;
    rfcMessageId: string | null;
    inReplyTo: string | null;
    refs: string | null;
    threadKey: string | null;
    createdAt: Date | string;
    subject: string | null;
    from: string | null;
    to: string | null;
    cc: string | null;
    cleanTo: string | null;
}

const ROW_COLS = `"id", "rfcMessageId", "inReplyTo", "refs", "threadKey", "createdAt", "subject", "from", "to", "cc", "cleanTo"`;
const MEMBER_LIMIT = MAX_THREAD_MESSAGES * 3;

function rowToMsg(row: Row, own: string[]): ThreadMsg {
    const { refs, hints } = unpackRefs(row.refs);
    return {
        id: row.id,
        mid: row.rfcMessageId,
        inReplyTo: row.inReplyTo,
        refs,
        hints,
        date: new Date(row.createdAt).getTime() || 0,
        subject: row.subject,
        participants: participantsOf({ from: row.from, to: row.to, cc: row.cc }, own),
        key: row.threadKey,
    };
}

function escapeLike(s: string): string {
    return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface AssignInput {
    userId: string;
    emailId: string;
    headers: ThreadHeaders & { hints?: string[] };
    /** Fecha del correo (createdAt), ms. */
    date: number;
    subject: string | null;
    from?: string | null;
    to?: string | null;
    cc?: string | null;
    /** Direcciones del propietario del buzon (para calcular los participantes externos). */
    own: string[];
    /** No aplicar el respaldo por asunto (List-Id, Auto-Submitted, Precedence: bulk). */
    noFallback?: boolean;
    /** Fuerza la clave inicial (p. ej. un reenvio enviado por nosotros que se agrupa con el original). */
    joinKey?: string | null;
}

export interface AssignResult {
    /** Clave asignada al correo; null si las columnas no existen o hubo un error tolerado. */
    key: string | null;
    /** Miembros de otros hilos cuya clave cambio (fusion). */
    merged: number;
    /** Como se unio: 'headers' | 'fallback' | 'key' | 'none'. */
    link: string;
}

/** Guarda las cabeceras y calcula/actualiza el threadKey del correo y, si une hilos, el de sus miembros. Nunca lanza por columnas ausentes. */
export async function assignThread(input: AssignInput, db: ThreadDb = defaultThreadDb): Promise<AssignResult> {
    const none: AssignResult = { key: null, merged: 0, link: 'none' };
    try {
        const { userId, emailId, headers } = input;
        const hints = headers.hints ?? [];
        const refsText = packRefs(headers.refs, hints) ?? '';
        try {
            await db.execute(
                `UPDATE "Email" SET "rfcMessageId" = $3, "inReplyTo" = $4, "refs" = $5 WHERE "id" = $1 AND "userId" = $2`,
                emailId, userId, headers.messageId, headers.inReplyTo, refsText,
            );
        } catch (e) {
            if (isMissingRelation(e)) return none;
            throw e;
        }

        const ids = [headers.messageId, headers.inReplyTo, ...headers.refs].filter((x): x is string => Boolean(x));
        const idSet = Array.from(new Set(ids));
        const treeKeys = idSet.map((i) => `m:${i}`);

        // 1) claves de los hilos vecinos
        const keys = new Set<string>();
        if (input.joinKey) keys.add(input.joinKey);
        if (idSet.length > 0) {
            const near = await db.query<{ threadKey: string }>(
                `SELECT DISTINCT "threadKey" FROM "Email"
                 WHERE "userId" = $1 AND "id" <> $2 AND "threadKey" IS NOT NULL
                   AND ("rfcMessageId" = ANY($3::text[]) OR "threadKey" = ANY($4::text[]) OR ($5::text IS NOT NULL AND "inReplyTo" = $5::text))
                 LIMIT ${MAX_THREAD_MESSAGES}`,
                userId, emailId, idSet, treeKeys, headers.messageId,
            );
            near.forEach((r) => r.threadKey && keys.add(r.threadKey));
        }
        // Pistas (Thread-Index): solo si no hay ningun vecino por Message-ID (la busqueda no usa indice)
        if (keys.size === 0 && hints.length > 0) {
            const byHint = await db.query<{ threadKey: string }>(
                `SELECT DISTINCT "threadKey" FROM "Email" WHERE "userId" = $1 AND "id" <> $2 AND "threadKey" IS NOT NULL AND "refs" LIKE ANY($3::text[]) LIMIT 50`,
                userId, emailId, hints.map((h) => `%${escapeLike(h)}%`),
            );
            byHint.forEach((r) => r.threadKey && keys.add(r.threadKey));
        }

        const self: ThreadMsg = {
            id: emailId,
            mid: headers.messageId,
            inReplyTo: headers.inReplyTo,
            refs: headers.refs,
            hints,
            date: input.date,
            subject: input.subject,
            participants: participantsOf({ from: input.from, to: input.to, cc: input.cc }, input.own),
            noFallback: input.noFallback,
        };

        // 2) respaldo por asunto + participantes (solo si no hay ningun hilo vecino y el mensaje lo necesita)
        let fallbackKey: string | null = null;
        if (keys.size === 0 && !input.noFallback && messageNeedsFallback(self)) {
            const norm = normalizeSubject(input.subject);
            if (isGroupableSubject(norm)) {
                const from = new Date(input.date - FALLBACK_WINDOW_MS);
                const to = new Date(input.date + FALLBACK_WINDOW_MS);
                const cands = await db.query<Row>(
                    `SELECT ${ROW_COLS} FROM "Email"
                     WHERE "userId" = $1 AND "id" <> $2 AND "createdAt" BETWEEN $3 AND $4 AND "subject" ILIKE $5
                     ORDER BY "createdAt" DESC LIMIT 300`,
                    userId, emailId, from, to, `%${escapeLike(norm)}%`,
                );
                const msgs = cands.map((r) => ({ ...rowToMsg(r, input.own), key: r.threadKey || legacyThreadKey({ id: r.id, subject: r.subject, to: r.to, cleanTo: r.cleanTo }) }));
                const match = pickFallbackCandidate(self, msgs);
                if (match) fallbackKey = match.key;
            }
        }
        if (fallbackKey) keys.add(fallbackKey);

        // 3) miembros de todos esos hilos + el propio correo -> particion -> actualizar lo que cambie
        const memberRows = keys.size > 0 || idSet.length > 0
            ? await db.query<Row>(
                `SELECT ${ROW_COLS} FROM "Email"
                 WHERE "userId" = $1 AND "id" <> $2
                   AND ("threadKey" = ANY($3::text[]) OR "rfcMessageId" = ANY($4::text[]) OR ($5::text IS NOT NULL AND "inReplyTo" = $5::text))
                 LIMIT ${MEMBER_LIMIT}`,
                userId, emailId, Array.from(keys), idSet, headers.messageId,
            )
            : [];
        const index = new ThreadIndex();
        for (const r of memberRows) index.add(rowToMsg(r, input.own));
        // Con respaldo, el correo hereda la clave del candidato: el ancla de clave lo une con sus miembros
        index.add({ ...self, key: input.joinKey ?? fallbackKey ?? null });
        const key = index.keyOf(emailId);

        const stale = new Map<string, string[]>();
        const legacyChanged = new Set<string>();
        for (const r of memberRows) {
            const k = index.keyOf(r.id);
            if (r.threadKey !== k) (stale.get(k) ?? stale.set(k, []).get(k)!).push(r.id);
            if (r.threadKey && r.threadKey.startsWith('h:') && r.threadKey !== k) legacyChanged.add(r.threadKey);
        }
        if (fallbackKey?.startsWith('h:') && fallbackKey !== key) legacyChanged.add(fallbackKey);

        await db.execute(`UPDATE "Email" SET "threadKey" = $3 WHERE "id" = $1 AND "userId" = $2`, emailId, userId, key);
        let merged = 0;
        for (const [k, list] of stale) {
            for (let i = 0; i < list.length; i += 500) {
                merged += await db.execute(`UPDATE "Email" SET "threadKey" = $3 WHERE "userId" = $1 AND "id" = ANY($2::text[])`, userId, list.slice(i, i + 500), k);
            }
        }
        // Grupos heredados (sin threadKey) cuya clave heuristica se fusiono con otra: se les da la clave nueva por SQL en lote
        for (const oldKey of legacyChanged) merged += await materializeLegacyKey(userId, oldKey, key, db);
        return { key, merged, link: fallbackKey ? 'fallback' : index.links.get(emailId) ?? 'none' };
    } catch (error) {
        if (isMissingRelation(error)) return none;
        console.error('[thread-store] assignThread fallo (se ignora, el correo ya esta guardado):', (error as Error)?.message);
        return none;
    }
}

/** Da `newKey` a los correos SIN threadKey cuya clave heuristica heredada es `oldKey` (un grupo heredado que un hilo por cabeceras absorbe). */
export async function materializeLegacyKey(userId: string, oldKey: string, newKey: string, db: ThreadDb = defaultThreadDb): Promise<number> {
    if (!oldKey.startsWith('h:') || oldKey === newKey) return 0;
    return db.execute(
        `UPDATE "Email" SET "threadKey" = $3 WHERE "userId" = $1 AND "threadKey" IS NULL AND "id" IN (
           SELECT e."id" FROM "Email" e ${NORMALIZED_SUBJECT_LATERAL}
           WHERE e."userId" = $1 AND e."threadKey" IS NULL AND ${THREAD_KEY_SQL} = $2
         )`,
        userId, oldKey, newKey,
    );
}

/** Convierte lo recibido en las cabeceras del correo (para `assignThread`). */
export function headersOfInbound(info: InboundThreadInfo): ThreadHeaders & { hints: string[] } {
    return { messageId: info.messageId, inReplyTo: info.inReplyTo, refs: info.refs, hints: info.hints };
}

/** Cabeceras ya guardadas de un correo (para responder): Message-ID propio, padre y References. null si la columna no existe o no hay datos. */
export async function loadStoredThreadHeaders(emailId: string, db: ThreadDb = defaultThreadDb): Promise<{ userId: string; rfcMessageId: string | null; inReplyTo: string | null; refs: string[]; threadKey: string | null } | null> {
    try {
        const rows = await db.query<{ userId: string; rfcMessageId: string | null; inReplyTo: string | null; refs: string | null; threadKey: string | null }>(
            `SELECT "userId", "rfcMessageId", "inReplyTo", "refs", "threadKey" FROM "Email" WHERE "id" = $1`, emailId,
        );
        const r = rows[0];
        if (!r) return null;
        return { userId: r.userId, rfcMessageId: r.rfcMessageId, inReplyTo: r.inReplyTo, refs: unpackRefs(r.refs).refs, threadKey: r.threadKey };
    } catch (e) {
        if (isMissingRelation(e)) return null;
        throw e;
    }
}

/** Ids de los correos de un hilo (para el lector). Vacio si el correo no tiene threadKey (correo antiguo: se usa el respaldo por asunto). */
export async function loadThreadMemberIds(userId: string, threadKey: string, db: ThreadDb = defaultThreadDb): Promise<string[]> {
    try {
        const rows = await db.query<{ id: string }>(
            `SELECT "id" FROM "Email" WHERE "userId" = $1 AND "threadKey" = $2 ORDER BY "createdAt" DESC, "id" DESC LIMIT ${MAX_THREAD_MESSAGES}`, userId, threadKey,
        );
        return rows.map((r) => r.id);
    } catch (e) {
        if (isMissingRelation(e)) return [];
        throw e;
    }
}

export { serializeRefs };
