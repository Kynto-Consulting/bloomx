import { NextRequest, NextResponse, after } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resend } from '@/lib/resend';
import { uploadToStorage } from '@/lib/storage';
import { randomBytes } from 'crypto';
import { ensureDefaultCalendars } from '@/lib/calendar/defaults';
import {
    appointmentConfirmationOptions,
    buildEmailHtml,
    buildEmailText,
    emailSubject,
    emailText,
    formatEmailWhen,
    type EmailLocale,
    hostNotificationOptions,
} from '@/lib/calendar/email-templates';
import { getEmailBrand, resolveEmailLocale } from '@/lib/calendar/email-brand';
import { fetchDomainEmailContext, resolveEmailHost } from '@/lib/calendar/email-brand-server';
import { buildEventIcs } from '@/lib/calendar/ics-build';
import { meetingProviderName } from '@/lib/conferencing/hosts';
import { createMeeting as createConferenceMeeting, deleteMeeting as deleteConferenceMeeting } from '@/lib/conferencing/service';
import { providerFromLegacyValue } from '@/lib/conferencing/types';
import { resolveDomain } from '@/lib/conferencing/http';
import { formatFromHeader, isValidEmailAddress, sanitizeDisplayName } from '@/lib/mail-validation';
import { getClientIp, rateLimitAsync } from '@/lib/security';
import { signCancelToken } from '@/lib/appointments/cancel-token';
import { hasConflict, isBookableSlot, isValidTimeZone } from '@/lib/appointments/slots';
import { buildAppointmentBookedContext, fireLifecycleHook } from '@/lib/expansions/server-hooks';

// ─── ICS builder ────────────────────────────────────────────────────────────

function slugify(v: string) {
    return String(v || 'meeting').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'meeting';
}

/** ICS de la reserva: delega en el constructor unico (saneado CWE-93, plegado UTF-8, conferencia validada por host). */
function buildBookingIcs({
    uid, title, description, meetUrl, startsAt, endsAt,
    organizerEmail, organizerName, guestEmail, guestName, timezone, locale, brandName,
}: {
    uid: string; title: string; description?: string | null; meetUrl?: string | null;
    startsAt: Date; endsAt: Date; organizerEmail: string; organizerName: string;
    guestEmail: string; guestName: string; timezone: string; locale: EmailLocale; brandName: string;
}): string {
    const richDescription = [
        emailText(locale, 'icsIntro'),
        '',
        `${emailText(locale, 'labels.when')}: ${formatEmailWhen(startsAt, endsAt, timezone, locale)}`,
        `${emailText(locale, 'icsWith')}: ${organizerName} (${organizerEmail})`,
        description ? `${emailText(locale, 'labels.notes')}: ${description}` : null,
    ].filter((v) => v !== null).join('\n');

    return buildEventIcs({
        uid,
        sequence: 0,
        method: 'REQUEST',
        title,
        description: richDescription,
        startsAt,
        endsAt,
        organizer: { email: organizerEmail, name: organizerName },
        attendees: [{ email: guestEmail, name: guestName, role: 'REQ-PARTICIPANT', partstat: 'NEEDS-ACTION', rsvp: true }],
        conference: meetUrl ? { joinUrl: meetUrl } : null,
        brandName,
        locale,
        timezone,
    });
}

// ─── Send & persist helper ───────────────────────────────────────────────────

