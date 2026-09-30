import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from "@/lib/session";
import { canAccessEmail } from '@/lib/mailbox-access';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id } = await params;
        const body = await req.json();
        const { snoozeUntil } = body;

        if (!snoozeUntil) {
            return NextResponse.json({ error: 'snoozeUntil is required' }, { status: 400 });
        }

        // Verify ownership and exists
        const email = await prisma.email.findUnique({
            where: { id },
            select: { userId: true }
        });

        if (!email) {
            return NextResponse.json({ error: 'Email not found' }, { status: 404 });
        }

        // Anti-IDOR: buzones accesibles del usuario; 404 (no 401) para no confirmar correos ajenos.
        if (!(await canAccessEmail(user.id, email.userId))) {
            return NextResponse.json({ error: 'Email not found' }, { status: 404 });
        }

        const until = new Date(snoozeUntil);
        if (typeof snoozeUntil !== 'string' && typeof snoozeUntil !== 'number') {
            return NextResponse.json({ error: 'Invalid snoozeUntil' }, { status: 400 });
        }
        if (Number.isNaN(until.getTime())) {
            return NextResponse.json({ error: 'Invalid snoozeUntil' }, { status: 400 });
        }

        const updated = await prisma.email.update({
            where: { id },
            data: {
                folder: 'snoozed',
                scheduledAt: until
            }
        });

        return NextResponse.json(updated);

    } catch (error) {
        console.error('Snooze Error', error);
        return NextResponse.json({ error: 'Failed to snooze email' }, { status: 500 });
    }
}
