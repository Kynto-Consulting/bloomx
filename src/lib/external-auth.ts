import { createHash, randomBytes } from 'node:crypto';

import { safeEqual } from '@/lib/security';

/**
 * "Entrar con Bloomx" para apps externas (p. ej. Killio): esta instancia actua como proveedor de identidad.
 * Flujo authorization-code + PKCE (S256):
 *   GET  /api/auth/external   -> discovery: dice si la instancia lo tiene activado y donde estan los endpoints
 *   GET  /api/auth/authorize  -> con sesion (MFA ya resuelto: la cookie solo se emite tras el segundo factor) emite un codigo de un solo uso
 *   POST /api/auth/token      -> servidor a servidor: client_id + secreto + code + code_verifier + redirect_uri -> identidad
 *
 * Los clientes se declaran en BLOOMX_EXTERNAL_CLIENTS (JSON). Sin clientes validos el flujo esta APAGADO (fail closed):
 *   [{"clientId":"killio","name":"Killio","redirectUris":["https://backend.killio.dev/auth/social/bloomx/callback"]}]   (publico, PKCE)
 *   anadir "secretHash":"<sha256 hex del secreto>" para exigir secreto de cliente
 * Genere el hash con: node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" <secreto>
 */

export const CODE_TTL_SECONDS = 60;

export interface ExternalClient {
    clientId: string;
    name: string;
    /**
     * sha256 hex del secreto del cliente (el secreto en claro nunca se guarda). Opcional: sin el, el cliente es PUBLICO y la
     * seguridad del canje descansa en PKCE (solo quien tiene el code_verifier puede canjear el codigo) y en el redirect_uri exacto.
     */
    secretHash: string | null;
    /** Coincidencia EXACTA; solo https (http solo para localhost fuera de produccion). */
    redirectUris: string[];
}

const CLIENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;
const HEX64_RE = /^[a-f0-9]{64}$/;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

export const sha256Hex = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

export function isAllowedRedirectUri(uri: unknown, production = process.env.NODE_ENV === 'production'): uri is string {
    if (typeof uri !== 'string' || uri.length > 512) return false;
    let u: URL;
    try {
        u = new URL(uri);
    } catch {
        return false;
    }
    if (u.username || u.password || u.hash) return false;
    if (u.protocol === 'https:') return true;
    return !production && u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
}

/** Clientes validos de BLOOMX_EXTERNAL_CLIENTS. Una entrada mal formada se descarta (nunca se ensancha). */
export function parseExternalClients(raw: string | undefined | null, production = process.env.NODE_ENV === 'production'): ExternalClient[] {
    if (!raw || !raw.trim()) return [];
    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        return [];
    }
    if (!Array.isArray(data)) return [];
    const out: ExternalClient[] = [];
    for (const item of data) {
        if (typeof item !== 'object' || item === null) continue;
        const c = item as Record<string, unknown>;
        const redirectUris = Array.isArray(c.redirectUris) ? c.redirectUris.filter((u): u is string => isAllowedRedirectUri(u, production)) : [];
        if (typeof c.clientId !== 'string' || !CLIENT_ID_RE.test(c.clientId)) continue;
        const hasSecret = c.secretHash !== undefined && c.secretHash !== null && c.secretHash !== '';
        if (hasSecret && (typeof c.secretHash !== 'string' || !HEX64_RE.test(c.secretHash.toLowerCase()))) continue;
        if (redirectUris.length === 0 || out.some((o) => o.clientId === c.clientId)) continue;
        out.push({ clientId: c.clientId, name: typeof c.name === 'string' && c.name.trim() ? c.name.trim().slice(0, 60) : c.clientId, secretHash: hasSecret ? (c.secretHash as string).toLowerCase() : null, redirectUris });
    }
    return out;
}

export function getExternalClients(env: NodeJS.ProcessEnv = process.env): ExternalClient[] {
    return parseExternalClients(env.BLOOMX_EXTERNAL_CLIENTS);
}

export function isExternalAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return getExternalClients(env).length > 0;
}

export type AuthorizeParams = { client_id?: string | null; redirect_uri?: string | null; state?: string | null; code_challenge?: string | null; code_challenge_method?: string | null; response_type?: string | null };

export type AuthorizeValidation =
    | { ok: true; client: ExternalClient; redirectUri: string; state: string; codeChallenge: string }
    | { ok: false; error: 'invalid_client' | 'invalid_redirect_uri' | 'invalid_request' | 'unsupported_response_type' | 'disabled' };

/**
 * El navegador NUNCA es redirigido a un redirect_uri no registrado: si el cliente o la URI no coinciden exactamente,
 * se responde con error en esta instancia (sin redirigir).
 */
export function validateAuthorizeParams(p: AuthorizeParams, clients: ExternalClient[]): AuthorizeValidation {
    if (clients.length === 0) return { ok: false, error: 'disabled' };
    const client = clients.find((c) => c.clientId === p.client_id);
    if (!client) return { ok: false, error: 'invalid_client' };
    if (typeof p.redirect_uri !== 'string' || !client.redirectUris.includes(p.redirect_uri)) return { ok: false, error: 'invalid_redirect_uri' };
    if (p.response_type && p.response_type !== 'code') return { ok: false, error: 'unsupported_response_type' };
    const state = typeof p.state === 'string' ? p.state : '';
    if (!state || state.length > 256 || /[\r\n]/.test(state)) return { ok: false, error: 'invalid_request' };
    if (p.code_challenge_method !== 'S256' || typeof p.code_challenge !== 'string' || !CHALLENGE_RE.test(p.code_challenge)) return { ok: false, error: 'invalid_request' };
    return { ok: true, client, redirectUri: p.redirect_uri, state, codeChallenge: p.code_challenge };
}

export function verifyClientSecret(client: ExternalClient, secret: unknown): boolean {
    if (client.secretHash === null) return true; // cliente publico: no hay secreto que comprobar (PKCE protege el canje)
    return typeof secret === 'string' && secret.length > 0 && secret.length <= 512 && safeEqual(sha256Hex(secret), client.secretHash);
}

export function verifyPkceS256(verifier: unknown, challenge: string): boolean {
    if (typeof verifier !== 'string' || !VERIFIER_RE.test(verifier)) return false;
    return safeEqual(createHash('sha256').update(verifier).digest('base64url'), challenge);
}

export const newAuthorizationCode = (): string => randomBytes(32).toString('base64url');

export { safeLoginNext } from '@/lib/login-next';

export function buildClientRedirect(redirectUri: string, params: Record<string, string | undefined>): string {
    const url = new URL(redirectUri);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
    return url.toString();
}
