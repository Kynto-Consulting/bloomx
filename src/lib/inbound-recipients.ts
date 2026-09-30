import { createHash } from 'crypto';
import { extractEmailOnly, normalizeEmailAddress, splitAddressList } from './email-utils';

/**
 * Logica pura del webhook de correo entrante (Resend). Vive fuera de la ruta porque los route.ts de
 * Next solo pueden exportar handlers, y asi se puede probar con vitest.
 */

/** Convierte un valor de destinatario (string, lista "a, b", {email,name} o arreglo de ellos) en correos en minuscula. */
export function collectAddresses(value: unknown): string[] {
    if (value === null || value === undefined || value === '') return [];
    if (Array.isArray(value)) return value.flatMap((v) => collectAddresses(v));
    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        const email = String(obj.email ?? obj.address ?? '').trim().toLowerCase();
        return email.includes('@') ? [email] : [];
    }
    return splitAddressList(String(value))
        .map((entry) => extractEmailOnly(entry))
        .filter(Boolean);
}

export type InboundRecipients = {
    to: string[];
    cc: string[];
    bcc: string[];
    /** to + cc + bcc, sin duplicados, tal como llegaron (minuscula). */
    all: string[];
    /**
     * Claves para buscar usuarios: la direccion tal cual y su forma normalizada (sin puntos ni +tag).
     * Se buscan ambas porque `User.email` puede estar guardado con o sin puntos.
     */
    lookupKeys: string[];
};

function dedupe(list: string[]): string[] {
    return Array.from(new Set(list));
}

/**
 * Extrae los destinatarios de un evento `email.received`. Un usuario que solo aparece en CC o BCC
 * (o en un `to` vacio, p. ej. listas) tambien es destinatario valido.
 */
export function collectInboundRecipients(data: { to?: unknown; cc?: unknown; bcc?: unknown } | null | undefined): InboundRecipients {
    const to = dedupe(collectAddresses(data?.to));
    const cc = dedupe(collectAddresses(data?.cc));
    const bcc = dedupe(collectAddresses(data?.bcc));
    const all = dedupe([...to, ...cc, ...bcc]);
    const lookupKeys = dedupe(all.flatMap((address) => [address, normalizeEmailAddress(address)]));
    return { to, cc, bcc, all, lookupKeys };
}

/** Une los usuarios encontrados con el/los destinatario(s) que los alcanzo, para etiquetar por alias. */
export function recipientsForUser(userEmail: string, all: string[]): string[] {
    const own = normalizeEmailAddress(userEmail);
    return all.filter((address) => normalizeEmailAddress(address) === own);
}

/**
 * Identificador estable (con forma de UUID) derivado del id del correo entrante. Los reintentos del
 * webhook reutilizan las mismas claves de almacenamiento (se sobrescriben) en lugar de dejar
 * objetos huerfanos.
 */
export function stableStorageId(seed: string): string {
    const hex = createHash('sha256').update(seed).digest('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** messageId almacenado por usuario (el mismo esquema que ya usaba el webhook). */
export function userScopedMessageId(resolvedMessageId: string, userId: string, fallbackId: string): string {
    if (!resolvedMessageId) return `${fallbackId}-${userId}`;
    return resolvedMessageId.endsWith(`-${userId}`) ? resolvedMessageId : `${resolvedMessageId}-${userId}`;
}

/** Codigo de error de Prisma por violacion de unicidad: el correo ya existe = reintento idempotente. */
export function isUniqueViolation(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002');
}
