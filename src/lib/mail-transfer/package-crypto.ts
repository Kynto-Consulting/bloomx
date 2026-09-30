/**
 * package-crypto.ts - cifrado del paquete de exportacion (contenedor "BLMXENC1").
 *
 * Formato (todo big-endian):
 *   cabecera (37 bytes):
 *     0   8   magic "BLMXENC1"
 *     8   1   version (1)
 *     9   1   kdf (1 = scrypt)
 *     10  1   log2(N)  (15)
 *     11  1   r        (8)
 *     12  1   p        (1)
 *     13  16  salt
 *     29  4   prefijo de nonce
 *     33  4   tamano de registro en claro (1 MiB)
 *   registros, repetidos:
 *     4   longitud del texto cifrado (incluye la etiqueta GCM de 16 bytes)
 *     n   AES-256-GCM(clave, nonce = prefijo(4) || contador(8), AAD = cabecera(37) || byte_final, texto)
 *   El ultimo registro es SIEMPRE un registro vacio con byte_final = 1: si falta, el archivo esta truncado.
 *
 * Clave = scrypt(contrasena UTF-8 NFC, salt, 32). La contrasena no se guarda nunca; durante el trabajo el servidor conserva
 * la CLAVE derivada cifrada con la clave de datos de la instancia (lib/encryption.ts) y la borra al terminar.
 * Herramienta de descifrado independiente: scripts/bloomx-decrypt.mjs.
 */
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';

export const ENC_MAGIC = 'BLMXENC1';
export const ENC_HEADER_LEN = 37;
export const ENC_RECORD_SIZE = 1024 * 1024;
export const SCRYPT_LOG2N = 15;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;

export interface EncryptionParams {
    salt: Buffer;
    noncePrefix: Buffer;
    key: Buffer;
}

export function deriveKey(password: string, salt: Buffer): Buffer {
    return scryptSync(Buffer.from(password.normalize('NFC'), 'utf8'), salt, 32, {
        N: 1 << SCRYPT_LOG2N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: 128 * 1024 * 1024,
    });
}

export function newEncryptionParams(password: string): EncryptionParams {
    const salt = randomBytes(16);
    return { salt, noncePrefix: randomBytes(4), key: deriveKey(password, salt) };
}

export function buildEncHeader(p: Pick<EncryptionParams, 'salt' | 'noncePrefix'>): Buffer {
    const h = Buffer.alloc(ENC_HEADER_LEN);
    h.write(ENC_MAGIC, 0, 'latin1');
    h[8] = 1;
    h[9] = 1;
    h[10] = SCRYPT_LOG2N;
    h[11] = SCRYPT_R;
    h[12] = SCRYPT_P;
    p.salt.copy(h, 13);
    p.noncePrefix.copy(h, 29);
    h.writeUInt32BE(ENC_RECORD_SIZE, 33);
    return h;
}

/** Cifrador por registros con contador persistible (para continuar entre invocaciones). */
export class PackageEncryptor {
    readonly header: Buffer;
    constructor(private params: EncryptionParams, public counter = 0) {
        this.header = buildEncHeader(params);
    }

    private record(plain: Buffer, final: boolean): Buffer {
        const iv = Buffer.alloc(12);
        this.params.noncePrefix.copy(iv, 0);
        iv.writeBigUInt64BE(BigInt(this.counter++), 4);
        const cipher = createCipheriv('aes-256-gcm', this.params.key, iv);
        cipher.setAAD(Buffer.concat([this.header, Buffer.from([final ? 1 : 0])]));
        const ct = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(ct.length, 0);
        return Buffer.concat([len, ct]);
    }

    /** Cifra datos arbitrarios en registros de hasta ENC_RECORD_SIZE. */
    encrypt(plain: Buffer): Buffer {
        const out: Buffer[] = [];
        for (let o = 0; o < plain.length; o += ENC_RECORD_SIZE) out.push(this.record(plain.subarray(o, Math.min(plain.length, o + ENC_RECORD_SIZE)), false));
        return out.length === 1 ? out[0] : Buffer.concat(out);
    }

    /** Registro final (obligatorio). */
    finalRecord(): Buffer {
        return this.record(Buffer.alloc(0), true);
    }
}
