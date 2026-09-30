import { z } from 'zod';
import { audit, adminRoute, parseBody } from '@/lib/admin/http';
import { removeSuppressions } from '@/lib/admin/mail-store';
import { maskEmail } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BULK_MAX = 100;
const schema = z.object({ ids: z.array(z.string().min(1).max(200)).min(1).max(BULK_MAX) });

/** POST /api/admin/mail/suppressions/bulk-delete { ids } (max 100) -> quita varias supresiones; una sola entrada de auditoria con los destinatarios enmascarados. */
export const POST = adminRoute({ scope: 'mail.suppressions.write', write: true }, async (ctx) => {
    const { ids } = await parseBody(ctx.req, schema);
    const removed = await removeSuppressions(ids);
    if (removed.length > 0) {
        const byReason: Record<string, number> = {};
        for (const r of removed) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
        audit(ctx, 'mail.suppressions_bulk_removed', {
            count: removed.length,
            requested: new Set(ids).size,
            byReason,
            recipients: removed.map((r) => maskEmail(r.recipient)),
        });
    }
    return { ok: true, removed: removed.length, requested: new Set(ids).size };
});
