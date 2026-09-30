/**
 * Condiciones de reglas v2: arbol de grupos (AND / OR / NOT) con hojas tipadas.
 * Puro (sin BD ni red), determinista y seguro:
 *  - Logica de TRES valores (true / false / desconocido). Un dato ausente (p. ej. cabeceras de un correo antiguo)
 *    hace que la condicion sea "desconocida": nunca coincide, tampoco bajo una negacion (NOT / notContains).
 *  - Texto acotado a 20 KB, regex con las defensas de regex-safety y presupuesto de tiempo por regla.
 *  - Validador estricto con zod (limites: profundidad 4, 30 condiciones, 100 valores por lista).
 *
 * Esquema almacenado: { v: 2, root: Group }. Grupo: { type:'group', op:'and'|'or'|'not', children:[...] }.
 * 'not' = NINGUNA de las condiciones hijas coincide (con un solo hijo es la negacion simple).
 * Las reglas v1 ({match, items} o un array de condiciones) se leen con `toV2`.
 */
import { z } from 'zod';
import { compileSafeRegex, validateUserRegex, MAX_REGEX_INPUT } from './regex-safety';
import { splitAddressList } from '../email-utils';

export const CONDITIONS_VERSION = 2 as const;
export const MAX_DEPTH = 4;
export const MAX_LEAVES = 30;
export const MAX_VALUE_LENGTH = 500;
export const MAX_LIST_ITEMS = 100;
export const MAX_TEXT_INPUT = MAX_REGEX_INPUT; // 20 KB
/** Presupuesto de evaluacion por regla y correo (ms). Al agotarse, las hojas restantes quedan "desconocidas". */
export const RULE_TIME_BUDGET_MS = 75;

export const TEXT_FIELDS = [
    'from', 'fromName', 'fromDomain', 'to', 'cc', 'bcc', 'toDomain', 'replyTo',
    'subject', 'body', 'bodyHtml', 'attachmentName', 'attachmentType', 'toAlias', 'language',
] as const;
export type TextField = (typeof TEXT_FIELDS)[number];

export const TEXT_OPS = [
    'contains', 'notContains', 'equals', 'notEquals', 'startsWith', 'endsWith', 'regex', 'notRegex',
    'in', 'notIn', 'containsAny', 'wildcard', 'notWildcard',
] as const;
export type TextOp = (typeof TEXT_OPS)[number];
/** Operadores que reciben una lista de valores. */
export const LIST_OPS: readonly TextOp[] = ['in', 'notIn', 'containsAny', 'wildcard', 'notWildcard'];

export const NUM_FIELDS = ['attachmentCount', 'size', 'attachmentsSize', 'hour', 'dayOfWeek', 'spamScore'] as const;
export type NumField = (typeof NUM_FIELDS)[number];
export const NUM_OPS = ['lt', 'lte', 'eq', 'gte', 'gt'] as const;
export type NumOp = (typeof NUM_OPS)[number];

export const BOOL_FIELDS = [
    'hasAttachment', 'isReply', 'isForward', 'isThread', 'senderInContacts', 'senderIsMe', 'isCalendarInvite', 'isRead', 'isStarred', 'isExternal',
] as const;
export type BoolField = (typeof BOOL_FIELDS)[number];

export const CONDITION_FOLDERS = ['inbox', 'sent', 'drafts', 'scheduled', 'archive', 'trash', 'spam'] as const;

/** Cabeceras que se guardan y se pueden evaluar (lista blanca; nunca se persisten otras). */
export const HEADER_WHITELIST = [
    'list-id', 'list-unsubscribe', 'list-unsubscribe-post', 'precedence', 'auto-submitted', 'x-mailer', 'reply-to',
    'authentication-results', 'x-spam-flag', 'x-spam-status', 'x-spam-score', 'x-auto-response-suppress', 'x-priority', 'importance',
    'in-reply-to', 'references', 'message-id', 'return-path', 'user-agent', 'x-original-sender',
] as const;
export type HeaderName = (typeof HEADER_WHITELIST)[number];
export const HEADER_VALUE_MAX = 300;
export const HDRS_MAX_BYTES = 4096;

export const AUTH_MECHS = ['spf', 'dkim', 'dmarc'] as const;
export const AUTH_RESULTS = ['pass', 'fail', 'none'] as const;

export const LANGUAGES = ['es', 'en', 'pt', 'fr', 'de', 'it'] as const;

// ---------- Tipos ----------

interface TextOptions { caseSensitive?: boolean; wholeWord?: boolean; subdomains?: boolean }
export type TextLeaf = { field: TextField; op: TextOp; value?: string; values?: string[] } & TextOptions;
export type NumLeaf =
    | { field: NumField; op: NumOp; value: number; tz?: string }
    | { field: 'hour' | 'dayOfWeek'; op: 'in' | 'notIn'; values: number[]; tz?: string };
export type DateLeaf = { field: 'date'; op: 'before' | 'after' | 'between'; value: string; value2?: string };
export type BoolLeaf = { field: BoolField; value: boolean };
export type LabelLeaf = { field: 'hasLabel'; value: string };
export type FolderLeaf = { field: 'inFolder'; value: string };
export type HeaderLeaf = { field: 'header'; name: string; op: 'exists' | 'notExists' | TextOp; value?: string; values?: string[] } & TextOptions;
export type AuthLeaf = { field: 'auth'; mech: (typeof AUTH_MECHS)[number]; value: (typeof AUTH_RESULTS)[number] };
export type Leaf = TextLeaf | NumLeaf | DateLeaf | BoolLeaf | LabelLeaf | FolderLeaf | HeaderLeaf | AuthLeaf;

export interface Group { type: 'group'; op: 'and' | 'or' | 'not'; children: Node[] }
export type Node = Group | Leaf;
export interface ConditionsV2 { v: 2; root: Group }

