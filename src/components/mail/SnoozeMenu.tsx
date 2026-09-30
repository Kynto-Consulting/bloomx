'use client';

import { useMemo, useState, type RefObject } from 'react';
import { CalendarClock, CalendarDays, Clock, Sun, Sunrise } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { isValidSnoozeDate, snoozePresets, type SnoozePresetId } from '@/lib/mail-snooze';
import { MAX_SCHEDULE_DAYS, validateScheduleDate } from '@/lib/mail-scheduled';
import { ActionMenu, type MenuItemDef } from './ActionMenu';

const PRESET_ICONS = { laterToday: Clock, tomorrow: Sunrise, weekend: Sun, nextWeek: CalendarDays } as const;

interface Props {
    open: boolean;
    onClose: () => void;
    anchorRef: RefObject<HTMLElement | null>;
    onSnooze: (until: Date) => void;
    /** `reschedule`: mismo selector para cambiar la hora de un envio programado (limites del proveedor: 1 min a 30 dias). */
    variant?: 'snooze' | 'reschedule';
    /** Solo para pruebas: reloj fijo. */
    now?: Date;
}

/** Posponer: atajos (mas tarde, manana, fin de semana, proxima semana) y una fecha/hora a medida. */
export function SnoozeMenu({ open, onClose, anchorRef, onSnooze, variant = 'snooze', now }: Props) {
    const { t, intlLocale } = useI18n();
    const [custom, setCustom] = useState('');
    const [error, setError] = useState(false);

    const presets = useMemo(() => (open ? snoozePresets(now ?? new Date()) : []), [open, now]);
    const fmt = useMemo(() => new Intl.DateTimeFormat(intlLocale, { weekday: 'short', hour: 'numeric', minute: '2-digit' }), [intlLocale]);

    const items: MenuItemDef[] = presets.map((p) => {
        const Icon = PRESET_ICONS[p.id as SnoozePresetId];
        return {
            id: `snooze:${p.id}`,
            label: t(`emailList.snooze.${p.id}`),
            icon: <Icon className="h-4 w-4" />,
            hint: fmt.format(p.date),
            onSelect: () => onSnooze(p.date),
        };
    });

    const reschedule = variant === 'reschedule';
    const maxLocal = useMemo(() => {
        if (!reschedule) return undefined;
        const d = new Date((now ?? new Date()).getTime() + MAX_SCHEDULE_DAYS * 86_400_000);
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }, [reschedule, now, open]);

    const submitCustom = () => {
        const date = new Date(custom);
        const valid = reschedule
            ? custom !== '' && validateScheduleDate(date.getTime(), (now ?? new Date()).getTime()).ok
            : custom !== '' && isValidSnoozeDate(date, now ?? new Date());
        if (!valid) { setError(true); return; }
        setError(false);
        setCustom('');
        onSnooze(date);
        onClose();
    };

    return (
        <ActionMenu
            open={open}
            onClose={onClose}
            anchorRef={anchorRef}
            label={t(reschedule ? 'emailList.actions.reschedule' : 'emailList.actions.snooze')}
            heading={t(reschedule ? 'emailList.schedule.rescheduleTitle' : 'emailList.snooze.title')}
            items={items}
            width={300}
            footer={(
                <div role="none" className="mt-1 border-t border-border p-2">
                    <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground" htmlFor="bx-snooze-custom">
                        <CalendarClock className="h-4 w-4" aria-hidden="true" /> {t('emailList.snooze.custom')}
                    </label>
                    <div className="mt-1.5 flex items-center gap-2">
                        <input
                            id="bx-snooze-custom"
                            type="datetime-local"
                            max={maxLocal}
                            value={custom}
                            aria-invalid={error || undefined}
                            aria-describedby={error ? 'bx-snooze-error' : undefined}
                            onChange={(e) => { setCustom(e.target.value); setError(false); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitCustom(); } }}
                            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                        <button
                            type="button"
                            onClick={submitCustom}
                            className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            {t(reschedule ? 'emailList.schedule.set' : 'emailList.snooze.set')}
                        </button>
                    </div>
                    {error && <p id="bx-snooze-error" role="alert" className="mt-1 text-xs text-destructive">{t(reschedule ? 'emailList.schedule.invalidDate' : 'emailList.snooze.invalid')}</p>}
                </div>
            )}
        />
    );
}
