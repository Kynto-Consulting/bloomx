'use client';

import { CalendarPlus, Check, CircleHelp, Clock, CalendarDays, X } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { JoinMeetingButton, MeetingLocationLine } from '@/components/MeetingJoin';
import type { JoinLinkResult } from '@/lib/calendar/join-link';
import { cn } from '@/lib/utils';
import type { InvitePreview, InviteResponse } from './reader-types';

type Answer = 'accepted' | 'tentative' | 'declined';

export interface InviteCardProps {
    invite: InvitePreview;
    response?: InviteResponse | null;
    joinLink: JoinLinkResult;
    whenText: string;
    busy: boolean;
    calendarBusy: boolean;
    onRespond: (response: Answer) => void;
    onAddToCalendar: () => void;
}

/** Estilo del boton de respuesta seleccionado: relleno solido del token semantico (texto -foreground, AA por check:themes). */
const SELECTED: Record<Answer, string> = {
    accepted: 'bg-success text-success-foreground',
    tentative: 'bg-warning text-warning-foreground',
    declined: 'bg-destructive text-destructive-foreground',
};
const ICON_TONE: Record<Answer, string> = { accepted: 'text-success', tentative: 'text-warning', declined: 'text-destructive' };

/**
 * Tarjeta "Invitacion de calendario detectada": superficie neutra (card) con acento de marca en el borde izquierdo;
 * respuesta como grupo segmentado (apilado a ancho completo en movil), "Unirse" como accion primaria y
 * "Agregar al calendario" como boton secundario compacto de una sola linea.
 */
export function InviteCard({ invite, response, joinLink, whenText, busy, calendarBusy, onRespond, onAddToCalendar }: InviteCardProps) {
    const { t } = useI18n();
    const current = response?.response ?? null;
    const options: { id: Answer; label: string; Icon: typeof Check }[] = [
        { id: 'accepted', label: t('mailView.invite.accept'), Icon: Check },
        { id: 'tentative', label: t('mailView.invite.maybe'), Icon: CircleHelp },
        { id: 'declined', label: t('mailView.invite.decline'), Icon: X },
    ];

    return (
        <section
            data-invite-card
            aria-label={t('mailView.invite.detected')}
            className="mb-6 rounded-xl border border-border border-l-4 border-l-primary bg-card p-4 text-sm text-card-foreground shadow-sm"
        >
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <CalendarDays className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span>{t('mailView.invite.detected')}</span>
            </div>
            <div className="mt-2 break-words text-base font-semibold text-foreground">{invite.title}</div>
            {whenText && (
                <div className="mt-1 flex items-center gap-2 text-foreground">
                    <Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span>{whenText}</span>
                </div>
            )}
            <div className="mt-1"><MeetingLocationLine link={joinLink} location={invite.location} /></div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <div role="group" aria-label={t('mailView.invite.detected')} className="flex flex-col overflow-hidden rounded-lg border border-border bg-background sm:inline-flex sm:flex-row">
                    {options.map(({ id, label, Icon }) => {
                        const selected = current === id;
                        return (
                            <button
                                key={id}
                                type="button"
                                disabled={busy}
                                aria-pressed={selected}
                                onClick={() => onRespond(id)}
                                className={cn(
                                    'inline-flex min-h-10 items-center justify-center gap-1.5 whitespace-nowrap px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60',
                                    'border-t border-border first:border-t-0 sm:border-l sm:border-t-0 sm:first:border-l-0',
                                    selected ? SELECTED[id] : 'text-foreground hover:bg-muted',
                                )}
                            >
                                <Icon className={cn('h-4 w-4 shrink-0', selected ? '' : ICON_TONE[id])} aria-hidden="true" />
                                {label}
                            </button>
                        );
                    })}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <JoinMeetingButton link={joinLink} />
                    <button
                        type="button"
                        disabled={calendarBusy}
                        onClick={onAddToCalendar}
                        className="inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                    >
                        <CalendarPlus className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>{t('mailView.invite.addToCalendar')}</span>
                    </button>
                </div>
            </div>
        </section>
    );
}
