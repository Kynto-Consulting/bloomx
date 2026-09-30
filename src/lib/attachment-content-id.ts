import { prisma } from '@/lib/prisma';
import { normalizeContentId } from '@/lib/email-utils';

/**
 * Guarda `Attachment.contentId` (Content-ID de imagenes inline) con SQL directo y de forma tolerante.
 *
 * Por que no `prisma.attachment.create({ contentId })`: la columna se anade con `db:ensure`
 * (ADD COLUMN IF NOT EXISTS) y el cliente de Prisma se regenera en otro paso. Con SQL crudo y un try/catch
 * la ingesta de correo nunca falla por esto: si la columna aun no existe, solo se pierde el Content-ID
 * (las imagenes `cid:` se siguen resolviendo por nombre de archivo).
 */
const MISSING_RE = /does not exist|42703|no such column|Unknown (?:argument|field)/i;

let warnedMissing = false;

export interface ContentIdEntry {
    emailId: string;
    /** Clave de storage del adjunto (unica por correo gracias a uniqueAttachmentKey). */
    key: string;
    contentId?: string | null;
}

/** Devuelve cuantas filas se actualizaron (0 si no hay nada valido o la columna no existe todavia). */
export async function saveAttachmentContentIds(entries: ContentIdEntry[]): Promise<number> {
    let updated = 0;
    for (const entry of entries) {
        const contentId = normalizeContentId(entry.contentId);
        if (!contentId || !entry.emailId || !entry.key || entry.key === 'PENDING' || entry.key === 'BLOCKED') continue;
        try {
            updated += Number(await prisma.$executeRaw`
                UPDATE "Attachment" SET "contentId" = ${contentId}
                WHERE "emailId" = ${entry.emailId} AND "key" = ${entry.key}
            `);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (MISSING_RE.test(message)) {
                if (!warnedMissing) {
                    warnedMissing = true;
                    console.warn('[attachment-content-id] Attachment.contentId no existe todavia (ejecuta db:ensure); se omite.');
                }
                return updated; // sin columna: no tiene sentido seguir intentando
            }
            console.warn('[attachment-content-id] No se pudo guardar el Content-ID:', message);
        }
    }
    return updated;
}

/** Solo para pruebas. */
export function __resetContentIdWarning() {
    warnedMissing = false;
}
