import {
    configFields, isVisible, itemSecretName, secretFields, splitListInput, validateFieldValue,
    type FieldErrorCode, type RunLogEntry, type SettingField, type SettingIssue, type SettingSource, type SettingsGroup, type SettingsSchema,
} from '@/lib/expansions/settings-schema';

/**
 * Utilidades PURAS del formulario de ajustes por dominio de una extension (sin React ni fetch).
 *  - estado del formulario <-> valores del backend (incluye `objects`: elementos con id estable y secretos por elemento),
 *  - diff (solo lo cambiado, `null` = restablecer) y secretos por elemento (`campo.id.sub`),
 *  - validacion en cliente con las MISMAS reglas del backend (validateFieldValue) y errores con `code` + `params`,
 *  - agrupacion por grupo y visibleWhen,
 *  - mapeo de errores 422 (`values.<clave>` / `secrets.<nombre>`) al campo.
 */

export type SimpleValue = string | boolean | string[];
/** Un elemento de un campo `objects`. `secrets`: clave ausente = sin cambio; texto = establecer/reemplazar; null = quitar. */
export type ObjectItem = { id: string; isNew: boolean; values: Record<string, SimpleValue>; secrets: Record<string, string | null> };
/** Valor de un control: texto, booleano, lista de ids (multienum) o elementos (objects). */
export type FormValue = SimpleValue | ObjectItem[];
export type FormState = Record<string, FormValue>;

export type ErrorParams = Record<string, string | number>;
export type FieldError = { code: FieldErrorCode; params?: ErrorParams; message?: string };

const isItems = (v: unknown): v is ObjectItem[] => Array.isArray(v) && v.every((x) => !!x && typeof x === 'object' && !Array.isArray(x));
const subFields = (field: SettingField): SettingField[] => (field.itemFields ?? []).filter((s) => s.type !== 'objects');

export function isEmptyForm(field: SettingField, value: FormValue | undefined): boolean {
    if (value === undefined) return true;
    if (field.type === 'boolean') return false;
    if (field.type === 'multienum') return false; // [] es un valor valido ("ninguno")
    if (field.type === 'objects') return !Array.isArray(value) || value.length === 0;
    if (Array.isArray(value)) return value.length === 0;
    return typeof value === 'string' && value.trim() === '';
}

function toSimple(field: SettingField, value: unknown): SimpleValue {
    switch (field.type) {
        case 'boolean':
            return value === true;
        case 'multienum':
            return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
        case 'list':
            return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').join('\n') : typeof value === 'string' ? value : '';
        case 'json':
            if (value === undefined) return '';
            try { return JSON.stringify(value, null, 2); } catch { return ''; }
        case 'number':
            return typeof value === 'number' || typeof value === 'string' ? String(value) : '';
        default:
            return typeof value === 'string' ? value : '';
    }
}

/** Elemento de un campo `objects` a partir de un registro guardado o de una plantilla. */
export function toItem(field: SettingField, raw: Record<string, unknown>, id: string, isNew: boolean): ObjectItem {
    const values: Record<string, SimpleValue> = {};
    for (const sub of subFields(field)) {
        if (sub.secret) continue;
        const v = raw[sub.key];
        values[sub.key] = toSimple(sub, v !== undefined && v !== null ? v : sub.default);
    }
    return { id, isNew, values, secrets: {} };
}

/** Convierte un valor (guardado o por defecto) al estado de su control. */
export function toFormValue(field: SettingField, value: unknown): FormValue {
    if (field.type === 'objects') {
        if (!Array.isArray(value)) return [];
        return value
            .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as any).id === 'string')
            .map((v) => toItem(field, v, String(v.id), false));
    }
    return toSimple(field, value);
}

/**
 * Estado inicial: valor GUARDADO del dominio; si no hay, el valor por defecto del esquema (solo para mostrar: no cuenta como
 * cambio hasta que el usuario lo modifica).
 */
export function initialForm(schema: SettingsSchema, stored: Record<string, unknown>): FormState {
    const form: FormState = {};
    for (const field of configFields(schema.fields)) {
        const own = stored[field.key];
        form[field.key] = toFormValue(field, own !== undefined && own !== null ? own : field.default);
    }
    return form;
}

