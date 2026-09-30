import { describe, expect, it } from 'vitest';
import {
    bookingErrorKey,
    formatMailDate,
    formatRelativeTime,
    hourLabel,
    monthName,
    pluralKey,
    regionName,
    weekdayName,
} from '../i18n/format';

describe('weekdayName / monthName / hourLabel', () => {
    it('los dias salen del idioma activo (0 = domingo)', () => {
        expect(weekdayName(0, 'es', 'long')).toMatch(/^domingo$/i);
        expect(weekdayName(1, 'es', 'long')).toMatch(/^lunes$/i);
        expect(weekdayName(0, 'en', 'long')).toBe('Sunday');
        expect(weekdayName(6, 'en', 'short')).toBe('Sat');
        expect(weekdayName(7, 'en', 'long')).toBe('Sunday'); // se normaliza
    });
    it('los meses salen del idioma activo', () => {
        expect(monthName(0, 'es')).toMatch(/^enero$/i);
        expect(monthName(8, 'en')).toBe('September');
        expect(monthName(12, 'en')).toBe('January');
    });
    it('las horas usan el formato del locale', () => {
        expect(hourLabel(15, 'en')).toMatch(/3\s?PM/);
        expect(hourLabel(15, 'es')).toMatch(/15|3\s?p/i);
    });
    it('un locale invalido no lanza', () => {
        expect(() => weekdayName(1, 'xx-invalid-locale-zz')).not.toThrow();
    });
});

describe('pluralKey', () => {
    it('1 -> One, otro -> Many', () => {
        expect(pluralKey('a.b', 1)).toBe('a.bOne');
        expect(pluralKey('a.b', 0)).toBe('a.bMany');
        expect(pluralKey('a.b', 2)).toBe('a.bMany');
    });
});

describe('bookingErrorKey', () => {
    it('traduce el codigo HTTP a una clave book.errors.*', () => {
        expect(bookingErrorKey(429)).toBe('book.errors.rateLimited');
        expect(bookingErrorKey(409)).toBe('book.errors.slotTaken');
        expect(bookingErrorKey(410)).toBe('book.errors.expired');
        expect(bookingErrorKey(404)).toBe('book.errors.notFound');
        expect(bookingErrorKey(400)).toBe('book.errors.invalid');
        expect(bookingErrorKey(500)).toBe('book.errors.failed');
    });
});

describe('regionName', () => {
    it('nombre localizado del pais y respaldo al codigo', () => {
        expect(regionName('PE', 'es')).toMatch(/per/i);
        expect(regionName('US', 'en')).toBe('United States');
        expect(regionName('??', 'en')).toBeTruthy();
    });
});

describe('formatRelativeTime', () => {
    const now = new Date('2026-09-29T12:00:00Z').getTime();
    it('relativos localizados (es / en)', () => {
        expect(formatRelativeTime(now - 5 * 60_000, 'en', now)).toMatch(/5 min/);
        expect(formatRelativeTime(now - 5 * 60_000, 'es', now)).toMatch(/5 min/);
        expect(formatRelativeTime(now - 3 * 3600_000, 'en', now)).toMatch(/3 hr/);
        expect(formatRelativeTime(now - 24 * 3600_000, 'en', now)).toBe('yesterday');
        expect(formatRelativeTime(now - 24 * 3600_000, 'es', now)).toBe('ayer');
        expect(formatRelativeTime(now + 3 * 24 * 3600_000, 'en', now)).toMatch(/in 3 days/);
    });
    it('pasada una semana usa fecha absoluta localizada', () => {
        const older = now - 30 * 24 * 3600_000; // 30 ago
        expect(formatRelativeTime(older, 'en', now)).toMatch(/Aug/);
        expect(formatRelativeTime(older, 'es', now)).toMatch(/ago/i);
    });
    it('entradas invalidas devuelven cadena vacia', () => {
        expect(formatRelativeTime('no-es-fecha', 'es', now)).toBe('');
    });
});

describe('formatMailDate', () => {
    const now = new Date(2026, 8, 29, 15, 0, 0);
    it('hoy -> hora; este anio -> dia y mes; otro anio -> con anio', () => {
        expect(formatMailDate(new Date(2026, 8, 29, 9, 30), 'en', now)).toMatch(/9:30\s?AM/);
        expect(formatMailDate(new Date(2026, 2, 5, 9, 30), 'en', now)).toBe('Mar 5');
        expect(formatMailDate(new Date(2026, 2, 5, 9, 30), 'es', now)).toMatch(/5 mar/i);
        expect(formatMailDate(new Date(2024, 2, 5, 9, 30), 'en', now)).toBe('Mar 5, 2024');
    });
    it('fecha invalida -> vacio', () => {
        expect(formatMailDate('nope', 'en', now)).toBe('');
    });
});
