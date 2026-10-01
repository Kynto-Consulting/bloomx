import { z } from 'zod';
import { adminRoute, parseQuery } from '@/lib/admin/http';
import { permissionHistory } from '@/lib/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ email: z.string().trim().max(254).optional(), limit: z.coerce.number().int().min(1).max(200).optional() });

/** GET /api/admin/permissions/history?email=&limit= -> historial inmutable de cambios de nivel (quien, a quien, anterior -> nuevo, IP). Nivel >= 3. */
export const GET = adminRoute({ scope: 'permissions.history', limit: 60 }, async (ctx) => {
    const q = parseQuery(ctx.req, schema);
    return { history: await permissionHistory({ email: q.email, limit: q.limit }) };
});
