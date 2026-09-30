/**
 * Motor de reglas de correo: puro (sin BD, sin red) y determinista.
 *
 * - Las reglas se ordenan por prioridad ascendente (menor numero = primero),
 *   desempate por createdAt e id.
 * - Cada regla se evalua UNA vez contra el estado inicial del correo; las
 *   acciones de una regla no disparan otras (sin cadenas ni loops).
 * - El resultado es un conjunto de efectos idempotentes: aplicarlo N veces deja
 *   el mismo estado (conectar/desconectar etiquetas, fijar read/starred/folder).
 * - Si varias reglas fijan la carpeta, gana la de mayor prioridad (la primera).
 * - Condiciones: esquema v2 (grupos AND/OR/NOT anidados, ver conditions.ts). Las reglas v1
 *   ({match, items} o un array) se siguen leyendo y evaluando sin migrar los datos.
 */
import { safeRegexTest, validateUserRegex } from './regex-safety';
import {
    conditionsMatch, toV2, validateConditionsV2, countLeaves, MAX_LEAVES,
    type ConditionsV2, type EmailContext,
} from './conditions';

export const RULE_FOLDERS = ['inbox', 'archive', 'trash', 'spam'] as const;
export type RuleFolder = (typeof RULE_FOLDERS)[number];

// ---------- v1 (compatibilidad de lectura y de las importaciones existentes) ----------

export type TextField = 'from' | 'to' | 'subject' | 'body';
export type TextOp = 'contains' | 'regex' | 'equals';

export type Condition =
    | { field: TextField; op: TextOp; value: string }
    | { field: 'hasAttachment'; value: boolean }
    | { field: 'label'; value: string }; // id o nombre de etiqueta (sin distinguir mayusculas)

export interface RuleConditions {
    match: 'all' | 'any';
    items: Condition[];
}

export type Action =
    | { type: 'addLabel'; labelId: string }
    | { type: 'removeLabel'; labelId: string }
    | { type: 'moveToLabelFolder'; labelId: string }
    | { type: 'markRead' }
    | { type: 'star' }
    | { type: 'moveToFolder'; folder: RuleFolder }
    | { type: 'archive' }
    | { type: 'delete' } // mueve a la papelera (nunca borra definitivamente)
    | { type: 'markSpam' }
    | { type: 'forwardTo'; address: string }
    | { type: 'snooze'; hours: number }
    | { type: 'stopProcessing' };

export interface Rule {
    id: string;
    name?: string;
    enabled: boolean;
    priority: number;
    conditions: RuleConditions | Condition[] | ConditionsV2;
    actions: Action[];
    stopProcessing: boolean;
    createdAt?: Date | string | null;
    /** Etiqueta a la que pertenece la regla ("Asignar automaticamente"). null = regla global. */
    labelId?: string | null;
}

export type RuleEmail = EmailContext;

export interface RuleEffects {
    addLabelIds: string[];
    removeLabelIds: string[];
    /** Etiquetas a las que se "mueve" el correo (se anaden y, si son de tipo carpeta, salen de Entrada). */
    moveToLabelFolderIds: string[];
    markRead: boolean;
    star: boolean;
    folder: RuleFolder | null;
    forwardTo: string[];
    snoozeHours: number | null;
    appliedRuleIds: string[];
}

export const MAX_ACTIONS = 12;
export const MAX_CONDITIONS = MAX_LEAVES;
export const MAX_SNOOZE_HOURS = 24 * 365;

/** Forma v1 (compatibilidad: usada por el importador de filtros de Gmail y sus firmas de deduplicacion). */
export function normalizeConditions(raw: unknown): RuleConditions {
    if (Array.isArray(raw)) return { match: 'all', items: raw as Condition[] };
    if (raw && typeof raw === 'object') {
        const o = raw as any;
        return {
            match: o.match === 'any' ? 'any' : 'all',
            items: Array.isArray(o.items) ? o.items : [],
        };
    }
    return { match: 'all', items: [] };
}

export function evaluateCondition(cond: Condition, email: RuleEmail): boolean {
    return conditionsMatch({ match: 'all', items: [cond] }, email);
}

