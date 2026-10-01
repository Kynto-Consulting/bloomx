import { HttpError, type AdminCtx } from './http';
import { REAUTH_COOKIE, sessionMfaRecent, verifyReauthToken } from '@/lib/mail-transfer/auth';
import { getSessionCookie } from '@/lib/session';

/**
 * Step-up de las operaciones criticas (niveles de permisos, desbloqueos, politica de sesiones privilegiadas): reautenticacion reciente
 * (10 min). Un usuario de la app debe haberla hecho con un CODIGO MFA (o haber verificado el MFA hace < 10 min en esta sesion); una manager
 * duena del dominio puede usar su contrasena (su MFA vive en el backend compartido). La prueba es la cookie `bx_mt_reauth` que emite
 * /api/admin/mail-transfer/reauth (web) o /api/admin/cli/reauth (CLI y consola de comandos, inyectada por el puente).
 */
export async function isFreshMfa(ctx: Pick<AdminCtx, 'req' | 'actor'>): Promise<boolean> {
    const key = ctx.actor.id || ctx.actor.email || 'admin';
    const session = ctx.actor.kind === 'user' ? await getSessionCookie().catch(() => null) : null; // sin cookie de sesion (CLI / puente): solo cuenta la prueba
    const sid = typeof session?.jti === 'string' ? session.jti : null;
    const proof = verifyReauthToken(ctx.req.cookies.get(REAUTH_COOKIE)?.value, key, sid);
    const fresh = proof.ok && (ctx.actor.kind === 'manager' || proof.method === 'mfa');
    return fresh || (ctx.actor.kind === 'user' && sessionMfaRecent(session));
}

export async function assertFreshMfa(ctx: AdminCtx): Promise<void> {
    if (!(await isFreshMfa(ctx))) {
        throw new HttpError(403, 'reauth_required', ctx.actor.kind === 'user' ? 'mfa_reauth_required' : 'reauth_required');
    }
}
