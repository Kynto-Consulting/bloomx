'use client';

import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { Clock, Copy, ExternalLink, Plus, Pencil, Trash2, Check, Video, X, CalendarDays, ToggleLeft, ToggleRight, ChevronRight, ChevronLeft, PlusCircle, Trash } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { useDomainConfig } from '@/hooks/useDomainConfig';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIMEZONES = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['UTC', 'America/Lima', 'America/New_York', 'Europe/London'];
const DURATIONS = [15, 20, 30, 45, 60, 90, 120];
const COLORS = ['#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#16a34a', '#0891b2'];

type Range = { startTime: string; endTime: string };
type DayConfig = { dayOfWeek: number; isEnabled: boolean; ranges: Range[] };
type Availability = { dayOfWeek: number; startTime: string; endTime: string; isEnabled: boolean };
type AvailabilityRow = { dayOfWeek: number; startTime: string; endTime: string; isEnabled: boolean };

type Schedule = {
    id: string;
    name: string;
    description?: string | null;
    duration: number;
    color: string;
    timezone: string;
    isActive: boolean;
    conferencing?: string | null;
    availability: Availability[];
    bookingUrl?: string;
    _count?: { bookings: number };
};

type FormState = {
    name: string;
    description: string;
    duration: number;
    color: string;
    timezone: string;
    conferencing: string;
    days: DayConfig[];
};

function defaultDays(): DayConfig[] {
    return DAYS.map((_, i) => ({
        dayOfWeek: i,
        isEnabled: i >= 1 && i <= 5,
        ranges: [{ startTime: '09:00', endTime: '17:00' }],
    }));
}

function toDayConfigs(availability: Availability[]): DayConfig[] {
    return DAYS.map((_, i) => {
        const rows = availability.filter(a => a.dayOfWeek === i);
        const enabled = rows.filter(a => a.isEnabled);
        return {
            dayOfWeek: i,
            isEnabled: enabled.length > 0,
            ranges: enabled.length > 0
                ? enabled.map(a => ({ startTime: a.startTime, endTime: a.endTime }))
                : [{ startTime: '09:00', endTime: '17:00' }],
        };
    });
}

function fromDayConfigs(days: DayConfig[]): AvailabilityRow[] {
    const rows: AvailabilityRow[] = [];
    for (const d of days) {
        if (d.isEnabled) {
            for (const r of d.ranges) {
                rows.push({ dayOfWeek: d.dayOfWeek, startTime: r.startTime, endTime: r.endTime, isEnabled: true });
            }
        } else {
            rows.push({ dayOfWeek: d.dayOfWeek, startTime: '09:00', endTime: '17:00', isEnabled: false });
        }
    }
    return rows;
}

function buildBookingUrl(scheduleId: string) {
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    return `${base}/book/${scheduleId}`;
}

// Darken a hex color slightly for borders
function darken(hex: string, amount = 0.15): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const d = (c: number) => Math.max(0, Math.round(c * (1 - amount))).toString(16).padStart(2, '0');
    return `#${d(r)}${d(g)}${d(b)}`;
}

// ─── Step indicator ──────────────────────────────────────────────────────────

function StepDots({ step, color }: { step: 1 | 2; color: string }) {
    return (
        <div className="flex items-center gap-2 justify-center py-1">
            {[1, 2].map(s => (
                <div
                    key={s}
                    className="h-1.5 rounded-full transition-all duration-300"
                    style={{
                        width: step === s ? 24 : 8,
                        backgroundColor: step === s ? color : '#d1d5db',
                    }}
                />
            ))}
        </div>
    );
}

// ─── Schedule form (2-step modal) ────────────────────────────────────────────

