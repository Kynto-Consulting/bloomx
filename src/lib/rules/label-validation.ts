import { validateUserRegex } from './regex-safety';
import {
    MAX_LABEL_NAME, isLabelBehavior, isLabelIcon, isValidColor, PATH_SEPARATOR,
    type LabelBehavior, type LabelIcon,
} from '@/lib/labels/model';

export { MAX_LABEL_NAME };
const ALIAS_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;

export interface LabelInput {
    name?: string;
    color?: string;
    aliasSuffix?: string | null;
    filterRegex?: string | null;
    parentId?: string | null;
    behavior?: LabelBehavior;
    icon?: LabelIcon | null;
    showInSidebar?: boolean;
    showUnread?: boolean;
    sortOrder?: number;
}

export type LabelValidation =
    | { ok: true; data: LabelInput }
    | { ok: false; error: string };

/**
 * Valida y normaliza el cuerpo de creacion/edicion de una etiqueta.
 * En modo `partial` solo se validan las claves presentes. Cadena vacia => null (borrar).
 * `name` puede llevar '/' SOLO al crear (ruta "Trabajo/Proyecto A": el servidor crea la jerarquia).
 */
export function validateLabelInput(body: any, partial: boolean): LabelValidation {
    if (!body || typeof body !== 'object') return { ok: false, error: 'Cuerpo invalido' };
    const data: LabelInput = {};

    if (!partial || body.name !== undefined) {
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) return { ok: false, error: 'El nombre es obligatorio' };
        if (name.length > MAX_LABEL_NAME * 5 + 4 || (partial ? name.length > MAX_LABEL_NAME : name.split(PATH_SEPARATOR).some((s: string) => s.trim().length > MAX_LABEL_NAME))) {
            return { ok: false, error: `El nombre supera ${MAX_LABEL_NAME} caracteres` };
        }
        if (/[\u0000-\u001f\u007f,]/.test(name)) return { ok: false, error: 'El nombre contiene caracteres no permitidos' };
        if (partial && name.includes(PATH_SEPARATOR)) return { ok: false, error: 'El nombre no puede contener "/" (usa subetiquetas)' };
        data.name = name;
    }

    if (body.color !== undefined && body.color !== null && body.color !== '') {
        if (!isValidColor(body.color)) return { ok: false, error: 'Color invalido (use #RGB o #RRGGBB)' };
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

    if (body.parentId !== undefined) {
        if (body.parentId === null || body.parentId === '') data.parentId = null;
        else if (typeof body.parentId === 'string' && body.parentId.length <= 100) data.parentId = body.parentId;
        else return { ok: false, error: 'Etiqueta padre invalida' };
    }
    if (body.behavior !== undefined) {
        if (!isLabelBehavior(body.behavior)) return { ok: false, error: 'Comportamiento invalido (tag | folder)' };
        data.behavior = body.behavior;
    }
    if (body.icon !== undefined) {
        if (body.icon === null || body.icon === '') data.icon = null;
        else if (isLabelIcon(body.icon)) data.icon = body.icon;
        else return { ok: false, error: 'Icono no permitido' };
    }
    for (const k of ['showInSidebar', 'showUnread'] as const) {
        if (body[k] !== undefined) {
            if (typeof body[k] !== 'boolean') return { ok: false, error: `${k} debe ser booleano` };
            data[k] = body[k];
        }
    }
    if (body.sortOrder !== undefined) {
        const n = Number(body.sortOrder);
        if (!Number.isFinite(n) || Math.abs(n) > 1_000_000) return { ok: false, error: 'sortOrder invalido' };
        data.sortOrder = Math.trunc(n);
    }

    return { ok: true, data };
}
