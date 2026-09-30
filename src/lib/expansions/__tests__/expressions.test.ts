import { describe, expect, it } from 'vitest';
import { evaluateExpression, resolveDeep, resolveTemplate, LAZY_KEYS } from '../expressions';

const scope = (ctx: any = {}, state: any = {}) => ({ ctx, state });
const ev = (src: string, ctx: any = {}, state: any = {}) => evaluateExpression(src, scope(ctx, state));

describe('evaluateExpression: rutas y literales', () => {
    it('resuelve context., state., env. y raices sueltas del contexto', () => {
        const ctx = { subject: 'Hola', from: { email: 'a@x.com' }, env: { K: 'v' }, item: { n: 3 } };
        expect(ev('context.subject', ctx)).toBe('Hola');
        expect(ev('context.from.email', ctx)).toBe('a@x.com');
        expect(ev('state.x.y', {}, { x: { y: 7 } })).toBe(7);
        expect(ev('env.K', ctx)).toBe('v');
        expect(ev('item.n', ctx)).toBe(3);
        expect(ev('nada.nada', ctx)).toBeUndefined();
    });

    it('literales: texto, numero, booleanos, null', () => {
        expect(ev("'hola'")).toBe('hola');
        expect(ev('"a b"')).toBe('a b');
        expect(ev('42')).toBe(42);
        expect(ev('3.5')).toBe(3.5);
        expect(ev('true')).toBe(true);
        expect(ev('null')).toBeNull();
    });

    it('acceso con [] y ?. es tolerante a undefined', () => {
        expect(ev("state.a['b']", {}, { a: { b: 1 } })).toBe(1);
        expect(ev('state.list[0].name', {}, { list: [{ name: 'x' }] })).toBe('x');
        expect(ev('state.no?.deep?.path', {}, {})).toBeUndefined();
    });
});

describe('evaluateExpression: operadores (sin eval)', () => {
    it('&& con cortocircuito, como en sealer y appointments', () => {
        const st = { sealers: [{ name: 'a' }] };
        expect(ev('state.sealers != null && state.sealers.length > 0', {}, st)).toBe(true);
        expect(ev('state.sealers != null && state.sealers.length > 0', {}, { sealers: [] })).toBe(false);
        expect(ev('state.sealers != null && state.sealers.length > 0', {}, {})).toBe(false);
        expect(ev('state.schedules != null && state.schedules.length == 0', {}, { schedules: [] })).toBe(true);
        expect(ev('state.schedules == null', {}, {})).toBe(true);
    });

    it('|| devuelve el primer valor no vacio (0 y false cuentan como valores)', () => {
        expect(ev("context.eventTitle || 'Meeting'", {})).toBe('Meeting');
        expect(ev("context.eventTitle || 'Meeting'", { eventTitle: '' })).toBe('Meeting');
        expect(ev("context.eventTitle || 'Meeting'", { eventTitle: 'X' })).toBe('X');
        expect(ev('state.count || 5', {}, { count: 0 })).toBe(0);
        expect(ev("state.event.title || args || 'New Meeting'", { args: 'Board' }, { event: {} })).toBe('Board');
    });

    it('== null es cierto para undefined, null y cadena vacia; != null lo contrario', () => {
        expect(ev('state.a == null', {}, { a: '' })).toBe(true);
        expect(ev('state.a != null', {}, { a: '' })).toBe(false);
        expect(ev('state.a != null', {}, { a: 'x' })).toBe(true);
        expect(ev('context.auth.google.accessToken == null', {})).toBe(true);
    });

    it('comparadores, aritmetica, negacion y ternario', () => {
        expect(ev('state.n > 2', {}, { n: 3 })).toBe(true);
        expect(ev('state.n <= 2', {}, { n: 3 })).toBe(false);
        expect(ev('state.n === 3', {}, { n: 3 })).toBe(true);
        expect(ev('state.n !== 3', {}, { n: 3 })).toBe(false);
        expect(ev('1 + 2 - 1')).toBe(2);
        expect(ev("'a' + state.b", {}, { b: 'c' })).toBe('ac');
        expect(ev('!state.x', {}, { x: '' })).toBe(true);
        expect(ev("state.ok ? 'si' : 'no'", {}, { ok: true })).toBe('si');
        expect(ev('(state.a || state.b) && state.c', {}, { a: '', b: 'x', c: 'y' })).toBe('y');
    });
});

