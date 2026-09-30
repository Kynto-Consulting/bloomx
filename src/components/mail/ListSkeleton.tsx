'use client';

import { useI18n } from '@/components/I18nProvider';
import { densityClasses, type MailDensity } from '@/lib/mail-prefs';
import { cn } from '@/lib/utils';

/** Esqueleto de carga: filas con la misma geometria que las reales (sin salto al llegar los datos). */
export function ListSkeleton({ density, rows = 8 }: { density: MailDensity; rows?: number }) {
    const { t } = useI18n();
    const dim = densityClasses(density);
    const compact = density === 'compact';
    return (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className={cn('flex flex-col', dim.list)}>
            <span className="sr-only">{t('common.loading')}</span>
            {Array.from({ length: rows }, (_, i) => (
                <div key={i} aria-hidden="true" className={cn('flex items-start rounded-xl border border-border/40 bg-background', dim.gap, dim.row)}>
                    <div className={cn('shrink-0 animate-pulse rounded-full bg-muted', compact ? 'h-7 w-7' : dim.avatar.split(' ').filter((c) => /^[hw]-/.test(c)).join(' '))} />
                    <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex items-center justify-between gap-6">
                            <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                            <div className="h-3 w-10 animate-pulse rounded bg-muted" />
                        </div>
                        {!compact && <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />}
                        {!compact && density === 'spacious' && <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />}
                    </div>
                </div>
            ))}
        </div>
    );
}