/** Una regla sin condiciones nunca coincide (evita reglas "aplicar a todo" accidentales). */
export function ruleMatches(rule: Rule, email: RuleEmail): boolean {
    return conditionsMatch(rule.conditions, email);
}

export function sortRules<T extends Pick<Rule, 'id' | 'priority' | 'createdAt'>>(rules: T[]): T[] {
    const ts = (v: unknown) => (v ? new Date(v as any).getTime() || 0 : 0);
    return [...rules].sort((a, b) =>
        (a.priority - b.priority) || (ts(a.createdAt) - ts(b.createdAt)) || a.id.localeCompare(b.id));
}

export function evaluateRules(email: RuleEmail, rules: Rule[]): RuleEffects {
    const effects: RuleEffects = {
        addLabelIds: [], removeLabelIds: [], moveToLabelFolderIds: [], markRead: false, star: false,
        folder: null, forwardTo: [], snoozeHours: null, appliedRuleIds: [],
    };
    const add = new Set<string>();
    const remove = new Set<string>();
    const move = new Set<string>();
    const forwards = new Set<string>();

    for (const rule of sortRules(rules.filter((r) => r && r.enabled))) {
        if (!ruleMatches(rule, email)) continue;
        effects.appliedRuleIds.push(rule.id);
        let stop = rule.stopProcessing === true;

        for (const action of (Array.isArray(rule.actions) ? rule.actions : []).slice(0, MAX_ACTIONS)) {
            switch (action?.type) {
                case 'addLabel':
                    if (typeof action.labelId === 'string' && action.labelId) { remove.delete(action.labelId); add.add(action.labelId); }
                    break;
                case 'removeLabel':
                    if (typeof action.labelId === 'string' && action.labelId) { add.delete(action.labelId); move.delete(action.labelId); remove.add(action.labelId); }
                    break;
                case 'moveToLabelFolder':
                    if (typeof action.labelId === 'string' && action.labelId) { remove.delete(action.labelId); add.add(action.labelId); move.add(action.labelId); }
                    break;
                case 'markRead': effects.markRead = true; break;
                case 'star': effects.star = true; break;
                case 'archive':
                    if (!effects.folder) effects.folder = 'archive';
                    break;
                case 'delete':
                    if (!effects.folder) effects.folder = 'trash';
                    break;
                case 'markSpam':
                    if (!effects.folder) effects.folder = 'spam';
                    break;
                case 'moveToFolder':
                    if (!effects.folder && (RULE_FOLDERS as readonly string[]).includes(action.folder)) {
                        effects.folder = action.folder;
                    }
                    break;
                case 'forwardTo':
                    if (typeof action.address === 'string' && action.address) forwards.add(action.address.toLowerCase());
                    break;
                case 'snooze':
                    if (effects.snoozeHours === null && Number.isFinite(action.hours) && action.hours > 0) {
                        effects.snoozeHours = Math.min(MAX_SNOOZE_HOURS, Math.ceil(action.hours));
                    }
                    break;
                case 'stopProcessing': stop = true; break;
            }
        }
        if (stop) break;
    }

    // Por etiqueta gana la ULTIMA accion en orden de prioridad (anadir y quitar se anulan entre si).
    effects.removeLabelIds = Array.from(remove);
    effects.addLabelIds = Array.from(add);
    effects.moveToLabelFolderIds = Array.from(move);
    effects.forwardTo = Array.from(forwards);
    return effects;
}

// ---------- Validacion de entrada (API) ----------

const ADDRESS_RE = /^[^\s@<>,;"]{1,64}@[^\s@<>,;"]{1,255}$/;