function ScheduleForm({
    initial, onSave, onCancel, saving, brandColor,
}: {
    initial?: Schedule; onSave: (data: FormState) => void; onCancel: () => void; saving: boolean; brandColor: string;
}) {
    const userTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
    const [step, setStep] = useState<1 | 2>(1);
    const [form, setForm] = useState<FormState>({
        name: initial?.name || '',
        description: initial?.description || '',
        duration: initial?.duration || 30,
        color: initial?.color || brandColor || '#2563eb',
        timezone: initial?.timezone || userTz,
        conferencing: initial?.conferencing || '',
        days: initial?.availability?.length ? toDayConfigs(initial.availability) : defaultDays(),
    });

    const set = (k: keyof FormState, v: any) => setForm(p => ({ ...p, [k]: v }));
    const accent = form.color || brandColor;

    const toggleDay = (i: number) =>
        set('days', form.days.map(d => d.dayOfWeek === i ? { ...d, isEnabled: !d.isEnabled } : d));

    const setRange = (dayIdx: number, rangeIdx: number, field: 'startTime' | 'endTime', val: string) =>
        set('days', form.days.map(d => d.dayOfWeek !== dayIdx ? d : {
            ...d, ranges: d.ranges.map((r, ri) => ri === rangeIdx ? { ...r, [field]: val } : r),
        }));

    const addRange = (dayIdx: number) =>
        set('days', form.days.map(d => d.dayOfWeek !== dayIdx ? d : {
            ...d, ranges: [...d.ranges, { startTime: '09:00', endTime: '17:00' }],
        }));

    const removeRange = (dayIdx: number, rangeIdx: number) =>
        set('days', form.days.map(d => d.dayOfWeek !== dayIdx ? d : {
            ...d, ranges: d.ranges.filter((_, ri) => ri !== rangeIdx),
        }));

    const inputCls = `w-full rounded-xl px-3.5 py-2.5 text-sm outline-none transition-all bg-muted/50 hover:bg-muted/70 focus:bg-background focus:ring-2 focus:ring-offset-0`;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-background rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col"
                style={{ maxHeight: '90vh' }}
            >
                {/* Header */}
                <div className="px-6 pt-5 pb-3 shrink-0">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="font-semibold text-base">{initial ? 'Edit schedule' : 'New schedule'}</h2>
                        <button onClick={onCancel} className="p-1 rounded-full hover:bg-muted text-muted-foreground">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                    <StepDots step={step} color={accent} />
                    <div className="flex justify-between mt-2">
                        <span className="text-xs font-medium" style={{ color: step === 1 ? accent : '#9ca3af' }}>Details</span>
                        <span className="text-xs font-medium" style={{ color: step === 2 ? accent : '#9ca3af' }}>Availability</span>
                    </div>
                </div>

                <div className="border-t" />

                {/* Body */}
                <div className="overflow-y-auto flex-1 px-6 py-5">
                    <AnimatePresence mode="wait">
                        {step === 1 ? (
                            <motion.div key="step1" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} className="space-y-4">
                                <div className="space-y-1">
                                    <label className="text-sm font-medium">Name</label>
                                    <input value={form.name} onChange={e => set('name', e.target.value)}
                                        placeholder="30 min meeting"
                                        className={inputCls}
                                        style={{ '--tw-ring-color': accent } as any} />
                                </div>

                                <div className="space-y-1">
                                    <label className="text-sm font-medium">Description <span className="text-muted-foreground font-normal">(optional)</span></label>
                                    <textarea value={form.description} onChange={e => set('description', e.target.value)}
                                        rows={2} placeholder="Quick intro call, demo, etc."
                                        className={`${inputCls} resize-none`} />
                                </div>

                                <div className="flex gap-3">
                                    <div className="flex-1 space-y-1">
                                        <label className="text-sm font-medium">Duration</label>
                                        <select value={form.duration} onChange={e => set('duration', Number(e.target.value))} className={inputCls}>
                                            {DURATIONS.map(d => <option key={d} value={d}>{d} min</option>)}
                                        </select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-sm font-medium">Color</label>
                                        <div className="flex gap-1.5 pt-1.5">
                                            {COLORS.map(c => (
                                                <button key={c} type="button" onClick={() => set('color', c)}
                                                    className="h-7 w-7 rounded-full flex items-center justify-center transition-all hover:scale-110"
                                                    style={{ backgroundColor: c, outline: form.color === c ? `2px solid ${c}` : 'none', outlineOffset: 2 }}>
                                                    {form.color === c && <Check className="h-3 w-3 text-white" />}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <label className="text-sm font-medium">Video conferencing</label>
                                    <div className="flex gap-2">
                                        {[{ value: '', label: 'None' }, { value: 'meet', label: 'Google Meet' }, { value: 'zoom', label: 'Zoom' }].map(opt => (
                                            <button key={opt.value} type="button" onClick={() => set('conferencing', opt.value)}
                                                className="flex-1 rounded-xl bg-muted/40 px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/70"
                                                style={form.conferencing === opt.value
                                                    ? { borderColor: accent, backgroundColor: `${accent}15`, color: accent }
                                                    : {}}>
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </motion.div>
                        ) : (
                            <motion.div key="step2" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="space-y-4">
                                <div className="space-y-1">
                                    <label className="text-sm font-medium">Timezone</label>
                                    <select value={form.timezone} onChange={e => set('timezone', e.target.value)} className={inputCls}>
                                        {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                                    </select>
                                </div>

                                <div className="space-y-1">
                                    <label className="text-sm font-medium">Weekly hours</label>
                                    <div className="rounded-xl bg-muted/30 divide-y divide-muted overflow-hidden">
                                        {form.days.map(d => (
                                            <div key={d.dayOfWeek} className="px-3 py-2.5">
                                                <div className="flex items-center gap-3 min-h-[28px]">
                                                    <button type="button" onClick={() => toggleDay(d.dayOfWeek)}
                                                        className="flex items-center gap-2 w-24 shrink-0">
                                                        {d.isEnabled
                                                            ? <ToggleRight className="h-5 w-5" style={{ color: accent }} />
                                                            : <ToggleLeft className="h-5 w-5 text-muted-foreground" />}
                                                        <span className={`text-sm w-8 ${d.isEnabled ? 'font-medium' : 'text-muted-foreground'}`}>
                                                            {DAYS[d.dayOfWeek].slice(0, 3)}
                                                        </span>
                                                    </button>

                                                    {d.isEnabled ? (
                                                        <div className="flex-1 space-y-1.5">
                                                            {d.ranges.map((r, ri) => (
                                                                <div key={ri} className="flex items-center gap-1.5">
                                                                    <input type="time" value={r.startTime}
                                                                        onChange={e => setRange(d.dayOfWeek, ri, 'startTime', e.target.value)}
                                                                        className="rounded-lg bg-muted/50 hover:bg-muted/80 focus:bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 flex-1 transition-all" />
                                                                    <span className="text-muted-foreground text-xs">–</span>
                                                                    <input type="time" value={r.endTime}
                                                                        onChange={e => setRange(d.dayOfWeek, ri, 'endTime', e.target.value)}
                                                                        className="rounded-lg bg-muted/50 hover:bg-muted/80 focus:bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 flex-1 transition-all" />
                                                                    {d.ranges.length > 1 && (
                                                                        <button type="button" onClick={() => removeRange(d.dayOfWeek, ri)}
                                                                            className="text-muted-foreground hover:text-rose-500 transition-colors">
                                                                            <Trash className="h-3.5 w-3.5" />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            ))}
                                                            <button type="button" onClick={() => addRange(d.dayOfWeek)}
                                                                className="flex items-center gap-1 text-xs mt-0.5 transition-colors"
                                                                style={{ color: accent }}>
                                                                <PlusCircle className="h-3 w-3" /> Add range
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <span className="text-sm text-muted-foreground">Unavailable</span>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Footer */}
                <div className="border-t px-6 py-4 flex justify-between gap-3 shrink-0">
                    {step === 1 ? (
                        <>
                            <button onClick={onCancel} className="px-4 py-2 rounded-lg border text-sm hover:bg-muted">Cancel</button>
                            <button
                                onClick={() => setStep(2)}
                                disabled={!form.name.trim()}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-medium hover:opacity-90 disabled:opacity-40"
                                style={{ backgroundColor: accent }}>
                                Availability <ChevronRight className="h-4 w-4" />
                            </button>
                        </>
                    ) : (
                        <>
                            <button onClick={() => setStep(1)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg border text-sm hover:bg-muted">
                                <ChevronLeft className="h-4 w-4" /> Back
                            </button>
                            <button
                                onClick={() => onSave(form)}
                                disabled={saving}
                                className="px-4 py-2 rounded-lg text-white text-sm font-medium hover:opacity-90 disabled:opacity-40"
                                style={{ backgroundColor: accent }}>
                                {saving ? 'Saving…' : initial ? 'Save changes' : 'Create schedule'}
                            </button>
                        </>
                    )}
                </div>
            </motion.div>
        </div>
    );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function AppointmentsPage() {
    const { config: domainConfig } = useDomainConfig();
    const brandColor = domainConfig.theme?.primaryColor || '#2563eb';

    const [schedules, setSchedules] = useState<Schedule[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editTarget, setEditTarget] = useState<Schedule | null>(null);
    const [saving, setSaving] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    const loadSchedules = async () => {
        setLoading(true);
        const res = await fetch('/api/appointments/schedules');
        if (res.ok) setSchedules(await res.json());
        setLoading(false);
    };

    useEffect(() => { void loadSchedules(); }, []);

    const handleSave = async (form: FormState) => {
        setSaving(true);
        try {
            const url = editTarget ? `/api/appointments/schedules/${editTarget.id}` : '/api/appointments/schedules';
            const payload = {
                name: form.name,
                description: form.description || null,
                duration: form.duration,
                color: form.color,
                timezone: form.timezone,
                conferencing: form.conferencing || null,
                availability: fromDayConfigs(form.days),
            };
            const res = await fetch(url, {
                method: editTarget ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error((await res.json()).error || 'Failed');
            toast.success(editTarget ? 'Schedule updated' : 'Schedule created');
            setShowForm(false);
            setEditTarget(null);
            void loadSchedules();
        } catch (e: any) {
            toast.error(e.message);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this schedule? All future bookings will be lost.')) return;
        const res = await fetch(`/api/appointments/schedules/${id}`, { method: 'DELETE' });
        if (res.ok) { toast.success('Schedule deleted'); void loadSchedules(); }
        else toast.error('Failed to delete');
    };

    const handleToggleActive = async (s: Schedule) => {
        await fetch(`/api/appointments/schedules/${s.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive: !s.isActive }),
        });
        void loadSchedules();
    };

    const handleCopy = (id: string) => {
        navigator.clipboard.writeText(buildBookingUrl(id));
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
        toast.success('Link copied');
    };

    return (
        <div className="flex h-screen overflow-hidden bg-background">
            <div className="hidden md:flex w-64 border-r flex-col shrink-0">
                <Sidebar />
            </div>

            <div className="flex-1 overflow-y-auto">
                <div className="max-w-2xl mx-auto px-6 py-10">
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <h1 className="text-xl font-bold">Appointment schedules</h1>
                            <p className="text-muted-foreground text-sm mt-0.5">Share your booking link so people can schedule time with you.</p>
                        </div>
                        <button
                            onClick={() => { setEditTarget(null); setShowForm(true); }}
                            className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
                            style={{ backgroundColor: brandColor }}
                        >
                            <Plus className="h-4 w-4" /> New schedule
                        </button>
                    </div>

                    {loading ? (
                        <div className="space-y-3">
                            {[1, 2].map(i => <div key={i} className="h-24 rounded-2xl bg-muted/30 animate-pulse" />)}
                        </div>
                    ) : schedules.length === 0 ? (
                        <div className="rounded-2xl border-2 border-dashed p-12 text-center">
                            <CalendarDays className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                            <p className="font-medium">No schedules yet</p>
                            <p className="text-sm text-muted-foreground mt-1">Create your first scheduling page to share with others.</p>
                            <button
                                onClick={() => { setEditTarget(null); setShowForm(true); }}
                                className="mt-4 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                                style={{ backgroundColor: brandColor }}
                            >
                                <Plus className="h-4 w-4" /> Create schedule
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {schedules.map(s => {
                                const c = s.color || brandColor;
                                const borderColor = darken(c, 0.05) + '55';
                                const bgColor = c + '0d';
                                return (
                                    <div key={s.id}
                                        className="rounded-2xl p-5 flex items-start gap-4 transition-shadow hover:shadow-sm"
                                        style={{ backgroundColor: bgColor, border: `1.5px solid ${borderColor}` }}>
                                        <div className="h-10 w-10 rounded-xl shrink-0 flex items-center justify-center text-white shadow-sm"
                                            style={{ backgroundColor: c }}>
                                            <Clock className="h-5 w-5" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-semibold truncate">{s.name}</span>
                                                {!s.isActive && (
                                                    <span className="text-xs px-2 py-0.5 rounded-full bg-background/60 text-muted-foreground border">
                                                        Inactive
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                                                <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{s.duration} min</span>
                                                {s.conferencing && (
                                                    <span className="flex items-center gap-1">
                                                        <Video className="h-3.5 w-3.5" />
                                                        {s.conferencing === 'meet' ? 'Google Meet' : 'Zoom'}
                                                    </span>
                                                )}
                                                {!!s._count?.bookings && <span>{s._count.bookings} upcoming</span>}
                                            </div>
                                            <div className="mt-1.5 text-xs truncate" style={{ color: c }}>
                                                <a href={buildBookingUrl(s.id)} target="_blank" rel="noopener noreferrer" className="hover:underline truncate">
                                                    {buildBookingUrl(s.id)}
                                                </a>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-0.5 shrink-0">
                                            <button onClick={() => handleCopy(s.id)}
                                                className="p-2 rounded-lg hover:bg-background/60 text-muted-foreground transition-colors" title="Copy link">
                                                {copiedId === s.id ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                                            </button>
                                            <a href={buildBookingUrl(s.id)} target="_blank" rel="noopener noreferrer"
                                                className="p-2 rounded-lg hover:bg-background/60 text-muted-foreground transition-colors" title="Open">
                                                <ExternalLink className="h-4 w-4" />
                                            </a>
                                            <button onClick={() => handleToggleActive(s)}
                                                className="p-2 rounded-lg hover:bg-background/60 text-muted-foreground transition-colors"
                                                title={s.isActive ? 'Deactivate' : 'Activate'}>
                                                {s.isActive
                                                    ? <ToggleRight className="h-4 w-4" style={{ color: c }} />
                                                    : <ToggleLeft className="h-4 w-4" />}
                                            </button>
                                            <button onClick={() => { setEditTarget(s); setShowForm(true); }}
                                                className="p-2 rounded-lg hover:bg-background/60 text-muted-foreground transition-colors" title="Edit">
                                                <Pencil className="h-4 w-4" />
                                            </button>
                                            <button onClick={() => handleDelete(s.id)}
                                                className="p-2 rounded-lg hover:bg-background/60 text-rose-400 transition-colors" title="Delete">
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            <AnimatePresence>
                {showForm && (
                    <ScheduleForm
                        initial={editTarget || undefined}
                        onSave={handleSave}
                        onCancel={() => { setShowForm(false); setEditTarget(null); }}
                        saving={saving}
                        brandColor={brandColor}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