export const isGroup = (n: Node): n is Group => (n as Group)?.type === 'group' && Array.isArray((n as Group).children);

// ---------- Contexto del correo ----------

export interface AttachmentInfo { name: string; type: string; size: number }

/**
 * Datos del correo que las condiciones pueden consultar. Todo lo opcional que falte se trata como DESCONOCIDO
 * (la condicion no coincide), salvo lo indicado.
 */
export interface EmailContext {
    from: string;
    to: string;
    subject: string;
    body: string;
    hasAttachment: boolean;
    labelIds: string[];
    /** Rutas completas de las etiquetas ("Trabajo/Proyecto A") o nombres. */
    labelNames?: string[];
    cc?: string | null;
    bcc?: string | null;
    replyTo?: string | null;
    bodyHtml?: string | null;
    attachments?: AttachmentInfo[];
    /** Tamano aproximado en bytes (adjuntos + cuerpo). */
    size?: number;
    date?: Date | string | number | null;
    /** Cabeceras de la lista blanca en minuscula. undefined/null = no guardadas (correo antiguo). */
    hdrs?: Record<string, string> | null;
    inReplyTo?: string | null;
    isThread?: boolean | null;
    senderInContacts?: boolean | null;
    ownAddresses?: string[];
    aliasSuffixes?: string[];
    folder?: string;
    read?: boolean;
    starred?: boolean;
    spamScore?: number | null;
    /** Remitente fuera de los dominios propios/internos (lo fija el filtro de spam al recibir). null/undefined = desconocido. */
    isExternal?: boolean | null;
}

// ---------- Validacion (zod, estricto) ----------

const short = z.string().max(MAX_VALUE_LENGTH);
const listOf = z.array(z.string().min(1).max(255)).min(1).max(MAX_LIST_ITEMS);
const optBool = z.boolean().optional();
const tzSchema = z.string().max(64).refine((tz) => {
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}, 'Zona horaria invalida');
const isoDate = z.string().max(40).refine((s) => !Number.isNaN(new Date(s).getTime()), 'Fecha invalida');

const textLeafSchema = z.object({
    field: z.enum(TEXT_FIELDS),
    op: z.enum(TEXT_OPS),
    value: short.optional(),
    values: listOf.optional(),
    caseSensitive: optBool,
    wholeWord: optBool,
    subdomains: optBool,
}).strict();
const numLeafSchema = z.object({
    field: z.enum(NUM_FIELDS),
    op: z.enum([...NUM_OPS, 'in', 'notIn']),
    value: z.number().finite().min(-1e12).max(1e12).optional(),
    values: z.array(z.number().finite().min(0).max(1e6)).min(1).max(MAX_LIST_ITEMS).optional(),
    tz: tzSchema.optional(),
}).strict();
const dateLeafSchema = z.object({
    field: z.literal('date'),
    op: z.enum(['before', 'after', 'between']),
    value: isoDate,
    value2: isoDate.optional(),
}).strict();
const boolLeafSchema = z.object({ field: z.enum(BOOL_FIELDS), value: z.boolean() }).strict();
const labelLeafSchema = z.object({ field: z.literal('hasLabel'), value: z.string().trim().min(1).max(200) }).strict();
const folderLeafSchema = z.object({ field: z.literal('inFolder'), value: z.enum(CONDITION_FOLDERS) }).strict();
const headerLeafSchema = z.object({
    field: z.literal('header'),
    name: z.string().transform((s) => s.trim().toLowerCase()).pipe(z.enum(HEADER_WHITELIST)),
    op: z.enum(['exists', 'notExists', ...TEXT_OPS]),
    value: short.optional(),
    values: listOf.optional(),
    caseSensitive: optBool,
    wholeWord: optBool,
    subdomains: optBool,
}).strict();
const authLeafSchema = z.object({
    field: z.literal('auth'),
    mech: z.enum(AUTH_MECHS),
    value: z.enum(AUTH_RESULTS),
}).strict();
const groupSchema = z.object({
    type: z.literal('group'),
    op: z.enum(['and', 'or', 'not']),
    children: z.array(z.unknown()).min(1).max(MAX_LEAVES),
}).strict();

/** Separa "a, b; c" en una lista limpia, sin repetidos ni vacios (maximo MAX_LIST_ITEMS). */
export function parseList(value: string | undefined, values?: string[]): string[] {
    const src = values && values.length ? values : String(value ?? '').split(/[,;\n]/);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of src) {
        const s = String(raw).trim();
        if (!s || seen.has(s.toLowerCase())) continue;
        seen.add(s.toLowerCase());
        out.push(s);
        if (out.length >= MAX_LIST_ITEMS) break;
    }
    return out;
}

const fail = (error: string) => ({ ok: false as const, error });

function validateTextValue(leaf: { op: string; value?: string; values?: string[]; field?: string }): string | null {
    const op = leaf.op as TextOp;
    if (LIST_OPS.includes(op)) {
        const list = parseList(leaf.value, leaf.values);
        if (list.length === 0) return 'La lista de valores esta vacia';
        if (op === 'wildcard' || op === 'notWildcard') {
            if (list.some((p) => p.length > 255)) return 'Patron demasiado largo';
        }
        return null;
    }
    const v = typeof leaf.value === 'string' ? leaf.value.trim() : '';
    if (!v) return 'Valor de condicion vacio';
    if (op === 'regex' || op === 'notRegex') {
        const r = validateUserRegex(v);
        if (!r.ok) return r.error;
    }
    return null;
}