export function validateActions(input: unknown): { ok: true; actions: Action[] } | { ok: false; error: string } {
    if (!Array.isArray(input) || input.length === 0) return { ok: false, error: 'Se requiere al menos una accion' };
    if (input.length > MAX_ACTIONS) return { ok: false, error: `Maximo ${MAX_ACTIONS} acciones` };
    const cleanActions: Action[] = [];
    for (const a of input as any[]) {
        switch (a?.type) {
            case 'addLabel': case 'removeLabel': case 'moveToLabelFolder':
                if (typeof a.labelId !== 'string' || !a.labelId || a.labelId.length > 100) return { ok: false, error: 'Etiqueta invalida' };
                cleanActions.push({ type: a.type, labelId: a.labelId });
                break;
            case 'markRead': case 'star': case 'archive': case 'delete': case 'markSpam': case 'stopProcessing':
                cleanActions.push({ type: a.type });
                break;
            case 'moveToFolder':
                if (!(RULE_FOLDERS as readonly string[]).includes(a.folder)) return { ok: false, error: 'Carpeta invalida' };
                cleanActions.push({ type: 'moveToFolder', folder: a.folder });
                break;
            case 'forwardTo': {
                const address = typeof a.address === 'string' ? a.address.trim().toLowerCase() : '';
                if (!ADDRESS_RE.test(address)) return { ok: false, error: 'Direccion de reenvio invalida' };
                cleanActions.push({ type: 'forwardTo', address });
                break;
            }
            case 'snooze': {
                const hours = Number(a.hours);
                if (!Number.isFinite(hours) || hours < 1 || hours > MAX_SNOOZE_HOURS) return { ok: false, error: `Posponer: entre 1 y ${MAX_SNOOZE_HOURS} horas` };
                cleanActions.push({ type: 'snooze', hours: Math.ceil(hours) });
                break;
            }
            default:
                return { ok: false, error: 'Accion invalida' };
        }
    }
    return { ok: true, actions: cleanActions };
}

/**
 * Valida condiciones + acciones. Si las condiciones llegan en v1 se validan con las reglas v1 (compatibilidad con
 * el importador) y se devuelven en v1; si llegan en v2 se validan estrictamente y se devuelven en v2.
 */
export function validateRuleInput(input: {
    conditions?: unknown; actions?: unknown;
}): { ok: true; conditions: RuleConditions | ConditionsV2; actions: Action[] } | { ok: false; error: string } {
    const raw: any = input.conditions;
    let conditions: RuleConditions | ConditionsV2;
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && (raw.v === 2 || raw.root)) {
        const v = validateConditionsV2(raw);
        if (!v.ok) return { ok: false, error: v.error };
        conditions = v.value;
    } else {
        const v1 = validateV1(raw);
        if (!v1.ok) return v1;
        conditions = v1.conditions;
    }
    const a = validateActions(input.actions);
    if (!a.ok) return a;
    return { ok: true, conditions, actions: a.actions };
}

function validateV1(raw: unknown): { ok: true; conditions: RuleConditions } | { ok: false; error: string } {
    const { items, match } = normalizeConditions(raw);
    if (items.length === 0) return { ok: false, error: 'Se requiere al menos una condicion' };
    if (items.length > MAX_CONDITIONS) return { ok: false, error: `Maximo ${MAX_CONDITIONS} condiciones` };
    const cleanItems: Condition[] = [];
    for (const c of items as any[]) {
        if (!c || typeof c !== 'object') return { ok: false, error: 'Condicion invalida' };
        if (c.field === 'hasAttachment') {
            cleanItems.push({ field: 'hasAttachment', value: c.value !== false });
        } else if (c.field === 'label') {
            const v = String(c.value ?? '').trim();
            if (!v || v.length > 100) return { ok: false, error: 'Condicion de etiqueta invalida' };
            cleanItems.push({ field: 'label', value: v });
        } else if (['from', 'to', 'subject', 'body'].includes(c.field)) {
            if (!['contains', 'regex', 'equals'].includes(c.op)) return { ok: false, error: 'Operador invalido' };
            const v = typeof c.value === 'string' ? c.value.trim() : '';
            if (!v || v.length > 500) return { ok: false, error: 'Valor de condicion invalido' };
            if (c.op === 'regex') {
                const r = validateUserRegex(v);
                if (!r.ok) return { ok: false, error: r.error };
            }
            cleanItems.push({ field: c.field, op: c.op, value: v });
        } else {
            return { ok: false, error: 'Campo de condicion invalido' };
        }
    }
    return { ok: true, conditions: { match, items: cleanItems } };
}

/** Convierte cualquier forma a v2 saneada (para almacenar y devolver por la API). */
export function conditionsToV2(raw: unknown): ConditionsV2 {
    return toV2(raw);
}

export { countLeaves, safeRegexTest };
