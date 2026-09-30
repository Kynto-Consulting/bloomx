import { NextRequest, NextResponse, after } from 'next/server';
import { safeEqual } from '@/lib/security';
import { deriveInternalKey } from '@/lib/internal-auth';
import { jobs } from '@/lib/mail-transfer/store';
import { chainNextTick, purgeExpiredMailTransfers, realEngineDeps, runTick } from '@/lib/mail-transfer/runtime';
import type { TickResult } from '@/lib/mail-transfer/import-engine';

/**
 * Worker de importar/exportar correo. Autenticado SOLO con `Authorization: Bearer CRON_SECRET` o con la clave interna derivada de
 * NEXTAUTH_SECRET (el propio encadenamiento). Cualquier otra cosa: 401.
 *
 *  GET|POST /api/cron/mail-transfer            -> procesa hasta 3 trabajos con algo que hacer y purga los caducados.
 *  GET|POST /api/cron/mail-transfer?job=<id>   -> procesa ese trabajo.
 *
 * Idempotente y seguro en paralelo (bloqueo lockedUntil por trabajo). Si queda trabajo encadena otra invocacion (mismo patron
 * que /api/cron/elixir); el navegador tambien empuja ticks si el trabajo se atasca.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
    const header = req.headers.get('authorization') || '';
    if (!header.startsWith('Bearer ')) return false;
    const provided = header.slice(7).trim();
    const accepted = [process.env.CRON_SECRET, deriveInternalKey()].filter((s): s is string => Boolean(s));
    return accepted.some((secret) => safeEqual(provided, secret));
}

async function handle(req: NextRequest) {
    if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const hop = Math.max(0, Number.parseInt(req.headers.get('x-mt-hop') || '0', 10) || 0);
    const only = req.nextUrl.searchParams.get('job');
    if (only !== null && !/^mtj_[a-f0-9]{32}$/.test(only)) return NextResponse.json({ error: 'job invalido' }, { status: 400 });
    try {
        const ids = only ? [only] : await jobs.runnable(3);
        const deps = realEngineDeps();
        const results: Record<string, TickResult | { error: string }> = {};
        const chain: string[] = [];
        for (const id of ids) {
            try {
                const r = await runTick(id, deps);
                results[id] = r;
                if (r.more) chain.push(id);
            } catch (e) {
                console.error('[cron/mail-transfer] tick failed:', (e as Error)?.message?.slice(0, 200));
                results[id] = { error: 'tick_failed' };
            }
        }
        if (!only) await purgeExpiredMailTransfers(deps).catch(() => undefined);
        if (chain.length) after(async () => { for (const id of chain) await chainNextTick(id, hop); });
        return NextResponse.json({ success: true, processed: ids.length, results, chained: chain.length });
    } catch (e) {
        if ((e as { code?: string })?.code === 'mail_transfer_tables_missing') return NextResponse.json({ success: true, processed: 0, note: 'mail_transfer_tables_missing' });
        console.error('[cron/mail-transfer] failed:', (e as Error)?.message?.slice(0, 200));
        return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
