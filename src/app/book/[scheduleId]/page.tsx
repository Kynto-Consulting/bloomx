'use client';

import { useEffect, useState, useCallback } from 'react';
import { use } from 'react';
import { Clock, MapPin, Video, ChevronLeft, ChevronRight, Check, Loader2, Calendar } from 'lucide-react';
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
const DAY_NAMES_SHORT = ['Su','Mo','Tu','We','Th','Fr','Sa'];
const DAY_COLS = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

function formatSlotTime(iso: string, tz: string) {
    return new Intl.DateTimeFormat(undefined, {
        timeZone: tz,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    }).format(new Date(iso));
}

function formatDateKey(date: Date, tz: string) {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function formatDateHeader(date: Date, tz: string) {
    return new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: 'short', day: 'numeric' }).format(date);
}

function formatConfirmDate(iso: string, tz: string) {
    return new Intl.DateTimeFormat(undefined, {
        timeZone: tz,
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date(iso));
}

function getDayOfWeekInTz(date: Date, tz: string): number {
    const label = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(date);
    return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(label);
}

function MiniCalendar({
    year, month, selectedDate, onSelect, availableDays, tz
}: {
    year: number; month: number; selectedDate: Date | null;
    onSelect: (d: Date) => void; availableDays: Set<string>; tz: string;
}) {
    const firstDay = new Date(year, month, 1);
    const startDow = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    today.setHours(0,0,0,0);

    const cells: (Date | null)[] = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

    return (
        <div className="w-full">
            <div className="grid grid-cols-7 mb-1">
                {DAY_NAMES_SHORT.map(d => (
                    <div key={d} className="text-center text-xs font-medium text-white/50 py-1">{d}</div>
                ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
                {cells.map((date, i) => {
                    if (!date) return <div key={i} />;
                    const key = formatDateKey(date, tz);
                    const isPast = date < today;
                    const isAvail = availableDays.has(String(date.getDay()));
                    const isSelected = selectedDate && formatDateKey(date, tz) === formatDateKey(selectedDate, tz);
                    const isToday = date.toDateString() === today.toDateString();
                    const disabled = isPast || !isAvail;

                    return (
                        <button
                            key={key}
                            onClick={() => !disabled && onSelect(date)}
                            disabled={disabled}
                            className={`
                                aspect-square rounded-full text-sm flex items-center justify-center transition-colors
                                ${isSelected ? 'bg-white text-slate-900 font-bold' : ''}
                                ${!isSelected && isToday ? 'ring-1 ring-white text-white' : ''}
                                ${!isSelected && !isToday && !disabled ? 'text-white hover:bg-white/20' : ''}
                                ${disabled ? 'text-white/20 cursor-not-allowed' : ''}
                            `}
                        >
                            {date.getDate()}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function WeekView({
    weekStart, slots, selectedSlot, onSelectSlot, tz, color
}: {
    weekStart: Date; slots: Record<string, string[]>;
    selectedSlot: string | null; onSelectSlot: (iso: string) => void;
    tz: string; color: string;
}) {
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        days.push(d);
    }

    const allTimes = new Set<string>();
    Object.values(slots).forEach(daySlots => daySlots.forEach(s => {
        allTimes.add(formatSlotTime(s, tz));
    }));

    if (Object.values(slots).every(s => s.length === 0)) {
        return (
            <div className="flex-1 flex items-center justify-center text-muted-foreground py-20">
                <div className="text-center">
                    <Calendar className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No slots available this week</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-7 border-b sticky top-0 bg-background z-10">
                {days.map((d, i) => {
                    const key = formatDateKey(d, tz);
                    const hasSlots = (slots[key] || []).length > 0;
                    const parts = formatDateHeader(d, tz).split(' ');
                    return (
                        <div key={i} className="text-center py-3 px-1">
                            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                {parts[0]}
                            </div>
                            <div className={`text-xl font-semibold mt-0.5 ${!hasSlots ? 'text-muted-foreground/40' : ''}`}>
                                {parts[1] || d.getDate()}
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="grid grid-cols-7 min-h-[400px]">
                {days.map((d, i) => {
                    const key = formatDateKey(d, tz);
                    const daySlots = slots[key] || [];
                    return (
                        <div key={i} className="border-r last:border-r-0 p-1.5 space-y-1.5">
                            {daySlots.length === 0 ? (
                                <div className="text-center pt-4 text-muted-foreground/30 text-lg">—</div>
                            ) : daySlots.map(iso => {
                                const isSelected = selectedSlot === iso;
                                return (
                                    <button
                                        key={iso}
                                        onClick={() => onSelectSlot(iso)}
                                        className="w-full rounded-full border py-1.5 text-sm font-medium transition-all"
                                        style={isSelected ? { backgroundColor: color, borderColor: color, color: '#fff' } : {}}
                                    >
                                        {isSelected ? (
                                            <span className="flex items-center justify-center gap-1">
                                                <Check className="h-3.5 w-3.5" />
                                                {formatSlotTime(iso, tz)}
                                            </span>
                                        ) : (
                                            <span className="text-primary">{formatSlotTime(iso, tz)}</span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function BookingForm({
    slot, schedule, onConfirm, onBack, submitting
}: {
    slot: string; schedule: Schedule;
    onConfirm: (name: string, email: string, notes: string) => void;
    onBack: () => void; submitting: boolean;
}) {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [notes, setNotes] = useState('');

    return (
        <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex-1 overflow-y-auto p-6 max-w-sm w-full mx-auto"
        >
            <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
                <ChevronLeft className="h-4 w-4" /> Back
            </button>

            <div className="rounded-xl border p-4 mb-6 space-y-2">
                <p className="font-semibold">{schedule.name}</p>
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>{schedule.duration} min</span>
                </div>
                <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
                    <Calendar className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{formatConfirmDate(slot, schedule.timezone)}</span>
                </div>
                {schedule.conferencing && (
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Video className="h-4 w-4" />
                        <span>{schedule.conferencing === 'meet' ? 'Google Meet link will be sent' : 'Zoom link will be sent'}</span>
                    </div>
                )}
            </div>

            <div className="space-y-4">
                <div className="space-y-1">
                    <label className="text-sm font-medium">Your name *</label>
                    <input
                        value={name} onChange={e => setName(e.target.value)}
                        placeholder="John Doe"
                        className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary bg-background"
                    />
                </div>
                <div className="space-y-1">
                    <label className="text-sm font-medium">Email address *</label>
                    <input
                        type="email" value={email} onChange={e => setEmail(e.target.value)}
                        placeholder="john@example.com"
                        className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary bg-background"
                    />
                </div>
                <div className="space-y-1">
                    <label className="text-sm font-medium">Notes <span className="text-muted-foreground">(optional)</span></label>
                    <textarea
                        value={notes} onChange={e => setNotes(e.target.value)}
                        rows={3} placeholder="Anything you'd like to share before the meeting…"
                        className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary bg-background resize-none"
                    />
                </div>
                <button
                    onClick={() => onConfirm(name, email, notes)}
                    disabled={!name.trim() || !email.includes('@') || submitting}
                    className="w-full rounded-full py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                    style={{ backgroundColor: schedule.color }}
                >
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {submitting ? 'Confirming…' : 'Confirm appointment'}
                </button>
            </div>
        </motion.div>
    );
}

function ConfirmationView({ booking, schedule }: { booking: any; schedule: Schedule }) {
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex-1 flex items-center justify-center p-8"
        >
            <div className="text-center max-w-sm">
                <div
                    className="h-16 w-16 rounded-full flex items-center justify-center mx-auto mb-5"
                    style={{ backgroundColor: schedule.color }}
                >
                    <Check className="h-8 w-8 text-white" />
                </div>
                <h2 className="text-2xl font-bold mb-2">You're confirmed!</h2>
                <p className="text-muted-foreground mb-6">
                    A calendar invitation has been created for your appointment with{' '}
                    <span className="font-medium text-foreground">{schedule.user.name}</span>.
                </p>

                <div className="rounded-xl border p-4 text-left space-y-3 mb-6">
                    <div className="font-semibold">{schedule.name}</div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        {schedule.duration} min
                    </div>
                    <div className="flex items-start gap-2 text-sm text-muted-foreground">
                        <Calendar className="h-4 w-4 mt-0.5 shrink-0" />
                        {formatConfirmDate(booking.startsAt, schedule.timezone)}
                    </div>
                    {booking.meetUrl && (
                        <div className="flex items-start gap-2 text-sm">
                            <Video className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />
                            <a
                                href={booking.meetUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-500 underline break-all"
                            >
                                {booking.meetUrl}
                            </a>
                        </div>
                    )}
                </div>

                <p className="text-xs text-muted-foreground">Check your email for a confirmation message.</p>
            </div>
        </motion.div>
    );
}

export default function BookingPage({ params }: { params: Promise<{ scheduleId: string }> }) {
    const { scheduleId } = use(params);
    const [schedule, setSchedule] = useState<Schedule | null>(null);
    const [error, setError] = useState('');
    const [loadingSchedule, setLoadingSchedule] = useState(true);

    // Calendar state
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [calMonth, setCalMonth] = useState(today.getMonth());
    const [calYear, setCalYear] = useState(today.getFullYear());
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [weekStart, setWeekStart] = useState<Date>(() => {
        const d = new Date(today);
        d.setDate(today.getDate() - today.getDay());
        return d;
    });

    // Slots
    const [slots, setSlots] = useState<Record<string, string[]>>({});
    const [loadingSlots, setLoadingSlots] = useState(false);
    const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

    // Booking
    const [step, setStep] = useState<'pick' | 'form' | 'done'>('pick');
    const [booking, setBooking] = useState<any>(null);
    const [submitting, setSubmitting] = useState(false);

    // Load schedule
    useEffect(() => {
        fetch(`/api/appointments/schedules/${scheduleId}/public`)
            .then(r => r.ok ? r.json() : Promise.reject('Not found'))
            .then(setSchedule)
            .catch(() => setError('This scheduling page is not available.'))
            .finally(() => setLoadingSchedule(false));
    }, [scheduleId]);

    // Load slots for current week
    const loadSlots = useCallback(async (start: Date) => {
        setLoadingSlots(true);
        const dateStr = start.toISOString().split('T')[0];
        const res = await fetch(`/api/appointments/schedules/${scheduleId}/slots?date=${dateStr}`);
        if (res.ok) {
            const data = await res.json();
            setSlots(data.slots || {});
        }
        setLoadingSlots(false);
    }, [scheduleId]);

    useEffect(() => { void loadSlots(weekStart); }, [weekStart, loadSlots]);

    const handleDateSelect = (date: Date) => {
        setSelectedDate(date);
        // Align week to the Monday of the selected date
        const d = new Date(date);
        d.setDate(date.getDate() - date.getDay());
        setWeekStart(d);
        setSelectedSlot(null);
    };

    const handleWeekNav = (dir: -1 | 1) => {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + dir * 7);
        setWeekStart(d);
        setSelectedSlot(null);
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

    if (loadingSchedule) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (error || !schedule) {
        return (
            <div className="min-h-screen flex items-center justify-center text-muted-foreground">
                <p>{error || 'Schedule not found.'}</p>
            </div>
        );
    }

    const tz = schedule.timezone;
    const availableDays = new Set(schedule.availability.filter(a => a.isEnabled).map(a => String(a.dayOfWeek)));
    const weekLabel = (() => {
        const end = new Date(weekStart);
        end.setDate(weekStart.getDate() + 6);
        const fmt = (d: Date) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(d);
        return `${fmt(weekStart)} – ${fmt(end)}`;
    })();

    return (
        <div className="min-h-screen flex flex-col md:flex-row bg-background">
            {/* Left panel */}
            <div
                className="md:w-72 md:min-h-screen shrink-0 p-6 md:p-8 flex flex-col gap-5"
                style={{ backgroundColor: schedule.color }}
            >
                {/* Avatar + name */}
                <div className="flex items-center gap-3">
                    {schedule.user.avatar ? (
                        <img
                            src={schedule.user.avatar}
                            alt={schedule.user.name || ''}
                            className="h-12 w-12 rounded-full object-cover ring-2 ring-white/30"
                        />
                    ) : (
                        <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center text-white font-bold text-lg">
                            {(schedule.user.name || schedule.user.email)[0].toUpperCase()}
                        </div>
                    )}
                    <div>
                        <p className="text-white font-semibold">{schedule.user.name || schedule.user.email}</p>
                        <p className="text-white/60 text-xs">{schedule.user.email}</p>
                    </div>
                </div>

                {/* Schedule info */}
                <div>
                    <h1 className="text-white text-xl font-bold leading-tight">{schedule.name}</h1>
                    {schedule.description && (
                        <p className="text-white/70 text-sm mt-1">{schedule.description}</p>
                    )}
                </div>

                <div className="space-y-2">
                    <div className="flex items-center gap-2 text-white/80 text-sm">
                        <Clock className="h-4 w-4 shrink-0" />
                        <span>{schedule.duration} min</span>
                    </div>
                    {schedule.conferencing && (
                        <div className="flex items-center gap-2 text-white/80 text-sm">
                            <Video className="h-4 w-4 shrink-0" />
                            <span>
                                {schedule.conferencing === 'meet' ? 'Google Meet' : 'Zoom'}
                                {' '}· Video call details provided upon confirmation
                            </span>
                        </div>
                    )}
                    <div className="flex items-center gap-2 text-white/60 text-xs">
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        <span>{tz}</span>
                    </div>
                </div>

                {/* Mini calendar */}
                <div className="mt-2">
                    <div className="flex items-center justify-between mb-3">
                        <button
                            onClick={() => {
                                let m = calMonth - 1, y = calYear;
                                if (m < 0) { m = 11; y--; }
                                setCalMonth(m); setCalYear(y);
                            }}
                            className="p-1 rounded text-white/60 hover:text-white hover:bg-white/10"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                        <span className="text-white text-sm font-semibold">{MONTH_NAMES[calMonth]} {calYear}</span>
                        <button
                            onClick={() => {
                                let m = calMonth + 1, y = calYear;
                                if (m > 11) { m = 0; y++; }
                                setCalMonth(m); setCalYear(y);
                            }}
                            className="p-1 rounded text-white/60 hover:text-white hover:bg-white/10"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </button>
                    </div>
                    <MiniCalendar
                        year={calYear}
                        month={calMonth}
                        selectedDate={selectedDate}
                        onSelect={handleDateSelect}
                        availableDays={availableDays}
                        tz={tz}
                    />
                </div>
            </div>

            {/* Right panel */}
            <div className="flex-1 flex flex-col overflow-hidden">
                <AnimatePresence mode="wait">
                    {step === 'done' && booking ? (
                        <ConfirmationView key="done" booking={booking} schedule={schedule} />
                    ) : step === 'form' && selectedSlot ? (
                        <BookingForm
                            key="form"
                            slot={selectedSlot}
                            schedule={schedule}
                            onConfirm={handleConfirm}
                            onBack={() => setStep('pick')}
                            submitting={submitting}
                        />
                    ) : (
                        <motion.div
                            key="pick"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex-1 flex flex-col overflow-hidden"
                        >
                            {/* Week nav header */}
                            <div className="flex items-center justify-between px-4 py-3 border-b">
                                <button
                                    onClick={() => handleWeekNav(-1)}
                                    disabled={weekStart <= today}
                                    className="p-1.5 rounded-full hover:bg-muted disabled:opacity-30"
                                >
                                    <ChevronLeft className="h-5 w-5" />
                                </button>
                                <span className="text-sm font-medium">{weekLabel}</span>
                                <button
                                    onClick={() => handleWeekNav(1)}
                                    className="p-1.5 rounded-full hover:bg-muted"
                                >
                                    <ChevronRight className="h-5 w-5" />
                                </button>
                            </div>

                            {/* Timezone indicator */}
                            <div className="px-4 py-2 text-xs text-muted-foreground border-b">
                                {`(${new Intl.DateTimeFormat(undefined, { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || tz}) ${tz}`}
                            </div>

                            {loadingSlots ? (
                                <div className="flex-1 flex items-center justify-center">
                                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                </div>
                            ) : (
                                <WeekView
                                    weekStart={weekStart}
                                    slots={slots}
                                    selectedSlot={selectedSlot}
                                    onSelectSlot={(iso) => {
                                        setSelectedSlot(iso);
                                        setStep('form');
                                    }}
                                    tz={tz}
                                    color={schedule.color}
                                />
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
