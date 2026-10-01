import { describe, expect, it } from 'vitest';
import { normalizeSettingsSchema } from '@/lib/expansions/settings-schema';
import {
    buildDiff, buildSecrets, changedKeys, describeFieldError, initialForm, itemDirty, newItemId, toItem, validateForm, validateItems, type ObjectItem,
} from '../extensions-config';

const objSchema = normalizeSettingsSchema({
    fields: [{
        key: 'endpoints', type: 'objects', required: true, maxItems: 3,
        itemFields: [
            { key: 'name', type: 'string', label: 'Nombre', required: true },
            { key: 'url', type: 'string', label: 'URL', format: 'url', required: true },
            { key: 'mode', type: 'enum', label: 'Modo', options: ['a', 'b'], default: 'a' },
            { key: 'token', type: 'string', secret: true, label: 'Token', required: true },
            { key: 'extra', type: 'string', label: 'Extra', required: true, visibleWhen: { key: 'mode', in: ['b'] } },
        ],
        templates: [{ id: 'slack', label: 'Slack', value: { name: 'Slack', url: 'https://hooks.example.com/x', mode: 'b' } }],
    }],
});
const epField = objSchema.fields[0];
const items = (form: ReturnType<typeof initialForm>) => form.endpoints as ObjectItem[];

describe('describeFieldError', () => {
    it('traduce por code+params y cae a message solo sin traduccion', () => {
        const t = (k: string, p?: Record<string, string | number>) => (k.endsWith('.max') ? `max ${p?.max}` : k.endsWith('.itemField') ? `item ${p?.index}: ${p?.detail}` : k);
        expect(describeFieldError(t, { code: 'max', params: { max: 5 }, message: 'Maximo 5 (es)' })).toBe('max 5');
        expect(describeFieldError(t, { code: 'itemField', params: { index: 2, field: 'url', sub: 'max', max: 9 } })).toBe('item 2: max 9');
        expect(describeFieldError(t, { code: 'desconocido', message: 'respaldo' })).toBe('respaldo');
    });
});

describe('objects', () => {
    it('ids estables unicos con slug', () => {
        const id = newItemId('Mi Endpoint Ñandú', ['mi-endpoint-nandu-0000'], () => 0);
        expect(id).toMatch(/^[a-z0-9][a-z0-9-]{0,31}$/);
        expect(id).not.toBe('mi-endpoint-nandu-0000');
        expect(newItemId('', [])).toMatch(/^item-/);
    });

    it('estado inicial desde valores guardados y plantillas; los secretos no llevan valor', () => {
        const form = initialForm(objSchema, { endpoints: [{ id: 'a1', name: 'A', url: 'https://x.test' }] });
        expect(items(form)[0]).toMatchObject({ id: 'a1', isNew: false, values: { name: 'A', url: 'https://x.test', mode: 'a' }, secrets: {} });
        expect(items(form)[0].values.token).toBeUndefined();
        const tpl = toItem(epField, epField.templates![0].value, 'slack-1', true);
        expect(tpl.isNew).toBe(true);
        expect(tpl.values.mode).toBe('b');
    });

    it('validacion por sub-campo con code, required, visibleWhen y secreto obligatorio', () => {
        const item = toItem(epField, {}, 'n1', true);
        const errs = validateItems(epField, [item]);
        expect(errs['n1.name']).toEqual({ code: 'required' });
        expect(errs['n1.url']).toEqual({ code: 'required' });
        expect(errs['n1.token']).toEqual({ code: 'required' });
        expect(errs['n1.extra']).toBeUndefined();
        const ok = { ...item, values: { ...item.values, name: 'N', url: 'http://inseguro.test' }, secrets: { token: 's3cret' } };
        expect(validateItems(epField, [ok])['n1.url']?.code).toBe('format');
        expect(validateItems(epField, [{ ...ok, values: { ...ok.values, url: 'https://ok.test' } }])).toEqual({});
        const shown = { ...ok, values: { ...ok.values, url: 'https://ok.test', mode: 'b' } };
        expect(validateItems(epField, [shown])['n1.extra']).toEqual({ code: 'required' });
        const saved = toItem(epField, { id: 'e1', name: 'E', url: 'https://ok.test' }, 'e1', false);
        expect(validateItems(epField, [saved], new Set(['endpoints.e1.token']))).toEqual({});
        expect(validateItems(epField, [saved])['e1.token']).toEqual({ code: 'required' });
        expect(validateItems(epField, [{ ...saved, secrets: { token: null } }], new Set(['endpoints.e1.token']))['e1.token']).toEqual({ code: 'required' });
    });

    it('validateForm marca el campo, required con 0 elementos y maximo', () => {
        expect(validateForm(objSchema, initialForm(objSchema, {})).endpoints).toEqual({ code: 'required' });
        const bad = { endpoints: [toItem(epField, {}, 'n1', true)] };
        expect(validateForm(objSchema, bad).endpoints).toMatchObject({ code: 'itemField', params: { count: 3 } });
        const many = { endpoints: ['a', 'b', 'c', 'd'].map((id) => toItem(epField, {}, id, true)) };
        expect(validateForm(objSchema, many).endpoints?.code).toBe('maxItems');
    });

    it('el diff envia el array normalizado y los secretos van aparte, solo los cambiados', () => {
        const init = initialForm(objSchema, { endpoints: [{ id: 'a1', name: 'A', url: 'https://x.test' }] });
        const added = { ...toItem(epField, { name: 'B', url: 'https://b.test' }, 'b1', true), secrets: { token: 'tok-b' } };
        const cur = { endpoints: [...items(init), added] };
        expect(buildDiff(objSchema, init, cur)).toEqual({
            endpoints: [{ id: 'a1', name: 'A', url: 'https://x.test', mode: 'a' }, { id: 'b1', name: 'B', url: 'https://b.test', mode: 'a' }],
        });
        expect(buildSecrets(objSchema, cur)).toEqual({ 'endpoints.b1.token': 'tok-b' });
        const only = { endpoints: [{ ...items(init)[0], secrets: { token: 'nuevo' } }] };
        expect(changedKeys(objSchema, init, only)).toEqual(['endpoints']);
        expect(buildDiff(objSchema, init, only)).toEqual({});
        expect(buildSecrets(objSchema, only)).toEqual({ 'endpoints.a1.token': 'nuevo' });
        expect(buildSecrets(objSchema, { endpoints: [{ ...items(init)[0], secrets: { token: null } }] })).toEqual({ 'endpoints.a1.token': null });
        expect(buildDiff(objSchema, init, { endpoints: [] })).toEqual({ endpoints: null });
    });

    it('itemDirty distingue nuevo, editado y sin cambios', () => {
        const init = initialForm(objSchema, { endpoints: [{ id: 'a1', name: 'A', url: 'https://x.test' }] });
        const [saved] = items(init);
        expect(itemDirty(init.endpoints, saved)).toBe(false);
        expect(itemDirty(init.endpoints, { ...saved, values: { ...saved.values, name: 'Z' } })).toBe(true);
        expect(itemDirty(init.endpoints, { ...saved, secrets: { token: 'x' } })).toBe(true);
        expect(itemDirty(init.endpoints, toItem(epField, {}, 'n1', true))).toBe(true);
    });
});
