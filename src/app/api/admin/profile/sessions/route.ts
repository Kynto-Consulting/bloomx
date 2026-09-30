import { adminRoute, audit, conflict } from '@/lib/admin/http';
import { listActiveSessions } from '@/lib/admin/session-registry';
import { getCurrentUser, getSessionCookie, revokeAllSessions, setSessionCookie } from '@/lib/session';
import type { ProfileSession } from '@/lib/admin/profile-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function trimAgent(value: string | null): string | null {
    if (!value) return null;
    const s = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    return s ? s.slice(0, 120) : null;
}

/** GET /api/admin/profile/sessions -> sesiones activas propias (ip, agente recortado, fechas) con la marca "esta sesion". */
export const GET = adminRoute({ scope: 'profile.sessions', limit: 120 }, async ({ actor }) => {
    if (actor.kind !== 'user') throw conflict('not_available_for_manager');
    const [rows, session] = await Promise.all([listActiveSessions(actor.id), getSessionCookie()]);
    const currentJti = typeof session?.jti === 'string' ? session.jti : null;
    const sessions: ProfileSession[] = rows.map((r) => ({
        jti: r.jti,
        ip: r.ip,
        userAgent: trimAgent(r.userAgent),
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        mfa: r.mfa,
        current: r.jti === currentJti,
    }));
    return { sessions };
});

/**
 * DELETE /api/admin/profile/sessions -> cierra TODAS las demas sesiones conservando la actual.
 * Sube el tokenVersion del usuario (revoca incluso sesiones sin fila de registro) y reemite la sesion de este navegador
 * con el mismo estado de MFA. Mas simple y robusto que revocar jti a jti.
 */
export const DELETE = adminRoute({ scope: 'profile.sessions.revoke', limit: 10, write: true }, async (ctx) => {
    if (ctx.actor.kind !== 'user') throw conflict('not_available_for_manager');
    const [rows, session, user] = await Promise.all([listActiveSessions(ctx.actor.id), getSessionCookie(), getCurrentUser()]);
    if (!user) throw conflict('session_changed');
    const currentJti = typeof session?.jti === 'string' ? session.jti : null;
    const others = rows.filter((r) => r.jti !== currentJti).length;
    await revokeAllSessions(user.id);
    await setSessionCookie({ sub: user.id, email: user.email, name: user.name }, { mfa: session?.mfa === true });
    audit(ctx, 'profile.sessions_revoked_others', { count: others });
    return { success: true, revoked: others };
});
