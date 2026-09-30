'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { btnOutline, selectClass } from './ui';
import { cn } from '@/lib/utils';

/** Paginacion por offset. `page` base 1. Muestra el rango, los botones con nombre accesible y el tamano de pagina. */
export function Pagination({
    page, pages, total, pageSize, onPage, onPageSize, pageSizes = [10, 25, 50, 100], className,
}: {
    page: number; pages: number; total: number; pageSize: number;
    onPage: (p: number) => void; onPageSize?: (n: number) => void; pageSizes?: number[]; className?: string;
}) {
    const { t, intlLocale } = useI18n();
    const uid = React.useId();
    const nf = new Intl.NumberFormat(intlLocale);
    const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const to = Math.min(total, page * pageSize);
    const btn = cn(btnOutline, 'h-8 w-8 px-0');
    return (
        <nav aria-label={t('admin.console.common.table.pagination')} className={cn('flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground', className)}>
            <p aria-live="polite">{t('admin.console.common.table.rowsSummary', { from: nf.format(from), to: nf.format(to), total: nf.format(total) })}</p>
            <div className="flex flex-wrap items-center gap-2">
                {onPageSize && (
                    <div className="flex items-center gap-2">
                        <label htmlFor={`${uid}-ps`} className="text-xs">{t('admin.console.common.table.pageSize')}</label>
                        <select id={`${uid}-ps`} value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className={cn(selectClass, 'h-8 w-auto py-0')}>
                            {pageSizes.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                    </div>
                )}
                <span>{t('admin.console.common.table.pageOf', { page, pages })}</span>
                <button type="button" className={btn} onClick={() => onPage(1)} disabled={page <= 1} aria-label={t('admin.console.common.table.first')}><ChevronsLeft className="h-4 w-4" aria-hidden="true" /></button>
                <button type="button" className={btn} onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label={t('admin.console.common.table.prev')}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
                <button type="button" className={btn} onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label={t('admin.console.common.table.next')}><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
                <button type="button" className={btn} onClick={() => onPage(pages)} disabled={page >= pages} aria-label={t('admin.console.common.table.last')}><ChevronsRight className="h-4 w-4" aria-hidden="true" /></button>
            </div>
        </nav>
    );
}
