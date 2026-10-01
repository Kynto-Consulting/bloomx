import { z } from 'zod';
import { adminRoute, NO_STORE, parseQuery } from '@/lib/admin/http';
import { usageCsv } from '@/lib/ai/usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const q = z.object({ days: z.coerce.number().int().min(1).max(366).optional() });

/** GET ?days=30 -> CSV de uso (text/csv, no-store). */
export const GET = adminRoute({ scope: 'ai.read', limit: 20 }, async (ctx) => {
    const csv = await usageCsv(parseQuery(ctx.req, q).days ?? 30);
    return new Response(csv, { headers: { ...NO_STORE, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="ai-usage.csv"' } });
});
