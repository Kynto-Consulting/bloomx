/**
 * Subconjunto SEGURO de JSON Schema para la salida estructurada (`ai.json`). Se valida en el servidor de la instancia SIEMPRE.
 * Soporta: type (object|array|string|number|integer|boolean|null, o lista), nullable, enum, const, required, properties,
 * additionalProperties:false, items, minItems/maxItems, minimum/maximum, minLength/maxLength, description, title.
 * No soporta (rechaza): $ref / $id / $schema remotos, $defs, allOf/anyOf/oneOf/not, patternProperties, pattern (riesgo ReDoS), format.
 * Limites: profundidad 6, 200 nodos, 16 KB serializado, enum <= 100 valores.
 */
export interface JsonSchema {
    type?: JsonSchemaType | JsonSchemaType[];
    nullable?: boolean;
    enum?: Array<string | number | boolean | null>;
    const?: string | number | boolean | null;
    properties?: Record<string, JsonSchema>;
    required?: string[];
    additionalProperties?: boolean;
    items?: JsonSchema;
    minItems?: number; maxItems?: number;
    minimum?: number; maximum?: number;
    minLength?: number; maxLength?: number;
    description?: string; title?: string;
}
export type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';

export const SCHEMA_LIMITS = { maxDepth: 6, maxNodes: 200, maxBytes: 16 * 1024, maxEnum: 100 } as const;

const ALLOWED_KEYS = new Set(['type', 'nullable', 'enum', 'const', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'minimum', 'maximum', 'minLength', 'maxLength', 'description', 'title']);
const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

export type SchemaCheck = { ok: true; schema: JsonSchema } | { ok: false; error: string };

/** Valida la DEFINICION del esquema (limites y palabras clave permitidas). */
export function validateSchemaDefinition(schema: unknown): SchemaCheck {
    let json = '';
    try { json = JSON.stringify(schema); } catch { return { ok: false, error: 'not_serializable' }; }
    if (!json || json.length > SCHEMA_LIMITS.maxBytes) return { ok: false, error: 'too_large' };
    let nodes = 0;
    const walk = (s: any, depth: number, path: string): string | null => {
        if (!s || typeof s !== 'object' || Array.isArray(s)) return `${path}: not_object`;
        if (++nodes > SCHEMA_LIMITS.maxNodes) return 'too_many_nodes';
        if (depth > SCHEMA_LIMITS.maxDepth) return `${path}: too_deep`;
        for (const k of Object.keys(s)) {
            if (k.startsWith('$') || k === 'allOf' || k === 'anyOf' || k === 'oneOf' || k === 'not' || k === 'patternProperties' || k === 'pattern' || k === 'format') return `${path}: unsupported_keyword`;
            if (!ALLOWED_KEYS.has(k)) return `${path}: unknown_keyword`;
        }
        const types = s.type === undefined ? [] : Array.isArray(s.type) ? s.type : [s.type];
        if (types.some((t: unknown) => typeof t !== 'string' || !TYPES.has(t))) return `${path}: bad_type`;
        if (s.enum !== undefined && (!Array.isArray(s.enum) || s.enum.length === 0 || s.enum.length > SCHEMA_LIMITS.maxEnum || s.enum.some((v: unknown) => v !== null && !['string', 'number', 'boolean'].includes(typeof v)))) return `${path}: bad_enum`;
        for (const k of ['minItems', 'maxItems', 'minLength', 'maxLength']) if (s[k] !== undefined && (!Number.isInteger(s[k]) || s[k] < 0 || s[k] > 100000)) return `${path}: bad_${k}`;
        for (const k of ['minimum', 'maximum']) if (s[k] !== undefined && !Number.isFinite(s[k])) return `${path}: bad_${k}`;
        if (s.required !== undefined && (!Array.isArray(s.required) || s.required.some((r: unknown) => typeof r !== 'string'))) return `${path}: bad_required`;
        if (s.additionalProperties !== undefined && typeof s.additionalProperties !== 'boolean') return `${path}: bad_additionalProperties`;
        if (s.properties !== undefined) {
            if (!s.properties || typeof s.properties !== 'object' || Array.isArray(s.properties)) return `${path}: bad_properties`;
            for (const [name, sub] of Object.entries(s.properties)) {
                if (name === '__proto__' || name.length > 64) return `${path}.${name}: bad_name`;
                const e = walk(sub, depth + 1, `${path}.${name}`);
                if (e) return e;
            }
        }
        if (s.items !== undefined) { const e = walk(s.items, depth + 1, `${path}[]`); if (e) return e; }
        return null;
    };
    const err = walk(schema, 1, '$');
    return err ? { ok: false, error: err } : { ok: true, schema: schema as JsonSchema };
}

