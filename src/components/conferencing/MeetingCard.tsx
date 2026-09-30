'use client';

import React from 'react';
import { Check, Copy, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { safeConferenceUrl } from '@/lib/conferencing/hosts';
import { PROVIDER_INFO } from '@/lib/conferencing/types';
import { ProviderIcon } from './ProviderIcon';
import { canDeleteRemote, type PickerMeeting } from './picker-state';

export interface MeetingCardProps {
    meeting: PickerMeeting;
    disabled?: boolean;
    busy?: boolean;
    copied?: boolean;
    confirmingRemove?: boolean;
    canRegenerate?: boolean;
    onCopy: () => void;
    onRegenerate: () => void;
    onAskRemove: () => void;
    onConfirmRemove: () => void;
    onCancelRemove: () => void;
    compact?: boolean;
}

const BTN =
    'inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';

/** Reunion ya creada: proveedor, enlace, copiar, regenerar y quitar (con confirmacion en linea, sin window.confirm). */
export function MeetingCard({ meeting, disabled, busy, copied, confirmingRemove, canRegenerate, onCopy, onRegenerate, onAskRemove, onConfirmRemove, onCancelRemove, compact }: MeetingCardProps) {
    const { t } = useI18n();
    const icon = PROVIDER_INFO[meeting.provider]?.icon ?? 'link';
    const href = safeConferenceUrl(meeting.joinUrl);
    const remote = canDeleteRemote(meeting);
    const dial = meeting.dialIn?.[0];
    return (
        <div data-testid="meeting-card" className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
                <ProviderIcon icon={icon} className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate">{meeting.providerName}</span>
            </div>
            <p className="break-all text-sm" aria-label={t('conferencing.picker.linkLabel')}>
                {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {meeting.joinUrl}
                    </a>
                ) : (
                    <span>{meeting.joinUrl}</span>
                )}
            </p>
            {!compact && (meeting.meetingId || meeting.passcode || dial) && (
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {meeting.meetingId && meeting.provider !== 'custom' && <li>{t('conferencing.picker.meetingId', { id: meeting.meetingId })}</li>}
                    {meeting.passcode && <li>{t('conferencing.picker.passcode', { code: meeting.passcode })}</li>}
                    {dial && <li>{t('conferencing.picker.dialIn', { number: dial.number })}</li>}
                </ul>
            )}

            {confirmingRemove ? (
                <div role="group" aria-label={t('conferencing.picker.removeConfirm')} className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
                    <span className="flex-1 text-foreground/80">
                        {t('conferencing.picker.removeConfirm')} {remote ? t('conferencing.picker.removeConfirmBody', { provider: meeting.providerName }) : ''}
                    </span>
                    <button type="button" onClick={onConfirmRemove} disabled={disabled || busy} className="inline-flex items-center gap-1 rounded-md bg-destructive px-2 py-1 font-semibold text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
                        {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                        {t('conferencing.picker.removeYes')}
                    </button>
                    <button type="button" onClick={onCancelRemove} disabled={busy} className={BTN}>
                        {t('conferencing.picker.removeNo')}
                    </button>
                </div>
            ) : (
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={onCopy} className={BTN} disabled={!href}>
                        {copied ? <Check className="h-3 w-3" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
                        {copied ? t('conferencing.picker.copied') : t('conferencing.picker.copy')}
                    </button>
                    {canRegenerate && !disabled && (
                        <button type="button" onClick={onRegenerate} disabled={busy} className={BTN}>
                            {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3 w-3" aria-hidden="true" />}
                            {busy ? t('conferencing.picker.regenerating') : t('conferencing.picker.regenerate')}
                        </button>
                    )}
                    {!disabled && (
                        <button type="button" onClick={onAskRemove} disabled={busy} className={`${BTN} text-destructive`}>
                            <Trash2 className="h-3 w-3" aria-hidden="true" />
                            {t('conferencing.picker.remove')}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
