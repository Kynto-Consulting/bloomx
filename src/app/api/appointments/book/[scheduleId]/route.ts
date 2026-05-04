import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resend } from '@/lib/resend';
import { uploadToStorage } from '@/lib/storage';
import { randomBytes } from 'crypto';
import { ensureDefaultCalendars } from '@/lib/calendar/defaults';

// ─── ICS builder ────────────────────────────────────────────────────────────

function escapeIcs(v: string) {
    return String(v || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function formatIcsDate(d: Date) {
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
function slugify(v: string) {
    return String(v || 'meeting').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'meeting';
}
function foldLine(line: string) {
    const parts: string[] = [];
    while (line.length > 75) { parts.push(line.slice(0, 75)); line = ' ' + line.slice(75); }
    parts.push(line);
    return parts.join('\r\n');
}

/** Returns the UTC offset for `tz` at `date` as ±HHMM (e.g. "-0500"). */
function tzOffsetStr(date: Date, tz: string): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(date);
    const get = (t: string) => { const v = parts.find(p => p.type === t)?.value ?? '00'; return v === '24' ? '00' : v; };
    const localMs = Date.UTC(
        Number(parts.find(p => p.type === 'year')?.value ?? '2000'),
        Number(get('month')) - 1, Number(get('day')),
        Number(get('hour')), Number(get('minute')), Number(get('second')),
    );
    const offMin = Math.round((localMs - date.getTime()) / 60000);
    const sign = offMin >= 0 ? '+' : '-';
    const abs = Math.abs(offMin);
    return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}${String(abs % 60).padStart(2, '0')}`;
}

/** Formats a Date as YYYYMMDDTHHMMSS in the given timezone (no Z — used with TZID). */
function formatIcsDateTz(date: Date, tz: string): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(date);
    const get = (t: string) => { const v = parts.find(p => p.type === t)?.value ?? '00'; return v === '24' ? '00' : v; };
    return `${parts.find(p => p.type === 'year')?.value}${get('month')}${get('day')}T${get('hour')}${get('minute')}${get('second')}`;
}

function buildBookingIcs({
    uid, title, description, meetUrl, startsAt, endsAt,
    organizerEmail, organizerName, guestEmail, guestName, timezone,
}: {
    uid: string; title: string; description?: string | null; meetUrl?: string | null;
    startsAt: Date; endsAt: Date; organizerEmail: string; organizerName: string;
    guestEmail: string; guestName: string; timezone: string;
}): string {
    const isZoom = meetUrl?.includes('zoom.us');
    const isGoogleMeet = meetUrl?.includes('meet.google.com');

    const fmt = (d: Date) => new Intl.DateTimeFormat('en-US', {
        timeZone: timezone, weekday: 'long', year: 'numeric', month: 'long',
        day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    }).format(d);

    // Build a rich plain-text description
    const descParts = [
        `You have a confirmed appointment.`,
        ``,
        `When: ${fmt(startsAt)}`,
        `With: ${organizerName} (${organizerEmail})`,
        description ? `Notes: ${description}` : null,
        meetUrl ? `` : null,
        meetUrl ? `Join: ${meetUrl}` : null,
    ].filter(v => v !== null) as string[];
    const richDescription = descParts.join('\\n');

    // Conference property (RFC 7986 + vendor extensions)
    const conferenceLines: (string | null)[] = meetUrl ? [
        `URL:${meetUrl}`,
        isGoogleMeet
            ? `CONFERENCE;VALUE=URI;FEATURE=VIDEO;LABEL=Join Google Meet:${meetUrl}`
            : isZoom
                ? `CONFERENCE;VALUE=URI;FEATURE=VIDEO;LABEL=Join Zoom Meeting:${meetUrl}`
                : `CONFERENCE;VALUE=URI;FEATURE=VIDEO;LABEL=Join Meeting:${meetUrl}`,
        isGoogleMeet ? `X-GOOGLE-CONFERENCE:${meetUrl}` : null,
        isZoom ? `X-ZOOM-JOIN-URL:${meetUrl}` : null,
    ] : [];

    // VTIMEZONE block — lets calendar clients display the local time without conversion.
    // We use the offset at startsAt; for timezones with DST this is a single-rule simplification
    // but correct for the event itself since startsAt falls within that offset period.
    const offset = tzOffsetStr(startsAt, timezone);
    const vtimezone = [
        'BEGIN:VTIMEZONE',
        `TZID:${timezone}`,
        `X-LIC-LOCATION:${timezone}`,
        'BEGIN:STANDARD',
        `TZOFFSETFROM:${offset}`,
        `TZOFFSETTO:${offset}`,
        `TZNAME:${timezone}`,
        'DTSTART:19700101T000000',
        'END:STANDARD',
        'END:VTIMEZONE',
    ];

    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//BloomX//Appointments//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:REQUEST',
        ...vtimezone,
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${formatIcsDate(new Date())}`,
        `DTSTART;TZID=${timezone}:${formatIcsDateTz(startsAt, timezone)}`,
        `DTEND;TZID=${timezone}:${formatIcsDateTz(endsAt, timezone)}`,
        `SUMMARY:${escapeIcs(title)}`,
        `DESCRIPTION:${richDescription}`,
        meetUrl ? `LOCATION:${escapeIcs(meetUrl)}` : null,
        ...conferenceLines,
        `ORGANIZER;CN="${escapeIcs(organizerName)}":mailto:${organizerEmail}`,
        `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=CHAIR;PARTSTAT=ACCEPTED;RSVP=FALSE;CN="${escapeIcs(organizerName)}":mailto:${organizerEmail}`,
        `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN="${escapeIcs(guestName)}":mailto:${guestEmail}`,
        'SEQUENCE:0',
        'STATUS:CONFIRMED',
        'TRANSP:OPAQUE',
        'BEGIN:VALARM',
        'TRIGGER:-PT15M',
        'ACTION:DISPLAY',
        `DESCRIPTION:Reminder: ${escapeIcs(title)}`,
        'END:VALARM',
        'END:VEVENT',
        'END:VCALENDAR',
    ].filter(Boolean) as string[];

    return lines.map(foldLine).join('\r\n');
}

