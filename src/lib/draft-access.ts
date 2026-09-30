import { prisma } from '@/lib/prisma';
import { getAccessibleMailboxUserIds } from '@/lib/mailbox-access';

/**
 * Helpers compartidos por las rutas /api/drafts/**. Draft no tiene userId: la propiedad se decide por
 * el remitente (`from`), que debe ser una direccion del usuario o de una cuenta vinculada.
 */

export function extractEmailAddress(value: string): string {
    const raw = String(value || '').trim();
    const bracketMatch = raw.match(/<([^>]+)>/);
    return (bracketMatch?.[1] || raw).trim().toLowerCase();
}

export function normalizeMailboxIdentity(email: string): string {
    const [localPart, domain] = String(email || '').trim().toLowerCase().split('@');
    if (!localPart || !domain) return '';

    let normalizedLocal = localPart.replace(/\./g, '');
    const plusIndex = normalizedLocal.indexOf('+');
    if (plusIndex !== -1) {
        normalizedLocal = normalizedLocal.substring(0, plusIndex);
    }

    return `${normalizedLocal}@${domain}`;
}

/** Direcciones (en minusculas) desde las que el usuario puede crear/leer/borrar borradores. */
export async function resolveAuthorizedSenders(userId: string, fallbackEmail: string): Promise<Set<string>> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            email: true,
            accounts: { select: { providerAccountId: true } },
        },
    });

    return new Set<string>([
        String(user?.email || fallbackEmail || '').trim().toLowerCase(),
        ...((user?.accounts || [])
            .map((account) => String(account.providerAccountId || '').trim().toLowerCase())
            .filter((email) => email.includes('@'))),
    ]);
}

type DraftAttachmentInput = { filename?: unknown; mimeType?: unknown; size?: unknown; key?: unknown };

/**
 * Filtra los adjuntos que el cliente quiere asociar a un borrador: solo los que ya existen en el bucket y
 * pertenecen al usuario (subidas propias `attachments/<email>/...` o adjuntos de correos de sus buzones,
 * p. ej. un reenvio). Descarta el resto en silencio (nunca se referencia un objeto ajeno).
 */
export async function sanitizeDraftAttachments(
    input: unknown,
    user: { id: string; email: string },
): Promise<Array<{ filename: string; mimeType: string; size: number; key: string }>> {
    if (!Array.isArray(input)) return [];

    const ownPrefix = `attachments/${user.email}/`;
    const candidates = (input as DraftAttachmentInput[])
        .filter((att) => att && typeof att.key === 'string' && att.key && att.key !== 'PENDING' && att.filename)
        .slice(0, 50)
        .map((att) => ({
            filename: String(att.filename).slice(0, 255),
            mimeType: String(att.mimeType || 'application/octet-stream').slice(0, 255),
            size: Number.isFinite(Number(att.size)) ? Math.max(0, Math.floor(Number(att.size))) : 0,
            key: String(att.key),
        }))
        .filter((att) => !att.key.includes('..'));

    const foreign = candidates.filter((att) => !att.key.startsWith(ownPrefix));
    let allowedForeign = new Set<string>();
    if (foreign.length > 0) {
        const accessible = await getAccessibleMailboxUserIds(user.id);
        const rows = await prisma.attachment.findMany({
            where: { key: { in: foreign.map((a) => a.key) }, email: { userId: { in: accessible } } },
            select: { key: true },
        });
        allowedForeign = new Set(rows.map((r) => r.key));
    }

    return candidates.filter((att) => att.key.startsWith(ownPrefix) || allowedForeign.has(att.key));
}