export type DataCheck = { ok: true } | { ok: false; path: string; rule: string };

/** Valida `data` contra el esquema. Devuelve la RUTA y regla del primer incumplimiento (nunca el valor). */
export function validateAgainstSchema(data: unknown, schema: JsonSchema, path = '$'): DataCheck {
    const fail = (rule: string): DataCheck => ({ ok: false, path, rule });
    if (data === null && (schema.nullable === true || (Array.isArray(schema.type) ? schema.type.includes('null') : schema.type === 'null'))) return { ok: true };
    if (schema.const !== undefined && data !== schema.const) return fail('const');
    if (schema.enum && !schema.enum.some((v) => v === data)) return fail('enum');
    const types = schema.type === undefined ? null : Array.isArray(schema.type) ? schema.type : [schema.type];
    if (types) {
        const actual = data === null ? 'null' : Array.isArray(data) ? 'array' : typeof data === 'number' ? (Number.isInteger(data) ? 'integer' : 'number') : typeof data;
        const okType = types.some((t) => t === actual || (t === 'number' && actual === 'integer'));
        if (!okType) return fail('type');
    }
    if (typeof data === 'string') {
        if (schema.minLength !== undefined && data.length < schema.minLength) return fail('minLength');
        if (schema.maxLength !== undefined && data.length > schema.maxLength) return fail('maxLength');
    }
    if (typeof data === 'number') {
        if (!Number.isFinite(data)) return fail('finite');
        if (schema.minimum !== undefined && data < schema.minimum) return fail('minimum');
        if (schema.maximum !== undefined && data > schema.maximum) return fail('maximum');
    }
    if (Array.isArray(data)) {
        if (schema.minItems !== undefined && data.length < schema.minItems) return fail('minItems');
        if (schema.maxItems !== undefined && data.length > schema.maxItems) return fail('maxItems');
        if (schema.items) for (let i = 0; i < data.length; i++) { const r = validateAgainstSchema(data[i], schema.items, `${path}[${i}]`); if (!r.ok) return r; }
    }
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        const obj = data as Record<string, unknown>;
        for (const req of schema.required ?? []) if (!Object.prototype.hasOwnProperty.call(obj, req)) return { ok: false, path: `${path}.${req}`, rule: 'required' };
        const props = schema.properties ?? {};
        for (const [k, v] of Object.entries(obj)) {
            if (Object.prototype.hasOwnProperty.call(props, k)) { const r = validateAgainstSchema(v, props[k], `${path}.${k}`); if (!r.ok) return r; }
            else if (schema.additionalProperties === false) return { ok: false, path: `${path}.${k}`, rule: 'additionalProperties' };
        }
    }
    return { ok: true };
}

/** Extrae un JSON de la salida del modelo (tolera ```json ... ``` y texto alrededor). */
export function extractJson(text: string): unknown {
    const t = text.trim();
    const fence = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(t);
    const body = fence ? fence[1].trim() : t;
    try { return JSON.parse(body); } catch { /* seguir */ }
    const start = body.search(/[{[]/);
    if (start < 0) throw new Error('no_json');
    const open = body[start], close = open === '{' ? '}' : ']';
    const end = body.lastIndexOf(close);
    if (end <= start) throw new Error('no_json');
    return JSON.parse(body.slice(start, end + 1));
}

/** Variante para Gemini: su responseSchema no admite additionalProperties ni const/title. */
export function toGeminiSchema(s: JsonSchema): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const t = Array.isArray(s.type) ? s.type.find((x) => x !== 'null') : s.type;
    if (t) out.type = t.toUpperCase();
    if (s.nullable || (Array.isArray(s.type) && s.type.includes('null'))) out.nullable = true;
    if (s.enum) out.enum = s.enum.map(String);
    if (s.description) out.description = s.description;
    if (s.required) out.required = s.required;
    if (s.minItems !== undefined) out.minItems = s.minItems;
    if (s.maxItems !== undefined) out.maxItems = s.maxItems;
    if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
    if (s.items) out.items = toGeminiSchema(s.items);
    return out;
}
