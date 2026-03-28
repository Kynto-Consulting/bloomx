const fs = require('fs');

const calendarUI = 'use client';

import { useEffect, useMemo, useState } from 'react';
import { Sidebar as AppSidebar } from '@/components/Sidebar';
import { ExtensionLoader } from '@/components/expansions/ExtensionLoader';
import { Bell, Menu, Plus, ChevronLeft, ChevronRight, Settings, Search, HelpCircle, User, Check } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

type CalendarRecord = { id: string; name: string; color: string; source: string; isReadOnly: boolean; };
type CalendarEventRecord = { id: string; title: string; location?: string | null; startsAt: string; endsAt: string; calendar: CalendarRecord; responseStatus?: string | null; };

export default function CalendarPage() {
    const [calendars, setCalendars] = useState<CalendarRecord[]>([]);
    const [events, setEvents] = useState<CalendarEventRecord[]>([]);
    const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([]);
    const [isGoogleLinked, setIsGoogleLinked] = useState(false);
    const [isAppSidebarOpen, setIsAppSidebarOpen] = useState(false);
    const [isCalSidebarOpen, setIsCalSidebarOpen] = useState(true);
    const [notificationsEnabled, setNotificationsEnabled] = useState(false);

    // Form
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
            fetch(\/api/calendar/events?start=\\\&end=\\\\),
            fetch('/api/settings'),
        ]);

        const calendarData = await calendarResponse.json();
        const eventData = await eventResponse.json();
        const settingsData = await settingsResponse.json();

        setCalendars(Array.isArray(calendarData) ? calendarData : []);
        setEvents(Array.isArray(eventData) ? eventData : []);
        setIsGoogleLinked(Boolean(settingsData?.isGoogleLinked));
        setSelectedCalendarIds((current) => current.length > 0 ? current : (Array.isArray(calendarData) ? calendarData.map((c: CalendarRecord) => c.id) : []));
    };

    useEffect(() => {
        void loadData();
        setNotificationsEnabled(typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted');

        const handleSyncComplete = () => void loadData();
        const handleNotificationsEnabled = () => setNotificationsEnabled(true);

        window.addEventListener('bloomx:calendar-sync-complete', handleSyncComplete);
        window.addEventListener('bloomx:notifications-enabled', handleNotificationsEnabled);
        return () => {
            window.removeEventListener('bloomx:calendar-sync-complete', handleSyncComplete);
            window.removeEventListener('bloomx:notifications-enabled', handleNotificationsEnabled);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentMonth, currentYear]);

    const visibleEvents = useMemo(() => events.filter((event) => selectedCalendarIds.includes(event.calendar.id)), [events, selectedCalendarIds]);

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
            <div key={\h-\\\\} className="text-center text-[11px] font-medium text-slate-500 py-2 border-r border-b">
                {h}
            </div>
        )));

        for (let i = 0; i < firstDay; i++) {
            days.push(<div key={\empty-\\\\} className="min-h-[100px] border-r border-b bg-slate-50/50"></div>);
        }

        for (let i = 1; i <= daysInMonth; i++) {
            const isToday = i === currentDate.getDate() && currentMonth === currentDate.getMonth() && currentYear === currentDate.getFullYear();
            
            const dayEvents = visibleEvents.filter(e => {
                const eventDate = new Date(e.startsAt);
                return eventDate.getDate() === i && eventDate.getMonth() === currentMonth && eventDate.getFullYear() === currentYear;
            });

            days.push(
                <div key={\day-\\\\} className={\min-h-[120px] p-1 border-r border-b transition-colors hover:bg-slate-50 \\\\}>
                    <div className="flex justify-center mb-1">
                        <span className={\	ext-xs flex items-center justify-center h-6 w-6 font-medium rounded-full mt-1 \\\\}>
                            {i}
                        </span>
                    </div>
                    <div className="flex flex-col gap-1 px-1">
                        {dayEvents.map(ev => (
                            <div key={ev.id} className="text-[11px] truncate px-1.5 py-0.5 rounded shadow-sm text-white font-medium" style={{ backgroundColor: ev.calendar.color }}>
                                {new Date(ev.startsAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} {ev.title}
                            </div>
                        ))}
                    </div>
                </div>
            );
        }

        const remainder = (firstDay + daysInMonth) % 7;
        if (remainder > 0 && remainder !== 7) {
            for (let i = 0; i < 7 - remainder; i++) {
                days.push(<div key={\em-\\\\} className="min-h-[100px] border-r border-b bg-slate-50/50"></div>);
            }
        }

        return days;
    };

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const toggleCalendar = (id: string) => setSelectedCalendarIds(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);

    const createEvent = async (e: React.FormEvent) => {
        e.preventDefault();
        const localCalendar = calendars.find((calendar) => calendar.source === 'local' && !calendar.isReadOnly);
        if (!localCalendar || !title || !startsAt || !endsAt) return;

        await fetch('/api/calendar/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ calendarId: localCalendar.id, title, location, startsAt, endsAt })
        });
        
        setTitle(''); setLocation(''); setStartsAt(''); setEndsAt(''); setIsCreating(false);
        await loadData();
    };

    return (
        <div className="flex h-screen w-full bg-white overflow-hidden text-slate-900 font-sans">
            <AnimatePresence>
                {isAppSidebarOpen && (
                    <>
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsAppSidebarOpen(false)} className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm md:hidden" />
                        <motion.div initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} className="fixed inset-y-0 left-0 z-[70] w-[80%] max-w-[300px] bg-background md:hidden">
                            <AppSidebar onClose={() => setIsAppSidebarOpen(false)} />
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            <div className="hidden border-r bg-slate-50 md:block group w-[1px] opacity-0 hover:w-[240px] hover:opacity-100 transition-all duration-300 absolute h-full z-50 overflow-hidden hover:shadow-2xl">
                <AppSidebar />
            </div>

            <div className="flex-1 flex flex-col h-full overflow-hidden ml-0">
                <header className="flex h-[64px] items-center justify-between px-4 border-b">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setIsCalSidebarOpen(!isCalSidebarOpen)} className="p-3 -ml-2 rounded-full hover:bg-slate-100 hidden lg:block">
                            <Menu className="w-6 h-6 text-slate-700" />
                        </button>
                        <button onClick={() => setIsAppSidebarOpen(true)} className="p-3 -ml-2 rounded-full hover:bg-slate-100 lg:hidden">
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
                        <button className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-600 hidden sm:block"><Search className="w-6 h-6" /></button>
                        <button className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-600 hidden sm:block"><HelpCircle className="w-6 h-6" /></button>
                        <button className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-600 hidden lg:block"><Settings className="w-6 h-6" /></button>
                        <div className="mx-2 h-8 w-px bg-slate-200 hidden sm:block"></div>
                        <div className="border border-slate-300 rounded-md px-3 py-1.5 flex items-center bg-white hover:bg-slate-50 cursor-pointer hidden md:flex shadow-sm">
                           <span className="text-sm font-medium text-slate-700">Month</span>
                        </div>
                        <div className="ml-2 w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 relative overflow-hidden">
                           <User className="w-5 h-5" />
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
                                className="bg-white flex flex-col hidden lg:flex flex-shrink-0"
                            >
                                <div className="p-4 py-5 pl-2">
                                    <button onClick={() => setIsCreating(!isCreating)} className="flex items-center gap-3 bg-white border border-slate-200 shadow-sm hover:shadow-md transition-shadow rounded-full px-4 py-3 pr-6 group">
                                        <svg width="28" height="28" viewBox="0 0 36 36"><path fill="#34A853" d="M16 16v14h4V20z"></path><path fill="#4285F4" d="M30 16H20l-4 4h14z"></path><path fill="#FBBC05" d="M6 16v4h10l4-4z"></path><path fill="#EA4335" d="M20 16V2h-4v14z"></path><path fill="none" d="M0 0h36v36H0z"></path></svg>
                                        <span className="text-sm font-medium text-slate-700 group-hover:text-blue-600 transition-colors">Create</span>
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
                                            <div key={i} className={\w-6 h-6 flex items-center justify-center rounded-full mx-auto \\\\}>
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
                                        {calendars.map(calendar => {
                                            const active = selectedCalendarIds.includes(calendar.id);
                                            return (
                                                <div key={calendar.id} className="flex items-center gap-3 py-1.5 cursor-pointer group" onClick={() => toggleCalendar(calendar.id)}>
                                                    <div className="relative flex items-center justify-center w-5 h-5 rounded hover:bg-slate-100">
                                                        <div className={\w-4 h-4 rounded-sm border-2\} style={{ borderColor: calendar.color, backgroundColor: active ? calendar.color : 'transparent' }}>
                                                            {active && <Check className="w-3 h-3 text-white absolute inset-0 m-auto stroke-[3]" />}
                                                        </div>
                                                    </div>
                                                    <span className="text-sm text-slate-700 truncate">{calendar.name}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    
                                    {!isGoogleLinked && (
                                        <div className="mt-6 p-4 rounded-xl bg-slate-50 border text-xs text-slate-600 max-w-[220px]">
                                            Link Google to import calendars.
                                        </div>
                                    )}

                                    <div className="mt-8">
                                        <ExtensionLoader mountPoint="CALENDAR_SIDEBAR" context={{ isGoogleLinked }} />
                                    </div>
                                </div>
                            </motion.aside>
                        )}
                    </AnimatePresence>

                    <main className="flex-1 bg-white border-l border-t border-slate-200 flex flex-col relative rounded-tl-2xl ml-[-1px]">
                        {isCreating && (
                            <div className="absolute top-4 left-4 z-40 w-96 bg-white shadow-[0_4px_24px_rgba(0,0,0,0.15)] rounded-2xl border flex flex-col animate-in fade-in zoom-in-95 overflow-hidden">
                                <div className="flex items-center justify-between p-3 border-b bg-slate-50/50">
                                    <div className="flex items-center gap-2 text-slate-600"><Menu className="w-4 h-4"/><span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Edit Event</span></div>
                                    <button onClick={() => setIsCreating(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-200">×</button>
                                </div>
                                <form onSubmit={createEvent} className="p-5 space-y-4">
                                    <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="Add title" className="w-full border-b-2 border-slate-100 focus:border-blue-600 focus:outline-none pb-2 text-[22px] mb-2 placeholder:text-slate-400" />
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

                        <div className="flex-1 grid grid-cols-7 grid-rows-[auto_1fr_1fr_1fr_1fr_1fr] overflow-y-auto overflow-x-hidden">
                            {renderMonthGrid()}
                        </div>
                    </main>
                </div>
            </div>
        </div>
    );
}
;

fs.writeFileSync('../bloomx/src/app/calendar/page.tsx', calendarUI);
console.log('Calendar file written.');