const same = (a: FormValue | undefined, b: FormValue | undefined): boolean => {
    if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
    return a === b;
};

/** Claves cuyo control difiere del estado inicial. */
export function changedKeys(schema: SettingsSchema, initial: FormState, current: FormState): string[] {
    return configFields(schema.fields).filter((f) => !same(initial[f.key], current[f.key])).map((f) => f.key);
}

/** El elemento tiene cambios sin guardar (nuevo, editado o con un secreto pendiente). */
export function itemDirty(initialItems: FormValue | undefined, item: ObjectItem): boolean {
    if (item.isNew) return true;
    const base = isItems(initialItems) ? initialItems.find((i) => i.id === item.id) : undefined;
    return !base || JSON.stringify(base) !== JSON.stringify(item);
}

/** Valores efectivos para evaluar `visibleWhen` (enum/string de la edicion en curso). */
export function visibilityValues(schema: SettingsSchema, form: FormState): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of configFields(schema.fields)) out[f.key] = form[f.key];
    return out;
}

export function visibleFields(schema: SettingsSchema, form: FormState): SettingField[] {
    const values = visibilityValues(schema, form);
    return configFields(schema.fields).filter((f) => isVisible(f, values));
}

/** Registro a validar/enviar de un elemento (sin secretos: viajan aparte en `secrets`). */
export function itemToRaw(field: SettingField, item: ObjectItem): Record<string, unknown> {
    const raw: Record<string, unknown> = { id: item.id };
    for (const sub of subFields(field)) if (!sub.secret) raw[sub.key] = item.values[sub.key];
    return raw;
}

const MAX_SECRET = 4096;

/**
 * Errores por sub-campo de los elementos de un campo `objects`: clave `<idElemento>.<subcampo>`. Aplica required/visibleWhen y los
 * secretos obligatorios (un secreto ya establecido en el servidor cuenta como configurado).
 */
export function validateItems(field: SettingField, items: ObjectItem[], secretsSet: ReadonlySet<string> = new Set()): Record<string, FieldError> {
    const errors: Record<string, FieldError> = {};
    for (const item of items) {
        const visibility = item.values as Record<string, unknown>;
        for (const sub of subFields(field)) {
            const at = `${item.id}.${sub.key}`;
            if (!isVisible(sub, visibility)) continue;
            if (sub.secret) {
                const typed = item.secrets[sub.key];
                if (typeof typed === 'string' && typed !== '') {
                    // eslint-disable-next-line no-control-regex
                    if (typed.length > MAX_SECRET) errors[at] = { code: 'maxChars', params: { max: MAX_SECRET } };
                    // eslint-disable-next-line no-control-regex
                    else if (/[\u0000-\u001f]/.test(typed)) errors[at] = { code: 'control' };
                    continue;
                }
                const stays = !item.isNew && secretsSet.has(itemSecretName(field.key, item.id, sub.key)) && typed !== null;
                if (sub.required && !stays) errors[at] = { code: 'required' };
                continue;
            }
            const value = item.values[sub.key];
            if (isEmptyForm(sub, value)) {
                if (sub.required) errors[at] = { code: 'required' };
                continue;
            }
            const check = validateFieldValue(sub, value);
            if (!check.ok) errors[at] = { code: check.code, params: check.params, message: check.message };
        }
    }
    return errors;
}

/** Errores de los campos VISIBLES: obligatorio sin valor (ni por defecto) o valor que no pasa validateFieldValue. */
export function validateForm(
    schema: SettingsSchema, form: FormState, sources: Record<string, SettingSource> = {}, secretsSet: ReadonlySet<string> = new Set(),
): Record<string, FieldError> {
    const errors: Record<string, FieldError> = {};
    for (const field of visibleFields(schema, form)) {
        const value = form[field.key];
        if (field.type === 'objects') {
            const items = isItems(value) ? value : [];
            const maxItems = Math.min(field.maxItems ?? 50, 50);
            if (items.length === 0) { if (field.required) errors[field.key] = { code: 'required' }; continue; }
            if (items.length > maxItems) { errors[field.key] = { code: 'maxItems', params: { max: maxItems } }; continue; }
            const count = Object.keys(validateItems(field, items, secretsSet)).length;
            if (count > 0) errors[field.key] = { code: 'itemField', params: { count } };
            continue;
        }
        if (isEmptyForm(field, value)) {
            // Vacio = "volver al valor por defecto / heredado"; solo es error si es obligatorio y no hay de donde sacarlo.
            const hasFallback = field.default !== undefined || isLegacySource(sources[field.key]);
            if (field.required && !hasFallback) errors[field.key] = { code: 'required' };
            continue;
        }
        const check = validateFieldValue(field, value);
        if (!check.ok) errors[field.key] = { code: check.code, params: check.params, message: check.message };
    }
    return errors;
}

