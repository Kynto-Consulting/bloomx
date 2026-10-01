/**
 * Esquema DECLARATIVO de ajustes de una extension (`manifest.settingsSchema`).
 *
 * Fuente unica en bloomx-extensions/_shared/settings-schema.ts, ESPEJADA byte a byte en
 *   - bloomx/src/lib/expansions/settings-schema.ts
 *   - bloomx-backend/src/lib/extensions/settings-schema.ts
 * (copiar el archivo; las pruebas de cada repo comprueban el contrato). Sin dependencias: lo usan el validador de manifests,
 * el backend (valida y guarda) y el panel de admin (renderiza el formulario y valida en cliente con las MISMAS reglas).
 *
 * Dos clases de campo:
 *   - SECRETO (`secret: true`): token, client secret, API key... Se guarda cifrado como CREDENCIAL del dominio (pestana
 *     Credenciales; `key` = nombre de variable en MAYUSCULAS, el mismo de `ENV_READ:*`). Nunca se devuelve su valor.
 *   - NO SECRETO (por defecto): ajuste tipado. Se guarda en ExtensionOnDomain.settings.config[key] y el handler lo recibe en
 *     `ctx.settings[key]`. Prioridad en la extension: ajuste del dominio > variable de entorno heredada (`legacyEnv`) > `default`.
 *
 * Forma:
 *   "settingsSchema": {
 *     "groups": [{ "id": "scan", "label": { "es": "Analisis", "en": "Scanning" } }],
 *     "fields": [{
 *       "key": "keywords", "type": "list", "label": { "es": "...", "en": "..." }, "description": { ... },
 *       "default": ["a"], "required": false, "group": "scan", "maxItems": 100, "itemMaxLength": 100,
 *       "legacyEnv": "DLP_KEYWORDS"
 *     }]
 *   }
 * Tipos: string | multiline | number | boolean | enum | multienum | list | json | objects  (alias heredados: text, textarea, password, select).
 *
 * `objects` = lista editable de registros (p. ej. endpoints de webhooks): `itemFields` son los sub-campos (tipos simples; uno puede ser
 * `secret: true` => se guarda cifrado POR ELEMENTO, write-only, y el handler lo recibe solo dentro del sandbox en el propio elemento).
 * Cada elemento lleva un `id` estable ([a-z0-9-], unico). `templates` son elementos sugeridos que el admin anade con un clic (no activos por defecto).
 *
 * Acciones: `settingsSchema.actions` = botones del panel que invocan una funcion de `api.functions` (p. ej. "Enviar evento de prueba").
 * Registro: `settingsSchema.runLog` activa un registro acotado (sin cuerpos ni secretos) que alimenta "Estado y registro".
 */

export const SETTING_TYPES = ["string", "multiline", "number", "boolean", "enum", "multienum", "list", "json", "objects"] as const;
export type SettingType = (typeof SETTING_TYPES)[number];
const TYPE_ALIASES: Record<string, SettingType | "secret"> = { text: "string", textarea: "multiline", password: "secret", select: "enum" };

export const SETTING_FORMATS = ["email", "url", "domain", "regex"] as const;
export type SettingFormat = (typeof SETTING_FORMATS)[number];

/** Claves que un ajuste NO puede usar: son sub-objetos reservados de ExtensionOnDomain.settings. */
export const RESERVED_SETTING_KEYS = ["credentials", "env", "meta", "ui", "config", "configMeta", "authData", "mandatory"];

export const SETTINGS_LIMITS = {
    maxFields: 60,
    maxStringLength: 1000,
    maxMultilineLength: 5000,
    maxListItems: 200,
    maxItemLength: 200,
    maxJsonBytes: 8192,
    /** Tamano maximo de settings.config serializado (todas las claves). */
    maxConfigBytes: 32768,
    maxRegexLength: 200,
    maxObjectItems: 50,
    maxItemSecretLength: 4096,
    maxActions: 10,
};

/** Registro de ejecuciones (settings.runLog): anillo acotado; NUNCA cuerpos, cabeceras ni secretos. */
export const RUN_LOG_LIMITS = { defaultLimit: 50, maxLimit: 100, maxMessage: 200 };
export type RunLogEntry = { ts: string; event: string; target?: string; status: "ok" | "failed" | "skipped" | "retry"; code?: number; attempts?: number; latencyMs?: number; message?: string };
const LOG_STATUS = ["ok", "failed", "skipped", "retry"];

/** Sanea una entrada de registro que devuelve un handler (`result.log[]`). `null` = descartar. */
export function sanitizeRunLogEntry(raw: unknown, now: Date = new Date()): RunLogEntry | null {
    if (!isObject(raw) || typeof raw.event !== "string" || !raw.event) return null;
    const text = (v: unknown, max: number): string => String(v).replace(/[\u0000-\u001f]+/g, " ").slice(0, max);
    const num = (v: unknown, max: number): number | undefined => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : undefined);
    const status = LOG_STATUS.includes(raw.status as string) ? (raw.status as RunLogEntry["status"]) : "ok";
    const entry: RunLogEntry = { ts: now.toISOString(), event: text(raw.event, 60), status };
    if (typeof raw.target === "string" && raw.target) entry.target = text(raw.target, 64);
    const code = num(raw.code, 999); if (code !== undefined) entry.code = code;
    const attempts = num(raw.attempts, 20); if (attempts !== undefined) entry.attempts = attempts;
    const latencyMs = num(raw.latencyMs, 600000); if (latencyMs !== undefined) entry.latencyMs = latencyMs;
    if (typeof raw.message === "string" && raw.message) entry.message = text(raw.message, RUN_LOG_LIMITS.maxMessage);
    return entry;
}

