import { describe, expect, it } from 'vitest';
import { BADGE_MAX_CONCURRENT, createLimiter } from '../useExtensionNav';

describe('limitador de refrescos de insignias', () => {
    it('nunca supera el maximo en vuelo y encola el resto en orden', async () => {
        const limiter = createLimiter(BADGE_MAX_CONCURRENT);
        let running = 0, peak = 0;
        const order: number[] = [];
        const gates: Array<() => void> = [];
        for (let i = 0; i < 10; i++) {
            limiter.run(`k${i}`, async () => {
                running += 1; peak = Math.max(peak, running); order.push(i);
                await new Promise<void>((resolve) => gates.push(resolve));
                running -= 1;
            });
        }
        expect(limiter.stats()).toEqual({ active: 4, waiting: 6 });
        while (order.length < 10) {
            gates.splice(0).forEach((g) => g());
            await new Promise((r) => setTimeout(r, 0));
        }
        gates.splice(0).forEach((g) => g());
        await new Promise((r) => setTimeout(r, 0));
        expect(peak).toBe(4);
        expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(limiter.stats()).toEqual({ active: 0, waiting: 0 });
    });
    it('no duplica una clave ya en cola o en vuelo y sigue funcionando si una tarea falla', async () => {
        const limiter = createLimiter(1);
        let calls = 0;
        let release!: () => void;
        limiter.run('a', () => new Promise<void>((resolve) => { calls++; release = resolve; }));
        limiter.run('a', async () => { calls++; });
        expect(calls).toBe(1);
        limiter.run('b', async () => { throw new Error('boom'); });
        release();
        await new Promise((r) => setTimeout(r, 0));
        limiter.run('c', async () => { calls++; });
        await new Promise((r) => setTimeout(r, 0));
        expect(calls).toBe(2);
        expect(limiter.stats()).toEqual({ active: 0, waiting: 0 });
    });
});
