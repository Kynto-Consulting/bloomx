'use client';

import React from 'react';
import { useI18n } from '@/components/I18nProvider';
import { cn } from '@/lib/utils';
import { recognizeMeetingUrl } from '@/lib/conferencing/hosts';
import { ProviderIcon } from './ProviderIcon';

/**
 * "Unirse a la reunion" para un enlace reconocido (https, sin credenciales, host de un proveedor conocido).
 * Cualquier otro enlace no genera boton (se queda como texto). `rel="noopener noreferrer"`.
 */
export function JoinMeetingButton({ url, className }: { url: unknown; className?: string }) {
    const { t } = useI18n();
    const info = recognizeMeetingUrl(url);
    if (!info) return null;
    const icon = info.provider === 'google-meet' ? 'google-meet' : info.provider === 'zoom' ? 'zoom' : 'link';
    return (
        <a
            href={info.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('conferencing.join.buttonProvider', { provider: info.providerName })}
            className={cn(
                'inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                className,
            )}
        >
            <ProviderIcon icon={icon} className="h-4 w-4" />
            {t('conferencing.join.button')}
        </a>
    );
}
