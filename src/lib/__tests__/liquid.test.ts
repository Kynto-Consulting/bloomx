import { describe, it, expect } from 'vitest';
import {
    compileTemplate, renderLiquid, renderTemplate, validateTemplate, systemDateVars,
    LiquidError, LIQUID_FILTER_NAMES, type RenderOptions, type LiquidData,
} from '../liquid';

const NOW = new Date('2025-01-15T12:00:00Z');
const r = (tpl: string, data: LiquidData = {}, o: RenderOptions = {}) => renderTemplate(tpl, data, { now: NOW, ...o });
const errCode = (tpl: string, data: LiquidData = {}, o: RenderOptions = {}) => {
    const res = renderLiquid(tpl, data, { now: NOW, ...o });
    if (res.ok) throw new Error('se esperaba error, salida: ' + res.output);
    return res.error.code;
};

describe('salida y variables', () => {
    it('texto plano y variables', () => {
        expect(r('Hola {{ nombre }}!', { nombre: 'Ana' })).toBe('Hola Ana!');
        expect(r('{{nombre}}', { nombre: 'Ana' })).toBe('Ana');
    });
    it('variable inexistente renderiza vacio (no estricto)', () => {
        expect(r('[{{ x }}]')).toBe('[]');
    });
    it('literales de texto y numero', () => {
        expect(r('{{ "hola" }}|{{ \'a\' }}|{{ 42 }}|{{ -3.5 }}')).toBe('hola|a|42|-3.5');
    });
    it('nombres de columna con espacios y acentos', () => {
        expect(r('{{ Nombre completo }} / {{ correo electrónico | upcase }}', { 'Nombre completo': 'Ana P', 'correo electrónico': 'a@b.c' })).toBe('Ana P / A@B.C');
    });
    it('row[""] para columnas con simbolos', () => {
        expect(r('{{ row["Precio (S/.)"] }}', { 'Precio (S/.)': '9.90' })).toBe('9.90');
    });
    it('objetos: punto y corchetes, size/first/last', () => {
        const d = { user: { name: 'Ana', tags: ['a', 'b', 'c'] } };
        expect(r('{{ user.name }} {{ user["name"] }} {{ user.tags.size }} {{ user.tags.first }} {{ user.tags.last }} {{ user.tags[1] }} {{ user.tags[-1] }}', d)).toBe('Ana Ana 3 a c b c');
    });
    it('una columna llamada "now" tiene prioridad sobre el valor del sistema', () => {
        expect(r('{{ now }}', { now: 'ahora' })).toBe('ahora');
    });
    it('no accede a prototipos', () => {
        expect(r('{{ constructor }}|{{ __proto__ }}|{{ a.constructor }}|{{ a.__proto__ }}', { a: { x: 1 } })).toBe('|||');
        expect(r('{% increment constructor %}{% increment constructor %}')).toBe('01');
        expect(r('{{ row.constructor }}', { a: '1' })).toBe('');
    });
    it('arrays se imprimen concatenados', () => {
        expect(r('{{ xs }}', { xs: ['a', 'b'] })).toBe('ab');
    });
});

describe('errores tipados (nunca devuelve la plantilla cruda)', () => {
    it('renderTemplate lanza LiquidError', () => {
        expect(() => renderTemplate('{{ a | nope }}', {})).toThrow(LiquidError);
    });
    it('renderLiquid devuelve ok:false y no la plantilla', () => {
        const res = renderLiquid('Hola {% if %}', {});
        expect(res.ok).toBe(false);
        if (!res.ok) {
            expect(res.error.code).toBe('syntax');
            expect(res.error.line).toBe(1);
        }
    });
    it('codigos de error', () => {
        expect(errCode('{% if a %}x')).toBe('syntax');
        expect(errCode('{% endif %}')).toBe('syntax');
        expect(errCode('{% foo %}')).toBe('unknown_tag');
        expect(errCode('{% include "x" %}')).toBe('unknown_tag');
        expect(errCode('{{ a | nope }}')).toBe('unknown_filter');
        expect(errCode('{{ a ')).toBe('syntax');
        expect(errCode('{% for x in y %}{% endfor %}{% break %}')).toBe('syntax');
        expect(errCode('{{ "abc }}')).toBe('syntax');
        expect(errCode('{{ a | replace: "x" }}')).toBe('runtime');
        expect(errCode('{{ 1 | divided_by: 0 }}')).toBe('runtime');
        expect(errCode('{{ a + b }}')).toBe('syntax');
        expect(errCode('{{ }}')).toBe('syntax');
        expect(errCode('{% %}')).toBe('syntax');
        expect(errCode('{% raw %}x')).toBe('syntax');
        expect(errCode('{% comment %}x')).toBe('syntax');
        expect(errCode('{% assign x %}')).toBe('syntax');
        expect(errCode('{% for x y %}{% endfor %}')).toBe('syntax');
    });
    it('incluye linea y columna', () => {
        const res = renderLiquid('linea1\nlinea2 {% foo %}', {});
        expect(res.ok).toBe(false);
        if (!res.ok) { expect(res.error.line).toBe(2); expect(res.error.column).toBe(8); expect(res.error.message).toContain('línea 2'); }
    });
    it('filtros desconocidos se pueden permitir con strictFilters:false (passthrough no; error en runtime)', () => {
        const c = compileTemplate('{{ a | nope }}', { strictFilters: false });
        expect(() => c.render({ a: 'x' })).toThrow(LiquidError);
    });
    it('strictVariables', () => {
        expect(errCode('{{ falta }}', { a: '1' }, { strictVariables: true })).toBe('undefined_variable');
        expect(r('{{ falta | default: "ok" }}', {}, { strictVariables: true })).toBe('ok');
        expect(r('{{ a }}', { a: '' }, { strictVariables: true })).toBe('');
        expect(r('{% if falta %}x{% endif %}', {}, { strictVariables: true })).toBe('');
        expect(errCode('{{ u.x }}', { u: {} }, { strictVariables: true })).toBe('undefined_variable');
    });
    it('zona horaria invalida', () => {
        expect(errCode('x', {}, { timezone: 'No/Existe' })).toBe('runtime');
    });
    it('compile una vez, render muchas', () => {
        const c = compileTemplate('Hola {{ n }}');
        expect(c.render({ n: 'a' })).toBe('Hola a');
        expect(c.render({ n: 'b' })).toBe('Hola b');
    });
});

