'use client';

import { useEffect, useState, useCallback } from 'react';
import { use } from 'react';
import { Clock, Video, ChevronLeft, ChevronRight, Check, Loader2, Globe, CalendarDays } from 'lucide-react';
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
const DAY_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function fmt(iso: string, tz: string, opts: Intl.DateTimeFormatOptions) {
    return new Intl.DateTimeFormat(undefined, { timeZone: tz, ...opts }).format(new Date(iso));
}

function dateKey(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ─── Host header ─────────────────────────────────────────────────────────────

function HostHeader({ schedule }: { schedule: Schedule }) {
    const c = schedule.color;
    return (
        <div className="flex items-center gap-4 mb-8">
            {schedule.user.avatar ? (
                <img src={schedule.user.avatar} alt="" className="h-14 w-14 rounded-full object-cover ring-2 ring-offset-1 shrink-0" />
            ) : (
                <div className="h-14 w-14 rounded-full flex items-center justify-center text-white text-xl font-bold shrink-0" style={{ backgroundColor: c }}>
                    {(schedule.user.name || schedule.user.email)[0].toUpperCase()}
                </div>
            )}
            <div className="min-w-0">
                <p className="text-sm text-muted-foreground truncate">{schedule.user.name || schedule.user.email}</p>
                <h1 className="text-xl font-bold truncate">{schedule.name}</h1>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                    <span className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />{schedule.duration} min
                    </span>
                    {schedule.conferencing && (
                        <span className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Video className="h-3.5 w-3.5" />
                            {schedule.conferencing === 'meet' ? 'Google Meet' : 'Zoom'}
                        </span>
                    )}
                    <span className="flex items-center gap-1 text-xs text-muted-foreground/70">
                        <Globe className="h-3 w-3" />{schedule.timezone}
                    </span>
                </div>
                {schedule.description && (
                    <p className="text-sm text-muted-foreground mt-1">{schedule.description}</p>
                )}
            </div>
        </div>
    );
}

// ─── Month calendar ───────────────────────────────────────────────────────────

function MonthCalendar({
    year, month, onPrev, onNext, selectedDay, onSelectDay, availableDayNums, slotsCache, color,
}: {
    year: number; month: number; onPrev: () => void; onNext: () => void;
    selectedDay: string | null; onSelectDay: (key: string, date: Date) => void;
    availableDayNums: Set<number>; slotsCache: Record<string, string[]>; color: string;
}) {
    const today = new Date(); today.setHours(0,0,0,0);
    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month+1, 0).getDate();
    const cells: (Date|null)[] = [];
    for (let i=0; i<firstDow; i++) cells.push(null);
    for (let d=1; d<=daysInMonth; d++) cells.push(new Date(year, month, d));

    const todayKey = dateKey(today);

    return (
        <div>
            <div className="flex items-center justify-between mb-4">
                <button onClick={onPrev} className="p-1.5 rounded-full hover:bg-muted transition-colors">
                    <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="font-semibold text-sm">{MONTH_NAMES[month]} {year}</span>
                <button onClick={onNext} className="p-1.5 rounded-full hover:bg-muted transition-colors">
                    <ChevronRight className="h-4 w-4" />
                </button>
            </div>
            <div className="grid grid-cols-7 mb-1">
                {DAY_SHORT.map(d => (
                    <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
                ))}
            </div>
            <div className="grid grid-cols-7 gap-y-0.5">
                {cells.map((date, i) => {
                    if (!date) return <div key={`e${i}`} />;
                    const key = dateKey(date);
                    const isPast = date < today;
                    const isAvail = availableDayNums.has(date.getDay());
                    const hasSlots = slotsCache[key] && slotsCache[key].length > 0;
                    const disabled = isPast || !isAvail;
                    const isSelected = selectedDay === key;
                    const isToday = key === todayKey;

                    return (
                        <button
                            key={key}
                            onClick={() => !disabled && onSelectDay(key, date)}
                            disabled={disabled}
                            className="aspect-square rounded-full text-sm flex items-center justify-center mx-auto w-9 transition-all font-medium relative"
                            style={isSelected ? { backgroundColor: color, color: '#fff' }
                                : isToday ? { outline: `2px solid ${color}`, outlineOffset: -2, color }
                                : disabled ? {} : {}}
                        >
                            <span className={disabled ? 'text-muted-foreground/30' : isSelected ? '' : isToday ? '' : 'hover:bg-muted rounded-full w-full h-full flex items-center justify-center'}>
                                {date.getDate()}
                            </span>
                            {!disabled && hasSlots && !isSelected && (
                                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full" style={{ backgroundColor: color }} />
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Time slot picker ─────────────────────────────────────────────────────────

function SlotPicker({
    dayKey, slots, tz, color, onSelect,
}: {
    dayKey: string; slots: string[]; tz: string; color: string;
    onSelect: (iso: string) => void;
}) {
    const date = new Date(dayKey + 'T12:00:00');
    const label = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(date);

    if (slots.length === 0) return (
        <motion.div
            initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
            className="flex flex-col items-center justify-center py-16 text-muted-foreground text-sm gap-2"
        >
            <CalendarDays className="h-8 w-8 opacity-30" />
            No available slots on this day
        </motion.div>
    );

    return (
        <motion.div
            initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
        >
            <p className="text-sm font-semibold mb-3">{label}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
                {slots.map(iso => (
                    <button
                        key={iso}
                        onClick={() => onSelect(iso)}
                        className="rounded-xl border-2 py-2.5 text-sm font-medium transition-all hover:scale-[1.02] active:scale-[0.98]"
                        style={{ borderColor: color, color }}
                    >
                        {fmt(iso, tz, { hour: 'numeric', minute: '2-digit', hour12: true })}
                    </button>
                ))}
            </div>
        </motion.div>
    );
}

// ─── Booking form ─────────────────────────────────────────────────────────────

function BookingForm({
    slot, schedule, onBack, onConfirm, submitting,
}: {
    slot: string; schedule: Schedule; onBack: () => void;
    onConfirm: (name: string, email: string, notes: string) => void; submitting: boolean;
}) {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [notes, setNotes] = useState('');
    const c = schedule.color;
    const slotLabel = fmt(slot, schedule.timezone, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });

    const inputCls = "w-full rounded-xl border-2 border-muted px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)] transition-colors bg-background";

    return (
        <motion.div
            initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}
        >
            <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-5 transition-colors">
                <ChevronLeft className="h-4 w-4" /> Change time
            </button>

            {/* Selected slot summary */}
            <div className="rounded-2xl p-4 mb-6 text-sm" style={{ backgroundColor: `${c}12`, border: `1.5px solid ${c}30` }}>
                <p className="font-semibold" style={{ color: c }}>{schedule.name}</p>
                <p className="text-muted-foreground mt-0.5">{slotLabel}</p>
                <div className="flex items-center gap-3 mt-1.5 text-muted-foreground">
                    <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{schedule.duration} min</span>
                    {schedule.conferencing && (
                        <span className="flex items-center gap-1">
                            <Video className="h-3.5 w-3.5" />
                            {schedule.conferencing === 'meet' ? 'Google Meet' : 'Zoom'} link will be sent
                        </span>
                    )}
                </div>
            </div>

            <div className="space-y-4">
                <div className="space-y-1.5">
                    <label className="text-sm font-medium">Your name <span className="text-rose-500">*</span></label>
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="John Doe" className={inputCls} style={{'--accent': c} as any} />
                </div>
                <div className="space-y-1.5">
                    <label className="text-sm font-medium">Email address <span className="text-rose-500">*</span></label>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="john@example.com" className={inputCls} style={{'--accent': c} as any} />
                </div>
                <div className="space-y-1.5">
                    <label className="text-sm font-medium">Notes <span className="text-muted-foreground font-normal">(optional)</span></label>
                    <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                        placeholder="Anything you'd like to share before the meeting…"
                        className={`${inputCls} resize-none`} style={{'--accent': c} as any} />
                </div>
                <button
                    onClick={() => onConfirm(name, email, notes)}
                    disabled={!name.trim() || !email.includes('@') || submitting}
                    className="w-full rounded-xl py-3 text-sm font-semibold text-white flex items-center justify-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-40"
                    style={{ backgroundColor: c }}
                >
                    {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    {submitting ? 'Confirming…' : 'Confirm appointment'}
                </button>
            </div>
        </motion.div>
    );
}

// ─── Confirmation ─────────────────────────────────────────────────────────────

function Confirmed({ booking, schedule }: { booking: any; schedule: Schedule }) {
    const c = schedule.color;
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
            className="text-center py-6"
        >
            <div className="h-16 w-16 rounded-full flex items-center justify-center mx-auto mb-5" style={{ backgroundColor: c }}>
                <Check className="h-8 w-8 text-white" strokeWidth={3} />
            </div>
            <h2 className="text-2xl font-bold mb-1">Confirmed!</h2>
            <p className="text-muted-foreground text-sm mb-6">
                Your appointment with <span className="font-medium text-foreground">{schedule.user.name || schedule.user.email}</span> is booked.
            </p>

            <div className="rounded-2xl p-5 text-left space-y-3 mb-5 text-sm" style={{ backgroundColor: `${c}10`, border: `1.5px solid ${c}25` }}>
                <p className="font-semibold text-base">{schedule.name}</p>
                <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="h-4 w-4 shrink-0" />
                    {fmt(booking.startsAt, schedule.timezone, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="h-4 w-4 shrink-0 opacity-0" />
                    {schedule.duration} min
                </div>
                {booking.meetUrl && (
                    <div className="flex items-start gap-2">
                        <Video className="h-4 w-4 mt-0.5 shrink-0" style={{ color: c }} />
                        <a href={booking.meetUrl} target="_blank" rel="noopener noreferrer"
                            className="break-all font-medium hover:underline" style={{ color: c }}>
                            {booking.meetUrl}
                        </a>
                    </div>
                )}
            </div>

            <p className="text-xs text-muted-foreground">A confirmation email with a calendar invite has been sent to you.</p>
        </motion.div>
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

    const [step, setStep] = useState<'calendar' | 'form' | 'done'>('calendar');
    const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
    const [booking, setBooking] = useState<any>(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        fetch(`/api/appointments/schedules/${scheduleId}/public`)
            .then(r => r.ok ? r.json() : Promise.reject())
            .then(setSchedule)
            .catch(() => setError('This scheduling page is not available.'))
            .finally(() => setLoadingSchedule(false));
    }, [scheduleId]);

    // Prefetch slots for current month view (week by week)
    const prefetchMonth = useCallback(async (year: number, month: number) => {
        const starts = new Date(year, month, 1);
        const ends = new Date(year, month+1, 0);
        const promises: Promise<void>[] = [];

        let cursor = new Date(starts);
        cursor.setDate(cursor.getDate() - cursor.getDay()); // align to week start
        while (cursor <= ends) {
            const key = cursor.toISOString().split('T')[0];
            const c = new Date(cursor);
            promises.push(
                fetch(`/api/appointments/schedules/${scheduleId}/slots?date=${key}`)
                    .then(r => r.ok ? r.json() : null)
                    .then(data => {
                        if (data?.slots) setSlotsCache(prev => ({ ...prev, ...data.slots }));
                    })
            );
            cursor.setDate(cursor.getDate() + 7);
        }
        setLoadingSlots(true);
        await Promise.all(promises);
        setLoadingSlots(false);
    }, [scheduleId]);

    useEffect(() => {
        if (schedule) void prefetchMonth(calYear, calMonth);
    }, [schedule, calYear, calMonth, prefetchMonth]);

    const handleDaySelect = (key: string) => {
        setSelectedDayKey(key);
        setSelectedSlot(null);
    };

    const handleSlotSelect = (iso: string) => {
        setSelectedSlot(iso);
        setStep('form');
    };

    const handleConfirm = async (guestName: string, guestEmail: string, guestNotes: string) => {
        if (!selectedSlot || !schedule) return;
        setSubmitting(true);
        try {
            const res = await fetch(`/api/appointments/book/${scheduleId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ guestName, guestEmail, guestNotes, startsAt: selectedSlot }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Booking failed');
            setBooking(data);
            setStep('done');
        } catch (e: any) {
            alert(e.message);
        } finally {
            setSubmitting(false);
        }
    };

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

    const availableDayNums = new Set(schedule.availability.filter(a => a.isEnabled).map(a => a.dayOfWeek));
    const selectedDaySlots = selectedDayKey ? (slotsCache[selectedDayKey] || []) : [];
    const c = schedule.color;

    return (
        <div className="min-h-screen bg-muted/30 flex items-start justify-center py-10 px-4">
            <div className="w-full max-w-4xl">
                {/* Card */}
                <div className="bg-background rounded-3xl shadow-xl overflow-hidden">
                    {/* Colored top bar */}
                    <div className="h-1.5 w-full" style={{ backgroundColor: c }} />

                    <div className="p-6 sm:p-8">
                        <HostHeader schedule={schedule} />

                        <AnimatePresence mode="wait">
                            {step === 'done' && booking ? (
                                <Confirmed key="done" booking={booking} schedule={schedule} />
                            ) : step === 'form' && selectedSlot ? (
                                <BookingForm
                                    key="form"
                                    slot={selectedSlot}
                                    schedule={schedule}
                                    onBack={() => setStep('calendar')}
                                    onConfirm={handleConfirm}
                                    submitting={submitting}
                                />
                            ) : (
                                <motion.div
                                    key="calendar"
                                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                    className="grid grid-cols-1 md:grid-cols-2 gap-8"
                                >
                                    {/* Left: month calendar */}
                                    <div>
                                        {loadingSlots && (
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                                                <Loader2 className="h-3 w-3 animate-spin" /> Loading availability…
                                            </div>
                                        )}
                                        <MonthCalendar
                                            year={calYear}
                                            month={calMonth}
                                            onPrev={() => {
                                                if (calMonth === 0) { setCalMonth(11); setCalYear(y => y-1); }
                                                else setCalMonth(m => m-1);
                                            }}
                                            onNext={() => {
                                                if (calMonth === 11) { setCalMonth(0); setCalYear(y => y+1); }
                                                else setCalMonth(m => m+1);
                                            }}
                                            selectedDay={selectedDayKey}
                                            onSelectDay={(key) => handleDaySelect(key)}
                                            availableDayNums={availableDayNums}
                                            slotsCache={slotsCache}
                                            color={c}
                                        />
                                    </div>

                                    {/* Right: slots for selected day */}
                                    <div className="min-h-[200px] flex flex-col justify-start">
                                        <AnimatePresence mode="wait">
                                            {selectedDayKey ? (
                                                <SlotPicker
                                                    key={selectedDayKey}
                                                    dayKey={selectedDayKey}
                                                    slots={selectedDaySlots}
                                                    tz={schedule.timezone}
                                                    color={c}
                                                    onSelect={handleSlotSelect}
                                                />
                                            ) : (
                                                <motion.div
                                                    key="hint"
                                                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                                    className="flex flex-col items-center justify-center h-full py-12 text-muted-foreground/50 text-sm gap-2"
                                                >
                                                    <CalendarDays className="h-8 w-8" />
                                                    <p>Select a day to see available times</p>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>

                <p className="text-center text-xs text-muted-foreground mt-4">Powered by BloomX</p>
            </div>
        </div>
    );
}
