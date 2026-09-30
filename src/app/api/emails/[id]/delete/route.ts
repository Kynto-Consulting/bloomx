
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from "@/lib/session";
import { deleteFromStorage } from '@/lib/storage';
import { canAccessEmail } from '@/lib/mailbox-access';

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getCurrentUser();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id } = await params;

        // 1. Fetch Email to get keys
        const email = await prisma.email.findUnique({
            where: { id },
            include: { attachments: true }
        });

        if (!email) {
            return NextResponse.json({ error: 'Email not found' }, { status: 404 });
        }

        if (!(await canAccessEmail(user.id, email.userId))) {
            return NextResponse.json({ error: 'Email not found' }, { status: 404 });
        }

        // 2. Delete from B2
        const deletions = [];
        if (email.htmlKey) deletions.push(deleteFromStorage(email.htmlKey));
        if (email.textKey) deletions.push(deleteFromStorage(email.textKey));
        if (email.rawKey) deletions.push(deleteFromStorage(email.rawKey));

        if (email.attachments) {
            for (const att of email.attachments) {
                if (att.key) deletions.push(deleteFromStorage(att.key));
            }
        }

        // Use allSettled to ensure we delete from DB even if B2 fails
        const results = await Promise.allSettled(deletions);

        // Log failures but don't stop
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                console.error(`Failed to delete storage item ${index}:`, result.reason);
            }
        });

        // 3. Delete from DB (Attachments cascade delete usually, but check schema)
        // If Attachments are separate models, they should cascade if configured, 
        // otherwise we delete them first or rely on onDelete: Cascade.
        // Prisma schema usually handles this if relation is configured.

        await prisma.email.delete({
            where: { id }
        });

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error('Failed to delete email:', error);
        return NextResponse.json({ error: 'Failed to delete email' }, { status: 500 });
    }
}