/** Valida y limpia una hoja. Devuelve la hoja normalizada o un error. */
export function validateLeaf(raw: unknown): { ok: true; leaf: Leaf } | { ok: false; error: string } {
    if (!raw || typeof raw !== 'object') return fail('Condicion invalida');
    const field = (raw as any).field;
    const bad = (label: string, e: z.ZodError) => fail(`${label}: ${e.issues[0]?.message ?? 'invalida'}`);
    if ((TEXT_FIELDS as readonly string[]).includes(field)) {
        const p = textLeafSchema.safeParse(raw);
        if (!p.success) return bad(`Condicion "${field}"`, p.error);
        const l = p.data;
        const err = validateTextValue(l);
        if (err) return fail(err);
        if (l.field === 'language' && !['equals', 'notEquals', 'in', 'notIn'].includes(l.op)) return fail('El idioma solo admite igual / en lista');
        return { ok: true, leaf: cleanText(l) };
    }
    if ((NUM_FIELDS as readonly string[]).includes(field)) {
        const p = numLeafSchema.safeParse(raw);
        if (!p.success) return bad(`Condicion "${field}"`, p.error);
        const l = p.data;
        if (l.op === 'in' || l.op === 'notIn') {
            if (l.field !== 'hour' && l.field !== 'dayOfWeek') return fail('Operador "en lista" solo para hora / dia de la semana');
            if (!l.values?.length) return fail('La lista de valores esta vacia');
            return { ok: true, leaf: { field: l.field, op: l.op, values: l.values, ...(l.tz ? { tz: l.tz } : {}) } };
        }
        if (typeof l.value !== 'number') return fail('Valor numerico requerido');
        if (l.field === 'hour' && (l.value < 0 || l.value > 23)) return fail('La hora debe estar entre 0 y 23');
        if (l.field === 'dayOfWeek' && (l.value < 0 || l.value > 6)) return fail('El dia debe estar entre 0 (domingo) y 6');
        if (l.field !== 'spamScore' && l.value < 0 && l.field !== 'hour') return fail('El valor no puede ser negativo');
        return { ok: true, leaf: { field: l.field, op: l.op as NumOp, value: l.value, ...(l.tz ? { tz: l.tz } : {}) } as NumLeaf };
    }
    if (field === 'date') {
        const p = dateLeafSchema.safeParse(raw);
        if (!p.success) return bad('Condicion de fecha', p.error);
        const l = p.data;
        if (l.op === 'between') {
            if (!l.value2) return fail('Falta la fecha final');
            if (new Date(l.value2).getTime() < new Date(l.value).getTime()) return fail('El rango de fechas esta invertido');
            return { ok: true, leaf: { field: 'date', op: 'between', value: l.value, value2: l.value2 } };
        }
        return { ok: true, leaf: { field: 'date', op: l.op, value: l.value } };
    }
    if ((BOOL_FIELDS as readonly string[]).includes(field)) {
        const p = boolLeafSchema.safeParse(raw);
        if (!p.success) return bad(`Condicion "${field}"`, p.error);
        return { ok: true, leaf: p.data };
    }
    if (field === 'hasLabel' || field === 'label') {
        const p = labelLeafSchema.safeParse({ ...(raw as object), field: 'hasLabel' });
        if (!p.success) return bad('Condicion de etiqueta', p.error);
        return { ok: true, leaf: p.data };
    }
    if (field === 'inFolder') {
        const p = folderLeafSchema.safeParse(raw);
        if (!p.success) return bad('Condicion de carpeta', p.error);
        return { ok: true, leaf: p.data };
    }
    if (field === 'header') {
        const p = headerLeafSchema.safeParse(raw);
        if (!p.success) return bad('Condicion de cabecera', p.error);
        const l = p.data;
        if (l.op !== 'exists' && l.op !== 'notExists') {
            const err = validateTextValue(l as any);
            if (err) return fail(err);
        }
        return { ok: true, leaf: cleanText(l) as HeaderLeaf };
    }
    if (field === 'auth') {
        const p = authLeafSchema.safeParse(raw);
        if (!p.success) return bad('Condicion de autenticacion', p.error);
        return { ok: true, leaf: p.data };
    }
    return fail('Campo de condicion invalido');
}

function cleanText<T extends { op: string; value?: string; values?: string[]; caseSensitive?: boolean; wholeWord?: boolean; subdomains?: boolean }>(l: T): T {
    const out: any = { ...l };
    if (LIST_OPS.includes(l.op as TextOp)) {
        out.values = parseList(l.value, l.values);
        delete out.value;
    } else if (typeof l.value === 'string') {
        out.value = l.value.trim();
        delete out.values;
    }
    for (const k of ['caseSensitive', 'wholeWord', 'subdomains'] as const) {
        if (!out[k]) delete out[k];
    }
    return out;
}

/** Valida un arbol v2 completo (profundidad, cantidad de hojas, grupos y hojas). */
export function validateConditionsV2(raw: unknown): { ok: true; value: ConditionsV2 } | { ok: false; error: string } {
    const conv = toV2Loose(raw);
    if (!conv) return fail('Condiciones invalidas');
    let leaves = 0;
    const walk = (node: unknown, depth: number): Node | string => {
        if (depth > MAX_DEPTH) return `Maximo ${MAX_DEPTH} niveles de grupos anidados`;
        if (node && typeof node === 'object' && (node as any).type === 'group') {
            const g = groupSchema.safeParse(node);
            if (!g.success) return 'Grupo de condiciones invalido';
            const children: Node[] = [];
            for (const c of g.data.children) {
                const r = walk(c, depth + 1);
                if (typeof r === 'string') return r;
                children.push(r);
            }
            return { type: 'group', op: g.data.op, children };
        }
        leaves++;
        if (leaves > MAX_LEAVES) return `Maximo ${MAX_LEAVES} condiciones`;
        const r = validateLeaf(node);
        return r.ok ? r.leaf : r.error;
    };
    const root = walk(conv.root, 1);
    if (typeof root === 'string') return fail(root);
    if (!isGroup(root)) return fail('Condiciones invalidas');
    if (leaves === 0) return fail('Se requiere al menos una condicion');
    return { ok: true, value: { v: 2, root } };
}

