import { actorKey, adminRoute, audit, notFound, parseBody } from '@/lib/admin/http';
import { getUserQuotaAdminView, saveQuotaSettings, userQuotaBodySchema } from '@/lib/admin/quota-settings';
import { getUserBasic } from '@/lib/admin/users-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET -> cuota efectiva del usuario y su ORIGEN (usuario / dominio / entorno / sin limite) + uso estimado. */
export const GET = adminRoute<{ id: string }>({ scope: 'users.quota.read', limit: 120 }, async (_ctx, { id }) => {
    if (!(await getUserBasic(id))) throw notFound('user_not_found');
    return { ...(await getUserQuotaAdminView(id)) };
});

/**
 * PUT { mailQuotaMb: entero 0..max | null }: fija la cuota SOLO de este usuario (MB; 0 = sin limite para el).
 * `null` restablece a la del dominio (borra el valor del usuario; vuelve la cadena dominio > entorno).
 * Auditado; el cambio se publica a las demas instancias (version en BD) y se ve en <= 5 s.
 */
export const PUT = adminRoute<{ id: string }>({ scope: 'users.quota.write', write: true, limit: 30 }, async (ctx, { id }) => {
    const body = await parseBody(ctx.req, userQuotaBodySchema);
    if (!(await getUserBasic(id))) throw notFound('user_not_found');
    await saveQuotaSettings({ userId: id, mailQuotaMb: body.mailQuotaMb }, ctx.actor.email || actorKey(ctx.actor, ctx.ip));
    audit(ctx, 'users.quota_changed', {
        targetUserId: id,
        scope: 'user',
        ...(body.mailQuotaMb === null ? { reset: true } : { mailQuotaMb: body.mailQuotaMb }),
    });
    return { ...(await getUserQuotaAdminView(id)) };
});
