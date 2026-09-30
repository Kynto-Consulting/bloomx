import { z } from 'zod';
import { actorKey, adminRoute, audit, conflict, HttpError, json, parseBody } from '@/lib/admin/http';
import { runRetention } from '@/lib/retention';
import { rateLimitAsync } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const bodySchema = z.object({ dryRun: z.boolean().default(true) }).strict();

/** Candado en memoria: una sola ejecucion a la vez por proceso (la purga es idempotente, pero no tiene sentido solaparla). */
let running = false;

/**
 * POST { dryRun } -> RetentionReport (solo contadores; sin rutas ni claves de almacenamiento).
 * Las ejecuciones REALES tienen un limite estricto (3 cada 10 min) y se auditan como `retention.run_manual`.
 */
export const POST = adminRoute({ scope: 'retention.run.dry', write: true, limit: 20 }, async (ctx) => {
    const { dryRun } = await parseBody(ctx.req, bodySchema);
    if (running) throw conflict('run_in_progress');
    running = true;
    try {
        if (!dryRun) {
            const rl = await rateLimitAsync(`admin:retention.run:real:${actorKey(ctx.actor, ctx.ip)}`, 3, 10 * 60_000);
            if (!rl.ok) return json({ error: 'Too many requests', code: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } });
        }
        let report;
        try {
            report = await runRetention({ dryRun, quiet: dryRun });
        } catch (error) {
            console.error('[ADMIN_RETENTION] run failed:', error instanceof Error ? error.message.slice(0, 200) : 'error');
            throw new HttpError(500, 'retention_failed');
        }
        audit(ctx, 'retention.run_manual', { ...report });
        return { ...report };
    } finally {
        running = false;
    }
});
