import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { resolveAuthorizedSenders } from '@/lib/draft-access';

export async function POST(req: NextRequest) {
    try {
        const user = await getCurrentUser();
        if (!user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { ids, action } = body;

        if (!Array.isArray(ids) || ids.length === 0) {
            return NextResponse.json({ error: 'Invalid IDs' }, { status: 400 });
        }

        if (action === 'delete') {
            const senders = Array.from(await resolveAuthorizedSenders(user.id, user.email));
            const result = await prisma.draft.deleteMany({
                where: {
                    id: { in: ids.filter((v: unknown): v is string => typeof v === 'string').slice(0, 500) },
                    from: { in: senders } // Security: Ensure ownership (cualquier cuenta propia/vinculada)
                }
            });
            return NextResponse.json({ count: result.count });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error) {
        console.error('Failed to batch update drafts:', error);
        return NextResponse.json({ error: 'Failed to update drafts' }, { status: 500 });
    }
}
