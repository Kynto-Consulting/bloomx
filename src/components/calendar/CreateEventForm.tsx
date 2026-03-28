'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { ExtensionLoader } from '@/components/expansions/ExtensionLoader';
import { TagInput } from '@/components/ui/TagInput';
import { executeExtensionAction, fetchExpansions } from '@/lib/expansions/api';

type EventAttendee = {
    email: string;
    name?: string | null;
    responseStatus?: string | null;
    isOrganizer?: boolean;
};

function getResponseLabel(responseStatus?: string | null) {
    const normalized = String(responseStatus || '').toLowerCase();
    if (normalized === 'accepted') return 'Yes';
    if (normalized === 'declined') return 'No';
    if (normalized === 'tentative') return 'Maybe';
    return 'Pending';
}

function getResponseClass(responseStatus?: string | null) {
    const normalized = String(responseStatus || '').toLowerCase();
    if (normalized === 'accepted') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (normalized === 'declined') return 'bg-rose-50 text-rose-700 border-rose-200';
    if (normalized === 'tentative') return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-slate-50 text-slate-600 border-slate-200';
}

export function CreateEventForm({ 
    eventId,
    calendarId,
    initialTitle = '',
    initialLocation = '',
    initialStartsAt, 
    initialEndsAt,
    initialAttendees = [],
    initialAttendeeDetails = [],
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
    initialAttendees?: string[];
    initialAttendeeDetails?: EventAttendee[];
    isReadOnly?: boolean;
    onSaved: () => void;
    onClose?: () => void;
}) {
    const [title, setTitle] = useState(initialTitle);
    const [location, setLocation] = useState(initialLocation);
    const [startsAt, setStartsAt] = useState(initialStartsAt || '');
    const [endsAt, setEndsAt] = useState(initialEndsAt || '');
    const [attendeeTags, setAttendeeTags] = useState<string[]>(initialAttendees);
    const [attendeeDetails, setAttendeeDetails] = useState<EventAttendee[]>(initialAttendeeDetails);
    const [mailGroupAliases, setMailGroupAliases] = useState<Record<string, string[]>>({});
    const [isSaving, setIsSaving] = useState(false);

    const normalizeTags = useCallback((tags: string[]) => {
        return Array.from(new Set(
            tags
                .map((tag) => String(tag || '').trim().toLowerCase())
                .filter(Boolean)
        ));
    }, []);

    const runRecipientsMiddleware = useCallback(async (tags: string[]) => {
        const normalizedTags = normalizeTags(tags);

        try {
            const mounts = await fetchExpansions('ON_RECIPIENTS_CHANGE_HANDLER');
            if (!Array.isArray(mounts) || mounts.length === 0) {
                return normalizedTags;
            }

            let currentState: { to: string[]; cc: string[]; bcc: string[] } = {
                to: normalizedTags,
                cc: [],
                bcc: [],
            };

            for (const mount of mounts) {
                const extensionId = mount?.extensionId || mount?.id;
                const handlerName = mount?.handler;

                if (!extensionId || !handlerName) {
                    continue;
                }

                const response = await executeExtensionAction(extensionId, handlerName, currentState, {
                    secureData: {
                        'mail-groups-data': mailGroupAliases,
                    },
                });

                if (response.success && response.result) {
                    currentState = {
                        to: Array.isArray(response.result.to) ? response.result.to : currentState.to,
                        cc: Array.isArray(response.result.cc) ? response.result.cc : currentState.cc,
                        bcc: Array.isArray(response.result.bcc) ? response.result.bcc : currentState.bcc,
                    };
                }
            }

            return normalizeTags(currentState.to || []);
        } catch (error) {
            console.error('Failed to run event attendee middleware', error);
            return normalizedTags;
        }
    }, [mailGroupAliases, normalizeTags]);

    const handleAttendeesChange = useCallback(async (tags: string[]) => {
        setAttendeeTags(tags);
        const resolvedTags = await runRecipientsMiddleware(tags);
        setAttendeeTags(resolvedTags);
    }, [runRecipientsMiddleware]);

    // Update state if props change when reopened
    useEffect(() => {
        if (initialStartsAt) setStartsAt(initialStartsAt);
        if (initialEndsAt) setEndsAt(initialEndsAt);
        if (initialTitle) setTitle(initialTitle);
        if (initialLocation) setLocation(initialLocation);
        if (initialAttendees) setAttendeeTags(initialAttendees);
        if (initialAttendeeDetails) setAttendeeDetails(initialAttendeeDetails);
    }, [initialStartsAt, initialEndsAt, initialTitle, initialLocation, initialAttendees, initialAttendeeDetails]);

    useEffect(() => {
        fetch('/api/settings', { cache: 'no-store' })
            .then((response) => response.json())
            .then((data) => {
                const groups = data?.expansionSettings?.['core-mail-groups']?.groups;
                if (groups && typeof groups === 'object') {
                    setMailGroupAliases(groups);
                }
            })
            .catch(() => undefined);
    }, []);

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
            const attendeeList = normalizeTags(attendeeTags).filter((tag) => tag.includes('@'));

            await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    calendarId: targetCalendarId,
                    title: title || 'New Event',
                    location,
                    startsAt,
                    endsAt,
                    attendees: attendeeList
                })
            });

            if (!eventId) {
                setTitle('');
                setLocation('');
                setAttendeeTags([]);
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

                {!isReadOnly && (
                    <div className="pt-1">
                        <ExtensionLoader
                            mountPoint="EVENT_LOCATION_BUILDER"
                            context={{
                                eventTitle: title,
                                startsAt,
                                endsAt,
                                currentLocation: location,
                                attendees: attendeeTags.filter((tag) => tag.includes('@')),
                                setLocation,
                            }}
                        />
                    </div>
                )}

                <div className="space-y-1">
                    {isReadOnly ? (
                        <div className="min-h-[42px] w-full border-b border-slate-100 py-2 text-sm text-slate-600">
                            {attendeeTags.length > 0 ? attendeeTags.join(', ') : 'No attendees'}
                        </div>
                    ) : (
                        <TagInput
                            value={attendeeTags}
                            onChange={handleAttendeesChange}
                            placeholder="Invite recipients or mail groups"
                            className="border-b border-slate-100 px-0 py-1.5"
                            suggestionEndpoint="/api/contacts/suggestions"
                        />
                    )}
                </div>

                {attendeeDetails.length > 0 && (
                    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Attendee Status</p>
                        <div className="space-y-1.5">
                            {attendeeDetails
                                .filter((attendee) => !attendee.isOrganizer)
                                .map((attendee) => (
                                    <div key={attendee.email} className="flex items-center justify-between gap-3 rounded-md bg-white px-2.5 py-2 border border-slate-100">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm text-slate-700">{attendee.name || attendee.email}</p>
                                            {attendee.name && <p className="truncate text-xs text-slate-500">{attendee.email}</p>}
                                        </div>
                                        <span className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${getResponseClass(attendee.responseStatus)}`}>
                                            {getResponseLabel(attendee.responseStatus)}
                                        </span>
                                    </div>
                                ))}
                        </div>
                    </div>
                )}

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