describe('filtros de texto', () => {
    it.each([
        ['{{ "hOLA mundo" | upcase }}', 'HOLA MUNDO'],
        ['{{ "HOLA" | downcase }}', 'hola'],
        ['{{ "hOLA MUNDO" | capitalize }}', 'Hola mundo'],
        ['[{{ "  a " | strip }}]', '[a]'],
        ['[{{ "  a " | lstrip }}]', '[a ]'],
        ['[{{ "  a " | rstrip }}]', '[  a]'],
        ['{{ "<b>hi</b> <!-- c -->x" | strip_html }}', 'hi x'],
        ['{{ "a < b" | strip_html }}', 'a < b'],
        ['{{ "a <b sin cerrar" | strip_html }}', 'a '],
        ['{{ "a\nb" | strip_newlines }}', 'ab'],
        ['{{ "a\nb" | newline_to_br }}', 'a<br />\nb'],
        ['{{ "<a href=\'x\'>&</a>" | escape }}', '&lt;a href=&#39;x&#39;&gt;&amp;&lt;/a&gt;'],
        ['{{ "&amp; <" | escape_once }}', '&amp; &lt;'],
        ['{{ "a b&c" | url_encode }}', 'a+b%26c'],
        ['{{ "a+b%26c" | url_decode }}', 'a b&c'],
        ['{{ "héllo" | base64_encode }}', 'aMOpbGxv'],
        ['{{ "aMOpbGxv" | base64_decode }}', 'héllo'],
        ['{{ "hello world" | truncate: 8 }}', 'hello...'],
        ['{{ "hello world" | truncate: 8, "!" }}', 'hello w!'],
        ['{{ "short" | truncate: 50 }}', 'short'],
        ['{{ "a b c d" | truncatewords: 2 }}', 'a b...'],
        ['{{ "a b c d" | truncatewords: 2, "" }}', 'a b'],
        ['{{ "a-b-c" | replace: "-", "+" }}', 'a+b+c'],
        ['{{ "a-b-c" | replace_first: "-", "+" }}', 'a+b-c'],
        ['{{ "a-b-c" | replace_last: "-", "+" }}', 'a-b+c'],
        ['{{ "a-b-c" | remove: "-" }}', 'abc'],
        ['{{ "a-b-c" | remove_first: "-" }}', 'ab-c'],
        ['{{ "a-b-c" | remove_last: "-" }}', 'a-bc'],
        ['{{ "b" | prepend: "a" }}{{ "b" | append: "c" }}', 'abbc'],
        ['{{ "hola" | size }}', '4'],
        ['{{ "hola" | first }}{{ "hola" | last }}', 'ha'],
        ['{{ "hola" | slice: 1, 2 }}', 'ol'],
        ['{{ "hola" | slice: -2 }}', 'l'],
        ['{{ "abc" | reverse }}', 'cba'],
        ['{{ "xxhixx" | strip: "x" }}', 'hi'],
        ['{{ "a" | json }}{{ 1 | json }}', '"a"1'],
    ])('%s', (tpl, out) => { expect(r(tpl)).toBe(out); });

    it('replace no explota con cadena vacia', () => {
        expect(r('{{ "abc" | replace: "", "x" }}')).toBe('abc');
    });
    it('encadenado con comillas y pipes dentro de cadenas', () => {
        expect(r('{{ "a|b" | append: "|c" | upcase }}')).toBe('A|B|C');
    });
    it('caracteres unicode en size/truncate', () => {
        expect(r('{{ "😀😀😀" | size }}')).toBe('3');
    });
});

