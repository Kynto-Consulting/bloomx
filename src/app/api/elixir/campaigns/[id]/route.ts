import { NextRequest, NextResponse, after } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { campaigns, ElixirTablesMissingError, rows } from '@/lib/elixir-campaign-store';
import {
    nextStatusForAction, publicCampaign, ROW_STATUSES, type CampaignRowStatus, type CampaignStatus,
} from '@/lib/elixir-campaigns';
import { campaignActionSchema, firstIssue, tablesMissing } from '@/lib/elixir-schemas';
import { chainNextTick, tickCampaign } from '@/lib/elixir-worker-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };
const toInt = (v: string | null, d: number) => { const n = Number.parseInt(v ?? '', 10); return Number.isFinite(n) ? n : d; };

/** Primer lote inmediato tras iniciar/reanudar, sin esperar al cron; encadena si quedan filas listas. */
function kick(id: string) {
    after(async () => {
        try {
            const r = await tickCampaign(id);
            if (r.readyRemaining > 0 && !r.finished && r.reason !== 'paused_or_cancelled' && r.reason !== 'quota' && r.reason !== 'rate_limited') {
                await chainNextTick(id, 0);
            }
        } catch (e) { console.error('[elixir] kick failed:', (e as Error)?.message); }
    });
}

/**
 * GET /api/elixir/campaigns/[id]?status=&limit=&offset=&rows=0|1
 * Devuelve la campana con conteos/progreso (usado por el polling de la UI) y, salvo rows=0, una pagina de filas.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

    const c = await campaigns.get(user.id, id);
    if (!c) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    const counts = await campaigns.counts(id);

    const sp = req.nextUrl.searchParams;
    let rowPage: Awaited<ReturnType<typeof rows.page>> = [];
    if (sp.get('rows') !== '0') {
        const st = sp.get('status');
        const status = st && (ROW_STATUSES as readonly string[]).includes(st) ? (st as CampaignRowStatus) : null;
        rowPage = await rows.page(id, status, Math.min(200, Math.max(1, toInt(sp.get('limit'), 100))), Math.max(0, toInt(sp.get('offset'), 0)));
    }
    return NextResponse.json({ campaign: publicCampaign(c, counts), rows: rowPage });
}

/** PATCH { action: 'start'|'pause'|'resume'|'cancel'|'retry_errors' } */
export async function PATCH(req: NextRequest, { params }: Ctx) {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

    const parsed = campaignActionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error), code: 'invalid_payload' }, { status: 400 });
    const { action } = parsed.data;

    try {
        const c = await campaigns.get(user.id, id);
        if (!c) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
        const to = nextStatusForAction(c.status, action);
        if (!to) return NextResponse.json({ error: `No se puede ${action} una campaña en estado ${c.status}`, code: 'invalid_transition' }, { status: 409 });

        if (action === 'start') {
            await campaigns.syncTotal(id);
            const counts = await campaigns.counts(id);
            if (counts.pending === 0) {
                return NextResponse.json({ error: 'No hay destinatarios válidos para enviar', code: 'no_recipients' }, { status: 422 });
            }
        }
        if (action === 'retry_errors') {
            const counts = await campaigns.counts(id);
            if (counts.error === 0) return NextResponse.json({ error: 'No hay filas con error para reintentar', code: 'nothing_to_retry' }, { status: 409 });
            await campaigns.requeueErrors(id);
        }

        const from: CampaignStatus[] = action === 'retry_errors' ? ['done', 'paused', 'failed', 'cancelled'] : [c.status];
        const ok = await campaigns.transition(user.id, id, from, to);
        if (!ok) return NextResponse.json({ error: 'La campaña cambió de estado; recargue', code: 'conflict' }, { status: 409 });

        if (to === 'running') kick(id);

        const fresh = await campaigns.get(user.id, id);
        return NextResponse.json({ campaign: publicCampaign(fresh ?? { ...c, status: to }, await campaigns.counts(id)) });
    } catch (e) {
        if (e instanceof ElixirTablesMissingError) return tablesMissing();
        throw e;
    }
}

/** DELETE — borra la campana y sus filas (no permitido mientras `running`: pausar o cancelar primero). */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const c = await campaigns.get(user.id, id);
    if (!c) return NextResponse.json({ success: true, deleted: 0 });
    if (c.status === 'running') return NextResponse.json({ error: 'Pause o cancele la campaña antes de eliminarla', code: 'running' }, { status: 409 });
    const deleted = await campaigns.remove(user.id, id);
    return NextResponse.json({ success: true, deleted: deleted ? 1 : 0 });
}
