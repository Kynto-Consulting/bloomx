import { prisma } from '@/lib/prisma';
import { getDbPool } from '@/lib/db/pool';
import { providerFetch, ProviderHttpError } from './http';
import { accountMatchesProvider, type ProviderRuntime } from './providers';

/**
 * Tokens de las cuentas OAuth (tabla "Account", cifrada en reposo por lib/account-tokens.ts con la clave de datos de la instancia).
 * AQUI y solo aqui se leen, refrescan y revocan: ninguna extension los recibe jamas (lib/oauth/broker.ts presta ACCIONES).
 *
 * Refresco (RFC 6749 §6, RFC 9700 §4.14): serializado POR CUENTA con un candado de BD (pg_advisory_lock) ademas del dedupe en proceso; tras
 * conseguir el candado se vuelve a leer la cuenta (otro proceso pudo refrescar ya). Si el proveedor ROTA el refresh_token, se guarda el nuevo
 * (el antiguo deja de valer); `invalid_grant` marca la cuenta como "reconectar" sin gastar mas refrescos. Revocacion RFC 7009.
 */

export type OAuthAccountErrorCode = 'OAUTH_NOT_LINKED' | 'OAUTH_RECONNECT_REQUIRED' | 'OAUTH_SCOPE_MISSING' | 'OAUTH_PROVIDER_UNAVAILABLE' | 'OAUTH_NOT_CONFIGURED';
export class OAuthAccountError extends Error {
    constructor(public code: OAuthAccountErrorCode, public status = 400) {
        super(code);
        this.name = 'OAuthAccountError';
    }
}

type AccountRow = { provider_hash?: string | null; id: string; userId: string; provider: string; providerAccountId: string; access_token: string | null; refresh_token: string | null; expires_at: number | null; scope: string | null; token_type: string | null };

/** Cuenta a usar si hay varias: primero las que conservan refresh_token, luego la de token mas vigente; determinista. */
export function pickAccount<T extends { id: string; refresh_token?: string | null; access_token?: string | null; expires_at?: number | null }>(accounts: T[]): T | null {
    if (accounts.length === 0) return null;
    return [...accounts].sort((a, b) => {
        const byRefresh = Number(Boolean(b.refresh_token)) - Number(Boolean(a.refresh_token));
        if (byRefresh !== 0) return byRefresh;
        const byExpiry = (b.expires_at ?? 0) - (a.expires_at ?? 0);
        if (byExpiry !== 0) return byExpiry;
        return a.id.localeCompare(b.id);
    })[0];
}

/** Algunos proveedores devuelven alias de los scopes OIDC (Google: `email` -> .../auth/userinfo.email). */
const SCOPE_ALIASES: Record<string, string> = {
    'https://www.googleapis.com/auth/userinfo.email': 'email',
    'https://www.googleapis.com/auth/userinfo.profile': 'profile',
};
export const normalizeScope = (scope: string): string => SCOPE_ALIASES[scope] ?? scope;
export function grantedScopeSet(scope: string | null | undefined): Set<string> {
    return new Set((scope ?? '').split(/[\s,]+/).filter(Boolean).map(normalizeScope));
}

export interface AccessToken { accessToken: string; refreshToken: string | null; accountId: string; scope: string | null }

export interface TokenRequest { clientId: string; clientSecret: string | null }

async function postForm(provider: ProviderRuntime, url: string, form: Record<string, string>) {
    return providerFetch(provider.allowedHosts, url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString(), maxBytes: 100_000 });
}

export interface TokenResponse { access_token: string; expires_in?: number; refresh_token?: string; scope?: string; token_type?: string; id_token?: string }