describe('filtros numericos', () => {
    it.each([
        ['{{ -5 | abs }}', '5'],
        ['{{ "-5" | abs }}', '5'],
        ['{{ 1.2 | ceil }}{{ 1.8 | floor }}', '21'],
        ['{{ 1.5 | round }}{{ 2.5 | round }}', '23'],
        ['{{ -1.5 | round }}', '-2'],
        ['{{ 3.14159 | round: 2 }}', '3.14'],
        ['{{ 3.1 | fixed: 2 }}', '3.10'],
        ['{{ 4 | at_least: 5 }}{{ 4 | at_most: 3 }}', '53'],
        ['{{ 1 | plus: 2 }}{{ 5 | minus: 8 }}', '3-3'],
        ['{{ "10" | plus: "5" }}', '15'],
        ['{{ 0.1 | plus: 0.2 }}', '0.3'],
        ['{{ 3 | times: 4 }}', '12'],
        ['{{ 7 | divided_by: 2 }}', '3'],
        ['{{ 7 | divided_by: 2.5 }}', '2.8'],
        ['{{ "7.0" | divided_by: 2 }}', '3.5'],
        ['{{ -7 | divided_by: 2 }}', '-4'],
        ['{{ 7 | modulo: 3 }}{{ -1 | modulo: 3 }}', '12'],
        ['{{ 1 | plus: -1 }}', '0'],
        ['{{ "abc" | plus: 1 }}', '1'],
    ])('%s', (tpl, out) => { expect(r(tpl)).toBe(out); });

    it('argumentos pueden ser variables', () => {
        expect(r('{{ a | plus: b }}', { a: '2', b: '3' })).toBe('5');
        expect(r('{{ a | append: apellido }}', { a: 'Ana ', apellido: 'Paz' })).toBe('Ana Paz');
    });
});

describe('default', () => {
    it.each([
        ['{{ x | default: "d" }}', { x: '' }, 'd'],
        ['{{ x | default: "d" }}', { x: '   ' }, 'd'],
        ['{{ x | default: "d" }}', { x: 'null' }, 'd'],
        ['{{ x | default: "d" }}', { x: 'v' }, 'v'],
        ['{{ x | default: "d" }}', {}, 'd'],
        ['{{ x | default: 5 }}', {}, '5'],
        ['{{ x | default: "d" }}', { x: [] }, 'd'],
    ])('%s %j', (tpl, data, out) => { expect(r(tpl, data)).toBe(out); });
    it('allow_false', () => {
        expect(r('{{ x | default: "d", allow_false: true }}', { x: false })).toBe('false');
        expect(r('{{ x | default: "d" }}', { x: false })).toBe('d');
    });
});

describe('filtros de listas', () => {
    const d = { xs: ['b', 'a', 'c', 'a'], ns: ['10', '9', '1'], objs: [{ n: 'x', v: '3', k: true }, { n: 'y', v: '1', k: false }, { n: 'z', v: '2', k: true }] };
    it.each([
        ['{{ xs | join }}', 'b a c a'],
        ['{{ xs | join: "-" }}', 'b-a-c-a'],
        ['{{ xs | sort | join: "" }}', 'aabc'],
        ['{{ ns | sort | join: "," }}', '1,9,10'],
        ['{{ xs | uniq | join: "" }}', 'bac'],
        ['{{ xs | reverse | join: "" }}', 'acab'],
        ['{{ xs | first }}{{ xs | last }}{{ xs | size }}', 'ba4'],
        ['{{ ns | sum }}', '20'],
        ['{{ ns | min }}{{ ns | max }}', '110'],
        ['{{ "a,b,,c,," | split: "," | join: "|" }}', 'a|b||c'],
        ['{{ "abc" | split: "" | join: "-" }}', 'a-b-c'],
        ['{{ xs | slice: 1, 2 | join: "" }}', 'ac'],
        ['{{ xs | concat: ns | size }}', '7'],
        ['{{ objs | map: "n" | join: "" }}', 'xyz'],
        ['{{ objs | where: "k" | map: "n" | join: "" }}', 'xz'],
        ['{{ objs | where: "v", "1" | map: "n" | join: "" }}', 'y'],
        ['{{ objs | reject: "k" | map: "n" | join: "" }}', 'y'],
        ['{{ objs | sort: "v" | map: "n" | join: "" }}', 'yzx'],
        ['{{ objs | sum: "v" }}', '6'],
        ['{{ objs | max: "v" | map: "n" }}', 'x'],
        ['{{ "B,a,C" | split: "," | sort_natural | join: "" }}', 'aBC'],
        ['{{ ",a,,b" | split: "," | compact | join: "" }}', 'ab'],
    ])('%s', (tpl, out) => { expect(r(tpl, d)).toBe(out); });

    it('flatten y push', () => {
        expect(r('{{ n | flatten | join: "" }}', { n: [['a', ['b']], 'c'] })).toBe('abc');
        expect(r('{{ xs | push: "z" | join: "" }}', { xs: ['a'] })).toBe('az');
    });
    it('sort no muta el origen', () => {
        const xs = ['b', 'a'];
        r('{{ xs | sort }}', { xs });
        expect(xs).toEqual(['b', 'a']);
    });
});

