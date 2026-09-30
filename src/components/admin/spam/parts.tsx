'use client';

import * as React from 'react';
import { Switch } from '@/components/admin/console';

/** Fila "texto + interruptor" accesible (el interruptor lleva el nombre; la descripcion se enlaza con aria-describedby). */
export function SwitchRow({
    id, label, hint, checked, onChange, disabled,
}: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
    return (
        <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 p-3">
            <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{label}</p>
                {hint && <p id={`${id}-hint`} className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
            </div>
            <Switch id={id} checked={checked} onChange={onChange} label={label} disabled={disabled} />
        </div>
    );
}

/** Convierte "12" en 12; cualquier otra cosa (vacio, decimales donde no toca) en NaN. */
export function parseIntStrict(s: string): number {
    return /^\d{1,6}$/.test(s.trim()) ? Number(s.trim()) : Number.NaN;
}

export function parseDecimal(s: string): number {
    return /^\d{1,2}([.,]\d{1,3})?$/.test(s.trim()) ? Number(s.trim().replace(',', '.')) : Number.NaN;
}

/** YYYY-MM-DD -> ISO del inicio (o fin) de ese dia en la zona del navegador. */
export function dayBoundIso(day: string, end: boolean): string | undefined {
    if (!day) return undefined;
    const d = new Date(`${day}T${end ? '23:59:59.999' : '00:00:00.000'}`);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
