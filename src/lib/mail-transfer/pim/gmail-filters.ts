/**
 * gmail-filters.ts - filtros de Gmail (mailFilters.xml de Google Takeout, Atom + `apps:property`) <-> reglas del motor propio
 * (src/lib/rules/engine.ts). Puro (sin BD): la capa de aplicacion (apply.ts) resuelve etiquetas y guarda las reglas.
 *
 * Entrada NO CONFIABLE: se lee con safe-xml.ts (sin DOCTYPE/entidades), con limites de filtros y de longitud de valores.
 *
 * Reglas de seguridad del mapeo:
 *  - Un filtro NUNCA se crea con una condicion RESTRICTIVA sin mapear (doesNotHaveTheWord, negaciones, size, operadores
 *    desconocidos): la regla resultante coincidiria con MAS correos que el original y podria archivar/borrar de mas.
 *    (`partial: 'safe'` la permite solo si las acciones son inocuas: etiqueta / leido / estrella.)
 *  - forwardTo NUNCA se convierte en reenvio automatico.
 *  - shouldTrash -> `delete` (el motor solo mueve a la papelera, nunca borra definitivamente).
 */
import { escapeXml, findAll, parseXml, textOf, type XmlElement, type XmlLimits } from '../safe-xml';
import { validateUserRegex, MAX_REGEX_LENGTH } from '@/lib/rules/regex-safety';
import { MAX_LABEL_NAME } from '@/lib/rules/label-validation';
import type { Action, Condition, RuleConditions } from '@/lib/rules/engine';
import { toV2, isGroup } from '@/lib/rules/conditions';

export interface GmailFilter {
    from: string | null;
    to: string | null;
    subject: string | null;
    hasTheWord: string | null;
    doesNotHaveTheWord: string | null;
    hasAttachment: boolean;
    excludeChats: boolean;
    /** Primera etiqueta (Gmail exporta una por filtro) y todas las vistas. */
    label: string | null;
    labels: string[];
    shouldArchive: boolean;
    shouldMarkAsRead: boolean;
    shouldStar: boolean;
    shouldTrash: boolean;
    shouldNeverSpam: boolean;
    shouldAlwaysMarkAsImportant: boolean;
    shouldNeverMarkAsImportant: boolean;
    shouldCategorize: boolean;
    forwardTo: string | null;
    smartLabelToApply: string | null;
    sizeOperator: string | null;
    sizeUnit: string | null;
    size: number | null;
    /** Propiedades no reconocidas (nombre -> valor) para informar en `unmapped`. */
    other: Record<string, string>;
}

export interface GmailParseResult { filters: GmailFilter[]; invalid: number }

export const MAX_GMAIL_FILTERS = 5_000;
const MAX_VALUE = 4_000;
const XML_LIMITS: Partial<XmlLimits> = { maxBytes: 8 * 1024 * 1024, maxNodes: 200_000 };

const TRUE = (v: string) => /^(true|1|yes)$/i.test(v.trim());

function emptyFilter(): GmailFilter {
    return {
        from: null, to: null, subject: null, hasTheWord: null, doesNotHaveTheWord: null, hasAttachment: false, excludeChats: false,
        label: null, labels: [], shouldArchive: false, shouldMarkAsRead: false, shouldStar: false, shouldTrash: false, shouldNeverSpam: false,
        shouldAlwaysMarkAsImportant: false, shouldNeverMarkAsImportant: false, shouldCategorize: false, forwardTo: null, smartLabelToApply: null,
        sizeOperator: null, sizeUnit: null, size: null, other: Object.create(null),
    };
}

