import { normalizeEmailAddressAscii, stripControlChars } from './mail-validation';

/** Logica pura de la API de contactos (validacion y paginacion). */

export const DEFAULT_CONTACT_LIMIT = 1000;
export const MAX_CONTACT_LIMIT = 1000;
export const MAX_NAME_LENGTH = 200;
export const MAX_NOTES_LENGTH = 5000;

export type ContactInput = { email?: string; name?: string | null; notes?: string | null };

/**
 * Valida el cuerpo de creacion/edicion. En edicion (`partial`) solo se devuelven los campos presentes;
 * cadena vacia en name/notes significa "borrar el valor".
 */
export function parseContactInput(body: unknown, opts: { partial?: boolean } = {}): { ok: true; value: ContactInput } | { ok: false; error: string } {
    const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const value: ContactInput = {};

    if (!opts.partial || raw.email !== undefined) {
        const email = normalizeEmailAddressAscii(String(raw.email ?? '').trim().toLowerCase());
        if (!email) return { ok: false, error: 'Valid contact email is required' };
        value.email = email.toLowerCase();
    }

    if (!opts.partial || raw.name !== undefined) {
        const name = stripControlChars(raw.name).slice(0, MAX_NAME_LENGTH);
        value.name = name || null;
    }

    if (!opts.partial || raw.notes !== undefined) {
        // Las notas admiten saltos de linea: solo se recorta y se limita el largo.
        const notes = String(raw.notes ?? '').trim().slice(0, MAX_NOTES_LENGTH);
        value.notes = notes || null;
    }

    if (opts.partial && Object.keys(value).length === 0) {
        return { ok: false, error: 'Nothing to update' };
    }

    return { ok: true, value };
}

export function parseContactPagination(params: URLSearchParams): { limit: number; offset: number; q: string } {
    const toInt = (raw: string | null, fallback: number) => {
        const n = Number.parseInt(raw ?? '', 10);
        return Number.isFinite(n) ? n : fallback;
    };
    const limit = Math.min(MAX_CONTACT_LIMIT, Math.max(1, toInt(params.get('limit'), DEFAULT_CONTACT_LIMIT)));
    const offset = Math.max(0, toInt(params.get('offset'), 0));
    const q = stripControlChars(params.get('q')).slice(0, 100);
    return { limit, offset, q };
}
