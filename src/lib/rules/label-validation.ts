import { validateUserRegex } from './regex-safety';

export const MAX_LABEL_NAME = 50;
const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const ALIAS_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;

export interface LabelInput {
    name?: string;
    color?: string;
    aliasSuffix?: string | null;
    filterRegex?: string | null;
}

export type LabelValidation =
    | { ok: true; data: LabelInput }
    | { ok: false; error: string };

/**
 * Valida y normaliza el cuerpo de creacion/edicion de una etiqueta.
 * En modo `partial` solo se validan las claves presentes. Cadena vacia => null (borrar).
 */
export function validateLabelInput(body: any, partial: boolean): LabelValidation {
    if (!body || typeof body !== 'object') return { ok: false, error: 'Cuerpo invalido' };
    const data: LabelInput = {};

    if (!partial || body.name !== undefined) {
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) return { ok: false, error: 'El nombre es obligatorio' };
        if (name.length > MAX_LABEL_NAME) return { ok: false, error: `El nombre supera ${MAX_LABEL_NAME} caracteres` };
        if (/[\u0000-\u001f\u007f,]/.test(name)) return { ok: false, error: 'El nombre contiene caracteres no permitidos' };
        data.name = name;
    }

    if (body.color !== undefined && body.color !== null && body.color !== '') {
        if (typeof body.color !== 'string' || !COLOR_RE.test(body.color)) {
            return { ok: false, error: 'Color invalido (use #RGB o #RRGGBB)' };
        }
        data.color = body.color.toLowerCase();
    }

    if (body.aliasSuffix !== undefined) {
        const v = body.aliasSuffix === null ? '' : String(body.aliasSuffix).trim().toLowerCase();
        if (v === '') data.aliasSuffix = null;
        else if (!ALIAS_RE.test(v)) return { ok: false, error: 'Alias invalido (a-z, 0-9, ., _, -; max 40)' };
        else data.aliasSuffix = v;
    }

    if (body.filterRegex !== undefined) {
        const v = body.filterRegex === null ? '' : String(body.filterRegex).trim();
        if (v === '') data.filterRegex = null;
        else {
            const r = validateUserRegex(v);
            if (!r.ok) return { ok: false, error: r.error };
            data.filterRegex = v;
        }
    }

    return { ok: true, data };
}
