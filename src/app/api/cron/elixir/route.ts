import { NextRequest, NextResponse, after } from 'next/server';
import { safeEqual } from '@/lib/security';
import { campaigns, ElixirTablesMissingError } from '@/lib/elixir-campaign-store';
import { chainNextTick, tickCampaign } from '@/lib/elixir-worker-runtime';
import type { TickResult } from '@/lib/elixir-worker';

/**
 * Worker de campanas de Elixir. Autenticado SOLO con `Authorization: Bearer CRON_SECRET`
 * (Vercel Cron, un pinger externo o el propio encadenamiento). Sin CRON_SECRET configurado: 401.
 *
 *  GET|POST /api/cron/elixir                 -> procesa hasta 5 campanas `running` con filas listas.
 *  GET|POST /api/cron/elixir?campaign=<id>   -> procesa esa campana.
 *
 * Idempotente y seguro de invocar en paralelo: cada campana tiene bloqueo (`lockedUntil`); una invocacion sin
 * trabajo no hace nada. Si quedan filas listas, encadena otra invocacion (best effort) hasta MAX_CHAIN_HOPS.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TOTAL_BUDGET_MS = 50_000;
const MAX_CAMPAIGNS_PER_RUN = 5;

function authorized(req: NextRequest): boolean {
    const header = req.headers.get('authorization') || '';
    const secret = process.env.CRON_SECRET;
    if (!secret || !header.startsWith('Bearer ')) return false;
    return safeEqual(header.slice(7).trim(), secret);
}

async function handle(req: NextRequest) {
    if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const started = Date.now();
    const hop = Math.max(0, Number.parseInt(req.headers.get('x-elixir-hop') || '0', 10) || 0);
    const only = req.nextUrl.searchParams.get('campaign');
    if (only !== null && !/^[A-Za-z0-9_-]{8,80}$/.test(only)) {
        return NextResponse.json({ error: 'campaign inválido' }, { status: 400 });
    }

    try {
        const ids = only ? [only] : await campaigns.runnable(MAX_CAMPAIGNS_PER_RUN);
        const results: Record<string, TickResult | { error: string }> = {};
        const toChain: string[] = [];

        for (let i = 0; i < ids.length; i++) {
            const left = TOTAL_BUDGET_MS - (Date.now() - started);
            if (left < 8_000) break;
            // Reparte el tiempo restante entre las campanas que faltan.
            const budgetMs = Math.max(6_000, Math.floor(left / (ids.length - i)) - 1_000);
            try {
                const r = await tickCampaign(ids[i], { budgetMs });
                results[ids[i]] = r;
                const more = r.readyRemaining > 0 && !r.finished && r.reason !== 'paused_or_cancelled' && r.reason !== 'quota' && r.reason !== 'rate_limited';
                if (more) toChain.push(ids[i]);
            } catch (e) {
                console.error('[cron/elixir] tick failed:', (e as Error)?.message);
                results[ids[i]] = { error: 'tick_failed' };
            }
        }

        if (toChain.length) after(async () => { for (const id of toChain) await chainNextTick(id, hop); });
        return NextResponse.json({ success: true, processed: Object.keys(results).length, results, chained: toChain.length });
    } catch (e) {
        if (e instanceof ElixirTablesMissingError) return NextResponse.json({ success: true, processed: 0, note: 'elixir_tables_missing' });
        console.error('[cron/elixir] failed:', (e as Error)?.message);
        return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }

