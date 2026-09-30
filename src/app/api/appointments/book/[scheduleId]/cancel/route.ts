import { NextRequest, NextResponse, after } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resend } from '@/lib/resend';
import { verifyCancelToken } from '@/lib/appointments/cancel-token';
import { escapeHtmlText, formatFromHeader } from '@/lib/mail-validation';
import { getClientIp, rateLimit, safeEqual } from '@/lib/security';

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

    const limit = rateLimit(`cancel-get-ip:${getClientIp(req)}`, 60, 60 * 60 * 1000);
    if (!limit.ok) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } });
    }

    const result = await resolveBooking(scheduleId, req.nextUrl.searchParams.get('token'));
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(summary(result.booking), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ scheduleId: string }> }) {
    const { scheduleId } = await params;

    const limit = rateLimit(`cancel-post-ip:${getClientIp(req)}`, 20, 60 * 60 * 1000);
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
        await prisma.calendarEvent.deleteMany({ where: { id: booking.calendarEventId } }).catch((err) => {
            console.error('Could not delete calendar event for cancelled booking:', err);
        });
    }

    // Aviso a la anfitriona (mejor esfuerzo, sin bloquear la respuesta).
    const host = booking.schedule.user;
    if (host.email) {
        const notify = async () => {
            const when = new Intl.DateTimeFormat('en-US', {
                timeZone: booking.schedule.timezone || 'UTC', weekday: 'short', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
            }).format(booking.startsAt);
            const { error } = await resend.emails.send({
                from: formatFromHeader(host.name, host.email as string),
                to: [host.email as string],
                subject: `Cancelled: ${booking.guestName} — ${booking.schedule.name}`,
                html: `<p><strong>${escapeHtmlText(booking.guestName)}</strong> (${escapeHtmlText(booking.guestEmail)}) cancelled their appointment <strong>${escapeHtmlText(booking.schedule.name)}</strong> scheduled for ${escapeHtmlText(when)}.</p>`,
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