/** Lee el Atom de filtros. Nunca lanza: XML invalido => `{ filters: [], invalid: 1 }`. */
export function parseGmailFilters(xml: string | Buffer): GmailParseResult {
    const out: GmailParseResult = { filters: [], invalid: 0 };
    let root;
    try {
        root = parseXml(xml, XML_LIMITS);
    } catch {
        return { filters: [], invalid: 1 };
    }
    try {
        const entries = root.local === 'entry' ? [root] : findAll(root, 'entry', MAX_GMAIL_FILTERS + 1);
        for (const entry of entries) {
            if (out.filters.length >= MAX_GMAIL_FILTERS) { out.invalid++; break; }
            const props = findAllDirect(entry);
            if (!props.length) { out.invalid++; continue; }
            const f = emptyFilter();
            let known = 0;
            for (const { name, value } of props) {
                const v = value.slice(0, MAX_VALUE);
                switch (name) {
                    case 'from': case 'to': case 'subject': case 'hasTheWord': case 'doesNotHaveTheWord':
                    case 'forwardTo': case 'smartLabelToApply': case 'sizeOperator': case 'sizeUnit':
                        (f as any)[name] = v.trim() || null; known++; break;
                    case 'label':
                        if (v.trim()) { f.labels.push(v.trim()); f.label ??= v.trim(); }
                        known++; break;
                    case 'hasAttachment': case 'excludeChats': case 'shouldArchive': case 'shouldMarkAsRead': case 'shouldStar': case 'shouldTrash':
                    case 'shouldNeverSpam': case 'shouldAlwaysMarkAsImportant': case 'shouldNeverMarkAsImportant': case 'shouldCategorize':
                        (f as any)[name] = TRUE(v); known++; break;
                    case 'size': {
                        const n = Number(v.trim());
                        f.size = Number.isFinite(n) && n >= 0 ? n : null;
                        known++; break;
                    }
                    default:
                        if (Object.keys(f.other).length < 50 && name !== '__proto__') f.other[name.slice(0, 80)] = v;
                }
            }
            if (!known && !Object.keys(f.other).length) { out.invalid++; continue; }
            out.filters.push(f);
        }
    } catch {
        out.invalid++;
    }
    return out;
}

function findAllDirect(entry: XmlElement): Array<{ name: string; value: string }> {
    const res: Array<{ name: string; value: string }> = [];
    for (const c of entry.children) {
        if (typeof c === 'string' || c.local !== 'property') continue;
        const name = c.attrs.name;
        if (!name) continue;
        res.push({ name, value: c.attrs.value !== undefined ? c.attrs.value : textOf(c) });
        if (res.length >= 200) break;
    }
    return res;
}

// ---------------------------------------------------------------------------
// Sintaxis de busqueda de Gmail (subconjunto)
// ---------------------------------------------------------------------------

interface Tok { neg: boolean; key: string | null; kind: 'word' | 'phrase' | 'brace' | 'paren' | 'or'; text: string }

function tokenize(q: string): Tok[] | null {
    const toks: Tok[] = [];
    let i = 0;
    const n = q.length;
    while (i < n) {
        while (i < n && /\s/.test(q[i])) i++;
        if (i >= n) break;
        let neg = false;
        if (q[i] === '-' && i + 1 < n && !/\s/.test(q[i + 1])) { neg = true; i++; }
        let key: string | null = null;
        const km = /^([A-Za-z_]{1,20}):(?=\S)/.exec(q.slice(i, i + 22));
        if (km) { key = km[1].toLowerCase(); i += km[0].length; }
        const c = q[i];
        if (c === '"') {
            const end = q.indexOf('"', i + 1);
            if (end < 0) return null;
            toks.push({ neg, key, kind: 'phrase', text: q.slice(i + 1, end) });
            i = end + 1;
        } else if (c === '{' || c === '(') {
            const close = c === '{' ? '}' : ')';
            let depth = 1;
            let j = i + 1;
            let inQ = false;
            for (; j < n; j++) {
                if (q[j] === '"') inQ = !inQ;
                else if (!inQ && q[j] === c) depth++;
                else if (!inQ && q[j] === close && --depth === 0) break;
            }
            if (j >= n) return null;
            toks.push({ neg, key, kind: c === '{' ? 'brace' : 'paren', text: q.slice(i + 1, j) });
            i = j + 1;
        } else {
            let j = i;
            while (j < n && !/\s/.test(q[j])) j++;
            const w = q.slice(i, j);
            i = j;
            if (!neg && !key && (w === 'OR' || w === '|')) toks.push({ neg: false, key: null, kind: 'or', text: w });
            else if (w) toks.push({ neg, key, kind: 'word', text: w });
        }
    }
    return toks;
}

const simple = (t: Tok) => (t.kind === 'word' || t.kind === 'phrase') && !t.neg;

