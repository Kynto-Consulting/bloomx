import { createHash, randomBytes } from 'node:crypto';

/**
 * PKCE (RFC 7636). SOLO el metodo S256: `plain` no existe en este codigo (RFC 9700 §2.1.1: nunca `plain` si S256 es posible).
 * El verificador son 32 bytes aleatorios en base64url = 43 caracteres (minimo del RFC), alfabeto [A-Za-z0-9-._~].
 */
export const PKCE_METHOD = 'S256' as const;
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

export function generateCodeVerifier(): string {
    return randomBytes(32).toString('base64url');
}

export function isValidCodeVerifier(value: unknown): value is string {
    return typeof value === 'string' && VERIFIER_RE.test(value);
}

/** BASE64URL(SHA256(ASCII(verifier))) sin relleno (RFC 7636 §4.2). */
export function codeChallengeS256(verifier: string): string {
    if (!isValidCodeVerifier(verifier)) throw new Error('invalid_code_verifier');
    return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}
