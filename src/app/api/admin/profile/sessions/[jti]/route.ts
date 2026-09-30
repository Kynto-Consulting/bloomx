import { z } from 'zod';
import { adminRoute, audit, badRequest, conflict, notFound } from '@/lib/admin/http';
import { findSessionOfUser } from '@/lib/admin/session-registry';
import { getSessionCookie } from '@/lib/session';
import { revokeSession } from '@/lib/session-revocation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const jtiSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);

/** DELETE /api/admin/profile/sessions/[jti] -> cierra UNA sesion propia (nunca de otro usuario; 404 si no es suya). */
export const DELETE = adminRoute<{ jti: string }>({ scope: 'profile.sessions.revoke', limit: 30, write: true }, async (ctx, { jti }) => {
    if (ctx.actor.kind !== 'user') throw conflict('not_available_for_manager');
    if (!jtiSchema.safeParse(jti).success) throw badRequest('invalid_input');
    const own = await findSessionOfUser(ctx.actor.id, jti);
    if (!own) throw notFound('session_not_found');
    const current = await getSessionCookie();
    if (current?.jti === jti) throw conflict('current_session');
    await revokeSession(jti, ctx.actor.id, Math.floor(new Date(own.expiresAt).getTime() / 1000));
    audit(ctx, 'profile.session_revoked', { session: jti.slice(0, 8) });
    return { success: true };
});
