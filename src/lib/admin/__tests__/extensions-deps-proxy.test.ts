import { describe, it, expect } from 'vitest';
import { backendError, sanitizeIdList } from '../extensions-proxy';

describe('proxy de dependencias', () => {
    it('409 EXTENSION_DEPENDENCIES_REQUIRED -> dependencies_required con lista saneada', () => {
        const e = backendError({ status: 409, data: { code: 'EXTENSION_DEPENDENCIES_REQUIRED', dependencies: [{ id: 'core-googlelib', version: '1.0.0', range: '^1.0.0', action: 'install' }, { id: '../evil', version: 'x' }, { id: 'ok-ext', action: 'activate', extra: 'secret' }] } });
        expect(e.status).toBe(409);
        expect(e.code).toBe('dependencies_required');
        expect(e.extra?.dependencies).toEqual([
            { id: 'core-googlelib', version: '1.0.0', range: '^1.0.0', action: 'install' },
            { id: 'ok-ext', version: '', range: '', action: 'activate' },
        ]);
    });
    it('409 EXTENSION_DEPENDENCY_MISSING conserva el codigo estable y no copia texto del backend', () => {
        const e = backendError({ status: 409, data: { code: 'EXTENSION_DEPENDENCY_MISSING', error: 'internal detail', errors: [{ dependency: 'core-googlelib', range: '^1.0.0', reason: 'not-in-catalog', detail: 'x' }] } });
        expect(e.code).toBe('EXTENSION_DEPENDENCY_MISSING');
        expect(JSON.stringify(e.extra)).not.toContain('internal detail');
    });
    it('sanitizeIdList descarta ids invalidos y acota', () => {
        expect(sanitizeIdList(['a-b', '../x', 5, 'ok.id'])).toEqual(['a-b', 'ok.id']);
        expect(sanitizeIdList('no')).toEqual([]);
        expect(sanitizeIdList(Array.from({ length: 80 }, (_, i) => `e${i}`))).toHaveLength(50);
    });
});
