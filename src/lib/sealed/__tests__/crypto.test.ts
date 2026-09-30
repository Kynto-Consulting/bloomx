import { describe, it, expect } from 'vitest';
import {
    MAX_PLAINTEXT_BYTES, SealedCryptoError, b64uDecode, b64uEncode, keyFragment, openMessage, parseKeyFragment,
    sealMessage, validateEnvelope, type SealedEnvelope,
} from '../crypto';

const FAST = { iterations: 100_000 }; // piso permitido; en produccion 600000
const payload = { subject: 'Reunión ñandú 🔐', html: '<p>Hola <b>mundo</b> — contraseña: 1234</p>' };

async function code(promise: Promise<unknown>): Promise<string | undefined> {
    try { await promise; return undefined; } catch (e) { return e instanceof SealedCryptoError ? e.code : `other:${String(e)}`; }
}

function flip(b64u: string, byteIndex: number): string {
    const bytes = b64uDecode(b64u);
    bytes[byteIndex % bytes.length] ^= 0x01;
    return b64uEncode(bytes);
}

describe('sealed crypto: round trip', () => {
    it('cifra y descifra (unicode y HTML) sin contrasena', async () => {
        const { envelope, key } = await sealMessage(payload);
        expect(envelope.pw).toBe(false);
        expect(await openMessage(envelope, key)).toEqual(payload);
    });

    it('cifra y descifra con contrasena (fragmento + contrasena)', async () => {
        const { envelope, key } = await sealMessage(payload, { password: 'correcta-horse-battery', ...FAST });
        expect(envelope.pw).toBe(true);
        expect(envelope.iter).toBe(100_000);
        expect(await openMessage(envelope, key, 'correcta-horse-battery')).toEqual(payload);
        // NFKC: la misma contrasena con otra normalizacion Unicode abre igual
        const sealed2 = await sealMessage(payload, { password: 'café-secreta', ...FAST });
        expect(await openMessage(sealed2.envelope, sealed2.key, 'café-secreta')).toEqual(payload);
    });

    it('cada envio usa clave, IV y ciphertext distintos', async () => {
        const a = await sealMessage(payload);
        const b = await sealMessage(payload);
        expect(a.key).not.toBe(b.key);
        expect(a.envelope.iv).not.toBe(b.envelope.iv);
        expect(a.envelope.ct).not.toBe(b.envelope.ct);
    });

    it('el sobre que ve el servidor no contiene la clave ni el texto en claro', async () => {
        const { envelope, key } = await sealMessage(payload, { password: 'una-contrasena', ...FAST });
        const wire = JSON.stringify(envelope);
        expect(wire).not.toContain(key);
        expect(wire).not.toContain('Hola');
        expect(wire).not.toContain('una-contrasena');
        expect(Object.keys(envelope).sort()).toEqual(['alg', 'ct', 'iter', 'iv', 'kdf', 'pw', 'salt', 'v']);
    });
});

