'use client';

import { useEffect, useState } from 'react';
import { CloudOff, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/I18nProvider';
import { useOffline } from '@/contexts/OfflineContext';
import { formatRelativeTime } from '@/lib/i18n/format';
import { IconButton } from './ui';

interface Props {
    /** Momento (ms) de la ultima sincronizacion correcta; null = aun no. */
    lastSync: number | null;
    refreshing: boolean;
    onRefresh: () => void;
    className?: string;
}

/**
 * "Sincronizado hace 2 min" + boton de refrescar + indicador de sin conexion y de acciones pendientes en cola.
 * El texto relativo se actualiza cada 30 s; los cambios de estado se anuncian con role="status".
 */
export function SyncStatus({ lastSync, refreshing, onRefresh, className }: Props) {
    const { t, intlLocale } = useI18n();
    const { isOnline, queue } = useOffline();
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(id);
    }, []);
    // Tras una sincronizacion el texto debe decir "ahora" sin esperar al siguiente tick.
    useEffect(() => { setNow(Date.now()); }, [lastSync]);

    const pending = queue.length;
    const syncText = lastSync ? t('emailList.sync.last', { when: formatRelativeTime(lastSync, intlLocale, now) }) : t('emailList.sync.never');

    return (
        <div className={cn('flex items-center gap-1.5 text-[11px] text-muted-foreground', className)}>
            <div role="status" aria-live="polite" className="flex items-center gap-1.5">
                {!isOnline && (
                    <span data-testid="offline-badge" className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 font-medium text-warning">
                        <CloudOff className="h-3 w-3" aria-hidden="true" /> {t('emailList.sync.offline')}
                    </span>
                )}
                {pending > 0 && (
                    <span data-testid="pending-badge" className="inline-flex items-center rounded-full border border-info/40 bg-info/10 px-2 py-0.5 font-medium text-info">
                        {t(pending === 1 ? 'emailList.sync.pendingOne' : 'emailList.sync.pendingMany', { n: pending })}
                    </span>
                )}
                <span className="hidden whitespace-nowrap lg:inline">{syncText}</span>
            </div>
            <IconButton label={`${t('emailList.sync.refresh')}. ${syncText}`} onClick={onRefresh} disabled={refreshing} aria-busy={refreshing || undefined}>
                <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} aria-hidden="true" />
            </IconButton>
        </div>
    );
}
