import { SignJWT, importPKCS8 } from 'jose';
import { providerFetch } from './http';
import { safePatternTest } from '@/lib/expansions/oauth-schema';
import { botPolicy } from './bot-broker';
import { getSharedCredential, getSharedCredentialByName, principalSetting, usesOfficialEndpoints, type ProviderRuntime } from './providers';
import { clientAuth, OAuthAccountError, type TokenResponse } from './tokens';

/**
 * IDENTIDADES COMPARTIDAS del dominio (ademas de la cuenta vinculada de cada usuario), para los casos en que no hay un usuario concreto:
 *   - `organizer`: un refresh token de un "organizador" compartido (p. ej. quien crea las reuniones de Meet), con el client OAuth del proveedor;
 *   - `service`: cuenta de servicio con delegacion en todo el dominio (JWT RS256 firmado AQUI con la clave privada del JSON, suplantando a
 *     `impersonateUser`; RFC 7523).
 * Las credenciales las guarda el nucleo cifradas (admin: oauth secret set) y NUNCA llegan a una extension: la extension solo pide una accion
 * con \`principal\`. Exigen el permiso OAUTH_SHARED:<proveedor> del manifest (el backend lo firma en el pedido). Los access tokens se cachean en
 * memoria del proceso hasta 60 s antes de caducar (un solo canje en vuelo por clave).
 */

export type SharedPrincipal = 'organizer' | 'service';
interface Cached { token: string; scope: string | null; exp: number }
const cache = new Map<string, Cached>();
const inflight = new Map<string, Promise<Cached>>();
export function __resetPrincipalCache(): void { cache.clear(); inflight.clear(); }

const SA_MAX_BYTES = 16 * 1024;

export interface ServiceAccountKey { client_email: string; private_key: string; project_id?: string }
export function parseServiceAccount(raw: string): ServiceAccountKey | null {
    if (Buffer.byteLength(raw, 'utf8') > SA_MAX_BYTES) return null;
    try {
        const sa = JSON.parse(raw);
        if (!sa || typeof sa !== 'object' || Array.isArray(sa) || sa.type !== 'service_account') return null;
        if (typeof sa.client_email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(sa.client_email)) return null;
        if (typeof sa.private_key !== 'string' || !sa.private_key.startsWith('-----BEGIN')) return null;
        return { client_email: sa.client_email, private_key: sa.private_key, project_id: typeof sa.project_id === 'string' ? sa.project_id : undefined };
    } catch {
        return null;
    }
}

export interface PrincipalAvailability { user: number; organizer: boolean; service: boolean; mode: string; accounts: { organizerEmail: string; impersonateUser: string };
    /** Solo si el proveedor declara botCredential: token del bot guardado y politica del admin (sin valores sensibles). */
    bot?: { configured: boolean; guilds: number; moderation: boolean } }

/** Que identidades compartidas hay configuradas (sin valores) y el modo elegido por el admin. */
export async function describePrincipals(provider: ProviderRuntime, userAccounts: number): Promise<PrincipalAvailability> {
    const [refresh, sa] = await Promise.all([getSharedCredential(provider, 'organizerRefreshToken'), getSharedCredential(provider, 'serviceAccountJson')]);
    const s2s = provider.serviceCredentials ? await serviceCredentialsOf(provider) : null;
    return {
        user: userAccounts,
        organizer: !!refresh && !!provider.clientId && !!provider.clientSecret,
        service: s2s ? true : !!sa && !!parseServiceAccount(sa) && !!principalSetting(provider, 'impersonateUser'),
        mode: principalSetting(provider, 'authMode'),
        // Cuentas NO secretas (para mostrar "actuando como"); solo se revelan a quien tiene OAUTH_SHARED.
        accounts: { organizerEmail: principalSetting(provider, 'organizerEmail'), impersonateUser: principalSetting(provider, 'impersonateUser') },
        ...(provider.bot ? { bot: await botAvailability(provider) } : {}),
    };
}

