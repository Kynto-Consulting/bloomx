import { describe, expect, it, vi } from 'vitest';
import { BridgeError } from '../host-services/bridge-route';
import { handleStats, statsRequest, type StatsDeps } from '../host-services/stats';
import { grantAllowsService } from '@/lib/exec-grant';

const NOW = new Date('2026-10-01T15:00:00Z');
function deps(over: Partial<StatsDeps> = {}): StatsDeps & { audit: ReturnType<typeof vi.fn> } {
    return {
        levelOf: async () => 1,
        userCounts: async () => ({ total: 10, new7d: 2, active30d: 7 }),
        mailByDay: async () => [
            { date: '2026-10-01', received: 5, sent: 2, spamBlocked: 1 },
            { date: '2026-09-29', received: 3, sent: 0, spamBlocked: 4 },
            { date: '2026-01-01', received: 99, sent: 99, spamBlocked: 99 },
        ],
        rateLimit: async () => ({ ok: true, retryAfter: 0 }),
        audit: vi.fn(),
        now: () => NOW,
        ...over,
    } as any;
}
const parse = (args?: any) => statsRequest.parse({ op: 'overview', userId: 'u1', extensionId: 'ext1', args });
const grant = { perms: ['READ_STATS'] };

describe('services.stats (puente de instancia)', () => {
    it('forma de la respuesta y relleno de ceros (exactamente `days` entradas)', async () => {
        const out = await handleStats(deps(), parse({ days: 5 }), { grant });
        expect(out.users).toEqual({ total: 10, new7d: 2, active30d: 7 });
        expect(out.mail.days.map((d) => d.date)).toEqual(['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01']);
        expect(out.mail.days[0]).toEqual({ date: '2026-09-27', received: 0, sent: 0, spamBlocked: 0 });
        expect(out.mail.days[4]).toEqual({ date: '2026-10-01', received: 5, sent: 2, spamBlocked: 1 });
        expect(out.mail.totals).toEqual({ received: 8, sent: 2, spamBlocked: 5 });
        expect(out.generatedAt).toBe(NOW.toISOString());
        expect(Object.keys(out).sort()).toEqual(['generatedAt', 'mail', 'users']);
    });
    it('por defecto 14 dias', async () => {
        expect((await handleStats(deps(), parse(), { grant })).mail.days).toHaveLength(14);
        expect((await handleStats(deps(), parse({}), { grant })).mail.days).toHaveLength(14);
    });
    it('rechaza un usuario no administrador y no audita', async () => {
        const d = deps({ levelOf: async () => 0 });
        await expect(handleStats(d, parse(), { grant })).rejects.toMatchObject({ code: 'forbidden' });
        expect(d.audit).not.toHaveBeenCalled();
    });
    it('sin READ_STATS en la grant (o sin grant): forbidden sin consultar nada', async () => {
        const d = deps({ levelOf: vi.fn(async () => 4) });
        await expect(handleStats(d, parse(), {})).rejects.toBeInstanceOf(BridgeError);
        await expect(handleStats(d, parse(), { grant: { perms: ['READ_USERS'] } })).rejects.toMatchObject({ code: 'forbidden' });
        expect(d.levelOf).not.toHaveBeenCalled();
        expect(grantAllowsService({ perms: ['READ_STATS'] }, 'stats')).toBe(true);
        expect(grantAllowsService({ perms: ['READ_USERS'] }, 'stats')).toBe(false);
    });
    it('cuota excedida: rate_limited', async () => {
        await expect(handleStats(deps({ rateLimit: async () => ({ ok: false, retryAfter: 9 }) }), parse(), { grant })).rejects.toMatchObject({ code: 'rate_limited' });
    });
    it('args invalidos: days fuera de rango, no entero o claves desconocidas', () => {
        for (const args of [{ days: 0 }, { days: 31 }, { days: 1.5 }, { days: '7' }, { days: 7, x: 1 }, { userId: 'x' }]) {
            expect(statsRequest.safeParse({ op: 'overview', userId: 'u1', extensionId: 'e', args }).success).toBe(false);
        }
        expect(statsRequest.safeParse({ op: 'overview', userId: 'u1', extensionId: 'e', args: {}, extra: 1 }).success).toBe(false);
    });
});
