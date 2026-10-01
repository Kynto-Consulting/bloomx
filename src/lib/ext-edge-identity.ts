import type { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { requireLevel } from '@/lib/admin-auth';
import { refreshPermissions } from '@/lib/permissions';
import { effectiveLevelSync } from '@/lib/permissions-core';
import { isFreshMfa } from '@/lib/admin/stepup';

export type EdgeIdentity = { id: string; email: string; level: number | null; stepUp: boolean };

/**
 * Quien llama a una ruta de extension (solo se usa con sesion de MISMO origen):
 *  - usuario de la app: id/email; si ademas es admin (nivel >= 1) se aplica la MISMA guardia que /api/admin (MFA y sesion privilegiada
 *    unica) y se informa su nivel y si hizo step-up reciente. Un admin sin MFA/sesion vigente cuenta como usuario NORMAL (sin nivel).
 *  - manager duenio del dominio (cookie auth_session): nivel 4 via requireLevel.
 *  - nadie: null (la ruta `session`/`admin` respondera 401 desde el backend).
 */
export async function resolveEdgeIdentity(req: NextRequest): Promise<EdgeIdentity | null> {
    const user = await getCurrentUser().catch(() => null);
    if (user) {
        await refreshPermissions().catch(() => undefined);
        if (effectiveLevelSync(user.email).level >= 1) {
            const guard = await requireLevel(1, req);
            if (guard.ok && guard.actor.level >= 1) {
                return { id: user.id, email: user.email, level: guard.actor.level, stepUp: await isFreshMfa({ req, actor: guard.actor }).catch(() => false) };
            }
        }
        return { id: user.id, email: user.email, level: null, stepUp: false };
    }
    if (req.cookies.get('auth_session')?.value) {
        const guard = await requireLevel(1, req);
        if (guard.ok && guard.actor.id && guard.actor.level >= 1) {
            return { id: guard.actor.id, email: guard.actor.email ?? '', level: guard.actor.level, stepUp: await isFreshMfa({ req, actor: guard.actor }).catch(() => false) };
        }
    }
    return null;
}
