import { z } from 'zod';
import { maskEmail, redactAuditData } from '@/lib/audit';
import { num, query, tolerant, toIso } from './sql';
import { decodeCursor, encodeCursor, type Paging } from './paging';

/**
 * Consultas del visor de AUDITORIA (tabla "AuditEvent"). SQL siempre parametrizado; las columnas y el orden son fijos.
 * El enmascarado se aplica en LECTURA (ademas del que hace auditLog al escribir): eventos antiguos o escritos por otro
 * proceso no pueden filtrar correos, IP completas ni claves al navegador.
 */

export const AUDIT_EVENT_RE = /^[a-z0-9_.*-]{1,80}$/;
export const MAX_RANGE_DAYS = 366;
export const EXPORT_MAX_ROWS = 10_000;
/** Tope del COUNT(*) para no barrer tablas enormes en cada pagina. */
export const COUNT_CAP = 100_000;

const isoDate = z.string().trim().max(40).refine((s) => !Number.isNaN(new Date(s).getTime()), 'invalid_date');

export const auditFiltersSchema = z.object({
    event: z.string().trim().regex(AUDIT_EVENT_RE).refine((s) => !s.slice(0, -1).includes('*'), 'wildcard_only_at_end').optional(),
    user: z.string().trim().min(1).max(200).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    q: z.string().trim().min(1).max(80).optional(),
    cursor: z.string().max(512).optional(),
});
export type AuditFilters = z.infer<typeof auditFiltersSchema>;

/** Errores de rango de fechas (los traduce la ruta a 400). */
export type RangeError = 'from_after_to' | 'range_too_large' | null;

export function checkRange(f: Pick<AuditFilters, 'from' | 'to'>): RangeError {
    if (!f.from || !f.to) return null;
    const from = new Date(f.from).getTime();
    const to = toEnd(f.to).getTime();
    if (from > to) return 'from_after_to';
    if (to - from > MAX_RANGE_DAYS * 24 * 3600 * 1000) return 'range_too_large';
    return null;
}

/** Una fecha sin hora como "to" incluye todo ese dia (UTC). */
function toEnd(to: string): Date {
    return /^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(`${to}T23:59:59.999Z`) : new Date(to);
}

/** Escapa % _ \ para ILIKE/LIKE ... ESCAPE '\'. */
export function escapeLike(input: string): string {
    return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface WhereClause { sql: string; params: unknown[] }

/** WHERE del visor (sin cursor). Devuelve fragmentos fijos + parametros. */
export function buildAuditWhere(f: AuditFilters): WhereClause {
    const conds: string[] = [];
    const params: unknown[] = [];
    const add = (value: unknown) => { params.push(value); return `$${params.length}`; };

    if (f.event) {
        if (f.event.endsWith('*')) conds.push(`"event" LIKE ${add(`${escapeLike(f.event.slice(0, -1))}%`)} ESCAPE '\\'`);
        else conds.push(`"event" = ${add(f.event)}`);
    }
    if (f.user) {
        const p = add(f.user);
        conds.push(`("userId" = ${p} OR "data"->>'actorId' = ${p} OR "data"->>'targetUserId' = ${p})`);
    }
    if (f.from) conds.push(`"ts" >= ${add(new Date(f.from).toISOString())}::timestamptz`);
    if (f.to) conds.push(`"ts" <= ${add(toEnd(f.to).toISOString())}::timestamptz`);
    if (f.q) conds.push(`"event" ILIKE ${add(`%${escapeLike(f.q)}%`)} ESCAPE '\\'`);
    return { sql: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
}

// ---------------------------------------------------------------------------------------------------------------------
// Enmascarado en lectura
// ---------------------------------------------------------------------------------------------------------------------
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/;
const IPV6 = /^[0-9a-f:]+(%[\w.-]+)?$/i;
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Claves que contienen una IP: ip, clientIp, lastLoginIp, remote_ip, ipAddress. */
const IP_KEY = /^(ip|ipAddress|ip_address)$|(Ip|IP|_ip)(Address)?$/;
const MAX_STRING = 300;
const MAX_DEPTH = 6;
const MAX_KEYS = 100;
const MAX_ITEMS = 50;

/** IPv4 a.b.x.x; IPv6 primeros 2 grupos; IPv4-mapeada como IPv4. Lo irreconocible no se muestra. */
export function maskIp(ip: unknown): string | null {
    if (ip === null || ip === undefined || ip === '') return null;
    const s = String(ip).trim();
    const v4 = IPV4.exec(s);
    if (v4) return `${v4[1]}.${v4[2]}.x.x`;
    const mapped = /^::ffff:(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/i.exec(s);
    if (mapped) return `${mapped[1]}.${mapped[2]}.x.x`;
    if (s.includes(':') && IPV6.test(s)) {
        const groups = s.split(':').filter((g) => g !== '');
        if (groups.length >= 2) return `${groups[0]}:${groups[1]}:x:x:x:x:x:x`;
        if (groups.length === 1) return `${groups[0]}:x:x:x:x:x:x:x`;
    }
    return '***';
}

function maskString(s: string): string {
    const t = s.trim();
    if (IPV4.test(t) || (t.includes(':') && /^[0-9a-f:]{3,45}$/i.test(t) && t.split(':').length >= 3)) return maskIp(t) ?? '';
    const masked = s.replace(EMAIL_IN_TEXT, (m) => maskEmail(m));
    return masked.length > MAX_STRING ? `${masked.slice(0, MAX_STRING)}...` : masked;
}

function sanitizeValue(value: unknown, depth: number): unknown {
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') return maskString(value);
    if (depth >= MAX_DEPTH) return '...';
    if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((v) => sanitizeValue(v, depth + 1));
    if (typeof value === 'object') return sanitizeObject(value as Record<string, unknown>, depth + 1);
    return undefined;
}

function sanitizeObject(obj: Record<string, unknown>, depth: number): Record<string, unknown> {
    const limited: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj).slice(0, MAX_KEYS)) limited[k] = v;
    // redactAuditData quita claves sensibles y enmascara las "email"; luego se recorre cada valor.
    const redacted = redactAuditData(limited);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(redacted)) {
        if (typeof v === 'string' && IP_KEY.test(k)) {
            out[k] = maskIp(v);
            continue;
        }
        const s = sanitizeValue(v, depth);
        if (s !== undefined) out[k] = s;
    }
    return out;
}