/** Anade entradas al anillo conservando solo las `limit` mas recientes (orden cronologico: la mas reciente al final). */
export function appendRunLog(current: unknown, entries: RunLogEntry[], limit: number): RunLogEntry[] {
    const base = Array.isArray(current) ? (current as RunLogEntry[]) : [];
    return [...base, ...entries].slice(-Math.max(1, Math.min(limit || RUN_LOG_LIMITS.defaultLimit, RUN_LOG_LIMITS.maxLimit)));
}

const ITEM_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** Nombre estable del secreto de un elemento: "<campo>.<idElemento>.<subcampo>". */
export function itemSecretName(fieldKey: string, itemId: string, subKey: string): string {
    return `${fieldKey}.${itemId}.${subKey}`;
}

export type LocalizedText = string | { es?: string; en?: string };

export type SettingOption = { value: string; label?: LocalizedText; description?: LocalizedText; example?: string };

export type SettingField = {
    key: string;
    type: SettingType;
    secret: boolean;
    label: LocalizedText;
    description?: LocalizedText;
    placeholder?: string;
    default?: unknown;
    required?: boolean;
    group?: string;
    options?: SettingOption[];
    min?: number;
    max?: number;
    integer?: boolean;
    maxLength?: number;
    maxItems?: number;
    itemMaxLength?: number;
    pattern?: string;
    format?: SettingFormat;
    /** Solo type "objects": sub-campos de cada elemento (tipos simples; `secret` = secreto POR ELEMENTO, write-only). */
    itemFields?: SettingField[];
    /** Solo type "objects": elementos sugeridos que el admin puede anadir con un clic. */
    templates?: SettingTemplate[];
    /** Variable de entorno heredada que respalda el ajuste (solo lectura, `server-env`). */
    legacyEnv?: string;
    /** El campo solo se muestra/exige cuando otro ajuste tiene uno de estos valores. */
    visibleWhen?: { key: string; in: string[] };
    /** false = no ofrecer "Importar desde el entorno" para este campo. */
    envImport?: boolean;
};

export type SettingTemplate = { id: string; label: LocalizedText; description?: LocalizedText; value: Record<string, unknown> };
export type SettingsGroup = { id: string; label: LocalizedText };
/** Boton del panel Ajustes que invoca `api.functions[handler]` con args { itemId? }. El resultado se muestra saneado (SettingsActionResult). */
export type SettingsAction = { id: string; label: LocalizedText; description?: LocalizedText; handler: string; scope: "global" | "item"; itemsKey?: string; confirm?: LocalizedText };
export type SettingsSchema = { groups: SettingsGroup[]; fields: SettingField[]; actions: SettingsAction[]; runLog: { limit: number } | null };
export type SettingIssue = { path: string; message: string; code?: FieldErrorCode; params?: Record<string, string | number> };

const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const GROUP_RE = /^[a-z][a-z0-9-]{0,31}$/;

function isObject(value: unknown): value is Record<string, any> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function isLocalized(value: unknown, max = 300): boolean {
    if (typeof value === "string") return value.length > 0 && value.length <= max;
    if (!isObject(value)) return false;
    const entries = Object.entries(value);
    return entries.length > 0 && entries.every(([lang, text]) => /^[a-z]{2}$/.test(lang) && typeof text === "string" && text.length <= max);
}

export function localizedText(value: LocalizedText | undefined, lang: string, fallback = ""): string {
    if (typeof value === "string") return value;
    if (!isObject(value)) return fallback;
    return (value as Record<string, string | undefined>)[lang] || value.en || value.es || Object.values(value).find((v) => typeof v === "string") || fallback;
}

/** Heuristica conservadora anti-ReDoS (equivale a validateUserRegex del frontend: rules/regex-safety.ts). `null` = segura. */
export function regexProblem(pattern: unknown): string | null {
    if (typeof pattern !== "string" || pattern.length === 0) return "El patron esta vacio";
    if (pattern.length > SETTINGS_LIMITS.maxRegexLength) return `El patron supera ${SETTINGS_LIMITS.maxRegexLength} caracteres`;
    if (/\\[1-9]|\\k</.test(pattern)) return "No se permiten referencias hacia atras";
    if (/\(\?<?[=!]/.test(pattern)) return "No se permiten lookahead/lookbehind";
    const quant = (i: number): { len: number; repeats: boolean } | null => {
        const c = pattern[i];
        if (c === "*" || c === "+") return { len: 1 + (pattern[i + 1] === "?" ? 1 : 0), repeats: true };
        if (c === "?") return { len: 1 + (pattern[i + 1] === "?" ? 1 : 0), repeats: false };
        if (c === "{") {
            const m = /^\{(\d+)(?:,(\d*))?\}/.exec(pattern.slice(i, i + 24));
            if (!m) return null;
            const min = Number(m[1]);
            const max = m[0].includes(",") ? (m[2] === "" ? Infinity : Number(m[2])) : min;
            return { len: m[0].length + (pattern[i + m[0].length] === "?" ? 1 : 0), repeats: max > 1 };
        }
        return null;
    };
    type Frame = { hasQuant: boolean; hasAlt: boolean };
    const stack: Frame[] = [];
    let inClass = false;
    let lastGroup: Frame | null = null;
    let count = 0;
    for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i];
        if (c === "\\") { i++; lastGroup = null; continue; }
        if (inClass) { if (c === "]") inClass = false; continue; }
        if (c === "[") { inClass = true; lastGroup = null; continue; }
        if (c === "(") { stack.push({ hasQuant: false, hasAlt: false }); lastGroup = null; continue; }
        if (c === ")") {
            const frame = stack.pop();
            if (!frame) return "Parentesis sin abrir";
            lastGroup = frame;
            const parent = stack[stack.length - 1];
            if (parent) { parent.hasQuant = parent.hasQuant || frame.hasQuant; parent.hasAlt = parent.hasAlt || frame.hasAlt; }
            continue;
        }
        if (c === "|") { const top = stack[stack.length - 1]; if (top) top.hasAlt = true; lastGroup = null; continue; }
        const q = quant(i);
        if (q) {
            if (q.repeats) {
                count++;
                if (lastGroup && (lastGroup.hasQuant || lastGroup.hasAlt)) return "Patron potencialmente peligroso (cuantificador anidado)";
                const top = stack[stack.length - 1];
                if (top) top.hasQuant = true;
            }
            i += q.len - 1;
            lastGroup = null;
            continue;
        }
        lastGroup = null;
    }
    if (stack.length > 0) return "Parentesis sin cerrar";
    if (count > 12) return "Demasiados cuantificadores";
    try { new RegExp(pattern, "i"); } catch { return "Expresion regular invalida"; }
    return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Normalizacion y validacion del ESQUEMA (lo usa validateManifest)
