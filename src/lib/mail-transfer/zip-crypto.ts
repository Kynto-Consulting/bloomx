/**
 * zip-crypto.ts - descifrado de entradas ZIP protegidas con contrasena: ZipCrypto (PKWARE tradicional) y WinZip AES (AE-1/AE-2,
 * 128/192/256 bits). Solo `node:crypto`; sin dependencias (ver docs/mail-transfer: se evaluo @zip.js/zip.js, 8,5 MB, y se descarto).
 *
 * Diseno:
 *  - `ZipDecryptor.push(chunk)` descifra en flujo (por trozos) y `finish()` verifica la autenticacion (HMAC-SHA1 en AES);
 *  - la contrasena solo vive en memoria mientras se descifra; nunca se registra ni se devuelve;
 *  - ZipCrypto NO es seguro criptograficamente (es el cifrado historico de Windows/Info-ZIP): se soporta solo para poder LEER
 *    archivos existentes. La exportacion de esta app usa BLMXENC1 (AES-256-GCM), no ZIP cifrado.
 *  - las funciones `zipCryptoEncrypt` / `winzipAesEncrypt` existen para construir ZIP de prueba (interoperabilidad verificada
 *    contra bsdtar/7-Zip en las pruebas cuando estan disponibles).
 */
import { createCipheriv, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

export class ZipCryptoError extends Error {
    constructor(public code: 'zip_wrong_password' | 'zip_auth_failed' | 'zip_unsupported_encryption' | 'zip_corrupt') {
        super(code);
        this.name = 'ZipCryptoError';
    }
}

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

// ---------------------------------------------------------------------------------------------------------------------
// ZipCrypto
// ---------------------------------------------------------------------------------------------------------------------

class ZipCryptoKeys {
    k0 = 0x12345678;
    k1 = 0x23456789;
    k2 = 0x34567890;

    constructor(password: Buffer) {
        for (let i = 0; i < password.length; i++) this.update(password[i]);
    }

    update(b: number): void {
        this.k0 = (CRC_TABLE[(this.k0 ^ b) & 0xff] ^ (this.k0 >>> 8)) >>> 0;
        this.k1 = (Math.imul((this.k1 + (this.k0 & 0xff)) >>> 0, 134775813) + 1) >>> 0;
        this.k2 = (CRC_TABLE[(this.k2 ^ (this.k1 >>> 24)) & 0xff] ^ (this.k2 >>> 8)) >>> 0;
    }

    streamByte(): number {
        const t = (this.k2 | 2) & 0xffff; // "unsigned short" de la especificacion PKWARE
        return ((t * (t ^ 1)) >>> 8) & 0xff;
    }
}

export interface ZipDecryptor {
    /** Bytes de cabecera de cifrado a leer ANTES de los datos (sal+verificador en AES; 12 en ZipCrypto). */
    readonly headerBytes: number;
    /** Bytes finales de autenticacion a leer DESPUES de los datos (10 en AES; 0 en ZipCrypto). */
    readonly trailerBytes: number;
    /** Procesa la cabecera de cifrado (valida la contrasena de forma barata: lanza zip_wrong_password). */
    start(header: Buffer): void;
    /** Descifra un trozo de datos (devuelve un buffer nuevo). */
    push(chunk: Buffer): Buffer;
    /** Verifica la autenticacion final con el trailer (AES). */
    finish(trailer: Buffer): void;
}

/** ZipCrypto: `checkByte` = byte alto del CRC (o del DOS time si la entrada usa data descriptor, bit 3 de flags). */
export function zipCryptoDecryptor(password: string, checkByte: number): ZipDecryptor {
    let keys: ZipCryptoKeys | null = null;
    return {
        headerBytes: 12,
        trailerBytes: 0,
        start(header) {
            keys = new ZipCryptoKeys(Buffer.from(password, 'utf8'));
            let last = 0;
            for (let i = 0; i < 12; i++) {
                const p = header[i] ^ keys.streamByte();
                keys.update(p);
                last = p;
            }
            // Probabilistico (1/256 de falsos positivos): el CRC final de la entrada confirma
            if (last !== (checkByte & 0xff)) throw new ZipCryptoError('zip_wrong_password');
        },
        push(chunk) {
            const k = keys!;
            const out = Buffer.allocUnsafe(chunk.length);
            for (let i = 0; i < chunk.length; i++) {
                const p = chunk[i] ^ k.streamByte();
                k.update(p);
                out[i] = p;
            }
            return out;
        },
        finish() { /* sin autenticacion */ },
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// WinZip AES
// ---------------------------------------------------------------------------------------------------------------------

export interface AesParams {
    /** 1 = 128 bits, 2 = 192, 3 = 256 */
    strength: 1 | 2 | 3;
    /** AE-1 (1) conserva el CRC; AE-2 (2) lo pone a 0. */
    version: number;
    /** Metodo de compresion real (0 = stored, 8 = deflate). */
    method: number;
}

const AES_KEY_BYTES = { 1: 16, 2: 24, 3: 32 } as const;
const AES_SALT_BYTES = { 1: 8, 2: 12, 3: 16 } as const;

export const aesSaltBytes = (s: 1 | 2 | 3) => AES_SALT_BYTES[s];

/** Lee la extra 0x9901 de WinZip AES; null si no es valida. */
export function parseAesExtra(extra: Buffer): AesParams | null {
    for (let e = 0; e + 4 <= extra.length;) {
        const id = extra.readUInt16LE(e);
        const len = extra.readUInt16LE(e + 2);
        if (id === 0x9901 && len >= 7 && e + 4 + len <= extra.length) {
            const version = extra.readUInt16LE(e + 4);
            const vendor = extra.toString('latin1', e + 6, e + 8);
            const strength = extra[e + 8];
            const method = extra.readUInt16LE(e + 9);
            if (vendor !== 'AE' || (version !== 1 && version !== 2) || (strength !== 1 && strength !== 2 && strength !== 3)) return null;
            return { strength: strength as 1 | 2 | 3, version, method };
        }
        e += 4 + len;
    }
    return null;
}

/** Contador CTR de WinZip: 128 bits little-endian que empieza en 1 (a diferencia del AES-CTR estandar, big-endian). */
class LeCtr {
    private ecb;
    private counter = BigInt(1);
    private ks: Buffer = Buffer.alloc(0);
    private ksPos = 0;

    constructor(key: Buffer) {
        this.ecb = createCipheriv(`aes-${key.length * 8}-ecb`, key, null);
        this.ecb.setAutoPadding(false);
    }

    private refill(minBytes: number): void {
        const blocks = Math.max(1, Math.min(4096, Math.ceil(minBytes / 16)));
        const counters = Buffer.alloc(blocks * 16);
        for (let i = 0; i < blocks; i++) {
            // Contador de 64 bits suficiente (2^64 bloques = 256 EiB); el resto de bytes queda a 0
            counters.writeBigUInt64LE(this.counter, i * 16);
            this.counter += BigInt(1);
        }
        this.ks = this.ecb.update(counters);
        this.ksPos = 0;
    }

    /** XOR in-place sobre `data` con el flujo de claves. */
    apply(data: Buffer): Buffer {
        let off = 0;
        while (off < data.length) {
            if (this.ksPos >= this.ks.length) this.refill(data.length - off);
            const n = Math.min(this.ks.length - this.ksPos, data.length - off);
            for (let i = 0; i < n; i++) data[off + i] ^= this.ks[this.ksPos + i];
            this.ksPos += n;
            off += n;
        }
        return data;
    }
}

export function winzipAesDecryptor(password: string, p: AesParams): ZipDecryptor {
    const keyLen = AES_KEY_BYTES[p.strength];
    const saltLen = AES_SALT_BYTES[p.strength];
    let ctr: LeCtr | null = null;
    let mac: ReturnType<typeof createHmac> | null = null;
    return {
        headerBytes: saltLen + 2,
        trailerBytes: 10,
        start(header) {
            const salt = header.subarray(0, saltLen);
            const pwv = header.subarray(saltLen, saltLen + 2);
            const dk = pbkdf2Sync(Buffer.from(password, 'utf8'), salt, 1000, 2 * keyLen + 2, 'sha1');
            const aesKey = dk.subarray(0, keyLen);
            const hmacKey = dk.subarray(keyLen, 2 * keyLen);
            if (!timingSafeEqual(dk.subarray(2 * keyLen, 2 * keyLen + 2), pwv)) throw new ZipCryptoError('zip_wrong_password');
            ctr = new LeCtr(Buffer.from(aesKey));
            mac = createHmac('sha1', Buffer.from(hmacKey));
        },
        push(chunk) {
            mac!.update(chunk);
            return ctr!.apply(Buffer.from(chunk));
        },
        finish(trailer) {
            const expected = mac!.digest().subarray(0, 10);
            if (trailer.length < 10 || !timingSafeEqual(expected, trailer.subarray(0, 10))) throw new ZipCryptoError('zip_auth_failed');
        },
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// Cifrado (solo para construir ZIP de prueba)
// ---------------------------------------------------------------------------------------------------------------------

/** Cifra con ZipCrypto. `plainCrcHigh` = byte alto del CRC de los datos ORIGINALES. Devuelve 12 bytes de cabecera + datos. */
export function zipCryptoEncrypt(data: Buffer, password: string, plainCrcHigh: number, header12?: Buffer): Buffer {
    const keys = new ZipCryptoKeys(Buffer.from(password, 'utf8'));
    const hdr = header12 ? Buffer.from(header12) : randomBytes(12);
    hdr[11] = plainCrcHigh & 0xff;
    const out = Buffer.allocUnsafe(12 + data.length);
    const enc = (p: number) => {
        const c = p ^ keys.streamByte();
        keys.update(p);
        return c;
    };
    for (let i = 0; i < 12; i++) out[i] = enc(hdr[i]);
    for (let i = 0; i < data.length; i++) out[12 + i] = enc(data[i]);
    return out;
}

/** Cifra con WinZip AES: salt + verificador + datos + HMAC(10). `data` ya esta comprimido si procede. */
export function winzipAesEncrypt(data: Buffer, password: string, strength: 1 | 2 | 3, salt?: Buffer): Buffer {
    const keyLen = AES_KEY_BYTES[strength];
    const saltLen = AES_SALT_BYTES[strength];
    const s = salt ?? randomBytes(saltLen);
    const dk = pbkdf2Sync(Buffer.from(password, 'utf8'), s, 1000, 2 * keyLen + 2, 'sha1');
    const ctr = new LeCtr(Buffer.from(dk.subarray(0, keyLen)));
    const ct = ctr.apply(Buffer.from(data));
    const mac = createHmac('sha1', Buffer.from(dk.subarray(keyLen, 2 * keyLen))).update(ct).digest().subarray(0, 10);
    return Buffer.concat([s, dk.subarray(2 * keyLen, 2 * keyLen + 2), ct, mac]);
}
