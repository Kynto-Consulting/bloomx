import { describe, expect, it } from 'vitest';
import { fieldRules, isEmptyValue, isValidEmail, isValidUrl, validateFields, validateValue } from '../form-rules';

const EN = {
    required: 'This field is required', minLength: 'At least {n} characters', maxLength: 'At most {n} characters', min: 'Must be at least {n}', max: 'Must be at most {n}',
    minItems: 'Choose at least {n}', maxItems: 'Choose at most {n}', pattern: 'The format is not valid', email: 'Enter a valid email', url: 'Enter a valid URL',
};

describe('isEmptyValue', () => {
    it.each([[undefined], [null], [''], ['   '], [[]], [false], [NaN]])('%j es vacio', (v) => expect(isEmptyValue(v)).toBe(true));
    it.each([[0], ['a'], [true], [['x']], [{}]])('%j no es vacio', (v) => expect(isEmptyValue(v)).toBe(false));
});

describe('required', () => {
    it('falla con vacios y pasa con valor', () => {
        expect(validateValue('', { required: true })).toBe('Este campo es obligatorio');
        expect(validateValue(null, { required: true })).not.toBeNull();
        expect(validateValue([], { required: true })).not.toBeNull();
        expect(validateValue(false, { required: true })).not.toBeNull();
        expect(validateValue(true, { required: true })).toBeNull();
        expect(validateValue(0, { required: true })).toBeNull();
        expect(validateValue('x', { required: true })).toBeNull();
    });
    it('sin required, un vacio no dispara otras reglas', () => {
        expect(validateValue('', { minLength: 5, email: true, pattern: '^a' })).toBeNull();
        expect(validateValue([], { minItems: 2 })).toBeNull();
    });
    it('en ingles', () => expect(validateValue('', { required: true }, { strings: EN })).toBe('This field is required'));
});

describe('longitud', () => {
    it('minLength / maxLength', () => {
        expect(validateValue('ab', { minLength: 3 })).toBe('Minimo 3 caracteres');
        expect(validateValue('abc', { minLength: 3 })).toBeNull();
        expect(validateValue('abcd', { maxLength: 3 }, { strings: EN })).toBe('At most 3 characters');
        expect(validateValue('abc', { maxLength: 3 })).toBeNull();
    });
});

describe('min / max', () => {
    it('numeros y cadenas numericas', () => {
        expect(validateValue(2, { min: 3 })).toBe('Debe ser al menos 3');
        expect(validateValue(3, { min: 3 })).toBeNull();
        expect(validateValue(11, { max: 10 })).toBe('Debe ser como maximo 10');
        expect(validateValue('11', { max: 10 })).not.toBeNull();
        expect(validateValue(0, { min: -1, max: 1 })).toBeNull();
    });
    it('un texto no numerico no se evalua', () => expect(validateValue('abc', { min: 5 })).toBeNull());
});

describe('minItems / maxItems', () => {
    it('listas', () => {
        expect(validateValue(['a'], { minItems: 2 })).toBe('Elige al menos 2');
        expect(validateValue(['a', 'b'], { minItems: 2 })).toBeNull();
        expect(validateValue(['a', 'b', 'c'], { maxItems: 2 })).toBe('Elige como maximo 2');
        expect(validateValue(['a', 'b'], { maxItems: 2 })).toBeNull();
    });
});

describe('pattern', () => {
    it('cumple / no cumple', () => {
        expect(validateValue('abc123', { pattern: '^[a-z]+\\d+$' })).toBeNull();
        expect(validateValue('123abc', { pattern: '^[a-z]+\\d+$' })).toBe('El formato no es valido');
    });
    it('patron invalido se ignora', () => {
        expect(validateValue('x', { pattern: '([' })).toBeNull();
        expect(validateValue('x', { pattern: 5 as unknown as string })).toBeNull();
        expect(validateValue('x', { pattern: 'a'.repeat(600) })).toBeNull();
    });
    it('entrada enorme no se evalua con la regex (falla rapido)', () => {
        const start = Date.now();
        expect(validateValue('a'.repeat(50_000) + '!', { pattern: '^a+$' })).toBe('El formato no es valido');
        expect(Date.now() - start).toBeLessThan(500);
    });
    it('patron con cuantificadores anidados (ReDoS) se ignora y termina al instante', () => {
        const start = Date.now();
        for (const pattern of ['^(a+)+$', '^(.*)*$', '^(\\w+){2,}$']) expect(validateValue('a'.repeat(40) + '!', { pattern })).toBeNull();
        expect(Date.now() - start).toBeLessThan(500);
    });
});

