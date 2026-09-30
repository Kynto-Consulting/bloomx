'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { normalizeHex } from '@/lib/color';
import { Sidebar } from '@/components/Sidebar';
import { Clock, Copy, ExternalLink, Plus, Pencil, Trash2, Check, Video, X, CalendarDays, ToggleLeft, ToggleRight, ChevronRight, ChevronLeft, PlusCircle, Trash, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { useI18n } from '@/components/I18nProvider';
import { useDialog } from '@/components/ui/useDialog';
import { useSurfaceColors } from '@/hooks/useSurfaceColors';
import { DEFAULT_AGENDA_COLOR, agendaAccentText, agendaSoft, agendaTextOn, safeAgendaColor } from '@/lib/agenda-color';
import { pluralKey, weekdayName } from '@/lib/i18n/format';
import { useConferencingProviders } from '@/components/conferencing/useConferencingProviders';
import { STATE_LABEL_KEY, providerReasonKey, providerState } from '@/components/conferencing/picker-state';
import { PROVIDER_INFO, legacyValueFromProvider, providerFromLegacyValue } from '@/lib/conferencing/types';

// 0 = domingo ... 6 = sabado (los nombres salen de Intl segun el idioma activo).
const DAYS = [0, 1, 2, 3, 4, 5, 6];
const TIMEZONES = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['UTC', 'America/Lima', 'America/New_York', 'Europe/London'];
const DURATIONS = [15, 20, 30, 45, 60, 90, 120];
// theme-lint-ignore: paleta de colores de USUARIO para horarios (dato, no tema); el texto se calcula por contraste (agenda-color.ts).
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

// ─── Step indicator ──────────────────────────────────────────────────────────

function StepDots({ step, color }: { step: 1 | 2; color: string }) {
    return (
        <div className="flex items-center gap-2 justify-center py-1">
            {[1, 2].map(s => (
                <div
                    key={s}
                    className={`h-1.5 rounded-full transition-all duration-300 ${step === s ? '' : 'bg-input'}`}
                    style={{
                        width: step === s ? 24 : 8,
                        ...(step === s ? { backgroundColor: color } : {}),
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
    const { t, intlLocale } = useI18n();
    const dayLong = (i: number) => weekdayName(i, intlLocale, 'long');
    const dayShort = (i: number) => weekdayName(i, intlLocale, 'short');
    const uid = useId();
    const surface = useSurfaceColors();
    const { ref: dialogRef, titleId } = useDialog<HTMLDivElement>(true, onCancel, { disableEscape: saving });
    const userTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
    const [step, setStep] = useState<1 | 2>(1);
    const [form, setForm] = useState<FormState>({
        name: initial?.name || '',
        description: initial?.description || '',
        duration: initial?.duration || 30,
        color: initial?.color || brandColor || DEFAULT_AGENDA_COLOR,
        timezone: initial?.timezone || userTz,
        conferencing: initial?.conferencing || '',
        days: initial?.availability?.length ? toDayConfigs(initial.availability) : defaultDays(),
    });

    const set = (k: keyof FormState, v: any) => setForm(p => ({ ...p, [k]: v }));
    // Proveedores del registro de videoconferencia; el valor guardado sigue siendo 'meet' | 'zoom' (la API no admite mas).
    const { providers: confProviders } = useConferencingProviders();
    const confOptions = (['google-meet', 'zoom'] as const).map(id => ({
        value: legacyValueFromProvider(id),
        label: confProviders.find(p => p.id === id)?.name || PROVIDER_INFO[id].name,
    }));
    const confProvider = providerFromLegacyValue(form.conferencing);
    const confStatus = confProvider ? confProviders.find(p => p.id === confProvider) ?? null : null;
    // Color elegido por el usuario: relleno solido (texto legible por contraste) y version "de texto" corregida.
    const accentSolid = safeAgendaColor(form.color || brandColor);
    const onAccent = agendaTextOn(accentSolid);
    const accent = agendaAccentText(accentSolid, [surface.background]);
    const softAccent = agendaSoft(accentSolid, surface.background, 0.1);

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onCancel(); }}>
            <motion.div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-background text-foreground rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col outline-none"
                style={{ maxHeight: '90dvh' }}
            >
                {/* Header */}
                <div className="px-6 pt-5 pb-3 shrink-0">
                    <div className="flex items-center justify-between mb-3">
                        <h2 id={titleId} className="font-semibold text-base">{initial ? t('appointments.form.editTitle') : t('appointments.form.newTitle')}</h2>
                        <button type="button" onClick={onCancel} aria-label={t('common.close')} className="p-2 rounded-full hover:bg-muted text-muted-foreground">
                            <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                    </div>
                    <StepDots step={step} color={accentSolid} />
                    <div className="flex justify-between mt-2">
                        <span className={`text-xs font-medium ${step === 1 ? '' : 'text-muted-foreground'}`} style={step === 1 ? { color: accent } : undefined} aria-current={step === 1 ? 'step' : undefined}>{t('appointments.form.stepDetails')}</span>
                        <span className={`text-xs font-medium ${step === 2 ? '' : 'text-muted-foreground'}`} style={step === 2 ? { color: accent } : undefined} aria-current={step === 2 ? 'step' : undefined}>{t('appointments.form.stepAvailability')}</span>
                    </div>
                </div>

                <div className="border-t border-border" />

                {/* Body */}
                <div className="overflow-y-auto flex-1 px-6 py-5">
                    <AnimatePresence mode="wait">
                        {step === 1 ? (
                            <motion.div key="step1" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} className="space-y-4">
                                <div className="space-y-1">
                                    <label htmlFor={`${uid}-name`} className="text-sm font-medium">{t('appointments.form.name')}</label>
                                    <input id={`${uid}-name`} value={form.name} onChange={e => set('name', e.target.value)}
                                        placeholder={t('appointments.form.namePlaceholder')}
                                        className={inputCls}
                                        style={{ '--tw-ring-color': accent } as any} />
                                </div>

                                <div className="space-y-1">
                                    <label htmlFor={`${uid}-desc`} className="text-sm font-medium">{t('appointments.form.description')} <span className="text-muted-foreground font-normal">{t('common.optional')}</span></label>
                                    <textarea id={`${uid}-desc`} value={form.description} onChange={e => set('description', e.target.value)}
                                        rows={2} placeholder={t('appointments.form.descriptionPlaceholder')}
                                        className={`${inputCls} resize-none`} />
                                </div>

                                <div className="flex gap-3">
                                    <div className="flex-1 space-y-1">
                                        <label htmlFor={`${uid}-duration`} className="text-sm font-medium">{t('appointments.form.duration')}</label>
                                        <select id={`${uid}-duration`} value={form.duration} onChange={e => set('duration', Number(e.target.value))} className={inputCls}>
                                            {DURATIONS.map(d => <option key={d} value={d}>{t('appointments.minutes', { n: d })}</option>)}
                                        </select>
                                    </div>
                                    <div className="space-y-1" role="group" aria-labelledby={`${uid}-color`}>
                                        <span id={`${uid}-color`} className="text-sm font-medium">{t('appointments.form.color')}</span>
                                        <div className="flex gap-1.5 pt-1.5">
                                            {COLORS.map(c => (
                                                <button key={c} type="button" onClick={() => set('color', c)}
                                                    aria-label={c} aria-pressed={form.color === c}
                                                    className="h-8 w-8 rounded-full flex items-center justify-center transition-all hover:scale-110"
                                                    style={{ backgroundColor: c, color: agendaTextOn(c), outline: form.color === c ? `2px solid ${c}` : 'none', outlineOffset: 2 }}>
                                                    {form.color === c && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <span id={`${uid}-conf`} className="text-sm font-medium">{t('appointments.form.conferencing')}</span>
                                    <div className="flex gap-2" role="group" aria-labelledby={`${uid}-conf`}>
                                        {[{ value: '', label: t('appointments.form.confNone') }, ...confOptions].map(opt => (
                                            <button key={opt.value} type="button" onClick={() => set('conferencing', opt.value)}
                                                aria-pressed={form.conferencing === opt.value}
                                                className="flex-1 rounded-xl border border-transparent bg-muted px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/70"
                                                style={form.conferencing === opt.value
                                                    ? { borderColor: softAccent.border, backgroundColor: softAccent.background, color: softAccent.foreground }
                                                    : {}}>
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                    {confStatus && (
                                        <p role="status" aria-live="polite" data-testid="conf-status" className={`text-xs ${providerState(confStatus) === 'ready' ? 'text-muted-foreground' : 'text-warning'}`}>
                                            {t(STATE_LABEL_KEY[providerState(confStatus)])}
                                            {providerReasonKey(confStatus) ? `: ${t(providerReasonKey(confStatus) as string)}` : ''}
                                        </p>
                                    )}
                                </div>
                            </motion.div>
                        ) : (
                            <motion.div key="step2" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="space-y-4">
                                <div className="space-y-1">
                                    <label htmlFor={`${uid}-tz`} className="text-sm font-medium">{t('appointments.form.timezone')}</label>
                                    <select id={`${uid}-tz`} value={form.timezone} onChange={e => set('timezone', e.target.value)} className={inputCls}>
                                        {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                                    </select>
                                </div>

                                <div className="space-y-1">
                                    <span className="text-sm font-medium">{t('appointments.form.weeklyHours')}</span>
                                    <div className="rounded-xl bg-muted/40 divide-y divide-border overflow-hidden">
                                        {form.days.map(d => (
                                            <div key={d.dayOfWeek} className="px-3 py-2.5">
                                                <div className="flex items-center gap-3 min-h-[28px]">
                                                    <button type="button" onClick={() => toggleDay(d.dayOfWeek)}
                                                        aria-pressed={d.isEnabled} aria-label={dayLong(d.dayOfWeek)}
                                                        className="flex items-center gap-2 w-24 shrink-0 min-h-[32px]">
                                                        {d.isEnabled
                                                            ? <ToggleRight className="h-5 w-5" style={{ color: accent }} />
                                                            : <ToggleLeft className="h-5 w-5 text-muted-foreground" />}
                                                        <span className={`text-sm w-8 ${d.isEnabled ? 'font-medium' : 'text-muted-foreground'}`}>
                                                            {dayShort(d.dayOfWeek)}
                                                        </span>
                                                    </button>

                                                    {d.isEnabled ? (
                                                        <div className="flex-1 space-y-1.5">
                                                            {d.ranges.map((r, ri) => (
                                                                <div key={ri} className="flex items-center gap-1.5">
                                                                    <input type="time" value={r.startTime} aria-label={t('appointments.form.rangeStart', { day: dayLong(d.dayOfWeek) })}
                                                                        onChange={e => setRange(d.dayOfWeek, ri, 'startTime', e.target.value)}
                                                                        className="rounded-lg bg-muted/50 hover:bg-muted/80 focus:bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 flex-1 transition-all" />
                                                                    <span className="text-muted-foreground text-xs">–</span>
                                                                    <input type="time" value={r.endTime} aria-label={t('appointments.form.rangeEnd', { day: dayLong(d.dayOfWeek) })}
                                                                        onChange={e => setRange(d.dayOfWeek, ri, 'endTime', e.target.value)}
                                                                        className="rounded-lg bg-muted/50 hover:bg-muted/80 focus:bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 flex-1 transition-all" />
                                                                    {d.ranges.length > 1 && (
                                                                        <button type="button" onClick={() => removeRange(d.dayOfWeek, ri)}
                                                                            aria-label={t('common.delete')}
                                                                            className="p-1.5 text-muted-foreground hover:text-destructive transition-colors">
                                                                            <Trash className="h-3.5 w-3.5" aria-hidden="true" />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            ))}
                                                            <button type="button" onClick={() => addRange(d.dayOfWeek)}
                                                                className="flex items-center gap-1 text-xs mt-0.5 transition-colors"
                                                                style={{ color: accent }}>
                                                                <PlusCircle className="h-3 w-3" aria-hidden="true" /> {t('appointments.form.addRange')}
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <span className="text-sm text-muted-foreground">{t('appointments.form.unavailable')}</span>
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
                <div className="border-t border-border px-6 py-4 flex justify-between gap-3 shrink-0">
                    {step === 1 ? (
                        <>
                            <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted">{t('common.cancel')}</button>
                            <button
                                type="button"
                                onClick={() => setStep(2)}
                                disabled={!form.name.trim()}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
                                style={{ backgroundColor: accentSolid, color: onAccent }}>
                                {t('appointments.form.stepAvailability')} <ChevronRight className="h-4 w-4" aria-hidden="true" />
                            </button>
                        </>
                    ) : (
                        <>
                            <button type="button" onClick={() => setStep(1)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted">
                                <ChevronLeft className="h-4 w-4" aria-hidden="true" /> {t('common.back')}
                            </button>
                            <button
                                type="button"
                                onClick={() => onSave(form)}
                                disabled={saving}
                                className="px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
                                style={{ backgroundColor: accentSolid, color: onAccent }}>
                                {saving ? t('common.saving') : initial ? t('appointments.form.saveChanges') : t('appointments.form.create')}
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
    const { t } = useI18n();
    const surface = useSurfaceColors();
    // Color de marca vigente: lee --color-primary (cubre paletas por modo); respaldo al campo legado.
    const brandColor = useMemo(() => {
        const fallback = safeAgendaColor(domainConfig.theme?.primaryColor, DEFAULT_AGENDA_COLOR);
        if (typeof document === 'undefined') return fallback;
        return normalizeHex(getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim()) ?? fallback;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [domainConfig.theme, surface.background]);

    const [schedules, setSchedules] = useState<Schedule[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editTarget, setEditTarget] = useState<Schedule | null>(null);
    const [saving, setSaving] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [fixingRooms, setFixingRooms] = useState(false);

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
            if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || t('appointments.saveFailed'));
            toast.success(editTarget ? t('appointments.updated') : t('appointments.created'));
            setShowForm(false);
            setEditTarget(null);
            void loadSchedules();
        } catch (e: any) {
            toast.error(e.message || t('appointments.saveFailed'));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm(t('appointments.deleteConfirm'))) return;
        const res = await fetch(`/api/appointments/schedules/${id}`, { method: 'DELETE' });
        if (res.ok) { toast.success(t('appointments.deleted')); void loadSchedules(); }
        else toast.error(t('appointments.deleteFailed'));
    };

    const handleToggleActive = async (s: Schedule) => {
        const res = await fetch(`/api/appointments/schedules/${s.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive: !s.isActive }),
        }).catch(() => null);
        if (!res?.ok) toast.error(t('appointments.saveFailed'));
        void loadSchedules();
    };

    const handleCopy = (id: string) => {
        navigator.clipboard.writeText(buildBookingUrl(id));
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
        toast.success(t('appointments.linkCopied'));
    };

    const handleFixMeetRooms = async () => {
        setFixingRooms(true);
        try {
            const res = await fetch('/api/google/fix-meet-rooms', { method: 'POST' });
            const data = await res.json();
            if (!res.ok) {
                if (data.error === 'missing_scope') {
                    toast.error(t('appointments.meet.missingScope'));
                } else {
                    toast.error(data.error || t('appointments.meet.openError'));
                }
                return;
            }
            if (data.total === 0) {
                toast.info(t('appointments.meet.none'));
            } else if (data.failed === 0) {
                toast.success(t(pluralKey('appointments.meet.opened', data.patched), { n: data.patched }));
            } else if (data.patched > 0) {
                toast.warning(t('appointments.meet.partial', { patched: data.patched, total: data.total, failed: data.failed }));
            } else {
                // All failed — check first error for diagnosis
                const firstError = data.rooms?.find((r: any) => r.error)?.error || '';
                const is403 = firstError.includes('403') || firstError.includes('PERMISSION_DENIED');
                toast.error(is403
                    ? t('appointments.meet.noPermission')
                    : t('appointments.meet.allFailed', { error: firstError.slice(0, 120) })
                );
            }
        } catch {
            toast.error(t('appointments.meet.serverError'));
        } finally {
            setFixingRooms(false);
        }
    };

    const hasMeetSchedules = schedules.some(s => s.conferencing === 'meet');

    return (
        <div className="flex h-screen overflow-hidden bg-background">
            <div className="hidden md:flex w-64 border-r flex-col shrink-0">
                <Sidebar />
            </div>

            <div className="flex-1 overflow-y-auto">
                <div className="max-w-2xl mx-auto px-6 py-10">
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <h1 className="text-xl font-bold">{t('appointments.title')}</h1>
                            <p className="text-muted-foreground text-sm mt-0.5">{t('appointments.subtitle')}</p>
                        </div>
                        <div className="flex items-center gap-2">
                            {hasMeetSchedules && (
                                <button
                                    onClick={handleFixMeetRooms}
                                    disabled={fixingRooms}
                                    className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium border hover:bg-muted transition-colors disabled:opacity-50"
                                    title={t('appointments.fixRoomsTitle')}
                                >
                                    {fixingRooms
                                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                        : <Video className="h-3.5 w-3.5" aria-hidden="true" />}
                                    {t('appointments.fixRooms')}
                                </button>
                            )}
                            <button
                                onClick={() => { setEditTarget(null); setShowForm(true); }}
                                className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
                            >
                                <Plus className="h-4 w-4" aria-hidden="true" /> {t('appointments.newSchedule')}
                            </button>
                        </div>
                    </div>

                    {loading ? (
                        <div className="space-y-3">
                            {[1, 2].map(i => <div key={i} className="h-24 rounded-2xl bg-muted/30 animate-pulse" />)}
                        </div>
                    ) : schedules.length === 0 ? (
                        <div className="rounded-2xl border-2 border-dashed p-12 text-center">
                            <CalendarDays className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                            <p className="font-medium">{t('appointments.emptyTitle')}</p>
                            <p className="text-sm text-muted-foreground mt-1">{t('appointments.emptyHelp')}</p>
                            <button
                                onClick={() => { setEditTarget(null); setShowForm(true); }}
                                className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                            >
                                <Plus className="h-4 w-4" aria-hidden="true" /> {t('appointments.form.create')}
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {schedules.map(s => {
                                const c = safeAgendaColor(s.color, brandColor);
                                const soft = agendaSoft(c, surface.background, 0.07);
                                // Color como texto/icono: corregido para leerse sobre el fondo y sobre el tinte de la tarjeta.
                                const accent = agendaAccentText(c, [surface.background, soft.background]);
                                return (
                                    <div key={s.id}
                                        className="rounded-2xl p-5 flex items-start gap-4 transition-shadow hover:shadow-sm"
                                        style={{ backgroundColor: soft.background, border: `1.5px solid ${soft.border}` }}>
                                        <div className="h-10 w-10 rounded-xl shrink-0 flex items-center justify-center shadow-sm"
                                            style={{ backgroundColor: c, color: agendaTextOn(c) }}>
                                            <Clock className="h-5 w-5" aria-hidden="true" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-semibold truncate">{s.name}</span>
                                                {!s.isActive && (
                                                    <span className="text-xs px-2 py-0.5 rounded-full bg-background text-muted-foreground border border-border">
                                                        {t('appointments.inactive')}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                                                <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden="true" />{t('appointments.minutes', { n: s.duration })}</span>
                                                {s.conferencing && (
                                                    <span className="flex items-center gap-1">
                                                        <Video className="h-3.5 w-3.5" />
                                                        {PROVIDER_INFO[providerFromLegacyValue(s.conferencing) ?? 'zoom'].name}
                                                    </span>
                                                )}
                                                {!!s._count?.bookings && <span>{t('appointments.upcoming', { n: s._count.bookings })}</span>}
                                            </div>
                                            <div className="mt-1.5 text-xs truncate" style={{ color: accent }}>
                                                <a href={buildBookingUrl(s.id)} target="_blank" rel="noopener noreferrer" className="hover:underline truncate">
                                                    {buildBookingUrl(s.id)}
                                                </a>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-0.5 shrink-0">
                                            <button type="button" onClick={() => handleCopy(s.id)}
                                                className="p-2.5 rounded-lg hover:bg-background text-muted-foreground transition-colors" title={t('appointments.copyLink')} aria-label={t('appointments.copyLinkNamed', { name: s.name })}>
                                                {copiedId === s.id ? <Check className="h-4 w-4 text-success" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                                            </button>
                                            <a href={buildBookingUrl(s.id)} target="_blank" rel="noopener noreferrer"
                                                className="p-2.5 rounded-lg hover:bg-background text-muted-foreground transition-colors" title={t('appointments.open')} aria-label={t('appointments.openNamed', { name: s.name })}>
                                                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                                            </a>
                                            <button type="button" onClick={() => handleToggleActive(s)}
                                                role="switch" aria-checked={s.isActive}
                                                className="p-2.5 rounded-lg hover:bg-background text-muted-foreground transition-colors"
                                                title={s.isActive ? t('appointments.deactivate') : t('appointments.activate')} aria-label={t(s.isActive ? 'appointments.deactivateNamed' : 'appointments.activateNamed', { name: s.name })}>
                                                {s.isActive
                                                    ? <ToggleRight className="h-4 w-4" style={{ color: accent }} aria-hidden="true" />
                                                    : <ToggleLeft className="h-4 w-4" aria-hidden="true" />}
                                            </button>
                                            <button type="button" onClick={() => { setEditTarget(s); setShowForm(true); }}
                                                className="p-2.5 rounded-lg hover:bg-background text-muted-foreground transition-colors" title={t('appointments.edit')} aria-label={t('appointments.editNamed', { name: s.name })}>
                                                <Pencil className="h-4 w-4" aria-hidden="true" />
                                            </button>
                                            <button type="button" onClick={() => handleDelete(s.id)}
                                                className="p-2.5 rounded-lg hover:bg-background text-destructive transition-colors" title={t('common.delete')} aria-label={t('appointments.deleteNamed', { name: s.name })}>
                                                <Trash2 className="h-4 w-4" aria-hidden="true" />
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