// ─── Meeting providers ───────────────────────────────────────────────────────

async function createGoogleMeetRoom(
    refreshToken: string, topic: string, startsAt: Date, endsAt: Date,
    guestName: string, guestEmail: string,
) {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID || '',
            client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        }),
    });
    if (!tokenRes.ok) throw new Error('Failed to refresh Google token');
    const { access_token } = await tokenRes.json();

    // Guest is intentionally placed in description, NOT in attendees.
    // Google ignores sendUpdates=none for non-Google accounts and always sends its own
    // calendar invite — the only way to suppress it is to never list them as attendees.
    const eventRes = await fetch(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=none',
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                summary: topic,
                description: `Guest: ${guestName} (${guestEmail})`,
                start: { dateTime: startsAt.toISOString() },
                end: { dateTime: endsAt.toISOString() },
                conferenceData: {
                    createRequest: { requestId: randomBytes(8).toString('hex'), conferenceSolutionKey: { type: 'hangoutsMeet' },
                    conferenceProperties: { 
                        allowAddGuests: true,
                        allowedPresenters: 'EVERYONE',
                        accessType: 'OPEN',
                    } },
                },
            }),
        }
    );
    if (!eventRes.ok) throw new Error('Failed to create Google Meet event');
    const data = await eventRes.json();
    return data.conferenceData?.entryPoints?.find((ep: any) => ep.entryPointType === 'video')?.uri || null;
}

async function createZoomMeeting(refreshToken: string, topic: string, startsAt: Date, duration: number) {
    const clientId = process.env.ZOOM_CLIENT_ID;
    const clientSecret = process.env.ZOOM_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('Zoom not configured');

    const tokenRes = await fetch('https://zoom.us/oauth/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    if (!tokenRes.ok) throw new Error('Failed to refresh Zoom token');
    const { access_token } = await tokenRes.json();

    const meetRes = await fetch('https://api.zoom.us/v2/users/me/meetings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            topic,
            type: 2,
            start_time: startsAt.toISOString(),
            duration,
            timezone: 'UTC',
            settings: { join_before_host: true, waiting_room: false },
        }),
    });
    if (!meetRes.ok) throw new Error('Failed to create Zoom meeting');
    const data = await meetRes.json();
    return data.join_url || null;
}

