import { describe, expect, it } from 'vitest';
import { effectiveSource, movableKeys, serverEnvKeys, sourceI18nKey } from '../extension-credentials';

describe('fuentes de credenciales (sin valores)', () => {
    it('effectiveSource usa source y, sin el, se deduce de configured', () => {
        expect(effectiveSource({ configured: false, source: 'legacy' })).toBe('legacy');
        expect(effectiveSource({ configured: true })).toBe('domain');
        expect(effectiveSource({ configured: false })).toBe('missing');
        expect(effectiveSource({ configured: true, source: 'raro' as any })).toBe('domain');
    });

    it('sourceI18nKey mapea server-env a serverEnv', () => {
        expect(sourceI18nKey('server-env')).toBe('serverEnv');
        expect(sourceI18nKey('domain')).toBe('domain');
        expect(sourceI18nKey('legacy')).toBe('legacy');
        expect(sourceI18nKey('missing')).toBe('missing');
    });

    it('movableKeys solo incluye heredadas movibles; serverEnvKeys las de entorno global (no copiables)', () => {
        const keys = [
            { name: 'A', configured: false, source: 'legacy' as const, movable: true },
            { name: 'B', configured: false, source: 'legacy' as const, movable: false },
            { name: 'C', configured: true, source: 'domain' as const, movable: true },
            { name: 'D', configured: false, source: 'server-env' as const },
        ];
        expect(movableKeys(keys)).toEqual(['A']);
        expect(serverEnvKeys(keys)).toEqual(['D']);
    });
});
