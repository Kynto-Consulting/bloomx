/**
 * Validacion declarativa de campos de formulario de extensiones (PURO: sin React ni DOM).
 *
 * Implementa las reglas de `rules` de ui-schema.ts: required, minLength, maxLength, min, max, minItems, maxItems,
 * pattern, email, url y message. Nunca lanza: un valor raro (objeto, NaN, regla mal tipada) se trata como
 * "sin valor" o se ignora la regla. Los mensajes salen de un objeto `strings` compatible con KitStrings
 * (es/en); sin el, se usa espanol.
 */

export interface RuleStrings {
    required: string; minLength: string; maxLength: string; min: string; max: string;
    minItems: string; maxItems: string; pattern: string; email: string; url: string;
}

export interface FieldRules {
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    minItems?: number;
    maxItems?: number;
    pattern?: string;
    email?: boolean;
    url?: boolean;
    message?: string;
}

export interface ValidateOptions {
    strings?: Partial<RuleStrings>;
    /** Nombre del campo (reservado para mensajes; no se antepone al texto). */
    label?: string;
    /** Tipo de control (checkbox/toggle: `false` cuenta como vacio). */
    type?: string;
}

export interface ValidatableField {
    name: string;
    label?: string;
    rules?: FieldRules | null;
    required?: boolean;
    type?: string;
}

const DEFAULT_STRINGS: RuleStrings = {
    required: 'Este campo es obligatorio', minLength: 'Minimo {n} caracteres', maxLength: 'Maximo {n} caracteres',
    min: 'Debe ser al menos {n}', max: 'Debe ser como maximo {n}', minItems: 'Elige al menos {n}', maxItems: 'Elige como maximo {n}',
    pattern: 'El formato no es valido', email: 'Escribe un correo valido', url: 'Escribe una URL valida',
};

/** Longitud maxima de la entrada que se prueba contra un `pattern` (evita regex costosas sobre textos enormes). */
export const PATTERN_INPUT_LIMIT = 2000;
const PATTERN_SOURCE_LIMIT = 500;
/** Cuantificador anidado (`(a+)+`, `(.*)*`, `(\w+){2,}`): firma de backtracking catastrofico; estos patrones se ignoran. */
const NESTED_QUANTIFIER_RE = /\((?:[^()\\]|\\.)*[+*}]\)\s*(?:[+*]|\{\d)/;
const EMAIL_RE = /^[^\s@<>()[\],;:"\\]+@[^\s@<>()[\],;:"\\]+\.[^\s@<>()[\],;:"\\.]{2,}$/;

function fmt(template: string, n: number): string {
    return template.replace(/\{n\}/g, String(n));
}

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Correo con forma valida (sin nombres ni listas). */
export function isValidEmail(value: unknown): boolean {
    return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value.trim()) && !/\.\./.test(value);
}

/** URL absoluta http(s). */
export function isValidUrl(value: unknown): boolean {
    if (typeof value !== 'string' || value.length > 2048 || /\s/.test(value.trim())) return false;
    try {
        const u = new URL(value.trim());
        return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.length > 0;
    } catch {
        return false;
    }
}

/** Vacio = undefined, null, cadena en blanco, arreglo vacio o `false` (casilla sin marcar). 0 NO es vacio. */
export function isEmptyValue(value: unknown): boolean {
    if (value === undefined || value === null || value === false) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'number') return Number.isNaN(value);
    return false;
}

/** Fusiona `required:true` del campo con sus `rules` (nunca lanza). */
export function fieldRules(field: { required?: unknown; rules?: unknown } | null | undefined): FieldRules {
    const base = field && typeof field.rules === 'object' && field.rules !== null && !Array.isArray(field.rules) ? (field.rules as FieldRules) : {};
    return field && field.required === true ? { ...base, required: true } : { ...base };
}

function patternMatches(pattern: unknown, text: string): boolean {
    if (typeof pattern !== 'string' || pattern === '' || pattern.length > PATTERN_SOURCE_LIMIT || NESTED_QUANTIFIER_RE.test(pattern)) return true; // patron invalido => se ignora
    let re: RegExp;
    try {
        re = new RegExp(pattern);
    } catch {
        return true;
    }
    if (text.length > PATTERN_INPUT_LIMIT) return false;
    try {
        return re.test(text);
    } catch {
        return true;
    }
}

/** Devuelve el mensaje de error legible o null si el valor cumple las reglas. */
export function validateValue(value: unknown, rules: FieldRules | null | undefined, opts: ValidateOptions = {}): string | null {
    if (!rules || typeof rules !== 'object') return null;
    const s: RuleStrings = { ...DEFAULT_STRINGS, ...(opts.strings ?? {}) };
    const custom = typeof rules.message === 'string' && rules.message.trim() ? rules.message : null;
    const fail = (generic: string) => custom ?? generic;

    if (isEmptyValue(value)) return rules.required === true ? fail(s.required) : null;

    // Elementos a los que aplican las reglas de texto: el propio valor o cada elemento de una lista.
    const isList = Array.isArray(value);
    const items: unknown[] = isList ? (value as unknown[]) : [value];
    const texts = items.filter((v): v is string | number => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))).map(String);

    if (isList) {
        if (isFiniteNum(rules.minItems) && items.length < rules.minItems) return fail(fmt(s.minItems, rules.minItems));
        if (isFiniteNum(rules.maxItems) && items.length > rules.maxItems) return fail(fmt(s.maxItems, rules.maxItems));
    } else {
        if (isFiniteNum(rules.minLength) && typeof value === 'string' && value.length < rules.minLength) return fail(fmt(s.minLength, rules.minLength));
        if (isFiniteNum(rules.maxLength) && typeof value === 'string' && value.length > rules.maxLength) return fail(fmt(s.maxLength, rules.maxLength));
        if (isFiniteNum(rules.min) || isFiniteNum(rules.max)) {
            const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
            if (Number.isFinite(n)) {
                if (isFiniteNum(rules.min) && n < rules.min) return fail(fmt(s.min, rules.min));
                if (isFiniteNum(rules.max) && n > rules.max) return fail(fmt(s.max, rules.max));
            }
        }
    }
    if (rules.email === true && texts.some((t) => !isValidEmail(t))) return fail(s.email);
    if (rules.url === true && texts.some((t) => !isValidUrl(t))) return fail(s.url);
    if (rules.pattern !== undefined && texts.some((t) => !patternMatches(rules.pattern, t))) return fail(s.pattern);
    return null;
}

/** Valida todos los campos; devuelve `{nombre: mensaje}` solo de los que fallan. */
export function validateFields(fields: readonly ValidatableField[], values: Record<string, unknown> | null | undefined, strings?: Partial<RuleStrings>): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!Array.isArray(fields)) return errors;
    const source = values && typeof values === 'object' ? values : {};
    for (const field of fields) {
        if (!field || typeof field.name !== 'string' || !field.name) continue;
        const message = validateValue(source[field.name], fieldRules(field), { strings, label: field.label, type: field.type });
        if (message) errors[field.name] = message;
    }
    return errors;
}
