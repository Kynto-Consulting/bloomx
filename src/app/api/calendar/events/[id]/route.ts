import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { resend } from '@/lib/resend';
import { uploadToStorage } from '@/lib/storage';
import { buildCancelIcs } from '@/lib/calendar/ics';
import { buildEmailHtml, resolveTimeZone } from '@/lib/calendar/email-templates';
import { sendEventInvites } from '@/lib/calendar/notify';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const title = String(body?.title || '').trim();
    const startsAt = body?.startsAt ? new Date(body.startsAt) : null;
    const endsAt = body?.endsAt ? new Date(body.endsAt) : null;

    if (!title || !startsAt || !endsAt || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
        return NextResponse.json({ error: 'Invalid event payload' }, { status: 400 });
    }

    const event = await prisma.calendarEvent.findFirst({
        where: { id, userId: user.id },
        include: { calendar: true }
    });

    if (!event) {
        return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    if (event.calendar.isReadOnly) {
        return NextResponse.json({ error: 'Cannot edit read-only events' }, { status: 400 });
    }

    const attendeeEmails = Array.isArray(body?.attendees) 
        ? body.attendees.map((e: any) => typeof e === 'string' ? e.trim() : String(e).trim()).filter((e: string) => e && e !== user.email) 
        : [];

    await prisma.calendarAttendee.deleteMany({
        where: {
            eventId: id,
            isOrganizer: false,
            email: { notIn: attendeeEmails }
        }
    });

    const existingAttendees = await prisma.calendarAttendee.findMany({
        where: { eventId: id }
    });
    const existingEmails = existingAttendees.map(a => a.email);
    const attendeesToAdd = attendeeEmails.filter((e: string) => !existingEmails.includes(e));

    const updated = await prisma.calendarEvent.update({
        where: { id },
        data: {
            title,
            location: body?.location || null,
            startsAt,
            endsAt,
            attendees: {
                create: attendeesToAdd.map((e: string) => ({
                    email: e,
                    responseStatus: 'needsAction',
                    isOrganizer: false
                }))
            }
        },
        include: {
            calendar: true,
            attendees: true
        }
    });

    // Server-side auto-invite for newly-added guests on edit. Best-effort.
    let invitedCount = 0;
    if (attendeesToAdd.length > 0 && !updated.calendar.isReadOnly) {
        invitedCount = await sendEventInvites({
            userId: user.id,
            userEmail: user.email,
            userName: user.name,
            event: updated,
            recipients: attendeesToAdd,
            timezone: typeof body?.timeZone === 'string' ? body.timeZone : null,
        });
    }

    return NextResponse.json({ ...updated, invitedCount });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const event = await prisma.calendarEvent.findFirst({
        where: { id, userId: user.id },
        include: { calendar: true, attendees: true }
    });

    if (!event) {
        return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    if (event.calendar.isReadOnly) {
        return NextResponse.json({ error: 'Cannot delete read-only events' }, { status: 400 });
    }

    // Notify guests that the event was cancelled (METHOD:CANCEL .ics). Best-effort:
    // a send failure must not block the delete.
    let cancelledNotified = 0;
    try {
        const organizerEmail = (event.organizerEmail || user.email || '').trim();
        const organizerName = (event.organizerName || user.name || organizerEmail).trim();

        const recipients = Array.from(new Set(
            event.attendees
                .filter((a) => !a.isOrganizer && a.email && a.email.toLowerCase() !== organizerEmail.toLowerCase())
                .map((a) => a.email.toLowerCase())
        ));

        if (organizerEmail && recipients.length > 0) {
            const brandLocal = (process.env.NEXT_PUBLIC_BRAND_NAME || 'bloom').toLowerCase().replace(/[^a-z0-9]/g, '');
            const eventUid = event.inviteUid || event.externalId || `${event.id}@${brandLocal}.local`;
            const sequenceBase = new Date(event.updatedAt || new Date()).getTime();
            const sequence = (Number.isFinite(sequenceBase) ? Math.floor(sequenceBase / 1000) : 0) + 1;

            const icsContent = buildCancelIcs({
                uid: eventUid,
                title: event.title,
                description: event.description,
                location: event.location,
                startsAt: event.startsAt,
                endsAt: event.endsAt,
                organizerEmail,
                organizerName,
                attendees: event.attendees,
                sequence,
            });

            const cancelTz = resolveTimeZone(null); // DELETE carries no tz payload → default
            const html = buildEmailHtml({
                type: 'cancellation',
                title: event.title,
                when: { start: event.startsAt, end: event.endsAt, timezone: cancelTz },
                location: event.location,
                organizer: { email: organizerEmail, name: organizerName },
                hint: 'Este evento fue cancelado. Tu calendario se actualizará con el archivo .ics adjunto.',
            });

            const text = [
                `Evento cancelado: ${event.title}`,
                `Cuándo: ${new Date(event.startsAt).toLocaleString('es-PE', { timeZone: cancelTz })}`,
                event.location ? `Lugar: ${event.location}` : '',
                '',
                'El archivo .ics adjunto actualiza tu calendario.',
            ].filter(Boolean).join('\n');

            const icsBuffer = Buffer.from(icsContent, 'utf8');
            const formattedFrom = `${organizerName} <${organizerEmail}>`;

            const { error } = await resend.emails.send({
                from: formattedFrom,
                to: recipients,
                subject: `Cancelado: ${event.title}`,
                html,
                text,
                attachments: [{ filename: 'cancel.ics', content: icsBuffer }],
            });

            if (error) {
                console.error('[DELETE event] cancellation send failed:', error);
            } else {
                cancelledNotified = recipients.length;

                // Persist to Sent so it shows in the mailbox.
                try {
                    const timestamp = Date.now();
                    const safeSubject = `Cancelado: ${event.title}`.replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 50);
                    const icsKey = `attachments/${organizerEmail}/${timestamp}-cancel.ics`;
                    // Upload the body too — the viewer renders from htmlKey/textKey.
                    const htmlKey = `sent/${organizerEmail}/${timestamp}-${safeSubject}.html`;
                    const textKey = `sent/${organizerEmail}/${timestamp}-${safeSubject}.txt`;

                    await Promise.all([
                        uploadToStorage(icsKey, icsBuffer, 'text/calendar;charset=utf-8'),
                        uploadToStorage(htmlKey, Buffer.from(html, 'utf8'), 'text/html'),
                        uploadToStorage(textKey, Buffer.from(text, 'utf8'), 'text/plain'),
                    ]);

                    await prisma.email.create({
                        data: {
                            userId: user.id,
                            htmlKey,
                            textKey,
                            from: formattedFrom,
                            to: recipients.join(', '),
                            cleanTo: recipients.join(', '),
                            subject: `Cancelado: ${event.title}`,
                            messageId: crypto.randomUUID(),
                            snippet: text.substring(0, 200),
                            folder: 'sent',
                            status: 'sent',
                            read: true,
                            attachments: {
                                create: [{
                                    filename: 'cancel.ics',
                                    mimeType: 'text/calendar;charset=utf-8',
                                    size: icsBuffer.byteLength,
                                    key: icsKey,
                                }],
                            },
                        },
                    });
                } catch (persistError) {
                    console.error('[DELETE event] failed to persist cancellation to Sent:', persistError);
                }
            }
        }
    } catch (notifyError) {
        console.error('[DELETE event] cancellation notification error:', notifyError);
    }

    await prisma.calendarEvent.delete({
        where: { id }
    });

    return NextResponse.json({ success: true, cancelledNotified });
}
