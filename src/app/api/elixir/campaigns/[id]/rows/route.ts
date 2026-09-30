import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { campaigns, ElixirTablesMissingError, rows } from '@/lib/elixir-campaign-store';
import { classifyRow, MAX_CAMPAIGN_ROWS, sanitizeRowData } from '@/lib/elixir-campaigns';
import { firstIssue, rowsChunkSchema, tablesMissing } from '@/lib/elixir-schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/elixir/campaigns/[id]/rows — sube un trozo (<= 500) de filas a una campana en `draft`.
 * Idempotente por (campana, idx): reenviar el mismo trozo no duplica. Los duplicados de destinatario
 * (incluso contra trozos anteriores) quedan como `skipped`/`duplicate`.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

    const parsed = rowsChunkSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error), code: 'invalid_payload' }, { status: 400 });

    try {
        const c = await campaigns.get(user.id, id);
        if (!c) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
        if (c.status !== 'draft') return NextResponse.json({ error: 'La campaña ya fue iniciada', code: 'not_draft' }, { status: 409 });

        const items = parsed.data.items;
        if (items.some(i => i.index >= MAX_CAMPAIGN_ROWS)) {
            return NextResponse.json({ error: `Máximo ${MAX_CAMPAIGN_ROWS} filas por campaña`, code: 'limit_reached' }, { status: 413 });
        }

        const clean: Array<{ index: number; data: Record<string, string> }> = [];
        for (const it of items) {
            const data = sanitizeRowData(it.row);
            if (!data) return NextResponse.json({ error: `Fila ${it.index}: demasiadas columnas`, code: 'invalid_payload' }, { status: 400 });
            clean.push({ index: it.index, data });
        }

        // Duplicados contra lo ya guardado (otros trozos) y dentro del propio trozo.
        const candidates = Array.from(new Set(clean
            .map(i => String(i.data[c.options.recipientColumn] ?? '').trim().toLowerCase())
            .filter(e => e.length > 0 && e.length <= 320)));
        const seen = await rows.existingRecipients(c.id, candidates);
        // Reenvio del mismo trozo: sus propios destinatarios ya estan guardados con el mismo idx -> ON CONFLICT los ignora.
        const classified = clean
            .sort((a, b) => a.index - b.index)
            .map(i => ({ ...classifyRow(i.index, i.data, c.options.recipientColumn, seen), data: i.data }));

        const inserted = await rows.insertChunk(c.id, classified);
        await campaigns.syncTotal(c.id);
        return NextResponse.json({ received: classified.length, inserted });
    } catch (e) {
        if (e instanceof ElixirTablesMissingError) return tablesMissing();
        throw e;
    }
}
