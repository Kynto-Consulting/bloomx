import { describe, expect, it } from 'vitest';
import { ibanValid, isDlpSchema, luhnValid, runDlpPreview } from '../dlp-preview';

const ALL = ['cards', 'iban', 'ssn', 'dni', 'privateKeys', 'apiKeys', 'jwt', 'passwords'];
const cfg = (over: Partial<Parameters<typeof runDlpPreview>[1]> = {}) => ({ keywords: [], detectors: ALL, customPatterns: [], ...over });
const ids = (text: string, c = cfg()) => runDlpPreview(text, c).categories.map((x) => x.id);

describe('dlp-preview', () => {
    it('Luhn e IBAN mod97', () => {
        expect(luhnValid('4111111111111111')).toBe(true);
        expect(luhnValid('4111111111111112')).toBe(false);
        expect(ibanValid('GB82 WEST 1234 5698 7654 32')).toBe(true);
        expect(ibanValid('GB82 WEST 1234 5698 7654 33')).toBe(false);
    });

    it('detecta tarjetas validas e ignora las que no pasan Luhn', () => {
        expect(ids('mi tarjeta 4111 1111 1111 1111 gracias')).toEqual(['cards']);
        expect(ids('numero 4111 1111 1111 1112')).toEqual([]);
    });

    it('detecta IBAN, SSN, DNI, llaves, API keys, JWT y contrasenas', () => {
        expect(ids('IBAN GB82 WEST 1234 5698 7654 32')).toContain('iban');
        expect(ids('ssn 123-45-6789')).toContain('ssn');
        expect(ids('dni 12345678Z')).toContain('dni');
        expect(ids('dni 12345678A')).not.toContain('dni');
        expect(ids('-----BEGIN RSA PRIVATE KEY-----')).toContain('privateKeys');
        expect(ids('AKIAIOSFODNN7EXAMPLE')).toContain('apiKeys');
        expect(ids('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl')).toContain('jwt');
        expect(ids('password: hunter2hunter2')).toContain('passwords');
    });

    it('respeta los detectores activados', () => {
        expect(ids('ssn 123-45-6789', cfg({ detectors: ['cards'] }))).toEqual([]);
    });

    it('palabras clave: cuenta coincidencias distintas sin devolver el texto', () => {
        const r = runDlpPreview('El SECRETO y la clave', cfg({ detectors: [], keywords: ['secreto', 'clave', 'otra'] }));
        expect(r.categories).toEqual([{ id: 'keyword', count: 2 }]);
        expect(JSON.stringify(r)).not.toContain('SECRETO');
    });

    it('patrones propios: valida con regexProblem y descarta peligrosos', () => {
        const r = runDlpPreview('pedido ABC-1234', cfg({ detectors: [], customPatterns: ['abc-\\d{4}', '(a+)+$', '(?=x)'] }));
        expect(r.categories).toEqual([{ id: 'custom', count: 1 }]);
        expect(r.ignoredPatterns.map((p) => p.index)).toEqual([1, 2]);
    });

    it('el resultado nunca contiene el dato detectado', () => {
        const r = runDlpPreview('tarjeta 4111 1111 1111 1111', cfg());
        expect(JSON.stringify(r)).not.toMatch(/4111/);
    });

    it('isDlpSchema', () => {
        expect(isDlpSchema('core-dlp', [])).toBe(true);
        expect(isDlpSchema('x', ['keywords', 'detectors'])).toBe(true);
        expect(isDlpSchema('x', ['keywords'])).toBe(false);
    });
});
