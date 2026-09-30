import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { extractEmailAddress, normalizeMailboxIdentity, resolveAuthorizedSenders, sanitizeDraftAttachments } from '@/lib/draft-access';

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

        // Solo adjuntos ya subidos y propios (o de correos del usuario, p. ej. reenvios); el resto se descarta.
        const safeAttachments = attachments === undefined ? undefined : await sanitizeDraftAttachments(attachments, user);

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

                // Sincroniza los adjuntos (lista completa que envia el cliente).
                if (safeAttachments) {
                    await prisma.attachment.deleteMany({ where: { draftId: id } });

                    if (safeAttachments.length > 0) {
                        await prisma.attachment.createMany({
                            data: safeAttachments.map((att) => ({ draftId: id, ...att }))
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
                    attachments: safeAttachments && safeAttachments.length > 0 ? {
                        create: safeAttachments
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
