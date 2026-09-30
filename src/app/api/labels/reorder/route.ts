import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { reorderLabels } from '@/lib/labels/store';
import { labelErrorResponse } from '@/lib/labels/http';

/** Reordena / re-anida etiquetas: items = [{ id, parentId?, sortOrder? }]. Todo o nada; valida ciclos, profundidad y nombres. */
export async function POST(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json().catch(() => null);
    const items: unknown = body?.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > 500) return NextResponse.json({ error: 'Invalid items' }, { status: 400 });
    const clean: Array<{ id: string; parentId?: string | null; sortOrder?: number }> = [];
    for (const it of items as any[]) {
        if (!it || typeof it.id !== 'string' || it.id.length > 100) return NextResponse.json({ error: 'Invalid items' }, { status: 400 });
        if (it.parentId !== undefined && it.parentId !== null && (typeof it.parentId !== 'string' || it.parentId.length > 100)) return NextResponse.json({ error: 'Invalid items' }, { status: 400 });
        if (it.sortOrder !== undefined && !Number.isFinite(Number(it.sortOrder))) return NextResponse.json({ error: 'Invalid items' }, { status: 400 });
        clean.push({ id: it.id, ...(it.parentId !== undefined ? { parentId: it.parentId } : {}), ...(it.sortOrder !== undefined ? { sortOrder: Number(it.sortOrder) } : {}) });
    }
    try {
        const labels = await reorderLabels(user.id, clean);
        return NextResponse.json(labels.map(({ userId: _u, ...l }) => l));
    } catch (e) {
        const r = labelErrorResponse(e);
        if (r) return r;
        console.error('Failed to reorder labels:', (e as any)?.message);
        return NextResponse.json({ error: 'Failed to reorder labels' }, { status: 500 });
    }
}