describe('tags de control', () => {
    it('if / elsif / else', () => {
        const t = '{% if n == 1 %}uno{% elsif n == 2 %}dos{% else %}otro{% endif %}';
        expect(r(t, { n: '1' })).toBe('uno');
        expect(r(t, { n: '2' })).toBe('dos');
        expect(r(t, { n: '3' })).toBe('otro');
    });
    it('truthiness de celdas de CSV', () => {
        const t = '{% if x %}T{% else %}F{% endif %}';
        expect(r(t, { x: 'algo' })).toBe('T');
        expect(r(t, { x: '' })).toBe('F');
        expect(r(t, { x: 'false' })).toBe('F');
        expect(r(t, { x: 'nil' })).toBe('F');
        expect(r(t, {})).toBe('F');
        expect(r(t, { x: '0' })).toBe('T');
        expect(r(t, { x: 0 })).toBe('T');
    });
    it('operadores de comparacion', () => {
        expect(r('{% if a == "x" %}1{% endif %}{% if a != "y" %}2{% endif %}{% if a <> "y" %}3{% endif %}', { a: 'x' })).toBe('123');
        expect(r('{% if n > 5 %}a{% endif %}{% if n >= 10 %}b{% endif %}{% if n < 11 %}c{% endif %}{% if n <= 9 %}d{% endif %}', { n: '10' })).toBe('abc');
    });
    it('comparacion numerica vs cadena', () => {
        expect(r('{% if n == 30 %}y{% endif %}', { n: '30' })).toBe('y');
        expect(r('{% if a == b %}y{% endif %}', { a: '007', b: '7' })).toBe('');
        expect(r('{% if a > b %}y{% else %}n{% endif %}', { a: 'zzz', b: 'aaa' })).toBe('n');
        expect(r('{% if a < b %}y{% endif %}', { a: '2024-01-05', b: '2024-02-01' })).toBe('y');
    });
    it('contains es sensible a mayusculas, en strings y arrays', () => {
        expect(r('{% if c contains "Dir" %}y{% else %}n{% endif %}', { c: 'Director' })).toBe('y');
        expect(r('{% if c contains "dir" %}y{% else %}n{% endif %}', { c: 'Director' })).toBe('n');
        expect(r('{% if xs contains "b" %}y{% endif %}', { xs: ['a', 'b'] })).toBe('y');
    });
    it('and / or evaluan de derecha a izquierda (Liquid)', () => {
        // true or (false and false) => true
        expect(r('{% if a or b and c %}y{% else %}n{% endif %}', { a: '1', b: '', c: '' })).toBe('y');
        // (a and b) or c evaluado como a and (b or c): false and (...) => false
        expect(r('{% if a and b or c %}y{% else %}n{% endif %}', { a: '', b: '', c: '1' })).toBe('n');
        expect(r('{% if a and b %}y{% else %}n{% endif %}', { a: '1', b: '1' })).toBe('y');
    });
    it('comillas con and/or dentro del literal', () => {
        expect(r('{% if t == "a and b" %}y{% endif %}', { t: 'a and b' })).toBe('y');
    });
    it('nil, blank, empty, true, false', () => {
        expect(r('{% if x == nil %}1{% endif %}{% if x == blank %}2{% endif %}{% if x == empty %}3{% endif %}', { x: '' })).toBe('123');
        expect(r('{% if x != blank %}1{% endif %}', { x: 'a' })).toBe('1');
        expect(r('{% if true %}1{% endif %}{% if false %}2{% endif %}')).toBe('1');
    });
    it('unless con else y elsif', () => {
        expect(r('{% unless x %}A{% else %}B{% endunless %}', { x: '' })).toBe('A');
        expect(r('{% unless x %}A{% else %}B{% endunless %}', { x: '1' })).toBe('B');
    });
    it('case / when con coma, or y else', () => {
        const t = '{% case p %}{% when "a", "b" %}AB{% when "c" or "d" %}CD{% else %}Z{% endcase %}';
        expect(r(t, { p: 'a' })).toBe('AB');
        expect(r(t, { p: 'b' })).toBe('AB');
        expect(r(t, { p: 'd' })).toBe('CD');
        expect(r(t, { p: 'q' })).toBe('Z');
        expect(r('{% case n %}{% when 1 %}uno{% endcase %}', { n: '1' })).toBe('uno');
    });
    it('assign y capture', () => {
        expect(r('{% assign x = "a" | upcase %}{{ x }}')).toBe('A');
        expect(r('{% assign n = a | plus: 1 %}{{ n }}', { a: '4' })).toBe('5');
        expect(r('{% capture c %}<{{ a }}>{% endcapture %}[{{ c }}]', { a: 'x' })).toBe('[<x>]');
    });
    it('assign dentro de for persiste fuera', () => {
        expect(r('{% for i in (1..3) %}{% assign last = i %}{% endfor %}{{ last }}')).toBe('3');
    });
    it('echo', () => {
        expect(r('{% echo a | upcase %}', { a: 'x' })).toBe('X');
    });
    it('comment (y anidados) y raw', () => {
        expect(r('a{% comment %}{{ x }}{% comment %}y{% endcomment %}z{% endcomment %}b')).toBe('ab');
        expect(r('{% raw %}{{ a }} {% if %}{% endraw %}!', { a: 'x' })).toBe('{{ a }} {% if %}!');
    });
    it('increment / decrement / cycle', () => {
        expect(r('{% increment c %}{% increment c %}{% decrement d %}')).toBe('01-1');
        expect(r('{% for i in (1..4) %}{% cycle "a", "b" %}{% endfor %}')).toBe('abab');
        expect(r('{% cycle "g": "x", "y" %}{% cycle "g": "x", "y" %}{% cycle "g": "x", "y" %}')).toBe('xyx');
    });
    it('tags en mayusculas se normalizan', () => {
        expect(r('{% IF a %}x{% ENDIF %}', { a: '1' })).toBe('x');
    });
});