async function sendAndPersistEmail({
    userId, fromName, fromEmail, to, subject, html, text, attachmentIcs, icsFilename,
}: {
    userId: string; fromName: string; fromEmail: string; to: string;
    subject: string; html: string; text: string; attachmentIcs: string; icsFilename: string;
}) {
    const timestamp = Date.now();
    const formattedFrom = formatFromHeader(fromName, fromEmail);
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
        text,
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
            snippet: text.replace(/\s+/g, ' ').slice(0, 200) || subject,
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

class SlotTakenError extends Error {
    constructor() {
        super('This slot is no longer available');
        this.name = 'SlotTakenError';
    }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ scheduleId: string }> }) {
    const { scheduleId } = await params;

    // Anti-abuso, ANTES de parsear/validar: el endpoint publico envia correo a una direccion arbitraria.
    const ipLimit = await rateLimitAsync(`book-ip:${getClientIp(req)}`, 10, 60 * 60 * 1000);
    if (!ipLimit.ok) {
        return NextResponse.json(
            { error: 'Too many booking requests. Try again later.' },
            { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfter) } },
        );
    }

    const body = await req.json().catch(() => null);

    // Datos del invitado (endpoint publico): sin caracteres de control y con longitud acotada
    const guestName = sanitizeDisplayName(body?.guestName).slice(0, 100);
    const guestEmail = String(body?.guestEmail || '').trim().toLowerCase();
    const slotIso = String(body?.startsAt || '').trim();

    if (!guestName || !guestEmail || !isValidEmailAddress(guestEmail) || !slotIso) {
        return NextResponse.json({ error: 'Name, email, and slot are required' }, { status: 400 });
    }

    const mailLimit = await rateLimitAsync(`book-mail:${guestEmail}`, 3, 60 * 60 * 1000);
    if (!mailLimit.ok) {
        return NextResponse.json(
            { error: 'Too many booking requests. Try again later.' },
            { status: 429, headers: { 'Retry-After': String(mailLimit.retryAfter) } },
        );
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

    const tz = schedule.timezone && isValidTimeZone(schedule.timezone) ? schedule.timezone : 'UTC';

    // El hueco debe ser uno de los que la agenda realmente ofrece (futuro, alineado a la duracion y dentro
    // de la disponibilidad): antes se aceptaba cualquier hora.
    if (!isBookableSlot(startsAt, { tz, availability: schedule.availability, durationMin: schedule.duration })) {
        return NextResponse.json({ error: 'This time is not available for booking' }, { status: 400 });
    }

    const endsAt = new Date(startsAt.getTime() + schedule.duration * 60 * 1000);

    // Rango ocupado de la anfitriona: eventos de cualquier calendario + reservas confirmadas de esta agenda.
    const findConflicts = async (db: Pick<typeof prisma, 'calendarEvent' | 'appointmentBooking'>) => {
        const [events, bookings] = await Promise.all([
            db.calendarEvent.findMany({
                where: { userId: schedule.user.id, status: { not: 'cancelled' }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
                select: { startsAt: true, endsAt: true },
            }),
            db.appointmentBooking.findMany({
                where: { scheduleId, status: 'confirmed', startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
                select: { startsAt: true, endsAt: true },
            }),
        ]);
        return hasConflict(
            [...events, ...bookings].map((r) => ({ start: r.startsAt, end: r.endsAt })),
            startsAt,
            endsAt,
        );
    };

    // Comprobacion rapida (sin candado) para no crear salas de reunion inutilmente.
    if (await findConflicts(prisma)) {
        return NextResponse.json({ error: 'This slot is no longer available' }, { status: 409 });
    }

    // Reunion de videollamada si la agenda la tiene configurada ('meet' | 'zoom'): fachada unica de conferencias (la logica del
    // proveedor vive en las extensiones core-zoom / core-google-meet; sin ellas se usa la cuenta vinculada del ANFITRION).
    // Se crea con la identidad del anfitrion de la agenda (no del visitante anonimo). Un fallo no bloquea la reserva.
    let meetUrl: string | null = null;
    let conferenceMeetingId: string | null = null;
    const conferenceProvider = providerFromLegacyValue(schedule.conferencing);
    const hostActor = { userId: schedule.user.id, email: schedule.user.email || null, domain: resolveDomain(req) };
    if (conferenceProvider && conferenceProvider !== 'custom') {
        try {
            const meeting = await createConferenceMeeting(
                hostActor,
                conferenceProvider,
                {
                    topic: `${schedule.name} — ${guestName}`,
                    startsAt: startsAt.toISOString(),
                    endsAt: endsAt.toISOString(),
                    timeZone: schedule.timezone || 'UTC',
                    attendees: [guestEmail],
                },
                // Idempotente por (agenda, hueco, invitado): un reintento del visitante no crea otra sala.
                { idempotencyKey: `booking:${scheduleId}:${startsAt.getTime()}:${guestEmail.toLowerCase()}`.slice(0, 128) },
            );
            meetUrl = meeting.joinUrl;
            conferenceMeetingId = meeting.meetingId;
        } catch (err) {
            console.error('Conference creation failed:', (err as { code?: string })?.code || 'error');
        }
    }

    const calendars = await ensureDefaultCalendars(schedule.user.id);
    const targetCalendar = calendars.find(c => c.source === 'local' && !c.isReadOnly) || calendars[0];
    const brandDomain = (process.env.NEXT_PUBLIC_BRAND_NAME || 'bloom').toLowerCase().replace(/[^a-z0-9]/g, '');
    const inviteUid = randomBytes(16).toString('hex') + `@${brandDomain}`;

    // Id y token de cancelacion firmado (expira al empezar la cita). El token se guarda en la fila para
    // poder comprobar que el enlace del correo corresponde a esta reserva y no a una version anterior.
    const bookingId = `bk${randomBytes(12).toString('hex')}`;
    const cancelToken = signCancelToken(bookingId, startsAt.getTime());
    const guestNotes = body?.guestNotes ? String(body.guestNotes).trim().slice(0, 2000) : null;

    // Doble reserva: comprobar-y-crear dentro de UNA transaccion con candado consultivo por anfitrion.
    // Dos peticiones simultaneas del mismo hueco se serializan; la segunda ve la primera y recibe 409.
    // Respaldo en BD: indice unico parcial (scheduleId, startsAt) WHERE status='confirmed' (ver ensure-schema).
    let booking;
    try {
        booking = await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`appointments:${schedule.user.id}`}))`;

            if (await findConflicts(tx)) throw new SlotTakenError();

            let calendarEventId: string | null = null;
            if (targetCalendar) {
                const event = await tx.calendarEvent.create({
                    data: {
                        userId: schedule.user.id,
                        calendarId: targetCalendar.id,
                        title: `${schedule.name} — ${guestName}`,
                        description: body?.guestNotes ? String(body.guestNotes).slice(0, 2000) : null,
                        location: meetUrl || null,
                        ...(meetUrl ? { conferenceUrl: meetUrl, conferenceProvider, conferenceMeetingId } : {}),
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

            return tx.appointmentBooking.create({
                data: {
                    id: bookingId,
                    scheduleId,
                    calendarEventId,
                    guestName,
                    guestEmail,
                    guestNotes,
                    startsAt,
                    endsAt,
                    meetUrl,
                    cancelToken,
                    status: 'confirmed',
                },
            });
        }, { timeout: 15_000, maxWait: 10_000 });
    } catch (err: any) {
        // SlotTakenError (re-comprobacion) o P2002 (indice unico parcial): el hueco ya no esta libre.
        // La reserva no se hizo: la sala recien creada se descarta (best-effort) para no dejar reuniones huerfanas.
        if (conferenceProvider && conferenceMeetingId) void deleteConferenceMeeting(hostActor, conferenceProvider, conferenceMeetingId).catch(() => undefined);
        if (err instanceof SlotTakenError || err?.code === 'P2002') {
            return NextResponse.json({ error: 'This slot is no longer available' }, { status: 409 });
        }
        console.error('Booking failed:', err);
        return NextResponse.json({ error: 'Could not complete the booking' }, { status: 500 });
    }

    // Hook APPOINTMENT_BOOKED para las extensiones del anfitrion (no bloqueante, contexto minimo).
    fireLifecycleHook('APPOINTMENT_BOOKED', schedule.user.id, buildAppointmentBookedContext({
        bookingId: booking.id, scheduleId, startsAt: booking.startsAt, endsAt: booking.endsAt,
        guestEmail: booking.guestEmail, calendarEventId: booking.calendarEventId,
    }));

    // Correos: se envian con after() para que la funcion serverless no se congele antes de terminar.
    const hostName = schedule.user.name || schedule.user.email || 'Host';
    const hostEmail = schedule.user.email;
    const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://localhost:3000';
    const cancelUrl = `${origin}/book/${scheduleId}/cancel/${cancelToken}`;
    const eventTitle = `${schedule.name} — ${guestName}`;
    const icsFilename = `${slugify(schedule.name)}.ics`;

    // Marca del dominio (misma config y cache que el layout; sin config = marca por defecto): PRODID del ICS y correos.
    const emailHost = resolveEmailHost(req);
    const brand = getEmailBrand(await fetchDomainEmailContext(emailHost));
    const icsLocale = resolveEmailLocale({ brand, audience: 'recipient', acceptLanguage: req.headers.get('accept-language') });

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
        locale: icsLocale,
        brandName: brand.name,
    });

    if (hostEmail) {
        // Cabeceras de la peticion del INVITADO: se leen ahora (el envio ocurre despues de responder).
        const guestAcceptLanguage = req.headers.get('accept-language');
        const sendEmails = async () => {
            // Invitado: su Accept-Language; anfitrion: idioma de la empresa (o es).
            const guestLocale = resolveEmailLocale({ brand, audience: 'recipient', acceptLanguage: guestAcceptLanguage });
            const hostLocale = resolveEmailLocale({ brand, audience: 'user' });
            const guestOptions = appointmentConfirmationOptions({
                guestName, guestEmail, hostName, hostEmail,
                scheduleName: schedule.name, startsAt, endsAt, meetUrl, cancelUrl, timezone: tz,
                brand, locale: guestLocale,
            });
            const hostOptions = hostNotificationOptions({
                guestName, guestEmail, guestNotes, scheduleName: schedule.name, startsAt, endsAt, timezone: tz, meetUrl,
                brand, locale: hostLocale,
            });
            const provider = meetUrl ? meetingProviderName(meetUrl) || (guestLocale === 'en' ? 'Video call' : 'Videollamada') : null;
            const results = await Promise.allSettled([
                // Confirmation to guest
                sendAndPersistEmail({
                    userId: schedule.user.id,
                    fromName: hostName,
                    fromEmail: hostEmail,
                    to: guestEmail,
                    subject: emailSubject(guestLocale, 'appointment', provider ? `${schedule.name} · ${provider}` : schedule.name),
                    html: buildEmailHtml(guestOptions),
                    text: buildEmailText(guestOptions),
                    attachmentIcs: icsContent,
                    icsFilename,
                }),
                // Notification to host
                sendAndPersistEmail({
                    userId: schedule.user.id,
                    fromName: hostName,
                    fromEmail: hostEmail,
                    to: hostEmail,
                    subject: emailSubject(hostLocale, 'hostNotification', `${guestName} — ${schedule.name}`),
                    html: buildEmailHtml(hostOptions),
                    text: buildEmailText(hostOptions),
                    attachmentIcs: icsContent,
                    icsFilename,
                }),
            ]);
            for (const r of results) {
                if (r.status === 'rejected') console.error('Booking email failed:', r.reason);
            }
        };
        try {
            after(sendEmails);
        } catch {
            // Fuera de un contexto de peticion (tests/scripts): ejecutar sin bloquear la respuesta.
            void sendEmails();
        }
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
