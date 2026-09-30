/**
 * Evaluador de expresiones: operadores aritmeticos, filtros nuevos, diagnostico con posicion y limites de seguridad.
 */
import { describe, expect, it } from 'vitest';
import { FILTER_NAMES, checkExpression, evaluateExpression, explainExpression, resolveDeep, resolveTemplate, LAZY_KEYS } from '../expressions';

const ev = (src: string, ctx: any = {}, state: any = {}) => evaluateExpression(src, { ctx, state });

describe('operadores', () => {
    it('* / % con la precedencia habitual y division por cero -> vacio', () => {
        expect(ev('2 + 3 * 4')).toBe(14);
        expect(ev('(2 + 3) * 4')).toBe(20);
        expect(ev('10 % 4 + 10 / 4')).toBe(4.5);
        expect(ev('-2 * 3')).toBe(-6);
        expect(ev('1 / 0')).toBeUndefined();
        expect(ev('5 % 0')).toBeUndefined();
        expect(ev('state.n * 2', {}, { n: 21 })).toBe(42);
    });
});

describe('filtros', () => {
    it('numericos', () => {
        expect(ev('x | round:1', { x: 3.14159 })).toBe(3.1);
        expect(ev('x | round', { x: 2.5 })).toBe(3);
        expect(ev('x | floor', { x: 2.9 })).toBe(2);
        expect(ev('x | ceil', { x: 2.1 })).toBe(3);
        expect(ev('x | abs', { x: -4 })).toBe(4);
        expect(ev('x | round:2', { x: 'no' })).toBe('no');
    });

    it('listas y textos', () => {
        const ctx = { rows: [{ id: 1 }, { id: 2 }, { id: 3 }], s: 'a,b ,c' };
        expect(ev("rows | pluck:'id' | sum", ctx)).toBe(6);
        expect(ev('rows | first | json', ctx)).toBe('{"id":1}');
        expect(ev('rows | last | json', ctx)).toBe('{"id":3}');
        expect(ev('rows | slice:1:3 | length', ctx)).toBe(2);
        expect(ev("s | split:',' | join:'-'", ctx)).toBe('a-b-c');
        expect(ev("s | replace:',':';'", ctx)).toBe('a;b ;c');
        expect(ev("rows | pluck:'id' | includes:2", ctx)).toBe(true);
        expect(ev('o | keys | join', { o: { a: 1, b: 2 } })).toBe('a, b');
    });

    it('condicionales y plurales', () => {
        expect(ev("flag | yesno:'si':'no'", { flag: true })).toBe('si');
        expect(ev('flag | yesno', { flag: false })).toBe('No');
        expect(ev("n | plural:'mensaje':'mensajes'", { n: 1 })).toBe('mensaje');
        expect(ev("n | plural:'mensaje':'mensajes'", { n: 3 })).toBe('mensajes');
        expect(ev("missing | default:'x'")).toBe('x');
        expect(ev('v | not', { v: 0 })).toBe(true);
    });

    it('fechas invalidas devuelven el texto original', () => {
        expect(ev('d | date', { d: 'no es fecha' })).toBe('no es fecha');
        expect(typeof ev('d | date', { d: '2026-09-30T10:00:00Z' })).toBe('string');
        expect(ev('d | datetime')).toBe('');
    });

    it('el catalogo de filtros coincide con el evaluador (ninguno es un no-op)', () => {
        for (const name of FILTER_NAMES) expect(checkExpression(`1 | ${name}`), name).toBeNull();
        expect(ev('1 | inventado')).toBe(1); // en ejecucion un filtro desconocido no rompe
    });
});

describe('diagnostico', () => {
    it('mensajes legibles con posicion', () => {
        expect(checkExpression('')).toMatch(/vacia/);
        expect(checkExpression('a +')).toMatch(/incompleta/);
        expect(checkExpression('(a + b')).toMatch(/\)/);
        expect(checkExpression('a | ')).toMatch(/filtro/);
        expect(checkExpression('a.')).toMatch(/propiedad/);
        expect(checkExpression("'sin cerrar")).toMatch(/sin cerrar/);
        expect(checkExpression('a # b')).toMatch(/posicion 2/);
        expect(checkExpression('fn(1)')).toMatch(/filtros/);
        expect(checkExpression('x'.repeat(1200))).toMatch(/demasiado larga/);
        expect(checkExpression('a | zzz')).toMatch(/desconocido "zzz"/);
        expect(checkExpression('state.$loading.save && !state.$error.save')).toBeNull();
    });

    it('explainExpression: valor o error', () => {
        expect(explainExpression('a * 2', { ctx: { a: 4 }, state: {} })).toEqual({ value: 8 });
        expect(explainExpression('a *', { ctx: {}, state: {} }).error).toMatch(/incompleta/);
    });
});

describe('seguridad del evaluador', () => {
    it('no expone prototipos ni funciones del host', () => {
        expect(ev('a.__proto__', { a: {} })).toBeUndefined();
        expect(ev('a.constructor', { a: {} })).toBeUndefined();
        expect(ev('a["constructor"]["constructor"]', { a: {} })).toBeUndefined();
        expect(ev('a.toString', { a: {} })).toBeUndefined();
        expect(ev('rows.map', { rows: [1] })).toBeUndefined();
        expect(resolveTemplate('x ${a.constructor} y', { ctx: { a: {} }, state: {} })).toBe('x  y');
    });

    it('expresiones patologicas (muy profundas o largas) no cuelgan ni lanzan', () => {
        expect(() => ev('('.repeat(500) + 'a' + ')'.repeat(500))).not.toThrow();
        expect(ev('!'.repeat(400) + 'a', { a: true })).toBeUndefined();
        expect(() => ev('a'.repeat(5000))).not.toThrow();
    });

    it('resolveDeep deja intactas las claves perezosas (acciones y plantillas) y descarta claves bloqueadas', () => {
        const resolved = resolveDeep(
            { label: 'Hola ${context.name}', onClick: { action: 'SET_STATE', value: '${later}' }, footer: [{ type: 'TEXT', props: { content: '${later}' } }], overlays: { o: { x: '${later}' } }, ['__proto__']: { polluted: true } as any },
            { ctx: { name: 'Ana' }, state: {} },
            LAZY_KEYS,
        );
        expect(resolved.label).toBe('Hola Ana');
        expect(resolved.onClick.value).toBe('${later}');
        expect(resolved.footer[0].props.content).toBe('${later}');
        expect(resolved.overlays.o.x).toBe('${later}');
        expect(({} as any).polluted).toBeUndefined();
    });
});
