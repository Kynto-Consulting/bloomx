import {
    AuthorizeParams,
    buildClientRedirect,
    CODE_TTL_SECONDS,
    ExternalClient,
    newAuthorizationCode,
    sha256Hex,
    validateAuthorizeParams,
    verifyClientSecret,
    verifyPkceS256,
} from '@/lib/external-auth';
import type { ExternalAuthCodeStore } from '@/lib/external-auth-store';

/** Logica de authorize/token sin Next ni BD (dependencias inyectadas): se prueba con memoria. */

export interface FlowUser {
    id: string;
    email: string;
    name: string | null;
}

export interface FlowDeps {
    clients: ExternalClient[];
    store: ExternalAuthCodeStore;
    getUser(userId: string): Promise<FlowUser | null>;
    isDisabled(userId: string): Promise<boolean>;
    rateLimit(key: string, limit: number, windowMs: number): Promise<{ ok: boolean; retryAfter: number }>;
    audit(event: string, data: Record<string, unknown>): void;
}

export function discoveryDocument(origin: string, clients: ExternalClient[]) {
    const enabled = clients.length > 0;
    return enabled
        ? {
              enabled: true,
              version: 1,
              issuer: origin,
              authorizationEndpoint: `${origin}/api/auth/authorize`,
              tokenEndpoint: `${origin}/api/auth/token`,
              responseTypes: ['code'],
              codeChallengeMethods: ['S256'],
          }
        : { enabled: false, version: 1 };
}

export type AuthorizeResult =
    | { kind: 'error'; status: number; error: string }
    | { kind: 'login' }
    | { kind: 'redirect'; location: string };

/**
 * `userId` viene de una sesion COMPLETA (la cookie solo se emite tras el segundo factor), asi el MFA se respeta.
 * Sin sesion: kind "login" (el llamador lleva al login y vuelve a esta misma URL).
 */
export async function authorizeFlow(deps: FlowDeps, params: AuthorizeParams, userId: string | null, ip: string): Promise<AuthorizeResult> {
    const v = validateAuthorizeParams(params, deps.clients);
    if (!v.ok) return { kind: 'error', status: v.error === 'disabled' ? 404 : 400, error: v.error };
    if (!userId) return { kind: 'login' };

    const rl = await deps.rateLimit(`extauth:authorize:${ip}`, 30, 60_000);
    if (!rl.ok) return { kind: 'error', status: 429, error: 'rate_limited' };
    if (await deps.isDisabled(userId)) {
        deps.audit('auth.external.denied', { userId, clientId: v.client.clientId, reason: 'disabled', ip });
        return { kind: 'redirect', location: buildClientRedirect(v.redirectUri, { error: 'access_denied', state: v.state }) };
    }
    const user = await deps.getUser(userId);
    if (!user) return { kind: 'login' };

    const code = newAuthorizationCode();
    await deps.store.put(sha256Hex(code), { clientId: v.client.clientId, redirectUri: v.redirectUri, codeChallenge: v.codeChallenge, userId: user.id }, CODE_TTL_SECONDS);
    deps.audit('auth.external.code_issued', { userId: user.id, clientId: v.client.clientId, ip });
    return { kind: 'redirect', location: buildClientRedirect(v.redirectUri, { code, state: v.state }) };
}

export interface TokenBody {
    client_id?: unknown;
    client_secret?: unknown;
    code?: unknown;
    code_verifier?: unknown;
    redirect_uri?: unknown;
    grant_type?: unknown;
}

export type TokenResult = { status: number; body: Record<string, unknown> };

const bad = (status: number, error: string): TokenResult => ({ status, body: { error } });

/** Servidor a servidor. El codigo se consume ANTES de verificar PKCE/URI: un intento fallido lo quema. */
export async function tokenFlow(deps: FlowDeps, body: TokenBody, ip: string): Promise<TokenResult> {
    const rl = await deps.rateLimit(`extauth:token:${ip}`, 60, 60_000);
    if (!rl.ok) return bad(429, 'rate_limited');
    if (deps.clients.length === 0) return bad(404, 'disabled');
    if (body.grant_type !== undefined && body.grant_type !== 'authorization_code') return bad(400, 'unsupported_grant_type');
    const client = deps.clients.find((c) => c.clientId === body.client_id);
    // Mismo error para cliente desconocido y secreto incorrecto (no revela que clientes existen).
    if (!client || !verifyClientSecret(client, body.client_secret)) {
        deps.audit('auth.external.token_denied', { clientId: typeof body.client_id === 'string' ? body.client_id.slice(0, 64) : null, ip, reason: 'client' });
        return bad(401, 'invalid_client');
    }
    if (typeof body.code !== 'string' || body.code.length === 0 || body.code.length > 256) return bad(400, 'invalid_grant');
    const record = await deps.store.consume(sha256Hex(body.code));
    if (!record || record.clientId !== client.clientId || record.redirectUri !== body.redirect_uri || !verifyPkceS256(body.code_verifier, record.codeChallenge)) {
        deps.audit('auth.external.token_denied', { clientId: client.clientId, ip, reason: 'grant' });
        return bad(400, 'invalid_grant');
    }
    if (await deps.isDisabled(record.userId)) return bad(400, 'invalid_grant');
    const user = await deps.getUser(record.userId);
    if (!user) return bad(400, 'invalid_grant');
    deps.audit('auth.external.token_issued', { userId: user.id, clientId: client.clientId, ip });
    // email_verified: el correo es un buzon de ESTA instancia (cuenta creada por su administrador), la instancia responde por el.
    return { status: 200, body: { sub: user.id, email: user.email.toLowerCase(), email_verified: true, name: user.name } };
}
