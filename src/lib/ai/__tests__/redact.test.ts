import { describe, expect, it } from 'vitest';
import { redactText } from '../redact';

const all = { card: true, iban: true, nationalId: true, secret: true, email: true, phone: true };
const base = { card: false, iban: false, nationalId: false, secret: false, email: false, phone: false };
const only = (k: keyof typeof all) => ({ ...base, [k]: true });

describe('redactText', () => {
    it('tarjeta valida Luhn (con espacios/guiones) se redacta; numero no Luhn no', () => {
        expect(redactText('pago 4111 1111 1111 1111 ok', only('card')).text).toBe('pago [REDACTED:card] ok');
        expect(redactText('4111-1111-1111-1111', only('card')).counts.card).toBe(1);
        expect(redactText('pedido 1234 5678 9012 3456', only('card')).text).toContain('1234 5678 9012 3456');
    });
    it('IBAN con mod97 valido se redacta; invalido no', () => {
        expect(redactText('IBAN ES91 2100 0418 4502 0005 1332 fin', only('iban')).text).toBe('IBAN [REDACTED:iban] fin');
        expect(redactText('GB82WEST12345698765432', only('iban')).counts.iban).toBe(1);
        expect(redactText('ES00 2100 0418 4502 0005 1332', only('iban')).counts.iban).toBeUndefined();
    });
    it('DNI, NIE y SSN', () => {
        expect(redactText('DNI 12345678Z', only('nationalId')).text).toBe('DNI [REDACTED:id]');
        expect(redactText('DNI 12345678A', only('nationalId')).counts.nationalId).toBeUndefined();
        expect(redactText('NIE X1234567L', only('nationalId')).counts.nationalId).toBe(1);
        expect(redactText('SSN 123-45-6789', only('nationalId')).counts.nationalId).toBe(1);
        expect(redactText('000-12-3456 y 666-12-3456', only('nationalId')).counts.nationalId).toBeUndefined();
    });
    it('JWT, claves y pares clave=valor', () => {
        const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk1234';
        expect(redactText(`t ${jwt}`, only('secret')).text).toBe('t [REDACTED:secret]');
        expect(redactText('key sk-abcdefghijklmnopqrstuv', only('secret')).counts.secret).toBe(1);
        expect(redactText('AKIAABCDEFGHIJKLMNOP', only('secret')).counts.secret).toBe(1);
        const kv = redactText('password: hunter2hunter2', only('secret'));
        expect(kv.text).toBe('password: [REDACTED:secret]');
        expect(redactText('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----', only('secret')).text).toBe('[REDACTED:secret]');
    });
    it('email y telefono solo si estan activos', () => {
        const t = 'escribe a ana.l@example.com o llama +34 612 345 678';
        expect(redactText(t, { ...base }).text).toBe(t);
        expect(redactText(t, only('email')).text).toContain('[REDACTED:email]');
        expect(redactText(t, only('phone')).text).toContain('[REDACTED:phone]');
        expect(redactText(t, all).text).not.toMatch(/example|612/);
    });
    it('sin falsos positivos obvios', () => {
        const t = 'Reunion el 2024-05-17 a las 10:30, ref 12345, total 1.234,56 EUR, version 3.2.1, id 987654321';
        const r = redactText(t, { ...all, email: false, phone: false });
        expect(r.text).toBe(t);
        expect(Object.keys(r.counts)).toHaveLength(0);
    });
    it('cuenta sin exponer valores', () => {
        const r = redactText('4111111111111111 y 5500005555555559', only('card'));
        expect(r.counts.card).toBe(2);
        expect(JSON.stringify(r.counts)).not.toMatch(/4111/);
    });
});
