'use client';

import React, { useState, useEffect } from 'react';

export function CreateEventForm({ 
    initialStartsAt, 
    initialEndsAt,
    onSaved,
    onClose
}: { 
    initialStartsAt?: string; 
    initialEndsAt?: string;
    onSaved: () => void;
    onClose?: () => void;
}) {
    const [title, setTitle] = useState('');
    const [location, setLocation] = useState('');
    const [startsAt, setStartsAt] = useState(initialStartsAt || '');
    const [endsAt, setEndsAt] = useState(initialEndsAt || '');
    const [isSaving, setIsSaving] = useState(false);

    // Update state if props change when reopened
    useEffect(() => {
        if (initialStartsAt) setStartsAt(initialStartsAt);
        if (initialEndsAt) setEndsAt(initialEndsAt);
    }, [initialStartsAt, initialEndsAt]);

    const createEvent = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        
        setIsSaving(true);
        try {
            const calRes = await fetch('/api/calendars');
            const calData = await calRes.json();
            const localCalendar = Array.isArray(calData)
                ? calData.find((c: any) => c.source === 'local' && !c.isReadOnly)
                : null;
            
            if (!localCalendar) {
                setIsSaving(false);
                return;
            }

            await fetch('/api/calendar/events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    calendarId: localCalendar.id,
                    title: title || 'New Event',
                    location,
                    startsAt,
                    endsAt,
                })
            });

            setTitle('');
            setLocation('');
            onSaved();
        } catch (error) {
            console.error(error);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <form onSubmit={createEvent} className="p-5 flex flex-col h-full overflow-y-auto">
            <input 
                value={title} 
                onChange={(e) => setTitle(e.target.value)} 
                autoFocus 
                placeholder="Add title" 
                className="w-full border-b-2 border-slate-100 focus:border-blue-600 focus:outline-none pb-2 text-[22px] mb-4 placeholder:text-slate-400" 
            />
            
            <div className="space-y-4 flex-1">
                <input 
                    value={location} 
                    onChange={(e) => setLocation(e.target.value)} 
                    placeholder="Location" 
                    className="w-full border-b border-slate-100 focus:border-blue-600 focus:outline-none py-2 text-sm placeholder:text-slate-400" 
                />
                
                <div className="flex gap-4">
                    <div className="flex-1 space-y-1">
                        <label className="text-xs font-medium text-slate-500">Starts</label>
                        <input 
                            type="datetime-local" 
                            value={startsAt} 
                            onChange={(e) => setStartsAt(e.target.value)} 
                            className="w-full text-sm border-b border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-600 py-2 px-2 rounded-t transition-colors outline-none" 
                        />
                    </div>
                    <div className="flex-1 space-y-1">
                        <label className="text-xs font-medium text-slate-500">Ends</label>
                        <input 
                            type="datetime-local" 
                            value={endsAt} 
                            onChange={(e) => setEndsAt(e.target.value)} 
                            className="w-full text-sm border-b border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-600 py-2 px-2 rounded-t transition-colors outline-none" 
                        />
                    </div>
                </div>
            </div>

            <div className="flex justify-end pt-4 mt-auto border-t">
                {onClose && (
                    <button 
                        type="button" 
                        onClick={onClose}
                        className="text-slate-500 hover:text-slate-700 font-medium px-4 py-2 mr-2"
                    >
                        Cancel
                    </button>
                )}
                <button 
                    type="submit" 
                    disabled={isSaving}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md text-sm font-medium px-6 py-2 transition-colors"
                >
                    {isSaving ? 'Saving...' : 'Save'}
                </button>
            </div>
        </form>
    );
}