// ---------- v1 -> v2 ----------

/** Convierte v1 ({match, items} o array) a v2 SIN validar. null si la forma es irreconocible. */
function toV2Loose(raw: unknown): { root: unknown } | null {
    if (Array.isArray(raw)) return { root: { type: 'group', op: 'and', children: raw.map(v1Leaf) } };
    if (raw && typeof raw === 'object') {
        const o = raw as any;
        if (o.v === 2 || o.root) return { root: o.root };
        if (Array.isArray(o.items) || o.match !== undefined) {
            return { root: { type: 'group', op: o.match === 'any' ? 'or' : 'and', children: (Array.isArray(o.items) ? o.items : []).map(v1Leaf) } };
        }
    }
    return null;
}

function v1Leaf(c: any): unknown {
    if (c && c.field === 'label') return { field: 'hasLabel', value: c.value };
    return c;
}

/** Lee cualquier forma (v1/v2) sin lanzar. Las hojas invalidas se descartan; el resultado puede tener 0 hojas. */
export function toV2(raw: unknown): ConditionsV2 {
    const conv = toV2Loose(raw);
    const empty: ConditionsV2 = { v: 2, root: { type: 'group', op: 'and', children: [] } };
    if (!conv || !conv.root || typeof conv.root !== 'object') return empty;
    let leaves = 0;
    const walk = (node: any, depth: number): Node | null => {
        if (depth > MAX_DEPTH) return null;
        if (node && node.type === 'group' && Array.isArray(node.children)) {
            const op = node.op === 'or' || node.op === 'not' ? node.op : 'and';
            const children = node.children.map((c: any) => walk(c, depth + 1)).filter(Boolean) as Node[];
            return { type: 'group', op, children };
        }
        if (leaves >= MAX_LEAVES) return null;
        const r = validateLeaf(node);
        if (!r.ok) return null;
        leaves++;
        return r.leaf;
    };
    const root = walk(conv.root, 1);
    return root && isGroup(root) ? { v: 2, root } : empty;
}

export function countLeaves(node: Node): number {
    return isGroup(node) ? node.children.reduce((n, c) => n + countLeaves(c), 0) : 1;
}

// ---------- Evaluacion ----------

export type Tri = boolean | null;

interface Addr { raw: string; name: string; address: string; domain: string }

function parseAddr(entry: string): Addr {
    const raw = entry.trim();
    const angled = /^(.*?)<([^<>]*)>\s*$/.exec(raw);
    let name = '';
    let address = raw;
    if (angled) { name = angled[1].trim().replace(/^"+|"+$/g, '').trim(); address = angled[2].trim(); }
    address = address.replace(/^"+|"+$/g, '').toLowerCase();
    if (!address.includes('@')) address = '';
    return { raw, name, address, domain: address ? address.slice(address.lastIndexOf('@') + 1) : '' };
}

const parseAddrList = (v: string | null | undefined): Addr[] => splitAddressList(v ?? '').slice(0, 200).map(parseAddr);

interface Prepared {
    e: EmailContext;
    from: Addr;
    to: Addr[];
    cc: Addr[] | null;
    bcc: Addr[] | null;
    replyTo: Addr[] | null;
    body: string;
    bodyHtml: string | null;
    attachments: AttachmentInfo[] | null;
    time: number | null;
    lang?: string;
}

const prepCache = new WeakMap<object, Prepared>();

