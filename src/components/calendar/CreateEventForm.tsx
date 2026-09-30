'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ExtensionLoader } from '@/components/expansions/ExtensionLoader';
import { TagInput } from '@/components/ui/TagInput';
import { DateTimePicker } from '@/components/ui/DateTimePicker';
import { executeExtensionAction, fetchExpansions } from '@/lib/expansions/api';
import { useOptionalExpansionUI } from '@/contexts/ExpansionUIContext';
import { buildEmailHtml, buildEmailText, calendarInviteOptions, emailSubject } from '@/lib/calendar/email-templates';
import { getEmailBrand } from '@/lib/calendar/email-brand';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { toast } from 'sonner';
import { useI18n } from '@/components/I18nProvider';
import { pluralKey } from '@/lib/i18n/format';
import { ConferencingPicker } from '@/components/conferencing/ConferencingPicker';
import { JoinMeetingButton } from '@/components/conferencing/JoinMeetingButton';
import { locationWithoutLink, meetingFromLink, type PickerMeeting } from '@/components/conferencing/picker-state';
import { providerIdForLink } from '@/lib/conferencing/hosts';

const pad = (n: number) => String(n).padStart(2, '0');

type EventAttendee = {
    email: string;
    name?: string | null;
    responseStatus?: string | null;
    isOrganizer?: boolean;
    invitedAt?: string | null;
};

function getResponseKey(responseStatus?: string | null) {
    const normalized = String(responseStatus || '').toLowerCase();
    if (normalized === 'accepted') return 'calendar.form.resp.yes';
    if (normalized === 'declined') return 'calendar.form.resp.no';
    if (normalized === 'tentative') return 'calendar.form.resp.maybe';
    return 'calendar.form.resp.pending';
}

