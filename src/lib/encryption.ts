import crypto from 'crypto';

// Cifrado en reposo de campos sensibles.
// CIS v8 3.11, NIST 800-53 SC-28 / SC-13 / SC-12, ISO 27001:2022 A.8.24.
//
// Formatos (todos se pueden LEER; solo se ESCRIBE el configurado en ENCRYPTION_WRITE_FORMAT, por defecto v3):
//   v1 (legado):  "<iv hex 16B>:<ciphertext hex>"                      AES-256-CBC, clave = sha256(secreto)[base64][0..32]
//   v2:           "v2:<iv hex 12B>:<tag hex>:<ciphertext hex>"         AES-256-GCM, clave = HKDF(secreto, info "bloomx:data-encryption:v2")
//   v3:           "v3:<keyId>:<iv hex 12B>:<tag hex>:<ciphertext hex>" AES-256-GCM, clave = HKDF(secreto[keyId], info "bloomx:data-encryption:v3:<keyId>")
//                 (el keyId va en AAD: no se puede mover un ciphertext entre ids sin invalidarlo)
//
// Claves:
//   DATA_ENCRYPTION_KEY            clave vigente (obligatoria en produccion si ENCRYPTION_REQUIRE_DEDICATED_KEY=true)
//   DATA_ENCRYPTION_KEY_ID         identificador de la clave vigente (por defecto "k1")
//   DATA_ENCRYPTION_KEYS_PREVIOUS  claves retiradas para poder descifrar durante la rotacion: "k0:secreto0,kx:secretox"
//   NEXTAUTH_SECRET                se usa como reserva (id "auth"): datos cifrados antes de separar claves siguen legibles.
//
// Rotacion: 1) definir nueva DATA_ENCRYPTION_KEY + nuevo _ID, 2) mover la anterior a _PREVIOUS,
// 3) los datos se re-cifran de forma perezosa (needsReencrypt/reencrypt) o con un script, 4) retirar la clave vieja.
const GCM_IV_LENGTH = 12;
const LEGACY_IV_LENGTH = 16;
const DEV_FALLBACK_SECRET = 'dev-fallback-secret-key-32-chars!!';

type KeyEntry = { id: string; secret: string };

let warnedFallback = false;

function parsePrevious(raw: string | undefined): KeyEntry[] {
    if (!raw) return [];
    return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((pair) => {
            const i = pair.indexOf(':');
            return i > 0 ? { id: pair.slice(0, i).trim(), secret: pair.slice(i + 1) } : null;
        })
        .filter((e): e is KeyEntry => !!e && !!e.id && !!e.secret);
}

