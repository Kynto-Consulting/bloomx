// Consulta de la lista de correo en el SERVIDOR: parametros (orden, filtro rapido), cursor estable y forma de los conteos.
// Logica pura (sin Prisma ni red). El SQL vive en lib/mail-list-sql.ts y se ejecuta desde lib/mail-store.ts.
//
// Indices: el orden por fecha usa Email(userId, folder, createdAt DESC); el orden por remitente usa el indice de EXPRESION
// Email(userId, folder, bloomx_sender_key("from") COLLATE "C", createdAt DESC, id DESC) (db/mail-sql.ts); los filtros usan
// Email(userId, folder, read), el indice parcial de destacados y Attachment(emailId).

export const MAIL_SORTS = ['newest', 'oldest', 'sender'] as const;
export type MailSortKey = (typeof MAIL_SORTS)[number];

/** Filtros rapidos del servidor. `from_me`: remitente = una direccion propia (cuenta activa o conectada). */
export const MAIL_FILTERS = ['all', 'unread', 'starred', 'attachments', 'from_me'] as const;
export type MailFilterKey = (typeof MAIL_FILTERS)[number];

export const MAIL_PAGE_SIZE = 20;

export function parseSort(value: unknown): MailSortKey {
    return typeof value === 'string' && (MAIL_SORTS as readonly string[]).includes(value) ? (value as MailSortKey) : 'newest';
}

export function parseFilter(value: unknown): MailFilterKey {
    return typeof value === 'string' && (MAIL_FILTERS as readonly string[]).includes(value) ? (value as MailFilterKey) : 'all';
}

/** Nombre del filtro en la URL de la API a partir del nombre que usa la interfaz ('fromMe' -> 'from_me'). */
export function filterToApi(value: string): MailFilterKey {
    return value === 'fromMe' ? 'from_me' : parseFilter(value);
}

/** Marca de tiempo del cursor: ISO en UTC con hasta 6 decimales (precision completa de la columna). */
export const CURSOR_TIME = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$/;

/**
 * Marca de tiempo con precision de MILISEGUNDOS para insertar con SQL crudo (importadores). Postgres redondea a ms tambien por
 * disparador (Email_createdAt_ms_trg), pero asi el valor ya sale exacto y el cursor (createdAt, id) nunca ve microsegundos.
 * Uso: `INSERT ... VALUES (..., $n::timestamptz)` con `msTimestamp(date)`.
 */
export function msTimestamp(value: Date | string | number = new Date()): string {
    const d = value instanceof Date ? value : new Date(value);
    const ms = Number.isNaN(d.getTime()) ? Date.now() : d.getTime();
    return new Date(ms).toISOString(); // toISOString ya es AAAA-MM-DDTHH:MM:SS.mmmZ
}

/** Fragmento SQL equivalente para "ahora" en una sentencia cruda (sin pasar el valor desde JS). */
export const MS_NOW_SQL = "date_trunc('milliseconds', clock_timestamp())";

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

export interface MailCursor {
    /** Orden con el que se emitio (un cursor de otro orden se rechaza). */
    s: MailSortKey;
    /** createdAt de la ultima fila de la pagina anterior (ISO UTC, precision completa de la columna). */
    t: string;
    /** id de esa fila (desempate estable). */
    id: string;
    /** Solo orden por remitente: clave de orden normalizada (bloomx_sender_key) de esa fila. */
    f?: string;
}

/** `row.ct` = createdAt tal como lo devolvio la BD (texto con microsegundos); `row.sk` = clave de remitente. */
export function encodeCursor(sort: MailSortKey, row: { ct: string; id: string; sk?: string | null }): string {
    const cursor: MailCursor = { s: sort, t: row.ct, id: row.id, ...(sort === 'sender' ? { f: String(row.sk ?? '') } : {}) };
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** null si el cursor no es valido o no corresponde a este orden (el llamador responde 400). */
export function decodeCursor(raw: unknown, sort: MailSortKey): MailCursor | null {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
    try {
        const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<MailCursor> | null;
        if (!v || typeof v !== 'object' || v.s !== sort) return null;
        if (typeof v.id !== 'string' || v.id.length === 0 || v.id.length > 200) return null;
        if (typeof v.t !== 'string' || !CURSOR_TIME.test(v.t) || Number.isNaN(new Date(v.t).getTime())) return null;
        if (sort === 'sender' && (typeof v.f !== 'string' || v.f.length > 2000 || v.f.includes('\u0000'))) return null;
        return { s: sort, t: v.t, id: v.id, ...(sort === 'sender' ? { f: v.f } : {}) };
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Conteos por filtro
// ---------------------------------------------------------------------------

export interface FolderFilterCounts { all: number; unread: number; starred: number; attachments: number; from_me: number }

export const EMPTY_FILTER_COUNTS: FolderFilterCounts = { all: 0, unread: 0, starred: 0, attachments: 0, from_me: 0 };

export function normalizeFilterCounts(row: Record<string, unknown> | undefined | null): FolderFilterCounts {
    const n = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) && x > 0 ? Math.floor(x) : 0; };
    return { all: n(row?.all), unread: n(row?.unread), starred: n(row?.starred), attachments: n(row?.attachments), from_me: n(row?.from_me) };
}

/** Une los conteos de varios buzones (solo para buzones de sesiones DISTINTAS; los de una sesion se unen en el servidor). */
export function sumFilterCounts(list: FolderFilterCounts[]): FolderFilterCounts {
    return list.reduce<FolderFilterCounts>((acc, c) => ({
        all: acc.all + c.all, unread: acc.unread + c.unread, starred: acc.starred + c.starred,
        attachments: acc.attachments + c.attachments, from_me: acc.from_me + c.from_me,
    }), { ...EMPTY_FILTER_COUNTS });
}

/** Ids de buzon del parametro `mailboxes=a,b,c` (sin repetidos ni vacios, como mucho 50). null = parametro invalido. */
export function parseMailboxesParam(raw: string | null | undefined): string[] | null {
    if (raw === null || raw === undefined || raw === '') return [];
    const out = new Set<string>();
    for (const part of raw.split(',')) {
        const id = part.trim();
        if (!id) continue;
        if (id.length > 200 || !/^[A-Za-z0-9_@.+-]+$/.test(id)) return null;
        out.add(id);
    }
    return out.size > 50 ? null : Array.from(out);
}
