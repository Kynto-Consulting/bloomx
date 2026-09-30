import { adminRoute, audit, parseQuery } from '@/lib/admin/http';
import { csvResponse, toCsv } from '@/lib/admin/csv';
import { listUsers, userFiltersSchema } from '@/lib/admin/users-store';

const EXPORT_MAX_ROWS = 10_000;

// Columnas en lista blanca: nada de contrasenas, tokens, avatares ni contenido de correo.
const COLUMNS = [
    { key: 'id', header: 'id' },
    { key: 'name', header: 'name' },
    { key: 'email', header: 'email' },
    { key: 'createdAt', header: 'createdAt' },
    { key: 'disabled', header: 'disabled' },
    { key: 'isAdmin', header: 'isAdmin' },
    { key: 'mfaEnabled', header: 'mfaEnabled' },
    { key: 'googleLinked', header: 'googleLinked' },
    { key: 'lastLoginAt', header: 'lastLoginAt' },
    { key: 'storageBytes', header: 'storageBytes' },
] as const;

// CSV con los MISMOS filtros que la lista (hasta 10 000 filas). toCsv neutraliza formulas (= + - @).
export const GET = adminRoute({ scope: 'users.export', limit: 10 }, async (ctx) => {
    const filters = parseQuery(ctx.req, userFiltersSchema);
    const { rows, total } = await listUsers(filters, { limit: EXPORT_MAX_ROWS, offset: 0 });
    audit(ctx, 'users.exported', { count: rows.length, total });
    const body = toCsv(
        rows.map((r) => ({ ...r })),
        COLUMNS.map((c) => ({ key: c.key, header: c.header })),
    );
    return csvResponse(body, `users-${new Date().toISOString().slice(0, 10)}.csv`);
});
