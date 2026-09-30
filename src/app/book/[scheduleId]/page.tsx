'use client';

import { useEffect, useState, useCallback, useId, useMemo } from 'react';
import { use } from 'react';
import { Clock, Video, ChevronLeft, ChevronRight, Check, Loader2, Globe, CalendarDays, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useI18n } from '@/components/I18nProvider';
import { useDialog } from '@/components/ui/useDialog';
import { useSurfaceColors } from '@/hooks/useSurfaceColors';
import { agendaAccentText, agendaSoft, agendaTextOn, agendaTint, safeAgendaColor } from '@/lib/agenda-color';
import { bookingErrorKey } from '@/lib/i18n/format';

type Availability = { dayOfWeek: number; startTime: string; endTime: string; isEnabled: boolean };
type Schedule = {
    id: string;
    name: string;
    description?: string | null;
    duration: number;
    color: string;
    timezone: string;
    conferencing?: string | null;
    availability: Availability[];
    user: { name?: string | null; email: string; avatar?: string | null };
};

function fmt(iso: string, tz: string, opts: Intl.DateTimeFormatOptions, locale?: string) {
    return new Intl.DateTimeFormat(locale, { timeZone: tz, ...opts }).format(new Date(iso));
}
function dateKey(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/**
 * El color del horario lo elige el anfitrion: nunca se asume que el blanco se lee encima.
 *  - solid: relleno del color + texto legible (agendaTextOn)
 *  - accent: el color usado COMO TEXTO/ICONO, corregido para leerse sobre el fondo y la tarjeta del tema
 */
function useAgendaPalette(color: string) {
    const surface = useSurfaceColors();
    return useMemo(() => {
        const solid = safeAgendaColor(color);
        return {
            solid,
            onSolid: agendaTextOn(solid),
            accent: agendaAccentText(solid, [surface.background, surface.card]),
            soft: agendaSoft(solid, surface.background, 0.1),
            panel: agendaTint(solid, surface.background, 0.08),
            panelBorder: agendaTint(solid, surface.background, 0.16),
            surface,
        };
    }, [color, surface]);
}

// ─── Month calendar ───────────────────────────────────────────────────────────

function MonthCalendar({
    year, month, onPrev, onNext, selectedDay, onSelectDay,
    availableDayNums, slotsCache, color,
}: {
    year: number; month: number; onPrev: () => void; onNext: () => void;
    selectedDay: string | null; onSelectDay: (key: string) => void;
    availableDayNums: Set<number>; slotsCache: Record<string, string[]>; color: string;
}) {
    const { t, intlLocale } = useI18n();
    const pal = useAgendaPalette(color);
    const today = new Date(); today.setHours(0,0,0,0);
    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month+1, 0).getDate();
    const cells: (Date|null)[] = [];
    for (let i=0; i<firstDow; i++) cells.push(null);
    for (let d=1; d<=daysInMonth; d++) cells.push(new Date(year, month, d));
    const todayKey = dateKey(today);
    const dayShort = t('book.weekdaysShort').split(',');
    const monthLabel = new Intl.DateTimeFormat(intlLocale, { month: 'long', year: 'numeric' }).format(new Date(year, month, 1));
    const dayLabel = new Intl.DateTimeFormat(intlLocale, { weekday: 'long', month: 'long', day: 'numeric' });

    return (
        <div>
            <div className="flex items-center justify-between mb-4">
                <button type="button" onClick={onPrev} aria-label={t('book.prevMonth')} className="p-2 rounded-full transition-colors hover:bg-foreground/10">
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                <span className="font-semibold text-sm capitalize" aria-live="polite">{monthLabel}</span>
                <button type="button" onClick={onNext} aria-label={t('book.nextMonth')} className="p-2 rounded-full transition-colors hover:bg-foreground/10">
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
            </div>
            <div className="grid grid-cols-7 mb-1" aria-hidden="true">
                {dayShort.map((d, i) => (
                    <div key={i} className="text-center text-xs font-medium py-1 text-muted-foreground">{d}</div>
                ))}
            </div>
            <div className="grid grid-cols-7 gap-y-1">
                {cells.map((date, i) => {
                    if (!date) return <div key={`e${i}`} />;
                    const key = dateKey(date);
                    const isPast = date < today;
                    const isAvail = availableDayNums.has(date.getDay());
                    const hasSlots = !!slotsCache[key]?.length;
                    const disabled = isPast || !isAvail;
                    const isSelected = selectedDay === key;
                    const isToday = key === todayKey;

                    return (
                        <button
                            type="button"
                            key={key}
                            onClick={() => !disabled && onSelectDay(key)}
                            disabled={disabled}
                            aria-label={dayLabel.format(date)}
                            aria-pressed={isSelected}
                            aria-current={isToday ? 'date' : undefined}
                            className="aspect-square rounded-full text-sm flex items-center justify-center mx-auto w-9 relative transition-all font-medium disabled:cursor-not-allowed"
                            style={isSelected
                                ? { backgroundColor: pal.solid, color: pal.onSolid }
                                : isToday
                                ? { outline: `2px solid ${pal.accent}`, outlineOffset: -2 }
                                : disabled ? { opacity: 0.35 }
                                : { cursor: 'pointer' }
                            }
                        >
                            {date.getDate()}
                            {!disabled && hasSlots && !isSelected && (
                                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full" style={{ backgroundColor: pal.accent }} aria-hidden="true" />
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Booking modal ─────────────────────────────────────────────────────────────

function BookingModal({
    slot, schedule, onClose, onConfirmed,
}: {
    slot: string; schedule: Schedule;
    onClose: () => void; onConfirmed: (booking: any) => void;
}) {
    const { t, intlLocale } = useI18n();
    const uid = useId();
    const { ref: dialogRef, titleId } = useDialog<HTMLDivElement>(true, onClose);
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [booking, setBooking] = useState<any>(null);
    const [error, setError] = useState('');
    const pal = useAgendaPalette(schedule.color);

    const slotLabel = fmt(slot, schedule.timezone, {
        weekday: 'long', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
    }, intlLocale);

    const inputCls = `w-full rounded-xl px-3.5 py-2.5 text-sm outline-none transition-all bg-muted hover:bg-muted/70 focus:bg-background border border-transparent focus:border-input focus:ring-2 focus:ring-offset-0`;
    const ringStyle = { '--tw-ring-color': pal.accent } as React.CSSProperties;

    const handleSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        setSubmitting(true);
        setError('');
        try {
            const res = await fetch(`/api/appointments/book/${schedule.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ guestName: name, guestEmail: email, guestNotes: notes, startsAt: slot }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data) throw new Error(t(bookingErrorKey(res.status)));
            setBooking(data);
            onConfirmed(data);
        } catch (err: any) {
            // Errores de red (TypeError) -> mensaje generico traducido; los nuestros ya vienen traducidos.
            setError(err instanceof TypeError ? t('common.networkError') : (err?.message || t('book.failed')));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div aria-hidden="true" className="absolute inset-0 bg-black/50 backdrop-blur-sm" onMouseDown={onClose} />
            <motion.div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ duration: 0.18 }}
                className="relative w-full max-w-md bg-background text-foreground rounded-2xl shadow-2xl overflow-hidden outline-none max-h-[95dvh] overflow-y-auto"
            >
                <AnimatePresence mode="wait">
                    {booking ? (
                        /* ── Confirmation ── */
                        <motion.div key="confirmed"
                            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                            className="p-8 text-center"
                        >
                            <div className="h-14 w-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: pal.solid, color: pal.onSolid }}>
                                <Check className="h-7 w-7" strokeWidth={2.5} aria-hidden="true" />
                            </div>
                            <h2 id={titleId} className="text-xl font-bold mb-1">{t('book.confirmed')}</h2>
                            <p className="text-sm text-muted-foreground mb-6" role="status">
                                {t('book.bookedWith', { name: schedule.user.name || schedule.user.email })}
                            </p>
                            <div className="rounded-xl p-4 text-left space-y-2.5 mb-5 text-sm"
                                style={{ backgroundColor: pal.soft.background, border: `1.5px solid ${pal.soft.border}` }}>
                                <p className="font-semibold">{schedule.name}</p>
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <Clock className="h-3.5 w-3.5 shrink-0" style={{ color: pal.accent }} aria-hidden="true" />
                                    {fmt(booking.startsAt, schedule.timezone, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }, intlLocale)}
                                </div>
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <Clock className="h-3.5 w-3.5 shrink-0 opacity-0" aria-hidden="true" />
                                    {t('book.minutes', { n: schedule.duration })}
                                </div>
                                {booking.meetUrl && (
                                    <div className="flex items-start gap-2">
                                        <Video className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: pal.accent }} aria-hidden="true" />
                                        <a href={booking.meetUrl} target="_blank" rel="noopener noreferrer"
                                            className="break-all font-medium hover:underline text-xs" style={{ color: pal.accent }}>
                                            {booking.meetUrl}
                                        </a>
                                    </div>
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground mb-5">{t('book.confirmationEmail')}</p>
                            <button type="button" onClick={onClose}
                                className="w-full rounded-xl py-2.5 text-sm font-semibold"
                                style={{ backgroundColor: pal.solid, color: pal.onSolid }}>
                                {t('book.done')}
                            </button>
                        </motion.div>
                    ) : (
                        /* ── Booking form ── */
                        <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                            {/* Modal header */}
                            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                                <div>
                                    <h2 id={titleId} className="font-semibold text-sm">{schedule.name}</h2>
                                    <p className="text-xs text-muted-foreground mt-0.5 first-letter:uppercase">{slotLabel}</p>
                                </div>
                                <button type="button" onClick={onClose} aria-label={t('book.closeDialog')}
                                    className="p-2 rounded-full hover:bg-muted text-muted-foreground transition-colors">
                                    <X className="h-4 w-4" aria-hidden="true" />
                                </button>
                            </div>

                            {/* Slot summary */}
                            <div className="mx-5 mt-4 rounded-xl px-4 py-3 flex items-center gap-3"
                                style={{ backgroundColor: pal.soft.background }}>
                                <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
                                    style={{ backgroundColor: pal.solid, color: pal.onSolid }}>
                                    <Clock className="h-4 w-4" aria-hidden="true" />
                                </div>
                                <div className="text-sm">
                                    <span className="font-medium" style={{ color: pal.soft.foreground }}>{t('book.minutes', { n: schedule.duration })}</span>
                                    {schedule.conferencing && (
                                        <span className="text-muted-foreground"> · {schedule.conferencing === 'meet' ? t('book.meetWillBeSent') : t('book.zoomWillBeSent')}</span>
                                    )}
                                </div>
                            </div>

                            {/* Form */}
                            <form onSubmit={handleSubmit} noValidate>
                                <div className="px-5 py-4 space-y-3.5">
                                    <div className="space-y-1">
                                        <label htmlFor={`${uid}-name`} className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('book.yourName')} <span className="text-destructive" aria-hidden="true">*</span></label>
                                        <input id={`${uid}-name`} value={name} onChange={e => setName(e.target.value)}
                                            required aria-required="true" autoComplete="name"
                                            placeholder={t('book.namePlaceholder')}
                                            className={inputCls}
                                            style={ringStyle} />
                                    </div>
                                    <div className="space-y-1">
                                        <label htmlFor={`${uid}-email`} className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('book.email')} <span className="text-destructive" aria-hidden="true">*</span></label>
                                        <input id={`${uid}-email`} type="email" value={email} onChange={e => setEmail(e.target.value)}
                                            required aria-required="true" autoComplete="email"
                                            placeholder={t('book.emailPlaceholder')}
                                            className={inputCls}
                                            style={ringStyle} />
                                    </div>
                                    <div className="space-y-1">
                                        <label htmlFor={`${uid}-notes`} className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('book.notes')} <span className="text-muted-foreground font-normal normal-case">{t('book.optional')}</span></label>
                                        <textarea id={`${uid}-notes`} value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                                            placeholder={t('book.notesPlaceholder')}
                                            className={`${inputCls} resize-none`}
                                            style={ringStyle} />
                                    </div>
                                    {error && (
                                        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
                                    )}
                                </div>

                                <div className="px-5 pb-5">
                                    <button
                                        type="submit"
                                        disabled={!name.trim() || !email.includes('@') || submitting}
                                        className="w-full rounded-xl py-3 text-sm font-semibold flex items-center justify-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-50"
                                        style={{ backgroundColor: pal.solid, color: pal.onSolid }}>
                                        {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                                        {submitting ? t('book.confirming') : t('book.confirm')}
                                    </button>
                                </div>
                            </form>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
        </div>
    );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BookingPage({ params }: { params: Promise<{ scheduleId: string }> }) {
    const { scheduleId } = use(params);
    const { t, intlLocale } = useI18n();
    const [schedule, setSchedule] = useState<Schedule | null>(null);
    const [loadingSchedule, setLoadingSchedule] = useState(true);
    const [error, setError] = useState('');

    const today = new Date(); today.setHours(0,0,0,0);
    const [calYear, setCalYear] = useState(today.getFullYear());
    const [calMonth, setCalMonth] = useState(today.getMonth());
    const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
    const [slotsCache, setSlotsCache] = useState<Record<string, string[]>>({});
    const [loadingSlots, setLoadingSlots] = useState(false);
    const [modalSlot, setModalSlot] = useState<string | null>(null);
    const pal = useAgendaPalette(schedule?.color ?? '');

    useEffect(() => {
        fetch(`/api/appointments/schedules/${scheduleId}/public`)
            .then(r => r.ok ? r.json() : Promise.reject())
            .then(setSchedule)
            .catch(() => setError('unavailable'))
            .finally(() => setLoadingSchedule(false));
    }, [scheduleId]);

    const prefetchMonth = useCallback(async (year: number, month: number) => {
        const starts = new Date(year, month, 1);
        const ends = new Date(year, month+1, 0);
        const promises: Promise<void>[] = [];
        let cursor = new Date(starts);
        cursor.setDate(cursor.getDate() - cursor.getDay());
        while (cursor <= ends) {
            const key = cursor.toISOString().split('T')[0];
            promises.push(
                fetch(`/api/appointments/schedules/${scheduleId}/slots?date=${key}`)
                    .then(r => r.ok ? r.json() : null)
                    .then(data => { if (data?.slots) setSlotsCache(prev => ({ ...prev, ...data.slots })); })
            );
            cursor.setDate(cursor.getDate() + 7);
        }
        setLoadingSlots(true);
        await Promise.all(promises);
        setLoadingSlots(false);
    }, [scheduleId]);

    useEffect(() => { if (schedule) void prefetchMonth(calYear, calMonth); }, [schedule, calYear, calMonth, prefetchMonth]);

    if (loadingSchedule) return (
        <div className="min-h-screen flex items-center justify-center" role="status" aria-label={t('common.loading')}>
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
    );
    if (error || !schedule) return (
        <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm" role="alert">
            {error ? t('book.unavailable') : t('book.notFound')}
        </div>
    );

    const availableDayNums = new Set(schedule.availability.filter(a => a.isEnabled).map(a => a.dayOfWeek));
    const selectedDaySlots = selectedDayKey ? (slotsCache[selectedDayKey] || []) : [];

    const selectedDayLabel = selectedDayKey
        ? new Intl.DateTimeFormat(intlLocale, { weekday: 'long', month: 'long', day: 'numeric' })
            .format(new Date(selectedDayKey + 'T12:00:00'))
        : null;

    return (
        <div className="min-h-screen bg-muted/40 flex items-center justify-center py-8 px-4">
            <div className="w-full max-w-3xl">
                <div className="bg-background rounded-3xl shadow-xl overflow-hidden">
                    <div className="grid grid-cols-1 md:grid-cols-[300px_1fr]">

                        {/* ── Left panel ── */}
                        <div className="p-7 flex flex-col gap-6" style={{ backgroundColor: pal.panel, borderRight: `1px solid ${pal.panelBorder}` }}>
                            {/* Avatar + host */}
                            <div className="flex items-center gap-3">
                                {schedule.user.avatar ? (
                                    <img src={schedule.user.avatar} alt="" className="h-11 w-11 rounded-full object-cover shrink-0" />
                                ) : (
                                    <div className="h-11 w-11 rounded-full flex items-center justify-center text-base font-bold shrink-0"
                                        style={{ backgroundColor: pal.solid, color: pal.onSolid }} aria-hidden="true">
                                        {(schedule.user.name || schedule.user.email)[0].toUpperCase()}
                                    </div>
                                )}
                                <div className="min-w-0">
                                    <p className="text-xs text-muted-foreground truncate">{schedule.user.name || schedule.user.email}</p>
                                    <h1 className="font-semibold text-sm truncate leading-tight">{schedule.name}</h1>
                                </div>
                            </div>

                            {/* Meta */}
                            <div className="space-y-2">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Clock className="h-4 w-4 shrink-0" style={{ color: pal.accent }} aria-hidden="true" />
                                    {t('book.minutes', { n: schedule.duration })}
                                </div>
                                {schedule.conferencing && (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Video className="h-4 w-4 shrink-0" style={{ color: pal.accent }} aria-hidden="true" />
                                        {schedule.conferencing === 'meet' ? 'Google Meet' : 'Zoom'} · {t('book.videoCall')}
                                    </div>
                                )}
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <Globe className="h-3.5 w-3.5 shrink-0" style={{ color: pal.accent }} aria-hidden="true" />
                                    {schedule.timezone}
                                </div>
                            </div>

                            {schedule.description && (
                                <p className="text-xs text-muted-foreground leading-relaxed">{schedule.description}</p>
                            )}

                            {/* Calendar */}
                            <div>
                                {loadingSlots && (
                                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3" role="status">
                                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> {t('book.loading')}
                                    </div>
                                )}
                                <MonthCalendar
                                    year={calYear} month={calMonth}
                                    onPrev={() => { if (calMonth === 0) { setCalMonth(11); setCalYear(y=>y-1); } else setCalMonth(m=>m-1); }}
                                    onNext={() => { if (calMonth === 11) { setCalMonth(0); setCalYear(y=>y+1); } else setCalMonth(m=>m+1); }}
                                    selectedDay={selectedDayKey}
                                    onSelectDay={setSelectedDayKey}
                                    availableDayNums={availableDayNums}
                                    slotsCache={slotsCache}
                                    color={schedule.color}
                                />
                            </div>
                        </div>

                        {/* ── Right panel: slots ── */}
                        <div className="p-7 flex flex-col min-h-[420px]">
                            <AnimatePresence mode="wait">
                                {selectedDayKey ? (
                                    <motion.div key={selectedDayKey}
                                        initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}>
                                        <h2 className="text-sm font-semibold mb-4 first-letter:uppercase">{selectedDayLabel}</h2>
                                        {selectedDaySlots.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-sm gap-2">
                                                <CalendarDays className="h-7 w-7 opacity-60" aria-hidden="true" />
                                                {t('book.noTimes')}
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-2 gap-2 max-h-[360px] overflow-y-auto pr-1">
                                                {selectedDaySlots.map(iso => (
                                                    <button
                                                        type="button"
                                                        key={iso}
                                                        onClick={() => setModalSlot(iso)}
                                                        className="rounded-xl py-2.5 text-sm font-medium transition-all hover:opacity-90 active:scale-95 border"
                                                        style={{ backgroundColor: pal.soft.background, color: pal.soft.foreground, borderColor: pal.soft.border }}
                                                    >
                                                        {fmt(iso, schedule.timezone, { hour: 'numeric', minute: '2-digit' }, intlLocale)}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </motion.div>
                                ) : (
                                    <motion.div key="hint"
                                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                        className="flex flex-col items-center justify-center flex-1 text-muted-foreground gap-3">
                                        <CalendarDays className="h-10 w-10 opacity-60" aria-hidden="true" />
                                        <p className="text-sm">{t('book.selectDay')}</p>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>
                </div>
                <p className="text-center text-xs text-muted-foreground mt-4">{t('book.poweredBy')}</p>
            </div>

            {/* Booking modal */}
            <AnimatePresence>
                {modalSlot && (
                    <BookingModal
                        key="modal"
                        slot={modalSlot}
                        schedule={schedule}
                        onClose={() => setModalSlot(null)}
                        onConfirmed={() => {}}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
