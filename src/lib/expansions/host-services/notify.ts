/**
 * Notificaciones (toasts) de extensiones (`services.notify.toast`), lado frontend.
 *
 * `toast` solo PERSISTE la notificacion en "ExtensionNotification" (id, userId, extensionId, level, title, message, url,
 * createdAt, deliveredAt). La entrega la hace GET /api/expansions/notifications (sesion del usuario), que las devuelve y las
 * marca entregadas; el hook de cliente las muestra con el toast de la app.
 * Limites: 20 pendientes por (usuario, extension) (comprobado con lock de asesor: exacto bajo concurrencia) y 30/min
 * por (usuario, extension) => 429 rate_limited. El texto se sanea (sin controles) y la url debe ser segura (safeToastUrl).
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { stripControlChars } from '@/lib/mail-validation';
import { BridgeError, op } from './bridge-route';
import { MAX_TOAST_URL_LENGTH, safeToastUrl } from './notify-url';

export const NOTIFY_MAX_PENDING = 20;
export const NOTIFY_PER_MINUTE = 30;
export const NOTIFY_LEVELS = ['info', 'success', 'warning', 'error'] as const;

export const notifyRequest = z.discriminatedUnion('op', [
    op('toast', z.strictObject({
        message: z.string().min(1).max(200),
        title: z.string().max(80).optional(),
        level: z.enum(NOTIFY_LEVELS).default('info'),
        url: z.string().max(MAX_TOAST_URL_LENGTH).refine((u) => safeToastUrl(u) !== null, 'unsafe url').optional(),
    })),
]);
export type NotifyRequest = z.infer<typeof notifyRequest>;

export interface ExtensionNotificationRow {
    id: string;
    extensionId: string;
    level: (typeof NOTIFY_LEVELS)[number];
    title: string | null;
    message: string;
    url: string | null;
    createdAt: string;
}

export interface NewNotification {
    id: string; userId: string; extensionId: string; level: string; title: string | null; message: string; url: string | null;
}

export interface NotifyStore {
    /** Inserta si el (usuario, extension) tiene menos de `maxPending` pendientes (atomico). false = tope alcanzado. */
    enqueue(n: NewNotification, maxPending: number): Promise<boolean>;
    /** Devuelve hasta `limit` pendientes del usuario (mas antiguas primero) y las marca entregadas. */
    takePending(userId: string, limit: number): Promise<ExtensionNotificationRow[]>;
}

interface Queryable { query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> }
interface PoolLike extends Queryable { connect: () => Promise<Queryable & { release: () => void }> }

const toIso = (d: unknown) => (d instanceof Date ? d.toISOString() : new Date(String(d)).toISOString());

export function createPgNotifyStore(getPool: () => Promise<PoolLike> | PoolLike): NotifyStore {
    return {
        async enqueue(n, maxPending) {
            const client = await (await getPool()).connect();
            try {
                await client.query('BEGIN');
                await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`ext-notify|${n.userId}|${n.extensionId}`]);
                const c = await client.query(
                    'SELECT COUNT(*)::int AS n FROM "ExtensionNotification" WHERE "userId" = $1 AND "extensionId" = $2 AND "deliveredAt" IS NULL',
                    [n.userId, n.extensionId],
                );
                if (Number(c.rows[0].n) >= maxPending) { await client.query('ROLLBACK'); return false; }
                await client.query(
                    `INSERT INTO "ExtensionNotification" ("id", "userId", "extensionId", "level", "title", "message", "url")
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [n.id, n.userId, n.extensionId, n.level, n.title, n.message, n.url],
                );
                await client.query('COMMIT');
                return true;
            } catch (e) {
                try { await client.query('ROLLBACK'); } catch { /* conexion ya cerrada */ }
                throw e;
            } finally {
                client.release();
            }
        },
        async takePending(userId, limit) {
            const pool = await getPool();
            const r = await pool.query(
                `UPDATE "ExtensionNotification" SET "deliveredAt" = NOW()
                 WHERE "id" IN (
                     SELECT "id" FROM "ExtensionNotification"
                     WHERE "userId" = $1 AND "deliveredAt" IS NULL
                     ORDER BY "createdAt" ASC, "id" ASC LIMIT $2 FOR UPDATE SKIP LOCKED
                 )
                 RETURNING "id", "extensionId", "level", "title", "message", "url", "createdAt"`,
                [userId, limit],
            );
            return r.rows
                .map((x) => ({
                    id: String(x.id), extensionId: String(x.extensionId), level: x.level, title: x.title ?? null,
                    message: String(x.message), url: x.url ?? null, createdAt: toIso(x.createdAt),
                }))
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
        },
    };
}

export async function defaultNotifyStore(): Promise<NotifyStore> {
    return createPgNotifyStore(async () => (await import('@/lib/db/pool')).getDbPool() as unknown as PoolLike);
}

export interface NotifyDeps {
    store: NotifyStore;
    rateLimit: (key: string, limit: number, windowMs: number) => Promise<{ ok: boolean; retryAfter: number }>;
    newId?: () => string;
}

export async function defaultNotifyDeps(): Promise<NotifyDeps> {
    const [store, { rateLimitAsync }] = await Promise.all([defaultNotifyStore(), import('@/lib/security')]);
    return { store, rateLimit: rateLimitAsync };
}

export async function handleNotify(deps: NotifyDeps, req: NotifyRequest): Promise<unknown> {
    const a = req.args;
    const message = stripControlChars(a.message).slice(0, 200);
    if (!message) throw new BridgeError('invalid_args');
    const title = a.title ? stripControlChars(a.title).slice(0, 80) || null : null;
    const url = a.url ? safeToastUrl(a.url) : null;

    const rl = await deps.rateLimit(`ext-notify:${req.userId}:${req.extensionId}`, NOTIFY_PER_MINUTE, 60_000);
    if (!rl.ok) throw new BridgeError('rate_limited', rl.retryAfter);

    const ok = await deps.store.enqueue(
        { id: (deps.newId ?? randomUUID)(), userId: req.userId, extensionId: req.extensionId, level: a.level, title, message, url },
        NOTIFY_MAX_PENDING,
    );
    if (!ok) throw new BridgeError('rate_limited', 30);
    return { delivered: true };
}
