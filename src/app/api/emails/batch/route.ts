import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from "@/lib/session";
import { prisma } from '@/lib/prisma';
import { getAccessibleMailboxUserIds } from '@/lib/mailbox-access';

const ALLOWED_UPDATE_FIELDS = ['read', 'starred', 'folder'] as const;

export async function PATCH(req: NextRequest) {
    try {
        const user = await getCurrentUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { ids, updates } = body;

        if (!Array.isArray(ids) || ids.length === 0) {
            return NextResponse.json({ error: 'Invalid IDs' }, { status: 400 });
        }

        const safeUpdates: Record<string, unknown> = {};
        for (const key of ALLOWED_UPDATE_FIELDS) {
            if (updates && typeof updates === 'object' && key in updates) safeUpdates[key] = updates[key];
        }
        if (Object.keys(safeUpdates).length === 0) {
            return NextResponse.json({ error: 'No valid updates' }, { status: 400 });
        }

        const mailboxIds = await getAccessibleMailboxUserIds(user.id);
        const result = await prisma.email.updateMany({
            where: { id: { in: ids }, userId: { in: mailboxIds } },
            data: safeUpdates,
        });

        return NextResponse.json({ count: result.count });
    } catch (error) {
        console.error('Failed to batch update emails:', error);
        return NextResponse.json({ error: 'Failed to update emails' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const user = await getCurrentUser();
        if (!user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { ids } = body;


        if (!Array.isArray(ids) || ids.length === 0) {
            return NextResponse.json({ error: 'Invalid IDs' }, { status: 400 });
        }

        // 1. Fetch emails to get storage keys
        const emails = await prisma.email.findMany({
            where: { id: { in: ids }, userId: { in: await getAccessibleMailboxUserIds(user.id) } },
            include: { attachments: true }
        });

        // 2. Delete from Storage
        // We import dynamically or top-level? Top-level is fine if not circular.
        // But let's check imports. Route doesn't have deleteFromStorage imported yet.
        const { deleteFromStorage } = await import('@/lib/storage');

        const deletions = [];
        for (const email of emails) {
            const e = email as any; // Cast to avoid TS issues with include inference
            if (e.htmlKey) deletions.push(deleteFromStorage(e.htmlKey));
            if (e.textKey) deletions.push(deleteFromStorage(e.textKey));
            if (e.rawKey) deletions.push(deleteFromStorage(e.rawKey));
            if (e.attachments) {
                for (const att of e.attachments) {
                    if (att.key) deletions.push(deleteFromStorage(att.key));
                }
            }
        }

        // Use allSettled 
        await Promise.allSettled(deletions);

        // 3. Delete from DB
        const result = await prisma.email.deleteMany({
            where: { id: { in: emails.map((e) => e.id) } }
        });
        return NextResponse.json({ count: result.count });
    } catch (error) {
        console.error('Failed to batch delete emails:', error);
        return NextResponse.json({ error: 'Failed to delete emails' }, { status: 500 });
    }
}