/** Valores alternativos (OR) de un token; null si no es una lista simple. */
function atomValues(t: Tok): string[] | null {
    if (t.neg) return null;
    if (t.kind === 'word' || t.kind === 'phrase') return t.text ? [t.text] : null;
    const inner = tokenize(t.text);
    if (!inner || !inner.length) return null;
    if (t.kind === 'brace') return inner.every((x) => simple(x) && !x.key) ? inner.map((x) => x.text).filter(Boolean) : null;
    // parentesis: solo listas "a OR b OR c"
    const vals: string[] = [];
    let expectValue = true;
    for (const x of inner) {
        if (x.kind === 'or') { if (expectValue) return null; expectValue = true; continue; }
        if (!simple(x) || x.key || !expectValue) return null;
        vals.push(x.text);
        expectValue = false;
    }
    return vals.length && !expectValue ? vals : null;
}

type FieldName = 'from' | 'to' | 'subject' | 'body';
type CondDraft =
    | { kind: 'text'; field: FieldName; any: string[] }
    | { kind: 'attachment' }
    | { kind: 'label'; name: string };

interface Interp { conds: CondDraft[]; problems: string[] }

function cleanValue(field: FieldName, v: string): string {
    let s = v.trim();
    if (field !== 'body' && field !== 'subject') s = s.replace(/^\*+/, '');
    return s.trim();
}

function interpret(q: string, defaultField: FieldName): Interp {
    const res: Interp = { conds: [], problems: [] };
    let toks = tokenize(q);
    if (!toks) { res.problems.push(`sintaxis no reconocida: ${q.slice(0, 60)}`); return res; }
    if (toks.length === 1 && toks[0].kind === 'paren' && !toks[0].key && !toks[0].neg) {
        const inner = tokenize(toks[0].text);
        if (inner) toks = inner;
    }
    // Agrupa por OR (OR liga mas fuerte que el AND implicito)
    const items: Tok[][] = [];
    for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (t.kind === 'or') {
            const prev = items[items.length - 1];
            const next = toks[i + 1];
            if (prev && next && next.kind !== 'or') { prev.push(next); i++; }
            continue;
        }
        items.push([t]);
    }
    for (const item of items) {
        const keys = new Set(item.map((t) => t.key));
        if (item.some((t) => t.neg)) { res.problems.push(`negacion: -${item[0].text.slice(0, 60)}`); continue; }
        if (keys.size !== 1) { res.problems.push('OR entre operadores distintos'); continue; }
        const key = item[0].key;
        let field: FieldName = defaultField;
        if (key === 'has' && item.length === 1 && item[0].text.toLowerCase() === 'attachment') { res.conds.push({ kind: 'attachment' }); continue; }
        if (key === 'label' && item.length === 1 && item[0].kind !== 'brace' && item[0].kind !== 'paren') { res.conds.push({ kind: 'label', name: item[0].text }); continue; }
        if (key === 'from' || key === 'to' || key === 'subject') field = key;
        else if (key) { res.problems.push(`operador ${key}:`); continue; }
        const vals: string[] = [];
        let ok = true;
        for (const t of item) {
            const v = atomValues(t);
            if (!v) { ok = false; break; }
            vals.push(...v);
        }
        const clean = vals.map((v) => cleanValue(field, v)).filter(Boolean);
        if (!ok || !clean.length || clean.some((v) => v.includes('*'))) { res.problems.push(`expresion no soportada: ${item.map((t) => t.text).join(' OR ').slice(0, 60)}`); continue; }
        res.conds.push({ kind: 'text', field, any: [...new Set(clean)] });
    }
    return res;
}

// ---------------------------------------------------------------------------
// Mapeo Gmail -> motor de reglas
// ---------------------------------------------------------------------------

export type MappedAction = Action | { type: 'addLabelByName'; name: string };

export interface RuleDraft {
    name: string;
    conditions: RuleConditions;
    actions: MappedAction[];
    stopProcessing: boolean;
}

export interface GmailMapContext {
    /** Posicion del filtro (para nombrar reglas sin texto). */
    index?: number;
    /** 'skip' (defecto): no crear si queda una condicion restrictiva sin mapear. 'safe': crear solo si las acciones son inocuas. */
    partial?: 'skip' | 'safe';
    /** Maximo de reglas en que se puede dividir un filtro con listas OR muy largas. */
    maxSplit?: number;
}