// ─── Confirmation email ──────────────────────────────────────────────────────

function buildConfirmationHtml({
    guestName, hostName, scheduleName, startsAt, endsAt, meetUrl, cancelUrl, timezone,
}: {
    guestName: string; hostName: string; scheduleName: string;
    startsAt: Date; endsAt: Date; meetUrl: string | null; cancelUrl: string; timezone: string;
}) {
    const fmt = (d: Date) => new Intl.DateTimeFormat('en-US', {
        timeZone: timezone, weekday: 'long', year: 'numeric', month: 'long',
        day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    }).format(d);

    const meetSection = meetUrl ? `
        <p style="margin:16px 0 8px;font-size:14px;color:#374151;">Join the meeting:</p>
        <a href="${meetUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;">${meetUrl.includes('zoom') ? 'Join Zoom' : 'Join Google Meet'}</a>
    ` : '';

    return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f9fafb;font-family:system-ui,sans-serif;">
<div style="max-width:520px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
  <div style="background:#2563eb;padding:32px 32px 24px;">
    <p style="margin:0;color:#bfdbfe;font-size:13px;font-weight:500;letter-spacing:.5px;">BOOKING CONFIRMED</p>
    <h1 style="margin:8px 0 0;color:#fff;font-size:22px;font-weight:700;">${escapeHtml(scheduleName)}</h1>
  </div>
  <div style="padding:32px;">
    <p style="margin:0 0 20px;font-size:15px;color:#111827;">Hi ${escapeHtml(guestName)}, your appointment with <strong>${escapeHtml(hostName)}</strong> is confirmed.</p>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:10px 0;border-top:1px solid #e5e7eb;font-size:13px;color:#6b7280;width:80px;">When</td>
          <td style="padding:10px 0;border-top:1px solid #e5e7eb;font-size:14px;color:#111827;font-weight:500;">${escapeHtml(fmt(startsAt))}</td></tr>
      <tr><td style="padding:10px 0;border-top:1px solid #e5e7eb;font-size:13px;color:#6b7280;">Ends</td>
          <td style="padding:10px 0;border-top:1px solid #e5e7eb;font-size:14px;color:#111827;">${escapeHtml(fmt(endsAt))}</td></tr>
    </table>
    ${meetSection}
    <p style="margin:28px 0 0;font-size:13px;color:#9ca3af;">A calendar invite (.ics) is attached — add it to your calendar to get a reminder.</p>
    <p style="margin:24px 0 0;font-size:12px;color:#d1d5db;">Need to cancel? <a href="${cancelUrl}" style="color:#ef4444;text-decoration:none;">Cancel this appointment</a></p>
  </div>
</div>
</body></html>`;
}

function buildHostNotificationHtml({
    guestName, guestEmail, guestNotes, scheduleName, startsAt, endsAt, timezone,
}: {
    guestName: string; guestEmail: string; guestNotes?: string | null;
    scheduleName: string; startsAt: Date; endsAt: Date; timezone: string;
}) {
    const fmt = (d: Date) => new Intl.DateTimeFormat('en-US', {
        timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    }).format(d);

    const notesSection = guestNotes ? `<p style="margin:16px 0 0;font-size:14px;color:#374151;"><strong>Notes:</strong> ${escapeHtml(guestNotes)}</p>` : '';

    return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f9fafb;font-family:system-ui,sans-serif;">
<div style="max-width:520px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
  <div style="background:#16a34a;padding:24px 32px;">
    <p style="margin:0;color:#bbf7d0;font-size:13px;font-weight:500;">NEW BOOKING</p>
    <h1 style="margin:6px 0 0;color:#fff;font-size:20px;font-weight:700;">${escapeHtml(scheduleName)}</h1>
  </div>
  <div style="padding:28px 32px;">
    <p style="margin:0 0 16px;font-size:15px;color:#111827;"><strong>${escapeHtml(guestName)}</strong> (<a href="mailto:${escapeHtml(guestEmail)}" style="color:#2563eb;">${escapeHtml(guestEmail)}</a>) just booked an appointment.</p>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:8px 0;border-top:1px solid #e5e7eb;font-size:13px;color:#6b7280;width:80px;">When</td>
          <td style="padding:8px 0;border-top:1px solid #e5e7eb;font-size:14px;color:#111827;font-weight:500;">${escapeHtml(fmt(startsAt))} – ${escapeHtml(fmt(endsAt))}</td></tr>
    </table>
    ${notesSection}
  </div>
</div>
</body></html>`;
}

