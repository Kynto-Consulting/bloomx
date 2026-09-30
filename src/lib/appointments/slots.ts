/**
 * Calculo de huecos de citas (puro, sin BD). Lo usan la ruta publica de huecos y la de reserva,
 * de modo que "lo que se ofrece" y "lo que se acepta reservar" salgan de la misma logica.
 */

export type AvailabilityRule = { dayOfWeek: number; startTime: string; endTime: string; isEnabled?: boolean };
export type BusyRange = { start: Date; end: Date };

const MS_MIN = 60_000;
const MS_DAY = 24 * 60 * MS_MIN;

export function isValidTimeZone(tz: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

/** true si `value` es YYYY-MM-DD y una fecha de calendario real. */
export function isValidDateKey(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Suma dias de calendario a una clave YYYY-MM-DD (aritmetica de calendario, no de instantes). */
export function addDaysToKey(key: string, days: number): string {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Desfase (ms) de `tz` respecto de UTC en el instante `utcMs`: hora local interpretada como UTC menos el instante. */
function tzOffsetMs(utcMs: number, tz: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(utcMs));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || '0');
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return asUtc - Math.floor(utcMs / 1000) * 1000;
}

export function parseHHMM(time: string): { h: number; m: number } | null {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim());
    if (!match) return null;
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (h > 24 || m > 59 || (h === 24 && m !== 0)) return null;
    return { h, m };
}

/**
 * Instante UTC de la hora de pared `dayKey` + `hhmm` en la zona `tz`. Correcto en cambios de horario (DST):
 * se recalcula el desfase en el instante resultante en vez de asumir el del instante inicial.
 */
export function zonedTimeToUtc(dayKey: string, hhmm: string, tz: string): Date {
    const [y, mo, d] = dayKey.split('-').map(Number);
    const t = parseHHMM(hhmm) ?? { h: 0, m: 0 };
    const guess = Date.UTC(y, mo - 1, d, t.h, t.m, 0);
    const off1 = tzOffsetMs(guess, tz);
    let result = guess - off1;
    const off2 = tzOffsetMs(result, tz);
    if (off2 !== off1) result = guess - off2;
    return new Date(result);
}

/** Clave de fecha local (YYYY-MM-DD) de un instante en `tz`. */
export function localDateKey(date: Date, tz: string): string {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Dia de la semana (0=domingo) de una fecha de calendario; no depende de la zona. */
export function dayOfWeekOfKey(key: string): number {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function slotsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
    return aStart < bEnd && aEnd > bStart;
}

/** true si [start, end) se solapa con algun rango ocupado. Contiguo (fin == inicio) no es conflicto. */
export function hasConflict(busy: BusyRange[], start: Date, end: Date): boolean {
    return busy.some((b) => slotsOverlap(start, end, b.start, b.end));
}

export type DaySlotsInput = {
    dayKey: string;
    tz: string;
    availability: AvailabilityRule[];
    durationMin: number;
    busy?: BusyRange[];
    now?: Date;
    /** Margen que se tolera para huecos que ya empezaron (por defecto 15 min, como antes). */
    graceMs?: number;
};

/** Huecos (ISO UTC, ordenados, sin duplicados) de un dia de calendario en la zona de la agenda. */
export function computeDaySlots(input: DaySlotsInput): string[] {
    const { dayKey, tz, availability, durationMin, busy = [], now = new Date(), graceMs = 15 * MS_MIN } = input;
    if (!Number.isFinite(durationMin) || durationMin < 1) return [];

    const dow = dayOfWeekOfKey(dayKey);
    const rules = availability.filter((a) => a.dayOfWeek === dow && a.isEnabled !== false);
    const out = new Set<string>();

    for (const rule of rules) {
        const rangeStart = zonedTimeToUtc(dayKey, rule.startTime, tz);
        const rangeEnd = zonedTimeToUtc(dayKey, rule.endTime, tz);
        let cursor = rangeStart.getTime();
        // Tope de iteraciones: protege de rangos absurdos con duraciones diminutas.
        for (let i = 0; i < 1000 && cursor < rangeEnd.getTime(); i++) {
            const slotEnd = cursor + durationMin * MS_MIN;
            if (slotEnd > rangeEnd.getTime()) break;
            if (cursor > now.getTime() - graceMs && !hasConflict(busy, new Date(cursor), new Date(slotEnd))) {
                out.add(new Date(cursor).toISOString());
            }
            cursor = slotEnd;
        }
    }
    return [...out].sort();
}

/** Ventana UTC [inicio, fin) que cubre `days` dias de calendario desde `startKey` en `tz`. */
export function weekWindow(startKey: string, days: number, tz: string): { from: Date; to: Date } {
    return { from: zonedTimeToUtc(startKey, '00:00', tz), to: zonedTimeToUtc(addDaysToKey(startKey, days), '00:00', tz) };
}

export function computeWeekSlots(input: Omit<DaySlotsInput, 'dayKey'> & { startKey: string; days?: number }): Record<string, string[]> {
    const { startKey, days = 7, ...rest } = input;
    const result: Record<string, string[]> = {};
    for (let i = 0; i < days; i++) {
        const dayKey = addDaysToKey(startKey, i);
        if (!rest.availability.some((a) => a.dayOfWeek === dayOfWeekOfKey(dayKey) && a.isEnabled !== false)) continue;
        result[dayKey] = computeDaySlots({ ...rest, dayKey });
    }
    return result;
}

export const MAX_BOOKING_HORIZON_DAYS = 365;

/**
 * Valida que `startsAt` sea un hueco real de la agenda: futuro (con la misma tolerancia que se ofrece),
 * dentro del horizonte, alineado a la duracion y dentro de un rango de disponibilidad. NO mira ocupacion
 * (eso se comprueba dentro de la transaccion de reserva).
 */
export function isBookableSlot(
    startsAt: Date,
    opts: { tz: string; availability: AvailabilityRule[]; durationMin: number; now?: Date; graceMs?: number },
): boolean {
    const now = opts.now ?? new Date();
    if (Number.isNaN(startsAt.getTime())) return false;
    if (startsAt.getTime() > now.getTime() + MAX_BOOKING_HORIZON_DAYS * MS_DAY) return false;
    const dayKey = localDateKey(startsAt, opts.tz);
    const slots = computeDaySlots({
        dayKey,
        tz: opts.tz,
        availability: opts.availability,
        durationMin: opts.durationMin,
        now,
        graceMs: opts.graceMs,
    });
    return slots.includes(startsAt.toISOString());
}
