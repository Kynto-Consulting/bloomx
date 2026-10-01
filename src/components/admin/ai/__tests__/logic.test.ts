import { describe, expect, it } from 'vitest';
import {
    aiErrorKey, barHeights, capsForLevel, disabledReason, extensionsForFeature, maskedKey, parseIntField, patchNeedsCritical, quotaPercent, validatePatterns,
} from '../logic';

describe('permisos por nivel', () => {
    it('niveles', () => {
        expect(capsForLevel(0)).toEqual({ view: false, edit: false, critical: false });
        expect(capsForLevel(1)).toEqual({ view: true, edit: false, critical: false });
        expect(capsForLevel(3)).toEqual({ view: true, edit: true, critical: false });
        expect(capsForLevel(4)).toEqual({ view: true, edit: true, critical: true });
        expect(capsForLevel(undefined).view).toBe(false);
    });
    it('motivos', () => {
        expect(disabledReason('edit', 1)).toBe('needEdit');
        expect(disabledReason('critical', 3)).toBe('needCritical');
        expect(disabledReason('critical', 4)).toBeNull();
    });
    it('parche critico', () => {
        expect(patchNeedsCritical({ enabled: false })).toBe(true);
        expect(patchNeedsCritical({ apiKey: null })).toBe(true);
        expect(patchNeedsCritical({ model: 'x', config: {} })).toBe(false);
    });
});

describe('formulario', () => {
    it('clave enmascarada', () => {
        expect(maskedKey(true, '1234')).toBe('••••1234');
        expect(maskedKey(false, null)).toBeNull();
    });
    it('enteros', () => {
        expect(parseIntField(' 42 ', 1, 100)).toBe(42);
        expect(parseIntField('0', 1, 100)).toBeNull();
        expect(parseIntField('1e3', 1, 5000)).toBeNull();
    });
    it('regex', () => {
        const r = validatePatterns(['foo', '(', 'foo', 'x'.repeat(201)].join('\n'));
        expect(r.patterns).toEqual(['foo']);
        expect(r.issues.map((i) => i.issue)).toEqual(['invalid_regex', 'duplicate', 'too_long']);
    });
    it('codigos de error', () => {
        expect(aiErrorKey(403, 'reauth_required')).toBe('reauthRequired');
        expect(aiErrorKey(400, 'unsafe_base_url:private_ip')).toBe('unsafeBaseUrl');
        expect(aiErrorKey(400, 'model_not_allowed')).toBe('modelNotAllowed');
        expect(aiErrorKey(500, undefined)).toBeNull();
    });
});

describe('uso', () => {
    it('barras', () => {
        expect(barHeights([0, 50, 100])).toEqual([0, 50, 100]);
        expect(barHeights([0, 0])).toEqual([0, 0]);
        expect(barHeights([1, 1000])[0]).toBe(2);
    });
    it('cuota y extensiones', () => {
        expect(quotaPercent(50, 200)).toBe(25);
        expect(quotaPercent(5, 0)).toBeNull();
        expect(extensionsForFeature([{ features: ['composer'] }, { features: ['translate'] }], 'composer')).toHaveLength(1);
    });
});