function escapeHtml(v: string) {
    return String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Send & persist helper ───────────────────────────────────────────────────

async function sendAndPersistEmail({
    userId, fromName, fromEmail, to, subject, html, attachmentIcs, icsFilename,
}: {
    userId: string; fromName: string; fromEmail: string; to: string;
    subject: string; html: string; attachmentIcs: string; icsFilename: string;
}) {
    const timestamp = Date.now();
    const formattedFrom = `${fromName} <${fromEmail}>`;
    const icsBuffer = Buffer.from(attachmentIcs, 'utf8');
    const safeSubject = subject.replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 50);
    const htmlKey = `sent/${fromEmail}/${timestamp}-${safeSubject}.html`;
    const icsKey = `attachments/${fromEmail}/${timestamp}-${icsFilename}`;

    await Promise.all([
        uploadToStorage(htmlKey, Buffer.from(html), 'text/html'),
        uploadToStorage(icsKey, icsBuffer, 'text/calendar'),
    ]);

    const { data, error } = await resend.emails.send({
        from: formattedFrom,
        to: [to],
        subject,
        html,
        attachments: [{ filename: icsFilename, content: icsBuffer }],
    });

    if (error) {
        console.error('Booking email send error:', error);
        return;
    }

    await prisma.email.create({
        data: {
            userId,
            from: formattedFrom,
            to,
            subject,
            messageId: data?.id || crypto.randomUUID(),
            snippet: `Booking confirmed: ${subject}`,
            htmlKey,
            folder: 'sent',
            status: 'sent',
            read: true,
            attachments: {
                create: [{ filename: icsFilename, mimeType: 'text/calendar', size: icsBuffer.byteLength, key: icsKey }],
            },
        },
    });
}

