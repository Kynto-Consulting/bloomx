import { z } from 'zod';
import { adminRoute, audit, conflict, notFound, parseBody } from '@/lib/admin/http';
import { getAccountBrief, requestReconnect } from '@/lib/admin/accounts-store';

const schema = z.object({ mode: z.enum(['reconnect', 'refresh']).optional() });

/**
 * "Pedir reconexion": deja la cuenta en el mismo estado que la app escribe tras un invalid_grant (sin tokens), de modo que las
 * siguientes llamadas del usuario devuelven "reconectar" y le aparece el aviso. Es el USUARIO quien completa el OAuth.
 * mode='refresh' (mas suave): solo invalida el access_token para forzar un refresco.
 */
export const POST = adminRoute<{ id: string }>({ scope: 'accounts.reconnect', write: true }, async (ctx, { id }) => {
    const { mode = 'reconnect' } = await parseBody(ctx.req, schema);
    if (!id || id.length > 200) throw notFound('account_not_found');
    const account = await getAccountBrief(id);
    if (!account) throw notFound('account_not_found');
    if (mode === 'refresh' && !account.hasRefresh) throw conflict('no_refresh_token');
    await requestReconnect(id, mode);
    audit(ctx, 'accounts.reconnect_requested', { targetUserId: account.userId, provider: account.provider, accountId: account.id, mode });
    return { success: true, mode };
});