/** Intercambio de `code` (grant authorization_code) con PKCE si aplica. El secreto va en el cuerpo (client_secret_post), jamas en la URL. */
export async function exchangeCode(provider: ProviderRuntime, input: { code: string; redirectUri: string; verifier: string | null }): Promise<TokenResponse> {
    if (!provider.clientId) throw new OAuthAccountError('OAUTH_NOT_CONFIGURED', 500);
    const form: Record<string, string> = { grant_type: 'authorization_code', code: input.code, redirect_uri: input.redirectUri, client_id: provider.clientId };
    if (provider.clientSecret) form.client_secret = provider.clientSecret;
    if (input.verifier) form.code_verifier = input.verifier;
    const res = await postForm(provider, provider.tokenUrl, form);
    const data = res.json as Record<string, unknown> | null;
    if (!res.ok || !data || typeof data.error === 'string' || typeof data.access_token !== 'string') {
        throw new OAuthAccountError('OAUTH_PROVIDER_UNAVAILABLE', 502);
    }
    return data as unknown as TokenResponse;
}

async function refreshWith(provider: ProviderRuntime, refreshToken: string): Promise<TokenResponse> {
    if (!provider.clientId) throw new OAuthAccountError('OAUTH_NOT_CONFIGURED', 500);
    const form: Record<string, string> = { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: provider.clientId };
    if (provider.clientSecret) form.client_secret = provider.clientSecret;
    let res;
    try { res = await postForm(provider, provider.tokenUrl, form); } catch (e) { if (e instanceof ProviderHttpError) throw new OAuthAccountError('OAUTH_PROVIDER_UNAVAILABLE', 502); throw e; }
    const data = res.json as Record<string, unknown> | null;
    if (!res.ok || !data || typeof data.error === 'string' || typeof data.access_token !== 'string') {
        // invalid_grant = el usuario revoco el acceso, cambio la contrasena o el token caduco/rotado.
        if (data?.error === "invalid_grant") throw new OAuthAccountError('OAUTH_RECONNECT_REQUIRED', 401);
        throw new OAuthAccountError('OAUTH_PROVIDER_UNAVAILABLE', 502);
    }
    return data as unknown as TokenResponse;
}

// ---------------------------------------------------------------------------------------------------------------
// Candado por cuenta
// ---------------------------------------------------------------------------------------------------------------

type Lock = <T>(accountId: string, fn: () => Promise<T>) => Promise<T>;
const pgLock: Lock = async (accountId, fn) => {
    const client = await getDbPool().connect();
    const key = `oauth-refresh:${accountId}`;
    try {
        await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [key]);
        return await fn();
    } finally {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]).catch(() => undefined);
        client.release();
    }
};
let lock: Lock = pgLock;
/** Candado de refresco por cuenta (BD): lo comparte el flujo generico y el acceso historico a Google (lib/google/account.ts). */
export const withAccountRefreshLock: Lock = (accountId, fn) => lock(accountId, fn);
export function __setRefreshLock(impl: Lock | null): void {
    if (process.env.NODE_ENV !== 'test') throw new Error('__setRefreshLock is only available in tests');
    lock = impl ?? pgLock;
}

const inFlight = new Map<string, Promise<AccessToken>>();
const toAccessToken = (a: AccountRow): AccessToken => ({ accessToken: a.access_token as string, refreshToken: a.refresh_token, accountId: a.id, scope: a.scope });
const fresh = (a: AccountRow | null): boolean => !!a && !!a.access_token && (!a.expires_at || a.expires_at * 1000 > Date.now() + 60_000);

/**
 * Cuentas del usuario con el proveedor ACTIVO. Solo se devuelven las emitidas por ESE proveedor (hash de identidad): si otra definicion se registrara
 * con el mismo id y otros endpoints, los tokens existentes no se le envian ni se refrescan contra su tokenUrl. Cuentas anteriores a la columna
 * (hash nulo) se aceptan solo con los endpoints oficiales del proveedor integrado y se les graba el hash.
 */
export async function listUserAccounts(userId: string, provider: Pick<ProviderRuntime, 'id' | 'identityHash' | 'endpointHosts'>): Promise<AccountRow[]> {
    const all = (await prisma.account.findMany({ where: { userId, provider: provider.id } })) as unknown as AccountRow[];
    const ok = all.filter((a) => accountMatchesProvider(a, provider));
    for (const a of ok) {
        if (!a.provider_hash) { prisma.account.update({ where: { id: a.id }, data: { provider_hash: provider.identityHash } }).catch(() => undefined); a.provider_hash = provider.identityHash; }
    }
    return ok;
}