function prepare(e: EmailContext): Prepared {
    const hit = prepCache.get(e);
    if (hit) return hit;
    const attachments = Array.isArray(e.attachments) ? e.attachments : e.hasAttachment === false ? [] : null;
    const t = e.date == null ? null : new Date(e.date as any).getTime();
    const replyToSrc = e.replyTo !== undefined ? e.replyTo : e.hdrs ? (e.hdrs['reply-to'] ?? '') : undefined;
    const p: Prepared = {
        e,
        from: parseAddr(e.from || ''),
        to: parseAddrList(e.to),
        cc: e.cc === undefined ? null : parseAddrList(e.cc),
        bcc: e.bcc === undefined ? null : parseAddrList(e.bcc),
        replyTo: replyToSrc === undefined ? null : parseAddrList(replyToSrc),
        body: String(e.body ?? '').slice(0, MAX_TEXT_INPUT),
        bodyHtml: e.bodyHtml == null ? null : String(e.bodyHtml).slice(0, MAX_TEXT_INPUT),
        attachments,
        time: t != null && Number.isFinite(t) ? t : null,
    };
    prepCache.set(e, p);
    return p;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function wildcardRegex(pattern: string, cs: boolean): RegExp {
    const src = pattern.split('*').map((part) => part.split('?').map(escapeRe).join('.')).join('.*');
    return new RegExp(`^${src}$`, cs ? '' : 'i');
}

const WORD_CHARS = '\\p{L}\\p{N}_';
function wordRegex(value: string, cs: boolean): RegExp {
    return new RegExp(`(?<![${WORD_CHARS}])${escapeRe(value)}(?![${WORD_CHARS}])`, cs ? 'u' : 'iu');
}

/** Coincidencia POSITIVA de un candidato con el operador (los operadores "no" se resuelven por negacion arriba). */
function positiveOp(op: TextOp, cand: string, leaf: TextOptions & { value?: string; values?: string[] }, isDomain: boolean): boolean {
    const cs = leaf.caseSensitive === true;
    const norm = (s: string) => (cs ? s : s.toLowerCase());
    const c = norm(cand);
    switch (op) {
        case 'contains': case 'notContains': {
            const v = String(leaf.value ?? '');
            if (!v) return false;
            return leaf.wholeWord ? wordRegex(v, cs).test(cand) : c.includes(norm(v));
        }
        case 'equals': case 'notEquals': return c.trim() === norm(isDomain ? String(leaf.value ?? '').replace(/^s*@/, '') : String(leaf.value ?? '')).trim();
        case 'startsWith': return c.startsWith(norm(String(leaf.value ?? '')));
        case 'endsWith': return c.endsWith(norm(String(leaf.value ?? '')));
        case 'regex': case 'notRegex': {
            const re = compileSafeRegex(String(leaf.value ?? ''), cs ? '' : 'i');
            return re ? re.test(cand.slice(0, MAX_TEXT_INPUT)) : false;
        }
        case 'in': case 'notIn':
            return parseList(leaf.value, leaf.values).some((item) => {
                const it = norm(isDomain ? item.replace(/^@/, '') : item).trim();
                return c.trim() === it || (isDomain && leaf.subdomains === true && c.endsWith('.' + it));
            });
        case 'containsAny':
            return parseList(leaf.value, leaf.values).some((item) => (leaf.wholeWord ? wordRegex(item, cs).test(cand) : c.includes(norm(item))));
        case 'wildcard': case 'notWildcard':
            return parseList(leaf.value, leaf.values).some((item) => wildcardRegex(item, cs).test(cand.trim()));
    }
}

const NEGATED: Partial<Record<TextOp, TextOp>> = {
    notContains: 'contains', notEquals: 'equals', notRegex: 'regex', notIn: 'in', notWildcard: 'wildcard',
};

function domainMatchExtra(op: TextOp, cand: string, leaf: TextOptions & { value?: string; values?: string[] }): boolean {
    // fromDomain/toDomain: "equals" tambien admite subdominios cuando se pide.
    if (op === 'equals' && leaf.subdomains) {
        const it = String(leaf.value ?? '').replace(/^@/, '').trim().toLowerCase();
        return !!it && (cand === it || cand.endsWith('.' + it));
    }
    return false;
}

function textTri(cands: string[] | null, leaf: TextLeaf | HeaderLeaf, isDomain = false): Tri {
    if (cands === null) return null;
    const op = leaf.op as TextOp;
    const base = NEGATED[op] ?? op;
    const anyPos = cands.some((c) => positiveOp(base, c, leaf, isDomain) || (isDomain && domainMatchExtra(base, c.toLowerCase(), leaf)));
    return NEGATED[op] ? !anyPos : anyPos;
}

const dedupe = (a: string[]) => Array.from(new Set(a.filter((x) => x !== '')));

function addrCands(list: Addr[] | null, withRaw: boolean): string[] | null {
    if (list === null) return null;
    return dedupe(list.flatMap((a) => (withRaw ? [a.raw, a.address] : [a.address])));
}

const RE_PREFIX = /^\s*(?:re|aw|sv|res|antw)\s*(?:\[\d+\]|\(\d+\))?\s*:/i;
const FWD_PREFIX = /^\s*(?:fw|fwd|rv|enc|wg|tr|i)\s*:/i;

const STOPWORDS: Record<string, string[]> = {
    es: ['el', 'la', 'los', 'las', 'de', 'que', 'y', 'en', 'un', 'una', 'por', 'con', 'para', 'es', 'no', 'se', 'su', 'al', 'lo', 'como', 'mas', 'pero', 'gracias', 'hola', 'estimado', 'saludos'],
    en: ['the', 'and', 'of', 'to', 'in', 'is', 'that', 'for', 'it', 'with', 'as', 'was', 'on', 'are', 'you', 'this', 'be', 'at', 'have', 'from', 'thanks', 'hello', 'dear', 'regards'],
    pt: ['o', 'a', 'os', 'as', 'de', 'que', 'e', 'em', 'um', 'uma', 'para', 'com', 'nao', 'se', 'por', 'mais', 'mas', 'obrigado', 'ola', 'voce', 'uma'],
    fr: ['le', 'la', 'les', 'de', 'des', 'et', 'en', 'un', 'une', 'pour', 'que', 'qui', 'dans', 'est', 'pas', 'vous', 'nous', 'bonjour', 'merci', 'avec'],
    de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'zu', 'mit', 'von', 'den', 'sie', 'ich', 'auf', 'fur', 'danke', 'hallo', 'guten'],
    it: ['il', 'lo', 'la', 'di', 'che', 'e', 'un', 'una', 'per', 'con', 'non', 'sono', 'del', 'della', 'le', 'gli', 'grazie', 'ciao', 'buongiorno'],
};

/** Heuristica simple (sin dependencias): palabras vacias mas frecuentes. undefined si no hay señal suficiente. */
export function detectLanguage(text: string): string | undefined {
    const words = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z]+/g);
    if (!words || words.length < 4) return undefined;
    const sample = words.slice(0, 400);
    let best: string | undefined;
    let bestScore = 0;
    let second = 0;
    for (const [lang, list] of Object.entries(STOPWORDS)) {
        const set = new Set(list);
        const score = sample.reduce((n, w) => n + (set.has(w) ? 1 : 0), 0);
        if (score > bestScore) { second = bestScore; bestScore = score; best = lang; } else if (score > second) second = score;
    }
    return bestScore >= 2 && bestScore > second ? best : undefined;
}

function zonedParts(ms: number, tz?: string): { hour: number; dow: number } {
    if (!tz || tz === 'UTC') {
        const d = new Date(ms);
        return { hour: d.getUTCHours(), dow: d.getUTCDay() };
    }
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false, weekday: 'short' }).formatToParts(new Date(ms));
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
    const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
    return { hour: h, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd) };
}

