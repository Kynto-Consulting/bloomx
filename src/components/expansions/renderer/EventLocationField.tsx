'use client';

/**
 * Campo "Ubicacion" de un FORM de extension con `mountPoint: "EVENT_LOCATION_BUILDER"` (p. ej. "Invitar a un evento" del
 * compositor). Reutiliza EL MISMO selector de videoconferencia del calendario (ConferencingPicker: Google Meet / Zoom /
 * enlace propio, con su estado Listo / No disponible segun lo configurado y la creacion real de la reunion) junto al campo
 * de texto, que sirve para un lugar fisico. El enlace elegido se escribe en `location` y la reunion (proveedor, enlace, id)
 * viaja en `conferencing` dentro de formData, que el backend de Calendar ya entiende (args.conferencing) para el .ics.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConferencingPicker } from '@/components/conferencing/ConferencingPicker';
import { locationWithoutLink, meetingFromLink, type PickerMeeting } from '@/components/conferencing/picker-state';
import { providerIdForLink } from '@/lib/conferencing/hosts';
import { browserTimeZone, zonedLocalToDate } from '@/lib/expansions/client/datetime';

const toIso = (local: unknown, timeZone: string): string | null => {
    const date = zonedLocalToDate(local, timeZone);
    return date ? date.toISOString() : null;
};

export function EventLocationField({ control, fieldName, values, setValue, recipients }: {
    control: React.ReactNode;
    fieldName: string;
    values: Record<string, any>;
    setValue: (name: string, value: any) => void;
    recipients?: string[];
}) {
    const [conference, setConference] = useState<PickerMeeting | null>(null);
    const location = String(values[fieldName] ?? '');
    const timeZone = String(values.timeZone || browserTimeZone());
    const setValueRef = useRef(setValue);
    setValueRef.current = setValue;

    const effective = useMemo<PickerMeeting | null>(() => {
        if (conference && location.includes(conference.joinUrl)) return conference;
        return providerIdForLink(location) ? meetingFromLink(location) : null;
    }, [conference, location]);

    // La reunion efectiva viaja aparte en formData.conferencing (solo cambia cuando cambia el enlace).
    const joinUrl = effective?.joinUrl;
    const provider = effective?.provider;
    const meetingId = effective?.meetingId;
    useEffect(() => {
        const arg = joinUrl && provider ? { provider, joinUrl, ...(meetingId ? { meetingId: String(meetingId) } : {}) } : undefined;
        setValueRef.current?.('conferencing', arg);
    }, [joinUrl, provider, meetingId]);

    const onChange = useCallback((meeting: PickerMeeting | null) => {
        if (meeting) {
            setConference(meeting);
            setValueRef.current?.(fieldName, meeting.joinUrl);
            return;
        }
        const previous = effective?.joinUrl;
        setConference(null);
        if (previous) setValueRef.current?.(fieldName, locationWithoutLink(location, previous));
    }, [fieldName, effective, location]);

    const context = useMemo(() => ({
        title: String(values.title || ''),
        startsAt: toIso(values.startsAt, timeZone),
        endsAt: toIso(values.endsAt, timeZone),
        timeZone,
        attendees: (recipients ?? []).filter((email) => typeof email === 'string' && email.includes('@')),
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [values.title, values.startsAt, values.endsAt, timeZone, (recipients ?? []).join(',')]);

    return (
        <div className="flex w-full min-w-0 flex-col gap-2">
            {control}
            <ConferencingPicker compact allowCustom value={effective} onChange={onChange} context={context} />
        </div>
    );
}
