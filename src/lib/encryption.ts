import crypto from 'crypto';

// Cifrado en reposo de campos sensibles.
// CIS 3.11, NIST SC-28 / SC-13 / SC-12, ISO 27002 8.24.
// Formato nuevo (v2): "v2:<iv hex>:<tag hex>:<ciphertext hex>" con AES-256-GCM (cifrado autenticado, IV de 12 bytes).
// Formato legado: "<iv hex>:<ciphertext hex>" AES-256-CBC (solo lectura, para compatibilidad hacia atras).
const GCM_IV_LENGTH = 12;
const LEGACY_IV_LENGTH = 16;

function getSecret(): string {
    const secret = process.env.DATA_ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET;
    if (!secret) {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('DATA_ENCRYPTION_KEY (or NEXTAUTH_SECRET) is required in production');
        }
        return 'dev-fallback-secret-key-32-chars!!';
    }
    return secret;
}

// Clave legada (derivacion heredada, se mantiene solo para descifrar datos existentes)
const getLegacyKey = () => {
    return crypto.createHash('sha256').update(String(getSecret())).digest('base64').substring(0, 32);
};

// Clave v2: 32 bytes completos derivados con HKDF-SHA256 (separacion de dominio por contexto)
const getKeyV2 = () => {
    return Buffer.from(
        crypto.hkdfSync('sha256', Buffer.from(getSecret()), Buffer.alloc(0), Buffer.from('bloomx:data-encryption:v2'), 32)
    );
};

export function encrypt(text: string): string {
    if (!text) return text;
    // Falla cerrado: nunca devolver el texto plano si el cifrado falla
    const iv = crypto.randomBytes(GCM_IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', getKeyV2(), iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v2:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(text: string): string {
    if (!text) return text;
    try {
        const textParts = text.split(':');

        if (textParts.length === 4 && textParts[0] === 'v2') {
            const iv = Buffer.from(textParts[1], 'hex');
            const tag = Buffer.from(textParts[2], 'hex');
            const data = Buffer.from(textParts[3], 'hex');
            const decipher = crypto.createDecipheriv('aes-256-gcm', getKeyV2(), iv);
            decipher.setAuthTag(tag);
            return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
        }

        if (textParts.length !== 2) return text; // Not encrypted or legacy plaintext

        const iv = Buffer.from(textParts[0], 'hex');
        if (iv.length !== LEGACY_IV_LENGTH) return text;
        const encryptedText = Buffer.from(textParts[1], 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(getLegacyKey()), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (e) {
        if (text.startsWith('v2:')) {
            // Fallo de autenticacion / manipulacion o clave incorrecta (sin registrar el contenido)
            console.warn('[ENCRYPTION] v2 decryption failed (bad key or tampered data)');
        }
        // Likely because it wasn't encrypted (legacy plaintext)
        return text;
    }
}

export function encryptObject(obj: any): any {
    if (typeof obj !== 'object' || obj === null) return obj;
    const newObj: any = Array.isArray(obj) ? [] : {};
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const value = obj[key];
            if (typeof value === 'string') {
                // Heuristic: Encrypt if it looks like a token/key or is in a known set?
                // The user wants EVERYTHING encrypted in this context essentially.
                // But simple strings like "true"/"false" toggles?
                // Let's encrypt EVERYTHING in expansionSettings strings just to be safe and uniform?
                // Or checking keys: 'key', 'token', 'secret', 'password', 'id' (maybe not id)
                // Let's rely on the caller to pass specific objects or encrypt all strings in generic set.
                // For expansionSettings specifically, we will encrypt ALL strings.
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
