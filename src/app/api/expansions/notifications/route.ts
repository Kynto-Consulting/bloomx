import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { rateLimitAsync } from '@/lib/security';
import { defaultNotifyStore } from '@/lib/expansions/host-services/notify';

/**
 * GET /api/expansions/notifications (sesion del usuario): devuelve las notificaciones pendientes de extensiones
 * (max 20, mas antiguas primero) y las marca como entregadas. Solo las del usuario de la sesion.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
export const MAX_DELIVER = 20;

export async function GET() {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });

    const rl = await rateLimitAsync(`ext-notifications:${user.id}`, 60, 60_000);
    if (!rl.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { ...NO_STORE, 'Retry-After': String(rl.retryAfter) } });

    try {
        const notifications = await (await defaultNotifyStore()).takePending(user.id, MAX_DELIVER);
        return NextResponse.json({ notifications }, { headers: NO_STORE });
    } catch (e: any) {
        console.error('[expansions-notifications] failed:', String(e?.message || 'error').slice(0, 120));
        return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: NO_STORE });
    }
}
