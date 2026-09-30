import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    decrypt,
    decryptObject,
    detectFormat,
    encrypt,
    encryptObject,
    isEncrypted,
    needsReencrypt,
    reencrypt,
    tryDecrypt,
} from '../encryption';

const ENV_KEYS = ['DATA_ENCRYPTION_KEY', 'DATA_ENCRYPTION_KEY_ID', 'DATA_ENCRYPTION_KEYS_PREVIOUS', 'NEXTAUTH_SECRET', 'ENCRYPTION_WRITE_FORMAT', 'ENCRYPTION_REQUIRE_DEDICATED_KEY'];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.NEXTAUTH_SECRET = 'auth-secret-for-tests';
});
afterEach(() => {
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
});

// --- generadores de formatos antiguos, tal como los producia el codigo original -----------------------------------------
function legacyV1(text: string, secret: string) {
    const key = Buffer.from(crypto.createHash('sha256').update(secret).digest('base64').substring(0, 32));
    const iv = crypto.randomBytes(16);
    const c = crypto.createCipheriv('aes-256-cbc', key, iv);
    return `${iv.toString('hex')}:${Buffer.concat([c.update(text, 'utf8'), c.final()]).toString('hex')}`;
}
function legacyV2(text: string, secret: string) {
    const key = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.alloc(0), Buffer.from('bloomx:data-encryption:v2'), 32));
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
    return `v2:${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
}

describe('cifrado v3 (formato vigente con keyId)', () => {
    it('ida y vuelta, IV aleatorio y formato v3:<id>:...', () => {
        process.env.DATA_ENCRYPTION_KEY = 'dedicated-key-1';
        const a = encrypt('secreto');
        const b = encrypt('secreto');
        expect(a).not.toBe(b);
        expect(a.startsWith('v3:k1:')).toBe(true);
        expect(detectFormat(a)).toEqual({ format: 'v3', keyId: 'k1' });
        expect(decrypt(a)).toBe('secreto');
        expect(decrypt(b)).toBe('secreto');
    });

    it('soporta unicode y no toca cadenas vacias', () => {
        process.env.DATA_ENCRYPTION_KEY = 'dedicated-key-1';
        expect(decrypt(encrypt('contrasena ñandú 🔐'))).toBe('contrasena ñandú 🔐');
        expect(encrypt('')).toBe('');
        expect(decrypt('')).toBe('');
    });

    it('detecta manipulacion (GCM) y cambio de keyId (AAD)', () => {
        process.env.DATA_ENCRYPTION_KEY = 'dedicated-key-1';
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const enc = encrypt('secreto');
        const parts = enc.split(':');
        const tampered = [...parts.slice(0, 4), (parts[4][0] === 'a' ? 'b' : 'a') + parts[4].slice(1)].join(':');
        expect(tryDecrypt(tampered)).toBeNull();
        expect(decrypt(tampered)).toBe(tampered); // fallo cerrado: no devuelve texto plano inventado
        const relabeled = ['v3', 'k9', ...parts.slice(2)].join(':');
        expect(tryDecrypt(relabeled)).toBeNull();
    });

    it('clave incorrecta => null', () => {
        process.env.DATA_ENCRYPTION_KEY = 'dedicated-key-1';
        const enc = encrypt('secreto');
        process.env.DATA_ENCRYPTION_KEY = 'otra-clave-distinta';
        delete process.env.NEXTAUTH_SECRET;
        expect(tryDecrypt(enc)).toBeNull();
    });
});

describe('compatibilidad v1 (CBC legado) y v2 (GCM sin keyId)', () => {
    it('lee v1', () => {
        const enc = legacyV1('token-antiguo', 'auth-secret-for-tests');
        expect(detectFormat(enc).format).toBe('v1');
        expect(decrypt(enc)).toBe('token-antiguo');
        expect(needsReencrypt(enc)).toBe(true);
    });

    it('lee v2', () => {
        const enc = legacyV2('token-v2', 'auth-secret-for-tests');
        expect(detectFormat(enc).format).toBe('v2');
        expect(decrypt(enc)).toBe('token-v2');
        expect(needsReencrypt(enc)).toBe(true);
    });

    it('con ENCRYPTION_WRITE_FORMAT=v2 se sigue escribiendo v2 (rollback)', () => {
        process.env.ENCRYPTION_WRITE_FORMAT = 'v2';
        const enc = encrypt('x');
        expect(detectFormat(enc).format).toBe('v2');
        expect(decrypt(enc)).toBe('x');
        expect(needsReencrypt(enc)).toBe(false);
    });

    it('el texto plano heredado pasa tal cual', () => {
        expect(decrypt('ya29.token-en-claro')).toBe('ya29.token-en-claro');
        expect(tryDecrypt('ya29.token-en-claro')).toBe('ya29.token-en-claro');
        expect(isEncrypted('ya29.token-en-claro')).toBe(false);
        expect(needsReencrypt('ya29.token-en-claro')).toBe(true);
        // parece hex con ":" pero no es un bloque valido de v1
        expect(detectFormat('abcd:1234').format).toBe('plain');
    });

    it('separar claves: datos cifrados con NEXTAUTH_SECRET siguen legibles al definir DATA_ENCRYPTION_KEY', () => {
        const oldV2 = legacyV2('dato', 'auth-secret-for-tests');
        const oldV1 = legacyV1('dato1', 'auth-secret-for-tests');
        const oldV3 = encrypt('dato3'); // sin clave dedicada => id "auth"
        expect(oldV3.startsWith('v3:auth:')).toBe(true);

        process.env.DATA_ENCRYPTION_KEY = 'ahora-clave-dedicada';
        expect(decrypt(oldV2)).toBe('dato');
        expect(decrypt(oldV1)).toBe('dato1');
        expect(decrypt(oldV3)).toBe('dato3');
        expect(encrypt('nuevo').startsWith('v3:k1:')).toBe(true);
    });
});

describe('rotacion de claves con keyId', () => {
    it('cifrar con k1, rotar a k2 conservando k1 como anterior, re-cifrar de forma perezosa', () => {
        process.env.DATA_ENCRYPTION_KEY = 'clave-uno';
        process.env.DATA_ENCRYPTION_KEY_ID = 'k1';
        const enc1 = encrypt('valor');

        process.env.DATA_ENCRYPTION_KEY = 'clave-dos';
        process.env.DATA_ENCRYPTION_KEY_ID = 'k2';
        process.env.DATA_ENCRYPTION_KEYS_PREVIOUS = 'k1:clave-uno';

        expect(decrypt(enc1)).toBe('valor'); // sigue legible
        expect(needsReencrypt(enc1)).toBe(true);
        const enc2 = reencrypt(enc1)!;
        expect(enc2.startsWith('v3:k2:')).toBe(true);
        expect(decrypt(enc2)).toBe('valor');
        expect(needsReencrypt(enc2)).toBe(false);

        // Al retirar la clave anterior, lo viejo deja de ser legible y lo nuevo no
        delete process.env.DATA_ENCRYPTION_KEYS_PREVIOUS;
        delete process.env.NEXTAUTH_SECRET;
        expect(tryDecrypt(enc1)).toBeNull();
        expect(decrypt(enc2)).toBe('valor');
    });

    it('ENCRYPTION_REQUIRE_DEDICATED_KEY=true en produccion exige DATA_ENCRYPTION_KEY', () => {
        const env = process.env as Record<string, string | undefined>;
        const prev = env.NODE_ENV;
        env.NODE_ENV = 'production';
        process.env.ENCRYPTION_REQUIRE_DEDICATED_KEY = 'true';
        try {
            expect(() => encrypt('x')).toThrow(/DATA_ENCRYPTION_KEY/);
            process.env.DATA_ENCRYPTION_KEY = 'ok';
            expect(() => encrypt('x')).not.toThrow();
        } finally {
            env.NODE_ENV = prev;
        }
    });

    it('el keyId se sanea (no puede contener ":")', () => {
        process.env.DATA_ENCRYPTION_KEY = 'k';
        process.env.DATA_ENCRYPTION_KEY_ID = 'a:b c';
        const enc = encrypt('x');
        expect(enc.split(':')).toHaveLength(5);
        expect(decrypt(enc)).toBe('x');
    });
});

describe('encryptObject / decryptObject', () => {
    it('cifra todas las cadenas, conserva tipos y descifra de vuelta', () => {
        process.env.DATA_ENCRYPTION_KEY = 'clave';
        const obj = { a: 'x', n: 3, ok: true, nested: { s: 'y', list: ['z'] }, nul: null };
        const enc = encryptObject(obj);
        expect(enc.a).not.toBe('x');
        expect(enc.n).toBe(3);
        expect(isEncrypted(enc.nested.s)).toBe(true);
        expect(decryptObject(enc)).toEqual(obj);
    });
});
