'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DateTimePickerProps {
    value: string;           // YYYY-MM-DDTHH:mm  or ''
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    minDate?: string;        // YYYY-MM-DD
    dateOnly?: boolean;
}

const MONTHS = ['January','February','March','April','May','June',
    'July','August','September','October','November','December'];
const DAYS_SHORT = ['Su','Mo','Tu','We','Th','Fr','Sa'];

const pad = (n: number) => String(n).padStart(2, '0');

function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseValue(v: string): { date: string; time: string } {
    if (!v) return { date: '', time: '' };
    const [date = '', rest = ''] = v.split('T');
    return { date, time: rest.slice(0, 5) };
}

function formatDisplay(v: string, dateOnly?: boolean): string {
    if (!v) return '';
    const d = new Date(v.includes('T') ? v : `${v}T00:00`);
    if (isNaN(d.getTime())) return v;
    return dateOnly
        ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
        : d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// 15-min quick picks
function buildTimes(): string[] {
    const out: string[] = [];
    for (let h = 0; h < 24; h++)
        for (let m = 0; m < 60; m += 15)
            out.push(`${pad(h)}:${pad(m)}`);
    return out;
}
const QUICK_TIMES = buildTimes();

export function DateTimePicker({
    value, onChange, placeholder, disabled, className, minDate, dateOnly,
}: DateTimePickerProps) {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const timeListRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; width: number }>({ left: 0, width: 380 });
    const [timeInput, setTimeInput] = useState('');

    useEffect(() => { setMounted(true); }, []);

    const { date: selDate, time: selTime } = parseValue(value);

    const baseDate = selDate ? new Date(`${selDate}T00:00`) : new Date();
    const [calYear, setCalYear] = useState(baseDate.getFullYear());
    const [calMonth, setCalMonth] = useState(baseDate.getMonth());

    useEffect(() => {
        if (selDate) {
            const d = new Date(`${selDate}T00:00`);
            setCalYear(d.getFullYear());
            setCalMonth(d.getMonth());
        }
    }, [selDate]);

    // Sync timeInput with current selection
    useEffect(() => {
        setTimeInput(selTime || '');
    }, [selTime]);

    // Scroll time list to selected slot
    useEffect(() => {
        if (!open || !selTime || !timeListRef.current) return;
        const idx = QUICK_TIMES.indexOf(selTime);
        if (idx >= 0) timeListRef.current.scrollTop = Math.max(0, idx * 32 - 80);
    }, [open, selTime]);

    const calcPosition = useCallback(() => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const w = Math.min(dateOnly ? 260 : 400, vw - 16);
        let left = rect.left;
        if (left + w > vw - 8) left = vw - w - 8;
        if (left < 8) left = 8;
        const dropH = 300;
        if (rect.bottom + dropH > vh - 8) {
            setPos({ bottom: vh - rect.top + 4, left, width: w });
        } else {
            setPos({ top: rect.bottom + 4, left, width: w });
        }
    }, [dateOnly]);

    const openPicker = useCallback(() => {
        calcPosition();
        setOpen(true);
    }, [calcPosition]);

    // Close on outside click / scroll / resize
    useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent) => {
            if (
                dropdownRef.current?.contains(e.target as Node) ||
                triggerRef.current?.contains(e.target as Node)
            ) return;
            setOpen(false);
        };
        const reposition = () => calcPosition();
        document.addEventListener('mousedown', close);
        window.addEventListener('scroll', reposition, true);
        window.addEventListener('resize', reposition);
        return () => {
            document.removeEventListener('mousedown', close);
            window.removeEventListener('scroll', reposition, true);
            window.removeEventListener('resize', reposition);
        };
    }, [open, calcPosition]);

    const prevMonth = () => setCalMonth(m => { if (m === 0) { setCalYear(y => y - 1); return 11; } return m - 1; });
    const nextMonth = () => setCalMonth(m => { if (m === 11) { setCalYear(y => y + 1); return 0; } return m + 1; });

    const handleDayClick = (day: Date) => {
        const key = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
        if (dateOnly) { onChange(key); setOpen(false); return; }
        const time = selTime || '09:00';
        onChange(`${key}T${time}`);
    };

    const applyTime = (time: string) => {
        const today = new Date();
        const key = selDate || `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
        onChange(`${key}T${time}`);
        setOpen(false);
    };

    const handleTimeInput = (raw: string) => {
        setTimeInput(raw);
        if (/^\d{1,2}:\d{2}$/.test(raw)) {
            const [hh, mm] = raw.split(':').map(Number);
            if (hh >= 0 && hh < 24 && mm >= 0 && mm < 60) {
                applyTime(`${pad(hh)}:${pad(mm)}`);
            }
        }
    };

    // Calendar grid
    const firstDow = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(calYear, calMonth, d));

    const tday = todayKey();

    const dropdown = open && mounted ? createPortal(
        <div
            ref={dropdownRef}
            style={{
                position: 'fixed',
                top: pos.top,
                bottom: pos.bottom,
                left: pos.left,
                width: pos.width,
                zIndex: 9999,
            }}
            className="bg-background border border-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 origin-top"
            onMouseDown={e => e.stopPropagation()}
        >
            <div className="flex select-none">
                {/* Calendar */}
                <div className={cn('flex-1 p-3', !dateOnly && 'border-r border-border')}>
                    <div className="flex items-center justify-between mb-2">
                        <button type="button" onClick={prevMonth} className="p-1 rounded hover:bg-accent transition-colors">
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                        <span className="text-sm font-semibold">{MONTHS[calMonth]} {calYear}</span>
                        <button type="button" onClick={nextMonth} className="p-1 rounded hover:bg-accent transition-colors">
                            <ChevronRight className="h-4 w-4" />
                        </button>
                    </div>
                    <div className="grid grid-cols-7 mb-1">
                        {DAYS_SHORT.map(d => (
                            <div key={d} className="text-center text-[10px] font-medium text-muted-foreground py-1">{d}</div>
                        ))}
                    </div>
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
                                        isSelected ? 'bg-blue-600 text-white' :
                                        isToday ? 'text-blue-600 font-bold hover:bg-accent' :
                                        'hover:bg-accent',
                                        isPast && 'opacity-30 pointer-events-none',
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
                    <div className="w-[100px] flex flex-col">
                        <div className="flex items-center justify-center gap-1 py-2 px-2 border-b border-border">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            <span className="text-[11px] font-medium text-muted-foreground">Time</span>
                        </div>
                        {/* Manual time input */}
                        <div className="px-2 py-1.5 border-b border-border">
                            <input
                                type="text"
                                value={timeInput}
                                onChange={e => handleTimeInput(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && /^\d{1,2}:\d{2}$/.test(timeInput)) {
                                        const [hh, mm] = timeInput.split(':').map(Number);
                                        if (hh >= 0 && hh < 24 && mm >= 0 && mm < 60) applyTime(`${pad(hh)}:${pad(mm)}`);
                                    }
                                }}
                                placeholder="HH:MM"
                                className="w-full text-xs text-center border border-border rounded px-1 py-1 bg-background focus:outline-none focus:border-blue-500"
                                maxLength={5}
                            />
                        </div>
                        {/* Quick picks */}
                        <div ref={timeListRef} className="overflow-y-auto flex-1" style={{ maxHeight: 196 }}>
                            {QUICK_TIMES.map(t => (
                                <button
                                    key={t}
                                    type="button"
                                    onClick={() => applyTime(t)}
                                    className={cn(
                                        'w-full text-center py-[7px] text-xs transition-colors',
                                        t === selTime ? 'bg-blue-600 text-white font-semibold' : 'hover:bg-accent',
                                    )}
                                >
                                    {t}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>,
        document.body,
    ) : null;

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                disabled={disabled}
                onClick={() => open ? setOpen(false) : openPicker()}
                className={cn(
                    'flex items-center gap-2 text-left text-sm px-3 py-2 rounded-lg border border-input bg-background hover:bg-accent transition-colors w-full min-h-[38px]',
                    !value && 'text-muted-foreground',
                    disabled && 'opacity-50 cursor-not-allowed',
                    className,
                )}
            >
                <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">
                    {value ? formatDisplay(value, dateOnly) : (placeholder ?? (dateOnly ? 'Select date' : 'Select date & time'))}
                </span>
            </button>
            {dropdown}
        </>
    );
}
