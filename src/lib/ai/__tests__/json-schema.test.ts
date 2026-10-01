import { describe, expect, it } from 'vitest';
import { SCHEMA_LIMITS, extractJson, toGeminiSchema, validateAgainstSchema, validateSchemaDefinition, type JsonSchema } from '../json-schema';

const ok = (s: unknown) => validateSchemaDefinition(s).ok;
const err = (s: unknown) => { const r = validateSchemaDefinition(s); return r.ok ? null : r.error; };

describe('validateSchemaDefinition', () => {
    it('acepta una definicion valida', () => {
        expect(ok({ type: 'object', required: ['a'], additionalProperties: false, properties: { a: { type: 'string', maxLength: 10 }, b: { type: ['array', 'null'], items: { type: 'integer', minimum: 0 } } } })).toBe(true);
    });
    it('rechaza $ref, pattern, allOf, format y desconocidas', () => {
        expect(err({ $ref: '#/x' })).toMatch(/unsupported_keyword/);
        expect(err({ type: 'string', pattern: '^a+$' })).toMatch(/unsupported_keyword/);
        expect(err({ allOf: [] })).toMatch(/unsupported_keyword/);
        expect(err({ anyOf: [] })).toMatch(/unsupported_keyword/);
        expect(err({ type: 'string', format: 'email' })).toMatch(/unsupported_keyword/);
        expect(err({ type: 'string', foo: 1 })).toMatch(/unknown_keyword/);
        expect(err({ properties: { a: { $ref: 'http://x' } } })).toMatch(/unsupported_keyword/);
    });
    it('tipos, enum y numericos invalidos', () => {
        expect(err({ type: 'date' })).toMatch(/bad_type/);
        expect(err({ enum: [] })).toMatch(/bad_enum/);
        expect(err({ enum: [{}] })).toMatch(/bad_enum/);
        expect(err({ enum: Array.from({ length: 101 }, (_, i) => i) })).toMatch(/bad_enum/);
        expect(err({ minLength: -1 })).toMatch(/bad_minLength/);
        expect(err({ minimum: 'x' })).toMatch(/bad_minimum/);
        expect(err({ required: [1] })).toMatch(/bad_required/);
        expect(err([])).toMatch(/not_object/);
        expect(err(null)).toMatch(/not_object/);
    });
    it('limites de profundidad, nodos y tamano', () => {
        let deep: any = { type: 'string' };
        for (let i = 0; i < SCHEMA_LIMITS.maxDepth; i++) deep = { type: 'object', properties: { a: deep } };
        expect(err(deep)).toMatch(/too_deep/);
        let okDeep: any = { type: 'string' };
        for (let i = 0; i < SCHEMA_LIMITS.maxDepth - 1; i++) okDeep = { type: 'object', properties: { a: okDeep } };
        expect(ok(okDeep)).toBe(true);
        const many = { type: 'object', properties: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`p${i}`, { type: 'string' }])) };
        expect(err(many)).toBe('too_many_nodes');
        expect(err({ type: 'string', description: 'x'.repeat(17000) })).toBe('too_large');
        const circ: any = { type: 'object' };
        circ.self = circ;
        expect(err(circ)).toBe('not_serializable');
    });
    it('__proto__ como nombre de propiedad se rechaza', () => {
        const s = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}');
        expect(err(s)).toMatch(/bad_name/);
    });
});

describe('validateAgainstSchema', () => {
    const schema: JsonSchema = {
        type: 'object', required: ['name', 'tags'], additionalProperties: false,
        properties: { name: { type: 'string', minLength: 2 }, age: { type: 'integer', minimum: 0, maximum: 150 }, tags: { type: 'array', maxItems: 2, items: { type: 'string', enum: ['a', 'b'] } }, note: { type: 'string', nullable: true } },
    };
    it('datos validos', () => { expect(validateAgainstSchema({ name: 'Al', age: 3, tags: ['a'], note: null }, schema)).toEqual({ ok: true }); });
    it('ruta y regla del primer incumplimiento', () => {
        expect(validateAgainstSchema({ tags: [] }, schema)).toEqual({ ok: false, path: '$.name', rule: 'required' });
        expect(validateAgainstSchema({ name: 'A', tags: [] }, schema)).toEqual({ ok: false, path: '$.name', rule: 'minLength' });
        expect(validateAgainstSchema({ name: 'Al', tags: ['a', 'z'] }, schema)).toEqual({ ok: false, path: '$.tags[1]', rule: 'enum' });
        expect(validateAgainstSchema({ name: 'Al', tags: [], age: 1.5 }, schema)).toEqual({ ok: false, path: '$.age', rule: 'type' });
        expect(validateAgainstSchema({ name: 'Al', tags: [], age: 200 }, schema)).toEqual({ ok: false, path: '$.age', rule: 'maximum' });
        expect(validateAgainstSchema({ name: 'Al', tags: ['a', 'b', 'a'] }, schema)).toMatchObject({ ok: false, rule: 'maxItems' });
        expect(validateAgainstSchema({ name: 'Al', tags: [], extra: 1 }, schema)).toEqual({ ok: false, path: '$.extra', rule: 'additionalProperties' });
        expect(validateAgainstSchema([], schema)).toMatchObject({ rule: 'type' });
    });
    it('el resultado nunca contiene el valor', () => {
        const r = validateAgainstSchema({ name: 'SECRETO-VALOR', tags: 'x' }, schema);
        expect(JSON.stringify(r)).not.toContain('SECRETO');
    });
    it('required no se satisface con propiedades heredadas', () => {
        expect(validateAgainstSchema({}, { type: 'object', required: ['toString'] })).toMatchObject({ rule: 'required' });
    });
    it('tipos basicos y null', () => {
        expect(validateAgainstSchema(3, { type: 'number' }).ok).toBe(true);
        expect(validateAgainstSchema('3', { type: 'number' }).ok).toBe(false);
        expect(validateAgainstSchema(null, { type: 'string' }).ok).toBe(false);
        expect(validateAgainstSchema(null, { type: ['string', 'null'] }).ok).toBe(true);
    });
});

describe('extractJson', () => {
    it('JSON directo, con fences y con texto alrededor', () => {
        expect(extractJson('{"a":1}')).toEqual({ a: 1 });
        expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
        expect(extractJson('Claro: {"a":[1,2]} espero que sirva')).toEqual({ a: [1, 2] });
        expect(extractJson('lista [1,2,3]')).toEqual([1, 2, 3]);
    });
    it('lanza si no hay JSON', () => {
        expect(() => extractJson('nada por aqui')).toThrow();
        expect(() => extractJson('{roto')).toThrow();
    });
});

describe('toGeminiSchema', () => {
    it('convierte tipos y elimina additionalProperties/const/title', () => {
        const g = toGeminiSchema({ type: 'object', title: 't', additionalProperties: false, required: ['a'], properties: { a: { type: ['string', 'null'], enum: ['x'] } } });
        expect(g).toEqual({ type: 'OBJECT', required: ['a'], properties: { a: { type: 'STRING', nullable: true, enum: ['x'] } } });
    });
});