// ---------------------------------------------------------------------------------------------------------------

function normalizeOptions(raw: unknown): SettingOption[] {
    if (!Array.isArray(raw)) return [];
    const out: SettingOption[] = [];
    for (const item of raw) {
        if (typeof item === "string" && item) out.push({ value: item });
        else if (isObject(item) && typeof item.value === "string" && item.value) {
            out.push({ value: item.value, label: item.label, description: item.description, ...(typeof item.example === "string" ? { example: item.example } : {}) });
        }
    }
    return out;
}

/** Convierte lo que hay en el manifest en campos tipados (tolerante: ignora lo invalido; la validacion estricta es validateSettingsSchema). */
export function normalizeSettingsSchema(schema: unknown, depth = 0): SettingsSchema {
    const empty: SettingsSchema = { groups: [], fields: [], actions: [], runLog: null };
    if (!isObject(schema) || !Array.isArray(schema.fields)) return empty;
    const fields: SettingField[] = [];
    for (const raw of schema.fields.slice(0, SETTINGS_LIMITS.maxFields)) {
        if (!isObject(raw) || typeof raw.key !== "string" || !KEY_RE.test(raw.key)) continue;
        const alias = typeof raw.type === "string" ? TYPE_ALIASES[raw.type] : undefined;
        const secret = raw.secret === true || alias === "secret";
        const type: SettingType | null = alias === "secret" ? "string" : ((alias as SettingType | undefined) ?? (SETTING_TYPES.includes(raw.type) ? raw.type : null));
        if (!type) continue;
        const field: SettingField = {
            key: raw.key,
            type,
            secret,
            label: raw.label ?? raw.key,
            ...(raw.description !== undefined ? { description: raw.description } : {}),
            ...(typeof raw.placeholder === "string" ? { placeholder: raw.placeholder } : {}),
            ...(raw.default !== undefined ? { default: raw.default } : {}),
            ...(raw.required === true ? { required: true } : {}),
            ...(typeof raw.group === "string" ? { group: raw.group } : {}),
            ...(raw.options !== undefined ? { options: normalizeOptions(raw.options) } : {}),
            ...(typeof raw.min === "number" ? { min: raw.min } : {}),
            ...(typeof raw.max === "number" ? { max: raw.max } : {}),
            ...(raw.integer === true ? { integer: true } : {}),
            ...(typeof raw.maxLength === "number" ? { maxLength: raw.maxLength } : {}),
            ...(typeof raw.maxItems === "number" ? { maxItems: raw.maxItems } : {}),
            ...(typeof raw.itemMaxLength === "number" ? { itemMaxLength: raw.itemMaxLength } : {}),
            ...(typeof raw.pattern === "string" ? { pattern: raw.pattern } : {}),
            ...(SETTING_FORMATS.includes(raw.format) ? { format: raw.format } : {}),
            ...(typeof raw.legacyEnv === "string" && ENV_NAME_RE.test(raw.legacyEnv) ? { legacyEnv: raw.legacyEnv } : {}),
            ...(isObject(raw.visibleWhen) && typeof raw.visibleWhen.key === "string" && Array.isArray(raw.visibleWhen.in)
                ? { visibleWhen: { key: raw.visibleWhen.key, in: raw.visibleWhen.in.filter((v: unknown): v is string => typeof v === "string") } }
                : {}),
            ...(raw.envImport === false ? { envImport: false } : {}),
            ...(type === "objects" && depth === 0 && Array.isArray(raw.itemFields)
                ? { itemFields: normalizeSettingsSchema({ fields: raw.itemFields }, 1).fields.filter((sub) => sub.type !== "objects") }
                : {}),
            ...(type === "objects" && Array.isArray(raw.templates)
                ? { templates: raw.templates.filter((t: any) => isObject(t) && typeof t.id === "string" && ITEM_ID_RE.test(t.id) && isObject(t.value)).map((t: any) => ({ id: t.id, label: t.label ?? t.id, ...(t.description !== undefined ? { description: t.description } : {}), value: t.value })) }
                : {}),
        };
        // Esquema heredado (claves de variable en MAYUSCULAS, sin legacyEnv): la propia clave es la variable.
        if (!field.secret && !field.legacyEnv && ENV_NAME_RE.test(field.key)) field.legacyEnv = field.key;
        if (!fields.some((f) => f.key === field.key)) fields.push(field);
    }
    const groups: SettingsGroup[] = Array.isArray(schema.groups)
        ? schema.groups.filter((g: any) => isObject(g) && typeof g.id === "string" && GROUP_RE.test(g.id) && isLocalized(g.label)).map((g: any) => ({ id: g.id, label: g.label }))
        : [];
    const actions: SettingsAction[] = Array.isArray(schema.actions)
        ? schema.actions.slice(0, SETTINGS_LIMITS.maxActions).filter((a: any) => isObject(a) && typeof a.id === "string" && ITEM_ID_RE.test(a.id) && typeof a.handler === "string" && a.handler).map((a: any) => ({ id: a.id, label: a.label ?? a.id, ...(a.description !== undefined ? { description: a.description } : {}), handler: a.handler, scope: a.scope === "item" ? "item" : "global", ...(typeof a.itemsKey === "string" ? { itemsKey: a.itemsKey } : {}), ...(a.confirm !== undefined ? { confirm: a.confirm } : {}) }))
        : [];
    const runLog = isObject(schema.runLog) ? { limit: Math.max(1, Math.min(Number(schema.runLog.limit) || RUN_LOG_LIMITS.defaultLimit, RUN_LOG_LIMITS.maxLimit)) } : null;
    return { groups, fields, actions, runLog };
}

