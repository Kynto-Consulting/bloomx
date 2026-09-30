import { adminRoute } from '@/lib/admin/http';
import { fetchCatalog } from '@/lib/admin/extensions-catalog';

/**
 * GET -> { extensions: CatalogExtension[] }
 * Catalogo publico del backend con timeout (8 s), cache de 60 s y forma acotada (manifest reducido a un resumen).
 * `?fresh=1` se salta la cache.
 */
export const GET = adminRoute({ scope: 'extensions.catalog' }, async (ctx) => {
    const fresh = new URL(ctx.req.url).searchParams.get('fresh') === '1';
    return { extensions: await fetchCatalog({ fresh }) };
});
