import { z } from 'zod';
import { adminRoute, audit, parseBody } from '@/lib/admin/http';
import { requireCritical } from '@/lib/ai/admin';
import { AI_PROVIDERS } from '@/lib/ai/types';
import { testConnection } from '@/lib/ai/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
    provider: z.enum(AI_PROVIDERS).optional(),
    model: z.string().min(1).max(120).regex(/^[A-Za-z0-9_.:/@+-]+$/).optional(),
    baseUrl: z.string().max(300).nullable().optional(),
    apiKey: z.string().min(8).max(4096).regex(/^[^\s\u0000-\u001f\u007f]+$/).optional(),
}).strict();

/** POST { provider?, model?, baseUrl?, apiKey? }: prueba de conexion; los valores son transitorios (no se persisten). Clave/URL nuevas => nivel 4. */
export const POST = adminRoute({ scope: 'ai.test', write: true, limit: 10 }, async (ctx) => {
    const body = await parseBody(ctx.req, bodySchema);
    if (body.apiKey !== undefined || (body.baseUrl !== undefined && body.baseUrl !== null)) await requireCritical(ctx, false);
    const result = await testConnection(body);
    audit(ctx, 'ai.test', { ok: result.ok, override: Object.keys(body) });
    return { ...result };
});
