import { z } from 'zod';
import { adminRoute, audit, HttpError, parseBody } from '@/lib/admin/http';
import { assertFreshMfa } from '@/lib/admin/stepup';
import { LEVEL_DOCS } from '@/lib/admin-levels';
import { changePermission, listPermissionAccounts, notifyPermissionChange, PermissionError } from '@/lib/permissions';
import { MAX_PRIVILEGED_ACCOUNTS, isPermissionsLocked } from '@/lib/permissions-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET  /api/admin/permissions -> { levels, accounts[], me, locked, limits }   (nivel >= 3)
 *      accounts = cuentas con nivel >= 1: correo, nombre, nivel, origen (env = fijado por entorno | console), quien lo concedio y cuando, MFA.
 * POST /api/admin/permissions { email, permission_level: 0..4, note?, confirmSuper? }  (nivel >= 3, step-up OBLIGATORIO)
 *      Reglas (permissions-core.checkPermissionChange): solo un nivel estrictamente menor al propio (el superadmin puede dar 0..4 pero
 *      conceder 4 exige `confirmSuper: true`); nadie modifica a alguien de nivel >= al suyo (salvo un superadmin sobre otro de consola),
 *      ni a si mismo; el entorno fija a ADMIN_EMAILS en 4; la cuenta debe existir y tener MFA (o MFA obligatorio); maximo 25 cuentas con
 *      nivel >= 3; ADMIN_EMAILS_LOCKED=true desactiva todo. Se audita (quien, a quien, anterior -> nuevo, IP) y se avisa por correo.
 */
export const GET = adminRoute({ scope: 'permissions.read', limit: 60 }, async ({ actor }) => ({
    levels: Object.entries(LEVEL_DOCS).map(([level, d]) => ({ permission_level: Number(level), name: d.es.name, es: d.es.can, en: d.en.can })),
    accounts: await listPermissionAccounts(),
    me: { email: actor.email ?? null, permission_level: actor.level, levelSource: actor.levelSource },
    locked: isPermissionsLocked(),
    limits: { maxPrivilegedAccounts: MAX_PRIVILEGED_ACCOUNTS },
}));

const schema = z.object({
    email: z.string().trim().min(3).max(254),
    permission_level: z.number().int().min(0).max(4),
    note: z.string().trim().max(300).optional(),
    confirmSuper: z.boolean().optional(),
}).strict();

export const POST = adminRoute({ scope: 'permissions.write', write: true, limit: 10, windowMs: 10 * 60_000 }, async (ctx) => {
    const body = await parseBody(ctx.req, schema);

    await assertFreshMfa(ctx); // step-up obligatorio (codigo MFA para usuarios; contrasena para la manager duena)

    try {
        const r = await changePermission({
            actor: { kind: ctx.actor.kind, id: ctx.actor.id, email: ctx.actor.email ?? '', level: ctx.actor.level },
            targetEmail: body.email, newLevel: body.permission_level, note: body.note, confirmSuper: body.confirmSuper, ip: ctx.ip,
            source: ctx.req.headers.get('x-bloomx-via') === 'cli' ? 'cli' : 'console',
        });
        audit(ctx, 'permissions.changed', { targetUserId: r.userId ?? undefined, email: r.email, from: r.from, to: r.to, fromSource: r.fromSource, hasNote: !!body.note });
        void notifyPermissionChange(r, ctx.actor.email ?? 'admin');
        return { success: true, email: r.email, from: r.from, to: r.to, privilegedAccounts: r.privileged };
    } catch (e) {
        if (e instanceof PermissionError) {
            audit(ctx, 'permissions.change_denied', { email: body.email, to: body.permission_level, reason: e.code });
            throw new HttpError(e.status, e.code, e.message);
        }
        throw e;
    }
});
