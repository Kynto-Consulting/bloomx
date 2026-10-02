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
/** Microsoft puede devolver los scopes de Graph con el recurso delante (https://graph.microsoft.com/Mail.Read): se normalizan al nombre corto del catalogo. */
const SCOPE_RESOURCE_PREFIXES = ['https://graph.microsoft.com/'];
export const normalizeScope = (scope: string): string => {
    if (SCOPE_ALIASES[scope]) return SCOPE_ALIASES[scope];
    for (const prefix of SCOPE_RESOURCE_PREFIXES) if (scope.startsWith(prefix) && scope.length > prefix.length) return scope.slice(prefix.length);
    return scope;
};
export function grantedScopeSet(scope: string | null | undefined): Set<string> {
    return new Set((scope ?? '').split(/[\s,]+/).filter(Boolean).map(normalizeScope));
}

export interface AccessToken { accessToken: string; refreshToken: string | null; accountId: string; scope: string | null }

export interface TokenRequest { clientId: string; clientSecret: string | null }

/**
 * Autenticacion del cliente en los endpoints de token/revocacion. "post" = client_id/client_secret en el cuerpo (client_secret_post);
 * "basic" = Authorization: Basic base64(urlencode(id):urlencode(secret)) (RFC 6749 §2.3.1, client_secret_basic; Zoom) y entonces NI el id NI el secreto
 * van en el cuerpo. El secreto nunca va en la URL.
 */
export function clientAuth(provider: Pick<ProviderRuntime, 'tokenAuth' | 'clientId' | 'clientSecret'>, form: Record<string, string>): { headers: Record<string, string>; form: Record<string, string> } {
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const out = { ...form };
    if (provider.tokenAuth === 'basic' && provider.clientId && provider.clientSecret) {
        headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(provider.clientId)}:${encodeURIComponent(provider.clientSecret)}`).toString('base64')}`;
        delete out.client_id;
        delete out.client_secret;
    }
    return { headers, form: out };
}

async function postForm(provider: ProviderRuntime, url: string, form: Record<string, string>) {
    const auth = clientAuth(provider, form);
    return providerFetch(provider.allowedHosts, url, { method: 'POST', headers: auth.headers, body: new URLSearchParams(auth.form).toString(), maxBytes: 100_000 });
}

export interface TokenResponse {
    access_token: string; expires_in?: number; refresh_token?: string; scope?: string; token_type?: string; id_token?: string;
    /** Slack OAuth v2 (tokenFormat slack-v2): espacio de trabajo y token de USUARIO ademas del token de bot de nivel superior. */
    ok?: boolean;
    team?: { id?: string; name?: string } | null;
    is_enterprise_install?: boolean;
    authed_user?: { id?: string; scope?: string; access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string } | null;
}

export interface TokenGrant { kind: 'default' | 'bot' | 'user'; access_token: string; refresh_token?: string; expires_in?: number; scope?: string; token_type?: string; id_token?: string }
export interface GrantedIdentity { grants: TokenGrant[]; /** Slack: id de equipo y de usuario (para el id de cuenta). */ teamId?: string; userId?: string; teamName?: string }

/** Slack: errores de refresco que significan "vuelve a vincular". */
const SLACK_RECONNECT = ['invalid_refresh_token', 'token_revoked', 'token_expired', 'invalid_auth', 'account_inactive', 'bad_refresh_token'];

/**
 * Convierte la respuesta del token en concesiones. "standard": una (token y refresh tal cual). "slack-v2": hasta dos filas independientes — token de BOT
 * (scopes del bot tal cual) y token de USUARIO (scopes con prefijo "user:" para que no se confundan con los del bot: chat:write existe en ambos).
 */
export function tokenGrants(provider: Pick<ProviderRuntime, 'tokenFormat'>, t: TokenResponse): GrantedIdentity | null {
    if (provider.tokenFormat !== 'slack-v2') return { grants: [{ kind: 'default', access_token: t.access_token, refresh_token: t.refresh_token, expires_in: t.expires_in, scope: t.scope, token_type: t.token_type, id_token: t.id_token }] };
    const teamId = t.team?.id;
    const userId = t.authed_user?.id;
    if (t.is_enterprise_install === true || typeof teamId !== 'string' || !/^[A-Z0-9]{2,20}$/.test(teamId) || typeof userId !== 'string' || !/^[A-Z0-9]{2,20}$/.test(userId)) return null;
    const grants: TokenGrant[] = [];
    if (t.token_type === 'bot' && typeof t.access_token === 'string' && t.access_token) grants.push({ kind: 'bot', access_token: t.access_token, refresh_token: t.refresh_token, expires_in: t.expires_in, scope: t.scope, token_type: 'bot' });
    const u = t.authed_user;
    if (u && typeof u.access_token === 'string' && u.access_token) {
        grants.push({ kind: 'user', access_token: u.access_token, refresh_token: u.refresh_token, expires_in: u.expires_in, scope: (u.scope ?? '').split(/[\s,]+/).filter(Boolean).map((x) => `user:${x}`).join(','), token_type: 'user' });
    }
    return grants.length ? { grants, teamId, userId, teamName: typeof t.team?.name === 'string' ? t.team.name : undefined } : null;
}

/** Cuenta (providerAccountId) de una concesion: Slack separa bot/usuario por equipo y usuario; el resto usa el id del perfil. */
export function grantAccountId(identity: GrantedIdentity, grant: TokenGrant, profileId: string): string {
    return grant.kind === 'default' ? profileId : `${identity.teamId}:${identity.userId}:${grant.kind}`;
}