export const configFields = (fields: SettingField[]): SettingField[] => fields.filter((f) => !f.secret);
export const secretFields = (fields: SettingField[]): SettingField[] => fields.filter((f) => f.secret);

/** Valida la DECLARACION del esquema (permisivo con el formato heredado). Devuelve problemas con ruta. */
export function validateSettingsSchema(schema: unknown, basePath = "settingsSchema", functionNames?: Iterable<string>, depth = 0): SettingIssue[] {
    const issues: SettingIssue[] = [];
    if (schema === undefined) return issues;
    if (!isObject(schema)) return [{ path: basePath, message: "Debe ser un objeto { groups?, fields }" }];
    if (!Array.isArray(schema.fields)) return [{ path: `${basePath}.fields`, message: "Requerido: arreglo de campos" }];
    if (schema.fields.length > SETTINGS_LIMITS.maxFields) issues.push({ path: `${basePath}.fields`, message: `Maximo ${SETTINGS_LIMITS.maxFields} campos` });
    const groupIds = new Set<string>();
    if (schema.groups !== undefined) {
        if (!Array.isArray(schema.groups)) issues.push({ path: `${basePath}.groups`, message: "Debe ser un arreglo" });
        else schema.groups.forEach((g: unknown, i: number) => {
            const at = `${basePath}.groups[${i}]`;
            if (!isObject(g) || typeof g.id !== "string" || !GROUP_RE.test(g.id)) return void issues.push({ path: `${at}.id`, message: "Requerido: id [a-z0-9-] (max 32)" });
            if (!isLocalized(g.label)) issues.push({ path: `${at}.label`, message: "Requerido: texto o { es, en }" });
            groupIds.add(g.id);
        });
    }
    const keys = new Set<string>();
    const keyList = schema.fields.map((f: any) => (isObject(f) ? f.key : undefined));
    schema.fields.forEach((raw: unknown, i: number) => {
        const at = `${basePath}.fields[${i}]`;
        if (!isObject(raw)) return void issues.push({ path: at, message: "Debe ser un objeto" });
        const bad = (prop: string, message: string) => issues.push({ path: `${at}.${prop}`, message });
        if (typeof raw.key !== "string" || !KEY_RE.test(raw.key)) return bad("key", "Requerido: [A-Za-z][A-Za-z0-9_] (max 64)");
        if (keys.has(raw.key)) bad("key", `Clave duplicada: ${raw.key}`);
        keys.add(raw.key);
        const alias = typeof raw.type === "string" ? TYPE_ALIASES[raw.type] : undefined;
        const type = alias === "secret" ? "string" : alias ?? raw.type;
        if (!SETTING_TYPES.includes(type)) return bad("type", `Debe ser uno de ${SETTING_TYPES.join(", ")}`);
        const secret = raw.secret === true || alias === "secret";
        if (secret) {
            if (depth === 0 && !ENV_NAME_RE.test(raw.key)) bad("key", "Un campo secreto usa el nombre de variable en MAYUSCULAS (el mismo de ENV_READ)");
            if (raw.default !== undefined) bad("default", "Un campo secreto no puede tener valor por defecto");
        } else if (RESERVED_SETTING_KEYS.includes(raw.key)) {
            bad("key", `"${raw.key}" esta reservada`);
        }
        if (raw.label !== undefined && !isLocalized(raw.label)) bad("label", "Debe ser texto o { es, en }");
        if (raw.description !== undefined && !isLocalized(raw.description, 600)) bad("description", "Debe ser texto o { es, en }");
        if (raw.group !== undefined && groupIds.size > 0 && !groupIds.has(raw.group)) bad("group", `Grupo no declarado: ${String(raw.group)}`);
        if (raw.legacyEnv !== undefined && (typeof raw.legacyEnv !== "string" || !ENV_NAME_RE.test(raw.legacyEnv))) bad("legacyEnv", "Debe ser un nombre de variable en MAYUSCULAS");
        if (raw.format !== undefined && !SETTING_FORMATS.includes(raw.format)) bad("format", `Debe ser uno de ${SETTING_FORMATS.join(", ")}`);
        if (raw.pattern !== undefined) {
            const problem = regexProblem(raw.pattern);
            if (problem) bad("pattern", problem);
        }
        if (raw.visibleWhen !== undefined) {
            const v = raw.visibleWhen;
            if (!isObject(v) || typeof v.key !== "string" || !Array.isArray(v.in) || v.in.some((x: unknown) => typeof x !== "string")) bad("visibleWhen", "Debe ser { key, in: [valores] }");
            else if (!keyList.includes(v.key) || v.key === raw.key) bad("visibleWhen.key", `No existe otro campo "${v.key}"`);
        }
        if (type === "objects") {
            if (depth > 0) return bad("type", "No se admiten objects anidados");
            if (secret) return bad("secret", "Un objects no puede ser secreto (usa un sub-campo secret)");
            if (!Array.isArray(raw.itemFields) || raw.itemFields.length === 0) bad("itemFields", "Requerido: sub-campos del elemento");
            else {
                for (const sub of validateSettingsSchema({ fields: raw.itemFields }, `${at}.itemFields`, functionNames, depth + 1)) issues.push(sub);
                raw.itemFields.forEach((sub: any, j: number) => {
                    if (isObject(sub) && sub.key === "id") issues.push({ path: `${at}.itemFields[${j}].key`, message: '"id" lo gestiona el panel' });
                });
            }
            if (raw.templates !== undefined) {
                if (!Array.isArray(raw.templates) || raw.templates.length > 20) bad("templates", "Debe ser un arreglo (max 20)");
                else {
                    const subFields = normalizeSettingsSchema({ fields: raw.itemFields }, 1).fields;
                    raw.templates.forEach((t: any, j: number) => {
                        const tp = `${at}.templates[${j}]`;
                        if (!isObject(t) || typeof t.id !== "string" || !ITEM_ID_RE.test(t.id)) return void issues.push({ path: `${tp}.id`, message: "Requerido: id [a-z0-9-]" });
                        if (!isLocalized(t.label)) issues.push({ path: `${tp}.label`, message: "Requerido: texto o { es, en }" });
                        const probe = validateFieldValue({ key: "x", type: "objects", secret: false, label: "x", itemFields: subFields }, [{ id: t.id, ...(isObject(t.value) ? t.value : {}) }]);
                        if (probe.ok === false) issues.push({ path: `${tp}.value`, message: probe.message });
                    });
                }
            }
            if (raw.maxItems !== undefined && (typeof raw.maxItems !== "number" || raw.maxItems < 1 || raw.maxItems > SETTINGS_LIMITS.maxObjectItems)) bad("maxItems", `Entre 1 y ${SETTINGS_LIMITS.maxObjectItems}`);
            return;
        }
        const needsOptions = type === "enum" || type === "multienum";
        const options = normalizeOptions(raw.options);
        if (needsOptions && options.length === 0) bad("options", "Requerido: lista de opciones");
        if (!needsOptions && raw.options !== undefined) bad("options", "Solo para enum/multienum");
        if (raw.default !== undefined && !secret) {
            const probe = validateFieldValue({ ...normalizeSettingsSchema({ fields: [{ ...raw, required: false }] }).fields[0] }, raw.default);
            if (probe.ok === false) bad("default", `Valor por defecto invalido: ${probe.message}`);
        }
    });
    if (depth === 0) {
        if (schema.actions !== undefined) {
            if (!Array.isArray(schema.actions) || schema.actions.length > SETTINGS_LIMITS.maxActions) issues.push({ path: `${basePath}.actions`, message: `Debe ser un arreglo (max ${SETTINGS_LIMITS.maxActions})` });
            else {
                const fnSet = functionNames ? new Set(functionNames) : null;
                const ids = new Set<string>();
                schema.actions.forEach((a: any, i: number) => {
                    const at = `${basePath}.actions[${i}]`;
                    if (!isObject(a) || typeof a.id !== "string" || !ITEM_ID_RE.test(a.id)) return void issues.push({ path: `${at}.id`, message: "Requerido: id [a-z0-9-]" });
                    if (ids.has(a.id)) issues.push({ path: `${at}.id`, message: `Accion duplicada: ${a.id}` });
                    ids.add(a.id);
                    if (!isLocalized(a.label)) issues.push({ path: `${at}.label`, message: "Requerido: texto o { es, en }" });
                    if (typeof a.handler !== "string" || !a.handler) issues.push({ path: `${at}.handler`, message: "Requerido: funcion de api.functions" });
                    else if (fnSet && !fnSet.has(a.handler)) issues.push({ path: `${at}.handler`, message: `"${a.handler}" no esta declarada en api.functions` });
                    if (a.scope !== undefined && a.scope !== "global" && a.scope !== "item") issues.push({ path: `${at}.scope`, message: 'Debe ser "global" o "item"' });
                    if (a.scope === "item" && !schema.fields.some((f: any) => isObject(f) && f.key === a.itemsKey && f.type === "objects")) issues.push({ path: `${at}.itemsKey`, message: "Requerido: clave de un campo objects" });
                });
            }
        }
        if (schema.runLog !== undefined && (!isObject(schema.runLog) || (schema.runLog.limit !== undefined && (typeof schema.runLog.limit !== "number" || schema.runLog.limit < 1 || schema.runLog.limit > RUN_LOG_LIMITS.maxLimit)))) {
            issues.push({ path: `${basePath}.runLog`, message: `Debe ser { limit?: 1..${RUN_LOG_LIMITS.maxLimit} }` });
        }
    }
    return issues;
}

