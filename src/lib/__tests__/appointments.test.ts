import { describe, it, expect } from 'vitest';
import { signCancelToken, verifyCancelToken } from '../appointments/cancel-token';
import {
    addDaysToKey,
    computeDaySlots,
    computeWeekSlots,
    hasConflict,
    isBookableSlot,
    isValidDateKey,
    localDateKey,
    zonedTimeToUtc,
} from '../appointments/slots';

const SECRET = 'test-secret';
const H = 60 * 60 * 1000;

describe('token firmado de cancelacion', () => {
    const start = Date.UTC(2030, 0, 10, 15, 0, 0);
    const token = signCancelToken('ckabc123def456', start, SECRET);

    it('firma y verifica', () => {
        const r = verifyCancelToken(token, SECRET, start - H);
        expect(r).toEqual({ ok: true, bookingId: 'ckabc123def456', expiresAtMs: start });
    });

    it('rechaza firma alterada, id alterado y secreto distinto', () => {
        const [id, exp, sig] = token.split('.');
        expect(verifyCancelToken(`${id}.${exp}.${sig.slice(0, -2)}xx`, SECRET, start - H)).toEqual({ ok: false, reason: 'bad_signature' });
        expect(verifyCancelToken(`otroid12345.${exp}.${sig}`, SECRET, start - H)).toEqual({ ok: false, reason: 'bad_signature' });
        expect(verifyCancelToken(token, 'otro-secreto', start - H)).toEqual({ ok: false, reason: 'bad_signature' });
    });

    it('no permite alargar la expiracion', () => {
        const [id, , sig] = token.split('.');
        const later = Math.floor(start / 1000) + 86400;
        expect(verifyCancelToken(`${id}.${later}.${sig}`, SECRET, start - H)).toEqual({ ok: false, reason: 'bad_signature' });
    });

    it('expira al empezar la cita', () => {
        expect(verifyCancelToken(token, SECRET, start + 1000)).toEqual({ ok: false, reason: 'expired' });
    });

    it('rechaza formatos invalidos', () => {
        for (const bad of ['', 'abc', 'a.b', 'a.b.c.d', null, undefined, 42, `${'x'.repeat(400)}`]) {
            expect(verifyCancelToken(bad as any, SECRET, 0)).toMatchObject({ ok: false });
        }
    });
});

describe('fechas y zonas horarias', () => {
    it('isValidDateKey / addDaysToKey', () => {
        expect(isValidDateKey('2026-02-28')).toBe(true);
        expect(isValidDateKey('2026-02-30')).toBe(false);
        expect(isValidDateKey('xxxx-01-01')).toBe(false);
        expect(isValidDateKey(undefined)).toBe(false);
        expect(addDaysToKey('2026-12-30', 3)).toBe('2027-01-02');
    });

    it('zonedTimeToUtc respeta el desfase de la zona (Lima UTC-5 sin DST)', () => {
        expect(zonedTimeToUtc('2026-10-05', '09:00', 'America/Lima').toISOString()).toBe('2026-10-05T14:00:00.000Z');
    });

    it('zonedTimeToUtc es correcto en dias de cambio de horario (Nueva York)', () => {
        // 2026-03-08: adelanto a las 02:00. 09:00 ya es EDT (UTC-4).
        expect(zonedTimeToUtc('2026-03-08', '09:00', 'America/New_York').toISOString()).toBe('2026-03-08T13:00:00.000Z');
        // Dia anterior sigue en EST (UTC-5).
        expect(zonedTimeToUtc('2026-03-07', '09:00', 'America/New_York').toISOString()).toBe('2026-03-07T14:00:00.000Z');
        // 2026-11-01: atraso a las 02:00. 09:00 es EST (UTC-5).
        expect(zonedTimeToUtc('2026-11-01', '09:00', 'America/New_York').toISOString()).toBe('2026-11-01T14:00:00.000Z');
    });

    it('localDateKey usa la fecha local de la zona', () => {
        expect(localDateKey(new Date('2026-10-05T03:00:00Z'), 'America/Lima')).toBe('2026-10-04');
    });
});

