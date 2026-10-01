import { describe, expect, it } from 'vitest';
import { MAX_LINE_BYTES, ParseError, extractGlobals, matchCommand, parseArgs, quoteArg, tokenize } from '../parser';
import type { CommandDef } from '../types';
import { splitPartial } from '../complete';

const L = (s: string) => ({ es: s, en: s });
const cmd = (name: string, extra: Partial<CommandDef> = {}): CommandDef => ({ name, summary: L(name), risk: 'read', handler: async () => ({ type: 'text', text: '' }), ...extra });

describe('tokenize', () => {
    it('divide por espacios y respeta comillas', () => {
        expect(tokenize('users list --q "ana perez"')).toEqual(['users', 'list', '--q', 'ana perez']);
        expect(tokenize("a 'b  c' d")).toEqual(['a', 'b  c', 'd']);
        expect(tokenize('  a   b  ')).toEqual(['a', 'b']);
        expect(tokenize('')).toEqual([]);
    });
    it('escapes: dentro de comillas dobles y fuera', () => {
        expect(tokenize('say "he said \\"hi\\""')).toEqual(['say', 'he said "hi"']);
        expect(tokenize('a\\ b c')).toEqual(['a b', 'c']);
        expect(tokenize('"tab\\there"')).toEqual(['tab\there']);
        expect(tokenize("'no \\n escape'")).toEqual(['no \\n escape']);
    });
    it('une comillas adyacentes y admite cadena vacia', () => {
        expect(tokenize('a"b"\'c\'')).toEqual(['abc']);
        expect(tokenize('x "" y')).toEqual(['x', '', 'y']);
    });
    it('NO es un shell: no expande ni interpreta $, |, ;, `, *', () => {
        expect(tokenize('echo $HOME | rm -rf / ; `id` *')).toEqual(['echo', '$HOME', '|', 'rm', '-rf', '/', ';', '`id`', '*']);
    });
    it('errores: comilla sin cerrar, escape final, caracteres de control, linea larga', () => {
        expect(() => tokenize('a "b')).toThrow(ParseError);
        expect(() => tokenize("a 'b")).toThrow(/Unterminated/);
        expect(() => tokenize('a\\')).toThrow(/Dangling/);
        expect(() => tokenize('a\u0000b')).toThrow(/Control/);
        expect(() => tokenize('x'.repeat(MAX_LINE_BYTES + 1))).toThrow(/exceeds/);
        expect(tokenize('x'.repeat(MAX_LINE_BYTES)).length).toBe(1);
    });
    it('quoteArg ida y vuelta', () => {
        for (const s of ['plain', 'with space', 'q"uote', 'back\\slash', 'multi\nline', '', "it's"]) expect(tokenize(quoteArg(s))).toEqual([s]);
    });
});

describe('extractGlobals / matchCommand', () => {
    it('extrae --json, --yes, -y, --help en cualquier posicion (hasta --)', () => {
        const r = extractGlobals(['users', '--json', 'list', '-y', '--', '--yes']);
        expect(r.globals).toEqual({ json: true, yes: true, help: false });
        expect(r.rest).toEqual(['users', 'list', '--', '--yes']);
    });
    it('elige el comando mas largo', () => {
        const cs = [cmd('users'), cmd('users sessions'), cmd('users sessions revoke')];
        expect(matchCommand(cs, ['users', 'sessions', 'revoke', 'a'])?.def.name).toBe('users sessions revoke');
        expect(matchCommand(cs, ['users', 'sessions', 'a'])?.def.name).toBe('users sessions');
        expect(matchCommand(cs, ['users', 'sessions', 'a'])?.rest).toEqual(['a']);
        expect(matchCommand(cs, ['nope'])).toBeNull();
    });
});

