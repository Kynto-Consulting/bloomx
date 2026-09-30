import { z } from 'zod';
import { adminRoute, parseQuery } from '@/lib/admin/http';
import { spamStats } from '@/lib/spam/events-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Spam / bloqueados / advertencias / externos por dia, principales dominios y falsos positivos reportados ("No es spam"). */
export const GET = adminRoute({ scope: 'spam.stats.read', limit: 60 }, async (ctx) => {
    const { days } = parseQuery(ctx.req, z.object({ days: z.coerce.number().int().min(1).max(365).optional() }));
    return { ...(await spamStats(days ?? 30)) };
});
