import { ensureDatabaseSchema } from '@/lib/db/schema';
import { execute, isMissingRelation, query, tolerant } from './sql';

/**
 * Favoritas (estrellas) del marketplace de extensiones: POR administrador de la instancia (nunca globales), en la BD de la instancia
 * (tabla aditiva "ExtensionStar"(userId, extensionId, createdAt), DDL idempotente en lib/db/schema.ts). SQL parametrizado y tolerante
 * a que la tabla aun no exista (lectura => vacio; escritura => se crea y se reintenta una vez).
 */

export const EXTENSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
/** Tope de favoritas por administrador (evita crecimiento sin limite; el catalogo tiene decenas de extensiones). */
export const MAX_STARS_PER_USER = 200;

export class StarLimitError extends Error {
    constructor() {
        super('star_limit');
    }
}

export async function listStars(userId: string): Promise<string[]> {
    if (!userId) return [];
    const rows = await tolerant(
        () => query<{ extensionId: string }>(`SELECT "extensionId" FROM "ExtensionStar" WHERE "userId" = $1 ORDER BY "createdAt" ASC, "extensionId" ASC LIMIT ${MAX_STARS_PER_USER}`, userId),
        [] as Array<{ extensionId: string }>,
    );
    return rows.map((r) => r.extensionId);
}

async function write(userId: string, extensionId: string, starred: boolean): Promise<void> {
    if (starred) {
        // El tope se aplica solo a altas NUEVAS (volver a marcar una ya marcada es idempotente).
        await execute(
            `INSERT INTO "ExtensionStar" ("userId","extensionId")
             SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM "ExtensionStar" WHERE "userId" = $1 AND "extensionId" = $2)
                OR (SELECT COUNT(*) FROM "ExtensionStar" WHERE "userId" = $1) < ${MAX_STARS_PER_USER}
             ON CONFLICT ("userId","extensionId") DO NOTHING`,
            userId, extensionId,
        );
        const rows = await query<{ n: number | bigint }>(`SELECT COUNT(*) AS n FROM "ExtensionStar" WHERE "userId" = $1 AND "extensionId" = $2`, userId, extensionId);
        if (Number(rows[0]?.n ?? 0) === 0) throw new StarLimitError();
    } else {
        await execute(`DELETE FROM "ExtensionStar" WHERE "userId" = $1 AND "extensionId" = $2`, userId, extensionId);
    }
}

/** Marca/desmarca. Devuelve la lista actualizada de favoritas del administrador. */
export async function setStar(userId: string, extensionId: string, starred: boolean): Promise<string[]> {
    if (!userId || !EXTENSION_ID_RE.test(extensionId)) throw new Error('invalid_star');
    try {
        await write(userId, extensionId, starred);
    } catch (error) {
        if (!isMissingRelation(error)) throw error;
        await ensureDatabaseSchema();
        await write(userId, extensionId, starred);
    }
    return listStars(userId);
}
