import { SignJWT, importPKCS8 } from 'jose';
import { providerFetch } from './http';
import { getSharedCredential, principalSetting, usesOfficialEndpoints, type ProviderRuntime } from './providers';
import { OAuthAccountError, type TokenResponse } from './tokens';

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

export interface PrincipalAvailability { user: number; organizer: boolean; service: boolean; mode: string; accounts: { organizerEmail: string; impersonateUser: string } }

/** Que identidades compartidas hay configuradas (sin valores) y el modo elegido por el admin. */
export async function describePrincipals(provider: ProviderRuntime, userAccounts: number): Promise<PrincipalAvailability> {
    const [refresh, sa] = await Promise.all([getSharedCredential(provider, 'organizerRefreshToken'), getSharedCredential(provider, 'serviceAccountJson')]);
    return {
        user: userAccounts,
        organizer: !!refresh && !!provider.clientId && !!provider.clientSecret,
        service: !!sa && !!parseServiceAccount(sa) && !!principalSetting(provider, 'impersonateUser'),
        mode: principalSetting(provider, 'authMode'),
        // Cuentas NO secretas (para mostrar "actuando como"); solo se revelan a quien tiene OAUTH_SHARED.
        accounts: { organizerEmail: principalSetting(provider, 'organizerEmail'), impersonateUser: principalSetting(provider, 'impersonateUser') },
    };
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

async function postToken(provider: ProviderRuntime, form: Record<string, string>): Promise<TokenResponse> {
    const res = await providerFetch(provider.allowedHosts, provider.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString(), maxBytes: 100_000 });
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