export interface GmailMapResult {
    /** Primera regla (compatibilidad); `rules` contiene todas (varias si se dividio una lista OR muy larga). */
    rule: RuleDraft | null;
    rules: RuleDraft[];
    labelNames: string[];
    /** "clave: motivo" de cada propiedad/condicion que el motor no puede representar. */
    unmapped: string[];
    /** Motivo por el que no se crea ninguna regla (null si se creo). */
    skipped: string | null;
}

const SMART_LABELS: Record<string, string> = {
    '^smartlabel_personal': 'Category Personal',
    '^smartlabel_social': 'Category Social',
    '^smartlabel_promo': 'Category Promotions',
    '^smartlabel_notification': 'Category Updates',
    '^smartlabel_group': 'Category Forums',
};

export function escapeRegexLiteral(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Nombre de etiqueta valido para la app (sin comas/controles, <= 50). */
export function safeLabelName(raw: string): string {
    // eslint-disable-next-line no-control-regex
    return raw.replace(/[\u0000-\u001f\u007f,]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_NAME);
}

const MAX_ITEMS = 20;
const MAX_VALUE_LEN = 500;

/** Divide alternativas en trozos cuyo regex `a|b|c` cabe en MAX_REGEX_LENGTH y es aceptado por validateUserRegex. */
function regexChunks(values: string[]): string[] | null {
    const chunks: string[] = [];
    let cur: string[] = [];
    const flush = () => {
        if (!cur.length) return true;
        const pat = cur.map(escapeRegexLiteral).join('|');
        if (!validateUserRegex(pat).ok) return false;
        chunks.push(pat);
        cur = [];
        return true;
    };
    for (const v of values) {
        const esc = escapeRegexLiteral(v);
        if (esc.length > MAX_REGEX_LENGTH || !validateUserRegex(esc).ok) return null;
        const next = [...cur, v].map(escapeRegexLiteral).join('|');
        if (next.length > MAX_REGEX_LENGTH) { if (!flush()) return null; }
        cur.push(v);
    }
    if (!flush()) return null;
    return chunks;
}

function ruleName(f: GmailFilter, ctx: GmailMapContext, suffix: string): string {
    const hint = f.from ?? f.to ?? f.subject ?? f.hasTheWord ?? null;
    const base = hint ? `Gmail: ${hint.replace(/\s+/g, ' ').trim()}` : `Gmail filtro ${(ctx.index ?? 0) + 1}`;
    return (base.slice(0, 80 - suffix.length) + suffix).trim();
}

export function mapGmailFilter(f: GmailFilter, ctx: GmailMapContext = {}): GmailMapResult {
    const unmapped: string[] = [];
    const restrictive: string[] = [];
    const conds: CondDraft[] = [];

    for (const [field, q] of [['from', f.from], ['to', f.to], ['subject', f.subject], ['body', f.hasTheWord]] as Array<[FieldName, string | null]>) {
        if (!q) continue;
        const it = interpret(q, field);
        conds.push(...it.conds);
        const key = field === 'body' ? 'hasTheWord' : field;
        for (const p of it.problems) restrictive.push(`${key}: ${p}`);
    }
    if (f.hasAttachment) conds.push({ kind: 'attachment' });
    if (f.doesNotHaveTheWord) restrictive.push('doesNotHaveTheWord: el motor de reglas no tiene negacion y validateUserRegex rechaza lookahead');
    if (f.size !== null || f.sizeOperator || f.sizeUnit) restrictive.push('size: el motor de reglas no evalua el tamano del mensaje');
    for (const [k, v] of Object.entries(f.other)) {
        unmapped.push(`${k}: propiedad desconocida${v ? ` (${v.slice(0, 40)})` : ''}`);
    }

    // Acciones
    const labelNames: string[] = [];
    const actions: MappedAction[] = [];
    for (const l of f.labels) {
        const nm = safeLabelName(l);
        if (!nm) { unmapped.push(`label: nombre invalido (${l.slice(0, 40)})`); continue; }
        if (nm !== l.trim()) unmapped.push(`label: nombre ajustado a "${nm}" (comas/longitud)`);
        if (!labelNames.includes(nm)) { labelNames.push(nm); actions.push({ type: 'addLabelByName', name: nm }); }
    }
    if (f.smartLabelToApply) {
        const nm = SMART_LABELS[f.smartLabelToApply.toLowerCase()];
        if (nm) { if (!labelNames.includes(nm)) { labelNames.push(nm); actions.push({ type: 'addLabelByName', name: nm }); } } else unmapped.push(`smartLabelToApply: categoria desconocida (${f.smartLabelToApply.slice(0, 40)})`);
    }
    if (f.shouldMarkAsRead) actions.push({ type: 'markRead' });
    if (f.shouldStar) actions.push({ type: 'star' });
    if (f.shouldTrash) actions.push({ type: 'delete' });
    else if (f.shouldArchive) actions.push({ type: 'archive' });
    if (f.shouldTrash && f.shouldArchive) unmapped.push('shouldArchive: redundante con shouldTrash (gana la papelera)');
    if (f.forwardTo) unmapped.push('forwardTo: el reenvio automatico no se importa nunca (evita fugas de correo)');
    if (f.shouldNeverSpam) unmapped.push('shouldNeverSpam: el motor no puede sacar correo de spam (la clasificacion de spam es previa a las reglas)');
    if (f.shouldAlwaysMarkAsImportant) unmapped.push('shouldAlwaysMarkAsImportant: la app no tiene marca de importancia');
    if (f.shouldNeverMarkAsImportant) unmapped.push('shouldNeverMarkAsImportant: la app no tiene marca de importancia');
    if (f.shouldCategorize) unmapped.push('shouldCategorize: categorias de Gmail no existen en la app');

    const fail = (skipped: string): GmailMapResult => ({ rule: null, rules: [], labelNames: [], unmapped: [...restrictive, ...unmapped], skipped });

    if (restrictive.length) {
        const harmless = actions.length > 0 && actions.every((a) => a.type === 'addLabelByName' || a.type === 'markRead' || a.type === 'star');
        if (ctx.partial === 'safe' && harmless) unmapped.unshift(...restrictive.map((r) => `${r} (regla creada mas amplia que el filtro original)`));
        else return fail('condicion sin equivalente: la regla seria mas amplia que el filtro de Gmail');
    }
    if (!conds.length) return fail('sin condiciones mapeables');
    if (!actions.length) return fail('sin acciones mapeables');

    // Condiciones del motor
    const maxSplit = Math.max(1, Math.min(ctx.maxSplit ?? 8, 12));
    const toItem = (c: CondDraft): Condition | null => {
        if (c.kind === 'attachment') return { field: 'hasAttachment', value: true };
        if (c.kind === 'label') return c.name.length <= 100 ? { field: 'label', value: c.name } : null;
        if (c.any.length === 1) return c.any[0].length <= MAX_VALUE_LEN ? { field: c.field, op: 'contains', value: c.any[0] } : null;
        return null;
    };

    let variants: RuleConditions[] = [];
    const multi = conds.filter((c) => c.kind === 'text' && c.any.length > 1) as Array<Extract<CondDraft, { kind: 'text' }>>;
    if (conds.length === 1 && multi.length === 1 && multi[0].any.length <= MAX_ITEMS && multi[0].any.every((v) => v.length <= MAX_VALUE_LEN)) {
        variants = [{ match: 'any', items: multi[0].any.map((v) => ({ field: multi[0].field, op: 'contains', value: v }) as Condition) }];
    } else {
        if (multi.length > 1) return fail('varias listas OR simultaneas no caben en una regla');
        const single: Condition[] = [];
        for (const c of conds) {
            if (c.kind === 'text' && c.any.length > 1) continue;
            const it = toItem(c);
            if (!it) return fail('valor de condicion demasiado largo');
            single.push(it);
        }
        if (multi.length === 1) {
            const chunks = regexChunks(multi[0].any);
            if (!chunks) return fail('lista OR con valores que el motor no puede expresar como regex segura');
            if (chunks.length > maxSplit) return fail(`lista OR demasiado larga (${multi[0].any.length} valores)`);
            variants = chunks.map((pat) => ({ match: 'all' as const, items: [...single, { field: multi[0].field, op: 'regex', value: pat } as Condition] }));
        } else {
            variants = [{ match: 'all', items: single }];
        }
    }
    if (variants.some((v) => v.items.length > MAX_ITEMS)) return fail('demasiadas condiciones');

    const rules: RuleDraft[] = variants.map((conditions, i) => ({
        name: ruleName(f, ctx, variants.length > 1 ? ` (${i + 1}/${variants.length})` : ''),
        conditions,
        actions,
        stopProcessing: false,
    }));
    return { rule: rules[0], rules, labelNames, unmapped, skipped: null };
}

// ---------------------------------------------------------------------------
// Reglas propias -> XML de Gmail
// ---------------------------------------------------------------------------

export interface StoredRuleLike {
    name?: string;
    enabled?: boolean;
    conditions: RuleConditions | Condition[] | unknown;
    actions: Action[] | unknown;
}

export interface FiltersXmlResult { xml: string; skipped: Array<{ name: string; reason: string }>; exported: number }

const quoteTerm = (v: string) => (/[\s"{}()|]/.test(v) || /^-|^OR$/.test(v) ? `"${v.replace(/"/g, '')}"` : v);

/** Si el regex es una alternancia de literales (como las que genera mapGmailFilter), devuelve los literales. */
export function literalAlternatives(pattern: string): string[] | null {
    const alts = pattern.split(/(?<!\\)\|/);
    const out: string[] = [];
    for (const a of alts) {
        if (!a) return null;
        let lit = '';
        for (let i = 0; i < a.length; i++) {
            const c = a[i];
            if (c === '\\') {
                const nx = a[i + 1];
                if (nx === undefined || /[A-Za-z0-9]/.test(nx)) return null;
                lit += nx; i++;
            } else if (/[.*+?^${}()[\]]/.test(c)) return null;
            else lit += c;
        }
        out.push(lit);
    }
    return out;
}

type Prop = [string, string];

export function buildGmailFiltersXmlEx(rules: StoredRuleLike[], labelNameById: Map<string, string>, opts: { now?: Date } = {}): FiltersXmlResult {
    const now = (opts.now ?? new Date()).toISOString().replace(/\.\d+Z$/, 'Z');
    const skipped: FiltersXmlResult['skipped'] = [];
    const entries: Prop[][] = [];

    for (const r of rules) {
        const name = String(r.name ?? 'regla');
        if (r.enabled === false) { skipped.push({ name, reason: 'regla desactivada (Gmail no tiene filtros desactivados)' }); continue; }
        // Las reglas guardadas son v2 (arbol). Gmail solo expresa una lista plana Y (o O de un mismo campo): se aplana cuando es posible.
        const v2root = toV2(r.conditions).root;
        if (v2root.op === 'not' || v2root.children.some((c) => isGroup(c))) { skipped.push({ name, reason: 'condiciones anidadas o negadas no expresables en Gmail' }); continue; }
        const raw: any = { match: v2root.op === 'or' ? 'any' : 'all', items: (v2root.children as any[]).map((c) => (c.field === 'hasLabel' ? { field: 'label', value: c.value } : c)) };
        const match: 'all' | 'any' = raw && !Array.isArray(raw) && raw.match === 'any' ? 'any' : 'all';
        const items: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
        if (!items.length) { skipped.push({ name, reason: 'sin condiciones' }); continue; }

        const perField: Record<string, string[][]> = { from: [], to: [], subject: [], body: [] };
        const props: Prop[] = [];
        const bodyExtras: string[] = [];
        let bad: string | null = null;
        const fieldAlts = (it: any): string[] | null => {
            if (it.op === 'regex') return literalAlternatives(String(it.value));
            if (it.op === 'contains' || it.op === 'equals') return [String(it.value)];
            return null;
        };
        if (match === 'any') {
            const textItems = items.filter((i) => i && ['from', 'to', 'subject', 'body'].includes(i.field));
            if (textItems.length !== items.length || new Set(textItems.map((i) => i.field)).size !== 1 || textItems.some((i) => i.op === 'equals')) {
                bad = 'condiciones "cualquiera" no expresables en Gmail salvo una lista de un mismo campo';
            } else {
                const alts: string[] = [];
                for (const it of textItems) { const a = fieldAlts(it); if (!a) { bad = 'regex no expresable en Gmail'; break; } alts.push(...a); }
                if (!bad) perField[textItems[0].field].push(alts);
            }
        } else {
            for (const it of items) {
                if (!it || typeof it !== 'object') { bad = 'condicion invalida'; break; }
                if (it.field === 'hasAttachment') {
                    if (it.value === false) { bad = 'hasAttachment=false no expresable en Gmail'; break; }
                    props.push(['hasAttachment', 'true']);
                } else if (it.field === 'label') {
                    bodyExtras.push(`label:${quoteTerm(String(it.value))}`);
                } else if (['from', 'to', 'subject', 'body'].includes(it.field)) {
                    const a = fieldAlts(it);
                    if (!a) { bad = 'regex no expresable en Gmail'; break; }
                    perField[it.field].push(it.op === 'equals' ? [`"${a[0].replace(/"/g, '')}"`] : a);
                } else { bad = 'campo desconocido'; break; }
            }
        }
        if (bad) { skipped.push({ name, reason: bad }); continue; }

        const term = (alts: string[]) => {
            if (alts.length === 1) return alts[0].startsWith('"') ? alts[0] : quoteTerm(alts[0]);
            return alts.length ? `{${alts.map((a) => (a.startsWith('"') ? a : quoteTerm(a))).join(' ')}}` : '';
        };
        for (const f of ['from', 'to', 'subject'] as const) {
            if (perField[f].length) props.push([f, perField[f].map(term).join(' ')]);
        }
        const bodyTerms = [...perField.body.map(term), ...bodyExtras];
        if (bodyTerms.length) props.push(['hasTheWord', bodyTerms.join(' ')]);

        const acts: any[] = Array.isArray(r.actions) ? (r.actions as any[]) : [];
        const flags: Prop[] = [];
        const labels: string[] = [];
        let unsupported = false;
        for (const a of acts) {
            switch (a?.type) {
                case 'addLabel': {
                    const nm = labelNameById.get(String(a.labelId));
                    if (nm) labels.push(nm); else unsupported = true;
                    break;
                }
                case 'markRead': flags.push(['shouldMarkAsRead', 'true']); break;
                case 'star': flags.push(['shouldStar', 'true']); break;
                case 'archive': flags.push(['shouldArchive', 'true']); break;
                case 'delete': flags.push(['shouldTrash', 'true']); break;
                case 'moveToFolder':
                    if (a.folder === 'archive') flags.push(['shouldArchive', 'true']);
                    else if (a.folder === 'trash') flags.push(['shouldTrash', 'true']);
                    else if (a.folder !== 'inbox') unsupported = true;
                    break;
                default: unsupported = true;
            }
        }
        if (!flags.length && !labels.length) { skipped.push({ name, reason: unsupported ? 'acciones no expresables en Gmail' : 'sin acciones' }); continue; }
        const uniq = (list: Prop[]) => list.filter((p, i) => list.findIndex((q) => q[0] === p[0]) === i);
        if (!labels.length) entries.push([...props, ...uniq(flags)]);
        else for (const l of labels) entries.push([...props, ['label', l], ...uniq(flags)]);
    }

    const parts: string[] = [
        "<?xml version='1.0' encoding='UTF-8'?>",
        "<feed xmlns='http://www.w3.org/2005/Atom' xmlns:apps='http://schemas.google.com/apps/2006'>",
        '<title>Mail Filters</title>',
        `<id>tag:mail.google.com,2008:filters:bloomx</id>`,
        `<updated>${now}</updated>`,
        '<author><name>BloomX</name></author>',
    ];
    entries.forEach((props, i) => {
        parts.push('<entry>', "<category term='filter'></category>", '<title>Mail Filter</title>',
            `<id>tag:mail.google.com,2008:filter:bloomx${i + 1}</id>`, `<updated>${now}</updated>`, '<content></content>');
        for (const [k, v] of props) parts.push(`<apps:property name='${escapeXml(k)}' value='${escapeXml(v)}'/>`);
        parts.push('</entry>');
    });
    parts.push('</feed>');
    return { xml: parts.join('\n') + '\n', skipped, exported: entries.length };
}

export function buildGmailFiltersXml(rules: StoredRuleLike[], labelNameById: Map<string, string>, opts: { now?: Date } = {}): string {
    return buildGmailFiltersXmlEx(rules, labelNameById, opts).xml;
}
