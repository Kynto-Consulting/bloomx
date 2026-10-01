import { z } from 'zod';
import { adminRoute, parseQuery } from '@/lib/admin/http';
import { usageSummary } from '@/lib/ai/usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const q = z.object({ days: z.coerce.number().int().min(1).max(366).optional() });

/** GET ?days=30 -> resumen de uso (por dia, funcion, usuario, extension). Sin contenido de peticiones. */
export const GET = adminRoute({ scope: 'ai.read', limit: 60 }, async (ctx) => ({ ...(await usageSummary(parseQuery(ctx.req, q).days ?? 30)) }));
