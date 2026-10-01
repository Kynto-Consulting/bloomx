import { z } from 'zod';
import { adminRoute, parseQuery } from '@/lib/admin/http';
import { listAudit } from '@/lib/ai/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const q = z.object({ limit: z.coerce.number().int().min(1).max(500).optional() });

/** GET ?limit=100 -> { entries } historial de cambios de ajustes (solo nombres de campos). */
export const GET = adminRoute({ scope: 'ai.read', limit: 60 }, async (ctx) => ({ entries: await listAudit(parseQuery(ctx.req, q).limit ?? 100) }));
