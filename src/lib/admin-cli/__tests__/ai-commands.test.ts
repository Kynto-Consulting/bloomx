import { describe, expect, it } from 'vitest';
import { COMMAND_LEVELS, SCOPE_LEVELS } from '@/lib/admin-levels';
import { COMMANDS } from '../catalog';
import { requiresStepUp } from '../exec';
import { buildSetPatch } from '../commands/ai';
import { CmdError, type CmdContext } from '../types';

const ctx = { t: (l: { es: string }) => l.es } as unknown as CmdContext;
const ai = COMMANDS.filter((c) => c.name.startsWith('ai '));

describe('comandos ai', () => {
    it('estan en el catalogo con nivel explicito y descripcion es/en', () => {
        expect(ai.map((c) => c.name).sort()).toEqual(['ai audit', 'ai connection set', 'ai disable', 'ai enable', 'ai key clear', 'ai key set', 'ai purge', 'ai set', 'ai status', 'ai test', 'ai usage']);
        for (const c of ai) {
            expect(COMMAND_LEVELS[c.name], c.name).toBeGreaterThanOrEqual(1);
            expect(c.summary.es.length).toBeGreaterThan(10);
            expect(c.summary.en.length).toBeGreaterThan(10);
        }
    });
    it('niveles: lectura 1, ajustes/prueba 3, criticos 4 con step-up', () => {
        for (const n of ['ai status', 'ai usage', 'ai audit']) expect(COMMAND_LEVELS[n]).toBe(1);
        for (const n of ['ai test', 'ai set', 'ai purge']) expect(COMMAND_LEVELS[n]).toBe(3);
        for (const n of ['ai enable', 'ai disable', 'ai connection set', 'ai key set', 'ai key clear']) {
            expect(COMMAND_LEVELS[n]).toBe(4);
            expect(requiresStepUp(ai.find((c) => c.name === n)!.risk), n).toBe(true);
        }
    });
    it('la clave solo entra por stdin/aviso: sin banderas ni posicionales', () => {
        const k = ai.find((c) => c.name === 'ai key set')!;
        expect(k.acceptsInput).toBe(true);
        expect(k.flags ?? []).toEqual([]);
        expect(k.positionals ?? []).toEqual([]);
    });
    it('los scopes de las rutas existen en SCOPE_LEVELS', () => {
        expect(SCOPE_LEVELS).toMatchObject({ 'ai.read': 1, 'ai.write': 3, 'ai.test': 3, 'ai.purge': 3 });
    });
    it('ai set traduce campos no criticos y rechaza los criticos', () => {
        expect(buildSetPatch(ctx, 'model', 'gpt-4o')).toEqual({ model: 'gpt-4o' });
        expect(buildSetPatch(ctx, 'features.translate', 'off')).toEqual({ config: { features: { translate: false } } });
        expect(buildSetPatch(ctx, 'quotas.perUser.requestsDay', '50')).toEqual({ config: { quotas: { perUser: { requestsDay: 50 } } } });
        expect(buildSetPatch(ctx, 'retention', '30')).toEqual({ config: { retentionDays: 30 } });
        expect(buildSetPatch(ctx, 'guardrails.output.mode', 'warn')).toEqual({ config: { guardrails: { output: { mode: 'warn' } } } });
        for (const f of ['provider', 'baseUrl', 'apiKey', 'enabled', 'nope.x']) expect(() => buildSetPatch(ctx, f, 'x')).toThrow(CmdError);
        expect(() => buildSetPatch(ctx, 'features.translate', 'maybe')).toThrow(CmdError);
        expect(() => buildSetPatch(ctx, 'limits.timeoutMs', 'abc')).toThrow(CmdError);
    });
});