async function botAvailability(provider: ProviderRuntime): Promise<{ configured: boolean; guilds: number; moderation: boolean }> {
    const def = provider.bot;
    const token = def ? await getSharedCredentialByName(provider, def.tokenCredential) : null;
    const policy = botPolicy(provider);
    return { configured: !!token && !!def && safePatternTest(def.tokenPattern, token) && provider.status !== 'needs_reapproval' && provider.status !== 'pending_approval', guilds: policy.allowedGuilds.length, moderation: policy.moderation };
}

/** Credenciales S2S (Zoom account_credentials) del proveedor, o null si falta algo. Nunca salen del nucleo. */
async function serviceCredentialsOf(provider: ProviderRuntime): Promise<{ accountId: string; clientId: string; clientSecret: string } | null> {
    const def = provider.serviceCredentials;
    if (!def) return null;
    const cfg = provider.settingsConfig;
    const accountId = typeof cfg[def.accountIdSetting] === 'string' ? (cfg[def.accountIdSetting] as string).trim() : '';
    const clientId = typeof cfg[def.clientIdSetting] === 'string' ? (cfg[def.clientIdSetting] as string).trim() : '';
    const clientSecret = await getSharedCredentialByName(provider, def.clientSecretCredential);
    return /^[A-Za-z0-9_-]{4,64}$/.test(accountId) && /^[A-Za-z0-9_-]{4,128}$/.test(clientId) && clientSecret ? { accountId, clientId, clientSecret } : null;
}

function exchange<T extends Cached>(key: string, mint: () => Promise<T>): Promise<Cached> {
    const hit = cache.get(key);
    if (hit && hit.exp > Date.now() + 60_000) return Promise.resolve(hit);
    const pending = inflight.get(key);
    if (pending) return pending;
    const p = mint().then((c) => { cache.set(key, c); return c; }).finally(() => { inflight.delete(key); });
    inflight.set(key, p);
    return p;
}

async function postToken(provider: ProviderRuntime, form: Record<string, string>, auth?: { clientId: string; clientSecret: string }): Promise<TokenResponse> {
    // S2S: SIEMPRE client_secret_basic con las credenciales de la aplicacion S2S (distintas del cliente OAuth de usuario).
    const sent = auth ? clientAuth({ tokenAuth: 'basic', clientId: auth.clientId, clientSecret: auth.clientSecret }, form) : { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, form };
    const res = await providerFetch(provider.allowedHosts, provider.tokenUrl, { method: 'POST', headers: sent.headers, body: new URLSearchParams(sent.form).toString(), maxBytes: 100_000 });
    const data = res.json as Record<string, unknown> | null;
    if (!res.ok || !data || typeof data.access_token !== 'string') {
        if (data?.error === 'invalid_grant' || data?.error === 'unauthorized_client' || data?.error === 'invalid_client') throw new OAuthAccountError('OAUTH_RECONNECT_REQUIRED', 401);
        throw new OAuthAccountError('OAUTH_PROVIDER_UNAVAILABLE', 502);
    }
    return data as unknown as TokenResponse;
}

/**
 * Scopes que una identidad COMPARTIDA (cuenta de servicio con delegacion en todo el dominio / organizador) puede pedir en el proveedor OFICIAL.
 * Lista FIJA en el codigo (no la amplia ninguna extension ni el catalogo): Gmail, Drive y Contactos con delegacion de dominio quedan fuera.
 * Para proveedores no integrados: solo scopes del catalogo del proveedor y nunca los de riesgo critico.
 */
