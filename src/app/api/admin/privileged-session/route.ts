import { z } from 'zod';
import { adminRoute, audit, HttpError, parseBody } from '@/lib/admin/http';
import { assertFreshMfa } from '@/lib/admin/stepup';
import { closePrivileged, getPrivilegedStatus, POLICY_LIMITS, setPrivilegedPolicy } from '@/lib/privileged-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const accountId = (actor: { id?: string; email?: string }) => {
    const id = actor.id || actor.email;
    if (!id) throw new HttpError(403, 'no_admin_identity');
    return id;
};

/**
 * GET    /api/admin/privileged-session -> { active: { kind, ip, device, since, lastSeenAt, refShort, expiresIdleAt, expiresAbsoluteAt } | null, locked, policy, limits }
 *        La sesion privilegiada unica de TU cuenta (consola web o CLI interactivo): donde y desde cuando. Nivel >= 1.
 * DELETE /api/admin/privileged-session -> cierra esa sesion (la revoca en servidor) y libera el slot ("Cerrar sesion privilegiada").
 * PUT    /api/admin/privileged-session { idleMinutes?, lockThreshold?, lockWindowMinutes? } -> politica de la instancia (nivel 4 + step-up MFA):
 *        inactividad 5..60 min (15 por defecto), umbral de reemplazos 2..10 (3) y ventana 1..60 min (10) del bloqueo por pelea de sesiones.
 */
export const GET = adminRoute({ scope: 'privileged.read', limit: 120 }, async ({ actor }) => ({
    ...(await getPrivilegedStatus(accountId(actor))),
    limits: POLICY_LIMITS,
}));

export const DELETE = adminRoute({ scope: 'privileged.close', write: true, limit: 20 }, async (ctx) => {
    const r = await closePrivileged(accountId(ctx.actor));
    audit(ctx, 'session.closed_by_owner', { closed: r.closed, kind: r.kind ?? undefined });
    return { success: true, closed: r.closed, kind: r.kind };
});

const policySchema = z.object({
    idleMinutes: z.number().int().min(POLICY_LIMITS.idleMinutes.min).max(POLICY_LIMITS.idleMinutes.max).optional(),
    lockThreshold: z.number().int().min(POLICY_LIMITS.lockThreshold.min).max(POLICY_LIMITS.lockThreshold.max).optional(),
    lockWindowMinutes: z.number().int().min(POLICY_LIMITS.lockWindowMinutes.min).max(POLICY_LIMITS.lockWindowMinutes.max).optional(),
}).strict().refine((v) => Object.keys(v).length > 0, { message: 'empty' });

export const PUT = adminRoute({ scope: 'privileged.policy', write: true, limit: 10 }, async (ctx) => {
    const body = await parseBody(ctx.req, policySchema);
    await assertFreshMfa(ctx);
    const policy = await setPrivilegedPolicy(body, ctx.actor.email || accountId(ctx.actor));
    audit(ctx, 'session.policy_changed', { ...body });
    return { success: true, policy };
});
