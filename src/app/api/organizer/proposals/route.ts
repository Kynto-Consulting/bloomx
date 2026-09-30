import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { rateLimitAsync } from '@/lib/security';
import { defaultDeps, listProposals } from '@/lib/organizer/mail-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/** Propuestas de baja confianza del Organizer para el usuario autenticado. */
export async function GET() {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });

    const rl = await rateLimitAsync(`organizer-proposals:${user.id}`, 120, 60_000);
    if (!rl.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { ...NO_STORE, 'Retry-After': String(rl.retryAfter) } });

    try {
        const data = await listProposals(await defaultDeps(), user.id, { limit: 50 });
        return NextResponse.json(data, { headers: NO_STORE });
    } catch {
        return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: NO_STORE });
    }
}