function cmp(op: NumOp, a: number, b: number): boolean {
    switch (op) {
        case 'lt': return a < b;
        case 'lte': return a <= b;
        case 'eq': return a === b;
        case 'gte': return a >= b;
        case 'gt': return a > b;
    }
}

function labelMatches(email: EmailContext, wanted: string): boolean {
    const v = wanted.trim().toLowerCase();
    if (!v) return false;
    if (email.labelIds.some((id) => id.toLowerCase() === v)) return true;
    return (email.labelNames ?? []).some((n) => {
        const x = n.toLowerCase();
        return x === v || x.startsWith(v + '/'); // un padre incluye a sus descendientes
    });
}

export function evaluateLeaf(leaf: Leaf, email: EmailContext): Tri {
    if (!leaf || typeof leaf !== 'object') return null;
    const p = prepare(email);
    switch (leaf.field) {
        case 'from': return textTri(dedupe([p.from.raw, p.from.address]), leaf);
        case 'fromName': return textTri(p.from.name ? [p.from.name] : [''], leaf);
        case 'fromDomain': return textTri(p.from.domain ? [p.from.domain] : [], leaf, true);
        case 'to': return textTri(addrCands(p.to, true), leaf);
        case 'cc': return textTri(addrCands(p.cc, true), leaf);
        case 'bcc': return textTri(addrCands(p.bcc, true), leaf);
        case 'replyTo': return textTri(addrCands(p.replyTo, true), leaf);
        case 'toDomain': return textTri(p.to.map((a) => a.domain).filter(Boolean), leaf, true);
        case 'subject': return textTri([String(email.subject ?? '').slice(0, MAX_TEXT_INPUT)], leaf);
        case 'body': return textTri([p.body], leaf);
        case 'bodyHtml': return p.bodyHtml === null ? null : textTri([p.bodyHtml], leaf);
        case 'attachmentName': return p.attachments === null ? null : textTri(p.attachments.map((a) => a.name), leaf);
        case 'attachmentType':
            return p.attachments === null ? null : textTri(
                dedupe(p.attachments.flatMap((a) => [extOf(a.name), String(a.type || '').toLowerCase()])), leaf);
        case 'toAlias': return email.aliasSuffixes === undefined ? null : textTri(email.aliasSuffixes, leaf);
        case 'language': {
            const lang = detectLanguage(`${email.subject ?? ''} ${p.body}`);
            return lang === undefined ? null : textTri([lang], leaf);
        }
        case 'attachmentCount': return numTri(p.attachments === null ? null : p.attachments.length, leaf);
        case 'attachmentsSize': return numTri(p.attachments === null ? null : p.attachments.reduce((n, a) => n + (Number(a.size) || 0), 0), leaf);
        case 'size': return numTri(typeof email.size === 'number' ? email.size : null, leaf);
        case 'spamScore': return numTri(typeof email.spamScore === 'number' ? email.spamScore : null, leaf);
        case 'hour': case 'dayOfWeek': {
            if (p.time === null) return null;
            const z = zonedParts(p.time, (leaf as any).tz);
            return numTri(leaf.field === 'hour' ? z.hour : z.dow, leaf);
        }
        case 'date': {
            if (p.time === null) return null;
            const a = new Date(leaf.value).getTime();
            if (leaf.op === 'before') return p.time < a;
            if (leaf.op === 'after') return p.time > a;
            const b = new Date(leaf.value2 ?? '').getTime();
            return Number.isFinite(b) ? p.time >= a && p.time <= b : null;
        }
        case 'hasAttachment': return email.hasAttachment === (leaf.value !== false);
        case 'isReply': return (RE_PREFIX.test(email.subject ?? '') || !!email.inReplyTo) === (leaf.value !== false);
        case 'isForward': return FWD_PREFIX.test(email.subject ?? '') === (leaf.value !== false);
        case 'isThread': return email.isThread == null ? null : email.isThread === (leaf.value !== false);
        case 'senderInContacts': return email.senderInContacts == null ? null : email.senderInContacts === (leaf.value !== false);
        case 'senderIsMe': {
            if (!email.ownAddresses) return null;
            const own = new Set(email.ownAddresses.map((a) => a.toLowerCase()));
            return (p.from.address !== '' && own.has(p.from.address)) === (leaf.value !== false);
        }
        case 'isCalendarInvite': {
            const byBody = /BEGIN:VCALENDAR/i.test(p.body);
            const byAtt = p.attachments?.some((a) => /(^|\/)(calendar|ics)/i.test(a.type || '') || /\.ics$/i.test(a.name)) ?? false;
            if (!byBody && !byAtt && p.attachments === null) return null;
            return (byBody || byAtt) === (leaf.value !== false);
        }
        case 'isRead': return email.read === undefined ? null : email.read === (leaf.value !== false);
        case 'isStarred': return email.starred === undefined ? null : email.starred === (leaf.value !== false);
        case 'isExternal': return email.isExternal == null ? null : email.isExternal === (leaf.value !== false);
        case 'hasLabel': return labelMatches(email, leaf.value);
        case 'inFolder': return email.folder === undefined ? null : email.folder === leaf.value;
        case 'header': {
            if (!email.hdrs) return null;
            const v = email.hdrs[leaf.name];
            if (leaf.op === 'exists') return v !== undefined && v !== '';
            if (leaf.op === 'notExists') return v === undefined || v === '';
            return textTri(v === undefined ? [] : [v], leaf);
        }
        case 'auth': {
            if (!email.hdrs) return null;
            const ar = email.hdrs['authentication-results'] ?? '';
            const m = new RegExp(`\\b${leaf.mech}=([a-z]+)`, 'i').exec(ar);
            const res = m ? m[1].toLowerCase() : 'none';
            const bucket = res === 'pass' ? 'pass' : res === 'none' ? 'none' : 'fail';
            return bucket === leaf.value;
        }
        default: return null;
    }
}