describe('for', () => {
    it('itera arrays, rangos y variables como limites', () => {
        expect(r('{% for x in xs %}{{ x }}{% endfor %}', { xs: ['a', 'b'] })).toBe('ab');
        expect(r('{% for i in (1..3) %}{{ i }}{% endfor %}')).toBe('123');
        expect(r('{% for i in (3..1) %}{{ i }}{% endfor %}')).toBe('321');
        expect(r('{% for i in (1..n) %}{{ i }}{% endfor %}', { n: '2' })).toBe('12');
    });
    it('limit, offset, reversed (tambien con variable)', () => {
        const d = { xs: ['a', 'b', 'c', 'd'], n: '2' };
        expect(r('{% for x in xs limit: 2 %}{{ x }}{% endfor %}', d)).toBe('ab');
        expect(r('{% for x in xs offset: 1 limit: n %}{{ x }}{% endfor %}', d)).toBe('bc');
        expect(r('{% for x in xs reversed %}{{ x }}{% endfor %}', d)).toBe('dcba');
    });
    it('else cuando esta vacio', () => {
        expect(r('{% for x in xs %}a{% else %}vacio{% endfor %}', { xs: [] })).toBe('vacio');
        expect(r('{% for x in xs %}a{% else %}vacio{% endfor %}')).toBe('vacio');
    });
    it('forloop.*', () => {
        expect(r('{% for x in xs %}{{ forloop.index }}{{ forloop.index0 }}{{ forloop.rindex }}{{ forloop.rindex0 }}{% if forloop.first %}F{% endif %}{% if forloop.last %}L{% endif %}{{ forloop.length }},{% endfor %}', { xs: ['a', 'b'] }))
            .toBe('1021F2,2110L2,');
    });
    it('forloop.parentloop', () => {
        expect(r('{% for a in (1..2) %}{% for b in (1..2) %}{{ forloop.parentloop.index }}{{ forloop.index }} {% endfor %}{% endfor %}')).toBe('11 12 21 22 ');
    });
    it('break y continue, tambien a traves de if y case', () => {
        expect(r('{% for i in (1..5) %}{% if i == 3 %}{% break %}{% endif %}{{ i }}{% endfor %}')).toBe('12');
        expect(r('{% for i in (1..5) %}{% if i == 3 %}{% continue %}{% endif %}{{ i }}{% endfor %}')).toBe('1245');
        expect(r('{% for i in (1..5) %}{% case i %}{% when 3 %}{% break %}{% endcase %}{{ i }}{% endfor %}')).toBe('12');
        expect(r('{% for i in (1..3) %}{% unless i == 2 %}{{ i }}{% else %}{% continue %}{% endunless %}{% endfor %}')).toBe('13');
    });
    it('break solo corta el bucle interno', () => {
        expect(r('{% for a in (1..2) %}{% for b in (1..3) %}{% if b == 2 %}{% break %}{% endif %}{{ a }}{{ b }} {% endfor %}{% endfor %}')).toBe('11 21 ');
    });
    it('la variable del bucle no se filtra al ambito exterior', () => {
        expect(r('{% for x in xs %}{% endfor %}[{{ x }}]', { xs: ['a'] })).toBe('[]');
    });
    it('cadena no vacia se itera como un elemento', () => {
        expect(r('{% for x in s %}[{{ x }}]{% endfor %}', { s: 'hola' })).toBe('[hola]');
    });
});

