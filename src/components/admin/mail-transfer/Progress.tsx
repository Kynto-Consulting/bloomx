'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/** Barra de progreso accesible (role="progressbar"). `value` 0..100, o indeterminada si es null. */
export function ProgressBar({ value, label, className }: { value: number | null; label: string; className?: string }) {
    const pct = value === null ? null : Math.max(0, Math.min(100, Math.round(value)));
    return (
        <div
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct ?? undefined}
            aria-valuetext={pct === null ? undefined : `${pct} %`}
            className={cn('h-2.5 w-full overflow-hidden rounded-full bg-muted', className)}
        >
            <div
                className={cn('h-full rounded-full bg-primary transition-[width] duration-300', pct === null && 'w-1/3 animate-pulse')}
                style={pct === null ? undefined : { width: `${pct}%` }}
            />
        </div>
    );
}
