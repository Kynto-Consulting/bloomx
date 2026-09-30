import { actorKey, adminRoute, audit, parseBody } from '@/lib/admin/http';
import { getQuotaSettings, quotaPatchSchema, saveQuotaSettings } from '@/lib/admin/quota-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET -> { mailQuotaMb, enforceMailQuota, envMailQuotaMb, effectiveMb, source, updatedAt, updatedBy, maxMb }. */
export const GET = adminRoute({ scope: 'retention.quota.read', limit: 60 }, async () => ({ ...(await getQuotaSettings()) }));

/**
 * PUT { mailQuotaMb?: n|null, enforceMailQuota?: bool|null }: cuota por usuario del dominio (MB; 0 = sin limite) y bloqueo de
 * envio al 100 % (por defecto NO). `null` borra el valor guardado. Con `userId` (+ mailQuotaMb) fija la cuota SOLO de ese usuario.
 */
export const PUT = adminRoute({ scope: 'retention.quota.write', write: true, limit: 20 }, async (ctx) => {
    const patch = await parseBody(ctx.req, quotaPatchSchema);
    const view = await saveQuotaSettings(patch, ctx.actor.email || actorKey(ctx.actor, ctx.ip));
    audit(ctx, 'quota.settings_changed', {
        ...(patch.userId ? { targetUserId: patch.userId, scope: 'user' } : { scope: 'domain' }),
        ...(patch.mailQuotaMb !== undefined ? { mailQuotaMb: patch.mailQuotaMb } : {}),
        ...(patch.enforceMailQuota !== undefined ? { enforceMailQuota: patch.enforceMailQuota === true } : {}),
    });
    return { ...view };
});
