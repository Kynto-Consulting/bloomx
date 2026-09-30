import { z } from 'zod';
import { adminRoute, parseQuery } from '@/lib/admin/http';
import { likeContains, query } from '@/lib/admin/sql';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ q: z.string().trim().min(2).max(80) });

/**
 * GET /api/admin/search?q=  -> usuarios cuyo correo o nombre contiene q (maximo 8). Solo metadatos de la cuenta
 * (id, nombre, correo): nunca contrasena, tokens ni contenido de correos. Consulta parametrizada (ILIKE con escape).
 */
export const GET = adminRoute({ scope: 'search', limit: 120 }, async ({ req }) => {
    const { q } = parseQuery(req, schema);
    const like = likeContains(q);
    const users = await query<{ id: string; name: string | null; email: string }>(
        `SELECT "id", "name", "email" FROM "User"
         WHERE "email" ILIKE $1 ESCAPE '\\' OR COALESCE("name", '') ILIKE $1 ESCAPE '\\'
         ORDER BY "createdAt" DESC LIMIT 8`,
        like,
    );
    return { users };
});