function extOf(name: string): string {
    const i = name.lastIndexOf('.');
    return i > 0 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : '';
}

function numTri(actual: number | null, leaf: NumLeaf): Tri {
    if (actual === null) return null;
    if (leaf.op === 'in' || leaf.op === 'notIn') {
        const inList = (leaf.values ?? []).includes(actual);
        return leaf.op === 'in' ? inList : !inList;
    }
    return 'value' in leaf ? cmp(leaf.op, actual, leaf.value) : null;
}

export interface EvalBudget { deadline: number }

export function evaluateNode(node: Node, email: EmailContext, budget?: EvalBudget): Tri {
    if (isGroup(node)) {
        let sawNull = false;
        for (const c of node.children) {
            const r = evaluateNode(c, email, budget);
            if (r === null) sawNull = true;
            // Cortocircuito
            if (node.op === 'and' && r === false) return false;
            if (node.op === 'or' && r === true) return true;
            if (node.op === 'not' && r === true) return false;
        }
        if (node.children.length === 0) return null;
        if (sawNull) return null;
        return node.op === 'and' ? true : node.op === 'or' ? false : true;
    }
    if (budget && Date.now() > budget.deadline) return null;
    try {
        return evaluateLeaf(node, email);
    } catch {
        return null;
    }
}

/** Resultado tri-estado de las condiciones (cualquier version). Sin hojas => null (nunca coincide). */
export function evaluateConditions(raw: unknown, email: EmailContext): Tri {
    const c = toV2(raw);
    if (countLeaves(c.root) === 0) return null;
    return evaluateNode(c.root, email, { deadline: Date.now() + RULE_TIME_BUDGET_MS });
}

export const conditionsMatch = (raw: unknown, email: EmailContext): boolean => evaluateConditions(raw, email) === true;

// ---------- Descripcion en lenguaje natural ----------

export type DescribeLocale = 'es' | 'en';

const D = {
    es: {
        and: 'todas', or: 'alguna', not: 'ninguna',
        fields: {
            from: 'el remitente', fromName: 'el nombre del remitente', fromDomain: 'el dominio del remitente', to: 'el destinatario', cc: 'Cc', bcc: 'Cco',
            toDomain: 'el dominio del destinatario', replyTo: 'Responder a', subject: 'el asunto', body: 'el texto', bodyHtml: 'el HTML', attachmentName: 'el nombre del adjunto',
            attachmentType: 'el tipo de adjunto', toAlias: 'el alias de destino', language: 'el idioma', attachmentCount: 'el numero de adjuntos', size: 'el tamano',
            attachmentsSize: 'el tamano de adjuntos', hour: 'la hora', dayOfWeek: 'el dia de la semana', spamScore: 'la puntuacion de spam', date: 'la fecha',
        } as Record<string, string>,
        ops: {
            contains: 'contiene', notContains: 'no contiene', equals: 'es', notEquals: 'no es', startsWith: 'empieza por', endsWith: 'termina en',
            regex: 'coincide con la expresion', notRegex: 'no coincide con la expresion', in: 'esta en', notIn: 'no esta en', containsAny: 'contiene alguno de',
            wildcard: 'coincide con', notWildcard: 'no coincide con',
            lt: 'es menor que', lte: 'es como maximo', eq: 'es igual a', gte: 'es como minimo', gt: 'es mayor que',
            before: 'es anterior a', after: 'es posterior a', between: 'esta entre', exists: 'existe', notExists: 'no existe',
        } as Record<string, string>,
        bools: {
            hasAttachment: ['tiene adjuntos', 'no tiene adjuntos'], isReply: ['es una respuesta', 'no es una respuesta'], isForward: ['es un reenvio', 'no es un reenvio'],
            isThread: ['responde a un hilo tuyo', 'no responde a un hilo tuyo'], senderInContacts: ['el remitente esta en tus contactos', 'el remitente no esta en tus contactos'],
            senderIsMe: ['el remitente eres tu', 'el remitente no eres tu'], isCalendarInvite: ['es una invitacion de calendario', 'no es una invitacion de calendario'],
            isRead: ['esta leido', 'no esta leido'], isStarred: ['esta destacado', 'no esta destacado'], isExternal: ['el remitente es externo', 'el remitente no es externo'],
        } as Record<string, [string, string]>,
        label: (v: string) => `tiene la etiqueta "${v}"`, folder: (v: string) => `esta en la carpeta ${v}`, header: (n: string) => `la cabecera ${n}`,
        auth: (m: string, r: string) => `${m.toUpperCase()} = ${r}`, join: ' y ', joinOr: ' o ', si: 'Si ', subdomains: ' (o subdominios)', empty: 'Sin condiciones',
        wholeWord: ' (palabra completa)', notPrefix: 'no ( ', notSuffix: ' )', list: (a: string[]) => a.join(', '),
    },
    en: {
        and: 'all', or: 'any', not: 'none',
        fields: {
            from: 'the sender', fromName: 'the sender name', fromDomain: 'the sender domain', to: 'the recipient', cc: 'Cc', bcc: 'Bcc',
            toDomain: 'the recipient domain', replyTo: 'Reply-To', subject: 'the subject', body: 'the text', bodyHtml: 'the HTML', attachmentName: 'the attachment name',
            attachmentType: 'the attachment type', toAlias: 'the destination alias', language: 'the language', attachmentCount: 'the attachment count', size: 'the size',
            attachmentsSize: 'the attachments size', hour: 'the hour', dayOfWeek: 'the day of the week', spamScore: 'the spam score', date: 'the date',
        } as Record<string, string>,
        ops: {
            contains: 'contains', notContains: 'does not contain', equals: 'is', notEquals: 'is not', startsWith: 'starts with', endsWith: 'ends with',
            regex: 'matches the expression', notRegex: 'does not match the expression', in: 'is in', notIn: 'is not in', containsAny: 'contains any of',
            wildcard: 'matches', notWildcard: 'does not match',
            lt: 'is less than', lte: 'is at most', eq: 'equals', gte: 'is at least', gt: 'is greater than',
            before: 'is before', after: 'is after', between: 'is between', exists: 'exists', notExists: 'does not exist',
        } as Record<string, string>,
        bools: {
            hasAttachment: ['has attachments', 'has no attachments'], isReply: ['is a reply', 'is not a reply'], isForward: ['is a forward', 'is not a forward'],
            isThread: ['replies to a thread of yours', 'does not reply to a thread of yours'], senderInContacts: ['the sender is in your contacts', 'the sender is not in your contacts'],
            senderIsMe: ['the sender is you', 'the sender is not you'], isCalendarInvite: ['is a calendar invitation', 'is not a calendar invitation'],
            isRead: ['is read', 'is unread'], isStarred: ['is starred', 'is not starred'], isExternal: ['the sender is external', 'the sender is not external'],
        } as Record<string, [string, string]>,
        label: (v: string) => `has the label "${v}"`, folder: (v: string) => `is in the ${v} folder`, header: (n: string) => `the ${n} header`,
        auth: (m: string, r: string) => `${m.toUpperCase()} = ${r}`, join: ' and ', joinOr: ' or ', si: 'If ', subdomains: ' (or subdomains)', empty: 'No conditions',
        wholeWord: ' (whole word)', notPrefix: 'not ( ', notSuffix: ' )', list: (a: string[]) => a.join(', '),
    },
} as const;

