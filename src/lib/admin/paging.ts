/** Paginacion acotada (offset) para las listas de la consola. */

export interface Paging {
    page: number;
    pageSize: number;
    offset: number;
}

export interface PageMeta {
    page: number;
    pageSize: number;
    total: number;
    pages: number;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
/** Tope de paginas para que un offset gigante no fuerce barridos enormes. */
export const MAX_PAGE = 10_000;

function int(value: string | null | undefined, fallback: number): number {
    const n = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(n) ? n : fallback;
}

export function parsePaging(sp: URLSearchParams, opts: { defaultSize?: number; maxSize?: number } = {}): Paging {
    const maxSize = opts.maxSize ?? MAX_PAGE_SIZE;
    const pageSize = Math.min(maxSize, Math.max(1, int(sp.get('pageSize'), opts.defaultSize ?? DEFAULT_PAGE_SIZE)));
    const page = Math.min(MAX_PAGE, Math.max(1, int(sp.get('page'), 1)));
    return { page, pageSize, offset: (page - 1) * pageSize };
}

export function pageMeta(paging: Paging, total: number): PageMeta {
    return { page: paging.page, pageSize: paging.pageSize, total, pages: Math.max(1, Math.ceil(total / paging.pageSize)) };
}

/** Cursor opaco (base64url de JSON) para listas ordenadas por (fecha, id). */
export function encodeCursor(value: { ts: string; id: string }): string {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | null | undefined): { ts: string; id: string } | null {
    if (!cursor || cursor.length > 512) return null;
    try {
        const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (typeof v?.ts === 'string' && typeof v?.id === 'string' && !Number.isNaN(new Date(v.ts).getTime())) return { ts: v.ts, id: v.id };
    } catch { /* cursor invalido */ }
    return null;
}
