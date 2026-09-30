'use client';

import React, { useId, useState } from 'react';
import { useI18n } from '@/components/I18nProvider';
import { cn } from '@/lib/utils';
import { checkCustomLink, meetingFromCustomLink, type PickerMeeting } from './picker-state';

export interface CustomLinkInputProps {
    onUse: (meeting: PickerMeeting) => void;
    disabled?: boolean;
    compact?: boolean;
}

/**
 * Enlace propio: se valida en el navegador (https, sin credenciales, sin caracteres raros). Si el host no es de un
 * proveedor conocido se avisa pero se permite. No requiere credenciales ni llama al servidor.
 */
export function CustomLinkInput({ onUse, disabled, compact }: CustomLinkInputProps) {
    const { t } = useI18n();
    const uid = useId();
    const [raw, setRaw] = useState('');
    const check = checkCustomLink(raw);
    const descId = `${uid}-desc`;
    const canUse = check.status === 'valid' || check.status === 'unrecognized';

    const submit = () => {
        if (check.status === 'valid' || check.status === 'unrecognized') onUse(meetingFromCustomLink(check.info));
    };

    return (
        <div className="space-y-1.5">
            <label htmlFor={`${uid}-url`} className="text-xs font-medium text-muted-foreground">
                {t('conferencing.custom.label')}
            </label>
            <div className={cn('flex gap-2', compact && 'flex-wrap')}>
                <input
                    id={`${uid}-url`}
                    type="text"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    value={raw}
                    disabled={disabled}
                    onChange={(e) => setRaw(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            submit();
                        }
                    }}
                    placeholder={t('conferencing.custom.placeholder')}
                    aria-invalid={check.status === 'invalid' || undefined}
                    aria-describedby={descId}
                    className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <button
                    type="button"
                    onClick={submit}
                    disabled={disabled || !canUse}
                    className="h-9 shrink-0 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                    {t('conferencing.custom.use')}
                </button>
            </div>
            <div id={descId} aria-live="polite" className="min-h-4 text-xs">
                {check.status === 'invalid' && (
                    <p role="alert" className="text-destructive">
                        {t('conferencing.custom.invalid')}
                    </p>
                )}
                {check.status === 'unrecognized' && (
                    <p role="status" className="text-warning">
                        {t('conferencing.custom.unrecognized', { host: check.info.providerName })}
                    </p>
                )}
                {check.status === 'valid' && (
                    <p role="status" className="text-muted-foreground">
                        {t('conferencing.custom.recognized', { provider: check.info.providerName })}
                    </p>
                )}
                {check.status === 'empty' && <p className="text-muted-foreground">{t('conferencing.custom.hint')}</p>}
            </div>
        </div>
    );
}
