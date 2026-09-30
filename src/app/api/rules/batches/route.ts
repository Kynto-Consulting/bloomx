import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { listBatches } from '@/lib/rules/apply';

export async function GET() {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json(await listBatches(user.id, 10));
}
