/**
 * Motor de reglas de correo: puro (sin BD, sin red) y determinista.
 *
 * - Las reglas se ordenan por prioridad ascendente (menor numero = primero),
 *   desempate por createdAt e id.
 * - Cada regla se evalua UNA vez contra el estado inicial del correo; las
 *   acciones de una regla no disparan otras (sin cadenas ni loops).
 * - El resultado es un conjunto de efectos idempotentes: aplicarlo N veces deja
 *   el mismo estado (conectar etiquetas, fijar read/starred/folder).
 * - Si varias reglas fijan la carpeta, gana la de mayor prioridad (la primera).
 */
import { safeRegexTest, validateUserRegex } from './regex-safety';

export const RULE_FOLDERS = ['inbox', 'archive', 'trash', 'spam'] as const;
export type RuleFolder = (typeof RULE_FOLDERS)[number];

export type TextField = 'from' | 'to' | 'subject' | 'body';
export type TextOp = 'contains' | 'regex' | 'equals';

export type Condition =
    | { field: TextField; op: TextOp; value: string }
    | { field: 'hasAttachment'; value: boolean }
    | { field: 'label'; value: string }; // id o nombre de etiqueta (sin distinguir mayusculas)

export type Action =
    | { type: 'addLabel'; labelId: string }
    | { type: 'markRead' }
    | { type: 'star' }
    | { type: 'moveToFolder'; folder: RuleFolder }
    | { type: 'archive' }
    | { type: 'delete' }; // mueve a la papelera (nunca borra definitivamente)

export interface RuleConditions {
    match: 'all' | 'any';
    items: Condition[];
}

export interface Rule {
    id: string;
    name?: string;
    enabled: boolean;
    priority: number;
    conditions: RuleConditions | Condition[];
    actions: Action[];
    stopProcessing: boolean;
    createdAt?: Date | string | null;
}

export interface RuleEmail {
    from: string;
    to: string;
    subject: string;
    body: string;
    hasAttachment: boolean;
    labelIds: string[];
    labelNames?: string[];
}

export interface RuleEffects {
    addLabelIds: string[];
    markRead: boolean;
    star: boolean;
    folder: RuleFolder | null;
    appliedRuleIds: string[];
}

const MAX_CONDITIONS = 20;
const MAX_ACTIONS = 10;
const MAX_VALUE_LENGTH = 500;

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

function textMatches(haystack: string, op: TextOp, value: string): boolean {
    const h = String(haystack ?? '');
    const v = String(value ?? '');
    if (!v) return false;
    switch (op) {
        case 'contains': return h.toLowerCase().includes(v.toLowerCase());
        case 'equals': return h.trim().toLowerCase() === v.trim().toLowerCase();
        case 'regex': return safeRegexTest(v, h);
        default: return false;
    }
}

export function evaluateCondition(cond: Condition, email: RuleEmail): boolean {
    if (!cond || typeof cond !== 'object') return false;
    switch (cond.field) {
        case 'from':
        case 'to':
        case 'subject':
        case 'body':
            return textMatches(email[cond.field], cond.op, cond.value);
        case 'hasAttachment':
            return email.hasAttachment === (cond.value !== false);
        case 'label': {
            const v = String(cond.value ?? '').toLowerCase();
            if (!v) return false;
            return email.labelIds.some((id) => id.toLowerCase() === v)
                || (email.labelNames ?? []).some((n) => n.toLowerCase() === v);
        }
        default:
            return false;
    }
}

/** Una regla sin condiciones nunca coincide (evita reglas "aplicar a todo" accidentales). */
export function ruleMatches(rule: Rule, email: RuleEmail): boolean {
    const { match, items } = normalizeConditions(rule.conditions);
    const list = items.slice(0, MAX_CONDITIONS);
    if (list.length === 0) return false;
    return match === 'any'
        ? list.some((c) => evaluateCondition(c, email))
        : list.every((c) => evaluateCondition(c, email));
}

export function sortRules<T extends Pick<Rule, 'id' | 'priority' | 'createdAt'>>(rules: T[]): T[] {
    const ts = (v: unknown) => (v ? new Date(v as any).getTime() || 0 : 0);
    return [...rules].sort((a, b) =>
        (a.priority - b.priority) || (ts(a.createdAt) - ts(b.createdAt)) || a.id.localeCompare(b.id));
}

export function evaluateRules(email: RuleEmail, rules: Rule[]): RuleEffects {
    const effects: RuleEffects = { addLabelIds: [], markRead: false, star: false, folder: null, appliedRuleIds: [] };
    const labels = new Set<string>();

    for (const rule of sortRules(rules.filter((r) => r && r.enabled))) {
        if (!ruleMatches(rule, email)) continue;
        effects.appliedRuleIds.push(rule.id);

        for (const action of (Array.isArray(rule.actions) ? rule.actions : []).slice(0, MAX_ACTIONS)) {
            switch (action?.type) {
                case 'addLabel':
                    if (typeof action.labelId === 'string' && action.labelId) labels.add(action.labelId);
                    break;
                case 'markRead': effects.markRead = true; break;
                case 'star': effects.star = true; break;
                case 'archive':
                    if (!effects.folder) effects.folder = 'archive';
                    break;
                case 'delete':
                    if (!effects.folder) effects.folder = 'trash';
                    break;
                case 'moveToFolder':
                    if (!effects.folder && (RULE_FOLDERS as readonly string[]).includes(action.folder)) {
                        effects.folder = action.folder;
                    }
                    break;
            }
        }
        if (rule.stopProcessing) break;
    }

    effects.addLabelIds = Array.from(labels);
    return effects;
}

// ---------- Validacion de entrada (API) ----------

export function validateRuleInput(input: {
    conditions?: unknown; actions?: unknown;
}): { ok: true; conditions: RuleConditions; actions: Action[] } | { ok: false; error: string } {
    const { items, match } = normalizeConditions(input.conditions);
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
            if (!v || v.length > MAX_VALUE_LENGTH) return { ok: false, error: 'Valor de condicion invalido' };
            if (c.op === 'regex') {
                const r = validateUserRegex(v);
                if (!r.ok) return { ok: false, error: r.error };
            }
            cleanItems.push({ field: c.field, op: c.op, value: v });
        } else {
            return { ok: false, error: 'Campo de condicion invalido' };
        }
    }

    if (!Array.isArray(input.actions) || input.actions.length === 0) return { ok: false, error: 'Se requiere al menos una accion' };
    if (input.actions.length > MAX_ACTIONS) return { ok: false, error: `Maximo ${MAX_ACTIONS} acciones` };
    const cleanActions: Action[] = [];
    for (const a of input.actions as any[]) {
        switch (a?.type) {
            case 'addLabel':
                if (typeof a.labelId !== 'string' || !a.labelId || a.labelId.length > 100) return { ok: false, error: 'Etiqueta invalida' };
                cleanActions.push({ type: 'addLabel', labelId: a.labelId });
                break;
            case 'markRead': case 'star': case 'archive': case 'delete':
                cleanActions.push({ type: a.type });
                break;
            case 'moveToFolder':
                if (!(RULE_FOLDERS as readonly string[]).includes(a.folder)) return { ok: false, error: 'Carpeta invalida' };
                cleanActions.push({ type: 'moveToFolder', folder: a.folder });
                break;
            default:
                return { ok: false, error: 'Accion invalida' };
        }
    }
    return { ok: true, conditions: { match, items: cleanItems }, actions: cleanActions };
}
