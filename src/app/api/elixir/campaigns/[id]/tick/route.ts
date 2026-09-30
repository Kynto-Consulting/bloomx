import { NextRequest, NextResponse, after } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { rateLimitAsync } from '@/lib/security';
import { campaigns } from '@/lib/elixir-campaign-store';
import { chainNextTick, tickCampaign } from '@/lib/elixir-worker-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/elixir/campaigns/[id]/tick — el dueno "empuja" su campana `running` un lote (p. ej. si el cron es
 * espaciado). Es el mismo worker que el cron: bloqueo por campana, idempotente. Limitado a 1 llamada / 10 s.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

    const rl = await rateLimitAsync(`elixir-tick:${id}`, 1, 10_000);
    if (!rl.ok) return NextResponse.json({ error: 'Espere unos segundos', code: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } });

    const c = await campaigns.get(user.id, id);
    if (!c) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    if (c.status !== 'running') return NextResponse.json({ ran: false, status: c.status });

    const r = await tickCampaign(id, { budgetMs: 40_000 });
    if (r.readyRemaining > 0 && !r.finished && r.reason !== 'paused_or_cancelled' && r.reason !== 'quota' && r.reason !== 'rate_limited') {
        after(async () => { await chainNextTick(id, 0); });
    }
    return NextResponse.json({ ran: r.ran, reason: r.reason, sent: r.sent, errors: r.errors, retryAfterMs: r.retryAfterMs });
}
