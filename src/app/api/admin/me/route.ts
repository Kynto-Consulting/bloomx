import { adminRoute } from '@/lib/admin/http';
import { ownDomains } from '@/lib/backend-auth';
import { levelName } from '@/lib/permissions-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/me -> quien administra esta instancia (la consola lo usa como "puerta": 401/403 = sin acceso).
 * Solo devuelve datos del propio admin (su correo) y el dominio activo de la instancia; nada de secretos.
 */
export const GET = adminRoute({ scope: 'me', limit: 240 }, async ({ actor }) => ({
    me: {
        kind: actor.kind,
        id: actor.id ?? null,
        email: actor.email ?? null,
        userId: actor.kind === 'user' ? actor.id : null,
        // permission_level 0..4 y su origen (env | console | manager): la consola oculta lo que el nivel no permite (las rutas lo rechazan igualmente).
        permission_level: actor.level,
        levelName: levelName(actor.level),
        levelSource: actor.levelSource,
        instanceDomain: ownDomains()[0] ?? null,
    },
}));
