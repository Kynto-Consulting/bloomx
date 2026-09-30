/**
 * Cifrado de "envio sellado" (WebCrypto, corre en el NAVEGADOR; tambien en Node >= 20 para las pruebas).
 *
 * Protocolo v1
 *  - Contenido: JSON {s: asunto, h: html} en UTF-8, cifrado con AES-256-GCM, IV aleatorio de 96 bits.
 *  - Clave K: 256 bits aleatorios generados en el navegador del remitente. Viaja SOLO en el fragmento de la URL
 *    (`/secure/<id>#k=<base64url>`): los navegadores no envian el fragmento al servidor ni en Referer.
 *  - Contrasena opcional (segundo factor): P = PBKDF2-SHA256(NFKC(contrasena), sal 128 bits, `iter` iteraciones);
 *    la clave de contenido es HKDF-SHA256(K || P, sal, info "bloomx-sealed-v1"). Hacen falta AMBAS cosas
 *    (fragmento y contrasena): con solo una no se puede descifrar ni acotar la busqueda de la otra.
 *  - AAD (datos autenticados): "bloomx-sealed:v1:nopw" o "bloomx-sealed:v1:pw:<iter>". Cambiar el indicador de
 *    contrasena o el numero de iteraciones invalida el tag (anti downgrade por parte del servidor).
 *  - El servidor solo guarda el sobre {iv, ct, salt?, iter?, pw}; nunca ve K ni la contrasena.
 *
 * Limites que NO cubre (ver docs): quien pueda leer el correo con el enlace (buzon, proveedor SMTP) obtiene K; por eso la
 * contrasena debe compartirse por otro canal. La longitud del mensaje no se oculta (sin relleno).
 */

export const SEALED_VERSION = 1;
export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PBKDF2_ITERATIONS = 100_000;
export const MAX_PBKDF2_ITERATIONS = 2_000_000;
export const MAX_PLAINTEXT_BYTES = 700_000;
export const KEY_BYTES = 32;
export const IV_BYTES = 12;
export const SALT_BYTES = 16;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 256;

export type SealedErrorCode =
    | 'WEBCRYPTO_UNAVAILABLE'
    | 'PAYLOAD_TOO_LARGE'
    | 'INVALID_ENVELOPE'
    | 'INVALID_KEY'
    | 'PASSWORD_REQUIRED'
    | 'DECRYPT_FAILED';

export class SealedCryptoError extends Error {
    readonly code: SealedErrorCode;
    constructor(code: SealedErrorCode, message?: string) {
        super(message || code);
        this.name = 'SealedCryptoError';
        this.code = code;
    }
}

export interface SealedEnvelope {
    v: 1;
    alg: 'A256GCM';
    iv: string;
    ct: string;
    pw: boolean;
    kdf?: 'PBKDF2-SHA256';
    iter?: number;
    salt?: string;
}

export interface SealedPayload {
    subject: string;
    html: string;
}

// ---------- base64url estricto ----------

const B64U_RE = /^[A-Za-z0-9_-]*$/;

export function b64uEncode(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uDecode(input: string): Uint8Array {
    if (typeof input !== 'string' || !B64U_RE.test(input) || input.length % 4 === 1) {
        throw new SealedCryptoError('INVALID_ENVELOPE', 'invalid base64url');
    }
    const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
    let bin: string;
    try {
        bin = atob(b64);
    } catch {
        throw new SealedCryptoError('INVALID_ENVELOPE', 'invalid base64url');
    }
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

function webcrypto(): Crypto {
    const c: Crypto | undefined = (globalThis as any).crypto;
    if (!c || !c.subtle || typeof c.getRandomValues !== 'function') throw new SealedCryptoError('WEBCRYPTO_UNAVAILABLE');
    return c;
}

function randomBytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    webcrypto().getRandomValues(out);
    return out;
}

function normalizePassword(password: string): Uint8Array {
    return enc.encode(String(password).normalize('NFKC'));
}

function aadFor(envelope: Pick<SealedEnvelope, 'pw' | 'iter'>): Uint8Array {
    return enc.encode(envelope.pw ? `bloomx-sealed:v1:pw:${envelope.iter}` : 'bloomx-sealed:v1:nopw');
}

async function deriveContentKey(keyBytes: Uint8Array, password: string | undefined, salt: Uint8Array | undefined, iter: number | undefined, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
    const { subtle } = webcrypto();
    if (!password) {
        return subtle.importKey('raw', keyBytes as BufferSource, 'AES-GCM', false, [usage]);
    }
    if (!salt || !iter) throw new SealedCryptoError('INVALID_ENVELOPE');
    const pwKey = await subtle.importKey('raw', normalizePassword(password) as BufferSource, 'PBKDF2', false, ['deriveBits']);
    const pwBits = new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter }, pwKey, 256));
    const ikm = new Uint8Array(keyBytes.length + pwBits.length);
    ikm.set(keyBytes, 0);
    ikm.set(pwBits, keyBytes.length);
    const base = await subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveKey']);
    return subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: enc.encode('bloomx-sealed-v1') as BufferSource },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        [usage],
    );
}

// ---------- validacion del sobre (lo usa tambien el viewer con datos que vienen del servidor) ----------

