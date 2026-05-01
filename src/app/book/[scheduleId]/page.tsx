'use client';

import { useEffect, useState, useCallback } from 'react';
import { use } from 'react';
import { Clock, Video, ChevronLeft, ChevronRight, Check, Loader2, Globe, CalendarDays, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_SHORT = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function fmt(iso: string, tz: string, opts: Intl.DateTimeFormatOptions) {
    return new Intl.DateTimeFormat(undefined, { timeZone: tz, ...opts }).format(new Date(iso));
}
function dateKey(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function hexToRgb(hex: string) {
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return `${r},${g},${b}`;
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
    const today = new Date(); today.setHours(0,0,0,0);
    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month+1, 0).getDate();
    const cells: (Date|null)[] = [];
    for (let i=0; i<firstDow; i++) cells.push(null);
    for (let d=1; d<=daysInMonth; d++) cells.push(new Date(year, month, d));
    const todayKey = dateKey(today);
    const rgb = hexToRgb(color);

    return (
        <div>
            <div className="flex items-center justify-between mb-4">
                <button onClick={onPrev} className="p-1.5 rounded-full transition-colors hover:bg-white/20">
                    <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="font-semibold text-sm">{MONTH_NAMES[month]} {year}</span>
                <button onClick={onNext} className="p-1.5 rounded-full transition-colors hover:bg-white/20">
                    <ChevronRight className="h-4 w-4" />
                </button>
            </div>
            <div className="grid grid-cols-7 mb-1">
                {DAY_SHORT.map(d => (
                    <div key={d} className="text-center text-xs font-medium py-1 opacity-60">{d}</div>
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
                            key={key}
                            onClick={() => !disabled && onSelectDay(key)}
                            disabled={disabled}
                            className="aspect-square rounded-full text-sm flex items-center justify-center mx-auto w-8 relative transition-all font-medium"
                            style={isSelected
                                ? { backgroundColor: '#fff', color: color }
                                : isToday
                                ? { outline: `2px solid rgba(255,255,255,0.7)`, outlineOffset: -2 }
                                : disabled ? { opacity: 0.25 }
                                : { cursor: 'pointer' }
                            }
                        >
                            {date.getDate()}
                            {!disabled && hasSlots && !isSelected && (
                                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-white/60" />
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
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [booking, setBooking] = useState<any>(null);
    const c = schedule.color;

    const slotLabel = fmt(slot, schedule.timezone, {
        weekday: 'long', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
    });

    const inputCls = `w-full rounded-xl px-3 py-2.5 text-sm outline-none transition-colors border bg-background focus:ring-2`;

    const handleSubmit = async () => {
        setSubmitting(true);
        try {
            const res = await fetch(`/api/appointments/book/${schedule.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ guestName: name, guestEmail: email, guestNotes: notes, startsAt: slot }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Booking failed');
            setBooking(data);
        } catch (e: any) {
            alert(e.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ duration: 0.18 }}
                className="w-full max-w-md bg-background rounded-2xl shadow-2xl overflow-hidden"
            >
                <AnimatePresence mode="wait">
                    {booking ? (
                        /* ── Confirmation ── */
                        <motion.div key="confirmed"
                            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                            className="p-8 text-center"
                        >
                            <div className="h-14 w-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: c }}>
                                <Check className="h-7 w-7 text-white" strokeWidth={2.5} />
                            </div>
                            <h2 className="text-xl font-bold mb-1">Confirmed!</h2>
                            <p className="text-sm text-muted-foreground mb-6">
                                Your appointment with <span className="font-medium text-foreground">{schedule.user.name || schedule.user.email}</span> is booked.
                            </p>
                            <div className="rounded-xl p-4 text-left space-y-2.5 mb-5 text-sm"
                                style={{ backgroundColor: `${c}10`, border: `1.5px solid ${c}30` }}>
                                <p className="font-semibold">{schedule.name}</p>
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <Clock className="h-3.5 w-3.5 shrink-0" style={{ color: c }} />
                                    {fmt(booking.startsAt, schedule.timezone, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                                </div>
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <Clock className="h-3.5 w-3.5 shrink-0 opacity-0" />
                                    {schedule.duration} min
                                </div>
                                {booking.meetUrl && (
                                    <div className="flex items-start gap-2">
                                        <Video className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: c }} />
                                        <a href={booking.meetUrl} target="_blank" rel="noopener noreferrer"
                                            className="break-all font-medium hover:underline text-xs" style={{ color: c }}>
                                            {booking.meetUrl}
                                        </a>
                                    </div>
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground mb-5">A confirmation email with a calendar invite has been sent to you.</p>
                            <button onClick={onClose}
                                className="w-full rounded-xl py-2.5 text-sm font-semibold text-white"
                                style={{ backgroundColor: c }}>
                                Done
                            </button>
                        </motion.div>
                    ) : (
                        /* ── Booking form ── */
                        <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                            {/* Modal header */}
                            <div className="flex items-center justify-between px-5 py-4 border-b">
                                <div>
                                    <p className="font-semibold text-sm">{schedule.name}</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">{slotLabel}</p>
                                </div>
                                <button onClick={onClose}
                                    className="p-1.5 rounded-full hover:bg-muted text-muted-foreground transition-colors">
                                    <X className="h-4 w-4" />
                                </button>
                            </div>

                            {/* Slot summary */}
                            <div className="mx-5 mt-4 rounded-xl px-4 py-3 flex items-center gap-3"
                                style={{ backgroundColor: `${c}12` }}>
                                <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
                                    style={{ backgroundColor: c }}>
                                    <Clock className="h-4 w-4 text-white" />
                                </div>
                                <div className="text-sm">
                                    <span className="font-medium" style={{ color: c }}>{schedule.duration} min</span>
                                    {schedule.conferencing && (
                                        <span className="text-muted-foreground"> · {schedule.conferencing === 'meet' ? 'Google Meet link will be sent' : 'Zoom link will be sent'}</span>
                                    )}
                                </div>
                            </div>

                            {/* Form */}
                            <div className="px-5 py-4 space-y-3.5">
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your name <span className="text-rose-500">*</span></label>
                                    <input value={name} onChange={e => setName(e.target.value)}
                                        placeholder="John Doe"
                                        className={inputCls}
                                        style={{ '--tw-ring-color': c } as any} />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Email <span className="text-rose-500">*</span></label>
                                    <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                                        placeholder="john@example.com"
                                        className={inputCls}
                                        style={{ '--tw-ring-color': c } as any} />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notes <span className="text-muted-foreground font-normal normal-case">(optional)</span></label>
                                    <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                                        placeholder="Anything you'd like to share…"
                                        className={`${inputCls} resize-none`}
                                        style={{ '--tw-ring-color': c } as any} />
                                </div>
                            </div>

                            <div className="px-5 pb-5">
                                <button
                                    onClick={handleSubmit}
                                    disabled={!name.trim() || !email.includes('@') || submitting}
                                    className="w-full rounded-xl py-3 text-sm font-semibold text-white flex items-center justify-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-40"
                                    style={{ backgroundColor: c }}>
                                    {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                                    {submitting ? 'Confirming…' : 'Confirm appointment'}
                                </button>
                            </div>
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

    useEffect(() => {
        fetch(`/api/appointments/schedules/${scheduleId}/public`)
            .then(r => r.ok ? r.json() : Promise.reject())
            .then(setSchedule)
            .catch(() => setError('This scheduling page is not available.'))
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
        <div className="min-h-screen flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
    );
    if (error || !schedule) return (
        <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
            {error || 'Schedule not found.'}
        </div>
    );

    const c = schedule.color;
    const rgb = hexToRgb(c);
    const availableDayNums = new Set(schedule.availability.filter(a => a.isEnabled).map(a => a.dayOfWeek));
    const selectedDaySlots = selectedDayKey ? (slotsCache[selectedDayKey] || []) : [];

    const selectedDayLabel = selectedDayKey
        ? new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
            .format(new Date(selectedDayKey + 'T12:00:00'))
        : null;

    return (
        <div className="min-h-screen bg-muted/20 flex items-center justify-center py-8 px-4">
            <div className="w-full max-w-3xl">
                <div className="bg-background rounded-3xl shadow-xl overflow-hidden">
                    <div className="grid grid-cols-1 md:grid-cols-[300px_1fr]">

                        {/* ── Left panel ── */}
                        <div className="p-7 flex flex-col gap-6" style={{ backgroundColor: `rgba(${rgb},0.08)`, borderRight: `1px solid rgba(${rgb},0.15)` }}>
                            {/* Avatar + host */}
                            <div className="flex items-center gap-3">
                                {schedule.user.avatar ? (
                                    <img src={schedule.user.avatar} alt="" className="h-11 w-11 rounded-full object-cover shrink-0" />
                                ) : (
                                    <div className="h-11 w-11 rounded-full flex items-center justify-center text-white text-base font-bold shrink-0"
                                        style={{ backgroundColor: c }}>
                                        {(schedule.user.name || schedule.user.email)[0].toUpperCase()}
                                    </div>
                                )}
                                <div className="min-w-0">
                                    <p className="text-xs text-muted-foreground truncate">{schedule.user.name || schedule.user.email}</p>
                                    <p className="font-semibold text-sm truncate leading-tight">{schedule.name}</p>
                                </div>
                            </div>

                            {/* Meta */}
                            <div className="space-y-2">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Clock className="h-4 w-4 shrink-0" style={{ color: c }} />
                                    {schedule.duration} min
                                </div>
                                {schedule.conferencing && (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Video className="h-4 w-4 shrink-0" style={{ color: c }} />
                                        {schedule.conferencing === 'meet' ? 'Google Meet' : 'Zoom'} · Video call
                                    </div>
                                )}
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <Globe className="h-3.5 w-3.5 shrink-0" style={{ color: c }} />
                                    {schedule.timezone}
                                </div>
                            </div>

                            {schedule.description && (
                                <p className="text-xs text-muted-foreground leading-relaxed">{schedule.description}</p>
                            )}

                            {/* Calendar */}
                            <div>
                                {loadingSlots && (
                                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
                                        <Loader2 className="h-3 w-3 animate-spin" /> Loading…
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
                                    color={c}
                                />
                            </div>
                        </div>

                        {/* ── Right panel: slots ── */}
                        <div className="p-7 flex flex-col min-h-[420px]">
                            <AnimatePresence mode="wait">
                                {selectedDayKey ? (
                                    <motion.div key={selectedDayKey}
                                        initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}>
                                        <p className="text-sm font-semibold mb-4">{selectedDayLabel}</p>
                                        {selectedDaySlots.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-sm gap-2">
                                                <CalendarDays className="h-7 w-7 opacity-30" />
                                                No available times on this day
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-2 gap-2 max-h-[360px] overflow-y-auto pr-1">
                                                {selectedDaySlots.map(iso => (
                                                    <button
                                                        key={iso}
                                                        onClick={() => setModalSlot(iso)}
                                                        className="rounded-xl py-2.5 text-sm font-medium transition-all hover:opacity-90 active:scale-95"
                                                        style={{ backgroundColor: `${c}15`, color: c }}
                                                    >
                                                        {fmt(iso, schedule.timezone, { hour: 'numeric', minute: '2-digit', hour12: true })}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </motion.div>
                                ) : (
                                    <motion.div key="hint"
                                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                        className="flex flex-col items-center justify-center flex-1 text-muted-foreground/40 gap-3">
                                        <CalendarDays className="h-10 w-10" />
                                        <p className="text-sm">Select a day to see available times</p>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>
                </div>
                <p className="text-center text-xs text-muted-foreground mt-4 opacity-50">Powered by BloomX</p>
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