describe('parseArgs', () => {
    const def = cmd('x', {
        positionals: [{ name: 'a', description: L('a'), required: true }, { name: 'b', description: L('b'), required: false }],
        flags: [
            { name: 'name', alias: 'n', type: 'string', description: L('') },
            { name: 'count', type: 'number', min: 1, max: 10, description: L('') },
            { name: 'on', type: 'boolean', description: L('') },
            { name: 'mode', type: 'enum', values: ['a', 'b'], description: L('') },
            { name: 'ids', type: 'list', description: L('') },
            { name: 'cfg', type: 'json', description: L('') },
            { name: 'must', type: 'string', required: true, description: L('') },
        ],
    });
    const ok = (argv: string[]) => parseArgs(def, ['--must', 'm', ...argv]);

    it('tipos: string, number, boolean, enum, list, json', () => {
        const r = ok(['p', '--name=Ana', '--count', '3', '--on', '--mode', 'b', '--ids', 'x,y', '--ids', 'z', '--cfg', '{"a":1}']);
        expect(r.positionals).toEqual(['p']);
        expect(r.flags).toMatchObject({ name: 'Ana', count: 3, on: true, mode: 'b', ids: ['x', 'y', 'z'], cfg: { a: 1 }, must: 'm' });
    });
    it('alias, --no-flag y booleano con valor explicito', () => {
        expect(ok(['p', '-n', 'Bob']).flags.name).toBe('Bob');
        expect(ok(['p', '--no-on']).flags.on).toBe(false);
        expect(ok(['p', '--on', 'false']).flags.on).toBe(false);
        expect(ok(['p', '--on=true']).flags.on).toBe(true);
    });
    it('`--` fuerza posicionales; numeros negativos son posicionales', () => {
        expect(ok(['--', '--raw', 'q']).positionals).toEqual(['--raw', 'q']);
        expect(ok(['-5']).positionals).toEqual(['-5']);
    });
    it('errores: bandera desconocida, valor ausente, tipo y rango invalidos, enum, json', () => {
        expect(() => ok(['p', '--nope'])).toThrow(/Unknown flag/);
        expect(() => ok(['p', '--domain', 'other.com'])).toThrow(/Unknown flag/); // nunca se acepta un dominio por bandera
        expect(() => ok(['p', '--name'])).toThrow(/needs a value/);
        expect(() => ok(['p', '--count', 'abc'])).toThrow(/expects a number/);
        expect(() => ok(['p', '--count', '99'])).toThrow(/<= 10/);
        expect(() => ok(['p', '--count', '0'])).toThrow(/>= 1/);
        expect(() => ok(['p', '--mode', 'zzz'])).toThrow(/one of/);
        expect(() => ok(['p', '--cfg', '{bad'])).toThrow(/valid JSON/);
        expect(() => ok(['p', '--on=maybe'])).toThrow(/true or false/);
    });
    it('errores: faltan posicionales o banderas obligatorias, sobran argumentos', () => {
        expect(() => parseArgs(def, ['--must', 'm'])).toThrow(/Missing argument <a>/);
        expect(() => parseArgs(def, ['p'])).toThrow(/Missing required flag --must/);
        expect(() => ok(['p', 'q', 'r'])).toThrow(/Too many arguments/);
    });
    it('no filtra el valor recibido en el mensaje de bandera desconocida', () => {
        try { ok(['p', `--${'z'.repeat(200)}`]); } catch (e) { expect((e as Error).message.length).toBeLessThan(120); }
    });
    it('variadicos y valores permitidos', () => {
        const v = cmd('v', { positionals: [{ name: 'act', description: L(''), values: ['a', 'b'] }, { name: 'ids', description: L(''), variadic: true, required: false }] });
        expect(parseArgs(v, ['a', '1', '2', '3']).positionals).toEqual(['a', '1', '2', '3']);
        expect(() => parseArgs(v, ['c'])).toThrow(/one of/);
    });
});

describe('splitPartial (autocompletado)', () => {
    it('separa palabras completas y token en curso', () => {
        expect(splitPartial('users sh')).toEqual({ done: ['users'], current: 'sh', open: false });
        expect(splitPartial('users ')).toEqual({ done: ['users'], current: '', open: false });
        expect(splitPartial('users list --q "an')).toEqual({ done: ['users', 'list', '--q'], current: 'an', open: true });
    });
});
