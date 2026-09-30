import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { ElixirTablesMissingError, templates } from '@/lib/elixir-campaign-store';
import { MAX_TEMPLATES_PER_USER } from '@/lib/elixir-campaigns';
import { firstIssue, tablesMissing, templateInputSchema } from '@/lib/elixir-schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/elixir/templates — plantillas del usuario (mas recientes primero). Sin tablas: [].
export async function GET() {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ templates: await templates.list(user.id) });
}

// POST /api/elixir/templates — crea una plantilla. 409 si el nombre ya existe.
export async function POST(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = templateInputSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error), code: 'invalid_payload' }, { status: 400 });

    try {
        if ((await templates.count(user.id)) >= MAX_TEMPLATES_PER_USER) {
            return NextResponse.json({ error: `Máximo ${MAX_TEMPLATES_PER_USER} plantillas`, code: 'limit_reached' }, { status: 409 });
        }
        const created = await templates.create(user.id, parsed.data);
        if (!created) return NextResponse.json({ error: 'Ya existe una plantilla con ese nombre', code: 'duplicate_name' }, { status: 409 });
        return NextResponse.json({ template: created }, { status: 201 });
    } catch (e) {
        if (e instanceof ElixirTablesMissingError) return tablesMissing();
        throw e;
    }
}
