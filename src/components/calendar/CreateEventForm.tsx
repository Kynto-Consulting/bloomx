'use client';

import React, { useState, useEffect } from 'react';

export function CreateEventForm({ 
    eventId,
    calendarId,
    initialTitle = '',
    initialLocation = '',
    initialStartsAt, 
    initialEndsAt,
    isReadOnly = false,
    onSaved,
    onClose
}: { 
    eventId?: string;
    calendarId?: string;
    initialTitle?: string;
    initialLocation?: string;
    initialStartsAt?: string; 
    initialEndsAt?: string;
    isReadOnly?: boolean;
    onSaved: () => void;
    onClose?: () => void;
}) {
    const [title, setTitle] = useState(initialTitle);
    const [location, setLocation] = useState(initialLocation);
    const [startsAt, setStartsAt] = useState(initialStartsAt || '');
    const [endsAt, setEndsAt] = useState(initialEndsAt || '');
    const [isSaving, setIsSaving] = useState(false);

    // Update state if props change when reopened
    useEffect(() => {
        if (initialStartsAt) setStartsAt(initialStartsAt);
        if (initialEndsAt) setEndsAt(initialEndsAt);
        if (initialTitle) setTitle(initialTitle);
        if (initialLocation) setLocation(initialLocation);
    }, [initialStartsAt, initialEndsAt, initialTitle, initialLocation]);

    const saveEvent = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        
        setIsSaving(true);
        try {
            let targetCalendarId = calendarId;

            if (!eventId) {
                const calRes = await fetch('/api/calendars');
                const calData = await calRes.json();
                const localCalendar = Array.isArray(calData)
                    ? calData.find((c: any) => c.source === 'local' && !c.isReadOnly)
                    : null;
                
                if (!localCalendar) {
                    setIsSaving(false);
                    return;
                }
                targetCalendarId = localCalendar.id;
            }

            const url = eventId ? `/api/calendar/events/${eventId}` : '/api/calendar/events';
            const method = eventId ? 'PUT' : 'POST';

            await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    calendarId: targetCalendarId,
                    title: title || 'New Event',
                    location,
                    startsAt,
                    endsAt,
                })
            });

            if (!eventId) {
                setTitle('');
                setLocation('');
            }
            onSaved();
        } catch (error) {
            console.error(error);
        } finally {
            setIsSaving(false);
        }
    };

    const deleteEvent = async () => {
        if (!eventId || !confirm('Are you sure you want to delete this event?')) return;
        setIsSaving(true);
        try {
            await fetch(`/api/calendar/events/${eventId}`, { method: 'DELETE' });
            onSaved();
        } catch (error) {
            console.error(error);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <form onSubmit={saveEvent} className="p-5 flex flex-col h-full overflow-y-auto">
            <input 
                value={title} 
                onChange={(e) => setTitle(e.target.value)} 
                autoFocus 
                readOnly={isReadOnly}
                placeholder="Add title" 
                className="w-full border-b-2 border-slate-100 focus:border-blue-600 focus:outline-none pb-2 text-[22px] mb-4 placeholder:text-slate-400 bg-transparent read-only:outline-none read-only:border-none" 
            />
            
            <div className="space-y-4 flex-1">
                <input 
                    value={location} 
                    onChange={(e) => setLocation(e.target.value)} 
                    placeholder="Location" 
                    readOnly={isReadOnly}
                    className="w-full border-b border-slate-100 focus:border-blue-600 focus:outline-none py-2 text-sm placeholder:text-slate-400 bg-transparent read-only:outline-none read-only:border-none" 
                />
                
                <div className="flex gap-4">
                    <div className="flex-1 space-y-1">
                        <label className="text-xs font-medium text-slate-500">Starts</label>
                        <input 
                            type="datetime-local" 
                            value={(startsAt || '').slice(0, 16)} 
                            onChange={(e) => setStartsAt(e.target.value)} 
                            readOnly={isReadOnly}
                            className={`w-full text-sm border-b border-slate-200 py-2 px-2 rounded-t transition-colors outline-none ${isReadOnly ? 'bg-transparent border-none' : 'bg-slate-50 focus:bg-white focus:border-blue-600'}`} 
                        />
                    </div>
                    <div className="flex-1 space-y-1">
                        <label className="text-xs font-medium text-slate-500">Ends</label>
                        <input 
                            type="datetime-local" 
                            value={(endsAt || '').slice(0, 16)} 
                            onChange={(e) => setEndsAt(e.target.value)} 
                            readOnly={isReadOnly}
                            className={`w-full text-sm border-b border-slate-200 py-2 px-2 rounded-t transition-colors outline-none ${isReadOnly ? 'bg-transparent border-none' : 'bg-slate-50 focus:bg-white focus:border-blue-600'}`} 
                        />
                    </div>
                </div>
            </div>

            <div className="flex justify-between items-center pt-4 mt-auto border-t">
                {eventId && !isReadOnly ? (
                    <button 
                        type="button" 
                        onClick={deleteEvent}
                        disabled={isSaving}
                        className="text-red-500 hover:text-red-700 font-medium px-2 py-2 text-sm"
                    >
                        Delete
                    </button>
                ) : <div></div>}

                <div className="flex">
                    {onClose && (
                        <button 
                            type="button" 
                            onClick={onClose}
                            className="text-slate-500 hover:text-slate-700 font-medium px-4 py-2 mr-2 text-sm"
                        >
                            {isReadOnly ? 'Close' : 'Cancel'}
                        </button>
                    )}
                    {!isReadOnly && (
                        <button 
                            type="submit" 
                            disabled={isSaving}
                            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md text-sm font-medium px-6 py-2 transition-colors"
                        >
                            {isSaving ? 'Saving...' : 'Save'}
                        </button>
                    )}
                </div>
            </div>
        </form>
    );
}
