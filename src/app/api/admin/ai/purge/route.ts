import { z } from 'zod';
import { adminRoute, audit, parseBody } from '@/lib/admin/http';
import { resolveAi, recordAudit } from '@/lib/ai/settings';
import { purgeUsage } from '@/lib/ai/usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ retentionDays: z.number().int().min(1).max(3650).optional() }).strict();

/** POST { retentionDays? } -> borra el registro de uso anterior a N dias (defecto: la retencion configurada). */
export const POST = adminRoute({ scope: 'ai.purge', write: true, limit: 5 }, async (ctx) => {
    const body = await parseBody(ctx.req, bodySchema);
    const days = body.retentionDays ?? (await resolveAi({ fresh: true })).config.retentionDays;
    const purged = await purgeUsage(days);
    await recordAudit(ctx.actor.email || ctx.actor.id || 'admin', 'usage.purge', [`retentionDays:${days}`]);
    audit(ctx, 'ai.purge', { retentionDays: days, purged });
    return { purged, retentionDays: days };
});
