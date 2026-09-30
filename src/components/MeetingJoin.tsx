'use client';

import { MapPin, TriangleAlert } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { MeetingProviderIcon } from '@/components/MeetingProviderIcon';
import type { JoinLinkResult } from '@/lib/calendar/join-link';

/**
 * Piezas del lector para el enlace de reunion de una invitacion recibida. La decision (boton / texto con aviso / nada)
 * la toma `resolveJoinLink` (src/lib/calendar/join-link.ts, puro y testeado): aqui solo se pinta.
 */

/** Fila de ubicacion: enlace reconocido como ancla; enlace no reconocido como TEXTO con aviso; si no, la ubicacion. */
export function MeetingLocationLine({ link, location }: { link: JoinLinkResult; location?: string | null }) {
    const { t } = useI18n();
    if (link.kind === 'none' && !location) return null;

    return (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-foreground">
            <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
            {link.kind === 'join' ? (
                <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t('mailMeeting.joinAria', { provider: link.providerName })}
                    className="font-medium text-link hover:text-link-hover hover:underline"
                >
                    {link.providerName}
                </a>
            ) : link.kind === 'unrecognized' ? (
                <>
                    <span className="break-all">{link.text}</span>
                    <span role="note" className="inline-flex items-center gap-1 text-xs text-warning">
                        <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        {t('mailMeeting.unrecognized')}
                    </span>
                </>
            ) : (
                <span>{location}</span>
            )}
        </div>
    );
}

/** Boton "Unirse": solo para enlaces https de un proveedor reconocido (href normalizado). */
export function JoinMeetingButton({ link }: { link: JoinLinkResult }) {
    const { t } = useI18n();
    if (link.kind !== 'join') return null;
    return (
        <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('mailMeeting.joinAria', { provider: link.providerName })}
            className="inline-flex items-center gap-2 rounded-full border border-primary bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
            <MeetingProviderIcon provider={link.provider} className="h-4 w-4 shrink-0" />
            {t('mailMeeting.join', { provider: link.providerName })}
        </a>
    );
}
