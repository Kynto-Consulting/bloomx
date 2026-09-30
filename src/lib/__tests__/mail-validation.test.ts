import { describe, it, expect } from 'vitest';
import { parseRecipientList, isValidEmailAddress, normalizeEmailAddressAscii, domainToAsciiSafe } from '../mail-validation';

describe('parseRecipientList', () => {
    it('acepta nombres con coma entre comillas sin partir el destinatario', () => {
        const r = parseRecipientList('"Lopez, Ana" <ana@x.com>, bob@y.com');
        expect(r.invalid).toEqual([]);
        expect(r.valid).toEqual(['ana@x.com', 'bob@y.com']);
    });

    it('separa por coma y punto y coma respetando comillas', () => {
        const r = parseRecipientList('"Perez, Juan" <juan@x.com>; Maria <maria@y.org>');
        expect(r.valid).toEqual(['juan@x.com', 'maria@y.org']);
        expect(r.invalid).toEqual([]);
    });

    it('quita duplicados sin distinguir mayusculas', () => {
        const r = parseRecipientList('a@x.com, A@X.com; b@y.com');
        expect(r.valid).toEqual(['a@x.com', 'b@y.com']);
    });

    it('acepta arrays (cada entrada puede traer varias direcciones)', () => {
        const r = parseRecipientList(['a@x.com, b@y.com', '"Doe, J" <j@z.com>']);
        expect(r.valid).toEqual(['a@x.com', 'b@y.com', 'j@z.com']);
    });

    it('marca como invalidas las direcciones malformadas', () => {
        const r = parseRecipientList('bien@x.com, sin-arroba, a@b, dos@@x.com, <>');
        expect(r.valid).toEqual(['bien@x.com']);
        expect(r.invalid.length).toBe(4);
    });

    it('rechaza inyeccion de cabeceras (CRLF)', () => {
        const r = parseRecipientList('a@x.com\r\nBcc: evil@z.com');
        expect(r.valid).toEqual([]);
        expect(r.invalid.length).toBeGreaterThan(0);
        expect(r.invalid.join(' ')).not.toMatch(/[\r\n]/);
    });

    it('acepta dominios IDN y los devuelve en punycode', () => {
        const r = parseRecipientList('info@bücher.de, ana@例え.jp');
        expect(r.invalid).toEqual([]);
        expect(r.valid).toEqual(['info@xn--bcher-kva.de', 'ana@xn--r8jz45g.jp']);
    });

    it('acepta dominios ya en punycode y TLD IDN', () => {
        expect(isValidEmailAddress('a@xn--bcher-kva.de')).toBe(true);
        expect(isValidEmailAddress('a@ejemplo.xn--p1ai')).toBe(true);
    });

    it('vacio o nulo -> listas vacias', () => {
        expect(parseRecipientList('')).toEqual({ valid: [], invalid: [] });
        expect(parseRecipientList(null)).toEqual({ valid: [], invalid: [] });
    });
});

describe('IDN', () => {
    it('domainToAsciiSafe rechaza caracteres que un parser de URL reinterpretaria', () => {
        for (const bad of ['evil.com/path', 'a.com:8080', 'user@evil.com', 'a b.com', 'a.com?x', 'a..com', '.a.com', 'bücher.de#x']) {
            expect(domainToAsciiSafe(bad)).toBeNull();
        }
    });

    it('normalizeEmailAddressAscii exige parte local ASCII y TLD valido', () => {
        expect(normalizeEmailAddressAscii('josé@bücher.de')).toBeNull();
        expect(normalizeEmailAddressAscii('a@bücher')).toBeNull();
        expect(normalizeEmailAddressAscii('a@1.2.3.4')).toBeNull();
        expect(normalizeEmailAddressAscii('  A.B@Ejemplo.COM ')).toBe('A.B@ejemplo.com');
    });
});