export const SHARED_SCOPE_ALLOWLIST: Readonly<Record<string, readonly string[]>> = Object.freeze({
    google: [
        'openid', 'email', 'profile',
        'https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/meetings.space.created', 'https://www.googleapis.com/auth/meetings.space.readonly',
    ],
});
export function sharedScopesAllowed(provider: Pick<ProviderRuntime, 'id' | 'scopes' | 'endpointHosts'>, scopes: readonly string[]): boolean {
    const fixed = SHARED_SCOPE_ALLOWLIST[provider.id];
    const catalog = new Map(provider.scopes.map((sc) => [sc.id, sc.risk] as const));
    return scopes.every((sc) => {
        if (!catalog.has(sc)) return false;
        if (fixed && usesOfficialEndpoints(provider.id, provider.endpointHosts)) return fixed.includes(sc);
        return catalog.get(sc) !== 'critical';
    });
}

export async function getSharedAccessToken(provider: ProviderRuntime, principal: SharedPrincipal, scopes: readonly string[]): Promise<{ accessToken: string; scope: string | null }> {
    if (!sharedScopesAllowed(provider, scopes)) throw new OAuthAccountError('OAUTH_SCOPE_MISSING', 403);
    if (!provider.clientId && principal === 'organizer') throw new OAuthAccountError('OAUTH_NOT_CONFIGURED', 500);
    if (principal === 'service' && provider.serviceCredentials) {
        const creds = await serviceCredentialsOf(provider);
        if (!creds) throw new OAuthAccountError('OAUTH_NOT_CONFIGURED', 503);
        const c = await exchange(`s2s:${provider.id}:${creds.accountId}:${creds.clientId}`, async () => {
            const t = await postToken(provider, { grant_type: provider.serviceCredentials!.grant, account_id: creds.accountId }, { clientId: creds.clientId, clientSecret: creds.clientSecret });
            // Las aplicaciones S2S administradas por el admin devuelven los scopes con sufijo ":admin"; se normalizan al nombre del catalogo.
            const scope = (t.scope ?? '').split(/[\s,]+/).filter(Boolean).map((x) => x.replace(/:admin$/, '')).join(' ');
            return { token: t.access_token, scope: scope || null, exp: Date.now() + (t.expires_in ?? 3000) * 1000 };
        });
        return { accessToken: c.token, scope: c.scope };
    }
    if (principal === 'organizer') {
        const refresh = await getSharedCredential(provider, 'organizerRefreshToken');
        if (!refresh || !provider.clientId || !provider.clientSecret) throw new OAuthAccountError('OAUTH_NOT_CONFIGURED', 503);
        const c = await exchange(`org:${provider.id}`, async () => {
            const t = await postToken(provider, { grant_type: 'refresh_token', refresh_token: refresh, client_id: provider.clientId as string, client_secret: provider.clientSecret as string });
            return { token: t.access_token, scope: t.scope ?? null, exp: Date.now() + (t.expires_in ?? 3000) * 1000 };
        });
        return { accessToken: c.token, scope: c.scope };
    }
    const raw = await getSharedCredential(provider, 'serviceAccountJson');
    const sa = raw ? parseServiceAccount(raw) : null;
    const sub = principalSetting(provider, 'impersonateUser');
    if (!sa || !/^[^\s@<>",;:\\]+@[^\s@<>",;:\\]+$/.test(sub)) throw new OAuthAccountError('OAUTH_NOT_CONFIGURED', 503);
    const scope = Array.from(new Set(scopes)).sort().join(' ');
    const c = await exchange(`svc:${provider.id}:${sub}:${scope}`, async () => {
        const iat = Math.floor(Date.now() / 1000);
        let key;
        try { key = await importPKCS8(sa.private_key, 'RS256'); } catch { throw new OAuthAccountError('OAUTH_NOT_CONFIGURED', 503); }
        const assertion = await new SignJWT({ scope }).setProtectedHeader({ alg: 'RS256', typ: 'JWT' }).setIssuer(sa.client_email).setSubject(sub).setAudience(provider.tokenUrl).setIssuedAt(iat).setExpirationTime(iat + 3600).sign(key);
        const t = await postToken(provider, { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion });
        return { token: t.access_token, scope: t.scope ?? scope, exp: Date.now() + (t.expires_in ?? 3000) * 1000 };
    });
    return { accessToken: c.token, scope: c.scope };
}
