/**
 * Estado de vistas de los mensajes sellados en la tabla aditiva "SecureMessageMeta" (DDL en lib/db/schema.ts).
 *
 * La cuenta es un UPDATE atomico condicionado en Postgres:
 *   UPDATE ... SET views = views + 1 WHERE id = $1 AND (maxViews IS NULL OR views < maxViews) AND expiresAt > now() RETURNING ...
 * Postgres serializa las filas concurrentes: con N lecturas simultaneas y maxViews=M hay exactamente M exitos, sin
 * depender de la memoria de ningun proceso (varias instancias serverless comparten la BD).
 *
 * TOLERANCIA: si la tabla aun no existe (BD sin `db:ensure`) o la BD falla, cada operacion devuelve `unavailable` y el
 * almacen cae al comportamiento anterior (cuenta dentro del objeto, con cerrojo en memoria).
 */

/** Subconjunto de PrismaClient que usamos (tagged templates crudos). */
export interface RawDb {
    $queryRaw: (strings: TemplateStringsArray, ...values: any[]) => Promise<any>;
}

export interface MetaRow { views: number; maxViews: number | null; expiresAt: Date }

export type MetaConsume =
    | { status: 'ok'; views: number; maxViews: number | null; expiresAt: Date }
    | { status: 'exhausted' } // existe pero agotado o caducado
    | { status: 'none' } // no hay fila (mensaje anterior a la tabla)
    | { status: 'unavailable' };

export interface MetaStore {
    insert(input: { id: string; userId: string; maxViews: number | null; expiresAt: Date }): Promise<'ok' | 'unavailable'>;
    /** Lectura sin contar. */
    peek(id: string): Promise<{ status: 'ok'; row: MetaRow & { expired: boolean } } | { status: 'none' } | { status: 'unavailable' }>;
    /** Cuenta UNA vista de forma atomica. */
    consume(id: string): Promise<MetaConsume>;
}

export function isMissingTable(e: unknown): boolean {
    const msg = String((e as any)?.message || e || '');
    const code = String((e as any)?.code || (e as any)?.meta?.code || '');
    return code === '42P01' || /relation "?SecureMessageMeta"? does not exist/i.test(msg) || /\b42P01\b/.test(msg);
}

export function createMetaStore(db: RawDb, onError: (e: unknown) => void = () => {}): MetaStore {
    const guard = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
        try { return await fn(); } catch (e) {
            if (!isMissingTable(e)) onError(e);
            return fallback;
        }
    };
    return {
        insert: ({ id, userId, maxViews, expiresAt }) => guard(async () => {
            await db.$queryRaw`INSERT INTO "SecureMessageMeta" ("id","userId","maxViews","expiresAt") VALUES (${id}, ${userId}, ${maxViews}::int, ${expiresAt}::timestamptz)`;
            // Limpieza oportunista de filas caducadas hace mas de 1 dia (el objeto ya lo barre la retencion).
            try { await db.$queryRaw`DELETE FROM "SecureMessageMeta" WHERE "expiresAt" < now() - interval '1 day'`; } catch { /* best effort */ }
            return 'ok' as const;
        }, 'unavailable' as const),

        peek: (id) => guard<any>(async () => {
            const rows: any[] = await db.$queryRaw`SELECT "views","maxViews","expiresAt", ("expiresAt" <= now()) AS "expired" FROM "SecureMessageMeta" WHERE "id" = ${id}`;
            if (!rows.length) return { status: 'none' };
            const r = rows[0];
            return { status: 'ok', row: { views: Number(r.views), maxViews: r.maxViews === null ? null : Number(r.maxViews), expiresAt: new Date(r.expiresAt), expired: !!r.expired } };
        }, { status: 'unavailable' }),

        consume: (id) => guard<MetaConsume>(async () => {
            const rows: any[] = await db.$queryRaw`
                UPDATE "SecureMessageMeta" SET "views" = "views" + 1
                WHERE "id" = ${id} AND ("maxViews" IS NULL OR "views" < "maxViews") AND "expiresAt" > now()
                RETURNING "views","maxViews","expiresAt"`;
            if (rows.length) {
                const r = rows[0];
                return { status: 'ok', views: Number(r.views), maxViews: r.maxViews === null ? null : Number(r.maxViews), expiresAt: new Date(r.expiresAt) };
            }
            const exists: any[] = await db.$queryRaw`SELECT 1 AS "x" FROM "SecureMessageMeta" WHERE "id" = ${id}`;
            return exists.length ? { status: 'exhausted' } : { status: 'none' };
        }, { status: 'unavailable' }),
    };
}
