// SQL de la bandeja construido a partir de un "ambito" (buzones + carpeta/etiqueta/busqueda + filtros). Solo cadenas y parametros:
// nada de red ni Prisma (mail-store.ts los ejecuta) para poder probarlo. Todo valor del usuario viaja como parametro ($n).
//
// UNIDADES. La interfaz agrupa los mensajes en HILOS (lib/mail-list.ts::groupEmailsByThread, lib/threading.ts): la clave es
//   Email.threadKey (raiz de la cadena Message-ID/In-Reply-To/References; se calcula al ingerir/enviar/importar), o, en correos
//   antiguos sin ella, la heuristica heredada  h:<destinatarios normalizados>::<asunto sin prefijos Re:/Fwd:/...>  (o u:<id> si el
//   asunto no llega a 3 letras).  `threadKeySql(opt)` es el espejo exacto en SQL (COALESCE(threadKey, heuristica)). Un filtro rapido lista los MENSAJES que lo cumplen y el conteo del chip es el numero de
// HILOS con algun mensaje que lo cumple: coincide con las filas que dibuja la interfaz.
import { FTS_EXPRESSION_SQL, type ParsedSearch } from '@/lib/rules/search';
import { SENDER_KEY_FN, senderKeyExpr } from '@/lib/db/mail-sql';
import type { MailCursor, MailFilterKey, MailSortKey } from '@/lib/mail-query';
import { SUBJECT_PREFIX_SOURCE } from '@/lib/threading';

/** Tipo REAL de Email.createdAt: `timestamptz` (DDL de ensure-schema) o `timestamp` (Prisma db push: timestamp(3)). */
export type CreatedAtKind = 'timestamptz' | 'timestamp';

export interface SqlOptions {
    createdAtKind: CreatedAtKind;
    /** false = la funcion bloomx_sender_key aun no existe en esta BD: se usa la misma expresion en linea (sin indice). */
    senderKeyFn: boolean;
    /** false/ausente = la columna Email.threadKey aun no existe (despliegue sin db:ensure): se agrupa solo con la clave heuristica heredada. */
    threadKey?: boolean;
    /** false/ausente = Label aun sin jerarquia (parentId/behavior/fullPath): las etiquetas se comparan por nombre y no hay carpetas-etiqueta. */
    labelTree?: boolean;
}

export const DEFAULT_SQL_OPTIONS: SqlOptions = { createdAtKind: 'timestamptz', senderKeyFn: true, threadKey: false };

export class SqlParams {
    readonly values: unknown[] = [];
    add(value: unknown): string {
        this.values.push(value);
        return `$${this.values.length}`;
    }
}

// ---------------------------------------------------------------------------
// Ambito
// ---------------------------------------------------------------------------

export interface MailListScope {
    /** Buzones (Email.userId) ya validados con getAccessibleMailboxUserIds. Nunca vacio. */
    userIds: string[];
    /** Vista de carpeta. Se ignora en etiquetas y busquedas (globales, sin papelera ni spam). */
    folder: string | null;
    /** Nombres de etiqueta (?label=a,b), en cualquier caso. Con etiquetas jerarquicas: ruta completa ("Trabajo/Proyecto A"). */
    labels: string[];
    /** true = solo la etiqueta indicada; por defecto tambien sus subetiquetas ("incluir subetiquetas"). */
    labelExact?: boolean;
    /** q ya analizado (operadores + texto). null = sin busqueda. */
    search: ParsedSearch | null;
    /** Usar full-text para el texto libre (false = solo contiene). */
    useFts: boolean;
    since: string | null;
    until: string | null;
    fromContains: string | null;
    hasAttachment: boolean;
    /** Direcciones de la cuenta elegida: el correo debe ir a alguna (to / cleanTo). */
    account: string[];
}

export function emptyScope(userIds: string[], folder: string | null): MailListScope {
    return { userIds, folder, labels: [], search: null, useFts: true, since: null, until: null, fromContains: null, hasAttachment: false, account: [] };
}

