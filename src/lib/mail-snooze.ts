// Atajos de "Posponer" (Gmail-like): todos devuelven fechas FUTURAS en hora local. Puro y probable.

export type SnoozePresetId = 'laterToday' | 'tomorrow' | 'weekend' | 'nextWeek';

export interface SnoozePreset { id: SnoozePresetId; date: Date }

function at(base: Date, addDays: number, hour: number): Date {
    return new Date(base.getFullYear(), base.getMonth(), base.getDate() + addDays, hour, 0, 0, 0);
}

/**
 * - laterToday: dentro de 3 h (redondeado a la hora) si aun es el mismo dia y antes de las 18:00.
 * - tomorrow: manana 08:00.
 * - weekend: el proximo sabado 08:00 (no se ofrece en sabado/domingo).
 * - nextWeek: el proximo lunes 08:00.
 */
export function snoozePresets(now: Date = new Date()): SnoozePreset[] {
    const out: SnoozePreset[] = [];
    const later = new Date(now.getTime() + 3 * 3_600_000);
    later.setMinutes(0, 0, 0);
    if (now.getHours() < 18 && later.getDate() === now.getDate() && later.getTime() > now.getTime()) {
        out.push({ id: 'laterToday', date: later });
    }
    out.push({ id: 'tomorrow', date: at(now, 1, 8) });
    const dow = now.getDay(); // 0 domingo ... 6 sabado
    if (dow !== 0 && dow !== 6) out.push({ id: 'weekend', date: at(now, 6 - dow, 8) });
    const untilMonday = ((8 - dow) % 7) || 7;
    out.push({ id: 'nextWeek', date: at(now, untilMonday, 8) });
    return out;
}

/** Valida una fecha elegida a mano: debe ser valida y estar al menos 1 minuto en el futuro. */
export function isValidSnoozeDate(value: Date, now: Date = new Date()): boolean {
    return !Number.isNaN(value.getTime()) && value.getTime() > now.getTime() + 60_000;
}