// ---------------------------------------------------------------------------------------------------------------
// Validacion de VALORES
// ---------------------------------------------------------------------------------------------------------------

export function splitListInput(input: string): string[] {
    return input.split(/[\r\n,;]+/).map((s) => s.trim()).filter(Boolean);
}

function formatProblem(format: SettingFormat | undefined, value: string): string | null {
    if (!format) return null;
    if (format === "email" && !/^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]{2,}$/.test(value)) return "Correo no valido";
    if (format === "url") {
        try {
            const u = new URL(value);
            if (u.protocol !== "https:") return "Debe ser una URL https";
        } catch { return "URL no valida"; }
    }
    if (format === "domain" && !/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(value)) return "Dominio no valido";
    if (format === "regex") return regexProblem(value);
    return null;
}

/**
 * Codigos estables de error de valor (el panel los traduce a es/en con `params`; `message` es el texto de respaldo en espanol):
 * type | control | format | pattern | number | integer | min | max | option | options | list | listItemType | listItemMax | listItemControl |
 * listItem | maxItems | maxChars | required | objects | objectItem | itemId | itemDup | itemUnknown | itemSecret | itemField | json | jsonSize | unsupported
 */
export type FieldErrorCode = "type" | "control" | "format" | "pattern" | "number" | "integer" | "min" | "max" | "option" | "options" | "list" | "listItemType" | "listItemMax" | "listItemControl" | "listItem" | "maxItems" | "maxChars" | "required" | "objects" | "objectItem" | "itemId" | "itemDup" | "itemUnknown" | "itemSecret" | "itemField" | "json" | "jsonSize" | "unsupported" | "boolean";
export type FieldCheck = { ok: true; value: unknown } | { ok: false; message: string; code: FieldErrorCode; params?: Record<string, string | number> };

