'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ExtensionLoader } from '@/components/expansions/ExtensionLoader';
import { TagInput } from '@/components/ui/TagInput';
import { DateTimePicker } from '@/components/ui/DateTimePicker';
import { executeExtensionAction, fetchExpansions } from '@/lib/expansions/api';
import { useOptionalExpansionUI } from '@/contexts/ExpansionUIContext';
import { buildCalendarInviteHtml } from '@/lib/calendar/email-templates';
import { toast } from 'sonner';
import { Video, Loader2 as SpinIcon, X as XIcon } from 'lucide-react';

const pad = (n: number) => String(n).padStart(2, '0');

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

function formatToLocalString(value?: string): string {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
    const expansionUI = useOptionalExpansionUI();
    const [title, setTitle] = useState(initialTitle);
    const [location, setLocation] = useState(initialLocation);
    const [startsAt, setStartsAt] = useState(formatToLocalString(initialStartsAt));
    const [endsAt, setEndsAt] = useState(formatToLocalString(initialEndsAt));
    const [attendeeTags, setAttendeeTags] = useState<string[]>(initialAttendees);
    const [attendeeDetails, setAttendeeDetails] = useState<EventAttendee[]>(initialAttendeeDetails);
    const [mailGroupAliases, setMailGroupAliases] = useState<Record<string, string[]>>({});
    const [isGoogleLinked, setIsGoogleLinked] = useState(false);
    const [isGoogleMeetAvailable, setIsGoogleMeetAvailable] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isInviting, setIsInviting] = useState(false);
    const [conferenceUrl, setConferenceUrl] = useState<string | null>(null);
    const [isCreatingMeet, setIsCreatingMeet] = useState(false);
    const attendeeChangeSeqRef = useRef(0);
    const [attendeeAvailability, setAttendeeAvailability] = useState<Array<{
        email: string;
        name: string | null;
        events: Array<{ title: string; startsAt: string; endsAt: string }>;
    }>>([]);

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

    const handleAttendeesChange = useCallback((tags: string[]) => {
        const requestId = ++attendeeChangeSeqRef.current;
        setAttendeeTags(tags);

        void (async () => {
            const resolvedTags = await runRecipientsMiddleware(tags);
            if (attendeeChangeSeqRef.current === requestId) {
                setAttendeeTags(resolvedTags);
            }
        })();
    }, [runRecipientsMiddleware]);

    const getAttendeeList = useCallback(() => {
        return normalizeTags(attendeeTags).filter((tag) => tag.includes('@'));
    }, [attendeeTags, normalizeTags]);

    const toIsoIfValid = useCallback((value?: string) => {
        const raw = String(value || '').trim();
        if (!raw) return '';
        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) {
            return raw;
        }
        return parsed.toISOString();
    }, []);

    const buildEventPayload = useCallback((targetCalendarId?: string) => {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const startsAtIso = toIsoIfValid(startsAt);
        const endsAtIso = toIsoIfValid(endsAt);

        return {
            calendarId: targetCalendarId,
            title: title || 'New Event',
            location,
            startsAt: startsAtIso,
            endsAt: endsAtIso,
            startsAtLocal: startsAt,
            endsAtLocal: endsAt,
            timeZone,
            attendees: getAttendeeList(),
        };
    }, [title, location, startsAt, endsAt, getAttendeeList, toIsoIfValid]);

    const markAttendeesAsPending = useCallback((emails: string[]) => {
        const normalizedEmails = normalizeTags(emails);

        setAttendeeDetails((current) => {
            const organizers = current.filter((attendee) => attendee.isOrganizer);
            const existingByEmail = new Map(
                current
                    .filter((attendee) => !attendee.isOrganizer)
                    .map((attendee) => [attendee.email.toLowerCase(), attendee])
            );

            const updatedAttendees = normalizedEmails.map((email) => {
                const existing = existingByEmail.get(email.toLowerCase());
                if (existing) {
                    return existing;
                }

                return {
                    email,
                    name: null,
                    responseStatus: 'needsAction',
                    isOrganizer: false,
                } satisfies EventAttendee;
            });

            return [...organizers, ...updatedAttendees];
        });
    }, [normalizeTags]);

    // Update state if props change when reopened
    useEffect(() => {
        if (initialStartsAt) setStartsAt(formatToLocalString(initialStartsAt));
        if (initialEndsAt) setEndsAt(formatToLocalString(initialEndsAt));
        if (initialTitle) setTitle(initialTitle);
        if (initialLocation) setLocation(initialLocation);
    }, [initialStartsAt, initialEndsAt, initialTitle, initialLocation]);

    useEffect(() => {
        if (initialAttendees) setAttendeeTags(initialAttendees);
    }, [JSON.stringify(initialAttendees)]);

    useEffect(() => {
        if (initialAttendeeDetails) setAttendeeDetails(initialAttendeeDetails);
    }, [JSON.stringify(initialAttendeeDetails)]);

    useEffect(() => {
        fetch('/api/settings', { cache: 'no-store' })
            .then((response) => response.json())
            .then((data) => {
                const groups = data?.expansionSettings?.['core-mail-groups']?.groups;
                if (groups && typeof groups === 'object') {
                    setMailGroupAliases(groups);
                }
                setIsGoogleLinked(Boolean(data?.isGoogleLinked));
                setIsGoogleMeetAvailable(Boolean(data?.isGoogleMeetAvailable));
            })
            .catch(() => undefined);
    }, []);

    useEffect(() => {
        const emails = normalizeTags(attendeeTags).filter(t => t.includes('@'));
        if (emails.length === 0 || !startsAt || !endsAt) {
            setAttendeeAvailability([]);
            return;
        }
        const startIso = toIsoIfValid(startsAt);
        const endIso = toIsoIfValid(endsAt);
        if (!startIso || !endIso) return;

        const controller = new AbortController();
        const params = new URLSearchParams({ emails: emails.join(','), start: startIso, end: endIso });
        fetch(`/api/calendar/domain-availability?${params}`, { signal: controller.signal })
            .then(r => r.ok ? r.json() : [])
            .then(data => {
                if (Array.isArray(data)) {
                    setAttendeeAvailability(data.filter((a: any) => Array.isArray(a.events) && a.events.length > 0));
                }
            })
            .catch(() => {});
        return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [attendeeTags, startsAt, endsAt]);

    // Broadcast ghost events to calendar grid whenever availability changes
    useEffect(() => {
        const ghostEvents = attendeeAvailability.flatMap(a =>
            a.events.map(e => ({
                title: e.title,
                startsAt: e.startsAt,
                endsAt: e.endsAt,
                attendeeEmail: a.email,
                attendeeName: a.name,
            }))
        );
        window.dispatchEvent(new CustomEvent('bloomx:attendee-ghost-events', { detail: { events: ghostEvents } }));
    }, [attendeeAvailability]);

    // Clear ghost events when this form unmounts
    useEffect(() => {
        return () => {
            window.dispatchEvent(new CustomEvent('bloomx:attendee-ghost-events', { detail: { events: [] } }));
        };
    }, []);

    const createGoogleMeet = useCallback(async () => {
        setIsCreatingMeet(true);
        try {
            const res = await fetch('/api/calendar/conferencing/meet', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: title || 'Meeting', startsAt: toIsoIfValid(startsAt), endsAt: toIsoIfValid(endsAt) }),
            });
            const data = await res.json();
            if (!res.ok || !data.meetUrl) throw new Error(data.error || 'Failed');
            setConferenceUrl(data.meetUrl);
            setLocation(data.meetUrl);
        } catch {
            toast.error('Could not create Google Meet link');
        } finally {
            setIsCreatingMeet(false);
        }
    }, [title, startsAt, endsAt, toIsoIfValid]);

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
            const payload = buildEventPayload(targetCalendarId);

            await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
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

    const inviteAttendees = async () => {
        if (!eventId) {
            toast.error('Save the event before sending invitations');
            return;
        }

        const attendeeList = getAttendeeList();
        if (attendeeList.length === 0) {
            toast.error('Add at least one attendee');
            return;
        }

        const oldEmails = new Set(attendeeDetails.map(a => a.email.toLowerCase()));
        const newlyAdded = attendeeList.filter(email => !oldEmails.has(email.toLowerCase()));
        
        let toInvite = newlyAdded;
        if (toInvite.length === 0) {
            // If no new people, re-send to everyone
            toInvite = attendeeList;
        }

        setIsInviting(true);
        try {
            const updateResponse = await fetch(`/api/calendar/events/${eventId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildEventPayload(calendarId)),
            });

            if (!updateResponse.ok) {
                const updateResult = await updateResponse.json().catch(() => null);
                throw new Error(updateResult?.error || 'Failed to save event before inviting attendees');
            }

            const inviteAttachmentResponse = await fetch(`/api/calendar/events/${eventId}/attach-invite`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: toInvite }),
            });
            const inviteAttachmentResult = await inviteAttachmentResponse.json().catch(() => null);

            if (!inviteAttachmentResponse.ok || !inviteAttachmentResult?.attachment) {
                throw new Error(inviteAttachmentResult?.error || 'Failed to generate invite attachment');
            }

            const startsAtLabel = startsAt ? new Date(startsAt).toLocaleString() : 'TBD';
            const parsedStart = startsAt ? new Date(startsAt) : new Date();
            const parsedEnd = endsAt ? new Date(endsAt) : new Date(parsedStart.getTime() + 3600000);
            const html = buildCalendarInviteHtml({
                title: title || inviteAttachmentResult.subject || 'New Event',
                startsAt: parsedStart,
                endsAt: parsedEnd,
                location: location || null,
            });

            const text = [
                `You are invited to: ${title || 'New Event'}`,
                `Starts: ${startsAtLabel}`,
                `Ends: ${parsedEnd.toLocaleString()}`,
                location ? `Location: ${location}` : '',
                '',
                'The calendar invite (.ics) is attached to this email.',
            ].filter(Boolean).join('\n');

            const sendInvitesResponse = await fetch('/api/emails', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: toInvite.join(','),
                    subject: `Invitation: ${title || inviteAttachmentResult.subject || 'New Event'}`,
                    html,
                    text,
                    attachments: [inviteAttachmentResult.attachment],
                }),
            });
            const sendInvitesResult = await sendInvitesResponse.json().catch(() => null);

            if (!sendInvitesResponse.ok || !sendInvitesResult?.success) {
                throw new Error(sendInvitesResult?.error || 'Failed to send invitation emails');
            }

            markAttendeesAsPending(toInvite);
            window.dispatchEvent(new CustomEvent('bloomx:calendar-sync-complete'));

            const suffix = toInvite.length === 1 ? '' : 's';
            toast.success(`Invitation sent to ${toInvite.length} attendee${suffix}`);
        } catch (error: any) {
            console.error(error);
            toast.error(error?.message || 'Failed to send invitations');
        } finally {
            setIsInviting(false);
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
                <div className="flex items-end gap-2">
                    <input
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="Location or meeting link"
                        readOnly={isReadOnly}
                        className="w-full flex-1 border-b border-slate-100 focus:border-blue-600 focus:outline-none py-2 text-sm placeholder:text-slate-400 bg-transparent read-only:outline-none read-only:border-none"
                    />

                    {!isReadOnly && isGoogleMeetAvailable && !conferenceUrl && (
                        <button
                            type="button"
                            onClick={createGoogleMeet}
                            disabled={isCreatingMeet}
                            title="Add Google Meet"
                            className="shrink-0 pb-1 flex items-center gap-1 px-2 py-1 rounded border border-slate-200 bg-white text-slate-600 text-xs hover:bg-slate-50 disabled:opacity-50 transition-colors"
                        >
                            {isCreatingMeet ? <SpinIcon className="h-3 w-3 animate-spin" /> : <Video className="h-3 w-3" />}
                            {isCreatingMeet ? 'Creating…' : 'Meet'}
                        </button>
                    )}
                    {!isReadOnly && conferenceUrl && (
                        <button
                            type="button"
                            onClick={() => { setConferenceUrl(null); setLocation(''); }}
                            title="Remove video meeting"
                            className="shrink-0 pb-1 flex items-center gap-1 px-2 py-1 rounded border border-blue-200 bg-blue-50 text-blue-700 text-xs hover:bg-blue-100 transition-colors"
                        >
                            <Video className="h-3 w-3" />
                            Meet
                            <XIcon className="h-3 w-3" />
                        </button>
                    )}

                    {!isReadOnly && (
                        <div className="shrink-0 pb-1">
                            <ExtensionLoader
                                mountPoint="EVENT_LOCATION_BUILDER"
                                context={{
                                    eventTitle: title,
                                    startsAt,
                                    endsAt,
                                    startsAtIso: toIsoIfValid(startsAt),
                                    endsAtIso: toIsoIfValid(endsAt),
                                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                                    currentLocation: location,
                                    attendees: attendeeTags.filter((tag) => tag.includes('@')),
                                    setLocation,
                                    openOverlay: expansionUI?.openModal,
                                    close: expansionUI?.closeModal,
                                    onClose: expansionUI?.closeModal,
                                    isGoogleLinked,
                                    isGoogleMeetAvailable,
                                }}
                            />
                        </div>
                    )}
                </div>

                <div className="space-y-1">
                    {isReadOnly ? (
                        <div className="min-h-[42px] w-full border-b border-slate-100 py-2 text-sm text-slate-600">
                            {attendeeTags.length > 0 ? attendeeTags.join(', ') : 'No attendees'}
                        </div>
                    ) : (
                        <div className="flex items-end gap-2">
                            <TagInput
                                value={attendeeTags}
                                onChange={handleAttendeesChange}
                                placeholder="Invite recipients or mail groups"
                                className="flex-1 border-b border-slate-100 px-0 py-1.5"
                                suggestionEndpoint="/api/contacts/suggestions"
                            />
                            {eventId && (
                                <button
                                    type="button"
                                    onClick={inviteAttendees}
                                    disabled={isSaving || isInviting || getAttendeeList().length === 0}
                                    className="mb-1 ml-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-1.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap"
                                >
                                    {isInviting ? 'Enviando...' : 'Invitar'}
                                </button>
                            )}
                        </div>
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

                {attendeeAvailability.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 space-y-1.5">
                        <p className="text-xs font-medium uppercase tracking-wide text-amber-700">Conflictos de horario</p>
                        {attendeeAvailability.map(a => (
                            <div key={a.email} className="flex items-start gap-2 text-sm">
                                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                                <div className="min-w-0">
                                    <span className="font-medium text-slate-700">{a.name || a.email}</span>
                                    <span className="text-slate-500 ml-1">
                                        — {a.events.map(e => `${String(e.title || 'Evento')} (${new Date(e.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–${new Date(e.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`).join(', ')}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <div className="flex gap-4">
                    <div className="flex-1 space-y-1">
                        <label className="text-xs font-medium text-slate-500">Starts</label>
                        {isReadOnly ? (
                            <p className="text-sm py-2 text-slate-700">
                                {startsAt ? new Date(startsAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                            </p>
                        ) : (
                            <DateTimePicker
                                value={(startsAt || '').slice(0, 16)}
                                onChange={(v) => {
                                    setStartsAt(v);
                                    // Auto-advance endsAt if it's before or equal to new startsAt
                                    if (v && endsAt && v >= endsAt.slice(0, 16)) {
                                        const d = new Date(v);
                                        d.setHours(d.getHours() + 1);
                                        setEndsAt(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
                                    }
                                }}
                                placeholder="Start date & time"
                                className="border-slate-200 bg-slate-50 hover:bg-white"
                            />
                        )}
                    </div>
                    <div className="flex-1 space-y-1">
                        <label className="text-xs font-medium text-slate-500">Ends</label>
                        {isReadOnly ? (
                            <p className="text-sm py-2 text-slate-700">
                                {endsAt ? new Date(endsAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                            </p>
                        ) : (
                            <DateTimePicker
                                value={(endsAt || '').slice(0, 16)}
                                onChange={setEndsAt}
                                placeholder="End date & time"
                                className="border-slate-200 bg-slate-50 hover:bg-white"
                            />
                        )}
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
                            disabled={isSaving || isInviting}
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