/**
 * Cambio parcial a enviar: valor normalizado por campo cambiado; `null` si quedo vacio (restablece la clave).
 * Los campos ocultos por visibleWhen no se envian.
 */
export function buildDiff(schema: SettingsSchema, initial: FormState, current: FormState): Record<string, unknown> {
    const diff: Record<string, unknown> = {};
    const visible = new Set(visibleFields(schema, current).map((f) => f.key));
    for (const field of configFields(schema.fields)) {
        if (!visible.has(field.key) || same(initial[field.key], current[field.key])) continue;
        const value = current[field.key];
        if (isEmptyForm(field, value)) { diff[field.key] = null; continue; }
        if (field.type === 'objects') {
            const raw = (isItems(value) ? value : []).map((item) => itemToRaw(field, item));
            // Solo cambio un secreto: el valor no se reenvia.
            if (JSON.stringify(raw) === JSON.stringify((isItems(initial[field.key]) ? (initial[field.key] as ObjectItem[]) : []).map((item) => itemToRaw(field, item)))) continue;
            const check = validateFieldValue(field, raw);
            if (check.ok) diff[field.key] = check.value;
            continue;
        }
        const check = validateFieldValue(field, value);
        if (check.ok) diff[field.key] = check.value;
    }
    return diff;
}

/** Secretos por elemento a enviar en `secrets` (`campo.id.sub`: texto = establecer, null = quitar). Solo lo que el admin cambio. */
export function buildSecrets(schema: SettingsSchema, current: FormState): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const field of visibleFields(schema, current)) {
        if (field.type !== 'objects') continue;
        const items = current[field.key];
        if (!isItems(items)) continue;
        for (const item of items) {
            for (const sub of subFields(field)) {
                if (!sub.secret) continue;
                const typed = item.secrets[sub.key];
                if (typed === undefined || (typed === '' && item.isNew)) continue;
                out[itemSecretName(field.key, item.id, sub.key)] = typed === '' ? null : typed;
            }
        }
    }
    return out;
}

export type ServerFieldError = { message: string; code?: FieldErrorCode; params?: ErrorParams };

/** `values.<clave>` / `secrets.<nombre>` -> error por campo (los errores sin campo se devuelven aparte). */
export function mapServerErrors(errors: SettingIssue[] | undefined): { byKey: Record<string, ServerFieldError>; bySecret: Record<string, ServerFieldError>; general: ServerFieldError[] } {
    const byKey: Record<string, ServerFieldError> = {};
    const bySecret: Record<string, ServerFieldError> = {};
    const general: ServerFieldError[] = [];
    for (const e of errors ?? []) {
        const entry: ServerFieldError = { message: e.message, ...(e.code ? { code: e.code } : {}), ...(e.params ? { params: e.params } : {}) };
        const m = /^values\.([A-Za-z][A-Za-z0-9_]{0,63})$/.exec(e.path);
        const s = /^secrets\.(.+)$/.exec(e.path);
        if (m) byKey[m[1]] = entry;
        else if (s) bySecret[s[1]] = entry;
        else general.push(entry);
    }
    return { byKey, bySecret, general };
}

type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * Texto traducido (es/en) de un error de validacion por `code` + `params`. `message` (espanol de respaldo) solo se usa si el codigo
 * no tiene traduccion.
 */
