import { disableMfa } from '@/lib/mfa';
import { revokeAllSessions } from '@/lib/session';
import { adminRoute, audit, conflict, notFound } from '@/lib/admin/http';
import { getUserBasic, isSelf } from '@/lib/admin/users-store';

// Restablecer MFA: borra el enrolamiento y cierra todas las sesiones. Un admin (MFA obligatorio) volvera a enrolar en su proximo login.
export const POST = adminRoute<{ id: string }>({ scope: 'users.mfa_reset', write: true, limit: 10 }, async (ctx, { id }) => {
    if (isSelf(ctx.actor, id)) throw conflict('cannot_target_self');
    const user = await getUserBasic(id);
    if (!user) throw notFound('user_not_found');
    await disableMfa(id);
    await revokeAllSessions(id);
    audit(ctx, 'users.mfa_reset', { targetUserId: id });
    return { success: true };
});