describe('huecos disponibles', () => {
    const availability = [{ dayOfWeek: 1, startTime: '09:00', endTime: '11:00', isEnabled: true }]; // lunes
    const now = new Date('2026-10-01T00:00:00Z');
    const base = { tz: 'America/Lima', availability, durationMin: 30, now };

    it('genera huecos alineados a la duracion dentro de la disponibilidad', () => {
        const slots = computeDaySlots({ ...base, dayKey: '2026-10-05' }); // lunes
        expect(slots).toEqual([
            '2026-10-05T14:00:00.000Z', '2026-10-05T14:30:00.000Z', '2026-10-05T15:00:00.000Z', '2026-10-05T15:30:00.000Z',
        ]);
    });

    it('excluye ocupados pero deja los contiguos', () => {
        const busy = [{ start: new Date('2026-10-05T14:30:00Z'), end: new Date('2026-10-05T15:00:00Z') }];
        const slots = computeDaySlots({ ...base, dayKey: '2026-10-05', busy });
        expect(slots).not.toContain('2026-10-05T14:30:00.000Z');
        expect(slots).toContain('2026-10-05T14:00:00.000Z');
        expect(slots).toContain('2026-10-05T15:00:00.000Z');
    });

    it('no ofrece huecos pasados y los dias sin disponibilidad quedan fuera de la semana', () => {
        const past = computeDaySlots({ ...base, dayKey: '2026-10-05', now: new Date('2026-10-05T15:10:00Z') });
        expect(past).toEqual(['2026-10-05T15:00:00.000Z', '2026-10-05T15:30:00.000Z']);
        const week = computeWeekSlots({ ...base, startKey: '2026-10-05' });
        expect(Object.keys(week)).toEqual(['2026-10-05']);
    });

    it('duraciones invalidas no generan huecos ni bucles', () => {
        expect(computeDaySlots({ ...base, dayKey: '2026-10-05', durationMin: 0 })).toEqual([]);
        expect(computeDaySlots({ ...base, dayKey: '2026-10-05', durationMin: NaN })).toEqual([]);
    });
});

describe('proteccion de doble reserva', () => {
    const b = (s: string, e: string) => ({ start: new Date(s), end: new Date(e) });

    it('hasConflict detecta solapes parciales, contenidos e identicos; contiguo no es conflicto', () => {
        const busy = [b('2026-10-05T14:00:00Z', '2026-10-05T14:30:00Z')];
        expect(hasConflict(busy, new Date('2026-10-05T14:00:00Z'), new Date('2026-10-05T14:30:00Z'))).toBe(true);
        expect(hasConflict(busy, new Date('2026-10-05T14:15:00Z'), new Date('2026-10-05T14:45:00Z'))).toBe(true);
        expect(hasConflict(busy, new Date('2026-10-05T13:45:00Z'), new Date('2026-10-05T14:15:00Z'))).toBe(true);
        expect(hasConflict(busy, new Date('2026-10-05T14:30:00Z'), new Date('2026-10-05T15:00:00Z'))).toBe(false);
        expect(hasConflict(busy, new Date('2026-10-05T13:30:00Z'), new Date('2026-10-05T14:00:00Z'))).toBe(false);
    });

    it('dos reservas del mismo hueco: solo la primera se acepta al re-comprobar bajo el candado', () => {
        // Simula lo que hace la transaccion (candado por anfitrion + re-comprobacion + insercion).
        const bookings: Array<{ start: Date; end: Date }> = [];
        const tryBook = (iso: string) => {
            const start = new Date(iso);
            const end = new Date(start.getTime() + 30 * 60_000);
            if (hasConflict(bookings, start, end)) return 'conflict' as const;
            bookings.push({ start, end });
            return 'ok' as const;
        };
        expect([tryBook('2026-10-05T14:00:00.000Z'), tryBook('2026-10-05T14:00:00.000Z'), tryBook('2026-10-05T14:30:00.000Z')])
            .toEqual(['ok', 'conflict', 'ok']);
    });

    it('isBookableSlot rechaza horas no alineadas, fuera de disponibilidad, pasadas o muy lejanas', () => {
        const opts = {
            tz: 'America/Lima',
            availability: [{ dayOfWeek: 1, startTime: '09:00', endTime: '11:00', isEnabled: true }],
            durationMin: 30,
            now: new Date('2026-10-01T00:00:00Z'),
        };
        expect(isBookableSlot(new Date('2026-10-05T14:00:00.000Z'), opts)).toBe(true);
        expect(isBookableSlot(new Date('2026-10-05T14:10:00.000Z'), opts)).toBe(false); // no alineado
        expect(isBookableSlot(new Date('2026-10-05T16:00:00.000Z'), opts)).toBe(false); // fuera de horario
        expect(isBookableSlot(new Date('2026-10-06T14:00:00.000Z'), opts)).toBe(false); // martes sin disponibilidad
        expect(isBookableSlot(new Date('2026-09-28T14:00:00.000Z'), opts)).toBe(false); // pasado
        expect(isBookableSlot(new Date('2030-10-07T14:00:00.000Z'), opts)).toBe(false); // mas alla del horizonte
        expect(isBookableSlot(new Date('nope'), opts)).toBe(false);
    });
});
