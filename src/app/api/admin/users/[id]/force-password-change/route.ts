import { z } from 'zod';
import { revokeAllSessions } from '@/lib/session';
import { adminRoute, audit, conflict, HttpError, notFound, parseBody } from '@/lib/admin/http';
import { setMustChangePassword } from '@/lib/admin/user-state';
import { getUserBasic, isSelf } from '@/lib/admin/users-store';
import { assertOutranks } from '@/lib/admin/outranks';

const schema = z.object({ revokeSessions: z.boolean().optional() });

// Marca mustChangePassword (el login redirige a /security?force=1) y, opcionalmente, cierra las sesiones vigentes.
export const POST = adminRoute<{ id: string }>({ scope: 'users.password', write: true }, async (ctx, { id }) => {
    const body = await parseBody(ctx.req, schema);
    if (isSelf(ctx.actor, id)) throw conflict('cannot_target_self');
    const user = await getUserBasic(id);
    if (!user) throw notFound('user_not_found');
    await assertOutranks(ctx.actor, user);
    const ok = await setMustChangePassword(id, true);
    if (!ok) throw new HttpError(503, 'admin_state_unavailable');
    if (body.revokeSessions) await revokeAllSessions(id);
    audit(ctx, 'users.force_password_change', { targetUserId: id, revokedSessions: !!body.revokeSessions });
    return { success: true };
});
