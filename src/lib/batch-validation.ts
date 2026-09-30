// Validacion de entradas de las rutas por lote (PATCH/DELETE /api/emails/batch). Pura y testeable.
import { MAIL_FILTERS, parseMailboxesParam, type MailFilterKey } from '@/lib/mail-query';

export const ALLOWED_EMAIL_FOLDERS = ['inbox', 'sent', 'drafts', 'scheduled', 'archive', 'trash', 'spam'] as const;
export const MAX_BATCH_IDS = 500;

/** `ids` debe ser un array NO vacio de strings no vacios (<=200 chars), sin repetidos, de como maximo `max`. */
export function parseBatchIds(ids: unknown, max = MAX_BATCH_IDS): string[] | null {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > max) return null;
    const out = new Set<string>();
    for (const id of ids) {
        if (typeof id !== 'string' || id.length === 0 || id.length > 200) return null;
        out.add(id);
    }
    return Array.from(out);
}

export interface EmailBatchUpdates { read?: boolean; starred?: boolean; folder?: string; restore?: true }

/**
 * Solo `read`/`starred` (boolean), `folder` (lista cerrada) y `restore: true` ("Restaurar": cada correo vuelve a su carpeta
 * de origen guardada en el servidor; no se combina con `folder`). Devuelve null si algo es invalido o no hay nada.
 */
export function parseEmailBatchUpdates(updates: unknown): EmailBatchUpdates | null {
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) return null;
    const u = updates as Record<string, unknown>;
    const out: EmailBatchUpdates = {};
    if ('read' in u) {
        if (typeof u.read !== 'boolean') return null;
        out.read = u.read;
    }
    if ('starred' in u) {
        if (typeof u.starred !== 'boolean') return null;
        out.starred = u.starred;
    }
    if ('folder' in u) {
        if (typeof u.folder !== 'string' || !(ALLOWED_EMAIL_FOLDERS as readonly string[]).includes(u.folder)) return null;
        out.folder = u.folder;
    }
    if ('restore' in u) {
        if (u.restore !== true || 'folder' in u) return null;
        out.restore = true;
    }
    return Object.keys(out).length ? out : null;
}

/** Copia legada de "de donde vino" (localStorage del cliente): { id: carpeta }. Se ignora lo que no sea una carpeta conocida. */
export function parseRestoreFallbacks(raw: unknown, ids: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    const wanted = new Set(ids);
    for (const [id, folder] of Object.entries(raw as Record<string, unknown>)) {
        if (!wanted.has(id) || typeof folder !== 'string') continue;
        if ((ALLOWED_EMAIL_FOLDERS as readonly string[]).includes(folder) && folder !== 'drafts') out[id] = folder;
    }
    return out;
}

/** `mailboxes`: ids de buzon (o 'all') dentro de los accesibles por la sesion; sin el, solo el buzon de la sesion. */
export interface BatchScope { folder: string; filter: MailFilterKey; mailboxes?: string[] }

/** `scope` = { folder, filter }: la carpeta debe ser una de las conocidas (no borradores, que viven en otra tabla). */
export function parseBatchScope(raw: unknown): BatchScope | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const s = raw as Record<string, unknown>;
    if (typeof s.folder !== 'string' || s.folder === 'drafts' || !(ALLOWED_EMAIL_FOLDERS as readonly string[]).includes(s.folder)) return null;
    const filter = s.filter === undefined ? 'all' : s.filter;
    if (typeof filter !== 'string' || !(MAIL_FILTERS as readonly string[]).includes(filter)) return null;
    let mailboxes: string[] | undefined;
    if (s.mailboxes !== undefined) {
        const list = Array.isArray(s.mailboxes) ? s.mailboxes.map((m) => (typeof m === 'string' ? m : '')).join(',') : typeof s.mailboxes === 'string' ? s.mailboxes : null;
        const parsed = list === null ? null : parseMailboxesParam(list);
        if (!parsed || parsed.length === 0) return null;
        mailboxes = parsed;
    }
    return { folder: s.folder, filter: filter as MailFilterKey, ...(mailboxes ? { mailboxes } : {}) };
}
