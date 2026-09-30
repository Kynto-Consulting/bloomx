import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { ElixirTablesMissingError, templates } from '@/lib/elixir-campaign-store';
import { firstIssue, tablesMissing, templateInputSchema } from '@/lib/elixir-schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const t = await templates.get(user.id, id);
    if (!t) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    return NextResponse.json({ template: t });
}

export async function PUT(req: NextRequest, { params }: Ctx) {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;

    const parsed = templateInputSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error), code: 'invalid_payload' }, { status: 400 });

    try {
        const r = await templates.update(user.id, id, parsed.data);
        if (r === 'duplicate') return NextResponse.json({ error: 'Ya existe una plantilla con ese nombre', code: 'duplicate_name' }, { status: 409 });
        if (!r) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
        return NextResponse.json({ template: r });
    } catch (e) {
        if (e instanceof ElixirTablesMissingError) return tablesMissing();
        // Carrera contra el indice unico (userId, name).
        if ((e as { code?: string })?.code === 'P2010' || /duplicate key|unique/i.test(String((e as Error)?.message))) {
            return NextResponse.json({ error: 'Ya existe una plantilla con ese nombre', code: 'duplicate_name' }, { status: 409 });
        }
        throw e;
    }
}

// DELETE idempotente: 200 aunque ya no exista.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const deleted = await templates.remove(user.id, id);
    return NextResponse.json({ success: true, deleted: deleted ? 1 : 0 });
}
