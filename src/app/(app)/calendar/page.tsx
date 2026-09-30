'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAppSidebar } from '@/components/layout/AppShell';
import { ExtensionLoader } from '@/components/expansions/ExtensionLoader';
import { useGlobalWindow } from '@/contexts/GlobalWindowContext';
import { CreateEventForm } from '@/components/calendar/CreateEventForm';
import { AddCalendarForm } from '@/components/calendar/AddCalendarForm';
import { Bell, CalendarDays, Menu, Plus, ChevronLeft, ChevronRight, Settings, Search, HelpCircle, User, Check, ChevronDown } from 'lucide-react';
import { agendaTextOn, safeAgendaColor } from '@/lib/agenda-color';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { useI18n } from '@/components/I18nProvider';
import { hourLabel, monthName, weekdayName } from '@/lib/i18n/format';

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
    attendees?: { email: string; name?: string | null; isOrganizer?: boolean; responseStatus?: string | null }[];
};

// theme-lint-ignore: color de USUARIO del calendario de festivos (dato; el texto se calcula por contraste)
const HOLIDAY_CALENDAR_COLOR = '#00897B';

export default function CalendarPage() {
    const { t, intlLocale } = useI18n();
    const fmtTime = (value: string | Date) =>
        new Intl.DateTimeFormat(intlLocale, { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
    const fmtDayTitle = (d: Date) =>
        new Intl.DateTimeFormat(intlLocale, { weekday: 'long', day: 'numeric', month: 'short' }).format(d);
    const holidaysCalendarName = (code: string) => t('calendar.holidaysCalendar', { code });
    const [viewMode, setViewMode] = useState('Month');
    const [calendars, setCalendars] = useState<CalendarRecord[]>([]);
    const [events, setEvents] = useState<CalendarEventRecord[]>([]);
    const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([]);
    const [isGoogleLinked, setIsGoogleLinked] = useState(false);
    const [holidayCountries, setHolidayCountries] = useState<string[]>([]);
    const [holidays, setHolidays] = useState<CalendarEventRecord[]>([]);
    const { mode: sidebarMode, openDrawer } = useAppSidebar();
    const [isCalSidebarOpen, setIsCalSidebarOpen] = useState(false);
    const [notificationsEnabled, setNotificationsEnabled] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [startsAt, setStartsAt] = useState('');
    const [endsAt, setEndsAt] = useState('');
    const [moreList, setMoreList] = useState<{ title: string; events: CalendarEventRecord[] } | null>(null);
    const [ghostEvents, setGhostEvents] = useState<Array<{
        title: string;
        startsAt: string;
        endsAt: string;
        attendeeEmail: string;
        attendeeName: string | null;
    }>>([]);
    const { openWindow, closeWindow } = useGlobalWindow();

    const currentDate = new Date();
    const [currentMonth, setCurrentMonth] = useState(currentDate.getMonth());
    const [currentYear, setCurrentYear] = useState(currentDate.getFullYear());

    const handleOpenCreate = (st: string, en: string) => {
        setStartsAt(st);
        setEndsAt(en);
        setIsCreating(true);
        openWindow({
            id: 'create-event',
            type: 'event',
            title: t('calendar.createEvent'),
            icon: <CalendarDays className="w-4 h-4" />,
            content: (
                <CreateEventForm
                    initialStartsAt={st}
                    initialEndsAt={en}
                    onSaved={() => {
                        closeWindow('create-event');
                        setIsCreating(false);
                        setStartsAt('');
                        setEndsAt('');
                        void loadData();
                    }}
                    onClose={() => {
                        closeWindow('create-event');
                        setIsCreating(false);
                        setStartsAt('');
                        setEndsAt('');
                    }}
                />
            )
        });
    };

    const handleOpenEvent = (event: CalendarEventRecord, e: React.MouseEvent) => {
        e.stopPropagation(); // prevent triggering the container double-click
        openWindow({
            id: `event-${event.id}`,
            type: 'event',
            title: event.calendar.isReadOnly ? t('calendar.viewEvent') : t('calendar.editEvent'),
            icon: <CalendarDays className="w-4 h-4" />,
            content: (
                <CreateEventForm
                    eventId={event.id}
                    calendarId={event.calendar.id}
                    initialTitle={event.title}
                    initialLocation={event.location || ''}
                    initialStartsAt={event.startsAt}
                    initialEndsAt={event.endsAt}
                    initialAttendees={event.attendees?.filter(a => !a.isOrganizer).map(a => a.email) || []}
                    initialAttendeeDetails={event.attendees || []}
                    isReadOnly={event.calendar.isReadOnly}
                    onSaved={() => {
                        closeWindow(`event-${event.id}`);
                        void loadData();
                    }}
                    onClose={() => closeWindow(`event-${event.id}`)}
                />
            )
        });
    };

    const handleToggleHolidayProvider = (code: string) => {
        setHolidayCountries(prev => {
            const newCountries = prev.includes(code)
                ? prev.filter(c => c !== code)
                : [...prev, code];
            
            localStorage.setItem('bloomx_holiday_countries', JSON.stringify(newCountries));
            
            if (prev.includes(code)) {
                // If it was removed, also remove from selected calendars so events hide locally
                setSelectedCalendarIds(selected => selected.filter(id => id !== `holidays-${code}`));
            } else {
                // Enable it by default when added
                setSelectedCalendarIds(selected => [...selected, `holidays-${code}`]);
            }
            
            return newCountries;
        });
    };

    const handleOpenAddCalendar = () => {
        openWindow({
            id: 'add-calendar',
            type: 'event', // You can use standard floating window UI styles
            title: t('calendar.addCalendar'),
            icon: <Plus className="w-4 h-4" />,
            content: (
                <AddCalendarForm 
                    isGoogleLinked={isGoogleLinked} 
                    currentHolidayProviders={holidayCountries}
                    onToggleHolidayProvider={handleToggleHolidayProvider}
                    onLocalCreate={() => {
                        // TODO: Provide UI to create local calendar if not using the default one
                        // Usually you might trigger an API `/api/calendars` POST and reload
                        toast.info(t('calendar.localCreateSoon'));
                    }} 
                />
            )
        });
    };

    const loadData = async () => {
        const [calendarResponse, eventResponse, settingsResponse] = await Promise.all([
            fetch('/api/calendars'),
            fetch(`/api/calendar/events?start=${encodeURIComponent(new Date(currentYear, currentMonth - 1, 1).toISOString())}&end=${encodeURIComponent(new Date(currentYear, currentMonth + 2, 0).toISOString())}`),
            fetch('/api/settings'),
        ]);

        const calendarData = await calendarResponse.json();
        const eventData = await eventResponse.json();
        const settingsData = await settingsResponse.json();

        setCalendars(Array.isArray(calendarData) ? calendarData : []);
        setEvents(Array.isArray(eventData) ? eventData : []);
        setIsGoogleLinked(Boolean(settingsData?.isGoogleLinked));
        
        // Wait for holiday countries to also resolve the IDs or check missing selected states
        setSelectedCalendarIds((current) => current.length > 0 ? current : (Array.isArray(calendarData) ? [...calendarData.map((c: CalendarRecord) => c.id)] : []));
    };

    useEffect(() => {
        // Force include holidays on first load if missing from selection but exists in fetched list (meaning clean state)
        if (holidayCountries.length > 0 && selectedCalendarIds.length === calendars.length && calendars.length > 0) {
            const holsIds = holidayCountries.map(c => `holidays-${c}`);
            const missing = holsIds.filter(id => !selectedCalendarIds.includes(id));
            if (missing.length > 0) {
                setSelectedCalendarIds(prev => [...prev, ...missing]);
            }
        }
    }, [holidayCountries, calendars.length, selectedCalendarIds.length]);

    useEffect(() => {
        void loadData();
        setNotificationsEnabled(typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted');

        // Load holiday countries from storage or default to IP/Peru
        const savedHolidays = localStorage.getItem('bloomx_holiday_countries');
        if (savedHolidays) {
            try {
                const parsed = JSON.parse(savedHolidays);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    setHolidayCountries(parsed);
                } else {
                    throw new Error('invalid format');
                }
            } catch {
                setHolidayCountries(['PE']);
            }
        } else {
            const fetchCountry = async () => {
                 try {
                     const res = await fetch('https://ipapi.co/json/');
                     const data = await res.json();
                     if (data.country_code) {
                         setHolidayCountries(['PE', data.country_code]); // Always include PE based on user request as default alongside IP
                     } else {
                         setHolidayCountries(['PE']);
                     }
                 } catch(e) {
                     setHolidayCountries(['PE']); // Default fallback
                 }
            }
            void fetchCountry();
        }

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

        const handleGhostEvents = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (Array.isArray(detail?.events)) setGhostEvents(detail.events);
        };

        window.addEventListener('bloomx:calendar-sync-complete', handleSyncComplete);
        window.addEventListener('bloomx:notifications-enabled', handleNotificationsEnabled);
        window.addEventListener('bloomx:attendee-ghost-events', handleGhostEvents);
        return () => {
            window.removeEventListener('bloomx:calendar-sync-complete', handleSyncComplete);
            window.removeEventListener('bloomx:notifications-enabled', handleNotificationsEnabled);
            window.removeEventListener('bloomx:attendee-ghost-events', handleGhostEvents);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentMonth, currentYear]);

    useEffect(() => {
        if (!holidayCountries.length) return;
        
        const fetchHols = async () => {
            try {
                const allFetchedHolidays: CalendarEventRecord[] = [];
                
                await Promise.all(holidayCountries.map(async (code) => {
                    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${currentYear}/${code}`);
                    if (res.ok) {
                        const data = await res.json();
                        const holidayCal: CalendarRecord = { id: `holidays-${code}`, name: holidaysCalendarName(code), color: HOLIDAY_CALENDAR_COLOR, source: 'public', isReadOnly: true };
                        const parsed = data.map((h: any) => ({
                            id: `hol-${code}-${h.date}-${h.name}`,
                            title: h.name,
                            startsAt: `${h.date}T00:00:00`,
                            endsAt: `${h.date}T23:59:59`,
                            calendar: holidayCal,
                        }));
                        allFetchedHolidays.push(...parsed);
                    }
                }));
                
                setHolidays(allFetchedHolidays);
            } catch(e) {}
        }
        void fetchHols();
    }, [holidayCountries, currentYear]);

    const allCalendars = useMemo(() => {
        const holidayCals = holidayCountries.map(code => ({
            id: `holidays-${code}`, 
            name: holidaysCalendarName(code),
            color: HOLIDAY_CALENDAR_COLOR,
            source: 'public', 
            isReadOnly: true 
        }));
        return [...calendars, ...holidayCals];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [calendars, holidayCountries, intlLocale]);

    const allEvents = useMemo(() => {
        return [...events, ...holidays];
    }, [events, holidays]);

    const visibleEvents = useMemo(() => {
        const filtered = allEvents.filter((event) => selectedCalendarIds.includes(event.calendar.id));
        // User events come first in allEvents ([...events, ...holidays]), so they win dedup
        const seen = new Map<string, boolean>();
        return filtered.filter((event) => {
            const key = `${String(event.title || '').toLowerCase().trim()}|${event.startsAt}`;
            if (seen.has(key)) return false;
            seen.set(key, true);
            return true;
        });
    }, [allEvents, selectedCalendarIds]);

    const nextMonth = () => { if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(currentYear + 1); } else { setCurrentMonth(currentMonth + 1); } };
    const prevMonth = () => { if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(currentYear - 1); } else { setCurrentMonth(currentMonth - 1); } };
    const setToday = () => { const now = new Date(); setCurrentMonth(now.getMonth()); setCurrentYear(now.getFullYear()); };

    const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
    const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

    // ── Time-grid layout (Day / Week views) ─────────────────────────────────
    const HOUR_PX = 48;            // pixels per hour row
    const MAX_LANES = 3;           // max side-by-side overlapping events before "+N"

    const isHoliday = (ev: CalendarEventRecord) => ev.calendar.id.startsWith('holidays') || (ev.calendar as any).source === 'holidays';

    const sameDay = (a: Date, b: Date) =>
        a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

    const eventsOnDate = (date: Date) =>
        visibleEvents.filter((ev) => {
            const d = new Date(ev.startsAt);
            return !isHoliday(ev) && sameDay(d, date);
        });

    type Positioned = { ev: CalendarEventRecord; top: number; height: number; lane: number; lanes: number };

    const layoutDay = (evts: CalendarEventRecord[]): Positioned[] => {
        const items = [...evts].sort((a, b) =>
            new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime() ||
            new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime()
        );
        const res: Positioned[] = [];
        let cluster: CalendarEventRecord[] = [];
        let clusterEnd = 0;

        const flush = () => {
            if (!cluster.length) return;
            const cols: number[] = [];               // last end-time per column
            const laneOf = new Map<string, number>();
            cluster.forEach((ev) => {
                const s = new Date(ev.startsAt).getTime();
                let placed = cols.findIndex((end) => end <= s);
                if (placed === -1) { placed = cols.length; cols.push(0); }
                cols[placed] = new Date(ev.endsAt).getTime();
                laneOf.set(ev.id, placed);
            });
            const lanes = cols.length;
            cluster.forEach((ev) => {
                const s = new Date(ev.startsAt);
                const e = new Date(ev.endsAt);
                const startMin = s.getHours() * 60 + s.getMinutes();
                let endMin = sameDay(s, e) ? e.getHours() * 60 + e.getMinutes() : 24 * 60;
                endMin = Math.max(endMin, startMin + 20);   // min visible height
                res.push({ ev, top: (startMin / 60) * HOUR_PX, height: ((endMin - startMin) / 60) * HOUR_PX, lane: laneOf.get(ev.id)!, lanes });
            });
            cluster = [];
            clusterEnd = 0;
        };

        items.forEach((ev) => {
            const s = new Date(ev.startsAt).getTime();
            if (cluster.length && s >= clusterEnd) flush();
            cluster.push(ev);
            clusterEnd = Math.max(clusterEnd, new Date(ev.endsAt).getTime());
        });
        flush();
        return res;
    };

    const renderDayColumn = (date: Date) => {
        const positioned = layoutDay(eventsOnDate(date));
        const visible = positioned.filter((p) => p.lane < MAX_LANES);
        const hidden = positioned.filter((p) => p.lane >= MAX_LANES);

        // group hidden events into a single "+N" chip per overlapping hour bucket
        const hiddenByBucket = new Map<number, CalendarEventRecord[]>();
        hidden.forEach((p) => {
            const bucket = Math.floor(p.top / HOUR_PX);
            const arr = hiddenByBucket.get(bucket) || [];
            arr.push(p.ev);
            hiddenByBucket.set(bucket, arr);
        });

        return (
            <>
                {visible.map((p) => {
                    const lanes = Math.min(p.lanes, MAX_LANES);
                    const widthPct = 100 / lanes;
                    const hol = isHoliday(p.ev);
                    return (
                        <div
                            key={p.ev.id}
                            onClick={(e) => handleOpenEvent(p.ev, e)}
                            title={p.ev.title}
                            className={`absolute overflow-hidden rounded-md px-1.5 py-0.5 text-[11px] font-medium shadow-sm cursor-pointer hover:brightness-95 ${hol ? 'text-foreground bg-success/15 border border-success/30' : ''}`}
                            style={{
                                top: p.top,
                                height: Math.max(p.height - 2, 16),
                                left: `calc(${p.lane * widthPct}% + 2px)`,
                                width: `calc(${widthPct}% - 4px)`,
                                backgroundColor: hol ? undefined : safeAgendaColor(p.ev.calendar.color),
                                color: hol ? undefined : agendaTextOn(p.ev.calendar.color),
                                zIndex: 5,
                            }}
                        >
                            <div className="truncate leading-tight">
                                {fmtTime(p.ev.startsAt)} {p.ev.title}
                            </div>
                        </div>
                    );
                })}
                {Array.from(hiddenByBucket.entries()).map(([bucket, evs]) => (
                    <button
                        key={`more-${bucket}`}
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            setMoreList({ title: fmtDayTitle(date), events: eventsOnDate(date) });
                        }}
                        className="absolute right-1 z-10 rounded bg-foreground/80 px-1.5 py-0.5 text-[11px] font-semibold text-background shadow hover:bg-foreground"
                        style={{ top: bucket * HOUR_PX + 2 }}
                    >
                        +{evs.length}
                    </button>
                ))}
            </>
        );
    };

    const renderMonthGrid = () => {
        const daysInMonth = getDaysInMonth(currentYear, currentMonth);
        const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
        const days: React.ReactNode[] = [];
        
        days.push(...[0, 1, 2, 3, 4, 5, 6].map(h => (
            <div key={`h-${h}`} className="text-center text-[11px] font-medium text-muted-foreground py-2 border-r border-border border-b uppercase">
                {weekdayName(h, intlLocale, 'short')}
            </div>
        )));

        for (let i = 0; i < firstDay; i++) {
            days.push(<div key={`empty-${i}`} className="min-h-[100px] border-r border-border border-b bg-muted/50"></div>);
        }

        for (let i = 1; i <= daysInMonth; i++) {
            const isToday = i === currentDate.getDate() && currentMonth === currentDate.getMonth() && currentYear === currentDate.getFullYear();
            
            const dayEvents = visibleEvents
                .filter(e => {
                    const eventDate = new Date(e.startsAt);
                    return eventDate.getDate() === i && eventDate.getMonth() === currentMonth && eventDate.getFullYear() === currentYear;
                })
                .sort((a, b) => {
                    const aHol = a.calendar.id.startsWith('holidays') || (a.calendar as any).source === 'holidays';
                    const bHol = b.calendar.id.startsWith('holidays') || (b.calendar as any).source === 'holidays';
                    if (aHol && !bHol) return 1;
                    if (!aHol && bHol) return -1;
                    return 0;
                });
            
            // Check if user is currently creating an event on this day
            let hasGhost = false;
            if (isCreating && startsAt) {
                const creationDate = new Date(startsAt);
                if (creationDate.getDate() === i && creationDate.getMonth() === currentMonth && creationDate.getFullYear() === currentYear) {
                    hasGhost = true;
                }
            }

            const dayGhostEvents = ghostEvents.filter(ge => {
                const d = new Date(ge.startsAt);
                return d.getDate() === i && d.getMonth() === currentMonth && d.getFullYear() === currentYear;
            });

            days.push(
                <div
                    key={`day-${i}`}
                    onDoubleClick={() => {
                        const d = new Date(currentYear, currentMonth, i, 9, 0); // Default to 9:00 AM
                        const dEnd = new Date(d.getTime() + 60 * 60 * 1000);
                        handleOpenCreate(d.toISOString().slice(0, 16), dEnd.toISOString().slice(0, 16));
                    }}
                    className={`min-h-[120px] p-1 border-r border-border border-b cursor-pointer transition-colors hover:bg-muted/50 ${isToday ? 'bg-primary/5' : 'bg-card'}`}
                >
                    <div className="flex justify-center mb-1">
                        <span className={`text-xs flex items-center justify-center h-6 w-6 font-medium rounded-full mt-1 ${isToday ? 'bg-primary text-primary-foreground' : 'text-foreground/80'}`}>
                            {i}
                        </span>
                    </div>
                    <div className="flex flex-col gap-1 px-1 overflow-hidden">
                        {dayEvents.slice(0, 3).map(ev => (
                            <div
                                key={ev.id}
                                onClick={(e) => handleOpenEvent(ev, e)}
                                className={`text-[11px] truncate px-1.5 py-0.5 rounded shadow-sm font-medium cursor-pointer hover:brightness-95 ${ev.calendar.id.startsWith('holidays') ? 'text-foreground bg-success/15 border border-success/30' : ''}`}
                                style={!ev.calendar.id.startsWith('holidays') ? { backgroundColor: safeAgendaColor(ev.calendar.color), color: agendaTextOn(ev.calendar.color) } : {}}
                            >
                                {!ev.calendar.id.startsWith('holidays') && `${fmtTime(ev.startsAt)} `}
                                {ev.title}
                            </div>
                        ))}
                        {dayEvents.length > 3 && (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const d = new Date(currentYear, currentMonth, i);
                                    setMoreList({ title: fmtDayTitle(d), events: dayEvents });
                                }}
                                className="text-[11px] text-left px-1.5 py-0.5 rounded font-semibold text-muted-foreground hover:bg-secondary/70"
                            >
                                {t('calendar.more', { n: dayEvents.length - 3 })}
                            </button>
                        )}
                        {dayGhostEvents.map((ge, idx) => (
                            <div
                                key={`ghost-${idx}`}
                                title={t('calendar.busy', { name: ge.attendeeName || ge.attendeeEmail })}
                                className="text-[11px] truncate px-1.5 py-0.5 rounded border border-dashed border-input bg-muted text-muted-foreground opacity-60 font-medium pointer-events-none select-none"
                            >
                                {fmtTime(ge.startsAt)} {ge.attendeeName || ge.attendeeEmail.split('@')[0]}
                            </div>
                        ))}
                        {hasGhost && (
                            <div className="text-[11px] truncate px-1.5 py-0.5 rounded shadow-sm font-medium bg-primary/10 text-primary border border-primary/20 border-dashed opacity-80 animate-pulse">
                                {fmtTime(startsAt)} {t('calendar.newEventGhost')}
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        const remainder = (firstDay + daysInMonth) % 7;
        if (remainder > 0 && remainder !== 7) {
            for (let i = 0; i < 7 - remainder; i++) {
                days.push(<div key={`rem-${i}`} className="min-h-[100px] border-r border-border border-b bg-muted/50"></div>);
            }
        }

        return days;
    };

    const monthNames = Array.from({ length: 12 }, (_, m) => monthName(m, intlLocale));
    const narrowDays = [0, 1, 2, 3, 4, 5, 6].map((d) => weekdayName(d, intlLocale, 'narrow'));
    const toggleCalendar = (id: string) => setSelectedCalendarIds(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);

    const miniCalendarDays = useMemo(() => {
        const daysInMonth = getDaysInMonth(currentYear, currentMonth);
        const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
        const prevMonthDays = getDaysInMonth(currentMonth === 0 ? currentYear - 1 : currentYear, currentMonth === 0 ? 11 : currentMonth - 1);
        
        const days = [];
        for (let i = 0; i < firstDay; i++) {
            days.push({ day: prevMonthDays - firstDay + i + 1, isCurrentMonth: false });
        }
        for (let i = 1; i <= daysInMonth; i++) {
            days.push({ day: i, isCurrentMonth: true });
        }
        const remaining = 42 - days.length;
        for (let i = 1; i <= remaining; i++) {
            days.push({ day: i, isCurrentMonth: false });
        }
        return days;
    }, [currentMonth, currentYear]);

    const renderCalendarSidebarContent = () => (
        <>
            <div className="p-4 py-5 px-4 z-10 w-[256px]">
                <button onClick={() => handleOpenCreate(new Date().toISOString().slice(0, 16), new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16))} className="flex items-center justify-center gap-2 bg-primary border border-primary shadow-sm hover:bg-primary/90 hover:shadow-md transition-all rounded-md px-4 py-2.5 w-full group">
                    <Plus className="w-5 h-5 text-primary-foreground" />
                    <span className="text-sm font-medium text-primary-foreground transition-colors">{t('calendar.createEvent')}</span>
                </button>
            </div>

            <div className="px-6 pb-2 w-[256px]">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[13px] font-medium text-foreground/80">{monthNames[currentMonth]} {currentYear}</span>
                    <div className="flex gap-1">
                        <button type="button" onClick={prevMonth} aria-label={t('calendar.prevMonth')} className="text-muted-foreground hover:bg-muted rounded">
                            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                        </button>
                        <button type="button" onClick={nextMonth} aria-label={t('calendar.nextMonth')} className="text-muted-foreground hover:bg-muted rounded">
                            <ChevronRight className="w-4 h-4" aria-hidden="true" />
                        </button>
                    </div>
                </div>
                <div className="grid grid-cols-7 gap-1 text-center text-xs mb-1 text-muted-foreground font-medium pb-2" aria-hidden="true">
                    {narrowDays.map((d, i) => <span key={i}>{d}</span>)}
                </div>
                <div className="grid grid-cols-7 gap-y-1 text-center text-xs">
                    {miniCalendarDays.map((dateObj, i) => {
                        const isToday = dateObj.isCurrentMonth && dateObj.day === currentDate.getDate() && currentMonth === currentDate.getMonth() && currentYear === currentDate.getFullYear();
                        return (
                            <div key={i} className={`w-6 h-6 flex items-center justify-center rounded-full mx-auto ${isToday ? 'bg-primary text-primary-foreground' : dateObj.isCurrentMonth ? 'hover:bg-muted text-foreground/80 cursor-pointer' : 'text-muted-foreground'}`}>
                                {dateObj.day}
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="p-4 flex-1 overflow-y-auto w-[256px] border-t border-border/60 mt-2">
                <div className="flex items-center justify-between py-2 text-foreground/80 font-medium px-2 rounded hover:bg-muted/50">
                    <div className="flex items-center gap-2 cursor-pointer flex-1">
                        <span className="text-sm">{t('calendar.myCalendars')}</span>
                        <ChevronRight className="w-4 h-4 transform rotate-90" aria-hidden="true" />
                    </div>
                    <button type="button" onClick={handleOpenAddCalendar} aria-label={t('calendar.addCalendar')} title={t('calendar.addCalendar')} className="p-1 hover:bg-secondary rounded text-muted-foreground">
                        <Plus className="w-4 h-4" aria-hidden="true" />
                    </button>
                </div>
                <div className="pl-2 space-y-1 mt-1">
                    {allCalendars.map(calendar => {
                        const active = selectedCalendarIds.includes(calendar.id);
                        return (
                            <div key={calendar.id} className="flex items-center gap-3 py-1.5 cursor-pointer group px-2 rounded-md hover:bg-muted/50" onClick={() => toggleCalendar(calendar.id)}>
                                <div className="relative flex items-center justify-center w-5 h-5 rounded">
                                    <div className={`w-4 h-4 rounded-sm border-2`} style={{ borderColor: safeAgendaColor(calendar.color), backgroundColor: active ? safeAgendaColor(calendar.color) : 'transparent', color: agendaTextOn(calendar.color) }}>
                                        {active && <Check className="w-3 h-3 absolute inset-0 m-auto stroke-[3]" aria-hidden="true" />}
                                    </div>
                                </div>
                                <span className="text-sm text-foreground/80 truncate">{calendar.name}</span>
                            </div>
                        );
                    })}
                </div>

                <div className="mt-6">
                    <ExtensionLoader mountPoint="CALENDAR_SIDEBAR_BOTTOM" context={{ isGoogleLinked }} />
                </div>
            </div>
        </>
    );

    return (
        <div className="flex h-full w-full bg-background overflow-hidden text-foreground font-sans">
            <div className="flex-1 flex flex-col h-full overflow-hidden">
                <header className="flex h-[64px] items-center justify-between px-4 border-b border-border">
                    <div className="flex items-center gap-4">
                        {sidebarMode === 'drawer' && (
                            <button type="button" onClick={openDrawer} aria-label={t('common.openMenu')} aria-haspopup="dialog" className="p-2 -ml-2 rounded-full hover:bg-muted">
                                <Menu className="w-6 h-6 text-foreground/80" aria-hidden="true" />
                            </button>
                        )}
                        
                        <div className="flex items-center gap-2 pr-2 text-foreground/80">
                            <div className="w-9 h-9 rounded bg-primary flex items-center justify-center font-bold text-primary-foreground shadow-sm">
                                {currentDate.getDate()}
                            </div>
                            <span className="text-xl font-normal tracking-tight hidden sm:block text-foreground/80">{t('calendar.title')}</span>
                        </div>

                        <div className="relative hidden md:flex items-center border border-input rounded-md bg-card hover:bg-muted/50 shadow-sm overflow-hidden h-[36px]">
                            <select 
                                value={viewMode}
                                aria-label={t('calendar.viewLabel')}
                                onChange={(e) => setViewMode(e.target.value)}
                                className="text-sm font-medium text-foreground/80 bg-transparent px-3 py-1 outline-none cursor-pointer appearance-none pr-8 relative h-full"
                            >
                                <option value="Day">{t('calendar.views.day')}</option>
                                <option value="Week">{t('calendar.views.week')}</option>
                                <option value="Month">{t('calendar.views.month')}</option>
                                <option value="Year">{t('calendar.views.year')}</option>
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        </div>

                        <button onClick={setToday} className="border border-input px-4 h-[36px] rounded-md text-sm font-medium text-foreground/80 hover:bg-muted/50 hidden md:block shadow-sm">
                            {t('calendar.today')}
                        </button>

                        <div className="flex items-center gap-1 mx-2">
                            <button type="button" onClick={prevMonth} aria-label={t('calendar.prevMonth')} className="p-2 hover:bg-muted rounded-full transition-colors"><ChevronLeft className="w-5 h-5 text-foreground/80" aria-hidden="true" /></button>
                            <button type="button" onClick={nextMonth} aria-label={t('calendar.nextMonth')} className="p-2 hover:bg-muted rounded-full transition-colors"><ChevronRight className="w-5 h-5 text-foreground/80" aria-hidden="true" /></button>
                        </div>
                        
                        <h2 className="text-xl font-normal text-foreground/80 whitespace-nowrap">
                            {monthNames[currentMonth]} {currentYear}
                        </h2>
                    </div>

                    <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                        <ExtensionLoader mountPoint="CALENDAR_HEADER" context={{ isGoogleLinked }} />
                        <ExtensionLoader mountPoint="CALENDAR_TOOLBAR" context={{ range: { from: new Date(currentYear, currentMonth, 1), to: new Date(currentYear, currentMonth + 1, 0, 23, 59, 59) }, view: viewMode.toLowerCase(), isGoogleLinked }} />
                        <button type="button" onClick={() => setIsCalSidebarOpen(true)} aria-label={t('calendar.calendarsPanel')} className="p-2 hover:bg-muted rounded-full transition-colors text-muted-foreground lg:hidden">
                            <Settings className="w-5 h-5 text-foreground/80" aria-hidden="true" />
                        </button>
                    </div>
                </header>

                <div className="flex flex-1 overflow-hidden">
                    <main className="flex-1 bg-background border-t border-border flex flex-col relative z-0">
                        {/* Create Event is now a floating modal */}

                        {viewMode === 'Month' ? (
                            <div className="flex-1 grid grid-cols-7 grid-rows-[auto_1fr_1fr_1fr_1fr_1fr] overflow-y-auto overflow-x-hidden">
                                {renderMonthGrid()}
                            </div>
                        ) : viewMode === 'Day' ? (
                            <div className="flex-1 overflow-y-auto w-full">
                                <div className="grid grid-cols-[60px_1fr] border-b border-border sticky top-0 z-20 bg-background">
                                    <div className="border-r border-border bg-muted/50" />
                                    <div className="font-semibold text-center py-2 text-foreground/80 bg-muted/50 flex flex-col items-center">
                                        <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">{weekdayName(currentDate.getDay(), intlLocale, 'short')}</span>
                                        <span className="text-lg mt-0.5 w-8 h-8 flex items-center justify-center rounded-full bg-primary text-primary-foreground">{currentDate.getDate()}</span>
                                    </div>
                                </div>
                                <div className="grid grid-cols-[60px_1fr]">
                                    {/* hour labels */}
                                    <div className="select-none">
                                        {Array.from({ length: 24 }).map((_, i) => (
                                            <div key={i} className="text-xs text-muted-foreground text-right pr-2 border-r border-b border-border/60" style={{ height: HOUR_PX }}>
                                                <span className="relative -top-2">{hourLabel(i, intlLocale)}</span>
                                            </div>
                                        ))}
                                    </div>
                                    {/* day column with events */}
                                    <div className="relative" style={{ height: 24 * HOUR_PX }}>
                                        {Array.from({ length: 24 }).map((_, i) => (
                                            <div
                                                key={i}
                                                className="border-b border-border/60 hover:bg-primary/3 cursor-pointer"
                                                style={{ height: HOUR_PX }}
                                                onDoubleClick={() => {
                                                    const d = new Date(currentYear, currentMonth, currentDate.getDate(), i, 0);
                                                    const dEnd = new Date(d.getTime() + 60 * 60 * 1000);
                                                    handleOpenCreate(d.toISOString().slice(0, 16), dEnd.toISOString().slice(0, 16));
                                                }}
                                            />
                                        ))}
                                        {renderDayColumn(new Date(currentYear, currentMonth, currentDate.getDate()))}
                                    </div>
                                </div>
                            </div>
                        ) : viewMode === 'Week' ? (
                            <div className="flex-1 overflow-y-auto w-full">
                                <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border sticky top-0 z-20 bg-background">
                                    <div className="border-r border-border bg-muted/50" />
                                    {[0, 1, 2, 3, 4, 5, 6].map((d, index) => {
                                        const dateOfD = new Date(currentYear, currentMonth, currentDate.getDate() - currentDate.getDay() + index);
                                        const isToday = sameDay(dateOfD, currentDate);
                                        return (
                                            <div key={d} className="font-semibold text-center py-2 text-foreground/80 border-l border-border/60 text-sm bg-muted/50 flex flex-col items-center">
                                                <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">{weekdayName(d, intlLocale, 'short')}</span>
                                                <span className={`text-lg mt-0.5 w-8 h-8 flex items-center justify-center rounded-full ${isToday ? 'bg-primary text-primary-foreground' : 'text-foreground/80'}`}>{dateOfD.getDate()}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="grid grid-cols-[60px_repeat(7,1fr)]">
                                    {/* hour labels */}
                                    <div className="select-none">
                                        {Array.from({ length: 24 }).map((_, i) => (
                                            <div key={i} className="text-xs text-muted-foreground text-right pr-2 border-r border-b border-border/60" style={{ height: HOUR_PX }}>
                                                <span className="relative -top-2">{hourLabel(i, intlLocale)}</span>
                                            </div>
                                        ))}
                                    </div>
                                    {/* 7 day columns */}
                                    {Array.from({ length: 7 }).map((_, j) => {
                                        const colDate = new Date(currentYear, currentMonth, currentDate.getDate() - currentDate.getDay() + j);
                                        return (
                                            <div key={j} className="relative border-l border-border/60" style={{ height: 24 * HOUR_PX }}>
                                                {Array.from({ length: 24 }).map((_, i) => (
                                                    <div
                                                        key={i}
                                                        className="border-b border-border/60 hover:bg-primary/3 cursor-pointer"
                                                        style={{ height: HOUR_PX }}
                                                        onDoubleClick={() => {
                                                            const d = new Date(colDate.getFullYear(), colDate.getMonth(), colDate.getDate(), i, 0);
                                                            const dEnd = new Date(d.getTime() + 60 * 60 * 1000);
                                                            handleOpenCreate(d.toISOString().slice(0, 16), dEnd.toISOString().slice(0, 16));
                                                        }}
                                                    />
                                                ))}
                                                {renderDayColumn(colDate)}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 overflow-y-auto p-8 bg-muted/30">
                                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-8">
                                    {Array.from({length: 12}).map((_, m) => {
                                        const daysInM = getDaysInMonth(currentYear, m);
                                        const firstD = getFirstDayOfMonth(currentYear, m);
                                        return (
                                            <div key={m} className="bg-card p-4 rounded-xl border border-border shadow-sm">
                                                <div className="font-medium text-foreground mb-2">{monthNames[m]}</div>
                                                <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground mb-1">
                                                    {narrowDays.map((d, i) => <span key={i}>{d}</span>)}
                                                </div>
                                                <div className="grid grid-cols-7 gap-y-1 text-center text-xs">
                                                    {Array.from({length: firstD}).map((_, i) => <div key={`e-${i}`} />)}
                                                    {Array.from({length: daysInM}).map((_, i) => {
                                                        const isToday = (i + 1) === currentDate.getDate() && m === currentDate.getMonth() && currentYear === currentDate.getFullYear();
                                                        return (
                                                            <div key={i} className={`w-5 h-5 flex items-center justify-center rounded-full mx-auto ${isToday ? 'bg-primary text-primary-foreground' : 'text-foreground/80 hover:bg-muted'}`}>
                                                                {i + 1}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </main>

                    <aside className="hidden lg:flex bg-background flex-col flex-shrink-0 border-l border-border h-full w-[256px]">
                        {renderCalendarSidebarContent()}
                    </aside>

                    <AnimatePresence initial={false}>
                        {isCalSidebarOpen && (
                            <>
                                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsCalSidebarOpen(false)} className="fixed inset-0 z-[60] bg-overlay backdrop-blur-sm lg:hidden" />
                                <motion.aside
                                    initial={{ x: 256, opacity: 0 }}
                                    animate={{ x: 0, opacity: 1 }}
                                    exit={{ x: 256, opacity: 0 }}
                                    className="bg-card flex flex-col border-l border-border fixed right-0 top-0 bottom-0 z-[70] h-full w-[256px] lg:hidden"
                                >
                                    {renderCalendarSidebarContent()}
                                </motion.aside>
                            </>
                        )}
                    </AnimatePresence>
                </div>
            </div>

            <AnimatePresence>
                {moreList && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            onClick={() => setMoreList(null)}
                            className="fixed inset-0 z-[80] bg-overlay"
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
                            className="fixed left-1/2 top-1/2 z-[90] w-[320px] max-h-[70vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-2xl"
                        >
                            <div className="mb-3 flex items-center justify-between">
                                <span className="text-sm font-semibold capitalize text-foreground/80">{moreList.title}</span>
                                <button type="button" onClick={() => setMoreList(null)} aria-label={t('common.close')} className="rounded p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><span aria-hidden="true">✕</span></button>
                            </div>
                            <div className="space-y-1.5">
                                {moreList.events
                                    .slice()
                                    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
                                    .map((ev) => (
                                        <div
                                            key={ev.id}
                                            onClick={(e) => { setMoreList(null); handleOpenEvent(ev, e); }}
                                            className={`cursor-pointer truncate rounded-md px-2.5 py-1.5 text-xs font-medium hover:brightness-95 ${ev.calendar.id.startsWith('holidays') ? 'bg-success/15 text-foreground border border-success/30' : ''}`}
                                            style={!ev.calendar.id.startsWith('holidays') ? { backgroundColor: safeAgendaColor(ev.calendar.color), color: agendaTextOn(ev.calendar.color) } : {}}
                                        >
                                            {!ev.calendar.id.startsWith('holidays') && `${fmtTime(ev.startsAt)} `}
                                            {ev.title}
                                        </div>
                                    ))}
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