describe('email / url', () => {
    it('email', () => {
        for (const ok of ['a@b.co', 'nombre.apellido+tag@dominio.com', 'x@sub.dominio.org']) expect(isValidEmail(ok), ok).toBe(true);
        for (const bad of ['', 'a', 'a@b', 'a@b.', '@b.com', 'a b@c.com', 'a@@b.com', 'a@b..com', 'Juan <a@b.com>', 'a@b.c', `${'a'.repeat(250)}@b.com`]) expect(isValidEmail(bad), bad).toBe(false);
        expect(validateValue('mal', { email: true })).toBe('Escribe un correo valido');
        expect(validateValue('a@b.com', { email: true })).toBeNull();
    });
    it('email en listas valida cada elemento', () => {
        expect(validateValue(['a@b.com', 'mal'], { email: true })).not.toBeNull();
        expect(validateValue(['a@b.com', 'c@d.org'], { email: true })).toBeNull();
    });
    it('url solo http(s)', () => {
        expect(isValidUrl('https://ejemplo.com/a?b=1')).toBe(true);
        expect(isValidUrl('http://localhost:3000')).toBe(true);
        for (const bad of ['', 'ejemplo.com', 'javascript:alert(1)', 'ftp://x.com', 'data:text/html,hola', 'https://', 'https://a b.com']) expect(isValidUrl(bad), bad).toBe(false);
        expect(validateValue('ftp://x.com', { url: true }, { strings: EN })).toBe('Enter a valid URL');
    });
});

describe('message', () => {
    it('sustituye a cualquier mensaje generico', () => {
        expect(validateValue('', { required: true, message: 'Falta el nombre' })).toBe('Falta el nombre');
        expect(validateValue('ab', { minLength: 3, message: 'Muy corto' })).toBe('Muy corto');
        expect(validateValue('x', { email: true, message: 'Correo?' })).toBe('Correo?');
    });
    it('un message vacio o no-texto se ignora', () => {
        expect(validateValue('ab', { minLength: 3, message: '  ' })).toBe('Minimo 3 caracteres');
        expect(validateValue('ab', { minLength: 3, message: 5 as unknown as string })).toBe('Minimo 3 caracteres');
    });
});

describe('valores y reglas raros', () => {
    it('no lanza con objetos, NaN, reglas nulas o mal tipadas', () => {
        expect(validateValue({}, { required: true })).toBeNull();
        expect(validateValue({ a: 1 }, { minLength: 3, email: true })).toBeNull();
        expect(validateValue(NaN, { required: true })).not.toBeNull();
        expect(validateValue('x', null)).toBeNull();
        expect(validateValue('x', undefined)).toBeNull();
        expect(validateValue('x', 'nope' as never)).toBeNull();
        expect(validateValue('ab', { minLength: '3' as unknown as number })).toBeNull();
        expect(validateValue('ab', { minLength: NaN, maxLength: Infinity })).toBeNull();
        expect(validateValue(Symbol('s') as unknown as string, { required: true })).toBeNull();
    });
    it('un mensaje de strings parcial cae al de defecto', () => {
        expect(validateValue('', { required: true }, { strings: { required: 'Falta' } })).toBe('Falta');
        expect(validateValue('ab', { minLength: 3 }, { strings: { required: 'Falta' } })).toBe('Minimo 3 caracteres');
    });
});

describe('fieldRules / validateFields', () => {
    it('fusiona required del campo con rules', () => {
        expect(fieldRules({ required: true, rules: { minLength: 2 } })).toEqual({ required: true, minLength: 2 });
        expect(fieldRules({ rules: { required: true } })).toEqual({ required: true });
        expect(fieldRules({})).toEqual({});
        expect(fieldRules(null)).toEqual({});
        expect(fieldRules({ rules: 'x' })).toEqual({});
    });
    it('validateFields devuelve solo los errores', () => {
        const fields = [
            { name: 'nombre', label: 'Nombre', required: true },
            { name: 'correo', type: 'email', rules: { email: true } },
            { name: 'edad', type: 'number', rules: { min: 18 } },
            { name: 'acepto', type: 'checkbox', required: true },
            { name: 'libre' },
        ];
        expect(validateFields(fields, { nombre: '', correo: 'mal', edad: 20, acepto: false })).toEqual({
            nombre: 'Este campo es obligatorio', correo: 'Escribe un correo valido', acepto: 'Este campo es obligatorio',
        });
        expect(validateFields(fields, { nombre: 'Ana', correo: 'a@b.com', edad: 30, acepto: true }, EN)).toEqual({});
        expect(validateFields(fields, { nombre: '' }, EN).nombre).toBe('This field is required');
    });
    it('tolera entradas raras', () => {
        expect(validateFields(null as never, {})).toEqual({});
        expect(validateFields([null, { name: '' }, { name: 'a', required: true }] as never, null)).toEqual({ a: 'Este campo es obligatorio' });
    });
});
