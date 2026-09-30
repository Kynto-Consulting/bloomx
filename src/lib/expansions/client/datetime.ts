/**
 * Fechas locales de los formularios de extensiones (PURO, sin React): valores "AAAA-MM-DDTHH:mm" sin zona, conversion a
 * instante UTC en una zona IANA elegida, validacion fin > inicio, avance automatico del fin y lista de zonas horarias.
 */

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;
const pad = (n: number) => String(n).padStart(2, '0');

export interface LocalParts { y: number; mo: number; d: number; h: number; mi: number }

export function parseLocal(value: unknown): LocalParts | null {
    if (typeof value !== 'string') return null;
    const m = LOCAL_RE.exec(value.trim());
    if (!m) return null;
    const parts = { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
    if (parts.mo < 1 || parts.mo > 12 || parts.d < 1 || parts.d > 31 || parts.h > 23 || parts.mi > 59) return null;
    return parts;
}

export function formatLocal(parts: LocalParts): string {
    return `${parts.y}-${pad(parts.mo)}-${pad(parts.d)}T${pad(parts.h)}:${pad(parts.mi)}`;
}

/** Suma minutos a un valor local (aritmetica de calendario, sin zona). null si el valor no es valido. */
export function addMinutesLocal(value: string, minutes: number): string | null {
    const p = parseLocal(value);
    if (!p) return null;
    const t = new Date(Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi + minutes));
    return formatLocal({ y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes() });
}

/** Desfase (ms) de la zona `timeZone` respecto a UTC en el instante `at` (positivo al este de Greenwich). */
export function zoneOffsetMs(at: number, timeZone: string): number {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const get: Record<string, number> = {};
    for (const part of fmt.formatToParts(new Date(at))) if (part.type !== 'literal') get[part.type] = Number(part.value);
    const asUtc = Date.UTC(get.year, get.month - 1, get.day, get.hour % 24, get.minute, get.second);
    return asUtc - Math.floor(at / 1000) * 1000;
}

export function isValidTimeZone(timeZone: unknown): timeZone is string {
    if (typeof timeZone !== 'string' || !timeZone) return false;
    try { new Intl.DateTimeFormat('en-US', { timeZone }); return true; } catch { return false; }
}

/** Hora de pared (AAAA-MM-DDTHH:mm) en `timeZone` -> instante real. Invalido = null. Resuelve correctamente los cambios de hora. */
export function zonedLocalToDate(value: unknown, timeZone?: string | null): Date | null {
    const p = parseLocal(value);
    if (!p) return null;
    const wall = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
    if (!timeZone || !isValidTimeZone(timeZone)) {
        const local = new Date(p.y, p.mo - 1, p.d, p.h, p.mi);
        return Number.isNaN(local.getTime()) ? null : local;
    }
    let guess = wall - zoneOffsetMs(wall, timeZone);
    guess = wall - zoneOffsetMs(guess, timeZone); // segunda pasada: el desfase puede cambiar en la frontera de DST
    const date = new Date(guess);
    return Number.isNaN(date.getTime()) ? null : date;
}

/** true si ambos faltan/son invalidos (nada que comparar) o el fin es posterior al inicio. */
export function isEndAfterStart(start: unknown, end: unknown): boolean {
    const a = parseLocal(start);
    const b = parseLocal(end);
    if (!a || !b) return true;
    return formatLocal(b) > formatLocal(a);
}

/** Nuevo fin cuando el inicio cambia: si el fin falta o ya no es posterior, inicio + `minutes`; si esta bien, null (no tocar). */
export function nextEndAfterStartChange(start: unknown, end: unknown, minutes = 60): string | null {
    const a = parseLocal(start);
    if (!a) return null;
    const b = parseLocal(end);
    if (b && formatLocal(b) > formatLocal(a)) return null;
    return addMinutesLocal(formatLocal(a), minutes);
}

export function browserTimeZone(): string {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

const FALLBACK_ZONES = ['UTC', 'America/Mexico_City', 'America/Bogota', 'America/Lima', 'America/Santiago', 'America/Argentina/Buenos_Aires', 'America/New_York', 'America/Los_Angeles', 'Europe/Madrid', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo'];

/** "GMT+2" / "UTC-05:00" legible de una zona (en `at`). */
export function zoneOffsetLabel(timeZone: string, at: number = Date.now()): string {
    try {
        const minutes = Math.round(zoneOffsetMs(at, timeZone) / 60000);
        const sign = minutes < 0 ? '-' : '+';
        const abs = Math.abs(minutes);
        return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
    } catch {
        return '';
    }
}

/** Opciones de zona horaria: primero la del navegador, luego el resto (Intl.supportedValuesOf si existe). */
export function timeZoneOptions(current?: string): Array<{ value: string; label: string }> {
    const own = current && isValidTimeZone(current) ? current : browserTimeZone();
    let all: string[] = [];
    try {
        const fn = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
        all = typeof fn === 'function' ? fn('timeZone') : [];
    } catch { all = []; }
    if (all.length === 0) all = FALLBACK_ZONES;
    const list = [own, ...all.filter((zone) => zone !== own)];
    if (!list.includes('UTC')) list.push('UTC');
    return list.map((zone) => ({ value: zone, label: `${zone.replace(/_/g, ' ')} (${zoneOffsetLabel(zone)})` }));
}
