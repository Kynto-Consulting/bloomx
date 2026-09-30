/** Formateadores puros de la consola (sin React): faciles de testear y compartidos por todas las secciones. */

export function formatNumber(value: number | null | undefined, locale = 'es'): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    return new Intl.NumberFormat(locale).format(value);
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number | null | undefined, locale = 'es'): string {
    if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—';
    let v = bytes;
    let i = 0;
    while (v >= 1024 && i < UNITS.length - 1) {
        v /= 1024;
        i++;
    }
    const digits = i === 0 || v >= 100 ? 0 : v >= 10 ? 1 : 2;
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(v)} ${UNITS[i]}`;
}

export function formatDateTime(iso: string | Date | null | undefined, locale = 'es'): string {
    if (!iso) return '—';
    const d = iso instanceof Date ? iso : new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export function formatDate(iso: string | Date | null | undefined, locale = 'es'): string {
    if (!iso) return '—';
    const d = iso instanceof Date ? iso : new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d);
}

type T = (key: string, params?: Record<string, string | number>) => string;

/** "hace 5 min" usando las claves admin.console.common.time.* */
export function formatRelative(iso: string | null | undefined, t: T, now: number = Date.now()): string {
    if (!iso) return '—';
    const ms = now - new Date(iso).getTime();
    if (!Number.isFinite(ms)) return '—';
    const min = Math.floor(ms / 60_000);
    if (min < 1) return t('admin.console.common.time.justNow');
    if (min < 60) return t('admin.console.common.time.minutes', { count: min });
    const h = Math.floor(min / 60);
    if (h < 24) return t('admin.console.common.time.hours', { count: h });
    return t('admin.console.common.time.days', { count: Math.floor(h / 24) });
}

/** Iniciales para avatares (maximo 2 letras). */
export function initials(name: string | null | undefined, email?: string | null): string {
    const base = (name || '').trim() || (email || '').trim();
    if (!base) return '?';
    const parts = base.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
    return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[1][0] : '')).toUpperCase() || '?';
}
