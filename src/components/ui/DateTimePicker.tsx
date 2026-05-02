'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { Popover } from './Popover';
import { cn } from '@/lib/utils';

export interface DateTimePickerProps {
    value: string; // YYYY-MM-DDTHH:mm  or ''
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    /** Earliest selectable date as YYYY-MM-DD */
    minDate?: string;
    /** Show only date (no time picker) */
    dateOnly?: boolean;
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_SHORT = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function pad(n: number) { return String(n).padStart(2, '0'); }

function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseValue(value: string): { date: string; time: string } {
    if (!value) return { date: '', time: '' };
    const [date = '', rest = ''] = value.split('T');
    return { date, time: rest.slice(0, 5) };
}

function formatDisplay(value: string, dateOnly?: boolean): string {
    if (!value) return '';
    // datetime-local values are local — construct as local Date
    const d = dateOnly ? new Date(`${value}T00:00`) : new Date(value.includes('T') ? value : `${value}T00:00`);
    if (isNaN(d.getTime())) return value;
    if (dateOnly) return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function buildTimes(): string[] {
    const out: string[] = [];
    for (let h = 0; h < 24; h++)
        for (let m = 0; m < 60; m += 15)
            out.push(`${pad(h)}:${pad(m)}`);
    return out;
}
const ALL_TIMES = buildTimes();

export function DateTimePicker({ value, onChange, placeholder, disabled, className, minDate, dateOnly }: DateTimePickerProps) {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const timeListRef = useRef<HTMLDivElement>(null);

    const { date: selDate, time: selTime } = parseValue(value);

    const baseDate = selDate ? new Date(`${selDate}T00:00`) : new Date();
    const [calYear, setCalYear] = useState(baseDate.getFullYear());
    const [calMonth, setCalMonth] = useState(baseDate.getMonth());

    // Sync calendar view when value changes externally
    useEffect(() => {
        if (selDate) {
            const d = new Date(`${selDate}T00:00`);
            setCalYear(d.getFullYear());
            setCalMonth(d.getMonth());
        }
    }, [selDate]);

    // Scroll time list to the selected slot when popover opens
    useEffect(() => {
        if (!open || !selTime || !timeListRef.current) return;
        const idx = ALL_TIMES.indexOf(selTime);
        if (idx >= 0) {
            timeListRef.current.scrollTop = Math.max(0, idx * 32 - 80);
        }
    }, [open, selTime]);

    const prevMonth = useCallback(() => {
        setCalMonth(m => { if (m === 0) { setCalYear(y => y - 1); return 11; } return m - 1; });
    }, []);
    const nextMonth = useCallback(() => {
        setCalMonth(m => { if (m === 11) { setCalYear(y => y + 1); return 0; } return m + 1; });
    }, []);

    const handleDayClick = useCallback((day: Date) => {
        const dateKey = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
        if (dateOnly) {
            onChange(dateKey);
            setOpen(false);
            return;
        }
        const time = selTime || '09:00';
        onChange(`${dateKey}T${time}`);
        // Don't close — let user pick time
    }, [dateOnly, selTime, onChange]);

    const handleTimeClick = useCallback((time: string) => {
        const today = new Date();
        const dateKey = selDate || `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
        onChange(`${dateKey}T${time}`);
        setOpen(false);
    }, [selDate, onChange]);

    // Calendar grid
    const firstDow = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(calYear, calMonth, d));

    const tday = todayStr();

    const displayText = value ? formatDisplay(value, dateOnly) : (placeholder ?? (dateOnly ? 'Select date' : 'Select date & time'));

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                disabled={disabled}
                onClick={() => setOpen(o => !o)}
                className={cn(
                    'flex items-center gap-2 text-left text-sm px-3 py-2 rounded-lg border border-input bg-background hover:bg-accent transition-colors w-full min-h-[38px]',
                    !value && 'text-muted-foreground',
                    disabled && 'opacity-50 cursor-not-allowed',
                    className,
                )}
            >
                <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{displayText}</span>
            </button>

            <Popover
                trigger={triggerRef}
                isOpen={open}
                onClose={() => setOpen(false)}
                width={dateOnly ? 260 : 380}
                header={false}
            >
                <div className="flex select-none">
                    {/* Month calendar */}
                    <div className={cn('flex-1 p-3', !dateOnly && 'border-r border-border')}>
                        {/* Header */}
                        <div className="flex items-center justify-between mb-2">
                            <button type="button" onClick={prevMonth} className="p-1 rounded hover:bg-accent transition-colors">
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <span className="text-sm font-semibold">{MONTHS[calMonth]} {calYear}</span>
                            <button type="button" onClick={nextMonth} className="p-1 rounded hover:bg-accent transition-colors">
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>

                        {/* Day headers */}
                        <div className="grid grid-cols-7 mb-1">
                            {DAYS_SHORT.map(d => (
                                <div key={d} className="text-center text-[10px] font-medium text-muted-foreground py-1">{d}</div>
                            ))}
                        </div>

                        {/* Day cells */}
                        <div className="grid grid-cols-7 gap-y-0.5">
                            {cells.map((date, i) => {
                                if (!date) return <div key={`e${i}`} />;
                                const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
                                const isPast = minDate ? key < minDate : false;
                                const isSelected = key === selDate;
                                const isToday = key === tday;
                                return (
                                    <button
                                        key={key}
                                        type="button"
                                        disabled={isPast}
                                        onClick={() => handleDayClick(date)}
                                        className={cn(
                                            'flex items-center justify-center w-full aspect-square rounded-full text-xs font-medium transition-colors',
                                            isSelected
                                                ? 'bg-blue-600 text-white'
                                                : isToday
                                                    ? 'text-blue-600 font-bold hover:bg-accent'
                                                    : 'hover:bg-accent',
                                            isPast && 'opacity-30 cursor-not-allowed pointer-events-none',
                                        )}
                                    >
                                        {date.getDate()}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Time column */}
                    {!dateOnly && (
                        <div className="w-[88px] flex flex-col">
                            <div className="flex items-center justify-center gap-1 py-2 border-b border-border">
                                <Clock className="h-3 w-3 text-muted-foreground" />
                                <span className="text-[11px] font-medium text-muted-foreground">Time</span>
                            </div>
                            <div ref={timeListRef} className="overflow-y-auto flex-1" style={{ maxHeight: 232 }}>
                                {ALL_TIMES.map(t => (
                                    <button
                                        key={t}
                                        type="button"
                                        onClick={() => handleTimeClick(t)}
                                        className={cn(
                                            'w-full text-center py-[7px] text-xs transition-colors',
                                            t === selTime
                                                ? 'bg-blue-600 text-white font-semibold'
                                                : 'hover:bg-accent',
                                        )}
                                    >
                                        {t}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </Popover>
        </>
    );
}
