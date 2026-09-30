/**
 * Parser de operadores de busqueda estilo Gmail y utilidades de full-text.
 *
 * Operadores: label:, from:, to:, subject:, has:attachment, is:unread|read|starred.
 * Los valores admiten comillas: label:"Mis facturas". Todo lo demas es texto libre.
 */

export interface ParsedSearch {
    text: string;
    labels: string[];
    from: string[];
    to: string[];
    subject: string[];
    hasAttachment: boolean;
    unread: boolean;
    read: boolean;
    starred: boolean;
}

const MAX_QUERY_LENGTH = 300;
const MAX_TOKENS = 30;

function tokenize(input: string): string[] {
    const tokens: string[] = [];
    const re = /(?:[A-Za-z]+:)?"[^"]*"|\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(input)) !== null && tokens.length < MAX_TOKENS) {
        tokens.push(m[0]);
    }
    return tokens;
}

function unquote(v: string): string {
    return v.replace(/^"/, '').replace(/"$/, '').trim();
}

export function parseSearchQuery(raw: string | null | undefined): ParsedSearch {
    const out: ParsedSearch = {
        text: '', labels: [], from: [], to: [], subject: [],
        hasAttachment: false, unread: false, read: false, starred: false,
    };
    const input = String(raw ?? '').slice(0, MAX_QUERY_LENGTH).trim();
    if (!input) return out;

    const free: string[] = [];
    for (const token of tokenize(input)) {
        const m = /^([A-Za-z]+):(.*)$/.exec(token);
        if (!m) { free.push(unquote(token)); continue; }
        const key = m[1].toLowerCase();
        const value = unquote(m[2]);
        if (!value) { free.push(token); continue; }
        switch (key) {
            case 'label': out.labels.push(value); break;
            case 'from': out.from.push(value); break;
            case 'to': out.to.push(value); break;
            case 'subject': out.subject.push(value); break;
            case 'has':
                if (value.toLowerCase() === 'attachment') out.hasAttachment = true;
                else free.push(token);
                break;
            case 'is': {
                const v = value.toLowerCase();
                if (v === 'unread') out.unread = true;
                else if (v === 'read') out.read = true;
                else if (v === 'starred') out.starred = true;
                else free.push(token);
                break;
            }
            default:
                free.push(token); // p. ej. "http://..." o "12:30" siguen siendo texto
        }
    }
    out.text = free.filter(Boolean).join(' ').trim();
    return out;
}

/** Construye los filtros Prisma (AND) correspondientes a los operadores. Sin texto libre. */
export function buildOperatorFilters(p: ParsedSearch): any[] {
    const and: any[] = [];
    for (const name of p.labels) {
        and.push({ labels: { some: { name: { equals: name, mode: 'insensitive' } } } });
    }
    for (const v of p.from) and.push({ from: { contains: v, mode: 'insensitive' } });
    for (const v of p.to) {
        and.push({ OR: [
            { to: { contains: v, mode: 'insensitive' } },
            { cleanTo: { contains: v, mode: 'insensitive' } },
        ] });
    }
    for (const v of p.subject) and.push({ subject: { contains: v, mode: 'insensitive' } });
    if (p.hasAttachment) and.push({ attachments: { some: {} } });
    if (p.unread && !p.read) and.push({ read: false });
    if (p.read && !p.unread) and.push({ read: true });
    if (p.starred) and.push({ starred: true });
    return and;
}

/** Filtro de respaldo (ILIKE) para el texto libre. */
export function buildContainsFilter(text: string): any {
    return {
        OR: [
            { subject: { contains: text, mode: 'insensitive' } },
            { from: { contains: text, mode: 'insensitive' } },
            { snippet: { contains: text, mode: 'insensitive' } },
            { to: { contains: text, mode: 'insensitive' } },
            { cleanTo: { contains: text, mode: 'insensitive' } },
        ],
    };
}

/**
 * Full-text de Postgres. Debe coincidir EXACTAMENTE con la expresion del indice
 * "Email_fts_idx" definido en src/lib/db/schema.ts para poder usarlo.
 * Devuelve null si falla (p. ej. Postgres sin soporte o error) para que el
 * llamador haga fallback a contains.
 */
export const FTS_EXPRESSION_SQL =
    `to_tsvector('simple', coalesce("subject",'') || ' ' || coalesce("from",'') || ' ' || coalesce("snippet",''))`;

export async function ftsEmailIds(
    prisma: { $queryRawUnsafe: (query: string, ...values: any[]) => Promise<any> },
    userId: string,
    text: string,
    limit = 1000,
): Promise<string[] | null> {
    const t = String(text ?? '').trim().slice(0, MAX_QUERY_LENGTH);
    if (!t) return null;
    try {
        const rows: Array<{ id: string }> = await prisma.$queryRawUnsafe(
            `SELECT "id" FROM "Email"
             WHERE "userId" = $1 AND ${FTS_EXPRESSION_SQL} @@ websearch_to_tsquery('simple', $2)
             ORDER BY "createdAt" DESC LIMIT ${Math.max(1, Math.min(5000, limit | 0))}`,
            userId,
            t,
        );
        return rows.map((r) => r.id);
    } catch (e) {
        console.error('[search] FTS failed, falling back to contains:', (e as any)?.message);
        return null;
    }
}
