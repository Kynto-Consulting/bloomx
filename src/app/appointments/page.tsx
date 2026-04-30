'use client';

import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { Clock, Copy, ExternalLink, Plus, Pencil, Trash2, Check, Video, X, CalendarDays, ToggleLeft, ToggleRight } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIMEZONES = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['UTC', 'America/Lima', 'America/New_York', 'Europe/London', 'Asia/Tokyo'];
const DURATIONS = [15, 20, 30, 45, 60, 90, 120];
const COLORS = ['#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#16a34a', '#0891b2'];

const DEFAULT_AVAILABILITY = DAYS.map((_, i) => ({
    dayOfWeek: i,
    startTime: '09:00',
    endTime: '17:00',
    isEnabled: i >= 1 && i <= 5,
}));

type Availability = { dayOfWeek: number; startTime: string; endTime: string; isEnabled: boolean };

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
    _count?: { bookings: number };
};

type FormState = {
    name: string;
    description: string;
    duration: number;
    color: string;
    timezone: string;
    conferencing: string;
    availability: Availability[];
};

function buildBookingUrl(scheduleId: string) {
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    return `${base}/book/${scheduleId}`;
}

function ScheduleForm({
    initial,
    onSave,
    onCancel,
    saving,
}: {
    initial?: Schedule;
    onSave: (data: FormState) => void;
    onCancel: () => void;
    saving: boolean;
}) {
    const userTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
    const [form, setForm] = useState<FormState>({
        name: initial?.name || '',
        description: initial?.description || '',
        duration: initial?.duration || 30,
        color: initial?.color || '#2563eb',
        timezone: initial?.timezone || userTz,
        conferencing: initial?.conferencing || '',
        availability: initial?.availability?.length
            ? initial.availability
            : DEFAULT_AVAILABILITY,
    });

    const setField = (k: keyof FormState, v: any) => setForm(p => ({ ...p, [k]: v }));

    const toggleDay = (i: number) =>
        setField('availability', form.availability.map(a => a.dayOfWeek === i ? { ...a, isEnabled: !a.isEnabled } : a));

    const setDayTime = (i: number, field: 'startTime' | 'endTime', val: string) =>
        setField('availability', form.availability.map(a => a.dayOfWeek === i ? { ...a, [field]: val } : a));

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-background rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto"
            >
                <div className="flex items-center justify-between px-6 py-4 border-b">
                    <h2 className="font-semibold text-lg">{initial ? 'Edit schedule' : 'New schedule'}</h2>
                    <button onClick={onCancel} className="p-1 rounded-full hover:bg-muted">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="px-6 py-5 space-y-5">
                    {/* Name */}
                    <div className="space-y-1">
                        <label className="text-sm font-medium">Name</label>
                        <input
                            value={form.name}
                            onChange={e => setField('name', e.target.value)}
                            placeholder="30 min meeting"
                            className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                        />
                    </div>

                    {/* Description */}
                    <div className="space-y-1">
                        <label className="text-sm font-medium">Description <span className="text-muted-foreground">(optional)</span></label>
                        <textarea
                            value={form.description}
                            onChange={e => setField('description', e.target.value)}
                            rows={2}
                            className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary resize-none"
                        />
                    </div>

                    {/* Duration + Color row */}
                    <div className="flex gap-4">
                        <div className="flex-1 space-y-1">
                            <label className="text-sm font-medium">Duration</label>
                            <select
                                value={form.duration}
                                onChange={e => setField('duration', Number(e.target.value))}
                                className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                            >
                                {DURATIONS.map(d => <option key={d} value={d}>{d} min</option>)}
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Color</label>
                            <div className="flex gap-1.5 pt-1">
                                {COLORS.map(c => (
                                    <button
                                        key={c}
                                        type="button"
                                        onClick={() => setField('color', c)}
                                        className="h-7 w-7 rounded-full border-2 flex items-center justify-center transition-transform hover:scale-110"
                                        style={{ backgroundColor: c, borderColor: form.color === c ? '#000' : 'transparent' }}
                                    >
                                        {form.color === c && <Check className="h-3 w-3 text-white" />}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Timezone */}
                    <div className="space-y-1">
                        <label className="text-sm font-medium">Timezone</label>
                        <select
                            value={form.timezone}
                            onChange={e => setField('timezone', e.target.value)}
                            className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                        >
                            {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                        </select>
                    </div>

                    {/* Conferencing */}
                    <div className="space-y-1">
                        <label className="text-sm font-medium">Video conferencing</label>
                        <div className="flex gap-2">
                            {[
                                { value: '', label: 'None' },
                                { value: 'meet', label: 'Google Meet' },
                                { value: 'zoom', label: 'Zoom' },
                            ].map(opt => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setField('conferencing', opt.value)}
                                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${form.conferencing === opt.value ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'}`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Availability */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Availability</label>
                        <div className="space-y-2 rounded-xl border p-3">
                            {form.availability.map(a => (
                                <div key={a.dayOfWeek} className="flex items-center gap-3">
                                    <button type="button" onClick={() => toggleDay(a.dayOfWeek)} className="flex items-center gap-2 w-28 shrink-0">
                                        {a.isEnabled
                                            ? <ToggleRight className="h-5 w-5 text-primary" />
                                            : <ToggleLeft className="h-5 w-5 text-muted-foreground" />}
                                        <span className={`text-sm ${a.isEnabled ? 'font-medium' : 'text-muted-foreground'}`}>{DAYS[a.dayOfWeek].slice(0, 3)}</span>
                                    </button>
                                    {a.isEnabled ? (
                                        <div className="flex items-center gap-1.5 flex-1">
                                            <input
                                                type="time"
                                                value={a.startTime}
                                                onChange={e => setDayTime(a.dayOfWeek, 'startTime', e.target.value)}
                                                className="rounded border bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary"
                                            />
                                            <span className="text-muted-foreground text-sm">–</span>
                                            <input
                                                type="time"
                                                value={a.endTime}
                                                onChange={e => setDayTime(a.dayOfWeek, 'endTime', e.target.value)}
                                                className="rounded border bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary"
                                            />
                                        </div>
                                    ) : (
                                        <span className="text-sm text-muted-foreground">Unavailable</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="flex justify-end gap-3 px-6 py-4 border-t">
                    <button onClick={onCancel} className="px-4 py-2 rounded-lg border text-sm hover:bg-muted">Cancel</button>
                    <button
                        onClick={() => onSave(form)}
                        disabled={!form.name.trim() || saving}
                        className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
                    >
                        {saving ? 'Saving…' : 'Save schedule'}
                    </button>
                </div>
            </motion.div>
        </div>
    );
}

export default function AppointmentsPage() {
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
            const url = editTarget
                ? `/api/appointments/schedules/${editTarget.id}`
                : '/api/appointments/schedules';
            const res = await fetch(url, {
                method: editTarget ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...form, conferencing: form.conferencing || null }),
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
        if (res.ok) {
            toast.success('Schedule deleted');
            void loadSchedules();
        } else {
            toast.error('Failed to delete');
        }
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
                <div className="max-w-3xl mx-auto px-6 py-10">
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <h1 className="text-2xl font-bold">Appointment schedules</h1>
                            <p className="text-muted-foreground text-sm mt-1">Share your booking link so people can schedule time with you.</p>
                        </div>
                        <button
                            onClick={() => { setEditTarget(null); setShowForm(true); }}
                            className="flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90"
                        >
                            <Plus className="h-4 w-4" /> New schedule
                        </button>
                    </div>

                    {loading ? (
                        <div className="space-y-4">
                            {[1, 2].map(i => <div key={i} className="h-24 rounded-2xl border bg-muted/30 animate-pulse" />)}
                        </div>
                    ) : schedules.length === 0 ? (
                        <div className="rounded-2xl border border-dashed p-12 text-center">
                            <CalendarDays className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                            <p className="font-medium">No schedules yet</p>
                            <p className="text-sm text-muted-foreground mt-1">Create your first scheduling page to share with others.</p>
                            <button
                                onClick={() => { setEditTarget(null); setShowForm(true); }}
                                className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90"
                            >
                                <Plus className="h-4 w-4" /> Create schedule
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {schedules.map(s => (
                                <div key={s.id} className="rounded-2xl border bg-background p-5 flex items-start gap-4">
                                    <div
                                        className="h-10 w-10 rounded-xl shrink-0 flex items-center justify-center text-white"
                                        style={{ backgroundColor: s.color }}
                                    >
                                        <Clock className="h-5 w-5" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold truncate">{s.name}</span>
                                            {!s.isActive && <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">Inactive</span>}
                                        </div>
                                        <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                                            <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{s.duration} min</span>
                                            {s.conferencing && <span className="flex items-center gap-1"><Video className="h-3.5 w-3.5" />{s.conferencing === 'meet' ? 'Google Meet' : 'Zoom'}</span>}
                                            {s._count?.bookings ? <span>{s._count.bookings} upcoming</span> : null}
                                        </div>
                                        <div className="mt-2 flex items-center gap-1.5 text-xs text-primary truncate">
                                            <a href={buildBookingUrl(s.id)} target="_blank" rel="noopener noreferrer" className="underline truncate">
                                                {buildBookingUrl(s.id)}
                                            </a>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button
                                            onClick={() => handleCopy(s.id)}
                                            className="p-2 rounded-lg hover:bg-muted text-muted-foreground"
                                            title="Copy link"
                                        >
                                            {copiedId === s.id ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                                        </button>
                                        <a
                                            href={buildBookingUrl(s.id)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="p-2 rounded-lg hover:bg-muted text-muted-foreground"
                                            title="Open booking page"
                                        >
                                            <ExternalLink className="h-4 w-4" />
                                        </a>
                                        <button
                                            onClick={() => handleToggleActive(s)}
                                            className="p-2 rounded-lg hover:bg-muted text-muted-foreground"
                                            title={s.isActive ? 'Deactivate' : 'Activate'}
                                        >
                                            {s.isActive ? <ToggleRight className="h-4 w-4 text-primary" /> : <ToggleLeft className="h-4 w-4" />}
                                        </button>
                                        <button
                                            onClick={() => { setEditTarget(s); setShowForm(true); }}
                                            className="p-2 rounded-lg hover:bg-muted text-muted-foreground"
                                            title="Edit"
                                        >
                                            <Pencil className="h-4 w-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(s.id)}
                                            className="p-2 rounded-lg hover:bg-muted text-rose-500"
                                            title="Delete"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            ))}
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
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
