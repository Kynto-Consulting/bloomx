import { describe, expect, it } from 'vitest';
import {
    base32Decode,
    base32Encode,
    buildOtpauthUri,
    generateRecoveryCodes,
    generateTotpSecret,
    hashRecoveryCode,
    hotp,
    normalizeRecoveryCode,
    totp,
    verifyTotp,
} from '../totp';

// Vectores de prueba del Apendice B de RFC 6238 (8 digitos). Los secretos son ASCII repetidos por algoritmo.
const SECRET_SHA1 = base32Encode(Buffer.from('12345678901234567890'));
const SECRET_SHA256 = base32Encode(Buffer.from('12345678901234567890123456789012'));
const SECRET_SHA512 = base32Encode(Buffer.from('1234567890123456789012345678901234567890123456789012345678901234'));

const VECTORS: Array<[number, string, string, string]> = [
    // [tiempo (s), SHA1, SHA256, SHA512]
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1111111111, '14050471', '67062674', '99943326'],
    [1234567890, '89005924', '91819424', '93441116'],
    [2000000000, '69279037', '90698825', '38618901'],
    [20000000000, '65353130', '77737706', '47863826'],
];

describe('TOTP RFC 6238 (vectores oficiales)', () => {
    for (const [t, sha1, sha256, sha512] of VECTORS) {
        it(`T=${t}`, () => {
            expect(totp(SECRET_SHA1, t * 1000, { digits: 8, algorithm: 'SHA1' })).toBe(sha1);
            expect(totp(SECRET_SHA256, t * 1000, { digits: 8, algorithm: 'SHA256' })).toBe(sha256);
            expect(totp(SECRET_SHA512, t * 1000, { digits: 8, algorithm: 'SHA512' })).toBe(sha512);
        });
    }

    it('HOTP RFC 4226 (Apendice D): contador 0..9', () => {
        const secret = Buffer.from('12345678901234567890');
        const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
        expected.forEach((code, counter) => expect(hotp(secret, counter, 6)).toBe(code));
    });
});

describe('base32', () => {
    it('ida y vuelta', () => {
        for (const len of [1, 5, 10, 20, 32]) {
            const buf = Buffer.from(Array.from({ length: len }, (_, i) => (i * 37 + 11) & 0xff));
            expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
        }
    });
    it('acepta minusculas, espacios y relleno', () => {
        const enc = base32Encode(Buffer.from('hello world'));
        expect(base32Decode(enc.toLowerCase().replace(/(.{4})/g, '$1 ') + '==').toString()).toBe('hello world');
    });
    it('rechaza caracteres invalidos', () => {
        expect(() => base32Decode('AB1!')).toThrow();
    });
});

describe('verifyTotp', () => {
    const secret = generateTotpSecret();
    const now = Date.UTC(2026, 8, 29, 12, 0, 0);

    it('devuelve el paso coincidente y tolera +-1 paso', () => {
        const step = Math.floor(now / 1000 / 30);
        expect(verifyTotp(secret, totp(secret, now), { timeMs: now })).toBe(step);
        expect(verifyTotp(secret, totp(secret, now - 30_000), { timeMs: now })).toBe(step - 1);
        expect(verifyTotp(secret, totp(secret, now + 30_000), { timeMs: now })).toBe(step + 1);
    });

    it('rechaza fuera de ventana, formato invalido y codigo erroneo', () => {
        expect(verifyTotp(secret, totp(secret, now - 90_000), { timeMs: now })).toBeNull();
        expect(verifyTotp(secret, '12345', { timeMs: now })).toBeNull();
        expect(verifyTotp(secret, 'abcdef', { timeMs: now })).toBeNull();
        const good = totp(secret, now);
        const bad = String((Number(good) + 1) % 1_000_000).padStart(6, '0');
        expect(verifyTotp(secret, bad, { timeMs: now })).toBeNull();
    });

    it('ignora espacios en el codigo', () => {
        const c = totp(secret, now);
        expect(verifyTotp(secret, `${c.slice(0, 3)} ${c.slice(3)}`, { timeMs: now })).not.toBeNull();
    });
});

describe('secretos, URI y codigos de recuperacion', () => {
    it('secreto de 160 bits en base32', () => {
        const s = generateTotpSecret();
        expect(s).toMatch(/^[A-Z2-7]{32}$/);
        expect(base32Decode(s)).toHaveLength(20);
    });

    it('otpauth URI', () => {
        const uri = buildOtpauthUri({ secret: 'JBSWY3DPEHPK3PXP', account: 'a@b.com', issuer: 'Bloomx' });
        expect(uri.startsWith('otpauth://totp/Bloomx:a%40b.com?')).toBe(true);
        expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
        expect(uri).toContain('issuer=Bloomx');
        expect(uri).toContain('digits=6');
        expect(uri).toContain('period=30');
    });

    it('codigos de recuperacion: 10, unicos, formato y hash estable', () => {
        const codes = generateRecoveryCodes(10);
        expect(new Set(codes).size).toBe(10);
        for (const c of codes) expect(c).toMatch(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
        const h1 = hashRecoveryCode(codes[0], 'pepper');
        expect(hashRecoveryCode(codes[0].toLowerCase().replace('-', ' '), 'pepper')).toBe(h1); // normaliza
        expect(hashRecoveryCode(codes[0], 'otro')).not.toBe(h1);
        expect(normalizeRecoveryCode('ab-cd 12')).toBe('ABCD12');
    });
});