const contains = (col: string, p: SqlParams, value: string) => `strpos(lower(COALESCE(${col},'')), lower(${p.add(value)}::text)) > 0`;
const stamp = (kind: CreatedAtKind, ref: string) => `${ref}::${kind}`;

const ATTACHMENT_EXISTS = (alias = 'e') => `EXISTS (SELECT 1 FROM "Attachment" a WHERE a."emailId" = ${alias}."id")`;
/** Ruta completa de la etiqueta `l` en minuscula (fullPath, o el nombre en etiquetas antiguas). */
export const LABEL_PATH_SQL = (a = 'l') => `lower(COALESCE(${a}."fullPath", ${a}."name"))`;
/** La etiqueta `l` es alguna de `arr` (text[] en minuscula) o, salvo `exact`, descendiente de alguna (prefijo "ruta/"). */
export const labelPathIn = (arr: string, exact: boolean, a = 'l') =>
    exact ? `${LABEL_PATH_SQL(a)} = ANY(${arr}::text[])`
        : `EXISTS (SELECT 1 FROM unnest(${arr}::text[]) AS q(v) WHERE ${LABEL_PATH_SQL(a)} = q.v OR left(${LABEL_PATH_SQL(a)}, length(q.v) + 1) = q.v || '/')`;
/** El correo `alias` esta en alguna etiqueta de tipo carpeta (no aparece en Archivo: su ubicacion es la etiqueta). */
export const IN_LABEL_FOLDER = (alias = 'e') =>
    `EXISTS (SELECT 1 FROM "_EmailToLabel" lf JOIN "Label" lfl ON lfl."id" = lf."B" WHERE lf."A" = ${alias}."id" AND lfl."behavior" = 'folder')`;

const LABEL_EXISTS = (alias: string, cond: string) =>
    `EXISTS (SELECT 1 FROM "_EmailToLabel" el JOIN "Label" l ON l."id" = el."B" WHERE el."A" = ${alias}."id" AND ${cond})`;

