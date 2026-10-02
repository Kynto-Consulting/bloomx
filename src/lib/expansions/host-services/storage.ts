/**
 * Almacenamiento clave-valor del sandbox de extensiones (`services.storage.*`), lado frontend.
 *
 * Aislamiento por (userId, extensionId): ambos los fija el host (nunca la extension) y TODA consulta los lleva.
 * Cuota TOTAL de 256 KB (claves + valores, en bytes UTF-8) por (userId, extensionId); valor JSON <= 64 KB; maximo de
 * claves por (usuario, extension). La cuota se comprueba de forma ATOMICA: una transaccion con
 * pg_advisory_xact_lock por (userId, extensionId) serializa las escrituras concurrentes del mismo espacio.
 * SQL crudo parametrizado (tabla "ExtensionStorage", ver src/lib/db/schema.ts). Borrar el usuario borra sus filas (FK CASCADE).
 */
import { z } from 'zod';
import { BridgeError, op } from './bridge-route';

export const STORAGE_QUOTA_BYTES = 256 * 1024;
export const STORAGE_MAX_VALUE_BYTES = 64 * 1024;
export const STORAGE_MAX_KEYS = 1000;
/** Prefijo de las claves COMPARTIDAS: legibles por la extension para todo el dominio (listShared), escribibles SOLO desde un hook de servidor. */
export const SHARED_PREFIX = 'shared/';
export const SHARED_MAX_LIMIT = 200;

const key = z.string().regex(/^[A-Za-z0-9_.:\/-]{1,128}$/);

export const storageRequest = z.discriminatedUnion('op', [
    op('get', z.strictObject({ key })),
    op('set', z.strictObject({ key, value: z.unknown() }).refine((a) => 'value' in a && a.value !== undefined, 'value required')),
    op('delete', z.strictObject({ key })),
    op('list', z.strictObject({ prefix: z.string().regex(/^[A-Za-z0-9_.:\/-]{0,128}$/).optional(), limit: z.number().int().min(1).max(100).default(50) }).default({ limit: 50 })),
    // Lectura de las entradas COMPARTIDAS (`shared/...`) que la extension escribio en el espacio de cada usuario del dominio (solo valores, sin userId).
    op('listShared', z.strictObject({ prefix: z.string().regex(/^shared\/[A-Za-z0-9_.:\/-]{0,120}$/), limit: z.number().int().min(1).max(SHARED_MAX_LIMIT).default(100) })),
]);
export type StorageRequest = z.infer<typeof storageRequest>;

export type SetResult = { ok: true; usedBytes: number } | { ok: false; reason: 'quota' | 'too_many_keys' };

/** Persistencia (Postgres en produccion; en memoria en las pruebas unitarias del servicio). */
export interface StorageStore {
    get(userId: string, extensionId: string, key: string): Promise<string | null>;
    /** Upsert atomico respetando la cuota. `bytes` = bytes(clave) + bytes(valor). */
    set(userId: string, extensionId: string, key: string, valueJson: string, bytes: number): Promise<SetResult>;
    delete(userId: string, extensionId: string, key: string): Promise<boolean>;
    list(userId: string, extensionId: string, prefix: string, limit: number): Promise<{ keys: string[]; usedBytes: number }>;
    /** Valores de las claves `shared/...` de TODOS los usuarios para esa extension (orden estable por fecha, usuario y clave). Sin identidad del propietario. */
    listShared(extensionId: string, prefix: string, limit: number): Promise<Array<{ key: string; value: string }>>;
}

// ---------------------------------------------------------------------------------------------------------------
// Implementacion Postgres
// ---------------------------------------------------------------------------------------------------------------
interface Queryable { query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> }
interface PoolLike extends Queryable { connect: () => Promise<Queryable & { release: () => void }> }

