import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';

function extractEmailAddress(value: string): string {
    const raw = String(value || '').trim();
    const bracketMatch = raw.match(/<([^>]+)>/);
    return (bracketMatch?.[1] || raw).trim().toLowerCase();
}

function normalizeMailboxIdentity(email: string): string {
    const [localPart, domain] = String(email || '').trim().toLowerCase().split('@');
    if (!localPart || !domain) return '';

    let normalizedLocal = localPart.replace(/\./g, '');
    const plusIndex = normalizedLocal.indexOf('+');
    if (plusIndex !== -1) {
        normalizedLocal = normalizedLocal.substring(0, plusIndex);
    }

    return `${normalizedLocal}@${domain}`;
}

async function resolveAuthorizedSenders(userId: string, fallbackEmail: string): Promise<Set<string>> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            email: true,
            accounts: {
                select: {
                    providerAccountId: true,
                }
            }
        }
    });

    const allowed = new Set<string>([
        String(user?.email || fallbackEmail || '').trim().toLowerCase(),
        ...((user?.accounts || [])
            .map((account) => String(account.providerAccountId || '').trim().toLowerCase())
            .filter((email) => email.includes('@'))),
    ]);

    return allowed;
}

// Get all drafts
// Get all drafts for the authenticated user
export async function GET() {
    try {
        const user = await getCurrentUser();
        if (!user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const authorizedSenderEmails = Array.from(await resolveAuthorizedSenders(user.id, user.email));

        const drafts = await prisma.draft.findMany({
            where: {
                from: {
                    in: authorizedSenderEmails,
                }
            },
            orderBy: { updatedAt: 'desc' },
            take: 50,
            include: { attachments: true }
        });
        return NextResponse.json({ drafts });
    } catch (error) {
        console.error('Failed to fetch drafts:', error);
        return NextResponse.json({ error: 'Failed to fetch drafts' }, { status: 500 });
    }
}

// Create or update draft
export async function POST(req: NextRequest) {
    try {
        const user = await getCurrentUser();
        if (!user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { id, to, cc, bcc, subject, body: draftBody, attachments, from } = body;
        const authorizedSenderEmails = await resolveAuthorizedSenders(user.id, user.email);
        const authorizedSenderIdentities = new Set<string>(
            Array.from(authorizedSenderEmails)
                .map(normalizeMailboxIdentity)
                .filter(Boolean)
        );

        const requestedFrom = from ? extractEmailAddress(String(from)) : '';
        const requestedIdentity = requestedFrom ? normalizeMailboxIdentity(requestedFrom) : '';
        const ownerFrom = requestedFrom
            && (authorizedSenderEmails.has(requestedFrom)
                || (requestedIdentity ? authorizedSenderIdentities.has(requestedIdentity) : false))
            ? requestedFrom
            : user.email.toLowerCase();

        let draft;
        if (id) {
            // Update existing draft
            // If attachments provided, we might need to sync them.
            // Simplified: Delete old non-linked ones? Or just add new ones?
            // Usually drafts replace content.
            // For now, let's just create new attachments if passed, but checking duplicates is complex without IDs.
            // Let's assume frontend sends full list of uploaded file metadata.

            // First, update basic fields
            try {
                const existingDraft = await prisma.draft.findFirst({
                    where: {
                        id,
                        from: {
                            in: Array.from(authorizedSenderEmails),
                        }
                    },
                    select: { id: true }
                });

                if (!existingDraft) {
                    return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
                }

                draft = await prisma.draft.update({
                    where: {
                        id,
                    },
                    data: {
                        from: ownerFrom,
                        to: to || null,
                        cc: cc || null,
                        bcc: bcc || null,
                        subject: subject || null,
                        body: draftBody || null,
                    },
                });

                // Handle attachments...
                if (attachments && Array.isArray(attachments)) {
                    await prisma.attachment.deleteMany({ where: { draftId: id } });

                    if (attachments.length > 0) {
                        await prisma.attachment.createMany({
                            data: attachments.map((att: any) => ({
                                draftId: id,
                                filename: att.filename,
                                mimeType: att.mimeType || 'application/octet-stream',
                                size: att.size || 0,
                                key: att.key
                            }))
                        });
                    }
                }
            } catch (error: any) {
                if (error?.code === 'P2025') {
                    // Record not found, perhaps deleted. We can't update it.
                    // Return 404 or just succeed nicely to stop client errors?
                    // Returning 404 allows client to know it's gone.
                    return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
                }
                throw error; // Re-throw other errors
            }
        } else {
            // Create new draft
            draft = await prisma.draft.create({
                data: {
                    from: ownerFrom,
                    to: to || null,
                    cc: cc || null,
                    bcc: bcc || null,
                    subject: subject || null,
                    body: draftBody || null,
                    attachments: attachments ? {
                        create: attachments.map((att: any) => ({
                            filename: att.filename,
                            mimeType: att.mimeType || 'application/octet-stream',
                            size: att.size || 0,
                            key: att.key
                        }))
                    } : undefined
                },
            });
        }

        return NextResponse.json({ draft });
    } catch (error) {
        console.error('Failed to save draft:', error);
        return NextResponse.json({ error: 'Failed to save draft' }, { status: 500 });
    }
}
