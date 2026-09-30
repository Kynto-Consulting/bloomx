import { z } from 'zod';
import { adminRoute, parseQuery } from '@/lib/admin/http';
import { parsePaging } from '@/lib/admin/paging';
import { listSuppressions, SUPPRESSION_REASONS } from '@/lib/admin/mail-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
    q: z.string().trim().max(200).optional(),
    reason: z.enum(SUPPRESSION_REASONS).optional(),
    page: z.string().max(6).optional(),
    pageSize: z.string().max(4).optional(),
});

/**
 * GET /api/admin/mail/suppressions?q&reason&page&pageSize -> lista paginada de supresiones (EmailEvent type='unsubscribe').
 * Unica lista con direcciones de la seccion: destinatario suprimido, motivo, fecha y correo del usuario remitente. Nada mas.
 */
export const GET = adminRoute({ scope: 'mail.suppressions', limit: 120 }, async ({ req }) => {
    const { q, reason } = parseQuery(req, schema);
    const paging = parsePaging(new URL(req.url).searchParams, { defaultSize: 25, maxSize: 100 });
    const { items, meta } = await listSuppressions({ q: q || undefined, reason, paging });
    return { items, ...meta };
});
