import crypto from 'crypto';

// TOTP (RFC 6238) sobre HOTP (RFC 4226) con solo `crypto` de Node. Sin dependencias.
// NIST 800-63B 5.1.4 (OTP multifactor / AAL2), CIS v8 6.3-6.5, ISO 27001:2022 A.8.5.

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';

export interface TotpOptions {
    digits?: number;      // 6-8 (por defecto 6)
    period?: number;      // segundos (por defecto 30)
    algorithm?: TotpAlgorithm; // por defecto SHA1 (lo unico que soportan todas las apps)
}

export function base32Encode(buf: Buffer): string {
    let bits = 0;
    let value = 0;
    let out = '';
    for (const byte of buf) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
    return out;
}

export function base32Decode(input: string): Buffer {
    const clean = String(input).toUpperCase().replace(/[\s=-]/g, '');
    let bits = 0;
    let value = 0;
    const out: number[] = [];
    for (const ch of clean) {
        const idx = B32_ALPHABET.indexOf(ch);
        if (idx === -1) throw new Error('Invalid base32 character');
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return Buffer.from(out);
}

/** Secreto aleatorio de 160 bits (recomendacion RFC 4226 4) en base32. */
export function generateTotpSecret(bytes = 20): string {
    return base32Encode(crypto.randomBytes(bytes));
}

/** HOTP (RFC 4226 5.3). `counter` puede ser un entero de hasta 2^53. */
export function hotp(secret: Buffer, counter: number, digits = 6, algorithm: TotpAlgorithm = 'SHA1'): string {
    const msg = Buffer.alloc(8);
    msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
    msg.writeUInt32BE(counter >>> 0, 4);
    const hmac = crypto.createHmac(algorithm.toLowerCase(), secret).update(msg).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const bin =
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff);
    return String(bin % 10 ** digits).padStart(digits, '0');
}

export function totpStep(timeMs: number = Date.now(), period = 30): number {
    return Math.floor(timeMs / 1000 / period);
}

/** Codigo TOTP para un instante (RFC 6238). `secret` en base32. */
export function totp(secretBase32: string, timeMs: number = Date.now(), opts: TotpOptions = {}): string {
    const { digits = 6, period = 30, algorithm = 'SHA1' } = opts;
    return hotp(base32Decode(secretBase32), totpStep(timeMs, period), digits, algorithm);
}

/**
 * Verifica un codigo con ventana +-`window` pasos (tolera deriva de reloj).
 * Devuelve el paso coincidente (para anti-replay: el llamador debe rechazar step <= ultimo paso usado) o null.
 * Comparacion en tiempo constante.
 */
export function verifyTotp(
    secretBase32: string,
    code: string,
    opts: TotpOptions & { window?: number; timeMs?: number } = {}
): number | null {
    const { digits = 6, period = 30, algorithm = 'SHA1', window = 1, timeMs = Date.now() } = opts;
    const clean = String(code ?? '').replace(/\s+/g, '');
    if (!new RegExp(`^\\d{${digits}}$`).test(clean)) return null;
    const secret = base32Decode(secretBase32);
    const current = totpStep(timeMs, period);
    let matched: number | null = null;
    // Se recorren todas las ventanas sin cortar para no filtrar por tiempo cual coincidio.
    for (let w = -window; w <= window; w++) {
        const step = current + w;
        if (step < 0) continue;
        const expected = hotp(secret, step, digits, algorithm);
        const a = Buffer.from(expected);
        const b = Buffer.from(clean);
        if (a.length === b.length && crypto.timingSafeEqual(a, b) && matched === null) matched = step;
    }
    return matched;
}

/** URI otpauth:// (formato Key URI de Google Authenticator) para QR / entrada manual. */
export function buildOtpauthUri(params: { secret: string; account: string; issuer: string } & TotpOptions): string {
    const { secret, account, issuer, digits = 6, period = 30, algorithm = 'SHA1' } = params;
    const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
    const q = new URLSearchParams({ secret, issuer, algorithm, digits: String(digits), period: String(period) });
    return `otpauth://totp/${label}?${q.toString()}`;
}

// ---------------------------------------------------------------------------
// Codigos de recuperacion (un solo uso). Se guardan solo como HMAC-SHA256.
// ---------------------------------------------------------------------------
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I/L

export function generateRecoveryCodes(count = 10): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
        const bytes = crypto.randomBytes(10);
        let raw = '';
        for (const b of bytes) raw += RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length];
        codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
    }
    return codes;
}

export function normalizeRecoveryCode(code: string): string {
    return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashRecoveryCode(code: string, pepper: string): string {
    return crypto.createHmac('sha256', pepper).update(`mfa-recovery:${normalizeRecoveryCode(code)}`).digest('hex');
}
