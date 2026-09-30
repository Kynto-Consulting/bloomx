import { NextRequest, NextResponse, after } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resend } from '@/lib/resend';
import { verifyCancelToken } from '@/lib/appointments/cancel-token';
import { formatFromHeader } from '@/lib/mail-validation';
import { buildEmailText, emailSubject, hostCancellationOptions, buildEmailHtml } from '@/lib/calendar/email-templates';
import { getEmailBrand, resolveEmailLocale } from '@/lib/calendar/email-brand';
import { fetchDomainEmailContext, resolveEmailHost } from '@/lib/calendar/email-brand-server';
import { getClientIp, rateLimitAsync, safeEqual } from '@/lib/security';
import { deleteMeeting as deleteConferenceMeeting } from '@/lib/conferencing/service';
import { resolveDomain } from '@/lib/conferencing/http';
import { isConferencingProviderId } from '@/lib/conferencing/types';

/**
 * Cancelacion de una cita desde el enlace del correo de confirmacion:
 *   /book/<scheduleId>/cancel/<token>   (pagina)  ->  esta API
 *
 * GET  ?token=...   resumen de la cita (para mostrar la confirmacion antes de cancelar)
 * POST { token }    cancela (idempotente)
 *
 * El token es <bookingId>.<expiracion>.<firma HMAC> y ademas debe coincidir con el guardado en la reserva.
 */

type Lookup =
    | { ok: true; booking: NonNullable<Awaited<ReturnType<typeof findBooking>>> }
    | { ok: false; status: number; error: string };

async function findBooking(bookingId: string, scheduleId: string) {
    return prisma.appointmentBooking.findFirst({
        where: { id: bookingId, scheduleId },
        include: {
            schedule: {
                select: { name: true, timezone: true, user: { select: { id: true, name: true, email: true } } },
            },
        },
    });
}

async function resolveBooking(scheduleId: string, token: unknown): Promise<Lookup> {
    const verified = verifyCancelToken(token);
    if (!verified.ok) {
        if (verified.reason === 'expired') return { ok: false, status: 410, error: 'This cancellation link has expired' };
        // Malformado o firma invalida: no se distingue para no ayudar a un atacante.
        return { ok: false, status: 404, error: 'Invalid cancellation link' };
    }

    const booking = await findBooking(verified.bookingId, scheduleId);
    if (!booking || !booking.cancelToken || !safeEqual(booking.cancelToken, String(token))) {
        return { ok: false, status: 404, error: 'Invalid cancellation link' };
    }
    return { ok: true, booking };
}

function summary(booking: NonNullable<Awaited<ReturnType<typeof findBooking>>>) {
    return {
        id: booking.id,
        status: booking.status,
        scheduleName: booking.schedule.name,
        hostName: booking.schedule.user.name || booking.schedule.user.email,
        guestName: booking.guestName,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        timezone: booking.schedule.timezone,
    };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ scheduleId: string }> }) {
    const { scheduleId } = await params;

    const limit = await rateLimitAsync(`cancel-get-ip:${getClientIp(req)}`, 60, 60 * 60 * 1000);
    if (!limit.ok) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } });
    }

    const result = await resolveBooking(scheduleId, req.nextUrl.searchParams.get('token'));
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(summary(result.booking), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ scheduleId: string }> }) {
    const { scheduleId } = await params;

    const limit = await rateLimitAsync(`cancel-post-ip:${getClientIp(req)}`, 20, 60 * 60 * 1000);
    if (!limit.ok) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } });
    }

    const body = await req.json().catch(() => null);
    const result = await resolveBooking(scheduleId, body?.token);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    const { booking } = result;

    // Solo pasa de confirmed -> cancelled una vez: si dos clics llegan a la vez, solo uno "gana".
    const updated = await prisma.appointmentBooking.updateMany({
        where: { id: booking.id, status: 'confirmed' },
        data: { status: 'cancelled' },
    });

    if (updated.count === 0) {
        // Ya estaba cancelada: respuesta idempotente (2xx).
        return NextResponse.json({ ...summary({ ...booking, status: 'cancelled' }), alreadyCancelled: true });
    }

    // Liberar el hueco en el calendario de la anfitriona.
    if (booking.calendarEventId) {
        // La reunion de Zoom/Meet creada para la cita se cancela en el proveedor (best-effort; el registro exige que sea de la anfitriona).
        const ev = await prisma.calendarEvent
            .findFirst({ where: { id: booking.calendarEventId }, select: { conferenceProvider: true, conferenceMeetingId: true } })
            .catch(() => null);
        if (ev?.conferenceMeetingId && isConferencingProviderId(ev.conferenceProvider)) {
            const host = booking.schedule.user;
            await deleteConferenceMeeting({ userId: host.id, email: host.email || null, domain: resolveDomain(req) }, ev.conferenceProvider, ev.conferenceMeetingId).catch(() => undefined);
        }
        await prisma.calendarEvent.deleteMany({ where: { id: booking.calendarEventId } }).catch((err) => {
            console.error('Could not delete calendar event for cancelled booking:', err);
        });
    }

    // Aviso a la anfitriona (mejor esfuerzo, sin bloquear la respuesta).
    const host = booking.schedule.user;
    if (host.email) {
        const emailHost = resolveEmailHost(req);
        const notify = async () => {
            // Mismo sistema de plantilla y marca que el resto de correos de citas; idioma: el de la empresa (o es).
            const brand = getEmailBrand(await fetchDomainEmailContext(emailHost));
            const locale = resolveEmailLocale({ brand, audience: 'user' });
            const options = hostCancellationOptions({
                guestName: booking.guestName,
                guestEmail: booking.guestEmail,
                scheduleName: booking.schedule.name,
                startsAt: booking.startsAt,
                endsAt: booking.endsAt,
                timezone: booking.schedule.timezone || 'UTC',
                brand,
                locale,
            });
            const { error } = await resend.emails.send({
                from: formatFromHeader(host.name, host.email as string),
                to: [host.email as string],
                subject: emailSubject(locale, 'hostCancellation', `${booking.guestName} — ${booking.schedule.name}`),
                html: buildEmailHtml(options),
                text: buildEmailText(options),
            });
            if (error) console.error('Cancellation notice failed:', error);
        };
        const safeNotify = () => notify().catch((err) => console.error('Cancellation notice failed:', err));
        try {
            after(safeNotify);
        } catch {
            void safeNotify();
        }
    }

    return NextResponse.json({ ...summary({ ...booking, status: 'cancelled' }), alreadyCancelled: false });
}
