import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getMfaStatus, isAdminEmail, mfaRequiredFor } from '@/lib/mfa';
import { refreshPermissions } from '@/lib/permissions';
import { effectiveLevelSync, levelName } from '@/lib/permissions-core';
import { revokeAllSessions } from '@/lib/session';
import { adminRoute, audit, conflict, HttpError, notFound, parseBody } from '@/lib/admin/http';
import { getUserState, setUserDisabled } from '@/lib/admin/user-state';
import { listActiveSessions } from '@/lib/admin/session-registry';
import { getUserBasic, getUserStorage, isSelf, listUserAccounts } from '@/lib/admin/users-store';
import { getUserQuotaAdminView } from '@/lib/admin/quota-settings';
import { assertOutranks } from '@/lib/admin/outranks';

// GET: detalle (datos basicos, estado admin, MFA, cuentas vinculadas sin tokens, sesiones activas, almacenamiento: solo conteos).
export const GET = adminRoute<{ id: string }>({ scope: 'users.detail' }, async ({ actor }, { id }) => {
    const user = await getUserBasic(id);
    if (!user) throw notFound('user_not_found');
    await refreshPermissions();
    const perm = effectiveLevelSync(user.email);
    const [state, mfa, accounts, sessions, storage, quota] = await Promise.all([
        getUserState(id),
        getMfaStatus(id),
        listUserAccounts(id),
        listActiveSessions(id),
        getUserStorage(id),
        getUserQuotaAdminView(id).catch(() => null),
    ]);
    return {
        user: { ...user, isAdmin: isAdminEmail(user.email), isSelf: isSelf(actor, id), permission_level: perm.level, levelName: levelName(perm.level), levelSource: perm.source },
        state,
        mfa: {
            available: mfa.available,
            enabled: mfa.enabled,
            pendingEnrollment: mfa.pendingEnrollment,
            recoveryCodesLeft: mfa.recoveryCodesLeft,
            required: mfaRequiredFor(user.email),
        },
        accounts,
        // El jti identifica la sesion para revocarla; nunca se devuelve el token ni la cookie.
        sessions: sessions.map((s) => ({ jti: s.jti, mfa: s.mfa, ip: s.ip, userAgent: s.userAgent, createdAt: s.createdAt, expiresAt: s.expiresAt })),
        storage,
        quota,
    };
});

const patchSchema = z
    .object({ name: z.string().trim().max(200).optional(), disabled: z.boolean().optional() })
    .refine((v) => v.name !== undefined || v.disabled !== undefined, { message: 'empty' });

// PATCH: nombre y/o habilitar-deshabilitar. El rol NO se edita (lo define ADMIN_EMAILS).
export const PATCH = adminRoute<{ id: string }>({ scope: 'users.update', write: true }, async (ctx, { id }) => {
    const body = await parseBody(ctx.req, patchSchema);
    if (body.disabled === true && isSelf(ctx.actor, id)) throw conflict('cannot_disable_self');
    const user = await getUserBasic(id);
    if (!user) throw notFound('user_not_found');
    await assertOutranks(ctx.actor, user);

    if (body.name !== undefined) {
        await prisma.user.update({ where: { id }, data: { name: body.name || null } });
        audit(ctx, 'users.updated', { targetUserId: id, fields: ['name'] });
    }
    if (body.disabled !== undefined) {
        const ok = await setUserDisabled(id, body.disabled);
        if (!ok) throw new HttpError(503, 'admin_state_unavailable');
        if (body.disabled) await revokeAllSessions(id);
        audit(ctx, body.disabled ? 'users.disabled' : 'users.enabled', { targetUserId: id });
    }
    return { success: true };
});
