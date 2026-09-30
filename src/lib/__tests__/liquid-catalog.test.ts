import { describe, it, expect } from 'vitest';
import { LIQUID_FILTER_NAMES, LIQUID_TAG_NAMES, compileTemplate, renderLiquid, validateTemplate } from '../liquid';
import {
    FILTER_CATALOG, TAG_CATALOG, SYSTEM_VARIABLES, FORLOOP_PROPS, variableExpression, extractDefinedVariables, BUILTIN_VARIABLE_NAMES,
} from '../liquid-catalog';

describe('catalogo del editor vs motor', () => {
    it('todo filtro del catalogo existe en el motor y viceversa', () => {
        const cat = FILTER_CATALOG.map(f => f.name);
        expect(new Set(cat).size).toBe(cat.length);
        expect(cat.filter(n => !LIQUID_FILTER_NAMES.includes(n))).toEqual([]);
        expect(LIQUID_FILTER_NAMES.filter(n => !cat.includes(n))).toEqual([]);
    });
    it('el ejemplo (apply) de cada filtro se ejecuta sin error de sintaxis ni filtro desconocido', () => {
        for (const f of FILTER_CATALOG) {
            const res = renderLiquid(`{{ v | ${f.apply} }}`, { v: 'hola', otra_lista: ['a'] }, {});
            if (!res.ok) throw new Error(`${f.name}: ${res.error.message}`);
        }
    });
    it('cada snippet de tag compila (con marcadores sustituidos)', () => {
        for (const t of TAG_CATALOG) {
            const src = t.snippet.replace(/#\{([^}]*)\}/g, (_m, name: string) => (/^\d+$/.test(name) ? name : name === '' ? '' : name === ',' ? ',' : 'x'));
            const wrapped = /^\{% (break|continue)/.test(src) ? `{% for x in y %}${src}{% endfor %}` : src;
            expect(() => compileTemplate(wrapped), t.label).not.toThrow();
        }
    });
    it('los tags del catalogo son tags conocidos del motor', () => {
        for (const t of TAG_CATALOG) {
            const head = t.snippet.match(/\{%-?\s*(\w+)/)![1];
            expect(LIQUID_TAG_NAMES, t.label).toContain(head);
        }
    });
    it('variables de sistema no generan advertencias de lint', () => {
        const src = SYSTEM_VARIABLES.filter(v => v.name !== 'now' && v.name !== 'today').map(v => `{{ ${v.name} }}`).join('');
        expect(validateTemplate(src, { knownVariables: BUILTIN_VARIABLE_NAMES })).toEqual([]);
    });
    it('forloop props existen en el motor', () => {
        for (const p of FORLOOP_PROPS.filter(p => p !== 'parentloop')) {
            expect(renderLiquid(`{% for i in (1..1) %}{{ forloop.${p} }}{% endfor %}`, {}, {}).ok).toBe(true);
        }
    });
});

describe('helpers del catalogo', () => {
    it('variableExpression usa row["…"] para nombres con simbolos', () => {
        expect(variableExpression('nombre')).toBe('nombre');
        expect(variableExpression('Nombre completo')).toBe('Nombre completo');
        expect(variableExpression('Precio (S/.)')).toBe('row["Precio (S/.)"]');
        expect(variableExpression('true')).toBe('row["true"]');
        expect(variableExpression('a"b')).toBe('row["ab"]');
    });
    it('la expresion de una columna con simbolos se resuelve en el motor', () => {
        const name = 'Precio (S/.)';
        expect(renderLiquid(`{{ ${variableExpression(name)} }}`, { [name]: '9.9' })).toEqual({ ok: true, output: '9.9' });
    });
    it('extractDefinedVariables', () => {
        expect(extractDefinedVariables('{% assign a = 1 %}{%- capture b -%}{% endcapture %}{% for it in xs %}{% endfor %}').sort()).toEqual(['a', 'b', 'it']);
    });
});
