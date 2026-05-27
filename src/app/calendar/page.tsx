'use client';

import { useEffect, useMemo, useState } from 'react';
import { Sidebar as AppSidebar } from '@/components/Sidebar';
import { ExtensionLoader } from '@/components/expansions/ExtensionLoader';
import { useGlobalWindow } from '@/contexts/GlobalWindowContext';
import { CreateEventForm } from '@/components/calendar/CreateEventForm';
import { AddCalendarForm } from '@/components/calendar/AddCalendarForm';
import { Bell, CalendarDays, Menu, Plus, ChevronLeft, ChevronRight, Settings, Search, HelpCircle, User, Check } from 'lucide-react';
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
    attendees?: { email: string; name?: string | null; isOrganizer?: boolean; responseStatus?: string | null }[];
};

export default function CalendarPage() {
    const [viewMode, setViewMode] = useState('Month');
    const [calendars, setCalendars] = useState<CalendarRecord[]>([]);
    const [events, setEvents] = useState<CalendarEventRecord[]>([]);
    const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([]);
    const [isGoogleLinked, setIsGoogleLinked] = useState(false);
    const [holidayCountries, setHolidayCountries] = useState<string[]>([]);
    const [holidays, setHolidays] = useState<CalendarEventRecord[]>([]);
    const [isAppSidebarOpen, setIsAppSidebarOpen] = useState(false);
    const [isCalSidebarOpen, setIsCalSidebarOpen] = useState(false);
    const [notificationsEnabled, setNotificationsEnabled] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [startsAt, setStartsAt] = useState('');
    const [endsAt, setEndsAt] = useState('');
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
            title: 'Create Event',
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
            title: event.calendar.isReadOnly ? 'View Event' : 'Edit Event',
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
            title: 'Add Calendar',
            icon: <Plus className="w-4 h-4" />,
            content: (
                <AddCalendarForm 
                    isGoogleLinked={isGoogleLinked} 
                    currentHolidayProviders={holidayCountries}
                    onToggleHolidayProvider={handleToggleHolidayProvider}
                    onLocalCreate={() => {
                        // TODO: Provide UI to create local calendar if not using the default one
                        // Usually you might trigger an API `/api/calendars` POST and reload
                        alert("Local calendar creation placeholder");
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
                        const holidayCal: CalendarRecord = { id: `holidays-${code}`, name: `Holidays (${code})`, color: '#00897B', source: 'public', isReadOnly: true };
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
            name: `Holidays (${code})`, 
            color: '#00897B', 
            source: 'public', 
            isReadOnly: true 
        }));
        return [...calendars, ...holidayCals];
    }, [calendars, holidayCountries]);

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

    const renderMonthGrid = () => {
        const daysInMonth = getDaysInMonth(currentYear, currentMonth);
        const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
        const days: React.ReactNode[] = [];
        
        const headers = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

        days.push(...headers.map(h => (
            <div key={`h-${h}`} className="text-center text-[11px] font-medium text-slate-500 py-2 border-r border-slate-200 border-b">
                {h}
            </div>
        )));

        for (let i = 0; i < firstDay; i++) {
            days.push(<div key={`empty-${i}`} className="min-h-[100px] border-r border-slate-200 border-b bg-slate-50/50"></div>);
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
                    className={`min-h-[120px] p-1 border-r border-slate-200 border-b cursor-pointer transition-colors hover:bg-slate-100/50 ${isToday ? 'bg-blue-50/10' : 'bg-white'}`}
                >
                    <div className="flex justify-center mb-1">
                        <span className={`text-xs flex items-center justify-center h-6 w-6 font-medium rounded-full mt-1 ${isToday ? 'bg-blue-600 text-white' : 'text-slate-700'}`}>
                            {i}
                        </span>
                    </div>
                    <div className="flex flex-col gap-1 px-1 overflow-hidden">
                        {dayEvents.map(ev => (
                            <div
                                key={ev.id}
                                onClick={(e) => handleOpenEvent(ev, e)}
                                className={`text-[11px] truncate px-1.5 py-0.5 rounded shadow-sm font-medium cursor-pointer hover:brightness-95 ${ev.calendar.id.startsWith('holidays') ? 'text-teal-900 bg-teal-50 border border-teal-100' : 'text-white'}`}
                                style={!ev.calendar.id.startsWith('holidays') ? { backgroundColor: ev.calendar.color } : {}}
                            >
                                {!ev.calendar.id.startsWith('holidays') && `${new Date(ev.startsAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} `}
                                {ev.title}
                            </div>
                        ))}
                        {dayGhostEvents.map((ge, idx) => (
                            <div
                                key={`ghost-${idx}`}
                                title={`${ge.attendeeName || ge.attendeeEmail} — ocupado`}
                                className="text-[11px] truncate px-1.5 py-0.5 rounded border border-dashed border-slate-400 bg-slate-100 text-slate-500 opacity-60 font-medium pointer-events-none select-none"
                            >
                                {new Date(ge.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {ge.attendeeName || ge.attendeeEmail.split('@')[0]}
                            </div>
                        ))}
                        {hasGhost && (
                            <div className="text-[11px] truncate px-1.5 py-0.5 rounded shadow-sm font-medium bg-blue-50 text-blue-700 border border-blue-200 border-dashed opacity-80 animate-pulse">
                                {new Date(startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} New Event
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        const remainder = (firstDay + daysInMonth) % 7;
        if (remainder > 0 && remainder !== 7) {
            for (let i = 0; i < 7 - remainder; i++) {
                days.push(<div key={`rem-${i}`} className="min-h-[100px] border-r border-slate-200 border-b bg-slate-50/50"></div>);
            }
        }

        return days;
    };

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
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
                <button onClick={() => handleOpenCreate(new Date().toISOString().slice(0, 16), new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16))} className="flex items-center justify-center gap-2 bg-blue-600 border border-blue-700 shadow-sm hover:bg-blue-700 hover:shadow-md transition-all rounded-md px-4 py-2.5 w-full group">
                    <Plus className="w-5 h-5 text-white" />
                    <span className="text-sm font-medium text-white transition-colors">Create Event</span>
                </button>
            </div>

            <div className="px-6 pb-2 w-[256px]">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[13px] font-medium text-slate-700">{monthNames[currentMonth]} {currentYear}</span>
                    <div className="flex gap-1">
                        <ChevronLeft className="w-4 h-4 text-slate-600 cursor-pointer hover:bg-slate-100 rounded" onClick={prevMonth} />
                        <ChevronRight className="w-4 h-4 text-slate-600 cursor-pointer hover:bg-slate-100 rounded" onClick={nextMonth} />
                    </div>
                </div>
                <div className="grid grid-cols-7 gap-1 text-center text-xs mb-1 text-slate-500 font-medium pb-2">
                    {['S','M','T','W','T','F','S'].map(d => <span key={d}>{d}</span>)}
                </div>
                <div className="grid grid-cols-7 gap-y-1 text-center text-xs">
                    {miniCalendarDays.map((dateObj, i) => {
                        const isToday = dateObj.isCurrentMonth && dateObj.day === currentDate.getDate() && currentMonth === currentDate.getMonth() && currentYear === currentDate.getFullYear();
                        return (
                            <div key={i} className={`w-6 h-6 flex items-center justify-center rounded-full mx-auto ${isToday ? 'bg-blue-600 text-white' : dateObj.isCurrentMonth ? 'hover:bg-slate-100 text-slate-700 cursor-pointer' : 'text-slate-400'}`}>
                                {dateObj.day}
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="p-4 flex-1 overflow-y-auto w-[256px] border-t border-slate-100 mt-2">
                <div className="flex items-center justify-between py-2 text-slate-700 font-medium px-2 rounded hover:bg-slate-50">
                    <div className="flex items-center gap-2 cursor-pointer flex-1">
                        <span className="text-sm">My calendars</span>
                        <ChevronRight className="w-4 h-4 transform rotate-90" />
                    </div>
                    <button onClick={handleOpenAddCalendar} className="p-1 hover:bg-slate-200 rounded text-slate-500">
                        <Plus className="w-4 h-4" />
                    </button>
                </div>
                <div className="pl-2 space-y-1 mt-1">
                    {allCalendars.map(calendar => {
                        const active = selectedCalendarIds.includes(calendar.id);
                        return (
                            <div key={calendar.id} className="flex items-center gap-3 py-1.5 cursor-pointer group px-2 rounded-md hover:bg-slate-50" onClick={() => toggleCalendar(calendar.id)}>
                                <div className="relative flex items-center justify-center w-5 h-5 rounded">
                                    <div className={`w-4 h-4 rounded-sm border-2`} style={{ borderColor: calendar.color, backgroundColor: active ? calendar.color : 'transparent' }}>
                                        {active && <Check className="w-3 h-3 text-white absolute inset-0 m-auto stroke-[3]" />}
                                    </div>
                                </div>
                                <span className="text-sm text-slate-700 truncate">{calendar.name}</span>
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
        <div className="flex h-screen w-full bg-white overflow-hidden text-slate-900 font-sans">
            <AnimatePresence>
                {isAppSidebarOpen && (
                    <>
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsAppSidebarOpen(false)} className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm lg:hidden" />
                        <motion.div initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} className="fixed inset-y-0 left-0 z-[70] w-[80%] max-w-[300px] bg-background lg:hidden shadow-2xl">
                            <AppSidebar onClose={() => setIsAppSidebarOpen(false)} />
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            <div className="hidden border-r border-slate-200 lg:block w-[260px] flex-shrink-0 h-full overflow-hidden">
                <AppSidebar />
            </div>

            <div className="flex-1 flex flex-col h-full overflow-hidden">
                <header className="flex h-[64px] items-center justify-between px-4 border-b border-slate-200">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setIsAppSidebarOpen(true)} className="p-2 -ml-2 rounded-full hover:bg-slate-100 lg:hidden">
                            <Menu className="w-6 h-6 text-slate-700" />
                        </button>
                        
                        <div className="flex items-center gap-2 pr-2 text-slate-700">
                            <div className="w-9 h-9 rounded bg-blue-600 flex items-center justify-center font-bold text-white shadow-sm">
                                {currentDate.getDate()}
                            </div>
                            <span className="text-xl font-normal tracking-tight hidden sm:block text-slate-700">Calendar</span>
                        </div>

                        <div className="hidden md:flex items-center border border-slate-300 rounded-md bg-white hover:bg-slate-50 shadow-sm overflow-hidden h-[36px]">
                            <select 
                                value={viewMode} 
                                onChange={(e) => setViewMode(e.target.value)}
                                className="text-sm font-medium text-slate-700 bg-transparent px-3 py-1 outline-none cursor-pointer appearance-none pr-8 relative h-full"
                                style={{ backgroundImage: `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="%234A5568" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.5rem center', backgroundSize: '1em' }}
                            >
                                <option value="Day">Day</option>
                                <option value="Week">Week</option>
                                <option value="Month">Month</option>
                                <option value="Year">Year</option>
                            </select>
                        </div>

                        <button onClick={setToday} className="border border-slate-300 px-4 h-[36px] rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50 hidden md:block shadow-sm">
                            Today
                        </button>
                        
                        <div className="flex items-center gap-1 mx-2">
                            <button onClick={prevMonth} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><ChevronLeft className="w-5 h-5 text-slate-700" /></button>
                            <button onClick={nextMonth} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><ChevronRight className="w-5 h-5 text-slate-700" /></button>
                        </div>
                        
                        <h2 className="text-xl font-normal text-slate-700 whitespace-nowrap">
                            {monthNames[currentMonth]} {currentYear}
                        </h2>
                    </div>

                    <div className="flex items-center gap-2">
                        <ExtensionLoader mountPoint="CALENDAR_HEADER" context={{ isGoogleLinked }} />
                        <button onClick={() => setIsCalSidebarOpen(true)} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-600 lg:hidden">
                            <Settings className="w-5 h-5 text-slate-700" />
                        </button>
                    </div>
                </header>

                <div className="flex flex-1 overflow-hidden">
                    <main className="flex-1 bg-white border-t border-slate-200 flex flex-col relative z-0">
                        {/* Create Event is now a floating modal */}

                        {viewMode === 'Month' ? (
                            <div className="flex-1 grid grid-cols-7 grid-rows-[auto_1fr_1fr_1fr_1fr_1fr] overflow-y-auto overflow-x-hidden">
                                {renderMonthGrid()}
                            </div>
                        ) : viewMode === 'Day' ? (
                            <div className="flex-1 overflow-y-auto w-full">
                                <div className="grid grid-cols-[60px_1fr] border-b border-slate-200 sticky top-0 z-10 bg-white">
                                    <div className="border-r border-slate-200 bg-slate-50" />
                                    <div className="font-semibold text-center py-2 text-slate-700 bg-slate-50 flex flex-col items-center">
                                        <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][currentDate.getDay()]}</span>
                                        <span className="text-lg mt-0.5 w-8 h-8 flex items-center justify-center rounded-full bg-blue-600 text-white">{currentDate.getDate()}</span>
                                    </div>
                                </div>
                                <div className="relative">
                                    {Array.from({length: 24}).map((_, i) => (
                                        <div key={i} className="grid grid-cols-[60px_1fr] border-b border-slate-100 min-h-[60px]">
                                            <div className="text-xs text-slate-500 text-right pr-2 py-1 select-none border-r border-slate-200">{i === 0 ? '12 AM' : i < 12 ? `${i} AM` : i === 12 ? '12 PM' : `${i-12} PM`}</div>
                                            <div 
                                                className="relative group hover:bg-blue-50/30 cursor-pointer"
                                                onDoubleClick={() => {
                                                    const d = new Date(currentYear, currentMonth, currentDate.getDate(), i, 0);
                                                    const dEnd = new Date(d.getTime() + 60 * 60 * 1000);
                                                    handleOpenCreate(d.toISOString().slice(0, 16), dEnd.toISOString().slice(0, 16));
                                                }}
                                            ></div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : viewMode === 'Week' ? (
                            <div className="flex-1 overflow-y-auto w-full">
                                <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-slate-200 sticky top-0 z-10 bg-white">
                                    <div className="border-r border-slate-200 bg-slate-50" />
                                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, index) => {
                                        const dateOfD = new Date(currentYear, currentMonth, currentDate.getDate() - currentDate.getDay() + index);
                                        const isToday = dateOfD.getDate() === currentDate.getDate() && dateOfD.getMonth() === currentDate.getMonth() && dateOfD.getFullYear() === currentDate.getFullYear();
                                        return (
                                            <div key={d} className="font-semibold text-center py-2 text-slate-700 border-l border-slate-100 text-sm bg-slate-50 flex flex-col items-center">
                                                <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">{d}</span>
                                                <span className={`text-lg mt-0.5 w-8 h-8 flex items-center justify-center rounded-full ${isToday ? 'bg-blue-600 text-white' : 'text-slate-700'}`}>{dateOfD.getDate()}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="relative">
                                    {Array.from({length: 24}).map((_, i) => (
                                        <div key={i} className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-slate-100 min-h-[60px]">
                                            <div className="text-xs text-slate-500 text-right pr-2 py-1 select-none border-r border-slate-200">{i === 0 ? '12 AM' : i < 12 ? `${i} AM` : i === 12 ? '12 PM' : `${i-12} PM`}</div>
                                            {Array.from({length: 7}).map((_, j) => {
                                                const d = new Date(currentYear, currentMonth, currentDate.getDate() - currentDate.getDay() + j, i, 0);
                                                return (
                                                    <div 
                                                        key={j} 
                                                        className="border-l border-slate-100 relative group hover:bg-blue-50/30 cursor-pointer"
                                                        onDoubleClick={() => {
                                                            const dEnd = new Date(d.getTime() + 60 * 60 * 1000);
                                                            handleOpenCreate(d.toISOString().slice(0, 16), dEnd.toISOString().slice(0, 16));
                                                        }}
                                                    ></div>
                                                );
                                            })}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 overflow-y-auto p-8 bg-slate-50/30">
                                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-8">
                                    {Array.from({length: 12}).map((_, m) => {
                                        const daysInM = getDaysInMonth(currentYear, m);
                                        const firstD = getFirstDayOfMonth(currentYear, m);
                                        return (
                                            <div key={m} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                                                <div className="font-medium text-slate-800 mb-2">{monthNames[m]}</div>
                                                <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-slate-500 mb-1">
                                                    {['S','M','T','W','T','F','S'].map(d => <span key={d}>{d}</span>)}
                                                </div>
                                                <div className="grid grid-cols-7 gap-y-1 text-center text-xs">
                                                    {Array.from({length: firstD}).map((_, i) => <div key={`e-${i}`} />)}
                                                    {Array.from({length: daysInM}).map((_, i) => {
                                                        const isToday = (i + 1) === currentDate.getDate() && m === currentDate.getMonth() && currentYear === currentDate.getFullYear();
                                                        return (
                                                            <div key={i} className={`w-5 h-5 flex items-center justify-center rounded-full mx-auto ${isToday ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'}`}>
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

                    <aside className="hidden lg:flex bg-white flex-col flex-shrink-0 border-l border-slate-200 h-full w-[256px]">
                        {renderCalendarSidebarContent()}
                    </aside>

                    <AnimatePresence initial={false}>
                        {isCalSidebarOpen && (
                            <>
                                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsCalSidebarOpen(false)} className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm lg:hidden" />
                                <motion.aside
                                    initial={{ x: 256, opacity: 0 }}
                                    animate={{ x: 0, opacity: 1 }}
                                    exit={{ x: 256, opacity: 0 }}
                                    className="bg-white flex flex-col border-l border-slate-200 fixed right-0 top-0 bottom-0 z-[70] h-full w-[256px] lg:hidden"
                                >
                                    {renderCalendarSidebarContent()}
                                </motion.aside>
                            </>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
}
