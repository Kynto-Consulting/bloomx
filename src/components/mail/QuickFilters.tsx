'use client';

import { cn } from '@/lib/utils';
import { useI18n } from '@/components/I18nProvider';
import { QUICK_FILTERS, type QuickFilter } from '@/lib/mail-list-view';

interface Props {
    value: QuickFilter;
    onChange: (next: QuickFilter) => void;
    /** Conteos EXACTOS del servidor (sin "+"). null/ausente = aun no se conoce: el chip se muestra sin numero. */
    counts: Partial<Record<QuickFilter, number | null>>;
    className?: string;
}

/** Filtros rapidos como chips (Todos, No leidos, Destacados, Con adjuntos, De mi) con conteo. aria-pressed en cada uno. */
export function QuickFilters({ value, onChange, counts, className }: Props) {
    const { t } = useI18n();
    return (
        <div role="group" aria-label={t('emailList.filters.label')} className={cn('flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]', className)}>
            {QUICK_FILTERS.map((f) => {
                const active = value === f;
                const n = counts[f];
                const known = typeof n === 'number';
                const countText = known ? String(n) : '';
                return (
                    <button
                        key={f}
                        type="button"
                        data-filter={f}
                        aria-pressed={active}
                        onClick={() => onChange(active && f !== 'all' ? 'all' : f)}
                        className={cn(
                            'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
                            '[@media(pointer:coarse)]:h-11',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            active
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border bg-chip text-chip-foreground hover:bg-accent hover:text-accent-foreground',
                        )}
                    >
                        <span>{t(`emailList.filters.${f}`)}</span>
                        {known && (
                            <span aria-label={t('emailList.filters.count', { n: countText })} className={cn('rounded-full px-1.5 text-[10px] font-semibold tabular-nums', active ? 'bg-primary-foreground/20' : 'bg-background/60')}>
                                {countText}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