/** Valida y normaliza el valor de UN campo no secreto (entrada del formulario o de la API). `undefined`/`null` = sin valor. */
export function validateFieldValue(field: SettingField | undefined, input: unknown): FieldCheck {
    if (!field) return { ok: false, message: "Campo desconocido", code: "unsupported" };
    const fail = (message: string, code: FieldErrorCode = "type", params?: Record<string, string | number>): FieldCheck => ({ ok: false, message, code, ...(params ? { params } : {}) });
    const L = SETTINGS_LIMITS;
    switch (field.type) {
        case "string":
        case "multiline": {
            if (typeof input !== "string") return fail("Debe ser texto", "type");
            const value = field.type === "string" ? input.trim() : input.replace(/\r\n/g, "\n").trim();
            const cap = Math.min(field.maxLength ?? (field.type === "string" ? L.maxStringLength : L.maxMultilineLength), field.type === "string" ? L.maxStringLength : L.maxMultilineLength);
            if (value.length > cap) return fail(`Maximo ${cap} caracteres`, "maxChars", { max: cap });
            // eslint-disable-next-line no-control-regex
            if (field.type === "string" && /[\u0000-\u001f]/.test(value)) return fail("No admite saltos de linea ni caracteres de control", "control");
            const problem = formatProblem(field.format, value);
            if (value && problem) return fail(problem, "format", { format: String(field.format) });
            if (value && field.pattern && !new RegExp(field.pattern).test(value)) return fail("Formato no valido", "pattern");
            return { ok: true, value };
        }
        case "number": {
            const n = typeof input === "string" && input.trim() !== "" ? Number(input) : input;
            if (typeof n !== "number" || !Number.isFinite(n)) return fail("Debe ser un numero", "number");
            if (field.integer && !Number.isInteger(n)) return fail("Debe ser un entero", "integer");
            if (field.min !== undefined && n < field.min) return fail(`Minimo ${field.min}`, "min", { min: field.min });
            if (field.max !== undefined && n > field.max) return fail(`Maximo ${field.max}`, "max", { max: field.max });
            return { ok: true, value: n };
        }
        case "boolean":
            return typeof input === "boolean" ? { ok: true, value: input } : fail("Debe ser verdadero o falso", "boolean");
        case "enum": {
            const allowed = (field.options ?? []).map((o) => o.value);
            return typeof input === "string" && allowed.includes(input) ? { ok: true, value: input } : fail(`Debe ser uno de ${allowed.join(", ")}`, "option", { allowed: allowed.join(", ") });
        }
        case "multienum": {
            const arr = typeof input === "string" ? splitListInput(input) : input;
            if (!Array.isArray(arr)) return fail("Debe ser una lista", "list");
            const allowed = (field.options ?? []).map((o) => o.value);
            const bad = arr.find((v) => typeof v !== "string" || !allowed.includes(v));
            if (bad !== undefined) return fail(`Valor no permitido: ${String(bad).slice(0, 40)}`, "options", { value: String(bad).slice(0, 40) });
            return { ok: true, value: Array.from(new Set(arr as string[])) };
        }
        case "list": {
            const arr = typeof input === "string" ? splitListInput(input) : input;
            if (!Array.isArray(arr)) return fail("Debe ser una lista", "list");
            const maxItems = Math.min(field.maxItems ?? L.maxListItems, L.maxListItems);
            const itemMax = Math.min(field.itemMaxLength ?? L.maxItemLength, L.maxItemLength);
            const out: string[] = [];
            for (let i = 0; i < arr.length; i++) {
                if (typeof arr[i] !== "string") return fail(`Elemento ${i + 1}: debe ser texto`, "listItemType", { index: i + 1 });
                const item = (arr[i] as string).trim();
                if (!item) continue;
                if (item.length > itemMax) return fail(`Elemento ${i + 1}: maximo ${itemMax} caracteres`, "listItemMax", { index: i + 1, max: itemMax });
                // eslint-disable-next-line no-control-regex
                if (/[\u0000-\u001f]/.test(item)) return fail(`Elemento ${i + 1}: caracteres de control`, "listItemControl", { index: i + 1 });
                const problem = formatProblem(field.format, item);
                if (problem) return fail(`Elemento ${i + 1}: ${problem}`, "listItem", { index: i + 1, format: String(field.format) });
                if (!out.includes(item)) out.push(item);
            }
            if (out.length > maxItems) return fail(`Maximo ${maxItems} elementos`, "maxItems", { max: maxItems });
            return { ok: true, value: out };
        }
        case "objects": {
            if (!Array.isArray(input)) return fail("Debe ser una lista de elementos", "objects");
            const maxItems = Math.min(field.maxItems ?? L.maxObjectItems, L.maxObjectItems);
            if (input.length > maxItems) return fail(`Maximo ${maxItems} elementos`, "maxItems", { max: maxItems });
            const subs = (field.itemFields ?? []).filter((sub) => sub.type !== "objects");
            const out: Array<Record<string, unknown>> = [];
            const ids = new Set<string>();
            for (let i = 0; i < input.length; i++) {
                const item = input[i];
                const at = `[${i}]`;
                if (!isObject(item)) return fail(`${at}: debe ser un objeto`, "objectItem", { index: i + 1 });
                if (typeof item.id !== "string" || !ITEM_ID_RE.test(item.id)) return fail(`${at}.id: requerido ([a-z0-9-], max 32)`, "itemId", { index: i + 1 });
                if (ids.has(item.id)) return fail(`${at}.id: duplicado (${item.id})`, "itemDup", { index: i + 1, id: item.id });
                ids.add(item.id);
                const clean: Record<string, unknown> = { id: item.id };
                for (const key of Object.keys(item)) {
                    if (key !== "id" && !subs.some((sub) => sub.key === key)) return fail(`${at}.${key}: campo no declarado`, "itemUnknown", { index: i + 1, field: key });
                }
                for (const sub of subs) {
                    const raw = item[sub.key];
                    if (sub.secret) {
                        if (raw !== undefined) return fail(`${at}.${sub.key}: un secreto se envia aparte (secrets), nunca dentro del elemento`, "itemSecret", { index: i + 1, field: sub.key });
                        continue;
                    }
                    if (raw === undefined || raw === null || raw === "" || (Array.isArray(raw) && raw.length === 0 && sub.type !== "multienum")) {
                        if (sub.required && isVisible(sub, item)) return fail(`${at}.${sub.key}: requerido`, "required", { index: i + 1, field: sub.key });
                        if (sub.default !== undefined) clean[sub.key] = sub.default;
                        continue;
                    }
                    const check = validateFieldValue(sub, raw);
                    if (check.ok === false) return fail(`${at}.${sub.key}: ${check.message}`, "itemField", { index: i + 1, field: sub.key, sub: check.code, ...(check.params ?? {}) });
                    clean[sub.key] = check.value;
                }
                out.push(clean);
            }
            return { ok: true, value: out };
        }
        case "json": {
            let value = input;
            if (typeof input === "string") {
                try { value = JSON.parse(input); } catch { return fail("JSON no valido", "json"); }
            }
            let size = 0;
            try { size = JSON.stringify(value)?.length ?? 0; } catch { return fail("JSON no valido", "json"); }
            if (value === undefined || size > L.maxJsonBytes) return fail(`JSON demasiado grande (max ${L.maxJsonBytes} bytes)`, "jsonSize", { max: L.maxJsonBytes });
            return { ok: true, value };
        }
    }
    return fail("Tipo no soportado", "unsupported");
}

