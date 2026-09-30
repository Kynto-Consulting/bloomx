import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { parseBatchIds } from '@/lib/batch-validation';
import { getAccessibleMailboxUserIds } from '@/lib/mailbox-access';
import { moveEmailsToLabel } from '@/lib/labels/behavior';

type Ctx = { params: Promise<{ id: string }> };

/**
 * "Mover a" una etiqueta: con una etiqueta-carpeta los correos salen de Entrada (y dejan otras etiquetas-carpeta);
 * con una etiqueta normal solo se les anade. Solo correos de buzones accesibles y etiquetas del mismo propietario (anti-IDOR).
 */
export async function POST(req: NextRequest, { params }: Ctx) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const ids = parseBatchIds(body?.ids);
    if (!ids) return NextResponse.json({ error: 'Invalid IDs' }, { status: 400 });
    const boxes = await getAccessibleMailboxUserIds(user.id);
    const r = await moveEmailsToLabel(boxes, ids, id);
    if (!r) return NextResponse.json({ error: 'Label not found' }, { status: 404 });
    return NextResponse.json({ count: r.moved.length, ids: r.moved, behavior: r.behavior });
}
