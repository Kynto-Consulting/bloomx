import { adminRoute, conflict } from '@/lib/admin/http';
import { getCurrentUser } from '@/lib/session';
import { getMfaStatus, mfaRequiredFor } from '@/lib/mfa';
import { getUserState } from '@/lib/admin/user-state';
import { listActiveSessions } from '@/lib/admin/session-registry';
import { loadDomainPrivateKey } from '@/lib/backend-auth';
import type { ProfileData } from '@/lib/admin/profile-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Solo avatares seguros para un <img>: https o data:image raster, con tope de tamano. */
function safeAvatar(value: unknown): string | null {
    if (typeof value !== 'string' || value.length > 200_000) return null;
    return /^https:\/\//i.test(value) || /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : null;
}

/**
 * GET /api/admin/profile -> datos propios del admin: perfil, estado de MFA, resumen de sesiones y si esta instancia firma.
 * Un manager no tiene usuario en esta app: solo devuelve su identidad (MFA/contrasena/sesiones viven en el backend).
 * Nunca devuelve hashes, secretos ni tokens.
 */
export const GET = adminRoute({ scope: 'profile.get', limit: 120 }, async ({ actor }) => {
    const instanceSigning = loadDomainPrivateKey() !== null;
    if (actor.kind === 'manager') {
        const data: ProfileData = {
            me: { kind: 'manager', id: actor.id ?? null, name: null, email: actor.email ?? null, avatar: null, lastLoginAt: null, mustChangePassword: false },
            mfa: null,
            sessions: null,
            instanceSigning,
        };
        return data as unknown as Record<string, unknown>;
    }

    const user = await getCurrentUser();
    if (!user) throw conflict('session_changed');
    const [state, mfa, sessions] = await Promise.all([
        getUserState(user.id),
        getMfaStatus(user.id),
        listActiveSessions(user.id),
    ]);
    const data: ProfileData = {
        me: {
            kind: 'user',
            id: user.id,
            name: user.name ?? null,
            email: user.email,
            avatar: safeAvatar(user.avatar),
            lastLoginAt: state.lastLoginAt,
            mustChangePassword: state.mustChangePassword,
        },
        mfa: {
            available: mfa.available,
            enabled: mfa.enabled,
            pendingEnrollment: mfa.pendingEnrollment,
            recoveryCodesLeft: mfa.recoveryCodesLeft,
            required: mfaRequiredFor(user.email),
        },
        sessions: { active: sessions.length },
        instanceSigning,
    };
    return data as unknown as Record<string, unknown>;
});