describe('control de espacios', () => {
    it('{{- y -}}', () => {
        expect(r('a   {{- "b" -}}   c')).toBe('abc');
        expect(r('a  \n {%- if true -%}  x  {%- endif -%}  \n b')).toBe('axb');
    });
    it('sin guiones se conservan', () => {
        expect(r('a {{ "b" }} c')).toBe('a b c');
    });
    it('raw con control de espacios', () => {
        expect(r('a {%- raw -%} {{ x }} {%- endraw -%} b')).toBe('a{{ x }}b');
    });
});

describe('limites', () => {
    it('rango gigante', () => {
        expect(errCode('{% for i in (1..999999999) %}{% endfor %}')).toBe('limit_range');
    });
    it('bucles anidados exceden presupuesto de iteraciones', () => {
        expect(errCode('{% for a in (1..1000) %}{% for b in (1..1000) %}{% endfor %}{% endfor %}')).toBe('limit_iterations');
    });
    it('maxIterations configurable', () => {
        expect(errCode('{% for a in (1..10) %}{% endfor %}', {}, { maxIterations: 5 })).toBe('limit_iterations');
    });
    it('salida excesiva', () => {
        expect(errCode('{% for i in (1..1000) %}{{ x }}{% endfor %}', { x: 'a'.repeat(10_000) }, { maxOutputLength: 50_000 })).toBe('limit_output');
    });
    it('crecimiento de cadenas con append/assign', () => {
        const tpl = '{% assign s = "aaaaaaaaaa" %}{% for i in (1..40) %}{% assign s = s | append: s %}{% endfor %}';
        expect(errCode(tpl, {}, { maxOutputLength: 100_000 })).toBe('limit_output');
    });
    it('replace que multiplica el tamaño se corta antes de asignar', () => {
        expect(errCode('{{ s | replace: "a", big }}', { s: 'a'.repeat(1000), big: 'b'.repeat(5000) }, { maxOutputLength: 100_000 })).toBe('limit_output');
    });
    it('plantilla demasiado grande', () => {
        expect(() => compileTemplate('a'.repeat(101), { maxTemplateLength: 100 })).toThrow(/máximo/);
        const res = renderLiquid('a'.repeat(101), {}, { maxTemplateLength: 100 });
        expect(res.ok === false && res.error.code).toBe('limit_template');
    });
    it('anidamiento excesivo', () => {
        const t = '{% if a %}'.repeat(40) + 'x' + '{% endif %}'.repeat(40);
        expect(errCode(t, { a: '1' })).toBe('limit_depth');
        const ok = '{% if a %}'.repeat(10) + 'x' + '{% endif %}'.repeat(10);
        expect(r(ok, { a: '1' })).toBe('x');
    });
    it('corchetes anidados en exceso', () => {
        expect(errCode('{{ a' + '[a'.repeat(30) + ']'.repeat(30) + ' }}', {})).toBe('limit_depth');
    });
    it('timeout (deadline)', () => {
        // Muchas operaciones baratas: con timeout 0 debe cortar por tiempo al comprobar el deadline.
        const tpl = '{% for i in (1..10000) %}{% for j in (1..9) %}{{ i | plus: j }}{% endfor %}{% endfor %}';
        expect(errCode(tpl, {}, { timeoutMs: -1, maxIterations: 1e9 })).toBe('limit_time');
    });
    it('errores de limite no devuelven salida parcial', () => {
        const res = renderLiquid('hola {% for i in (1..99999999) %}{% endfor %}', {});
        expect(res.ok).toBe(false);
    });
});