/** JSON de auditoria seguro para el navegador (puro, testeable). */
export function sanitizeAuditData(data: unknown): Record<string, unknown> {
    let value = data;
    if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch { return { value: maskString(String(data)) }; }
    }
    if (Array.isArray(value)) return { items: sanitizeValue(value, 1) };
    if (!value || typeof value !== 'object') return {};
    return sanitizeObject(value as Record<string, unknown>, 0);
}

// ---------------------------------------------------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------------------------------------------------
interface AuditDbRow { id: string; ts: Date | string; event: string; userId: string | null; ip: string | null; data: unknown }

export interface AuditEntry {
    id: string;
    ts: string | null;
    event: string;
    userId: string | null;
    ip: string | null;
    data: Record<string, unknown>;
}

export function toEntry(r: AuditDbRow): AuditEntry {
    return {
        id: String(r.id),
        ts: toIso(r.ts),
        event: String(r.event),
        userId: r.userId ? String(r.userId).slice(0, 200) : null,
        ip: maskIp(r.ip),
        data: sanitizeAuditData(r.data),
    };
}

export interface AuditPage {
    available: boolean;
    items: AuditEntry[];
    total: number;
    totalCapped: boolean;
    page: number;
    pageSize: number;
    pages: number;
    nextCursor: string | null;
    eventTypes: string[];
}

const COLUMNS = `"id", "ts", "event", "userId", "ip", "data"`;

export async function listRecentEventTypes(): Promise<string[]> {
    const rows = await tolerant(
        () => query<{ event: string }>(`SELECT DISTINCT "event" FROM (SELECT "event" FROM "AuditEvent" ORDER BY "ts" DESC LIMIT 5000) s ORDER BY "event" LIMIT 200`),
        [],
    );
    return rows.map((r) => String(r.event));
}

/** Pagina del visor. Con `cursor` valido se ignora el offset (orden ts DESC, id DESC). */
export async function listAudit(filters: AuditFilters, paging: Paging): Promise<AuditPage> {
    const empty: AuditPage = { available: false, items: [], total: 0, totalCapped: false, page: paging.page, pageSize: paging.pageSize, pages: 1, nextCursor: null, eventTypes: [] };
    const where = buildAuditWhere(filters);
    const cursor = decodeCursor(filters.cursor);
    if (filters.cursor && !cursor) throw new Error('invalid_cursor');

    return tolerant(async () => {
        const countRows = await query<{ n: bigint | number }>(
            `SELECT COUNT(*) AS n FROM (SELECT 1 FROM "AuditEvent" ${where.sql} LIMIT ${COUNT_CAP + 1}) c`,
            ...where.params,
        );
        const counted = num(countRows[0]?.n);
        const totalCapped = counted > COUNT_CAP;
        const total = Math.min(counted, COUNT_CAP);

        const params = [...where.params];
        let sql = `SELECT ${COLUMNS} FROM "AuditEvent" ${where.sql}`;
        if (cursor) {
            params.push(new Date(cursor.ts).toISOString(), cursor.id);
            const glue = where.sql ? ' AND' : ' WHERE';
            sql += `${glue} ("ts", "id") < ($${params.length - 1}::timestamptz, $${params.length})`;
        }
        params.push(paging.pageSize + 1);
        sql += ` ORDER BY "ts" DESC, "id" DESC LIMIT $${params.length}`;
        if (!cursor) {
            params.push(paging.offset);
            sql += ` OFFSET $${params.length}`;
        }
        const rows = await query<AuditDbRow>(sql, ...params);
        const hasMore = rows.length > paging.pageSize;
        const pageRows = rows.slice(0, paging.pageSize);
        const last = pageRows[pageRows.length - 1];
        const nextCursor = hasMore && last && toIso(last.ts) ? encodeCursor({ ts: toIso(last.ts)!, id: String(last.id) }) : null;
        const eventTypes = await listRecentEventTypes();
        return {
            available: true,
            items: pageRows.map(toEntry),
            total,
            totalCapped,
            page: paging.page,
            pageSize: paging.pageSize,
            pages: Math.max(1, Math.ceil(total / paging.pageSize)),
            nextCursor,
            eventTypes,
        };
    }, empty);
}

/** Filas para el CSV (maximo EXPORT_MAX_ROWS, mas recientes primero). `null` si la tabla no existe. */
export async function listAuditForExport(filters: AuditFilters): Promise<AuditEntry[] | null> {
    const where = buildAuditWhere(filters);
    return tolerant<AuditEntry[] | null>(async () => {
        const rows = await query<AuditDbRow>(
            `SELECT ${COLUMNS} FROM "AuditEvent" ${where.sql} ORDER BY "ts" DESC, "id" DESC LIMIT ${EXPORT_MAX_ROWS}`,
            ...where.params,
        );
        return rows.map(toEntry);
    }, null);
}