// ─── POST /api/appointments/book/[scheduleId] ────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ scheduleId: string }> }) {
    const { scheduleId } = await params;
    const body = await req.json();

    const guestName = String(body?.guestName || '').trim();
    const guestEmail = String(body?.guestEmail || '').trim().toLowerCase();
    const slotIso = String(body?.startsAt || '').trim();

    if (!guestName || !guestEmail || !guestEmail.includes('@') || !slotIso) {
        return NextResponse.json({ error: 'Name, email, and slot are required' }, { status: 400 });
    }

    const startsAt = new Date(slotIso);
    if (Number.isNaN(startsAt.getTime())) {
        return NextResponse.json({ error: 'Invalid slot time' }, { status: 400 });
    }

    const schedule = await prisma.appointmentSchedule.findFirst({
        where: { id: scheduleId, isActive: true },
        include: { user: { select: { id: true, name: true, email: true } }, availability: true },
    });

    if (!schedule) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });

    const endsAt = new Date(startsAt.getTime() + schedule.duration * 60 * 1000);

    // Verify slot is still free
    const busyEvent = await prisma.calendarEvent.findFirst({
        where: {
            userId: schedule.user.id,
            status: { not: 'cancelled' },
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
        },
    });
    const busyBooking = await prisma.appointmentBooking.findFirst({
        where: {
            scheduleId,
            status: 'confirmed',
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
        },
    });
    if (busyEvent || busyBooking) {
        return NextResponse.json({ error: 'This slot is no longer available' }, { status: 409 });
    }

    // Create meeting link if conferencing is configured
    let meetUrl: string | null = null;
    if (schedule.conferencing === 'meet') {
        try {
            const googleAccount = await prisma.account.findFirst({
                where: { userId: schedule.user.id, provider: 'google' },
                select: { refresh_token: true },
            });
            if (googleAccount?.refresh_token) {
                meetUrl = await createGoogleMeetRoom(
                    googleAccount.refresh_token,
                    `${schedule.name} — ${guestName}`,
                    startsAt,
                    endsAt,
                    guestName,
                    guestEmail
                );
            }
        } catch (err) {
            console.error('Meet creation failed:', err);
        }
    } else if (schedule.conferencing === 'zoom') {
        try {
            const zoomAccount = await prisma.account.findFirst({
                where: { userId: schedule.user.id, provider: 'zoom' },
                select: { refresh_token: true },
            });
            if (zoomAccount?.refresh_token) {
                meetUrl = await createZoomMeeting(
                    zoomAccount.refresh_token,
                    `${schedule.name} — ${guestName}`,
                    startsAt,
                    schedule.duration
                );
            }
        } catch (err) {
            console.error('Zoom creation failed:', err);
        }
    }

    // Create CalendarEvent for host
    const calendars = await ensureDefaultCalendars(schedule.user.id);
    const targetCalendar = calendars.find(c => c.source === 'local' && !c.isReadOnly) || calendars[0];
    let calendarEventId: string | null = null;
    const inviteUid = randomBytes(16).toString('hex') + '@bloomx';

    if (targetCalendar) {
        const event = await prisma.calendarEvent.create({
            data: {
                userId: schedule.user.id,
                calendarId: targetCalendar.id,
                title: `${schedule.name} — ${guestName}`,
                description: body?.guestNotes ? String(body.guestNotes) : null,
                location: meetUrl || null,
                startsAt,
                endsAt,
                source: 'local',
                status: 'confirmed',
                inviteUid,
                attendees: {
                    create: [
                        ...(schedule.user.email ? [{ email: schedule.user.email, name: schedule.user.name || schedule.user.email, responseStatus: 'accepted', isOrganizer: true }] : []),
                        { email: guestEmail, name: guestName, responseStatus: 'accepted', isOrganizer: false },
                    ],
                },
            },
        });
        calendarEventId = event.id;
    }

    const cancelToken = randomBytes(24).toString('hex');
    const booking = await prisma.appointmentBooking.create({
        data: {
            scheduleId,
            calendarEventId,
            guestName,
            guestEmail,
            guestNotes: body?.guestNotes ? String(body.guestNotes).trim() : null,
            startsAt,
            endsAt,
            meetUrl,
            cancelToken,
            status: 'confirmed',
        },
    });

    // Send emails (fire-and-forget — don't fail the booking if email fails)
    const hostName = schedule.user.name || schedule.user.email || 'Host';
    const hostEmail = schedule.user.email;
    const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://localhost:3000';
    const cancelUrl = `${origin}/book/${scheduleId}/cancel/${cancelToken}`;
    const tz = schedule.timezone || 'UTC';
    const eventTitle = `${schedule.name} — ${guestName}`;
    const icsFilename = `${slugify(schedule.name)}.ics`;

    const icsContent = buildBookingIcs({
        uid: inviteUid,
        title: eventTitle,
        description: body?.guestNotes ? String(body.guestNotes) : null,
        meetUrl,
        startsAt,
        endsAt,
        organizerEmail: hostEmail,
        organizerName: hostName,
        guestEmail,
        guestName,
        timezone: tz,
    });

    if (hostEmail) {
        // Confirmation to guest
        sendAndPersistEmail({
            userId: schedule.user.id,
            fromName: hostName,
            fromEmail: hostEmail,
            to: guestEmail,
            subject: `Confirmed: ${schedule.name} with ${hostName}`,
            html: buildConfirmationHtml({ guestName, hostName, scheduleName: schedule.name, startsAt, endsAt, meetUrl, cancelUrl, timezone: tz }),
            attachmentIcs: icsContent,
            icsFilename,
        }).catch(err => console.error('Guest confirmation email failed:', err));

        // Notification to host
        sendAndPersistEmail({
            userId: schedule.user.id,
            fromName: hostName,
            fromEmail: hostEmail,
            to: hostEmail,
            subject: `New booking: ${guestName} — ${schedule.name}`,
            html: buildHostNotificationHtml({ guestName, guestEmail, guestNotes: body?.guestNotes ? String(body.guestNotes) : null, scheduleName: schedule.name, startsAt, endsAt, timezone: tz }),
            attachmentIcs: icsContent,
            icsFilename,
        }).catch(err => console.error('Host notification email failed:', err));
    }

    return NextResponse.json({
        id: booking.id,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        meetUrl: booking.meetUrl,
        cancelToken: booking.cancelToken,
        hostName: schedule.user.name,
        scheduleName: schedule.name,
    }, { status: 201 });
}