function describeLeaf(leaf: Leaf, loc: DescribeLocale): string {
    const d = D[loc];
    const q = (s: string) => `"${s}"`;
    switch (leaf.field) {
        case 'hasLabel': return d.label(leaf.value);
        case 'inFolder': return d.folder(leaf.value);
        case 'auth': return d.auth(leaf.mech, leaf.value);
        case 'date':
            return leaf.op === 'between'
                ? `${d.fields.date} ${d.ops.between} ${leaf.value.slice(0, 10)} - ${(leaf.value2 ?? '').slice(0, 10)}`
                : `${d.fields.date} ${d.ops[leaf.op]} ${leaf.value.slice(0, 10)}`;
        case 'header': {
            const base = d.header(leaf.name);
            if (leaf.op === 'exists' || leaf.op === 'notExists') return `${base} ${d.ops[leaf.op]}`;
            const val = LIST_OPS.includes(leaf.op) ? d.list(parseList(leaf.value, leaf.values).map(q)) : q(String(leaf.value ?? ''));
            return `${base} ${d.ops[leaf.op]} ${val}`;
        }
        default: break;
    }
    if ((BOOL_FIELDS as readonly string[]).includes(leaf.field)) {
        const pair = d.bools[leaf.field];
        return (leaf as BoolLeaf).value === false ? pair[1] : pair[0];
    }
    if ((NUM_FIELDS as readonly string[]).includes(leaf.field)) {
        const n = leaf as NumLeaf;
        if (n.op === 'in' || n.op === 'notIn') return `${d.fields[n.field]} ${d.ops[n.op]} ${(n.values ?? []).join(', ')}`;
        const nv = 'value' in n ? n.value : 0;
        const val = n.field === 'size' || n.field === 'attachmentsSize' ? humanBytes(nv) : String(nv);
        return `${d.fields[n.field]} ${d.ops[n.op]} ${val}`;
    }
    const t = leaf as TextLeaf;
    const val = LIST_OPS.includes(t.op) ? d.list(parseList(t.value, t.values).map(q)) : q(String(t.value ?? ''));
    let s = `${d.fields[t.field]} ${d.ops[t.op]} ${val}`;
    if ((t.field === 'fromDomain' || t.field === 'toDomain') && t.subdomains) s += d.subdomains;
    if (t.wholeWord) s += d.wholeWord;
    return s;
}

function humanBytes(n: number): string {
    if (n >= 1024 * 1024) return `${+(n / 1024 / 1024).toFixed(1)} MB`;
    if (n >= 1024) return `${+(n / 1024).toFixed(1)} KB`;
    return `${n} B`;
}

export function describeNode(node: Node, loc: DescribeLocale = 'es', top = true): string {
    const d = D[loc];
    if (!isGroup(node)) return describeLeaf(node, loc);
    const parts = node.children.map((c) => describeNode(c, loc, false));
    if (parts.length === 0) return d.empty;
    if (node.op === 'not') {
        return `${d.notPrefix}${parts.join(d.joinOr)}${d.notSuffix}`;
    }
    const joined = parts.join(node.op === 'and' ? d.join : d.joinOr);
    return top || parts.length === 1 ? joined : `(${joined})`;
}

/** "Si el remitente contiene "a" y ..." (sin las acciones). */
export function describeConditions(raw: unknown, loc: DescribeLocale = 'es'): string {
    const c = toV2(raw);
    if (countLeaves(c.root) === 0) return D[loc].empty;
    return `${D[loc].si}${describeNode(c.root, loc)}`;
}

// ---------- Introspeccion ----------

/** Campos usados por las condiciones (para cargar solo los datos costosos que hacen falta: cuerpo, HTML, cabeceras...). */
export function fieldsUsed(raw: unknown): Set<string> {
    const out = new Set<string>();
    const walk = (n: Node) => {
        if (isGroup(n)) n.children.forEach(walk);
        else out.add(n.field);
    };
    walk(toV2(raw).root);
    return out;
}
