import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { undoBatch } from '@/lib/rules/apply';

type Ctx = { params: Promise<{ id: string }> };

/** Deshace un lote de "Aplicar a existentes" (solo del propio usuario; una sola vez). */
export async function POST(_req: NextRequest, { params }: Ctx) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const r = await undoBatch(user.id, id);
    if (!r) return NextResponse.json({ error: 'Batch not found or already undone' }, { status: 404 });
    return NextResponse.json(r);
}
