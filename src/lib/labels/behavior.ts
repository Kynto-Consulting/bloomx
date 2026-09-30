/**
 * Comportamiento de las etiquetas sobre la carpeta del correo (servidor, SQL parametrizado).
 *
 *  - 'tag'    (estilo Gmail):   el correo conserva su carpeta y gana la etiqueta.
 *  - 'folder' (estilo Outlook): al asignarla el correo sale de Entrada (folder='archive', previousFolder='inbox'; la etiqueta
 *             es su ubicacion visible). Al quitarla vuelve a Entrada, salvo que siga en otra etiqueta-carpeta.
 *
 * Todas las sentencias exigen que la etiqueta pertenezca al MISMO usuario que el correo (anti-IDOR) y solo tocan
 * correos de los buzones `userIds` indicados. Son idempotentes: repetirlas deja el mismo estado.
 */
import { prisma } from '@/lib/prisma';

type Db = Pick<typeof prisma, '$queryRawUnsafe' | '$executeRawUnsafe'>;

/** Correos en estas carpetas pueden ser movidos explicitamente a una etiqueta-carpeta ("Mover a..."). */
export const MOVABLE_TO_LABEL_FOLDER = ['inbox', 'archive', 'trash', 'spam', 'snoozed'] as const;

const dedupe = (a: string[]) => Array.from(new Set(a));

