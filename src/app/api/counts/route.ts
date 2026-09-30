import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';

export async function GET() {
    const user = await getCurrentUser();
    if (!user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const email = user.email;

    try {
        const dbUser = await prisma.user.findUnique({
            where: { email: user.email },
            select: { id: true }
        });
        if (!dbUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const [inboxCount, draftsCount, sentCount, trashCount, junkCount, archiveCount] = await Promise.all([
            // Inbox: To me, not deleted, not archived, not junk, AND UNREAD
            prisma.email.count({
                where: {
                    userId: dbUser.id,
                    folder: 'inbox',
                    read: false
                }
            }),
            // Drafts (Keep as total, concept of unread draft is weird)
            prisma.draft.count({
                where: { from: email }
            }),
            // Sent (Unread sent emails? valid, maybe tracking if recipient read? no, local read status.)
            // Usually "Sent" count in sidebar shows total or nothing. 
            // User asked: "only show unread messages count". 
            // For Sent, if I look at a sent email, it becomes read? 
            // Let's assume yes, filter by read: false.
            prisma.email.count({
                where: { userId: user.id, folder: 'sent', read: false }
            }),
            // Trash
            prisma.email.count({
                where: {
                    userId: user.id,
                    folder: 'trash',
                    read: false
                }
            }),
            // Junk
            prisma.email.count({
                where: { userId: user.id, folder: 'spam', read: false }
            }),
            // Archive
            prisma.email.count({
                where: { userId: user.id, folder: 'archive', read: false }
            })
        ]);

        // Labels with counts (Unread only)
        const labels = await prisma.label.findMany({
            where: { userId: user.id },
            include: {
                _count: {
                    select: {
                        emails: {
                            // Igual que la vista de label en /api/emails: trash y spam no cuentan
                            where: { read: false, folder: { notIn: ['trash', 'spam'] } }
                        }
                    }
                }
            }
        });

        const labelCounts: Record<string, number> = {};
        labels.forEach(l => {
            labelCounts[l.name.toLowerCase()] = l._count.emails;
        });

        return NextResponse.json({
            counts: {
                inbox: inboxCount,
                drafts: draftsCount,
                sent: sentCount,
                trash: trashCount,
                spam: junkCount,
                archive: archiveCount
            },
            labels: labels.map(l => ({
                id: l.id,
                name: l.name,
                color: l.color,
                count: l._count.emails
            }))
        });

    } catch (error) {
        console.error('Failed to fetch counts:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
