import { z } from 'zod';
import { adminRoute, audit, HttpError, notFound, parseBody } from '@/lib/admin/http';
import { assertFreshMfa } from '@/lib/admin/stepup';
import { unlockAccount } from '@/lib/privileged-session';
import { findUserByEmail } from '@/lib/user-lookup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ email: z.string().trim().min(3).max(254) }).strict();

/**
 * POST /api/admin/permissions/unlock { email } -> levanta el bloqueo del acceso privilegiado (pelea de sesiones). SOLO superadmin (nivel 4)
 * con step-up MFA. Si la cuenta bloqueada es el unico superadmin, el desbloqueo sale por el rescate de entorno ADMIN_LOCKOUT_RESET=<correo>
 * (ver docs). Se audita (`admin.permissions.unlocked`).
 */
export const POST = adminRoute({ scope: 'permissions.unlock', write: true, limit: 10, windowMs: 10 * 60_000 }, async (ctx) => {
    const { email } = await parseBody(ctx.req, schema);
    await assertFreshMfa(ctx);
    const user = await findUserByEmail(email);
    if (!user) throw notFound('user_not_found');
    if (ctx.actor.kind === 'user' && ctx.actor.id === user.id) throw new HttpError(409, 'cannot_target_self', 'cannot_target_self');
    const unlocked = await unlockAccount(user.id);
    audit(ctx, 'permissions.unlocked', { targetUserId: user.id, email: user.email, unlocked });
    return { success: true, unlocked };
});