/** Token de acceso vigente de la cuenta del usuario (refresca si hace falta). `accountId` fija una cuenta concreta (siempre del usuario). */
export async function getAccessToken(provider: ProviderRuntime, userId: string, opts: { accountId?: string } = {}): Promise<AccessToken> {
    const accounts = await listUserAccounts(userId, provider);
    const account = opts.accountId ? accounts.find((a) => a.id === opts.accountId) ?? null : pickAccount(accounts);
    if (!account) throw new OAuthAccountError('OAUTH_NOT_LINKED', 404);
    if (!account.access_token && !account.refresh_token) throw new OAuthAccountError('OAUTH_RECONNECT_REQUIRED', 401);
    if (fresh(account)) return toAccessToken(account);
    if (!account.refresh_token) throw new OAuthAccountError('OAUTH_RECONNECT_REQUIRED', 401);

    const pending = inFlight.get(account.id);
    if (pending) return pending;
    const promise = lock(account.id, async (): Promise<AccessToken> => {
        // Otro proceso pudo refrescar mientras esperabamos el candado.
        const again = (await prisma.account.findUnique({ where: { id: account.id } })) as unknown as AccountRow | null;
        if (!again) throw new OAuthAccountError('OAUTH_NOT_LINKED', 404);
        if (!accountMatchesProvider(again, provider)) throw new OAuthAccountError('OAUTH_RECONNECT_REQUIRED', 401);
        if (fresh(again)) return toAccessToken(again);
        if (!again.refresh_token) throw new OAuthAccountError('OAUTH_RECONNECT_REQUIRED', 401);
        let refreshed: TokenResponse;
        try {
            refreshed = await refreshWith(provider, again.refresh_token);
        } catch (error) {
            if (error instanceof OAuthAccountError && error.code === 'OAUTH_RECONNECT_REQUIRED') {
                await prisma.account.update({ where: { id: again.id }, data: { access_token: null, refresh_token: null, expires_at: 0 } }).catch(() => undefined);
            }
            throw error;
        }
        const updated = (await prisma.account.update({
            where: { id: again.id },
            data: {
                access_token: refreshed.access_token,
                // Rotacion: si el proveedor devuelve un refresh_token nuevo, el anterior queda invalidado y SE REEMPLAZA.
                refresh_token: refreshed.refresh_token || again.refresh_token,
                expires_at: refreshed.expires_in ? Math.floor(Date.now() / 1000 + refreshed.expires_in) : again.expires_at,
                scope: refreshed.scope || again.scope,
                token_type: refreshed.token_type || again.token_type,
            },
        })) as unknown as AccountRow;
        return toAccessToken(updated);
    }).finally(() => { inFlight.delete(account.id); });
    inFlight.set(account.id, promise);
    return promise;
}

export type RevokeOutcome = 'revoked' | 'not_supported' | 'failed' | 'no_token';

/** RFC 7009: revoca en el proveedor el refresh_token (o el access_token). Best-effort con timeout: un fallo jamas impide desvincular. */
export async function revokeAtProvider(provider: ProviderRuntime, tokens: { refresh_token?: string | null; access_token?: string | null }): Promise<RevokeOutcome> {
    const token = tokens.refresh_token || tokens.access_token;
    if (!token) return 'no_token';
    if (!provider.revokeUrl) return 'not_supported';
    try {
        const form: Record<string, string> = { token, token_type_hint: tokens.refresh_token ? 'refresh_token' : 'access_token' };
        if (provider.clientId) form.client_id = provider.clientId;
        if (provider.clientSecret) form.client_secret = provider.clientSecret;
        const res = await providerFetch(provider.allowedHosts, provider.revokeUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString(), timeoutMs: 5000, maxBytes: 20_000 });
        return res.ok ? 'revoked' : 'failed';
    } catch {
        return 'failed';
    }
}
