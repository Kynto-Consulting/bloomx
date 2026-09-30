/**
 * Formateo de fechas/relativos con locale (puro, sin React). Usa Intl, asi
 * "hace 2 h" / "2h ago" y los nombres de dias/meses salen del idioma activo.
 */

/** Nombre del dia de la semana (0 = domingo) en el locale dado. */
export function weekdayName(dayOfWeek: number, locale: string, style: 'long' | 'short' | 'narrow' = 'long'): string {
    // 7 de enero de 2024 fue domingo; UTC evita saltos por zona horaria.
    const d = new Date(Date.UTC(2024, 0, 7 + (((dayOfWeek % 7) + 7) % 7), 12));
    try {
        return new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' }).format(d);
    } catch {
        return String(dayOfWeek);
    }
}

/** Clave singular/plural: pluralKey('a.b', 1) -> 'a.bOne'; otro n -> 'a.bMany' (ambas deben existir en es y en). */
export function pluralKey(base: string, n: number): string {
    return `${base}${n === 1 ? 'One' : 'Many'}`;
}

/**
 * Las paginas publicas de reservas no muestran el texto de error del servidor (esta en un solo
 * idioma): se traduce el codigo HTTP a una clave de `book.errors.*`.
 */
export function bookingErrorKey(status: number): string {
    if (status === 429) return 'book.errors.rateLimited';
    if (status === 409) return 'book.errors.slotTaken';
    if (status === 410) return 'book.errors.expired';
    if (status === 404) return 'book.errors.notFound';
    if (status === 400) return 'book.errors.invalid';
    return 'book.errors.failed';
}

/** Nombre localizado de un pais/region a partir de su codigo ISO ("PE" -> "Peru"); cae al codigo. */
export function regionName(code: string, locale: string): string {
    try {
        return new Intl.DisplayNames([locale], { type: 'region' }).of(code.toUpperCase()) || code;
    } catch {
        return code;
    }
}

/** Hora de reloj localizada para una hora entera 0-23 ("9 AM" en en, "9:00" en es). */
export function hourLabel(hour: number, locale: string): string {
    try {
        return new Intl.DateTimeFormat(locale, { hour: 'numeric' }).format(new Date(2024, 0, 1, hour));
    } catch {
        return `${hour}:00`;
    }
}

/** Nombre de mes (0-11) en el locale dado. */
export function monthName(month: number, locale: string, style: 'long' | 'short' = 'long'): string {
    try {
        return new Intl.DateTimeFormat(locale, { month: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2024, ((month % 12) + 12) % 12, 1, 12)));
    } catch {
        return String(month + 1);
    }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Tiempo relativo corto y localizado ("hace 5 min", "ayer", "in 2 days").
 * Pasado ~7 dias devuelve la fecha absoluta (con anio si no es el actual).
 */
export function formatRelativeTime(date: Date | string | number, locale: string, now: Date | number = Date.now()): string {
    const ts = date instanceof Date ? date.getTime() : new Date(date).getTime();
    const nowTs = now instanceof Date ? now.getTime() : now;
    if (!Number.isFinite(ts)) return '';
    const diff = ts - nowTs; // negativo = pasado
    const abs = Math.abs(diff);
    try {
        const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
        if (abs < MINUTE) return rtf.format(0, 'second');
        if (abs < HOUR) return rtf.format(Math.round(diff / MINUTE), 'minute');
        if (abs < DAY) return rtf.format(Math.round(diff / HOUR), 'hour');
        if (abs < 7 * DAY) return rtf.format(Math.round(diff / DAY), 'day');
        const sameYear = new Date(ts).getFullYear() === new Date(nowTs).getFullYear();
        return new Intl.DateTimeFormat(locale, sameYear
            ? { month: 'short', day: 'numeric' }
            : { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(ts));
    } catch {
        return new Date(ts).toISOString().slice(0, 10);
    }
}

/**
 * Fecha para una lista de correo: hoy -> hora; este anio -> "12 sep"; otro anio -> con anio.
 */
export function formatMailDate(date: Date | string | number, locale: string, now: Date | number = Date.now()): string {
    const d = new Date(date);
    if (!Number.isFinite(d.getTime())) return '';
    const n = new Date(now);
    try {
        if (d.toDateString() === n.toDateString()) {
            return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(d);
        }
        if (d.getFullYear() === n.getFullYear()) {
            return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(d);
        }
        return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(d);
    } catch {
        return d.toISOString().slice(0, 10);
    }
}
