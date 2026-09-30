import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { runRetention, getEffectiveRetentionConfig } from '@/lib/retention';
import { safeEqual, getClientIp, auditLog } from '@/lib/security';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Job de retencion. Se puede invocar con:
 *  - Authorization: Bearer <CRON_SECRET>   (Vercel Cron envia este encabezado automaticamente; usa GET)
 *  - sesion de administrador (requireAdmin)
 * ?dryRun=1 solo cuenta lo que se borraria. Configuracion por env: ver lib/retention.ts.
 * Ejemplo vercel.json:  { "crons": [{ "path": "/api/admin/retention", "schedule": "0 3 * * *" }] }
 */
async function handle(req: NextRequest) {
    const cronSecret = process.env.CRON_SECRET;
    const bearer = req.headers.get('authorization');
    const isCron = !!cronSecret && !!bearer?.startsWith('Bearer ') && safeEqual(bearer.slice(7), cronSecret);

    if (!isCron) {
        const guard = await requireAdmin(req);
        if (!guard.ok) return guard.response;
    }

    const dryRun = req.nextUrl.searchParams.get('dryRun') === '1' || req.nextUrl.searchParams.get('dryRun') === 'true';
    try {
        const report = await runRetention({ dryRun });
        return NextResponse.json({ ok: true, config: await getEffectiveRetentionConfig(), report }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e: any) {
        auditLog('retention.error', { ip: getClientIp(req), error: String(e?.message || 'unknown').slice(0, 120) });
        return NextResponse.json({ error: 'Retention run failed' }, { status: 500 });
    }
}

export const GET = handle;
export const POST = handle;
