'use client';

import React, { useId, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import type { ConferencingProviderId } from '@/lib/conferencing/types';
import { ConferencingPicker } from './ConferencingPicker';
import { buildMeetingBlockHtml } from './meeting-block';
import type { PickerMeeting } from './picker-state';

export interface ComposerInsertion {
    meeting: PickerMeeting;
    /** Bloque HTML listo para insertar en el cuerpo ('' si el enlace no es seguro). */
    html: string;
    /** ICS que devolvio la extension (si lo hizo): el composer lo adjunta tal cual. */
    attachment: unknown | null;
}

const DURATIONS = [30, 45, 60, 90, 120];

/**
 * Panel del composer para "/zoom" y "/meet": fecha opcional + ConferencingPicker. Al crearse la reunion devuelve el
 * bloque HTML (boton "Unirse" y datos de marcacion) y el adjunto ICS de la extension, si existe.
 */
export function ComposerConferencingPanel({
    provider,
    subject,
    recipients,
    onInsert,
    onClose,
}: {
    provider: Exclude<ConferencingProviderId, 'custom'>;
    subject: string;
    recipients: string[];
    onInsert: (insertion: ComposerInsertion) => void;
    onClose: () => void;
}) {
    const { t, intlLocale } = useI18n();
    const uid = useId();
    const [start, setStart] = useState('');
    const [duration, setDuration] = useState(60);
    const [value, setValue] = useState<PickerMeeting | null>(null);

    const timeZone = useMemo(() => {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone;
        } catch {
            return 'UTC';
        }
    }, []);
    const startDate = start ? new Date(start) : null;
    const validStart = startDate && !Number.isNaN(startDate.getTime()) ? startDate : null;
    const endDate = validStart ? new Date(validStart.getTime() + duration * 60000) : null;
    const name = provider === 'zoom' ? 'Zoom' : 'Google Meet';
    const allowed = useMemo(() => [provider], [provider]);

    const context = useMemo(
        () => ({
            title: subject,
            startsAt: validStart ? validStart.toISOString() : null,
            endsAt: endDate ? endDate.toISOString() : null,
            timeZone,
            attendees: recipients,
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [subject, start, duration, timeZone, recipients.join(',')],
    );

    const handleChange = (meeting: PickerMeeting | null) => {
        setValue(meeting);
        if (!meeting) return;
        const html = buildMeetingBlockHtml({
            meeting,
            topic: subject,
            startsAt: validStart,
            endsAt: endDate,
            timeZone,
            locale: intlLocale,
            labels: {
                join: t('conferencing.block.join'),
                meetingId: t('conferencing.block.meetingId'),
                passcode: t('conferencing.block.passcode'),
                dialIn: t('conferencing.block.dialIn'),
                when: t('conferencing.block.when'),
            },
        });
        const attachment = (meeting as { attachment?: unknown }).attachment ?? null;
        onInsert({ meeting, html, attachment: attachment && typeof attachment === 'object' ? attachment : null });
        onClose();
    };

    return (
        <div role="dialog" aria-label={t('conferencing.composer.panelTitle', { provider: name })} data-testid="composer-conferencing-panel" className="w-[min(92vw,22rem)] space-y-3 p-3">
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{t('conferencing.composer.panelTitle', { provider: name })}</h3>
                <button type="button" onClick={onClose} aria-label={t('conferencing.composer.close')} className="rounded p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <X className="h-4 w-4" aria-hidden="true" />
                </button>
            </div>

            <div className="grid grid-cols-[1fr_auto] gap-2">
                <div className="space-y-1">
                    <label htmlFor={`${uid}-when`} className="text-xs font-medium text-muted-foreground">
                        {t('conferencing.composer.when')}
                    </label>
                    <input
                        id={`${uid}-when`}
                        type="datetime-local"
                        value={start}
                        onChange={(e) => setStart(e.target.value)}
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                </div>
                <div className="space-y-1">
                    <label htmlFor={`${uid}-dur`} className="text-xs font-medium text-muted-foreground">
                        {t('conferencing.composer.duration')}
                    </label>
                    <select
                        id={`${uid}-dur`}
                        value={duration}
                        disabled={!validStart}
                        onChange={(e) => setDuration(Number(e.target.value))}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                    >
                        {DURATIONS.map((d) => (
                            <option key={d} value={d}>
                                {t('conferencing.composer.minutes', { n: d })}
                            </option>
                        ))}
                    </select>
                </div>
            </div>
            <p className="text-xs text-muted-foreground">{t('conferencing.composer.whenHelp')}</p>

            <ConferencingPicker value={value} onChange={handleChange} context={context} allowed={allowed} compact />
        </div>
    );
}