describe('sealed crypto: fallos de autenticacion', () => {
    it('un byte manipulado del ciphertext o del tag falla', async () => {
        const { envelope, key } = await sealMessage(payload);
        expect(await code(openMessage({ ...envelope, ct: flip(envelope.ct, 0) }, key))).toBe('DECRYPT_FAILED');
        // el tag son los ultimos 16 bytes
        const bytes = b64uDecode(envelope.ct);
        expect(await code(openMessage({ ...envelope, ct: flip(envelope.ct, bytes.length - 1) }, key))).toBe('DECRYPT_FAILED');
    });

    it('IV manipulado o truncado falla', async () => {
        const { envelope, key } = await sealMessage(payload);
        expect(await code(openMessage({ ...envelope, iv: flip(envelope.iv, 3) }, key))).toBe('DECRYPT_FAILED');
        expect(await code(openMessage({ ...envelope, ct: b64uEncode(b64uDecode(envelope.ct).slice(0, -1)) }, key))).toBe('DECRYPT_FAILED');
    });

    it('clave equivocada falla (mismo error que contrasena equivocada)', async () => {
        const a = await sealMessage(payload);
        const b = await sealMessage(payload);
        expect(await code(openMessage(a.envelope, b.key))).toBe('DECRYPT_FAILED');
    });

    it('contrasena incorrecta falla; sin contrasena pide contrasena', async () => {
        const { envelope, key } = await sealMessage(payload, { password: 'la-buena-123', ...FAST });
        expect(await code(openMessage(envelope, key, 'la-mala-1234'))).toBe('DECRYPT_FAILED');
        expect(await code(openMessage(envelope, key))).toBe('PASSWORD_REQUIRED');
        expect(await code(openMessage(envelope, key, ''))).toBe('PASSWORD_REQUIRED');
    });

    it('contrasena correcta pero clave del fragmento equivocada falla (los dos factores son necesarios)', async () => {
        const a = await sealMessage(payload, { password: 'la-buena-123', ...FAST });
        const b = await sealMessage(payload);
        expect(await code(openMessage(a.envelope, b.key, 'la-buena-123'))).toBe('DECRYPT_FAILED');
    });

    it('el servidor no puede degradar el sobre: quitar la contrasena, cambiar iteraciones o salt invalida el tag', async () => {
        const { envelope, key } = await sealMessage(payload, { password: 'la-buena-123', ...FAST });
        const downgraded: SealedEnvelope = { v: 1, alg: 'A256GCM', iv: envelope.iv, ct: envelope.ct, pw: false };
        expect(await code(openMessage(downgraded, key))).toBe('DECRYPT_FAILED');
        expect(await code(openMessage({ ...envelope, iter: 100_001 }, key, 'la-buena-123'))).toBe('DECRYPT_FAILED');
        expect(await code(openMessage({ ...envelope, salt: flip(envelope.salt!, 0) }, key, 'la-buena-123'))).toBe('DECRYPT_FAILED');
    });

    it('clave con formato invalido', async () => {
        const { envelope } = await sealMessage(payload);
        expect(await code(openMessage(envelope, 'corta'))).toBe('INVALID_KEY');
        expect(await code(openMessage(envelope, 'no valida!!'))).toBe('INVALID_KEY');
    });
});

describe('sealed crypto: validacion y fragmento', () => {
    it('rechaza sobres mal formados', () => {
        const bad = (x: unknown) => { try { validateEnvelope(x); return null; } catch (e) { return (e as SealedCryptoError).code; } };
        expect(bad(null)).toBe('INVALID_ENVELOPE');
        expect(bad({ v: 2 })).toBe('INVALID_ENVELOPE');
        expect(bad({ v: 1, alg: 'A128GCM', iv: 'x', ct: 'y', pw: false })).toBe('INVALID_ENVELOPE');
        expect(bad({ v: 1, alg: 'A256GCM', iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAAAAAAAAAAAAAAAAAAAA', pw: true })).toBe('INVALID_ENVELOPE'); // faltan kdf/iter/salt
        expect(bad({ v: 1, alg: 'A256GCM', iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAAAAAAAAAAAAAAAAAAAA', pw: true, kdf: 'PBKDF2-SHA256', iter: 1, salt: 'AAAAAAAAAAAAAAAAAAAAAA' })).toBe('INVALID_ENVELOPE'); // iter bajo
        expect(bad({ v: 1, alg: 'A256GCM', iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAAAAAAAAAAAAAAAAAAAA', pw: false, iter: 700000 })).toBe('INVALID_ENVELOPE'); // campos KDF sin pw
    });

    it('parseKeyFragment acepta #k= valido y descarta lo demas', async () => {
        const { key } = await sealMessage(payload);
        expect(parseKeyFragment(`#${keyFragment(key)}`)).toBe(key);
        expect(parseKeyFragment(`#x=1&${keyFragment(key)}`)).toBe(key);
        expect(parseKeyFragment('')).toBeNull();
        expect(parseKeyFragment('#k=abc')).toBeNull();
        expect(parseKeyFragment(`#k=${key}AA`)).toBeNull();
        expect(parseKeyFragment('#k=' + '!'.repeat(43))).toBeNull();
    });

    it('base64url es estricto', () => {
        expect(() => b64uDecode('ab+/')).toThrow();
        expect(() => b64uDecode('a')).toThrow();
        expect(b64uEncode(b64uDecode('AQIDBA'))).toBe('AQIDBA');
    });

    it('rechaza mensajes que superan el limite', async () => {
        expect(await code(sealMessage({ subject: '', html: 'x'.repeat(MAX_PLAINTEXT_BYTES + 1) }))).toBe('PAYLOAD_TOO_LARGE');
    });
});
