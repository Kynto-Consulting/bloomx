import bcrypt from 'bcryptjs';
import { adminRoute, audit, badRequest, conflict, notFound, parseBody } from '@/lib/admin/http';
import { passwordChangeSchema, passwordPolicyCode } from '@/lib/admin/profile-password';
import { setMustChangePassword } from '@/lib/admin/user-state';
import { prisma } from '@/lib/prisma';
import { getSessionCookie, revokeAllSessions, setSessionCookie } from '@/lib/session';
import { BCRYPT_COST, validateNewPassword } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PUT /api/admin/profile/password { currentPassword, newPassword }  (solo admins kind "user").
 * Comprueba la actual (bcrypt), aplica la politica 12+, guarda el hash, cierra TODAS las sesiones y emite una nueva para
 * este dispositivo conservando el estado de MFA. Limite estricto (5 / 15 min) contra fuerza bruta de la contrasena actual.
 * Nunca devuelve ni audita contrasenas (ni hashes).
 */
export const PUT = adminRoute({ scope: 'profile.password', limit: 5, windowMs: 15 * 60_000, write: true }, async (ctx) => {
    if (ctx.actor.kind !== 'user') throw conflict('not_available_for_manager');
    const body = await parseBody(ctx.req, passwordChangeSchema);
    const userId = ctx.actor.id;

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true, password: true } });
    if (!user) throw notFound('user_not_found');

    const currentOk = !!user.password && (await bcrypt.compare(body.currentPassword, user.password));
    if (!currentOk) {
        audit(ctx, 'profile.password_change_failed', { reason: 'incorrect_current' });
        throw badRequest('incorrect_current_password');
    }
    const policy = validateNewPassword(body.newPassword, user.email);
    if (policy) throw badRequest(passwordPolicyCode(policy));
    if (body.newPassword === body.currentPassword) throw badRequest('password_unchanged');

    const hashed = await bcrypt.hash(body.newPassword, BCRYPT_COST);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });

    // NIST IA-5(1) / AC-12: se cierran todas las sesiones y se emite una nueva (con el mismo estado de MFA) para este navegador.
    const current = await getSessionCookie();
    await revokeAllSessions(user.id);
    await setSessionCookie({ sub: user.id, email: user.email, name: user.name }, { mfa: current?.mfa === true });
    await setMustChangePassword(user.id, false);

    audit(ctx, 'profile.password_changed', {});
    return { success: true };
});
