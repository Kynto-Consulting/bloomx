
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from "@/lib/session";
import { getFromStorage } from '@/lib/storage';
import { parseInviteFromIcs } from '@/lib/calendar/ics';

async function buildInviteState(emailId: string) {
    const latestRsvp = await prisma.emailEvent.findFirst({
        where: {
            emailId,
            type: 'invite.rsvp'
        },
        orderBy: { createdAt: 'desc' }
    });

    return latestRsvp?.data || null;
}

async function buildInvitePreview(email: any) {
    const calendarAttachment = (email.attachments || []).find((attachment: any) => {
        const mimeType = String(attachment?.mimeType || '').toLowerCase();
        const filename = String(attachment?.filename || '').toLowerCase();
        return mimeType.includes('text/calendar') || filename.endsWith('.ics');
    });

    if (!calendarAttachment?.key) {
        return null;
    }

    const rawInvite = await getFromStorage(calendarAttachment.key);
    const invite = parseInviteFromIcs(rawInvite || '');
    if (!invite) {
        return null;
    }

    return {
        attachmentId: calendarAttachment.id,
        filename: calendarAttachment.filename,
        uid: invite.uid || null,
        title: invite.summary || email.subject || 'Calendar invitation',
        description: invite.description || null,
        location: invite.location || null,
        startsAt: invite.startsAt || null,
        endsAt: invite.endsAt || null,
        method: invite.method || null,
        organizerEmail: invite.organizerEmail || null,
        organizerName: invite.organizerName || null,
    };
}

async function buildEmailPayload(email: any, content: string, signedAttachments: any[]) {
    const invitePreview = await buildInvitePreview(email);
    const inviteResponse = await buildInviteState(email.id);

    return {
        email: {
            ...email,
            attachments: signedAttachments,
        },
        content,
        invitePreview,
        inviteResponse,
    };
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> } // Treat params as a promise
) {
    const user = await getCurrentUser();
    if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const { id } = await params;
        const { searchParams } = new URL(req.url);
        const fetchThread = searchParams.get('thread') === 'true';

        const email = await prisma.email.findUnique({
            where: { id },
            include: {
                labels: true,
                attachments: true
            }
        });

        if (!email) {
            return NextResponse.json({ error: 'Email not found' }, { status: 404 });
        }

        let content = email.snippet || "(No content)";

        // Helper to fetch content
        const fetchContent = async (e: any) => {
            if (e.htmlKey) {
                const storedHtml = await getFromStorage(e.htmlKey);
                return storedHtml ?? "";
            } else if (e.textKey) {
                const storedText = await getFromStorage(e.textKey);
                return storedText ? `<pre>${storedText}</pre>` : "";
            }
            return e.snippet || "";
        };

        // Helper to sign attachments
        const signAttachments = async (list: any[]) => {
            return Promise.all(list.map(async (att) => {
                if (att.key) {
                    const url = await import('@/lib/storage').then(m => m.getSignedDownloadUrl(att.key));
                    return { ...att, url };
                }
                return att;
            }));
        };

        content = await fetchContent(email);
        const attachmentsWithUrls = await signAttachments(email.attachments ?? []);

        let threadEmails: any[] = [];

        if (fetchThread && email.subject) {
            const normalizeSubject = (subject: string) => {
                if (!subject) return '';
                // Remove Re:, Fwd:, etc. (Case insensitive) - Logic matches frontend
                return subject.replace(/^((re|fwd|fw|rv|enc|invitaci[oó]n(?: actualizada)?|invitation(?: updated| canceled| cancelled)?|accepted|declined|tentative|cancelado|canceled|cancelled|updated): ?)+/gi, '').trim();
            };

            const normalized = normalizeSubject(email.subject);

            // Only search if not empty and length sufficient to be a "topic"
            if (normalized && normalized.length >= 3) {
                // Find all emails with this subject (ignoring prefixes)
                const threadCandidates = await prisma.email.findMany({
                    where: {
                        userId: user.id,
                        OR: [
                            { subject: { equals: normalized, mode: 'insensitive' } },
                            { subject: { startsWith: 'Re: ' + normalized, mode: 'insensitive' } }, // Simple heuristic
                            { subject: { contains: normalized, mode: 'insensitive' } } // Broader search, filter in code
                        ]
                    },
                    orderBy: { createdAt: 'desc' }, // Newest first
                    include: {
                        labels: true,
                        attachments: true
                    }
                });

                // Strict filter and prepare
                const pEmails = threadCandidates.filter(e => normalizeSubject(e.subject || '') === normalized);

                threadEmails = await Promise.all(pEmails.map(async (e) => {
                    const c = await fetchContent(e);
                    const atts = await signAttachments(e.attachments ?? []);
                    return buildEmailPayload(e, c, atts);
                }));
            }
        }

        const emailPayload = await buildEmailPayload(email, content, attachmentsWithUrls);

        return NextResponse.json({
            ...emailPayload,
            thread: threadEmails.length > 0 ? threadEmails : undefined
        });

    } catch (error) {
        console.error('Failed to fetch email:', error);
        return NextResponse.json({ error: 'Failed to fetch email' }, { status: 500 });
    }
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> } // Treat params as a promise
) {
    const user = await getCurrentUser();
    if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const { id } = await params; // Await the params
        const body = await req.json();
        const { starred, folder, labelIds, toggleLabelId, read } = body;

        const updateData: any = {};

        if (typeof starred === 'boolean') {
            updateData.starred = starred;
        }

        if (typeof read === 'boolean') {
            updateData.read = read;
        }

        if (folder) {
            updateData.folder = folder;
        }

        // Handle full label replacement or toggling single label
        if (labelIds) {
            updateData.labels = {
                set: labelIds.map((lid: string) => ({ id: lid }))
            };
        }

        if (toggleLabelId) {
            // Logic to toggle a specific label would require fetching first, 
            // but Prisma doesn't have a simple "toggle" operator for many-to-many.
            // We'll handle this by fetching the email first.
            const email = await prisma.email.findUnique({
                where: { id },
                include: { labels: true }
            });

            if (email) {
                const hasLabel = email.labels.some(l => l.id === toggleLabelId);
                if (hasLabel) {
                    updateData.labels = {
                        disconnect: { id: toggleLabelId }
                    };
                } else {
                    updateData.labels = {
                        connect: { id: toggleLabelId }
                    };
                }
            }
        }

        const email = await prisma.email.update({
            where: { id },
            data: updateData,
            include: { labels: true }
        });

        return NextResponse.json(email);

    } catch (error) {
        console.error('Failed to update email:', error);
        return NextResponse.json({ error: 'Failed to update email' }, { status: 500 });
    }
}
