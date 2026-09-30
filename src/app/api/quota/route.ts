import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { rateLimitAsync } from '@/lib/security';
import { getQuotaStatus } from '@/lib/mail-quota';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/quota -> uso del buzon del usuario y limite resuelto (politica: usuario > dominio > MAIL_QUOTA_MB > sin limite).
 * El uso de los cuerpos es una ESTIMACION (ver lib/mail-quota.ts). Solo datos propios; nunca claves de almacenamiento.
 */
export async function GET() {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const rl = await rateLimitAsync(`quota:${user.id}`, 60, 60_000);
    if (!rl.ok) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter), 'Cache-Control': 'no-store' } });
    }

    try {
        const s = await getQuotaStatus(user.id);
        return NextResponse.json({
            usedBytes: s.usedBytes,
            attachmentsBytes: s.attachmentsBytes,
            bodiesBytes: s.bodiesBytes,
            emails: s.emails,
            limitBytes: s.limitBytes,
            percent: s.percent,
            level: s.level,
            notice: s.notice,
            enforce: s.enforce,
            source: s.source,
            approximate: s.approximate,
        }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) {
        console.error('[GET /api/quota] failed:', error instanceof Error ? error.message.slice(0, 200) : 'error');
        return NextResponse.json({ error: 'Failed to load quota' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
    }
}
