import { describe, expect, it } from 'vitest';
import {
    addMinutesLocal, isEndAfterStart, isValidTimeZone, nextEndAfterStartChange, parseLocal, timeZoneOptions, zoneOffsetLabel, zonedLocalToDate,
} from '../datetime';

describe('parseLocal', () => {
    it('accepts AAAA-MM-DDTHH:mm and rejects the rest', () => {
        expect(parseLocal('2026-03-05T09:30')).toEqual({ y: 2026, mo: 3, d: 5, h: 9, mi: 30 });
        expect(parseLocal('2026-13-05T09:30')).toBeNull();
        expect(parseLocal('2026-03-05')).toBeNull();
        expect(parseLocal(undefined)).toBeNull();
    });
});

describe('addMinutesLocal', () => {
    it('rolls over day and month boundaries', () => {
        expect(addMinutesLocal('2026-01-31T23:30', 60)).toBe('2026-02-01T00:30');
        expect(addMinutesLocal('bad', 5)).toBeNull();
    });
});

describe('zonedLocalToDate', () => {
    it('converts wall time in the chosen zone to the real instant', () => {
        expect(zonedLocalToDate('2026-07-01T10:00', 'Europe/Madrid')?.toISOString()).toBe('2026-07-01T08:00:00.000Z');
        expect(zonedLocalToDate('2026-01-15T10:00', 'America/New_York')?.toISOString()).toBe('2026-01-15T15:00:00.000Z');
        expect(zonedLocalToDate('2026-01-15T10:00', 'UTC')?.toISOString()).toBe('2026-01-15T10:00:00.000Z');
    });
    it('handles the DST transition day', () => {
        // Madrid: el 29-mar-2026 a las 02:00 el reloj salta a las 03:00 (CEST = UTC+2). 12:00 ya es verano.
        expect(zonedLocalToDate('2026-03-29T12:00', 'Europe/Madrid')?.toISOString()).toBe('2026-03-29T10:00:00.000Z');
        expect(zonedLocalToDate('2026-03-28T12:00', 'Europe/Madrid')?.toISOString()).toBe('2026-03-28T11:00:00.000Z');
    });
    it('falls back to the browser zone for unknown zones and returns null for bad input', () => {
        expect(zonedLocalToDate('2026-01-15T10:00', 'Not/AZone')).toBeInstanceOf(Date);
        expect(zonedLocalToDate('nope', 'UTC')).toBeNull();
    });
});

describe('range helpers', () => {
    it('validates end after start', () => {
        expect(isEndAfterStart('2026-01-01T10:00', '2026-01-01T11:00')).toBe(true);
        expect(isEndAfterStart('2026-01-01T10:00', '2026-01-01T10:00')).toBe(false);
        expect(isEndAfterStart('2026-01-01T10:00', '2026-01-01T09:00')).toBe(false);
        expect(isEndAfterStart('', '2026-01-01T09:00')).toBe(true);
    });
    it('advances the end only when needed', () => {
        expect(nextEndAfterStartChange('2026-01-01T10:00', '')).toBe('2026-01-01T11:00');
        expect(nextEndAfterStartChange('2026-01-01T10:00', '2026-01-01T09:00')).toBe('2026-01-01T11:00');
        expect(nextEndAfterStartChange('2026-01-01T10:00', '2026-01-01T12:00')).toBeNull();
        expect(nextEndAfterStartChange('', '2026-01-01T12:00')).toBeNull();
    });
});

describe('time zones', () => {
    it('validates zones and formats offsets', () => {
        expect(isValidTimeZone('Europe/Madrid')).toBe(true);
        expect(isValidTimeZone('Mars/Base')).toBe(false);
        expect(zoneOffsetLabel('Asia/Kolkata', Date.UTC(2026, 0, 1))).toBe('UTC+05:30');
    });
    it('puts the requested zone first and includes UTC', () => {
        const options = timeZoneOptions('Europe/Madrid');
        expect(options[0].value).toBe('Europe/Madrid');
        expect(options.some((o) => o.value === 'UTC')).toBe(true);
        expect(new Set(options.map((o) => o.value)).size).toBe(options.length);
    });
});
