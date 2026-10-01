import { adminRoute, audit, notFound } from '@/lib/admin/http';
import { deleteAccount, getAccountBrief } from '@/lib/admin/accounts-store';
import { getUserBasic } from '@/lib/admin/users-store';
import { assertOutranks } from '@/lib/admin/outranks';

// DELETE: desvincular (borra la fila). Se audita proveedor y usuario, nunca tokens.
export const DELETE = adminRoute<{ id: string }>({ scope: 'accounts.unlink', write: true }, async (ctx, { id }) => {
    if (!id || id.length > 200) throw notFound('account_not_found');
    const account = await getAccountBrief(id);
    if (!account) throw notFound('account_not_found');
    const owner = await getUserBasic(account.userId);
    if (owner) await assertOutranks(ctx.actor, owner);
    if (!(await deleteAccount(id))) throw notFound('account_not_found');
    audit(ctx, 'accounts.unlinked', { targetUserId: account.userId, provider: account.provider, accountId: account.id });
    return { success: true };
});