export type SettingsCheck = { ok: boolean; values: Record<string, unknown>; removed: string[]; errors: SettingIssue[] };

/**
 * Valida un cambio parcial `{ clave: valor | null }` sobre los campos NO secretos. `null` o "" = restablecer (borrar la clave).
 * `values` contiene los valores normalizados a guardar; `errors` lleva la ruta del campo (`values.<clave>`).
 */
export function validateSettingValues(fields: SettingField[], input: unknown, path = "values"): SettingsCheck {
    const result: SettingsCheck = { ok: true, values: {}, removed: [], errors: [] };
    if (!isObject(input)) return { ...result, ok: false, errors: [{ path, message: "Debe ser un objeto { clave: valor }" }] };
    const byKey = new Map(configFields(fields).map((f) => [f.key, f]));
    for (const [key, raw] of Object.entries(input)) {
        const at = `${path}.${key}`;
        const field = byKey.get(key);
        if (!field) { result.errors.push({ path: at, message: "Ajuste no declarado por la extension" }); continue; }
        if (raw === null || raw === undefined || raw === "" || (Array.isArray(raw) && raw.length === 0 && field.type !== "multienum")) {
            result.removed.push(key);
            continue;
        }
        const check = validateFieldValue(field, raw);
        if (check.ok === true) result.values[key] = check.value;
        else result.errors.push({ path: at, message: check.message, code: check.code, ...(check.params ? { params: check.params } : {}) });
    }
    result.ok = result.errors.length === 0;
    return result;
}

export type ItemSecretsCheck = { ok: boolean; set: Record<string, string>; removed: string[]; errors: SettingIssue[] };

/**
 * Valida los secretos por elemento que acompanan a un PUT: { "<campo>.<idElemento>.<subcampo>": "valor" | null }. `items` son los elementos
 * (tras el PUT) de cada campo objects, para exigir que el elemento y el sub-campo secreto existan. null/"" = borrar el secreto.
 */