export function createPgStorageStore(getPool: () => Promise<PoolLike> | PoolLike): StorageStore {
    const pool = async () => getPool();
    return {
        async get(userId, extensionId, k) {
            const r = await (await pool()).query('SELECT "value" FROM "ExtensionStorage" WHERE "userId" = $1 AND "extensionId" = $2 AND "key" = $3', [userId, extensionId, k]);
            return r.rows[0] ? String(r.rows[0].value) : null;
        },
        async set(userId, extensionId, k, valueJson, bytes) {
            const client = await (await pool()).connect();
            try {
                await client.query('BEGIN');
                // Serializa las escrituras del mismo (usuario, extension): la suma de la cuota no puede verse "vieja".
                await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`ext-storage|${userId}|${extensionId}`]);
                const cur = await client.query(
                    `SELECT COALESCE(SUM("bytes"), 0)::bigint AS used,
                            COALESCE(SUM("bytes") FILTER (WHERE "key" = $3), 0)::bigint AS old,
                            COUNT(*)::int AS n,
                            COUNT(*) FILTER (WHERE "key" = $3)::int AS has
                     FROM "ExtensionStorage" WHERE "userId" = $1 AND "extensionId" = $2`,
                    [userId, extensionId, k],
                );
                const row = cur.rows[0];
                const used = Number(row.used), old = Number(row.old);
                const next = used - old + bytes;
                if (next > STORAGE_QUOTA_BYTES) { await client.query('ROLLBACK'); return { ok: false, reason: 'quota' } as const; }
                if (Number(row.has) === 0 && Number(row.n) >= STORAGE_MAX_KEYS) { await client.query('ROLLBACK'); return { ok: false, reason: 'too_many_keys' } as const; }
                await client.query(
                    `INSERT INTO "ExtensionStorage" ("userId", "extensionId", "key", "value", "bytes", "updatedAt")
                     VALUES ($1, $2, $3, $4, $5, NOW())
                     ON CONFLICT ("userId", "extensionId", "key") DO UPDATE SET "value" = EXCLUDED."value", "bytes" = EXCLUDED."bytes", "updatedAt" = NOW()`,
                    [userId, extensionId, k, valueJson, bytes],
                );
                await client.query('COMMIT');
                return { ok: true, usedBytes: next } as const;
            } catch (e) {
                try { await client.query('ROLLBACK'); } catch { /* conexion ya cerrada */ }
                throw e;
            } finally {
                client.release();
            }
        },
        async delete(userId, extensionId, k) {
            const r = await (await pool()).query('DELETE FROM "ExtensionStorage" WHERE "userId" = $1 AND "extensionId" = $2 AND "key" = $3', [userId, extensionId, k]);
            return (r.rowCount ?? 0) > 0;
        },
        async listShared(extensionId, prefix, limit) {
            const escaped = prefix.replace(/[\\%_]/g, (c) => `\\${c}`);
            const r = await (await pool()).query(
                'SELECT "key", "value" FROM "ExtensionStorage" WHERE "extensionId" = $1 AND "key" LIKE $2 ESCAPE \'\\\' ORDER BY "updatedAt", "userId", "key" LIMIT $3',
                [extensionId, `${escaped}%`, limit],
            );
            return r.rows.map((row) => ({ key: String(row.key), value: String(row.value) }));
        },
        async list(userId, extensionId, prefix, limit) {
            const p = await pool();
            const escaped = prefix.replace(/[\\%_]/g, (c) => `\\${c}`);
            const [keys, used] = await Promise.all([
                p.query('SELECT "key" FROM "ExtensionStorage" WHERE "userId" = $1 AND "extensionId" = $2 AND "key" LIKE $3 ESCAPE \'\\\' ORDER BY "key" LIMIT $4', [userId, extensionId, `${escaped}%`, limit]),
                p.query('SELECT COALESCE(SUM("bytes"), 0)::bigint AS used FROM "ExtensionStorage" WHERE "userId" = $1 AND "extensionId" = $2', [userId, extensionId]),
            ]);
            return { keys: keys.rows.map((r) => String(r.key)), usedBytes: Number(used.rows[0]?.used ?? 0) };
        },
    };
}

export async function defaultStorageStore(): Promise<StorageStore> {
    return createPgStorageStore(async () => (await import('@/lib/db/pool')).getDbPool() as unknown as PoolLike);
}

// ---------------------------------------------------------------------------------------------------------------
// Servicio
// ---------------------------------------------------------------------------------------------------------------
const byteLen = (s: string) => Buffer.byteLength(s, 'utf8');

export async function handleStorage(store: StorageStore, req: StorageRequest, ctx: { grant?: { evt?: string } } = {}): Promise<unknown> {
    const { userId, extensionId } = req;
    // Las claves compartidas solo se escriben desde un hook de servidor: la concesion (firmada por esta instancia) lleva el evento que origino la
    // ejecucion. Un usuario que invoca el handler por /execute no puede anadirse a listas compartidas ni falsificar entradas.
    if ((req.op === 'set' || req.op === 'delete') && req.args.key.startsWith(SHARED_PREFIX) && !ctx.grant?.evt) throw new BridgeError('forbidden');
    switch (req.op) {
        case 'get': {
            const raw = await store.get(userId, extensionId, req.args.key);
            if (raw === null) return { value: null };
            try { return { value: JSON.parse(raw) }; } catch { return { value: null }; }
        }
        case 'set': {
            const valueJson = JSON.stringify(req.args.value);
            if (typeof valueJson !== 'string') throw new BridgeError('invalid_args');
            const valueBytes = byteLen(valueJson);
            if (valueBytes > STORAGE_MAX_VALUE_BYTES) throw new BridgeError('quota_exceeded');
            const bytes = byteLen(req.args.key) + valueBytes;
            const r = await store.set(userId, extensionId, req.args.key, valueJson, bytes);
            if (!r.ok) throw new BridgeError('quota_exceeded');
            return { ok: true, usedBytes: r.usedBytes, quotaBytes: STORAGE_QUOTA_BYTES };
        }
        case 'delete':
            return { deleted: await store.delete(userId, extensionId, req.args.key) };
        case 'listShared': {
            const rows = await store.listShared(extensionId, req.args.prefix, req.args.limit);
            const items: Array<{ key: string; value: unknown }> = [];
            for (const row of rows) {
                try { items.push({ key: row.key, value: JSON.parse(row.value) }); } catch { /* valor corrupto: se omite */ }
            }
            return { items };
        }
        case 'list': {
            const r = await store.list(userId, extensionId, req.args.prefix ?? '', req.args.limit);
            return { keys: r.keys, usedBytes: r.usedBytes, quotaBytes: STORAGE_QUOTA_BYTES };
        }
    }
}