/** Clave vigente + retiradas + reserva. La primera entrada es la usada para cifrar. */
export function getKeyring(): { current: KeyEntry; all: KeyEntry[] } {
    const isProd = process.env.NODE_ENV === 'production';
    const dedicated = process.env.DATA_ENCRYPTION_KEY;
    const authSecret = process.env.NEXTAUTH_SECRET;

    let current: KeyEntry;
    if (dedicated) {
        // El id viaja dentro del texto cifrado separado por ":", por eso se restringe el alfabeto.
        current = { id: (process.env.DATA_ENCRYPTION_KEY_ID || 'k1').trim().replace(/[^A-Za-z0-9_.-]/g, '_') || 'k1', secret: dedicated };
    } else if (authSecret) {
        if (isProd && process.env.ENCRYPTION_REQUIRE_DEDICATED_KEY === 'true') {
            throw new Error('DATA_ENCRYPTION_KEY is required in production (ENCRYPTION_REQUIRE_DEDICATED_KEY=true)');
        }
        if (isProd && !warnedFallback) {
            warnedFallback = true;
            console.warn('[ENCRYPTION] DATA_ENCRYPTION_KEY no definida: se usa NEXTAUTH_SECRET como clave de datos. Define una clave dedicada.');
        }
        current = { id: 'auth', secret: authSecret };
    } else {
        if (isProd) throw new Error('DATA_ENCRYPTION_KEY (or NEXTAUTH_SECRET) is required in production');
        current = { id: 'dev', secret: DEV_FALLBACK_SECRET };
    }

    const all: KeyEntry[] = [current, ...parsePrevious(process.env.DATA_ENCRYPTION_KEYS_PREVIOUS)];
    if (authSecret) all.push({ id: 'auth', secret: authSecret });
    // Sin duplicados (mismo id+secreto)
    const seen = new Set<string>();
    const dedup = all.filter((e) => {
        const k = `${e.id}\0${e.secret}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
    return { current, all: dedup };
}

// v1: derivacion heredada, solo para descifrar datos existentes
function legacyKey(secret: string): Buffer {
    return Buffer.from(crypto.createHash('sha256').update(String(secret)).digest('base64').substring(0, 32));
}

// v2: 32 bytes completos con HKDF-SHA256 (separacion de dominio por contexto)
function keyV2(secret: string): Buffer {
    return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.alloc(0), Buffer.from('bloomx:data-encryption:v2'), 32));
}

function keyV3(secret: string, keyId: string): Buffer {
    return Buffer.from(
        crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.alloc(0), Buffer.from(`bloomx:data-encryption:v3:${keyId}`), 32)
    );
}

function gcmDecrypt(key: Buffer, iv: Buffer, tag: Buffer, data: Buffer, aad?: Buffer): string {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    if (aad) decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export type EncryptionFormat = 'v1' | 'v2' | 'v3' | 'plain';

/** Detecta el formato por estructura (no valida la clave). Un texto plano devuelve 'plain'. */
export function detectFormat(text: string): { format: EncryptionFormat; keyId?: string } {
    if (!text || typeof text !== 'string') return { format: 'plain' };
    const parts = text.split(':');
    if (parts[0] === 'v3' && parts.length === 5 && /^[0-9a-f]{24}$/i.test(parts[2])) return { format: 'v3', keyId: parts[1] };
    if (parts[0] === 'v2' && parts.length === 4 && /^[0-9a-f]{24}$/i.test(parts[1])) return { format: 'v2' };
    if (parts.length === 2 && /^[0-9a-f]{32}$/i.test(parts[0]) && /^[0-9a-f]+$/i.test(parts[1]) && parts[1].length % 32 === 0) return { format: 'v1' };
    return { format: 'plain' };
}

export function isEncrypted(text: unknown): boolean {
    return typeof text === 'string' && detectFormat(text).format !== 'plain';
}

export function encrypt(text: string): string {
    if (!text) return text;
    // Falla cerrado: nunca devolver el texto plano si el cifrado falla
    const iv = crypto.randomBytes(GCM_IV_LENGTH);
    const { current } = getKeyring();
    const writeFormat = (process.env.ENCRYPTION_WRITE_FORMAT || 'v3').toLowerCase();

    if (writeFormat === 'v2') {
        const cipher = crypto.createCipheriv('aes-256-gcm', keyV2(current.secret), iv);
        const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
        return `v2:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
    }

    const cipher = crypto.createCipheriv('aes-256-gcm', keyV3(current.secret, current.id), iv);
    cipher.setAAD(Buffer.from(`bloomx:v3:${current.id}`));
    const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return `v3:${current.id}:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
}

/**
 * Descifra v1/v2/v3. Devuelve `null` si el texto ESTA cifrado (por estructura) pero no se pudo descifrar
 * (clave incorrecta / manipulado), y el propio texto si no parece cifrado (compatibilidad con texto plano).
 */
export function tryDecrypt(text: string): string | null {
    if (!text) return text;
    const { format, keyId } = detectFormat(text);
    if (format === 'plain') return text;

    const { all } = getKeyring();
    const parts = text.split(':');
    try {
        if (format === 'v3') {
            const iv = Buffer.from(parts[2], 'hex');
            const tag = Buffer.from(parts[3], 'hex');
            const data = Buffer.from(parts[4], 'hex');
            // Primero la clave con ese id; luego el resto (por si el id se reasigno)
            const ordered = [...all.filter((k) => k.id === keyId), ...all.filter((k) => k.id !== keyId)];
            for (const k of ordered) {
                try {
                    // El AAD lleva el id cifrado en el texto, no el de la clave candidata
                    return gcmDecrypt(keyV3(k.secret, keyId!), iv, tag, data, Buffer.from(`bloomx:v3:${keyId}`));
                } catch { /* probar la siguiente */ }
            }
            return null;
        }

        if (format === 'v2') {
            const iv = Buffer.from(parts[1], 'hex');
            const tag = Buffer.from(parts[2], 'hex');
            const data = Buffer.from(parts[3], 'hex');
            for (const k of all) {
                try {
                    return gcmDecrypt(keyV2(k.secret), iv, tag, data);
                } catch { /* siguiente */ }
            }
            return null;
        }

        // v1 (CBC)
        const iv = Buffer.from(parts[0], 'hex');
        if (iv.length !== LEGACY_IV_LENGTH) return text;
        const encryptedText = Buffer.from(parts[1], 'hex');
        for (const k of all) {
            try {
                const decipher = crypto.createDecipheriv('aes-256-cbc', legacyKey(k.secret), iv);
                return Buffer.concat([decipher.update(encryptedText), decipher.final()]).toString();
            } catch { /* siguiente (padding invalido = clave incorrecta) */ }
        }
        // v1 no autentica: si nada descifra, se trata como texto plano heredado
        return text;
    } catch {
        return null;
    }
}

export function decrypt(text: string): string {
    if (!text) return text;
    const out = tryDecrypt(text);
    if (out === null) {
        // Fallo de autenticacion / manipulacion o clave incorrecta (sin registrar el contenido)
        console.warn('[ENCRYPTION] decryption failed (bad key or tampered data)');
        return text;
    }
    return out;
}

/** True si el valor no esta en el formato de escritura vigente / con la clave vigente (candidato a re-cifrado perezoso). */
export function needsReencrypt(text: string): boolean {
    if (!text) return false;
    const { format, keyId } = detectFormat(text);
    if (format === 'plain') return true;
    const writeFormat = (process.env.ENCRYPTION_WRITE_FORMAT || 'v3').toLowerCase();
    if (writeFormat === 'v2') return format !== 'v2';
    return format !== 'v3' || keyId !== getKeyring().current.id;
}

/** Re-cifra con la clave/formato vigentes. Devuelve null si no se puede descifrar. */
export function reencrypt(text: string): string | null {
    const plain = tryDecrypt(text);
    if (plain === null) return null;
    return encrypt(plain);
}

export function encryptObject(obj: any): any {
    if (typeof obj !== 'object' || obj === null) return obj;
    const newObj: any = Array.isArray(obj) ? [] : {};
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const value = obj[key];
            if (typeof value === 'string') {
                // expansionSettings: se cifran TODAS las cadenas (uniforme, sin heuristicas por nombre de clave)
                newObj[key] = encrypt(value);
            } else if (typeof value === 'object') {
                newObj[key] = encryptObject(value);
            } else {
                newObj[key] = value;
            }
        }
    }
    return newObj;
}

export function decryptObject(obj: any): any {
    if (typeof obj !== 'object' || obj === null) return obj;
    const newObj: any = Array.isArray(obj) ? [] : {};
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const value = obj[key];
            if (typeof value === 'string') {
                newObj[key] = decrypt(value);
            } else if (typeof value === 'object') {
                newObj[key] = decryptObject(value);
            } else {
                newObj[key] = value;
            }
        }
    }
    return newObj;
}
