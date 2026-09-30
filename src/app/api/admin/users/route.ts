import { z } from 'zod';
import { adminRoute, audit, json, parseBody, parseQuery } from '@/lib/admin/http';
import { pageMeta, parsePaging } from '@/lib/admin/paging';
import { createUserAccount } from '@/lib/admin/user-create';
import { listUsers, userFiltersSchema } from '@/lib/admin/users-store';

// GET: lista paginada con filtros (la logica SQL vive en users-store.ts). Nunca devuelve password ni tokens.
export const GET = adminRoute({ scope: 'users.list' }, async ({ req }) => {
    const filters = parseQuery(req, userFiltersSchema);
    const paging = parsePaging(new URL(req.url).searchParams, { defaultSize: 25, maxSize: 100 });
    const { rows, total } = await listUsers(filters, { limit: paging.pageSize, offset: paging.offset });
    return { users: rows, page: pageMeta(paging, total) };
});

const createSchema = z.object({
    email: z.string().trim().min(3).max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
    name: z.string().trim().max(200).optional(),
    password: z.string().max(1024).optional(),
    mustChangePassword: z.boolean().optional(),
});

// POST: crear usuario. Si no llega contrasena se genera una temporal que se devuelve UNA sola vez.
export const POST = adminRoute({ scope: 'users.create', write: true }, async (ctx) => {
    const body = await parseBody(ctx.req, createSchema);
    // Misma logica que la creacion de buzones faltantes al importar correo (lib/admin/user-create.ts).
    const created = await createUserAccount({ email: body.email, name: body.name, password: body.password, mustChangePassword: body.mustChangePassword });

    audit(ctx, 'users.created', { targetUserId: created.user.id, email: created.user.email, generatedPassword: created.generatedPassword, mustChangePassword: created.mustChangePassword });
    return json(
        {
            success: true,
            user: created.user,
            mustChangePassword: created.mustChangePassword,
            ...(created.temporaryPassword ? { temporaryPassword: created.temporaryPassword } : {}),
        },
        { status: 201 },
    );
});
