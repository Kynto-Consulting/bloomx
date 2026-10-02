import { z } from 'zod';
import { adminRoute, HttpError, parseBody } from '@/lib/admin/http';
import { EXTENSION_ID_RE, StarLimitError, listStars, setStar } from '@/lib/admin/extension-stars';

/**
 * Favoritas (estrellas) del marketplace de extensiones, POR administrador de la instancia (nunca globales).
 *   GET  -> { stars: string[] }                       ids de extension marcadas por quien pregunta
 *   PUT  { extensionId, starred } -> { stars: [...] }  marca o desmarca (idempotente; tope de 200 por administrador)
 * Nivel 1 (como el catalogo): es una preferencia personal y no cambia nada de la instancia. El usuario sale de la sesion de
 * administracion (actor.id), nunca del cuerpo, asi que nadie puede leer ni escribir las estrellas de otro.
 */
const putBody = z.object({ extensionId: z.string().regex(EXTENSION_ID_RE), starred: z.boolean() });

const userKey = (actor: { id?: string; email?: string }) => actor.id || actor.email || '';

export const GET = adminRoute({ scope: 'extensions.stars' }, async (ctx) => {
    return { stars: await listStars(userKey(ctx.actor)) };
});

export const PUT = adminRoute({ scope: 'extensions.stars', write: true, limit: 120 }, async (ctx) => {
    const body = await parseBody(ctx.req, putBody);
    const key = userKey(ctx.actor);
    if (!key) throw new HttpError(403, 'forbidden');
    try {
        return { stars: await setStar(key, body.extensionId, body.starred) };
    } catch (error) {
        if (error instanceof StarLimitError) throw new HttpError(409, 'star_limit');
        throw error;
    }
});