describe('autoescape', () => {
    const o: RenderOptions = { autoescape: true };
    it('escapa por defecto los valores', () => {
        expect(r('{{ x }}', { x: '<img src=x onerror=alert(1)>' }, o)).toBe('&lt;img src=x onerror=alert(1)&gt;');
        expect(r('{{ x }}', { x: '"a" & \'b\'' }, o)).toBe('&quot;a&quot; &amp; &#39;b&#39;');
    });
    it('no toca el HTML literal de la plantilla', () => {
        expect(r('<b>{{ x }}</b>', { x: 'a<' }, o)).toBe('<b>a&lt;</b>');
    });
    it('| raw desactiva el escape', () => {
        expect(r('{{ x | raw }}', { x: '<b>ok</b>' }, o)).toBe('<b>ok</b>');
    });
    it('| escape no escapa dos veces', () => {
        expect(r('{{ x | escape }}', { x: '<' }, o)).toBe('&lt;');
        expect(r('{{ x | escape_once }}', { x: '&amp; <' }, o)).toBe('&amp; &lt;');
    });
    it('sin autoescape, escape sigue funcionando', () => {
        expect(r('{{ x | escape }}', { x: '<' })).toBe('&lt;');
    });
    it('capture es seguro (ya escapado internamente)', () => {
        expect(r('{% capture c %}<i>{{ x }}</i>{% endcapture %}{{ c }}', { x: '<' }, o)).toBe('<i>&lt;</i>');
    });
    it('newline_to_br escapa primero en autoescape', () => {
        expect(r('{{ x | newline_to_br }}', { x: '<a>\nb' }, o)).toBe('&lt;a&gt;<br />\nb');
    });
    it('valores de arrays se escapan', () => {
        expect(r('{{ xs }}', { xs: ['<a>', 'b'] }, o)).toBe('&lt;a&gt;b');
    });
    it('filtros como join producen texto que se escapa al final', () => {
        expect(r('{{ xs | join: "," }}', { xs: ['<a>', 'b'] }, o)).toBe('&lt;a&gt;,b');
    });
    it('un filtro tras escape pierde el marcado seguro (se vuelve a escapar, nunca inseguro)', () => {
        expect(r('{{ x | escape | append: y }}', { x: 'a', y: '<script>' }, o)).toBe('a&lt;script&gt;');
    });
    it('literales de la plantilla dentro de {{ }} tambien se escapan (comportamiento uniforme)', () => {
        expect(r('{{ "<b>" }}', {}, o)).toBe('&lt;b&gt;');
        expect(r('{{ "<b>" | raw }}', {}, o)).toBe('<b>');
    });
    it('numeros y booleanos', () => {
        expect(r('{{ 1 | plus: 1 }}{{ true }}', {}, o)).toBe('2true');
    });
});

describe('fechas', () => {
    it('YYYY-MM-DD sin desfase de zona horaria (UTC-5)', () => {
        for (const tz of ['UTC', 'America/Lima', 'Pacific/Auckland', 'America/Los_Angeles']) {
            expect(r('{{ "2024-01-15" | date: "%Y-%m-%d %A" }}', {}, { timezone: tz })).toBe('2024-01-15 Monday');
        }
    });
    it('formatos comunes', () => {
        const d = { d: '2024-03-05' };
        expect(r('{{ d | date: "%d/%m/%Y" }}', d)).toBe('05/03/2024');
        expect(r('{{ d | date: "%-d/%-m/%y" }}', d)).toBe('5/3/24');
        expect(r('{{ d | date: "%B %e, %Y" }}', d)).toBe('March  5, 2024');
        expect(r('{{ d | date: "%b %a %j %u %w" }}', d)).toBe('Mar Tue 065 2 2');
        expect(r('{{ d | date: "%F|%D|%%" }}', d)).toBe('2024-03-05|03/05/24|%');
        expect(r('{{ d | date: "%^B %^a" }}', d)).toBe('MARCH TUE');
    });
    it('fecha con hora sin zona = hora de pared', () => {
        expect(r('{{ "2024-01-15 08:05:09" | date: "%H:%M:%S %I:%M %p" }}', {}, { timezone: 'America/Lima' })).toBe('08:05:09 08:05 AM');
        expect(r('{{ "2024-01-15T23:30:00" | date: "%d %H" }}', {})).toBe('15 23');
        expect(r('{{ "2024-01-15 00:10" | date: "%I %l %p" }}', {})).toBe('12 12 AM');
    });
    it('timestamp con offset/Z se convierte a la zona indicada', () => {
        expect(r('{{ "2024-01-15T02:00:00Z" | date: "%Y-%m-%d %H:%M %z" }}', {}, { timezone: 'America/Lima' })).toBe('2024-01-14 21:00 -0500');
        expect(r('{{ "2024-01-15T02:00:00-05:00" | date: "%Y-%m-%d %H:%M" }}', {}, { timezone: 'UTC' })).toBe('2024-01-15 07:00');
    });
    it('now / today usan la zona pedida', () => {
        expect(r('{{ now | date: "%Y-%m-%d %H" }}', {}, { timezone: 'UTC' })).toBe('2025-01-15 12');
        expect(r('{{ "now" | date: "%H" }}', {}, { timezone: 'America/Lima' })).toBe('07');
        expect(r('{{ today | date: "%d" }}', {}, { timezone: 'Pacific/Auckland' })).toBe('16');
    });
    it('now sin filtro imprime una fecha, no "now"', () => {
        expect(r('{{ now }}', {}, { timezone: 'UTC' })).toBe('2025-01-15 12:00:00');
    });
    it('DD/MM/YYYY (dia primero) y heuristica para mm/dd claro', () => {
        expect(r('{{ "05/03/2024" | date: "%Y-%m-%d" }}')).toBe('2024-03-05');
        expect(r('{{ "03/25/2024" | date: "%Y-%m-%d" }}')).toBe('2024-03-25');
        expect(r('{{ "15-01-2024" | date: "%Y-%m-%d" }}')).toBe('2024-01-15');
    });
    it('epoch en segundos y milisegundos', () => {
        expect(r('{{ 1705276800 | date: "%Y-%m-%d" }}', {}, { timezone: 'UTC' })).toBe('2024-01-15');
        expect(r('{{ "1705276800000" | date: "%Y-%m-%d" }}', {}, { timezone: 'UTC' })).toBe('2024-01-15');
        expect(r('{{ "2024-01-15" | date: "%s" }}')).toBe('1705276800');
    });
    it('Date de JS (p.ej. celdas de Excel) se convierte a la zona', () => {
        expect(r('{{ d | date: "%Y-%m-%d" }}', { d: new Date('2024-01-15T00:00:00Z') }, { timezone: 'UTC' })).toBe('2024-01-15');
    });
    it('fechas invalidas devuelven el valor original', () => {
        expect(r('{{ "2024-02-31" | date: "%Y" }}')).toBe('2024-02-31');
        expect(r('{{ "hola" | date: "%Y" }}')).toBe('hola');
        expect(r('{{ "" | date: "%Y" }}')).toBe('');
        expect(r('{{ "2024-13-01" | date: "%Y" }}')).toBe('2024-13-01');
    });
    it('anio bisiesto', () => {
        expect(r('{{ "2024-02-29" | date: "%j" }}')).toBe('060');
        expect(r('{{ "2023-02-29" | date: "%j" }}')).toBe('2023-02-29');
    });
    it('locale es', () => {
        expect(r('{{ "2024-03-05" | date: "%A %-d de %B" }}', {}, { locale: 'es' })).toBe('martes 5 de marzo');
    });
    it('systemDateVars', () => {
        const v = systemDateVars(NOW, 'America/Lima', 'es');
        expect(v).toEqual({ current_date: '15 de enero de 2025', current_day: 'miércoles', current_month: 'enero', current_year: '2025' });
        const en = systemDateVars(new Date('2025-01-01T02:00:00Z'), 'America/Lima', 'en');
        expect(en.current_year).toBe('2024');
        expect(en.current_date).toBe('December 31, 2024');
    });
});