/** true si alguna de las etiquetas es de tipo carpeta (y del usuario). */
export async function anyFolderLabel(userId: string, labelIds: string[], db: Db = prisma): Promise<boolean> {
    if (labelIds.length === 0) return false;
    const rows: Array<{ n: number }> = await db.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS n FROM "Label" WHERE "id" = ANY($1::text[]) AND "userId" = $2 AND "behavior" = 'folder'`, dedupe(labelIds), userId);
    return (rows[0]?.n ?? 0) > 0;
}

function isMissingBehaviorColumn(e: unknown): boolean {
    return /42703|"?behavior"? does not exist/i.test(`${(e as any)?.code ?? ''} ${(e as any)?.meta?.code ?? ''} ${(e as any)?.message ?? ''}`);
}

/**
 * Tras ANADIR etiquetas a correos: los que estaban en Entrada y recibieron alguna etiqueta-carpeta salen de Entrada.
 * Devuelve cuantos correos cambiaron de carpeta.
 */
export async function afterLabelsAdded(userIds: string[], emailIds: string[], labelIds: string[], db: Db = prisma): Promise<number> {
    const ids = dedupe(emailIds);
    const labels = dedupe(labelIds);
    if (ids.length === 0 || labels.length === 0 || userIds.length === 0) return 0;
    try {
        const n = await db.$executeRawUnsafe(
            `UPDATE "Email" SET "previousFolder" = "folder", "folder" = 'archive'
             WHERE "id" = ANY($1::text[]) AND "userId" = ANY($2::text[]) AND "folder" = 'inbox'
               AND EXISTS (SELECT 1 FROM "Label" l WHERE l."id" = ANY($3::text[]) AND l."userId" = "Email"."userId" AND l."behavior" = 'folder')`,
            ids, userIds, labels);
        return Number(n);
    } catch (e) {
        if (isMissingBehaviorColumn(e)) return 0; // BD sin migrar: todo es 'tag'
        throw e;
    }
}

/**
 * Tras QUITAR etiquetas: los correos que estaban fuera de Entrada solo por una etiqueta-carpeta (folder='archive' con origen
 * 'inbox') y ya no tienen ninguna etiqueta-carpeta vuelven a Entrada. `removedLabelIds` = las etiquetas que se quitaron.
 */
export async function afterLabelsRemoved(userIds: string[], emailIds: string[], removedLabelIds: string[], db: Db = prisma): Promise<number> {
    const ids = dedupe(emailIds);
    const removed = dedupe(removedLabelIds);
    if (ids.length === 0 || removed.length === 0 || userIds.length === 0) return 0;
    try {
        const n = await db.$executeRawUnsafe(
            `UPDATE "Email" e SET "folder" = 'inbox', "previousFolder" = NULL
             WHERE e."id" = ANY($1::text[]) AND e."userId" = ANY($2::text[]) AND e."folder" = 'archive' AND e."previousFolder" = 'inbox'
               AND EXISTS (SELECT 1 FROM "Label" l WHERE l."id" = ANY($3::text[]) AND l."userId" = e."userId" AND l."behavior" = 'folder')
               AND NOT EXISTS (SELECT 1 FROM "_EmailToLabel" el JOIN "Label" l2 ON l2."id" = el."B" WHERE el."A" = e."id" AND l2."behavior" = 'folder')`,
            ids, userIds, removed);
        return Number(n);
    } catch (e) {
        if (isMissingBehaviorColumn(e)) return 0;
        throw e;
    }
}

/**
 * "Mover a" una etiqueta-carpeta: el correo deja sus otras etiquetas-carpeta, gana esta y sale de Entrada/Archivo/Papelera/Spam.
 * Con una etiqueta 'tag' solo se anade la etiqueta. Devuelve los ids de correo afectados.
 */
export async function moveEmailsToLabel(userIds: string[], emailIds: string[], labelId: string): Promise<{ moved: string[]; behavior: 'tag' | 'folder' } | null> {
    const ids = dedupe(emailIds);
    if (ids.length === 0 || userIds.length === 0) return null;
    return prisma.$transaction(async (tx) => {
        const db = tx as unknown as Db;
        type LabelInfo = Array<{ userId: string; behavior: string }>;
        let label: LabelInfo;
        try {
            label = await db.$queryRawUnsafe<LabelInfo>(`SELECT "userId", COALESCE("behavior",'tag') AS "behavior" FROM "Label" WHERE "id" = $1`, labelId);
        } catch (e) {
            if (!isMissingBehaviorColumn(e)) throw e;
            label = await db.$queryRawUnsafe<LabelInfo>(`SELECT "userId", 'tag' AS "behavior" FROM "Label" WHERE "id" = $1`, labelId);
        }
        const owner = label[0]?.userId;
        if (!owner || !userIds.includes(owner)) return null;
        const behavior = label[0].behavior === 'folder' ? 'folder' : 'tag';
        // Solo correos del propietario de la etiqueta (y de los buzones permitidos).
        const owned: Array<{ id: string }> = await db.$queryRawUnsafe(
            `SELECT "id" FROM "Email" WHERE "id" = ANY($1::text[]) AND "userId" = $2 AND "userId" = ANY($3::text[])`, ids, owner, userIds);
        const target = owned.map((r) => r.id);
        if (target.length === 0) return { moved: [], behavior };
        if (behavior === 'folder') {
            await db.$executeRawUnsafe(
                `DELETE FROM "_EmailToLabel" WHERE "A" = ANY($1::text[]) AND "B" <> $2
                   AND "B" IN (SELECT "id" FROM "Label" WHERE "userId" = $3 AND "behavior" = 'folder')`, target, labelId, owner);
        }
        await db.$executeRawUnsafe(
            `INSERT INTO "_EmailToLabel" ("A","B") SELECT x, $2 FROM unnest($1::text[]) AS x ON CONFLICT DO NOTHING`, target, labelId);
        if (behavior === 'folder') {
            await db.$executeRawUnsafe(
                `UPDATE "Email" SET
                    "previousFolder" = CASE WHEN "folder" <> 'archive' THEN "folder" ELSE "previousFolder" END,
                    "scheduledAt" = CASE WHEN "folder" = 'snoozed' THEN NULL ELSE "scheduledAt" END,
                    "folder" = 'archive'
                 WHERE "id" = ANY($1::text[]) AND "userId" = $2 AND "folder" = ANY($3::text[])`,
                target, owner, [...MOVABLE_TO_LABEL_FOLDER]);
        }
        return { moved: target, behavior };
    }, { timeout: 20_000 });
}

/** Correos que vuelven a Entrada porque su unica etiqueta-carpeta es alguna de `labelIds` (borrado o cambio a 'tag'). */
export async function releaseFolderEmails(userId: string, labelIds: string[], db: Db = prisma): Promise<number> {
    const labels = dedupe(labelIds);
    if (labels.length === 0) return 0;
    try {
        const n = await db.$executeRawUnsafe(
            `UPDATE "Email" e SET "folder" = 'inbox', "previousFolder" = NULL
             WHERE e."userId" = $1 AND e."folder" = 'archive' AND e."previousFolder" = 'inbox'
               AND EXISTS (SELECT 1 FROM "_EmailToLabel" el WHERE el."A" = e."id" AND el."B" = ANY($2::text[]))
               AND NOT EXISTS (SELECT 1 FROM "_EmailToLabel" el2 JOIN "Label" l ON l."id" = el2."B"
                               WHERE el2."A" = e."id" AND l."behavior" = 'folder' AND NOT (l."id" = ANY($2::text[])))`,
            userId, labels);
        return Number(n);
    } catch (e) {
        if (isMissingBehaviorColumn(e)) return 0;
        throw e;
    }
}

/** Al convertir una etiqueta en 'folder' con "mover existentes": los correos de Entrada con la etiqueta salen de Entrada. */
export async function pullExistingIntoFolder(userId: string, labelId: string, db: Db = prisma): Promise<number> {
    const n = await db.$executeRawUnsafe(
        `UPDATE "Email" e SET "previousFolder" = e."folder", "folder" = 'archive'
         WHERE e."userId" = $1 AND e."folder" = 'inbox'
           AND EXISTS (SELECT 1 FROM "_EmailToLabel" el WHERE el."A" = e."id" AND el."B" = $2)`, userId, labelId);
    return Number(n);
}

/**
 * Un correo que vuelve a Entrada por una accion explicita ya no esta "en" ninguna etiqueta-carpeta: se le quitan.
 * (Llamado desde moveEmailsTracked cuando el destino es 'inbox'.) Devuelve las filas eliminadas.
 */
export async function dropFolderLabels(userIds: string[], emailIds: string[], db: Db = prisma): Promise<number> {
    const ids = dedupe(emailIds);
    if (ids.length === 0 || userIds.length === 0) return 0;
    try {
        const n = await db.$executeRawUnsafe(
            `DELETE FROM "_EmailToLabel" el USING "Email" e, "Label" l
             WHERE el."A" = ANY($1::text[]) AND e."id" = el."A" AND e."userId" = ANY($2::text[])
               AND l."id" = el."B" AND l."userId" = e."userId" AND l."behavior" = 'folder'`, ids, userIds);
        return Number(n);
    } catch (e) {
        if (isMissingBehaviorColumn(e)) return 0;
        throw e;
    }
}
