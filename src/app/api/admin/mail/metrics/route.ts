import { z } from 'zod';
import { adminRoute, parseQuery } from '@/lib/admin/http';
import { getMailMetrics, MAIL_RANGES } from '@/lib/admin/mail-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ range: z.enum(MAIL_RANGES).default('7d') });

/** GET /api/admin/mail/metrics?range=24h|7d|30d -> metadatos agregados de correo (sin asuntos, cuerpos ni listas de direcciones). */
export const GET = adminRoute({ scope: 'mail.metrics', limit: 60 }, async ({ req }) => {
    const { range } = parseQuery(req, schema);
    return { ...(await getMailMetrics(range)) };
});
