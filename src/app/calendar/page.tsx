'use client';

import { useEffect, useMemo, useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { ExtensionLoader } from '@/components/expansions/ExtensionLoader';
import { Bell, CalendarDays, Menu, Plus } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';

type CalendarRecord = {
    id: string;
    name: string;
    color: string;
    source: string;
    isReadOnly: boolean;
};

type CalendarEventRecord = {
    id: string;
    title: string;
    location?: string | null;
    startsAt: string;
    endsAt: string;
    calendar: CalendarRecord;
    responseStatus?: string | null;
};

export default function CalendarPage() {
    const [calendars, setCalendars] = useState<CalendarRecord[]>([]);
    const [events, setEvents] = useState<CalendarEventRecord[]>([]);
    const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([]);
    const [isGoogleLinked, setIsGoogleLinked] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [notificationsEnabled, setNotificationsEnabled] = useState(false);
    const [title, setTitle] = useState('');
    const [location, setLocation] = useState('');
    const [startsAt, setStartsAt] = useState('');
    const [endsAt, setEndsAt] = useState('');

    const loadData = async () => {
        const [calendarResponse, eventResponse, settingsResponse] = await Promise.all([
            fetch('/api/calendars'),
            fetch(`/api/calendar/events?start=${encodeURIComponent(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())}&end=${encodeURIComponent(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString())}`),
            fetch('/api/settings'),
        ]);

        const calendarData = await calendarResponse.json();
        const eventData = await eventResponse.json();
        const settingsData = await settingsResponse.json();

        setCalendars(Array.isArray(calendarData) ? calendarData : []);
        setEvents(Array.isArray(eventData) ? eventData : []);
        setIsGoogleLinked(Boolean(settingsData?.isGoogleLinked));
        setSelectedCalendarIds((current) => current.length > 0 ? current : (Array.isArray(calendarData) ? calendarData.map((calendar: CalendarRecord) => calendar.id) : []));
    };

    useEffect(() => {
        void loadData();
        setNotificationsEnabled(typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted');

        const handleSyncComplete = () => {
            void loadData();
        };

        const handleNotificationsEnabled = async () => {
            setNotificationsEnabled(true);
            const settingsResponse = await fetch('/api/settings', { cache: 'no-store' });
            const settingsData = await settingsResponse.json().catch(() => ({}));

            void fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    expansionSettings: {
                        ...(settingsData?.expansionSettings || {}),
                        calendarNotificationsEnabled: true,
                    },
                }),
            }).catch(() => undefined);
        };

        window.addEventListener('bloomx:calendar-sync-complete', handleSyncComplete);
        window.addEventListener('bloomx:notifications-enabled', handleNotificationsEnabled);
        return () => {
            window.removeEventListener('bloomx:calendar-sync-complete', handleSyncComplete);
            window.removeEventListener('bloomx:notifications-enabled', handleNotificationsEnabled);
        };
    }, []);

    const visibleEvents = useMemo(() => {
        return events.filter((event) => selectedCalendarIds.includes(event.calendar.id));
    }, [events, selectedCalendarIds]);

    const groupedEvents = useMemo(() => {
        return visibleEvents.reduce<Record<string, CalendarEventRecord[]>>((accumulator, event) => {
            const dayKey = new Date(event.startsAt).toDateString();
            accumulator[dayKey] = accumulator[dayKey] || [];
            accumulator[dayKey].push(event);
            return accumulator;
        }, {});
    }, [visibleEvents]);

    const createEvent = async (e: React.FormEvent) => {
        e.preventDefault();
        const localCalendar = calendars.find((calendar) => calendar.source === 'local' && !calendar.isReadOnly);
        if (!localCalendar || !title || !startsAt || !endsAt) {
            return;
        }

        await fetch('/api/calendar/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                calendarId: localCalendar.id,
                title,
                location,
                startsAt,
                endsAt,
            })
        });

        setTitle('');
        setLocation('');
        setStartsAt('');
        setEndsAt('');
        await loadData();
    };

    return (
        <div className="flex min-h-screen bg-background">
            <AnimatePresence>
                {isSidebarOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsSidebarOpen(false)}
                            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
                        />
                        <motion.div
                            initial={{ x: '-100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '-100%' }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            className="fixed inset-y-0 left-0 z-50 w-[80%] max-w-[300px] border-r bg-background shadow-2xl md:hidden"
                        >
                            <Sidebar onClose={() => setIsSidebarOpen(false)} />
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
            <div className="hidden w-[280px] border-r md:block">
                <Sidebar />
            </div>
            <main className="flex-1 p-6 md:p-8">
                <div className="mx-auto flex max-w-6xl flex-col gap-8">
                    <div className="sticky top-0 z-30 -mx-2 flex items-center justify-between rounded-2xl border bg-background/90 px-4 py-3 backdrop-blur md:hidden">
                        <button type="button" onClick={() => setIsSidebarOpen(true)} className="rounded-full p-2 text-muted-foreground hover:bg-muted">
                            <Menu className="h-5 w-5" />
                        </button>
                        <div className="text-sm font-semibold text-slate-900">Agenda</div>
                        <button
                            type="button"
                            onClick={() => window.dispatchEvent(new CustomEvent('bloomx:enable-notifications'))}
                            className="rounded-full p-2 text-muted-foreground hover:bg-muted"
                            aria-label="Enable calendar notifications"
                        >
                            <Bell className={`h-5 w-5 ${notificationsEnabled ? 'text-emerald-600' : ''}`} />
                        </button>
                    </div>

                    <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center justify-between gap-3 text-slate-900">
                            <div className="flex items-center gap-3">
                                <CalendarDays className="h-6 w-6" />
                                <h1 className="text-2xl font-semibold">Agenda</h1>
                            </div>
                            <div className="flex flex-wrap items-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => window.dispatchEvent(new CustomEvent('bloomx:enable-notifications'))}
                                    className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                                >
                                    <Bell className={`h-4 w-4 ${notificationsEnabled ? 'text-emerald-600' : ''}`} />
                                    {notificationsEnabled ? 'Event notifications on' : 'Enable event notifications'}
                                </button>
                                <ExtensionLoader
                                    mountPoint="CALENDAR_HEADER"
                                    context={{
                                        isGoogleLinked,
                                        calendarCount: calendars.length,
                                        selectedCalendarIds,
                                        visibleEventCount: visibleEvents.length,
                                    }}
                                />
                            </div>
                        </div>
                        <p className="text-sm text-muted-foreground">Calendarios locales, invitaciones compartidas y feriados en una sola vista.</p>
                        {!isGoogleLinked && (
                            <p className="text-sm text-muted-foreground">Vincula Google desde configuración para importar calendarios y contactos.</p>
                        )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {calendars.map((calendar) => {
                            const active = selectedCalendarIds.includes(calendar.id);
                            return (
                                <button
                                    key={calendar.id}
                                    type="button"
                                    onClick={() => setSelectedCalendarIds((current) => current.includes(calendar.id) ? current.filter((id) => id !== calendar.id) : [...current, calendar.id])}
                                    className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium"
                                    style={{ borderColor: calendar.color, backgroundColor: active ? `${calendar.color}18` : 'transparent', color: calendar.color }}
                                >
                                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: calendar.color }} />
                                    {calendar.name}
                                </button>
                            );
                        })}
                    </div>

                    <div className="grid gap-8 lg:grid-cols-[320px,1fr]">
                        <div className="space-y-4">
                            <div className="rounded-3xl border bg-white p-5 shadow-sm">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="text-sm font-medium text-slate-900">Event reminders</div>
                                        <p className="mt-1 text-sm text-muted-foreground">
                                            Use the service worker to alert you before upcoming events.
                                        </p>
                                    </div>
                                    <Bell className={`h-5 w-5 ${notificationsEnabled ? 'text-emerald-600' : 'text-slate-400'}`} />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => window.dispatchEvent(new CustomEvent('bloomx:enable-notifications'))}
                                    className="mt-4 w-full rounded-xl border px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                                >
                                    {notificationsEnabled ? 'Notifications enabled' : 'Connect browser notifications'}
                                </button>
                            </div>

                            <ExtensionLoader
                                mountPoint="CALENDAR_SIDEBAR"
                                context={{
                                    isGoogleLinked,
                                    calendarCount: calendars.length,
                                    selectedCalendarIds,
                                    visibleEventCount: visibleEvents.length,
                                }}
                            />

                            <form onSubmit={createEvent} className="rounded-3xl border bg-white p-5 shadow-sm">
                                <div className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-900">
                                    <Plus className="h-4 w-4" /> New event
                                </div>
                                <div className="space-y-3">
                                    <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Event title" className="h-11 w-full rounded-xl border px-3 text-sm" />
                                    <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Location" className="h-11 w-full rounded-xl border px-3 text-sm" />
                                    <input value={startsAt} onChange={(event) => setStartsAt(event.target.value)} type="datetime-local" className="h-11 w-full rounded-xl border px-3 text-sm" />
                                    <input value={endsAt} onChange={(event) => setEndsAt(event.target.value)} type="datetime-local" className="h-11 w-full rounded-xl border px-3 text-sm" />
                                    <button type="submit" className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground">Create event</button>
                                </div>
                            </form>
                        </div>

                        <div className="space-y-6">
                            {Object.keys(groupedEvents).length === 0 && (
                                <div className="rounded-3xl border border-dashed p-8 text-center text-sm text-muted-foreground">No events in the selected range.</div>
                            )}

                            {Object.entries(groupedEvents).map(([dayKey, dayEvents]) => (
                                <section key={dayKey} className="rounded-3xl border bg-white p-5 shadow-sm">
                                    <h2 className="text-base font-semibold text-slate-900">{formatDate(new Date(dayKey).toISOString())}</h2>
                                    <div className="mt-4 space-y-3">
                                        {dayEvents.map((event) => (
                                            <div key={event.id} className="rounded-2xl border p-4">
                                                <div className="flex items-center justify-between gap-3">
                                                    <div>
                                                        <div className="font-medium text-slate-900">{event.title}</div>
                                                        <div className="text-sm text-muted-foreground">{formatDate(event.startsAt)} - {formatDate(event.endsAt)}</div>
                                                    </div>
                                                    <span className="rounded-full px-2 py-1 text-xs font-medium" style={{ backgroundColor: `${event.calendar.color}18`, color: event.calendar.color }}>
                                                        {event.calendar.name}
                                                    </span>
                                                </div>
                                                {event.location && <div className="mt-2 text-sm text-muted-foreground">{event.location}</div>}
                                                {event.responseStatus && <div className="mt-2 text-xs uppercase tracking-wide text-muted-foreground">RSVP: {event.responseStatus}</div>}
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            ))}
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}