describe('evaluateExpression: filtros', () => {
    it('truncate, upper, lower, length, default, join', () => {
        expect(ev('context.emailContent | truncate:5', { emailContent: 'abcdefghij' })).toBe('abcde...');
        expect(ev('context.emailContent | truncate:500', { emailContent: 'corto' })).toBe('corto');
        expect(ev("context.t | upper", { t: 'ab' })).toBe('AB');
        expect(ev('state.l | length', {}, { l: [1, 2, 3] })).toBe(3);
        expect(ev("state.v | default:'n/a'", {}, {})).toBe('n/a');
        expect(ev("state.l | join:'-'", {}, { l: ['a', 'b'] })).toBe('a-b');
    });
});

describe('evaluateExpression: seguridad', () => {
    it('no puede llamar funciones ni salir del alcance (sin eval)', () => {
        const polluted: string[] = [];
        (globalThis as any).__pwned = () => polluted.push('x');
        expect(ev('__pwned()', {})).toBeUndefined();
        expect(ev("context.constructor.constructor('return 1')()", {})).toBeUndefined();
        expect(ev('context.__proto__', {})).toBeUndefined();
        expect(ev('state.constructor', {}, {})).toBeUndefined();
        expect(ev("process.env.SECRET", {})).toBeUndefined();
        expect(ev('globalThis', {})).toBeUndefined();
        expect(ev('window.location', {})).toBeUndefined();
        expect(polluted).toEqual([]);
        delete (globalThis as any).__pwned;
    });

    it('errores de sintaxis devuelven undefined en vez de lanzar', () => {
        expect(ev('a &&')).toBeUndefined();
        expect(ev('(')).toBeUndefined();
        expect(ev("'sin cerrar")).toBeUndefined();
        expect(ev('a ) b')).toBeUndefined();
        expect(ev('#!')).toBeUndefined();
    });

    it('limita tamano y profundidad', () => {
        expect(ev('a'.repeat(2000))).toBeUndefined();
        expect(ev('('.repeat(200) + '1' + ')'.repeat(200))).toBeUndefined();
    });

    it('las propiedades de strings solo exponen length', () => {
        expect(ev('context.s.length', { s: 'abcd' })).toBe(4);
        expect(ev('context.s.toUpperCase', { s: 'abcd' })).toBeUndefined();
    });
});

describe('resolveTemplate / resolveDeep', () => {
    it('una sola expresion conserva el tipo; texto mezclado produce string', () => {
        const s = scope({ list: [1, 2] }, { n: 5 });
        expect(resolveTemplate('${context.list}', s)).toEqual([1, 2]);
        expect(resolveTemplate('${state.n}', s)).toBe(5);
        expect(resolveTemplate('Total: ${state.n} items', s)).toBe('Total: 5 items');
        expect(resolveTemplate('X ${state.nope} Y', s)).toBe('X  Y');
        expect(resolveTemplate('sin expresiones', s)).toBe('sin expresiones');
    });

    it('respeta comillas y llaves dentro de una expresion', () => {
        const s = scope({}, { a: '' });
        expect(resolveTemplate("${state.a || '}'}", s)).toBe('}');
        expect(resolveTemplate('a ${state.a || "x"} b ${1 + 1}', s)).toBe('a x b 2');
    });

    it('resolveDeep: recorre objetos y arreglos; claves perezosas quedan intactas', () => {
        const tree = {
            label: '${context.title}',
            onClick: { action: 'TOAST', message: '${result.msg}' },
            template: { type: 'TEXT', props: { content: '${item.name}' } },
            content: 'ok ${state.x}',
            list: ['${state.x}', { deep: '${state.x}' }],
        };
        const out = resolveDeep(tree, scope({ title: 'T' }, { x: 9 }), LAZY_KEYS);
        expect(out.label).toBe('T');
        expect(out.onClick.message).toBe('${result.msg}');
        expect(out.template.props.content).toBe('${item.name}');
        expect(out.content).toBe('ok 9'); // content de tipo string SI se resuelve
        expect(out.list).toEqual([9, { deep: 9 }]);
    });

    it('resolveDeep ignora claves peligrosas', () => {
        const evil = JSON.parse('{"__proto__": {"polluted": true}, "ok": "${state.x}"}');
        const out = resolveDeep(evil, scope({}, { x: 1 }));
        expect(out.ok).toBe(1);
        expect(({} as any).polluted).toBeUndefined();
    });
});