describe('validateTemplate (lint)', () => {
    it('plantilla valida sin diagnosticos', () => {
        expect(validateTemplate('Hola {{ a | upcase }}{% if b %}x{% endif %}')).toEqual([]);
    });
    it('reporta errores de sintaxis con rango', () => {
        const src = 'Hola {% if a %} sin cerrar';
        const d = validateTemplate(src);
        expect(d).toHaveLength(1);
        expect(d[0].severity).toBe('error');
        expect(src.slice(d[0].from, d[0].to)).toBe('{% if a %}');
    });
    it('reporta filtros y tags desconocidos', () => {
        expect(validateTemplate('{{ a | zzz }}')[0].code).toBe('unknown_filter');
        expect(validateTemplate('{% zzz %}')[0].code).toBe('unknown_tag');
    });
    it('advierte de variables desconocidas, sin contar assign/for/capture/forloop', () => {
        const d = validateTemplate('{% assign y = 1 %}{% for i in xs %}{{ i }}{{ y }}{{ forloop.index }}{% endfor %}{{ nombre }}{{ falta }}',
            { knownVariables: ['xs', 'nombre'] });
        expect(d.map(x => x.message)).toEqual(['Variable "falta" no existe en los datos']);
        expect(d[0].severity).toBe('warning');
    });
    it('variables con espacios', () => {
        expect(validateTemplate('{{ Nombre completo }}', { knownVariables: ['Nombre completo'] })).toEqual([]);
    });
});

describe('catalogo', () => {
    it('incluye filtros clave', () => {
        for (const f of ['upcase', 'date', 'default', 'escape', 'raw', 'map', 'where', 'split', 'join']) expect(LIQUID_FILTER_NAMES).toContain(f);
    });
});

describe('robustez', () => {
    it('entrada no string / undefined', () => {
        expect(r(undefined as unknown as string)).toBe('');
        expect(r('{{ a }}', { a: 5 as unknown as string })).toBe('5');
        expect(r('{{ a | upcase }}', { a: null as unknown as string })).toBe('');
    });
    it('datos con claves peligrosas no rompen', () => {
        const data = JSON.parse('{"__proto__": {"x": "1"}, "a": "ok"}');
        expect(r('{{ a }}{{ x }}', data)).toBe('ok');
        expect(({} as Record<string, unknown>).x).toBeUndefined();
    });
    it('HTML de correo tipico con CSS entre llaves simples', () => {
        expect(r('<style>a{color:red}</style>{{ a }}', { a: 'x' })).toBe('<style>a{color:red}</style>x');
    });
    it('llaves sueltas no son etiquetas', () => {
        expect(r('{ a } } { %', {})).toBe('{ a } } { %');
    });
});
