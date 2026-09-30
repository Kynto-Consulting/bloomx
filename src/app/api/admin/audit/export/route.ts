import { adminRoute, audit, badRequest, parseQuery } from '@/lib/admin/http';
import { auditFiltersSchema, checkRange, EXPORT_MAX_ROWS, listAuditForExport } from '@/lib/admin/audit-store';
import { csvResponse, toCsv } from '@/lib/admin/csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Columnas en lista blanca: ninguna contiene datos sin enmascarar. */
const COLUMNS = [
    { key: 'ts', header: 'timestamp' },
    { key: 'event', header: 'event' },
    { key: 'userId', header: 'userId' },
    { key: 'ip', header: 'ip' },
    { key: 'data', header: 'data' },
] as const;

/** GET /api/admin/audit/export -> CSV (max 10 000 filas) con los mismos filtros que el visor (sin paginacion). */
export const GET = adminRoute({ scope: 'audit.export', limit: 10, windowMs: 10 * 60_000 }, async (ctx) => {
    const { cursor: _ignored, ...filters } = parseQuery(ctx.req, auditFiltersSchema);
    const range = checkRange(filters);
    if (range) throw badRequest(range);
    const entries = await listAuditForExport(filters);
    const rows = (entries ?? []).map((e) => ({ ts: e.ts, event: e.event, userId: e.userId, ip: e.ip, data: JSON.stringify(e.data) }));
    audit(ctx, 'audit.exported', {
        rows: rows.length,
        truncated: rows.length >= EXPORT_MAX_ROWS,
        event: filters.event,
        from: filters.from,
        to: filters.to,
        hasUserFilter: !!filters.user,
        hasQuery: !!filters.q,
    });
    const stamp = new Date().toISOString().slice(0, 10);
    return csvResponse(toCsv(rows, COLUMNS), `audit-${stamp}.csv`);
});