export function validateEnvelope(input: unknown): SealedEnvelope {
    const e = input as Record<string, unknown> | null;
    const bad = (why: string) => new SealedCryptoError('INVALID_ENVELOPE', why);
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw bad('not an object');
    if (e.v !== SEALED_VERSION) throw bad('unsupported version');
    if (e.alg !== 'A256GCM') throw bad('unsupported algorithm');
    if (typeof e.pw !== 'boolean') throw bad('pw');
    if (typeof e.iv !== 'string' || b64uDecode(e.iv).length !== IV_BYTES) throw bad('iv');
    if (typeof e.ct !== 'string' || b64uDecode(e.ct).length < 16) throw bad('ct');
    if (e.pw) {
        if (e.kdf !== 'PBKDF2-SHA256') throw bad('kdf');
        if (typeof e.iter !== 'number' || !Number.isInteger(e.iter) || e.iter < MIN_PBKDF2_ITERATIONS || e.iter > MAX_PBKDF2_ITERATIONS) throw bad('iter');
        if (typeof e.salt !== 'string' || b64uDecode(e.salt).length !== SALT_BYTES) throw bad('salt');
        return { v: 1, alg: 'A256GCM', iv: e.iv, ct: e.ct, pw: true, kdf: 'PBKDF2-SHA256', iter: e.iter, salt: e.salt };
    }
    if (e.kdf !== undefined || e.iter !== undefined || e.salt !== undefined) throw bad('unexpected kdf fields');
    return { v: 1, alg: 'A256GCM', iv: e.iv, ct: e.ct, pw: false };
}

// ---------- fragmento de la URL ----------

/** Clave base64url de 32 bytes, o null si el formato no es valido (nunca lanza). */
function decodeKey(value: unknown): Uint8Array | null {
    if (typeof value !== 'string' || !B64U_RE.test(value)) return null;
    try {
        const bytes = b64uDecode(value);
        return bytes.length === KEY_BYTES ? bytes : null;
    } catch {
        return null;
    }
}

/** "#k=<43 chars base64url>" -> clave en base64url, o null. Ignora cualquier otro parametro. */
export function parseKeyFragment(hash: string): string | null {
    const raw = String(hash || '').replace(/^#/, '');
    for (const part of raw.split('&')) {
        if (part.startsWith('k=')) {
            const value = part.slice(2);
            return decodeKey(value) ? value : null;
        }
    }
    return null;
}

export function keyFragment(keyB64u: string): string {
    return `k=${keyB64u}`;
}

// ---------- API ----------

export interface SealOptions {
    password?: string;
    /** Solo para pruebas; por defecto PBKDF2_ITERATIONS. */
    iterations?: number;
}

export async function sealMessage(payload: SealedPayload, options: SealOptions = {}): Promise<{ envelope: SealedEnvelope; key: string; fragment: string }> {
    const { subtle } = webcrypto();
    const plaintext = enc.encode(JSON.stringify({ s: String(payload.subject ?? ''), h: String(payload.html ?? '') }));
    if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new SealedCryptoError('PAYLOAD_TOO_LARGE');

    const password = options.password ? String(options.password) : undefined;
    if (password !== undefined && (password.length < 1 || password.length > MAX_PASSWORD_LENGTH)) throw new SealedCryptoError('INVALID_ENVELOPE', 'invalid password length');
    const iter = password ? Math.min(MAX_PBKDF2_ITERATIONS, Math.max(MIN_PBKDF2_ITERATIONS, options.iterations ?? PBKDF2_ITERATIONS)) : undefined;

    const keyBytes = randomBytes(KEY_BYTES);
    const iv = randomBytes(IV_BYTES);
    const salt = password ? randomBytes(SALT_BYTES) : undefined;
    const partial = { pw: !!password, iter };

    const key = await deriveContentKey(keyBytes, password, salt, iter, 'encrypt');
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: aadFor(partial) as BufferSource, tagLength: 128 }, key, plaintext as BufferSource));

    const envelope: SealedEnvelope = password
        ? { v: 1, alg: 'A256GCM', iv: b64uEncode(iv), ct: b64uEncode(ct), pw: true, kdf: 'PBKDF2-SHA256', iter, salt: b64uEncode(salt!) }
        : { v: 1, alg: 'A256GCM', iv: b64uEncode(iv), ct: b64uEncode(ct), pw: false };
    const keyB64u = b64uEncode(keyBytes);
    keyBytes.fill(0);
    return { envelope, key: keyB64u, fragment: keyFragment(keyB64u) };
}

/**
 * Descifra. Cualquier fallo de autenticacion (clave equivocada, contrasena equivocada, sobre manipulado) da el MISMO
 * error DECRYPT_FAILED: no se distingue el motivo (evita oraculos).
 */
export async function openMessage(envelopeInput: unknown, keyB64u: string, password?: string): Promise<SealedPayload> {
    const envelope = validateEnvelope(envelopeInput);
    const keyBytes = decodeKey(keyB64u);
    if (!keyBytes) throw new SealedCryptoError('INVALID_KEY');
    if (envelope.pw && !password) throw new SealedCryptoError('PASSWORD_REQUIRED');

    let plaintext: Uint8Array;
    try {
        const { subtle } = webcrypto();
        const key = await deriveContentKey(keyBytes, envelope.pw ? password : undefined, envelope.salt ? b64uDecode(envelope.salt) : undefined, envelope.iter, 'decrypt');
        plaintext = new Uint8Array(await subtle.decrypt(
            { name: 'AES-GCM', iv: b64uDecode(envelope.iv) as BufferSource, additionalData: aadFor(envelope) as BufferSource, tagLength: 128 },
            key,
            b64uDecode(envelope.ct) as BufferSource,
        ));
    } catch (e) {
        if (e instanceof SealedCryptoError && e.code === 'WEBCRYPTO_UNAVAILABLE') throw e;
        throw new SealedCryptoError('DECRYPT_FAILED');
    }

    try {
        const parsed = JSON.parse(dec.decode(plaintext));
        if (!parsed || typeof parsed.s !== 'string' || typeof parsed.h !== 'string') throw new Error('shape');
        return { subject: parsed.s, html: parsed.h };
    } catch {
        throw new SealedCryptoError('DECRYPT_FAILED');
    }
}
