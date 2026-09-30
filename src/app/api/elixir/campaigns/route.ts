import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { rateLimit } from '@/lib/security';
import { campaigns, ElixirTablesMissingError } from '@/lib/elixir-campaign-store';
import { publicCampaign } from '@/lib/elixir-campaigns';
import { campaignCreateSchema, firstIssue, tablesMissing } from '@/lib/elixir-schemas';
import { compileCampaign } from '@/lib/elixir-worker';
import { loadWorkerUser } from '@/lib/elixir-worker-runtime';
import { LiquidError, isValidTimezone } from '@/lib/liquid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const toInt = (v: string | null, d: number) => { const n = Number.parseInt(v ?? '', 10); return Number.isFinite(n) ? n : d; };

/** GET /api/elixir/campaigns?limit=&offset= — historial con conteos por estado (sin datos de filas). */
export async function GET(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const limit = Math.min(100, Math.max(1, toInt(req.nextUrl.searchParams.get('limit'), 30)));
    const offset = Math.max(0, toInt(req.nextUrl.searchParams.get('offset'), 0));
    const list = await campaigns.list(user.id, limit, offset);
    const counts = await campaigns.countsFor(list.map(c => c.id));
    return NextResponse.json({
        campaigns: list.map(c => publicCampaign(c, counts[c.id]!)),
        hasMore: list.length === limit,
    });
}

/**
 * POST /api/elixir/campaigns — crea una campana en `draft`. Las filas se suben con
 * POST /api/elixir/campaigns/[id]/rows (trozos de <= 500) y se inicia con PATCH { action: 'start' }.
 */
export async function POST(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const rl = rateLimit(`elixir-campaign-create:${user.id}`, 60, 60 * 60 * 1000);
    if (!rl.ok) return NextResponse.json({ error: 'Too many campaigns. Try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } });

    const parsed = campaignCreateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error), code: 'invalid_payload' }, { status: 400 });
    const b = parsed.data;

    // Cualquier error de sintaxis aborta antes de guardar nada.
    try { compileCampaign({ subject: b.subject, template: b.template, senderConfig: b.senderConfig }); }
    catch (e) {
        const err = e as LiquidError;
        return NextResponse.json({ error: err.message, code: 'template_error', details: err instanceof LiquidError ? err.toJSON() : undefined }, { status: 422 });
    }

    // Remitente: mismas reglas que el envio directo (si no usa variables Liquid se valida ahora; si las usa, por fila).
    const from = b.senderConfig.fromEmail?.trim().toLowerCase();
    if (from && !/\{\{|\{%/.test(from)) {
        const wu = await loadWorkerUser(user.id);
        if (!wu) return NextResponse.json({ error: 'User not found' }, { status: 404 });
        const extracted = from.match(/<([^>]+)>/)?.[1]?.toLowerCase() ?? from;
        if (!wu.allowedEmails.has(extracted)) return NextResponse.json({ error: 'Unauthorized sender account' }, { status: 401 });
    }

    try {
        const c = await campaigns.create(user.id, {
            name: b.name || b.subject.slice(0, 80),
            subject: b.subject,
            template: b.template,
            senderConfig: b.senderConfig,
            options: {
                recipientColumn: b.recipientColumn,
                systemVars: b.systemVars,
                timezone: b.timezone && isValidTimezone(b.timezone) ? b.timezone : 'UTC',
                autoescape: b.autoescape !== false,
                strictVariables: b.strictVariables !== false,
                unsubscribeFooter: b.unsubscribeFooter !== false,
            },
        });
        return NextResponse.json({ campaign: publicCampaign(c, { pending: 0, sending: 0, sent: 0, error: 0, skipped: 0, unsubscribed: 0, bounced: 0, complained: 0 }) }, { status: 201 });
    } catch (e) {
        if (e instanceof ElixirTablesMissingError) return tablesMissing();
        throw e;
    }
}
