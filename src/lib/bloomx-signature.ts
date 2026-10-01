import crypto from 'node:crypto';

/**
 * Firmas Ed25519 del protocolo BloomX (espejo de bloomx-backend/src/lib/signing.ts; mismo mensaje canonico).
 * Sin secretos compartidos: esta instancia firma con SU clave privada (BLOOMX_DOMAIN_PRIVATE_KEY) y el backend la
 * verifica con la clave publica registrada; el backend firma con la suya y aqui se verifica con su clave publica.
 * Solo node:crypto (probable sin mocks).
 *
 * Mensaje (v1), lineas unidas con "\n": BLOOMX-SIG-V1, METODO, ruta+query, sha256(cuerpo) hex, dominio, timestamp (s),
 * nonce, x-user-id, x-user-email, x-bloomx-callback. Cabeceras: X-BloomX-Signature (base64url), X-BloomX-Timestamp,
 * X-BloomX-Nonce. Ventana +-120 s; anti-replay por nonce.
 */

export const SIGNATURE_VERSION_LINE = 'BLOOMX-SIG-V1';
/** Mensaje V2: V1 + X-BloomX-Client-Api y X-BloomX-Client-Caps (ver canonicalString). */
export const SIGNATURE_VERSION_LINE_V2 = 'BLOOMX-SIG-V2';
export const SIGNATURE_WINDOW_SECONDS = 120;
export const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;

export interface CanonicalParts {
    method: string;
    /** pathname + search */
    pathAndQuery: string;
    bodySha256Hex: string;
    domain: string;
    timestamp: string | number;
    nonce: string;
    userId?: string | null;
    userEmail?: string | null;
    callback?: string | null;
    /** X-BloomX-Client-Api / X-BloomX-Client-Caps tal como viajan. Si alguno esta presente (no null/undefined) el mensaje es V2 y los firma. */
    clientApi?: string | null;
    clientCaps?: string | null;
}

export const sha256Hex = (data: string | Buffer): string => crypto.createHash('sha256').update(data).digest('hex');
const clean = (v: unknown) => String(v ?? '').replace(/[\r\n]/g, ' ');

export function canonicalString(p: CanonicalParts): string {
    // V2 = V1 + cabeceras de version del cliente (firmadas: no se pueden quitar ni anadir sin invalidar la firma). Sin ellas, V1 intacto.
    const withClient = (p.clientApi !== undefined && p.clientApi !== null) || (p.clientCaps !== undefined && p.clientCaps !== null);
    return [
        withClient ? SIGNATURE_VERSION_LINE_V2 : SIGNATURE_VERSION_LINE,
        clean(p.method).toUpperCase(),
        clean(p.pathAndQuery),
        clean(p.bodySha256Hex).toLowerCase(),
        clean(p.domain).toLowerCase(),
        clean(p.timestamp),
        clean(p.nonce),
        clean(p.userId),
        clean(p.userEmail),
        clean(p.callback),
        ...(withClient ? [clean(p.clientApi), clean(p.clientCaps)] : []),
    ].join('\n');
}

export const b64urlEncode = (buf: Buffer): string => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const b64urlDecode = (s: string): Buffer => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** Clave publica Ed25519: PEM SPKI, o base64/base64url de DER SPKI (44 bytes) o de la clave cruda (32 bytes). */
export function parseEd25519PublicKey(input: unknown): crypto.KeyObject | null {
    if (typeof input !== 'string') return null;
    const text = input.trim();
    if (!text || text.length > 4096) return null;
    try {
        let key: crypto.KeyObject;
        if (text.includes('BEGIN')) key = crypto.createPublicKey(text);
        else {
            const raw = b64urlDecode(text);
            key =
                raw.length === 32
                    ? crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b64urlEncode(raw) }, format: 'jwk' })
                    : crypto.createPublicKey({ key: raw, format: 'der', type: 'spki' });
        }
        return key.asymmetricKeyType === 'ed25519' ? key : null;
    } catch {
        return null;
    }
}

/** Clave privada Ed25519: PEM PKCS8, base64 de DER PKCS8 (48 bytes) o base64 de la semilla cruda (32 bytes). */
export function parseEd25519PrivateKey(input: unknown): crypto.KeyObject | null {
    if (typeof input !== 'string') return null;
    const text = input.trim().replace(/\\n/g, '\n');
    if (!text) return null;
    try {
        let key: crypto.KeyObject;
        if (text.includes('BEGIN')) key = crypto.createPrivateKey(text);
        else {
            const raw = b64urlDecode(text);
            key = crypto.createPrivateKey({ key: raw.length === 32 ? Buffer.concat([PKCS8_ED25519_PREFIX, raw]) : raw, format: 'der', type: 'pkcs8' });
        }
        return key.asymmetricKeyType === 'ed25519' ? key : null;
    } catch {
        return null;
    }
}

/** Clave publica en forma canonica (base64url de 32 bytes) a partir de la privada: la que se registra en el backend. */
export function publicKeyFromPrivate(privateKey: crypto.KeyObject): string {
    return (crypto.createPublicKey(privateKey).export({ format: 'jwk' }) as { x: string }).x;
}

