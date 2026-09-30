import { adminRoute, badRequest, parseQuery } from '@/lib/admin/http';
import { auditFiltersSchema, checkRange, listAudit } from '@/lib/admin/audit-store';
import { decodeCursor, parsePaging } from '@/lib/admin/paging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/audit?event=&user=&from=&to=&q=&page=&pageSize=&cursor=
 * Visor de auditoria. `event` admite prefijo con `*` final. Respuesta ENMASCARADA (correos, IP, claves) y paginada (<=100).
 */
export const GET = adminRoute({ scope: 'audit.read', limit: 120 }, async ({ req }) => {
    const filters = parseQuery(req, auditFiltersSchema);
    const range = checkRange(filters);
    if (range) throw badRequest(range);
    if (filters.cursor && !decodeCursor(filters.cursor)) throw badRequest('invalid_cursor');
    const paging = parsePaging(new URL(req.url).searchParams, { defaultSize: 25, maxSize: 100 });
    return { ...(await listAudit(filters, paging)) };
});
