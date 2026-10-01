import { revokeSession } from '@/lib/session-revocation';
import { adminRoute, audit, notFound } from '@/lib/admin/http';
import { findSessionOfUser } from '@/lib/admin/session-registry';
import { getUserBasic } from '@/lib/admin/users-store';
import { assertOutranks } from '@/lib/admin/outranks';

// Cierra UNA sesion: solo si el jti pertenece a ese usuario (si no, 404: no se puede revocar la sesion de otro).
export const DELETE = adminRoute<{ id: string; jti: string }>({ scope: 'users.sessions', write: true }, async (ctx, { id, jti }) => {
    if (!jti || jti.length > 200) throw notFound('session_not_found');
    const target = await getUserBasic(id);
    if (!target) throw notFound('user_not_found');
    await assertOutranks(ctx.actor, target);
    const session = await findSessionOfUser(id, jti);
    if (!session) throw notFound('session_not_found');
    await revokeSession(jti, id, Math.floor(new Date(session.expiresAt).getTime() / 1000));
    audit(ctx, 'users.session_revoked', { targetUserId: id, scope: 'one' });
    return { success: true };
});
