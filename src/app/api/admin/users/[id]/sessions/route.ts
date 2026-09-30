import { revokeAllSessions } from '@/lib/session';
import { adminRoute, audit, notFound } from '@/lib/admin/http';
import { getUserBasic } from '@/lib/admin/users-store';

// Cierra TODAS las sesiones del usuario (sube tokenVersion).
export const DELETE = adminRoute<{ id: string }>({ scope: 'users.sessions', write: true }, async (ctx, { id }) => {
    const user = await getUserBasic(id);
    if (!user) throw notFound('user_not_found');
    const ok = await revokeAllSessions(id);
    audit(ctx, 'users.sessions_revoked', { targetUserId: id, scope: 'all', applied: ok });
    return { success: true, applied: ok };
});