export function generateEd25519KeyPair(): { privatePem: string; publicPem: string; publicKey: string } {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    return {
        privatePem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
        publicPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
        publicKey: (publicKey.export({ format: 'jwk' }) as { x: string }).x,
    };
}

export const newNonce = (): string => b64urlEncode(crypto.randomBytes(18));

export function signCanonical(privateKey: crypto.KeyObject, canonical: string): string {
    return b64urlEncode(crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKey));
}

export function verifyCanonical(publicKey: crypto.KeyObject, canonical: string, signatureB64url: string): boolean {
    try {
        const sig = b64urlDecode(signatureB64url);
        return sig.length === 64 && crypto.verify(null, Buffer.from(canonical, 'utf8'), publicKey, sig);
    } catch {
        return false;
    }
}

export interface SignedHeaders {
    'X-BloomX-Signature': string;
    'X-BloomX-Timestamp': string;
    'X-BloomX-Nonce': string;
}

export function signRequest(
    privateKey: crypto.KeyObject,
    parts: Omit<CanonicalParts, 'timestamp' | 'nonce' | 'bodySha256Hex'> & { body: string; nowMs?: number; nonce?: string },
): SignedHeaders {
    const timestamp = String(Math.floor((parts.nowMs ?? Date.now()) / 1000));
    const nonce = parts.nonce ?? newNonce();
    const canonical = canonicalString({ ...parts, timestamp, nonce, bodySha256Hex: sha256Hex(parts.body) });
    return { 'X-BloomX-Signature': signCanonical(privateKey, canonical), 'X-BloomX-Timestamp': timestamp, 'X-BloomX-Nonce': nonce };
}

/** Anti-replay por nonce en memoria de la instancia. */
export class NonceStore {
    private seen = new Map<string, number>();
    private readonly ttlMs: number;
    private readonly max: number;
    constructor(ttlMs: number = (SIGNATURE_WINDOW_SECONDS * 2 + 5) * 1000, max = 50_000) {
        this.ttlMs = ttlMs;
        this.max = max;
    }
    consume(key: string, nowMs: number = Date.now()): boolean {
        if (this.seen.size >= this.max) {
            for (const [k, exp] of this.seen) if (exp <= nowMs) this.seen.delete(k);
            while (this.seen.size >= this.max) {
                const first = this.seen.keys().next().value;
                if (first === undefined) break;
                this.seen.delete(first);
            }
        }
        const exp = this.seen.get(key);
        if (exp !== undefined && exp > nowMs) return false;
        this.seen.set(key, nowMs + this.ttlMs);
        return true;
    }
}

const defaultNonces = new NonceStore();

export interface HeaderReader {
    get(name: string): string | null;
}

/**
 * Verifica una peticion firmada por el BACKEND (puente services.mail): firma valida con la clave publica del backend,
 * ventana de tiempo, nonce no repetido y `domain` = esta instancia (audiencia). `expectedDomains` son los nombres con
 * los que esta instancia se conoce (TOP_DOMAIN / host de NEXT_PUBLIC_APP_URL).
 */
export function verifyBackendSignature(input: {
    method: string;
    url: string;
    headers: HeaderReader;
    rawBody: string;
    backendPublicKey: crypto.KeyObject;
    expectedDomains: string[];
    nowMs?: number;
    nonces?: NonceStore;
}): { ok: true; userId: string | null } | { ok: false } {
    const h = input.headers;
    const signature = h.get('x-bloomx-signature');
    const timestamp = h.get('x-bloomx-timestamp');
    const nonce = h.get('x-bloomx-nonce');
    const domain = (h.get('x-bloomx-domain') || '').trim().toLowerCase().split(':')[0];
    const nowMs = input.nowMs ?? Date.now();
    if (!signature || !timestamp || !nonce || !NONCE_RE.test(nonce) || !/^\d{9,12}$/.test(timestamp)) return { ok: false };
    if (Math.abs(nowMs / 1000 - Number(timestamp)) > SIGNATURE_WINDOW_SECONDS) return { ok: false };
    if (!domain || !input.expectedDomains.map((d) => d.toLowerCase()).includes(domain)) return { ok: false };

    let pathAndQuery: string;
    try {
        const u = new URL(input.url);
        pathAndQuery = `${u.pathname}${u.search}`;
    } catch {
        return { ok: false };
    }
    const userId = h.get('x-user-id');
    const canonical = canonicalString({
        method: input.method,
        pathAndQuery,
        bodySha256Hex: sha256Hex(input.rawBody),
        domain,
        timestamp,
        nonce,
        userId,
        userEmail: h.get('x-user-email'),
        callback: h.get('x-bloomx-callback'),
    });
    if (!verifyCanonical(input.backendPublicKey, canonical, signature)) return { ok: false };
    if (!(input.nonces ?? defaultNonces).consume(`backend:${nonce}`, nowMs)) return { ok: false };
    return { ok: true, userId: userId || null };
}