/** Condiciones (AND) del ambito sobre `e` = "Email". */
export function scopeClauses(scope: MailListScope, p: SqlParams, opt: SqlOptions): string[] {
    const out: string[] = [`e."userId" = ANY(${p.add(scope.userIds)}::text[])`];
    if (scope.since) out.push(`e."createdAt" > ${stamp(opt.createdAtKind, p.add(scope.since))}`);
    if (scope.until) out.push(`e."createdAt" < ${stamp(opt.createdAtKind, p.add(scope.until))}`);

    const s = scope.search;
    if (s) {
        for (const name of s.labels) {
            out.push(LABEL_EXISTS('e', opt.labelTree
                ? labelPathIn(p.add([name.toLowerCase()]), scope.labelExact === true)
                : `lower(l."name") = lower(${p.add(name)}::text)`));
        }
        for (const v of s.from) out.push(contains('e."from"', p, v));
        for (const v of s.to) { const ref = p.add(v); out.push(`(strpos(lower(e."to"), lower(${ref}::text)) > 0 OR strpos(lower(COALESCE(e."cleanTo",'')), lower(${ref}::text)) > 0)`); }
        for (const v of s.subject) out.push(contains('e."subject"', p, v));
        if (s.hasAttachment) out.push(ATTACHMENT_EXISTS());
        if (s.unread && !s.read) out.push('NOT e."read"');
        if (s.read && !s.unread) out.push('e."read"');
        if (s.starred) out.push('e."starred"');
        if (s.text) {
            const t = p.add(s.text);
            const like = `(${['subject', 'from', 'snippet', 'to', 'cleanTo'].map((c) => `strpos(lower(COALESCE(e."${c}",'')), lower(${t}::text)) > 0`).join(' OR ')})`;
            // Igual que antes: si el full-text (indice GIN) encuentra algo se usa SOLO el full-text; si no, el respaldo "contiene".
            // La subconsulta EXISTS no depende de la fila (se evalua una vez) y no tiene tope de resultados.
            out.push(scope.useFts
                ? `(CASE WHEN EXISTS (SELECT 1 FROM "Email" f WHERE f."userId" = ANY(${p.add(scope.userIds)}::text[]) AND ${FTS_EXPRESSION_SQL.replace(/"(subject|from|snippet)"/g, 'f."$1"')} @@ websearch_to_tsquery('simple', ${t}::text)) THEN ${FTS_EXPRESSION_SQL.replace(/"(subject|from|snippet)"/g, 'e."$1"')} @@ websearch_to_tsquery('simple', ${t}::text) ELSE ${like} END)`
                : like);
        }
    }

    if (scope.fromContains) out.push(contains('e."from"', p, scope.fromContains));
    if (scope.hasAttachment) out.push(ATTACHMENT_EXISTS());
    if (scope.account.length > 0) {
        out.push(`(${scope.account.map((c) => { const ref = p.add(c); return `strpos(lower(COALESCE(e."cleanTo",'')), lower(${ref}::text)) > 0 OR strpos(lower(e."to"), lower(${ref}::text)) > 0`; }).join(' OR ')})`);
    }

    if (scope.labels.length > 0) {
        out.push(LABEL_EXISTS('e', opt.labelTree
            ? labelPathIn(p.add(scope.labels.map((l) => l.toLowerCase())), scope.labelExact === true)
            : `lower(l."name") = ANY(${p.add(scope.labels.map((l) => l.toLowerCase()))}::text[])`));
        out.push(`e."folder" NOT IN ('trash','spam')`);
    } else if (s) {
        out.push(`e."folder" NOT IN ('trash','spam')`);
    } else if (scope.folder) {
        out.push(`e."folder" = ${p.add(scope.folder)}::text`);
        // Un correo dentro de una etiqueta-carpeta "vive" en ella: no se lista tambien en Archivo.
        if (scope.folder === 'archive' && opt.labelTree) out.push(`NOT ${IN_LABEL_FOLDER('e')}`);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Filtro rapido (por mensaje)
// ---------------------------------------------------------------------------

/** Direccion del remitente igual que `senderAddress` de la interfaz: lo que va entre <> o la cabecera entera, en minusculas. */
export const FROM_ADDRESS_SQL = (alias = 'e') => `lower(btrim(COALESCE(substring(${alias}."from" from '<([^>]+)>'), ${alias}."from")))`;

export function quickFilterClause(filter: MailFilterKey, own: string[], p: SqlParams): string | null {
    switch (filter) {
        case 'unread': return 'NOT e."read"';
        case 'starred': return 'e."starred"';
        case 'attachments': return ATTACHMENT_EXISTS();
        case 'from_me': return own.length === 0 ? 'FALSE' : `${FROM_ADDRESS_SQL()} = ANY(${p.add(own)}::text[])`;
        default: return null;
    }
}

/** Direcciones propias en minuscula y sin repetir (solo las que tienen @). */
export function normalizeOwn(own: string[]): string[] {
    return Array.from(new Set(own.map((a) => String(a || '').trim().toLowerCase()).filter((a) => a.includes('@'))));
}

// ---------------------------------------------------------------------------
// Orden y cursor
// ---------------------------------------------------------------------------

export function senderKeySql(opt: SqlOptions, alias = 'e'): string {
    return `(${opt.senderKeyFn ? `${SENDER_KEY_FN}(${alias}."from")` : senderKeyExpr(`${alias}."from"`)} COLLATE "C")`;
}

/** createdAt como texto ISO con microsegundos y Z (la precision completa viaja en el cursor). */
export function createdAtTextSql(opt: SqlOptions, alias = 'e'): string {
    const col = opt.createdAtKind === 'timestamptz' ? `(${alias}."createdAt" AT TIME ZONE 'UTC')` : `${alias}."createdAt"`;
    return `to_char(${col}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

export function orderBySql(sort: MailSortKey, opt: SqlOptions): string {
    if (sort === 'oldest') return 'e."createdAt" ASC, e."id" ASC';
    if (sort === 'sender') return `${senderKeySql(opt)} ASC, e."createdAt" DESC, e."id" DESC`;
    return 'e."createdAt" DESC, e."id" DESC';
}

/** "Estrictamente despues del cursor" con comparacion de TUPLA (createdAt, id): sin saltos ni repeticiones aunque empaten. */
export function cursorClause(sort: MailSortKey, cursor: MailCursor, p: SqlParams, opt: SqlOptions): string {
    const t = stamp(opt.createdAtKind, p.add(cursor.t));
    const id = `${p.add(cursor.id)}::text`;
    if (sort === 'oldest') return `(e."createdAt", e."id") > (${t}, ${id})`;
    if (sort === 'sender') {
        const f = `${p.add(cursor.f ?? '')}::text COLLATE "C"`;
        return `(${senderKeySql(opt)} > ${f} OR (${senderKeySql(opt)} = ${f} AND (e."createdAt", e."id") < (${t}, ${id})))`;
    }
    return `(e."createdAt", e."id") < (${t}, ${id})`;
}

export interface PageQueryInput {
    scope: MailListScope;
    sort: MailSortKey;
    filter: MailFilterKey;
    own: string[];
    cursor: MailCursor | null;
    /** Filas a pedir (limite + 1 para saber si hay mas). */
    take: number;
    offset: number;
}

/** Ids de la pagina en orden, con la marca de tiempo exacta y la clave de remitente (para el siguiente cursor). */
export function buildPageSql(input: PageQueryInput, opt: SqlOptions): { sql: string; values: unknown[] } {
    const p = new SqlParams();
    const where = scopeClauses(input.scope, p, opt);
    const quick = quickFilterClause(input.filter, normalizeOwn(input.own), p);
    if (quick) where.push(quick);
    if (input.cursor) where.push(cursorClause(input.sort, input.cursor, p, opt));
    const sql = `SELECT e."id" AS "id", ${createdAtTextSql(opt)} AS "ct", ${input.sort === 'sender' ? senderKeySql(opt) : `NULL::text`} AS "sk"
FROM "Email" e
WHERE ${where.join('\n  AND ')}
ORDER BY ${orderBySql(input.sort, opt)}
LIMIT ${p.add(Math.max(1, input.take | 0))}::int OFFSET ${p.add(Math.max(0, input.offset | 0))}::int`;
    return { sql, values: p.values };
}

// ---------------------------------------------------------------------------
// Hilos y conteos
// ---------------------------------------------------------------------------

// Prefijos que la interfaz quita del asunto: UNA sola definicion (lib/threading.ts::SUBJECT_PREFIX_SOURCE), sintaxis comun a JS y a ARE de Postgres.
export const SUBJECT_PREFIX_RE = SUBJECT_PREFIX_SOURCE;
const WS = `E' \\t\\r\\n'`;

/** LATERAL que calcula `n.norm` = asunto normalizado (igual que normalizeSubject). */
export const NORMALIZED_SUBJECT_LATERAL = `CROSS JOIN LATERAL (SELECT btrim(regexp_replace(COALESCE(e."subject",''), '${SUBJECT_PREFIX_RE.replace(/'/g, "''")}', '', 'i'), ${WS}) AS "norm") n`;

/** Destinatarios normalizados (getRecipientThreadKey): direcciones con @ en minuscula, en orden, o el texto crudo si no hay ninguna. */
const RECIPIENT_KEY = `(SELECT COALESCE(NULLIF(string_agg(x."addr", ', ' ORDER BY x."ord"), ''), lower(btrim(COALESCE(NULLIF(e."cleanTo",''), e."to", ''), ${WS})))
     FROM (SELECT p."ord", btrim(COALESCE(substring(p."part" from '<([^>]+)>'), p."part"), ${WS}) AS "addr"
           FROM regexp_split_to_table(lower(COALESCE(NULLIF(e."cleanTo",''), e."to", '')), ',') WITH ORDINALITY AS p("part", "ord")) x
     WHERE x."addr" LIKE '%@%')`;

/** Clave HEREDADA de hilo (correos sin threadKey; legacyThreadKey de lib/threading.ts). Requiere NORMALIZED_SUBJECT_LATERAL en el FROM. */
export const THREAD_KEY_SQL = `(CASE WHEN n."norm" = '' OR char_length(n."norm") < 3 OR n."norm" = '(No Subject)' THEN 'u:' || e."id" ELSE 'h:' || ${RECIPIENT_KEY} || '::' || n."norm" END)`;

/** Clave de hilo efectiva (effectiveThreadKey): la guardada o, si falta, la heredada. */
export function threadKeySql(opt: SqlOptions = DEFAULT_SQL_OPTIONS): string {
    return opt.threadKey ? `COALESCE(NULLIF(e."threadKey",''), ${THREAD_KEY_SQL})` : THREAD_KEY_SQL;
}

export interface FilterTally { all: number; unread: number; starred: number; attachments: number; from_me: number }
export interface ScopeCounts {
    /** Filas que dibuja la interfaz: hilos con algun mensaje que cumple cada filtro. */
    threads: FilterTally;
    /** Mensajes que cumplen cada filtro (lo que pagina /api/emails). */
    messages: FilterTally;
}

const FILTERS: Array<[keyof FilterTally, string]> = [
    ['all', 'TRUE'], ['unread', 'NOT b."r"'], ['starred', 'b."s"'], ['attachments', 'b."a"'], ['from_me', 'b."f"'],
];

/** Conteos por filtro de un ambito (sin filtro rapido ni cursor) en una sola pasada. */
export function buildScopeCountsSql(scope: MailListScope, own: string[], opt: SqlOptions): { sql: string; values: unknown[] } {
    const p = new SqlParams();
    const where = scopeClauses(scope, p, opt);
    const ownRef = p.add(normalizeOwn(own));
    const cols = FILTERS.flatMap(([key, cond]) => [
        `COUNT(*) FILTER (WHERE ${cond})::int AS "m_${key}"`,
        `COUNT(DISTINCT b."tk") FILTER (WHERE ${cond})::int AS "t_${key}"`,
    ]);
    const sql = `WITH b AS (
  SELECT e."read" AS "r", e."starred" AS "s", ${ATTACHMENT_EXISTS()} AS "a",
         (${FROM_ADDRESS_SQL()} = ANY(${ownRef}::text[])) AS "f", ${threadKeySql(opt)} AS "tk"
  FROM "Email" e ${NORMALIZED_SUBJECT_LATERAL}
  WHERE ${where.join('\n    AND ')}
  OFFSET 0
)
SELECT ${cols.join(', ')} FROM b`;
    return { sql, values: p.values };
}

export function readScopeCounts(row: Record<string, unknown> | undefined | null): ScopeCounts {
    const n = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) && x > 0 ? Math.floor(x) : 0; };
    const pick = (prefix: 'm' | 't'): FilterTally => ({
        all: n(row?.[`${prefix}_all`]), unread: n(row?.[`${prefix}_unread`]), starred: n(row?.[`${prefix}_starred`]),
        attachments: n(row?.[`${prefix}_attachments`]), from_me: n(row?.[`${prefix}_from_me`]),
    });
    return { threads: pick('t'), messages: pick('m') };
}

/**
 * Insignias del Sidebar por carpeta (hilos y mensajes, no leidos y total) para uno o varios buzones. Los no leidos solo recorren
 * las filas no leidas (indice Email(userId, folder, read)); los totales de hilos recorren todo el buzon.
 */
export function buildFolderBadgesSql(userIds: string[], withTotals: boolean, opt: SqlOptions = DEFAULT_SQL_OPTIONS): { sql: string; values: unknown[] } {
    const p = new SqlParams();
    const users = p.add(userIds);
    const sql = `WITH b AS (
  SELECT e."folder" AS "folder", e."read" AS "r", ${threadKeySql(opt)} AS "tk"
  FROM "Email" e ${NORMALIZED_SUBJECT_LATERAL}
  WHERE e."userId" = ANY(${users}::text[])${withTotals ? '' : ' AND NOT e."read"'}${opt.labelTree ? ` AND NOT (e."folder" = 'archive' AND ${IN_LABEL_FOLDER('e')})` : ''}
  OFFSET 0
)
SELECT "folder", COUNT(*)::int AS "m_all", COUNT(*) FILTER (WHERE NOT "r")::int AS "m_unread",
       COUNT(DISTINCT "tk")::int AS "t_all", COUNT(DISTINCT "tk") FILTER (WHERE NOT "r")::int AS "t_unread"
FROM b GROUP BY "folder"`;
    return { sql, values: p.values };
}

/** Insignias de etiquetas (nombre en minuscula): hilos y mensajes con la etiqueta, sin papelera ni spam. */
export function buildLabelBadgesSql(userIds: string[], withTotals: boolean, opt: SqlOptions = DEFAULT_SQL_OPTIONS): { sql: string; values: unknown[] } {
    const p = new SqlParams();
    const users = p.add(userIds);
    if (opt.labelTree) {
        // Jerarquia: cada etiqueta cuenta los hilos/mensajes de ella Y de sus descendientes (acumulado en los padres), sin
        // contar dos veces un correo que lleve padre e hija (COUNT DISTINCT por mensaje y por hilo).
        const sqlTree = `WITH b AS (
  SELECT lp."id" AS "lid", ${LABEL_PATH_SQL('lp')} AS "name", e."id" AS "eid", e."read" AS "r", ${threadKeySql(opt)} AS "tk"
  FROM "Label" lp
  JOIN "Label" lc ON lc."userId" = lp."userId"
    AND (${LABEL_PATH_SQL('lc')} = ${LABEL_PATH_SQL('lp')} OR left(${LABEL_PATH_SQL('lc')}, length(${LABEL_PATH_SQL('lp')}) + 1) = ${LABEL_PATH_SQL('lp')} || '/')
  JOIN "_EmailToLabel" el ON el."B" = lc."id"
  JOIN "Email" e ON e."id" = el."A" AND e."userId" = lp."userId" AND e."folder" NOT IN ('trash','spam')${withTotals ? '' : ' AND NOT e."read"'}
  ${NORMALIZED_SUBJECT_LATERAL}
  WHERE lp."userId" = ANY(${users}::text[])
  OFFSET 0
)
SELECT "lid", "name", COUNT(DISTINCT "eid")::int AS "m_all", COUNT(DISTINCT "eid") FILTER (WHERE NOT "r")::int AS "m_unread",
       COUNT(DISTINCT "tk")::int AS "t_all", COUNT(DISTINCT "tk") FILTER (WHERE NOT "r")::int AS "t_unread"
FROM b GROUP BY "lid", "name"`;
        return { sql: sqlTree, values: p.values };
    }
    const sql = `WITH b AS (
  SELECT lower(l."name") AS "name", e."read" AS "r", ${threadKeySql(opt)} AS "tk"
  FROM "_EmailToLabel" el
  JOIN "Label" l ON l."id" = el."B" AND l."userId" = ANY(${users}::text[])
  JOIN "Email" e ON e."id" = el."A" AND e."userId" = ANY(${users}::text[]) AND e."folder" NOT IN ('trash','spam')${withTotals ? '' : ' AND NOT e."read"'}
  ${NORMALIZED_SUBJECT_LATERAL}
  OFFSET 0
)
SELECT "name", COUNT(*)::int AS "m_all", COUNT(*) FILTER (WHERE NOT "r")::int AS "m_unread",
       COUNT(DISTINCT "tk")::int AS "t_all", COUNT(DISTINCT "tk") FILTER (WHERE NOT "r")::int AS "t_unread"
FROM b GROUP BY "name"`;
    return { sql, values: p.values };
}

// ---------------------------------------------------------------------------
// Alcance para acciones masivas
// ---------------------------------------------------------------------------

/** Subconsulta de ids del ambito + filtro rapido (para UPDATE ... WHERE id IN (...) en una sola sentencia atomica). */
export function buildScopeIdsSubquery(scope: MailListScope, filter: MailFilterKey, own: string[], opt: SqlOptions, p: SqlParams): string {
    const where = scopeClauses(scope, p, opt);
    const quick = quickFilterClause(filter, normalizeOwn(own), p);
    if (quick) where.push(quick);
    return `SELECT e."id" FROM "Email" e WHERE ${where.join(' AND ')}`;
}