function getResponseClass(responseStatus?: string | null) {
    const normalized = String(responseStatus || '').toLowerCase();
    if (normalized === 'accepted') return 'bg-success/10 text-success border-success/30';
    if (normalized === 'declined') return 'bg-destructive/10 text-destructive border-destructive/30';
    if (normalized === 'tentative') return 'bg-warning/10 text-warning border-warning/30';
    return 'bg-muted/50 text-muted-foreground border-border';
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
    const { t, intlLocale, locale: uiLocale } = useI18n();
    const { config: domainConfig } = useDomainConfig();
    const fmtTime = (value: string) =>
        new Intl.DateTimeFormat(intlLocale, { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
    const fmtFull = (value: string) =>
        new Intl.DateTimeFormat(intlLocale, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
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
    // Reunion creada/pegada con el selector de videoconferencia (su enlace tambien va en `location`).
    const [conference, setConference] = useState<PickerMeeting | null>(null);
    const attendeeChangeSeqRef = useRef(0);
    // Stable idempotency key for NEW events: a double-click / retried POST reuses
    // the same UID, so the server's inviteUid upsert path updates instead of
    // creating a duplicate row. Existing events already have a server UID.
    const inviteUidRef = useRef<string>('');
    if (!eventId && !inviteUidRef.current) {
        const brandLocal = (process.env.NEXT_PUBLIC_BRAND_NAME || 'bloom').toLowerCase().replace(/[^a-z0-9]/g, '');
        inviteUidRef.current = `${crypto.randomUUID()}@${brandLocal}.local`;
    }
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

    // Reunion efectiva: la del selector mientras su enlace siga en la ubicacion; si no, el enlace reconocido que ya
    // trae la ubicacion (evento guardado con Zoom/Meet) para mostrar su proveedor.
    const effectiveConference = React.useMemo<PickerMeeting | null>(() => {
        if (conference && location.includes(conference.joinUrl)) return conference;
        return providerIdForLink(location) ? meetingFromLink(location) : null;
    }, [conference, location]);

    const buildEventPayload = useCallback((targetCalendarId?: string) => {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const startsAtIso = toIsoIfValid(startsAt);
        const endsAtIso = toIsoIfValid(endsAt);
        // Solo si hay conferencia; el id de reunion solo existe cuando la creo una extension.
        const conferenceFields = effectiveConference
            ? {
                conferenceUrl: effectiveConference.joinUrl,
                conferenceProvider: effectiveConference.provider,
                ...(effectiveConference.meetingId ? { conferenceMeetingId: effectiveConference.meetingId } : {}),
            }
            : {};

        return {
            ...conferenceFields,
            calendarId: targetCalendarId,
            title: title || t('calendar.form.defaultTitle'),
            location,
            startsAt: startsAtIso,
            endsAt: endsAtIso,
            startsAtLocal: startsAt,
            endsAtLocal: endsAt,
            timeZone,
            attendees: getAttendeeList(),
            inviteUid: eventId ? undefined : inviteUidRef.current,
        };
    }, [title, location, startsAt, endsAt, getAttendeeList, toIsoIfValid, eventId, t, effectiveConference]);

    const markAttendeesAsPending = useCallback((emails: string[]) => {
        const normalizedEmails = normalizeTags(emails);

        setAttendeeDetails((current) => {
            const organizers = current.filter((attendee) => attendee.isOrganizer);
            const existingByEmail = new Map(
                current
                    .filter((attendee) => !attendee.isOrganizer)
                    .map((attendee) => [attendee.email.toLowerCase(), attendee])
            );

            const nowIso = new Date().toISOString();
            const updatedAttendees = normalizedEmails.map((email) => {
                const existing = existingByEmail.get(email.toLowerCase());
                if (existing) {
                    // They were just (re)invited — record it so we don't re-mail.
                    return { ...existing, invitedAt: nowIso } satisfies EventAttendee;
                }

                return {
                    email,
                    name: null,
                    responseStatus: 'needsAction',
                    isOrganizer: false,
                    invitedAt: nowIso,
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

    // El selector de videoconferencia crea/pega/quita la reunion: su enlace se guarda en `location` (como siempre).
    const handleConferenceChange = useCallback((meeting: PickerMeeting | null) => {
        if (meeting) {
            setConference(meeting);
            setLocation(meeting.joinUrl);
            return;
        }
        const previous = effectiveConference?.joinUrl;
        setConference(null);
        if (previous) setLocation((current) => locationWithoutLink(current, previous));
    }, [effectiveConference]);

    // Shared send path: generate the .ics for the event and email it to the
    // given recipients. Used by both Save (auto-send) and the Invitar button.
    // replaceAttendees:false so sending to a subset never wipes attendees that
    // were already invited on the event.
    const sendInvitations = useCallback(async (targetEventId: string, recipients: string[]) => {
        const cleanRecipients = normalizeTags(recipients).filter((email) => email.includes('@'));
        if (!targetEventId || cleanRecipients.length === 0) {
            return false;
        }

        const inviteAttachmentResponse = await fetch(`/api/calendar/events/${targetEventId}/attach-invite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: cleanRecipients, replaceAttendees: false }),
        });
        const inviteAttachmentResult = await inviteAttachmentResponse.json().catch(() => null);

        if (!inviteAttachmentResponse.ok || !inviteAttachmentResult?.attachment) {
            throw new Error(t('calendar.form.inviteAttachmentFailed'));
        }

        // Contenido SALIENTE: MISMA plantilla (marca de la empresa, idioma del usuario) para HTML, texto y asunto.
        const subjectTitle = title || inviteAttachmentResult.subject || '';
        const parsedStart = startsAt ? new Date(startsAt) : new Date();
        const parsedEnd = endsAt ? new Date(endsAt) : new Date(parsedStart.getTime() + 3600000);
        const templateOptions = calendarInviteOptions({
            title: subjectTitle,
            startsAt: parsedStart,
            endsAt: parsedEnd,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            location: location || null,
            brand: getEmailBrand(domainConfig),
            locale: uiLocale,
        });
        const html = buildEmailHtml(templateOptions);
        // Mismo idioma y datos que el HTML: una discrepancia texto/HTML es una senal de spam.
        const text = buildEmailText(templateOptions);

        const sendInvitesResponse = await fetch('/api/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to: cleanRecipients.join(','),
                subject: emailSubject(uiLocale, 'invitation', subjectTitle),
                html,
                text,
                attachments: [inviteAttachmentResult.attachment],
            }),
        });
        const sendInvitesResult = await sendInvitesResponse.json().catch(() => null);

        if (!sendInvitesResponse.ok || !sendInvitesResult?.success) {
            throw new Error(t('calendar.form.sendInvitesFailed'));
        }

        markAttendeesAsPending(cleanRecipients);
        window.dispatchEvent(new CustomEvent('bloomx:calendar-sync-complete'));
        return true;
    }, [title, location, startsAt, endsAt, normalizeTags, markAttendeesAsPending, t, domainConfig, uiLocale]);

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
                    toast.error(t('calendar.form.noWritableCalendar'));
                    setIsSaving(false);
                    return;
                }
                targetCalendarId = localCalendar.id;
            }

            const url = eventId ? `/api/calendar/events/${eventId}` : '/api/calendar/events';
            const method = eventId ? 'PUT' : 'POST';
            const payload = buildEventPayload(targetCalendarId);

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(t('calendar.form.saveFailed'));
            }

            const savedEvent = await response.json().catch(() => null);

            // Invites are sent server-side by the POST/PUT routes (works even with
            // a stale client bundle). Just surface the count the server reports.
            const invitedCount = Number(savedEvent?.invitedCount) || 0;
            if (invitedCount > 0) {
                toast.success(t(pluralKey('calendar.form.invited', invitedCount), { n: invitedCount }));
            }

            if (!eventId) {
                setTitle('');
                setLocation('');
                setConference(null);
                setAttendeeTags([]);
            }
            onSaved();
        } catch (error: any) {
            console.error(error);
            toast.error(error?.message || t('calendar.form.saveFailed'));
        } finally {
            setIsSaving(false);
        }
    };

    const inviteAttendees = async () => {
        if (!eventId) {
            toast.error(t('calendar.form.saveBeforeInvite'));
            return;
        }

        const attendeeList = getAttendeeList();
        if (attendeeList.length === 0) {
            toast.error(t('calendar.form.addAttendee'));
            return;
        }

        const oldEmails = new Set(
            attendeeDetails
                .filter(a => a.invitedAt || a.isOrganizer)
                .map(a => a.email.toLowerCase())
        );
        const newlyAdded = attendeeList.filter(email => !oldEmails.has(email.toLowerCase()));

        // New people get the invite; if everyone is already known, re-send to all.
        const toInvite = newlyAdded.length > 0 ? newlyAdded : attendeeList;

        setIsInviting(true);
        try {
            // attach-invite (inside sendInvitations) creates any missing attendees
            // with replaceAttendees:false, so an explicit PUT here is unnecessary
            // and would double-send via the route's own auto-invite.
            const sent = await sendInvitations(eventId, toInvite);

            if (sent) {
                toast.success(t(pluralKey('calendar.form.invited', toInvite.length), { n: toInvite.length }));
            }
        } catch (error: any) {
            console.error(error);
            toast.error(error?.message || t('calendar.form.inviteFailed'));
        } finally {
            setIsInviting(false);
        }
    };

    const deleteEvent = async () => {
        if (!eventId || !confirm(t('calendar.form.deleteConfirm'))) return;
        setIsSaving(true);
        try {
            const res = await fetch(`/api/calendar/events/${eventId}`, { method: 'DELETE' });
            const result = await res.json().catch(() => null);
            if (!res.ok) throw new Error('delete_failed');
            if (result?.cancelledNotified > 0) {
                toast.success(t(pluralKey('calendar.form.deletedNotified', result.cancelledNotified), { n: result.cancelledNotified }));
            }
            onSaved();
        } catch (error) {
            console.error(error);
            toast.error(t('calendar.form.deleteFailed'));
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
                placeholder={t('calendar.form.titlePlaceholder')} aria-label={t('calendar.form.titleLabel')}
                className="w-full border-b-2 border-border/60 focus:border-primary focus:outline-none pb-2 text-[22px] mb-4 placeholder:text-muted-foreground bg-transparent read-only:outline-none read-only:border-none" 
            />
            
            <div className="space-y-4 flex-1">
                <div className="flex items-end gap-2">
                    <input
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder={t('calendar.form.locationPlaceholder')} aria-label={t('calendar.form.locationPlaceholder')}
                        readOnly={isReadOnly}
                        className="w-full flex-1 border-b border-border/60 focus:border-primary focus:outline-none py-2 text-sm placeholder:text-muted-foreground bg-transparent read-only:outline-none read-only:border-none"
                    />

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

                {isReadOnly ? (
                    <div className="flex flex-wrap items-center gap-2">
                        <JoinMeetingButton url={location} />
                    </div>
                ) : (
                    <ConferencingPicker
                        compact
                        allowCustom
                        value={effectiveConference}
                        onChange={handleConferenceChange}
                        context={{
                            title,
                            startsAt: toIsoIfValid(startsAt) || null,
                            endsAt: toIsoIfValid(endsAt) || null,
                            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                            attendees: attendeeTags.filter((tag) => tag.includes('@')),
                        }}
                    />
                )}

                <div className="space-y-1">
                    {isReadOnly ? (
                        <div className="min-h-[42px] w-full border-b border-border/60 py-2 text-sm text-muted-foreground">
                            {attendeeTags.length > 0 ? attendeeTags.join(', ') : t('calendar.form.noAttendees')}
                        </div>
                    ) : (
                        <div className="flex items-end gap-2">
                            <TagInput
                                value={attendeeTags}
                                onChange={handleAttendeesChange}
                                placeholder={t('calendar.form.attendeesPlaceholder')}
                                className="flex-1 border-b border-border/60 px-0 py-1.5"
                                suggestionEndpoint="/api/contacts/suggestions"
                            />
                            {eventId && (
                                <button
                                    type="button"
                                    onClick={inviteAttendees}
                                    disabled={isSaving || isInviting || getAttendeeList().length === 0}
                                    className="mb-1 ml-2 rounded-md border border-primary/20 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap"
                                >
                                    {isInviting ? t('calendar.form.inviting') : t('calendar.form.invite')}
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {attendeeDetails.length > 0 && (
                    <div className="space-y-2 rounded-lg border border-border bg-muted/50 p-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('calendar.form.attendeeStatus')}</p>
                        <div className="space-y-1.5">
                            {attendeeDetails
                                .filter((attendee) => !attendee.isOrganizer)
                                .map((attendee) => (
                                    <div key={attendee.email} className="flex items-center justify-between gap-3 rounded-md bg-card px-2.5 py-2 border border-border/60">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm text-foreground/80">{attendee.name || attendee.email}</p>
                                            {attendee.name && <p className="truncate text-xs text-muted-foreground">{attendee.email}</p>}
                                        </div>
                                        <span className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${getResponseClass(attendee.responseStatus)}`}>
                                            {t(getResponseKey(attendee.responseStatus))}
                                        </span>
                                    </div>
                                ))}
                        </div>
                    </div>
                )}

                {attendeeAvailability.length > 0 && (
                    <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 space-y-1.5">
                        <p className="text-xs font-medium uppercase tracking-wide text-warning">{t('calendar.form.conflicts')}</p>
                        {attendeeAvailability.map(a => (
                            <div key={a.email} className="flex items-start gap-2 text-sm">
                                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
                                <div className="min-w-0">
                                    <span className="font-medium text-foreground/80">{a.name || a.email}</span>
                                    <span className="text-muted-foreground ml-1">
                                        — {a.events.map(e => `${String(e.title || t('calendar.form.eventFallback'))} (${fmtTime(e.startsAt)}–${fmtTime(e.endsAt)})`).join(', ')}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <div className="flex gap-4">
                    <div className="flex-1 space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">{t('calendar.form.starts')}</label>
                        {isReadOnly ? (
                            <p className="text-sm py-2 text-foreground/80">
                                {startsAt ? fmtFull(startsAt) : '—'}
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
                                placeholder={t('calendar.form.startPlaceholder')}
                                ariaLabel={t('calendar.form.starts')}
                                className="border-border bg-muted/50 hover:bg-background"
                            />
                        )}
                    </div>
                    <div className="flex-1 space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">{t('calendar.form.ends')}</label>
                        {isReadOnly ? (
                            <p className="text-sm py-2 text-foreground/80">
                                {endsAt ? fmtFull(endsAt) : '—'}
                            </p>
                        ) : (
                            <DateTimePicker
                                value={(endsAt || '').slice(0, 16)}
                                onChange={setEndsAt}
                                placeholder={t('calendar.form.endPlaceholder')}
                                ariaLabel={t('calendar.form.ends')}
                                className="border-border bg-muted/50 hover:bg-background"
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
                        className="text-destructive hover:text-destructive font-medium px-2 py-2 text-sm"
                    >
                        {t('common.delete')}
                    </button>
                ) : <div></div>}

                <div className="flex">
                    {onClose && (
                        <button 
                            type="button" 
                            onClick={onClose}
                            className="text-muted-foreground hover:text-foreground/80 font-medium px-4 py-2 mr-2 text-sm"
                        >
                            {isReadOnly ? t('common.close') : t('common.cancel')}
                        </button>
                    )}
                    {!isReadOnly && (
                        <button 
                            type="submit" 
                            disabled={isSaving || isInviting}
                            className="bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-md text-sm font-medium px-6 py-2 transition-colors"
                        >
                            {isSaving ? t('common.saving') : t('common.save')}
                        </button>
                    )}
                </div>
            </div>
        </form>
    );
}
