import { describe, expect, it } from 'vitest';
import { buildDiff, changedKeys, describeFieldError, initialForm, isEmptyForm, toFormValue, validateForm } from '../extensions-config';
import { normalizeSettingsSchema } from '@/lib/expansions/settings-schema';

const schema = normalizeSettingsSchema({
    fields: [
        { key: 'owner', type: 'user', label: 'Owner' },
        { key: 'team', type: 'users', label: 'Team', maxItems: 3 },
        { key: 'digest', type: 'userMap', valueType: 'boolean', default: true, label: 'Digest' },
        { key: 'quota', type: 'userMap', valueType: 'number', min: 1, max: 10, integer: true, label: 'Quota' },
        { key: 'tier', type: 'userMap', valueType: 'select', options: ['free', 'pro'], default: 'free', label: 'Tier' },
    ],
});
const field = (key: string) => schema.fields.find((f) => f.key === key)!;

describe('formulario: user / users / userMap', () => {
    it('estado inicial: user = id, users = lista, userMap = solo entradas explicitas (el default NO es un mapa)', () => {
        const form = initialForm(schema, { owner: 'u1', team: ['a', 'b'], digest: { u1: false }, quota: { u1: 3 } });
        expect(form.owner).toBe('u1');
        expect(form.team).toEqual(['a', 'b']);
        expect(form.digest).toEqual({ u1: false });
        expect(form.quota).toEqual({ u1: '3' });
        expect(form.tier).toEqual({});
        expect(initialForm(schema, {}).digest).toEqual({});
    });

    it('vacio: userMap {} y users [] cuentan como vacios (restablecen)', () => {
        expect(isEmptyForm(field('digest'), {})).toBe(true);
        expect(isEmptyForm(field('digest'), { u1: false })).toBe(false);
        expect(isEmptyForm(field('team'), [])).toBe(true);
        expect(isEmptyForm(field('owner'), '')).toBe(true);
    });

    it('diff: solo cambia lo editado, normaliza numeros y envia null al vaciar', () => {
        const base = initialForm(schema, { digest: { u1: true }, owner: 'u1' });
        const next = { ...base, digest: { u1: true, u2: false }, quota: { u3: '4' }, owner: '' };
        expect(changedKeys(schema, base, next).sort()).toEqual(['digest', 'owner', 'quota']);
        expect(buildDiff(schema, base, next)).toEqual({ digest: { u1: true, u2: false }, quota: { u3: 4 }, owner: null });
        expect(buildDiff(schema, base, { ...base })).toEqual({});
        const cleared = buildDiff(schema, base, { ...base, digest: {} });
        expect(cleared.digest).toBeNull();
    });

    it('validacion en cliente con las mismas reglas que el backend y mensajes traducibles', () => {
        const base = initialForm(schema, {});
        const errors = validateForm(schema, { ...base, quota: { u1: '99' }, tier: { u1: 'gold' }, team: ['a', 'b', 'c', 'd'], digest: { 'bad id': true } });
        expect(errors.quota?.code).toBe('userMapEntry');
        expect(errors.tier?.code).toBe('userMapEntry');
        expect(errors.team?.code).toBe('maxUsers');
        expect(errors.digest?.code).toBe('userId');
        const t = (key: string, p?: Record<string, string | number>) => `${key}|${JSON.stringify(p ?? {})}`;
        expect(describeFieldError(t, { code: 'userMissing', params: { id: 'zz' } })).toContain('err.userMissing');
        expect(validateForm(schema, { ...base, digest: { u1: true }, quota: { u1: '5' }, tier: { u1: 'pro' } })).toEqual({});
    });

    it('toFormValue ignora entradas que no son primitivas', () => {
        expect(toFormValue(field('digest'), { u1: true, u2: { x: 1 }, u3: 'si' })).toEqual({ u1: true, u3: 'si' });
        expect(toFormValue(field('digest'), 'no es un mapa')).toEqual({});
    });
});
