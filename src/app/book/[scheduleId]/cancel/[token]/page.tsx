'use client';

import { use, useEffect, useState } from 'react';
import { CalendarX, Check, Loader2 } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { bookingErrorKey } from '@/lib/i18n/format';

type Summary = {
    id: string;
    status: string;
    scheduleName: string;
    hostName: string | null;
    guestName: string;
    startsAt: string;
    endsAt: string;
    timezone: string | null;
    alreadyCancelled?: boolean;
};

function formatWhen(iso: string, tz: string | null, locale: string) {
    try {
        return new Intl.DateTimeFormat(locale, {
            timeZone: tz || undefined,
            weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
        }).format(new Date(iso));
    } catch {
        return new Date(iso).toLocaleString(locale);
    }
}

// Pagina publica enlazada desde el correo de confirmacion: /book/<scheduleId>/cancel/<token>.
export default function CancelBookingPage({ params }: { params: Promise<{ scheduleId: string; token: string }> }) {
    const { scheduleId, token } = use(params);
    const { t, intlLocale } = useI18n();
    const [booking, setBooking] = useState<Summary | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [cancelling, setCancelling] = useState(false);
    const [done, setDone] = useState(false);

    const endpoint = `/api/appointments/book/${encodeURIComponent(scheduleId)}/cancel`;

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`${endpoint}?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
                const data = await res.json().catch(() => null);
                if (cancelled) return;
                // El texto de error del servidor no se muestra: el mensaje sale siempre en el idioma activo.
                if (!res.ok) {
                    const key = bookingErrorKey(res.status);
                    setError(t(key === 'book.errors.expired' || key === 'book.errors.rateLimited'
                        ? key
                        : res.status >= 500 ? 'book.cancel.loadFailed' : 'book.cancel.invalidLink'));
                }
                else {
                    setBooking(data);
                    if (data.status === 'cancelled') setDone(true);
                }
            } catch {
                if (!cancelled) setError(t('book.cancel.loadFailed'));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
        // t cambia con el idioma; recargar la cita por eso seria innecesario.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [endpoint, token]);

    const handleCancel = async () => {
        setCancelling(true);
        setError(null);
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                const key = bookingErrorKey(res.status);
                throw new Error(key === 'book.errors.expired' || key === 'book.errors.rateLimited' ? t(key) : t('book.cancel.cancelFailed'));
            }
            setBooking(data);
            setDone(true);
        } catch (e) {
            setError(e instanceof TypeError ? t('common.networkError') : (e instanceof Error ? e.message : t('book.cancel.cancelFailed')));
        } finally {
            setCancelling(false);
        }
    };

    return (
        <main className="min-h-screen flex items-center justify-center p-4 bg-background text-foreground">
            <div className="w-full max-w-md rounded-2xl border border-border bg-card text-card-foreground shadow-sm p-8">
                {loading ? (
                    <div className="flex justify-center py-8" role="status" aria-label={t('common.loading')}>
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : done && booking ? (
                    <div className="text-center">
                        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success text-success-foreground">
                            <Check className="h-7 w-7" strokeWidth={2.5} aria-hidden="true" />
                        </div>
                        <h1 className="text-xl font-bold mb-1">{t('book.cancel.doneTitle')}</h1>
                        <p className="text-sm text-muted-foreground">
                            {t('book.cancel.doneBody', { name: booking.scheduleName, when: formatWhen(booking.startsAt, booking.timezone, intlLocale) })}
                            {booking.hostName ? ` ${t('book.cancel.hostNotified', { host: booking.hostName })}` : ''}
                        </p>
                    </div>
                ) : booking ? (
                    <div>
                        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
                            <CalendarX className="h-7 w-7" aria-hidden="true" />
                        </div>
                        <h1 className="text-xl font-bold mb-1 text-center">{t('book.cancel.title')}</h1>
                        <div className="my-5 rounded-xl border border-border bg-muted/50 p-4 text-sm space-y-1">
                            <p className="font-semibold">{booking.scheduleName}</p>
                            {booking.hostName && <p className="text-muted-foreground">{t('book.cancel.with', { host: booking.hostName })}</p>}
                            <p className="text-muted-foreground">{formatWhen(booking.startsAt, booking.timezone, intlLocale)}</p>
                        </div>
                        {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
                        <button
                            type="button"
                            onClick={handleCancel}
                            disabled={cancelling}
                            className="w-full rounded-lg bg-destructive px-4 py-2.5 text-sm font-medium text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            {cancelling ? t('book.cancel.cancelling') : t('book.cancel.confirm')}
                        </button>
                        <p className="mt-3 text-center text-xs text-muted-foreground">{t('book.cancel.keepHint')}</p>
                    </div>
                ) : (
                    <div className="text-center">
                        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
                            <CalendarX className="h-7 w-7" aria-hidden="true" />
                        </div>
                        <h1 className="text-xl font-bold mb-1">{t('book.cancel.invalidTitle')}</h1>
                        <p role="alert" className="text-sm text-muted-foreground">{error || t('book.cancel.invalidLink')}</p>
                    </div>
                )}
            </div>
        </main>
    );
}
