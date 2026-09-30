import { describe, it, expect } from 'vitest';
import {
    ConnectionLimiter,
    DEFAULT_POLL_BACKOFF,
    formatSseEvent,
    nextPollDelay,
    parseResumeCursor,
    reconnectDelay,
} from '../realtime';

describe('nextPollDelay (backoff del sondeo)', () => {
    it('crece sin actividad hasta el techo y vuelve al minimo con cambios', () => {
        let delay = DEFAULT_POLL_BACKOFF.minMs;
        const seen: number[] = [];
        for (let i = 0; i < 12; i++) {
            delay = nextPollDelay(delay, false);
            seen.push(delay);
        }
        expect(seen[0]).toBeGreaterThan(DEFAULT_POLL_BACKOFF.minMs);
        expect(Math.max(...seen)).toBe(DEFAULT_POLL_BACKOFF.maxMs);
        expect(seen.every((d, i) => i === 0 || d >= seen[i - 1])).toBe(true);
        expect(nextPollDelay(delay, true)).toBe(DEFAULT_POLL_BACKOFF.minMs);
    });
});

describe('reconnectDelay', () => {
    it('es exponencial con tope', () => {
        expect(reconnectDelay(0)).toBe(1000);
        expect(reconnectDelay(1)).toBe(2000);
        expect(reconnectDelay(3)).toBe(8000);
        expect(reconnectDelay(30)).toBe(60000);
    });
    it('aplica jitter entre 50% y 100%', () => {
        expect(reconnectDelay(2, { jitter: 1 })).toBe(2000);
        expect(reconnectDelay(2, { jitter: 0 })).toBe(4000);
    });
});

describe('ConnectionLimiter', () => {
    it('limita conexiones por usuario y libera al cerrar', () => {
        const limiter = new ConnectionLimiter(2);
        expect(limiter.tryAcquire('u1')).toBe(true);
        expect(limiter.tryAcquire('u1')).toBe(true);
        expect(limiter.tryAcquire('u1')).toBe(false);
        expect(limiter.tryAcquire('u2')).toBe(true);
        limiter.release('u1');
        expect(limiter.tryAcquire('u1')).toBe(true);
        limiter.release('u1');
        limiter.release('u1');
        limiter.release('u1'); // exceso de release no debe volverse negativo
        expect(limiter.count('u1')).toBe(0);
    });
});

describe('parseResumeCursor', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    it('acepta ISO valido', () => {
        expect(parseResumeCursor('2025-12-31T23:59:59.500Z', now)?.toISOString()).toBe('2025-12-31T23:59:59.500Z');
    });
    it('rechaza basura y fechas futuras', () => {
        expect(parseResumeCursor('abc', now)).toBeNull();
        expect(parseResumeCursor('', now)).toBeNull();
        expect(parseResumeCursor(null, now)).toBeNull();
        expect(parseResumeCursor('2030-01-01T00:00:00.000Z', now)).toBeNull();
    });
});

describe('formatSseEvent', () => {
    it('serializa id/data y evita inyeccion de saltos de linea', () => {
        const out = formatSseEvent({ id: 'a\nb', data: { type: 'X' }, retry: 5000 });
        expect(out).toBe('retry: 5000\nid: ab\ndata: {"type":"X"}\n\n');
    });
});