function tokenFailed(provider: Pick<ProviderRuntime, 'tokenFormat'>, data: Record<string, unknown> | null, ok: boolean): boolean {
    if (!ok || !data || typeof data.error === 'string' || data.ok === false) return true;
    if (provider.tokenFormat === 'slack-v2') return !(typeof data.access_token === 'string' || typeof (data.authed_user as { access_token?: unknown } | null | undefined)?.access_token === 'string');
    return typeof data.access_token !== 'string';
}

/** Intercambio de `code` (grant authorization_code) con PKCE si aplica. El secreto va en el cuerpo (client_secret_post), jamas en la URL. */
export async function exchangeCode(provider: ProviderRuntime, input: { code: string; redirectUri: string; verifier: string | null }): Promise<TokenResponse> {
    if (!provider.clientId) throw new OAuthAccountError('OAUTH_NOT_CONFIGURED', 500);
    const form: Record<string, string> = { grant_type: 'authorization_code', code: input.code, redirect_uri: input.redirectUri, client_id: provider.clientId };
    if (provider.clientSecret) form.client_secret = provider.clientSecret;
    if (input.verifier) form.code_verifier = input.verifier;
    const res = await postForm(provider, provider.tokenUrl, form);
    const data = res.json as Record<string, unknown> | null;
    if (tokenFailed(provider, data, res.ok)) throw new OAuthAccountError('OAUTH_PROVIDER_UNAVAILABLE', 502);
    // Slack sin token de bot de nivel superior (solo scopes de usuario): el principal es el token del usuario.
    if (provider.tokenFormat === 'slack-v2' && typeof data!.access_token !== 'string') data!.access_token = '';
    return data as unknown as TokenResponse;
}

async function refreshWith(provider: ProviderRuntime, refreshToken: string): Promise<TokenResponse> {
    if (!provider.clientId) throw new OAuthAccountError('OAUTH_NOT_CONFIGURED', 500);
    const form: Record<string, string> = { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: provider.clientId };
    if (provider.clientSecret) form.client_secret = provider.clientSecret;
    let res;
    try { res = await postForm(provider, provider.tokenUrl, form); } catch (e) { if (e instanceof ProviderHttpError) throw new OAuthAccountError('OAUTH_PROVIDER_UNAVAILABLE', 502); throw e; }
    const data = res.json as Record<string, unknown> | null;
    if (!res.ok || !data || typeof data.error === 'string' || data.ok === false || typeof data.access_token !== 'string') {
        // invalid_grant = el usuario revoco el acceso, cambio la contrasena o el token caduco/rotado (Slack: invalid_refresh_token...).
        if (data?.error === "invalid_grant" || (provider.tokenFormat === 'slack-v2' && typeof data?.error === 'string' && SLACK_RECONNECT.includes(data.error))) throw new OAuthAccountError('OAUTH_RECONNECT_REQUIRED', 401);
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
export async function getAccessToken(provider: ProviderRuntime, userId: string, opts: { accountId?: string; requiresScopes?: readonly string[] } = {}): Promise<AccessToken> {
    const accounts = await listUserAccounts(userId, provider);
    // Si el usuario tiene varias cuentas del proveedor (Slack: bot y usuario), se prefiere la que cubre los scopes de la accion.
    const need = opts.requiresScopes ?? [];
    const covering = need.length ? accounts.filter((a) => { const g = grantedScopeSet(a.scope); return need.every((sc) => g.has(sc)); }) : [];
    const account = opts.accountId ? accounts.find((a) => a.id === opts.accountId) ?? null : pickAccount(covering.length ? covering : accounts);
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

export type RevokeOutcome = 'revoked' | 'not_supported' | 'failed' | 'no_token' | 'shared';

/**
 * RFC 7009: revoca en el proveedor el refresh_token (o el access_token segun `revokeToken`). Best-effort con timeout: un fallo jamas impide desvincular.
 * Slack (auth.revoke): POST con el token en Authorization: Bearer y respuesta {ok:true}. Sin `revokeUrl` (Microsoft no tiene endpoint estandar de
 * revocacion de tokens de aplicacion) devuelve 'not_supported': el acceso se retira localmente y el usuario/admin lo quita en el proveedor.
 */
export async function revokeAtProvider(provider: ProviderRuntime, tokens: { refresh_token?: string | null; access_token?: string | null }): Promise<RevokeOutcome> {
    const useAccess = provider.revokeToken === 'access' || provider.tokenFormat === 'slack-v2';
    const token = useAccess ? tokens.access_token || tokens.refresh_token : tokens.refresh_token || tokens.access_token;
    if (!token) return 'no_token';
    if (!provider.revokeUrl) return 'not_supported';
    try {
        if (provider.tokenFormat === 'slack-v2') {
            const res = await providerFetch(provider.allowedHosts, provider.revokeUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${token}` }, body: '', timeoutMs: 5000, maxBytes: 20_000 });
            return res.ok && (res.json as { ok?: boolean } | null)?.ok === true ? 'revoked' : 'failed';
        }
        const isRefresh = token === tokens.refresh_token;
        const form: Record<string, string> = { token, token_type_hint: isRefresh ? 'refresh_token' : 'access_token' };
        if (provider.clientId) form.client_id = provider.clientId;
        if (provider.clientSecret) form.client_secret = provider.clientSecret;
        const auth = clientAuth(provider, form);
        const res = await providerFetch(provider.allowedHosts, provider.revokeUrl, { method: 'POST', headers: auth.headers, body: new URLSearchParams(auth.form).toString(), timeoutMs: 5000, maxBytes: 20_000 });
        return res.ok ? 'revoked' : 'failed';
    } catch {
        return 'failed';
    }
}
