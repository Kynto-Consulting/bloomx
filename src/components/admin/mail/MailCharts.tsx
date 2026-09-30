'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import { cn } from '@/lib/utils';

/**
 * Grafica de barras agrupadas hecha con CSS (sin librerias), solo tokens de tema. Accesible: la grafica es decorativa
 * (aria-hidden) y se acompana de una tabla textual equivalente para lectores de pantalla; la leyenda usa texto, no solo color.
 */
export interface ChartSeries {
    key: string;
    label: string;
    /** Clase de color de la barra (token de tema). */
    className: string;
}

export interface ChartPoint {
    bucket: string;
    values: Record<string, number>;
}

/** 'YYYY-MM-DD' -> 'MM-DD'; 'YYYY-MM-DDTHH' -> 'HH:00'. */
export function bucketLabel(bucket: string): string {
    if (bucket.includes('T')) return `${bucket.split('T')[1]}:00`;
    return bucket.slice(5);
}

export function BarChart({ title, series, points, className }: { title: string; series: ChartSeries[]; points: ChartPoint[]; className?: string }) {
    const { t, intlLocale } = useI18n();
    const nf = React.useMemo(() => new Intl.NumberFormat(intlLocale), [intlLocale]);
    const max = Math.max(0, ...points.flatMap((p) => series.map((s) => p.values[s.key] ?? 0)));
    const empty = max === 0;
    const labelIdx = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]);

    return (
        <figure className={cn('space-y-3', className)}>
            <figcaption className="sr-only">{title}</figcaption>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label={title}>
                {series.map((s) => (
                    <li key={s.key} className="inline-flex items-center gap-1.5">
                        <span aria-hidden="true" className={cn('inline-block h-2.5 w-2.5 rounded-sm', s.className)} />
                        {s.label}
                    </li>
                ))}
            </ul>
            {empty ? (
                <p className="rounded-lg bg-muted/50 px-3 py-6 text-center text-sm text-muted-foreground">{t('admin.console.mail.overview.chartNoData')}</p>
            ) : (
                <div aria-hidden="true">
                    <div className="flex h-32 items-end gap-px border-b border-border">
                        {points.map((p) => (
                            <div
                                key={p.bucket}
                                className="flex h-full min-w-0 flex-1 items-end justify-center gap-px"
                                title={`${p.bucket}: ${series.map((s) => `${s.label} ${nf.format(p.values[s.key] ?? 0)}`).join(', ')}`}
                            >
                                {series.map((s) => {
                                    const v = p.values[s.key] ?? 0;
                                    return (
                                        <span
                                            key={s.key}
                                            className={cn('block w-full max-w-3 rounded-t-sm', s.className)}
                                            style={{ height: v > 0 ? `max(2px, ${(v / max) * 100}%)` : 0 }}
                                        />
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                    <div className="mt-1 flex gap-px text-[10px] text-muted-foreground">
                        {points.map((p, i) => (
                            <span key={p.bucket} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">{labelIdx.has(i) ? bucketLabel(p.bucket) : ''}</span>
                        ))}
                    </div>
                </div>
            )}
            <table className="sr-only">
                <caption>{t('admin.console.mail.overview.tableCaption', { title })}</caption>
                <thead>
                    <tr>
                        <th scope="col">{t('admin.console.mail.overview.bucket')}</th>
                        {series.map((s) => <th key={s.key} scope="col">{s.label}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {points.map((p) => (
                        <tr key={p.bucket}>
                            <th scope="row">{p.bucket}</th>
                            {series.map((s) => <td key={s.key}>{nf.format(p.values[s.key] ?? 0)}</td>)}
                        </tr>
                    ))}
                </tbody>
            </table>
        </figure>
    );
}