export function describeFieldError(t: T, e: { code?: string; params?: ErrorParams; message?: string }): string {
    const fallback = e.message ?? t('admin.console.extensions.config.invalid');
    if (!e.code) return fallback;
    const params: ErrorParams = { ...(e.params ?? {}) };
    if (e.code === 'itemField' && typeof params.sub === 'string') {
        const { sub, ...rest } = params;
        params.detail = describeFieldError(t, { code: sub, params: rest });
    }
    const key = `admin.console.extensions.config.err.${e.code}`;
    const out = t(key, params);
    return out === key ? fallback : out;
}

export type FieldSection = { id: string; label: SettingsGroup['label'] | null; fields: SettingField[] };

/** Secciones en el orden de `groups`; los campos sin grupo (o con grupo no declarado) van primero en una seccion sin titulo. */
export function groupFields(schema: SettingsSchema, fields: SettingField[] = configFields(schema.fields)): FieldSection[] {
    const known = new Set(schema.groups.map((g) => g.id));
    const sections: FieldSection[] = [];
    const loose = fields.filter((f) => !f.group || !known.has(f.group));
    if (loose.length) sections.push({ id: '', label: null, fields: loose });
    for (const group of schema.groups) {
        const list = fields.filter((f) => f.group === group.id);
        if (list.length) sections.push({ id: group.id, label: group.label, fields: list });
    }
    return sections;
}

/** Texto de una lista -> elementos (para el contador en vivo). */
export function listCount(text: string): number {
    return splitListInput(text).length;
}

// ---------------------------------------------------------------------------------------------------------------
// Identificadores estables de elementos
// ---------------------------------------------------------------------------------------------------------------

export function slugify(text: string): string {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
}

/** Id `[a-z0-9-]{1,32}` a partir de un nombre + sufijo unico respecto a `taken`. Nunca se edita despues de crearse. */
export function newItemId(base: string, taken: Iterable<string>, random: () => number = Math.random): string {
    const used = new Set(taken);
    const slug = slugify(base) || 'item';
    for (let attempt = 0; attempt < 50; attempt++) {
        const suffix = Math.floor(random() * 36 ** 4).toString(36).padStart(4, '0');
        const id = `${slug}-${suffix}`.slice(0, 32);
        if (!used.has(id)) return id;
    }
    return `${slug.slice(0, 18)}-${Date.now().toString(36)}`.slice(0, 32);
}

export const LEGACY_SOURCES: readonly SettingSource[] = ['legacy', 'server-env'];
export const isLegacySource = (source: SettingSource | undefined): boolean => !!source && LEGACY_SOURCES.includes(source);

export function secretSummary(schema: SettingsSchema, secrets: { name: string; configured: boolean }[]): { configured: number; total: number } {
    const names = secretFields(schema.fields).map((f) => f.key);
    return { total: names.length, configured: names.filter((n) => secrets.some((s) => s.name === n && s.configured)).length };
}

export type ActionResult = { status: 'ok' | 'failed'; code?: number; latencyMs?: number; message?: string; report?: string[] };

export type ConfigData = {
    success?: true;
    values: Record<string, unknown>;
    sources: Record<string, SettingSource>;
    envLegacy: string[];
    importable: string[];
    imported?: string[];
    /** `campo.id.sub` de los secretos por elemento establecidos (nunca valores). */
    secretsSet: string[];
    runLog: RunLogEntry[];
    ok?: boolean;
    result?: ActionResult;
    secrets: { name: string; configured: boolean; source: 'domain' | 'legacy' | 'server-env' | 'missing' }[];
    checklist: { done: number; total: number; items: { key: string; secret: boolean; ok: boolean }[] };
    meta: { updatedAt: string | null; updatedBy: string | null };
    limits: { maxConfigBytes: number | null };
};

/** El esquema declara al menos un campo (secreto o no). */
export const hasSchema = (schema: SettingsSchema | undefined): schema is SettingsSchema => !!schema && schema.fields.length > 0;

/** Nombre legible de un elemento: primer sub-campo de texto con valor, o su id. */
export function itemTitle(field: SettingField, item: ObjectItem): string {
    for (const sub of subFields(field)) {
        if (sub.secret || sub.type !== 'string') continue;
        const v = item.values[sub.key];
        if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return item.id;
}
