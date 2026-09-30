import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { BCRYPT_COST } from '@/lib/security';
import { revokeAllSessions } from '@/lib/session';
import { adminRoute, audit, conflict, json, notFound, parseBody } from '@/lib/admin/http';
import { generateTemporaryPassword } from '@/lib/admin/temp-password';
import { setMustChangePassword } from '@/lib/admin/user-state';
import { getUserBasic, isSelf } from '@/lib/admin/users-store';

const schema = z.object({ mode: z.literal('temporary') });

/**
 * Restablece la contrasena con una TEMPORAL aleatoria: se guarda con bcrypt, se obliga a cambiarla en el proximo acceso
 * (login -> /security?force=1) y se cierran todas las sesiones. Se devuelve UNA sola vez (no-store) y NO se audita su valor.
 * Limite: el sistema no tiene envio de correo de recuperacion, por eso el admin debe entregarla por un canal seguro.
 */
export const POST = adminRoute<{ id: string }>({ scope: 'users.password', write: true, limit: 10 }, async (ctx, { id }) => {
    await parseBody(ctx.req, schema);
    if (isSelf(ctx.actor, id)) throw conflict('cannot_target_self');
    const user = await getUserBasic(id);
    if (!user) throw notFound('user_not_found');

    const temporaryPassword = generateTemporaryPassword(user.email);
    const hashed = await bcrypt.hash(temporaryPassword, BCRYPT_COST);
    await prisma.user.update({ where: { id }, data: { password: hashed } });
    const forced = await setMustChangePassword(id, true);
    await revokeAllSessions(id);
    audit(ctx, 'users.password_reset', { targetUserId: id, mode: 'temporary', mustChangePassword: forced });
    return json({ success: true, temporaryPassword, mustChangePassword: forced });
});