export function validateItemSecrets(fields: SettingField[], items: Record<string, Array<Record<string, unknown>>>, input: unknown, path = "secrets"): ItemSecretsCheck {
    const result: ItemSecretsCheck = { ok: true, set: {}, removed: [], errors: [] };
    if (input === undefined) return result;
    if (!isObject(input)) return { ...result, ok: false, errors: [{ path, message: "Debe ser un objeto { campo.id.subcampo: valor }" }] };
    for (const [name, raw] of Object.entries(input)) {
        const at = `${path}.${name}`;
        const m = /^([A-Za-z][A-Za-z0-9_]*)\.([a-z0-9][a-z0-9-]{0,31})\.([A-Za-z][A-Za-z0-9_]*)$/.exec(name);
        const field = m ? fields.find((f) => f.key === m[1] && f.type === "objects") : undefined;
        const sub = m ? field?.itemFields?.find((x) => x.key === m[3] && x.secret) : undefined;
        if (!m || !field || !sub) { result.errors.push({ path: at, message: "Secreto no declarado por la extension" }); continue; }
        if (!(items[m[1]] ?? []).some((item) => item.id === m[2])) { result.errors.push({ path: at, message: "El elemento no existe" }); continue; }
        if (raw === null || raw === "") { result.removed.push(name); continue; }
        // eslint-disable-next-line no-control-regex
        if (typeof raw !== "string" || !raw.trim() || raw.length > SETTINGS_LIMITS.maxItemSecretLength || /[\u0000-\u001f]/.test(raw)) { result.errors.push({ path: at, message: "Valor no valido" }); continue; }
        result.set[name] = raw.trim();
    }
    result.ok = result.errors.length === 0;
    return result;
}

/** Exige los campos `required` visibles que queden sin valor (ni propio, ni por defecto, ni heredado). */
export function missingRequired(fields: SettingField[], effective: Record<string, unknown>): string[] {
    return configFields(fields)
        .filter((f) => f.required && isVisible(f, effective) && isEmpty(effective[f.key]))
        .map((f) => f.key);
}

function isEmpty(value: unknown): boolean {
    return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

export function isVisible(field: SettingField, values: Record<string, unknown>): boolean {
    if (!field.visibleWhen) return true;
    const current = values[field.visibleWhen.key];
    return typeof current === "string" && field.visibleWhen.in.includes(current);
}

/** Interpreta el texto de una variable de entorno heredada segun el tipo del campo. `undefined` = no utilizable. */
export function parseLegacyEnv(field: SettingField, raw: unknown): unknown {
    if (typeof raw !== "string" || !raw.trim()) return undefined;
    const text = raw.trim();
    let candidate: unknown = text;
    if (field.type === "boolean") candidate = /^(1|true|yes|si|on)$/i.test(text) ? true : /^(0|false|no|off)$/i.test(text) ? false : undefined;
    else if (field.type === "number") candidate = Number(text);
    else if (field.type === "list") candidate = splitListInput(text);
    else if (field.type === "multienum") candidate = /^(none|ninguno|-)$/i.test(text) ? [] : splitListInput(text.toLowerCase());
    if (candidate === undefined) return undefined;
    if (Array.isArray(candidate) && candidate.length === 0) return field.type === "multienum" ? [] : undefined;
    const check = validateFieldValue(field, candidate);
    return check.ok ? check.value : undefined;
}

export type SettingSource = "domain" | "legacy" | "server-env" | "default" | "unset";

/** Valor efectivo por campo con la prioridad ajuste del dominio > entorno heredado > defecto, y de donde sale. Sin secretos. */
export function resolveEffective(
    fields: SettingField[],
    stored: Record<string, unknown>,
    legacy: Record<string, { value: unknown; source: "legacy" | "server-env" } | undefined> = {},
): { values: Record<string, unknown>; sources: Record<string, SettingSource> } {
    const values: Record<string, unknown> = {};
    const sources: Record<string, SettingSource> = {};
    for (const field of configFields(fields)) {
        const own = stored[field.key];
        const old = legacy[field.key];
        if (!isEmpty(own) || (field.type === "multienum" && Array.isArray(own))) { values[field.key] = own; sources[field.key] = "domain"; }
        else if (old && (!isEmpty(old.value) || Array.isArray(old.value))) { values[field.key] = old.value; sources[field.key] = old.source; }
        else if (field.default !== undefined) { values[field.key] = field.default; sources[field.key] = "default"; }
        else sources[field.key] = "unset";
    }
    return { values, sources };
}

export type Checklist = { done: number; total: number; items: Array<{ key: string; secret: boolean; ok: boolean }> };

/**
 * "Configuracion completa 3/5": cuenta los campos `required` visibles. Un campo no secreto cuenta como completo si tiene valor
 * efectivo (propio, heredado o por defecto); uno secreto, si hay credencial utilizable (`configuredSecrets`).
 */
export function computeChecklist(fields: SettingField[], effective: Record<string, unknown>, configuredSecrets: Iterable<string>): Checklist {
    const secrets = new Set(configuredSecrets);
    const items = fields
        .filter((f) => f.required && isVisible(f, effective))
        .map((f) => ({ key: f.key, secret: f.secret, ok: f.secret ? secrets.has(f.key) : !isEmpty(effective[f.key]) }));
    return { done: items.filter((i) => i.ok).length, total: items.length, items };
}

/** Tamano serializado de un objeto `config` (para el tope de ExtensionOnDomain.settings). */
export function configBytes(config: unknown): number {
    try { return JSON.stringify(config)?.length ?? 0; } catch { return Infinity; }
}
