import { describe, expect, it } from 'vitest';
import { normalizeSettingsSchema } from '@/lib/expansions/settings-schema';
import {
    buildDiff, changedKeys, groupFields, initialForm, isLegacySource, mapServerErrors, secretSummary, validateForm, visibleFields,
} from '../extensions-config';
import { summarizeTemplate } from '../extensions-manifest';

const schema = normalizeSettingsSchema({
    groups: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    fields: [
        { key: 'name', type: 'string', label: 'Name', required: true, group: 'b' },
        { key: 'count', type: 'number', label: 'Count', min: 1, max: 10, integer: true, default: 3, group: 'a' },
        { key: 'on', type: 'boolean', label: 'On', default: true },
        { key: 'mode', type: 'enum', label: 'Mode', options: ['x', 'y'], default: 'x' },
        { key: 'extra', type: 'string', label: 'Extra', visibleWhen: { key: 'mode', in: ['y'] } },
        { key: 'tags', type: 'list', label: 'Tags', maxItems: 2, default: ['q'] },
        { key: 'kinds', type: 'multienum', label: 'Kinds', options: ['k1', 'k2'], default: ['k1'] },
        { key: 'cfg', type: 'json', label: 'Cfg' },
        { key: 'API_KEY', type: 'string', secret: true, label: 'Key', required: true },
    ],
});

describe('extensions-config', () => {
    it('estado inicial: guardado o por defecto; sin cambios al inicio', () => {
        const form = initialForm(schema, { name: 'Acme', tags: ['a', 'b'] });
        expect(form).toMatchObject({ name: 'Acme', count: '3', on: true, mode: 'x', tags: 'a\nb', kinds: ['k1'], cfg: '' });
        expect(form.API_KEY).toBeUndefined();
        expect(changedKeys(schema, form, { ...form })).toEqual([]);
    });

    it('diff: valores normalizados, null al vaciar, ocultos fuera', () => {
        const init = initialForm(schema, { name: 'Acme' });
        const cur = { ...init, name: '  Beta ', count: '5', tags: 'a\nb\na', cfg: '{"a":1}', extra: 'zzz', kinds: [] as string[] };
        expect(buildDiff(schema, init, cur)).toEqual({ name: 'Beta', count: 5, tags: ['a', 'b'], cfg: { a: 1 }, kinds: [] });
        expect(buildDiff(schema, init, { ...init, name: '' })).toEqual({ name: null });
        expect(buildDiff(schema, init, { ...init, mode: 'y', extra: 'ok' })).toMatchObject({ mode: 'y', extra: 'ok' });
    });

    it('validacion: requerido, rango, lista, json y visibleWhen', () => {
        const init = initialForm(schema, {});
        expect(validateForm(schema, init).name).toEqual({ code: 'required' });
        const bad = validateForm(schema, { ...init, name: 'x', count: '99', tags: 'a\nb\nc', cfg: '{no', extra: 'no se valida' });
        expect(bad.count?.code).toBe('max');
        expect(bad.tags?.code).toBe('maxItems');
        expect(bad.cfg?.code).toBe('json');
        expect(bad.extra).toBeUndefined();
        expect(bad.name).toBeUndefined();
        expect(validateForm(schema, { ...init, name: '' }, { name: 'server-env' }).name).toBeUndefined();
    });

    it('visibleWhen y secretos', () => {
        const init = initialForm(schema, {});
        expect(visibleFields(schema, init).map((f) => f.key)).not.toContain('extra');
        expect(visibleFields(schema, { ...init, mode: 'y' }).map((f) => f.key)).toContain('extra');
        expect(visibleFields(schema, init).map((f) => f.key)).not.toContain('API_KEY');
        expect(secretSummary(schema, [{ name: 'API_KEY', configured: true }])).toEqual({ configured: 1, total: 1 });
    });

    it('grupos: sin grupo primero, luego en orden declarado', () => {
        const sections = groupFields(schema);
        expect(sections.map((s) => s.id)).toEqual(['', 'a', 'b']);
        expect(sections[1].fields.map((f) => f.key)).toEqual(['count']);
    });

    it('errores 422 por ruta', () => {
        expect(mapServerErrors([{ path: 'values.count', message: 'Maximo 10', code: 'max', params: { max: 10 } }, { path: 'secrets.eps.a.s', message: 's' }, { path: 'values', message: 'general' }]))
            .toEqual({ byKey: { count: { message: 'Maximo 10', code: 'max', params: { max: 10 } } }, bySecret: { 'eps.a.s': { message: 's' } }, general: [{ message: 'general' }] });
        expect(isLegacySource('server-env')).toBe(true);
        expect(isLegacySource('domain')).toBe(false);
    });

    it('summarizeTemplate conserva el esquema normalizado', () => {
        const t = summarizeTemplate({ id: 'x', settingsSchema: { fields: [{ key: 'a', type: 'text', label: 'A' }] } });
        expect(t?.settingsSchema?.fields[0]).toMatchObject({ key: 'a', type: 'string', secret: false });
        expect(summarizeTemplate({ id: 'x' })?.settingsSchema).toBeUndefined();
    });
});
