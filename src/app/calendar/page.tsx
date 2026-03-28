'use client';

import { useEffect, useMemo, useState } from 'react';
import { Sidebar as AppSidebar } from '@/components/Sidebar';
import { ExtensionLoader } from '@/components/expansions/ExtensionLoader';
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
};

export default function CalendarPage() {
    const [viewMode, setViewMode] = useState('Month');
    const [calendars, setCalendars] = useState<CalendarRecord[]>([]);
    const [events, setEvents] = useState<CalendarEventRecord[]>([]);
    const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([]);
    const [isGoogleLinked, setIsGoogleLinked] = useState(false);
    const [countryCode, setCountryCode] = useState('');
    const [holidays, setHolidays] = useState<CalendarEventRecord[]>([]);
    const [isAppSidebarOpen, setIsAppSidebarOpen] = useState(false);
    const [isCalSidebarOpen, setIsCalSidebarOpen] = useState(true);
    const [notificationsEnabled, setNotificationsEnabled] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [title, setTitle] = useState('');
    const [location, setLocation] = useState('');
    const [startsAt, setStartsAt] = useState('');
    const [endsAt, setEndsAt] = useState('');

    const currentDate = new Date();
    const [currentMonth, setCurrentMonth] = useState(currentDate.getMonth());
    const [currentYear, setCurrentYear] = useState(currentDate.getFullYear());

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
        setSelectedCalendarIds((current) => current.length > 0 ? current : (Array.isArray(calendarData) ? [...calendarData.map((c: CalendarRecord) => c.id), 'holidays'] : ['holidays']));
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentMonth, currentYear]);

    useEffect(() => {
        const fetchCountry = async () => {
             try {
                 const res = await fetch('https://ipapi.co/json/');
                 const data = await res.json();
                 if (data.country_code) setCountryCode(data.country_code);
             } catch(e) {
                 const locale = navigator.language;
                 setCountryCode(locale.split('-')[1] || 'US');
             }
        }
        void fetchCountry();
    }, []);

    useEffect(() => {
        if (!countryCode) return;
        const fetchHols = async () => {
             try {
                const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${currentYear}/${countryCode}`);
                if (res.ok) {
                   const data = await res.json();
                   const holidayCal: CalendarRecord = { id: 'holidays', name: 'Public Holidays', color: '#00897B', source: 'public', isReadOnly: true };
                   setHolidays(data.map((h: any) => ({
                       id: `hol-${h.date}-${h.name}`,
                       title: h.name,
                       startsAt: `${h.date}T00:00:00`,
                       endsAt: `${h.date}T23:59:59`,
                       calendar: holidayCal,
                   })));
                }
             } catch(e) {}
        }
        void fetchHols();
    }, [countryCode, currentYear]);

    const allCalendars = useMemo(() => {
        const holidayCal: CalendarRecord = { id: 'holidays', name: `Holidays (${countryCode || 'US'})`, color: '#00897B', source: 'public', isReadOnly: true };
        return [...calendars, holidayCal];
    }, [calendars, countryCode]);

    const allEvents = useMemo(() => {
        return [...events, ...holidays];
    }, [events, holidays]);

    const visibleEvents = useMemo(() => {
        return allEvents.filter((event) => selectedCalendarIds.includes(event.calendar.id));
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
            
            const dayEvents = visibleEvents.filter(e => {
                const eventDate = new Date(e.startsAt);
                return eventDate.getDate() === i && eventDate.getMonth() === currentMonth && eventDate.getFullYear() === currentYear;
            });

            days.push(
                <div key={`day-${i}`} className={`min-h-[120px] p-1 border-r border-slate-200 border-b transition-colors hover:bg-slate-50 ${isToday ? 'bg-blue-50/10' : 'bg-white'}`}>
                    <div className="flex justify-center mb-1">
                        <span className={`text-xs flex items-center justify-center h-6 w-6 font-medium rounded-full mt-1 ${isToday ? 'bg-blue-600 text-white' : 'text-slate-700'}`}>
                            {i}
                        </span>
                    </div>
                    <div className="flex flex-col gap-1 px-1 overflow-hidden">
                        {dayEvents.map(ev => (
                            <div key={ev.id} className={`text-[11px] truncate px-1.5 py-0.5 rounded shadow-sm font-medium ${ev.calendar.id === 'holidays' ? 'text-teal-900 bg-teal-50 border border-teal-100' : 'text-white'}`} style={ev.calendar.id !== 'holidays' ? { backgroundColor: ev.calendar.color } : {}}>
                                {ev.calendar.id !== 'holidays' && `${new Date(ev.startsAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} `}
                                {ev.title}
                            </div>
                        ))}
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
        setIsCreating(false);
        await loadData();
    };

    return (
        <div className="flex h-screen w-full bg-white overflow-hidden text-slate-900 font-sans">
            <AnimatePresence>
                {isAppSidebarOpen && (
                    <>
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsAppSidebarOpen(false)} className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm xl:hidden" />
                        <motion.div initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} className="fixed inset-y-0 left-0 z-[70] w-[80%] max-w-[300px] bg-background xl:hidden shadow-2xl">
                            <AppSidebar onClose={() => setIsAppSidebarOpen(false)} />
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            <div className="hidden border-r bg-slate-50 xl:block group w-[1px] opacity-0 hover:w-[240px] hover:opacity-100 transition-all duration-300 absolute h-full z-50 overflow-hidden hover:shadow-2xl">
                <AppSidebar />
            </div>

            <div className="flex-1 flex flex-col h-full overflow-hidden ml-0">
                <header className="flex h-[64px] items-center justify-between px-4 border-b">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setIsAppSidebarOpen(true)} className="p-3 -ml-2 rounded-full hover:bg-slate-100 xl:hidden">
                            <Menu className="w-6 h-6 text-slate-700" />
                        </button>
                        <button onClick={() => setIsCalSidebarOpen(!isCalSidebarOpen)} className="p-3 -ml-2 rounded-full hover:bg-slate-100 hidden xl:block">
                            <Menu className="w-6 h-6 text-slate-700" />
                        </button>
                        
                        <div className="flex items-center gap-2 pr-4 text-slate-700">
                            <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center font-bold text-white shadow-sm shadow-blue-200">
                                {currentDate.getDate()}
                            </div>
                            <span className="text-[22px] font-normal tracking-tight hidden sm:block text-slate-700">Calendar</span>
                        </div>

                        <button onClick={setToday} className="border border-slate-300 px-4 py-1.5 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50 hidden md:block shadow-sm">
                            Today
                        </button>
                        
                        <div className="flex items-center gap-1 mx-2">
                            <button onClick={prevMonth} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><ChevronLeft className="w-5 h-5 text-slate-700" /></button>
                            <button onClick={nextMonth} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><ChevronRight className="w-5 h-5 text-slate-700" /></button>
                        </div>
                        
                        <h2 className="text-[22px] font-normal text-slate-700 whitespace-nowrap min-w-[150px]">
                            {monthNames[currentMonth]} {currentYear}
                        </h2>
                    </div>

                    <div className="flex items-center gap-2">
                        <ExtensionLoader mountPoint="CALENDAR_HEADER" context={{ isGoogleLinked }} />
                        <div className="border border-slate-300 rounded-md bg-white hover:bg-slate-50 hidden md:flex shadow-sm overflow-hidden">
                            <select 
                                value={viewMode} 
                                onChange={(e) => setViewMode(e.target.value)}
                                className="text-sm font-medium text-slate-700 bg-transparent px-3 py-1.5 outline-none cursor-pointer appearance-none pr-8 relative"
                                style={{ backgroundImage: `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="%234A5568" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.5rem center', backgroundSize: '1em' }}
                            >
                                <option value="Day">Day</option>
                                <option value="Week">Week</option>
                                <option value="Month">Month</option>
                                <option value="Year">Year</option>
                            </select>
                        </div>
                    </div>
                </header>

                <div className="flex flex-1 overflow-hidden">
                    <AnimatePresence initial={false}>
                        {isCalSidebarOpen && (
                            <motion.aside 
                                initial={{ width: 0, opacity: 0 }} 
                                animate={{ width: 256, opacity: 1 }} 
                                exit={{ width: 0, opacity: 0 }} 
                                className="bg-white flex flex-col hidden lg:flex flex-shrink-0 border-r border-slate-100"
                            >
                                <div className="p-4 py-5 pl-4">
                                    <button onClick={() => setIsCreating(!isCreating)} className="flex items-center justify-center gap-2 bg-blue-600 border border-blue-700 shadow-sm hover:bg-blue-700 hover:shadow-md transition-all rounded-md px-4 py-2.5 w-full group">
                                        <Plus className="w-5 h-5 text-white" />
                                        <span className="text-sm font-medium text-white transition-colors">Create Event</span>
                                    </button>
                                </div>

                                <div className="px-6 pb-2">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-[13px] font-medium text-slate-700">{monthNames[currentMonth]} {currentYear}</span>
                                        <div className="flex gap-1">
                                            <ChevronLeft className="w-4 h-4 text-slate-600" />
                                            <ChevronRight className="w-4 h-4 text-slate-600" />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-7 gap-1 text-center text-xs mb-1 text-slate-500 font-medium pb-2">
                                        {['S','M','T','W','T','F','S'].map(d => <span key={d}>{d}</span>)}
                                    </div>
                                    <div className="grid grid-cols-7 gap-y-1 text-center text-xs">
                                        {Array.from({length: 35}).map((_, i) => (
                                            <div key={i} className={`w-6 h-6 flex items-center justify-center rounded-full mx-auto ${i+1 === currentDate.getDate() ? 'bg-blue-600 text-white' : 'hover:bg-slate-100 text-slate-700 cursor-pointer'}`}>
                                                {(i % 31) + 1}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="p-4 flex-1 overflow-y-auto w-[256px]">
                                    <div className="flex items-center gap-2 py-2 cursor-pointer text-slate-700 hover:bg-slate-50 px-2 rounded">
                                        <span className="text-sm font-medium flex-1">My calendars</span>
                                        <ChevronRight className="w-4 h-4 transform rotate-90" />
                                    </div>
                                    <div className="pl-4 space-y-1">
                                        {allCalendars.map(calendar => {
                                            const active = selectedCalendarIds.includes(calendar.id);
                                            return (
                                                <div key={calendar.id} className="flex items-center gap-3 py-1.5 cursor-pointer group" onClick={() => toggleCalendar(calendar.id)}>
                                                    <div className="relative flex items-center justify-center w-5 h-5 rounded hover:bg-slate-100">
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
                            </motion.aside>
                        )}
                    </AnimatePresence>

                    <main className="flex-1 bg-white border-l border-t border-slate-200 flex flex-col relative ml-[-1px]">
                        {isCreating && (
                            <div className="absolute top-4 left-4 z-40 w-96 bg-white shadow-[0_4px_24px_rgba(0,0,0,0.15)] rounded-2xl border flex flex-col animate-in fade-in zoom-in-95 overflow-hidden">
                                <div className="flex items-center justify-between p-3 border-b bg-slate-50/50">
                                    <div className="flex items-center gap-2 text-slate-600"><Menu className="w-4 h-4"/><span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Edit Event</span></div>
                                    <button onClick={() => setIsCreating(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-200">×</button>
                                </div>
                                <form onSubmit={createEvent} className="p-5 space-y-4">
                                    <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="Add title" className="w-full border-b-2 border-slate-100 focus:border-blue-600 focus:outline-none pb-2 text-[22px] mb-2 placeholder:text-slate-400" />
                                    <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location" className="w-full border-b border-slate-100 focus:border-blue-600 focus:outline-none py-2 text-sm placeholder:text-slate-400" />
                                    <div className="flex gap-4">
                                       <div className="flex-1 space-y-1">
                                            <label className="text-xs font-medium text-slate-500">Starts</label>
                                            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="w-full text-sm border-b border-transparent bg-slate-50 hover:bg-slate-100 focus:bg-slate-100 py-1.5 px-2 rounded-t transition-colors outline-none focus:border-blue-600" />
                                       </div>
                                       <div className="flex-1 space-y-1">
                                            <label className="text-xs font-medium text-slate-500">Ends</label>
                                            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="w-full text-sm border-b border-transparent bg-slate-50 hover:bg-slate-100 focus:bg-slate-100 py-1.5 px-2 rounded-t transition-colors outline-none focus:border-blue-600" />
                                       </div>
                                    </div>
                                    <div className="flex justify-end pt-4">
                                        <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium px-6 py-2 transition-colors">Save</button>
                                    </div>
                                </form>
                            </div>
                        )}

                        {viewMode === 'Month' ? (
                            <div className="flex-1 grid grid-cols-7 grid-rows-[auto_1fr_1fr_1fr_1fr_1fr] overflow-y-auto overflow-x-hidden">
                                {renderMonthGrid()}
                            </div>
                        ) : (
                            <div className="flex flex-1 items-center justify-center text-slate-500 bg-slate-50/50">
                                {viewMode} view is under construction.
                            </div>
                        )}
                    </main>
                </div>
            </div>
        </div>
    );
}