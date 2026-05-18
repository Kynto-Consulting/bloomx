import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';
import { getFromStorage } from '@/lib/storage';
import { resend } from '@/lib/resend';
import { buildReplyIcs, InviteResponseStatus, parseInviteFromIcs } from '@/lib/calendar/ics';
import { ensureDefaultCalendars } from '@/lib/calendar/defaults';

function normalizeResponseLabel(response: InviteResponseStatus) {
    return {
        accepted: 'Accepted',
        tentative: 'Tentative',
        declined: 'Declined',
    }[response];
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getCurrentUser();
    if (!user?.id || !user.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id } = await params;
        const body = await req.json();
        const response = body?.response as InviteResponseStatus;

        if (!['accepted', 'tentative', 'declined'].includes(response)) {
            return NextResponse.json({ error: 'Invalid RSVP response' }, { status: 400 });
        }

        const email = await prisma.email.findFirst({
            where: {
                id,
                userId: user.id,
            },
            include: { attachments: true }
        });

        if (!email) {
            return NextResponse.json({ error: 'Email not found' }, { status: 404 });
        }

        const attachment = email.attachments.find((item) => {
            const mimeType = String(item.mimeType || '').toLowerCase();
            const filename = String(item.filename || '').toLowerCase();
            return mimeType.includes('text/calendar') || filename.endsWith('.ics');
        });

        if (!attachment?.key) {
            return NextResponse.json({ error: 'This email does not contain a calendar invitation' }, { status: 400 });
        }

        const rawInvite = await getFromStorage(attachment.key);
        const invite = parseInviteFromIcs(rawInvite || '');
        if (!invite?.organizerEmail) {
            return NextResponse.json({ error: 'Unable to determine the invite organizer' }, { status: 400 });
        }

        const replyIcs = buildReplyIcs({
            invite,
            attendeeEmail: user.email,
            attendeeName: user.name || user.email,
            response,
        });

        const responseLabel = normalizeResponseLabel(response);
        const subject = `${responseLabel}: ${invite.summary || email.subject || 'Invitation'}`;
        const formattedFrom = user.name ? `${user.name} <${user.email}>` : user.email;

        const { error } = await resend.emails.send({
            from: formattedFrom,
            to: [invite.organizerEmail],
            subject,
            text: `${responseLabel} by ${user.name || user.email}${invite.summary ? ` for ${invite.summary}` : ''}.`,
            attachments: [
                {
                    filename: attachment.filename || 'reply.ics',
                    content: Buffer.from(replyIcs, 'utf8'),
                }
            ]
        });

        if (error) {
            return NextResponse.json({ error: error.message || 'Failed to send RSVP' }, { status: 400 });
        }

        await prisma.emailEvent.create({
            data: {
                emailId: email.id,
                type: 'invite.rsvp',
                data: {
                    response,
                    subject,
                    organizerEmail: invite.organizerEmail,
                    organizerName: invite.organizerName,
                    uid: invite.uid,
                    respondedAt: new Date().toISOString(),
                } as any,
            }
        });

        const calendars = await ensureDefaultCalendars(user.id);
        const sharedCalendar = calendars.find((calendar) => calendar.source === 'shared') || calendars[0];
        if (sharedCalendar) {
            const existingEvent = await prisma.calendarEvent.findFirst({
                where: {
                    userId: user.id,
                    OR: [
                        invite.uid ? { inviteUid: invite.uid } : undefined,
                        { sourceEmailId: email.id },
                    ].filter(Boolean) as any,
                },
                include: { attendees: true }
            });

            const attendeeData = {
                email: user.email,
                name: user.name || user.email,
                responseStatus: response,
                isOrganizer: false,
            };

            if (existingEvent) {
                await prisma.calendarEvent.update({
                    where: { id: existingEvent.id },
                    data: {
                        calendarId: sharedCalendar.id,
                        title: invite.summary || email.subject || 'Invitation',
                        description: invite.description || null,
                        location: invite.meetUrl || invite.location || null,
                        startsAt: invite.startsAt ? new Date(invite.startsAt) : existingEvent.startsAt,
                        endsAt: invite.endsAt ? new Date(invite.endsAt) : existingEvent.endsAt,
                        source: 'shared',
                        status: 'confirmed',
                        responseStatus: response,
                        inviteUid: invite.uid || existingEvent.inviteUid,
                        organizerEmail: invite.organizerEmail,
                        organizerName: invite.organizerName,
                        sourceEmailId: email.id,
                        attendees: {
                            deleteMany: { email: user.email },
                            create: attendeeData,
                        }
                    }
                });
            } else if (invite.startsAt && invite.endsAt) {
                await prisma.calendarEvent.create({
                    data: {
                        userId: user.id,
                        calendarId: sharedCalendar.id,
                        title: invite.summary || email.subject || 'Invitation',
                        description: invite.description || null,
                        location: invite.meetUrl || invite.location || null,
                        startsAt: new Date(invite.startsAt),
                        endsAt: new Date(invite.endsAt),
                        source: 'shared',
                        status: 'confirmed',
                        responseStatus: response,
                        inviteUid: invite.uid || null,
                        organizerEmail: invite.organizerEmail,
                        organizerName: invite.organizerName,
                        sourceEmailId: email.id,
                        attendees: {
                            create: attendeeData,
                        }
                    }
                });
            }

            if (invite.organizerEmail) {
                await prisma.contact.upsert({
                    where: {
                        userId_email: {
                            userId: user.id,
                            email: invite.organizerEmail,
                        }
                    },
                    update: {
                        name: invite.organizerName || invite.organizerEmail,
                        source: 'shared',
                    },
                    create: {
                        userId: user.id,
                        email: invite.organizerEmail,
                        name: invite.organizerName || invite.organizerEmail,
                        source: 'shared',
                    }
                });
            }
        }

        return NextResponse.json({
            success: true,
            inviteResponse: {
                response,
                subject,
                organizerEmail: invite.organizerEmail,
                organizerName: invite.organizerName,
                uid: invite.uid,
                respondedAt: new Date().toISOString(),
            }
        });
    } catch (error: any) {
        console.error('Invite RSVP failed:', error);
        return NextResponse.json({ error: error.message || 'Failed to process RSVP' }, { status: 500 });
    }
}