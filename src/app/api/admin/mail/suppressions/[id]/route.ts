import { z } from 'zod';
import { audit, adminRoute, notFound, badRequest } from '@/lib/admin/http';
import { removeSuppressions } from '@/lib/admin/mail-store';
import { maskEmail } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.string().min(1).max(200);

/** DELETE /api/admin/mail/suppressions/[id] -> quita una supresion (borra la fila EmailEvent). 404 si no existe o no es de tipo unsubscribe. */
export const DELETE = adminRoute<{ id: string }>({ scope: 'mail.suppressions.write', write: true }, async (ctx, { id }) => {
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) throw badRequest('invalid_input');
    const [removed] = await removeSuppressions([parsed.data]);
    if (!removed) throw notFound();
    audit(ctx, 'mail.suppression_removed', {
        suppressionId: removed.id,
        recipientEmail: maskEmail(removed.recipient),
        reason: removed.reason,
        senderUserId: removed.sender ?? undefined,
    });
    return { ok: true, removed: 1 };
});
