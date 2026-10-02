import { createLocalJWKSet, decodeProtectedHeader, jwtVerify, type JSONWebKeySet, type JWTPayload } from 'jose';
import { safeEqual } from '@/lib/security';
import { issuerClaimNames, issuerMatches } from '@/lib/expansions/oauth-schema';
import { providerFetch } from './http';
import type { ProviderRuntime } from './providers';

/**
 * Validacion de id_token OIDC (OpenID Connect Core 1.0 §3.1.3.7 y §2): firma contra el JWKS del proveedor (RS256/ES256/PS256; NUNCA `none`
 * ni HS*), `iss` exacto, `aud` = nuestro client_id, `azp` (si hay varias audiencias), `exp`/`iat` con tolerancia de 60 s, y `nonce`
 * (ligado al navegador por la cookie del flujo). El JWKS se cachea respetando Cache-Control (por defecto 1 h), se recarga UNA vez por minuto
 * si llega un `kid` desconocido (rotacion de claves) y, si el proveedor no responde, se mantiene la copia anterior hasta 24 h (gracia).
 */

const ALGS = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'PS256'];
const DEFAULT_TTL_MS = 3_600_000;
const GRACE_MS = 24 * 3_600_000;
const MIN_REFETCH_MS = 60_000;

interface JwksEntry { jwks: JSONWebKeySet; fetchedAt: number; expiresAt: number; lastAttempt: number }
const cache = new Map<string, JwksEntry>();
export function __resetJwksCache(): void { cache.clear(); }

function ttlFrom(cacheControl: string | null): number {
    const m = /max-age=(\d{1,7})/.exec(cacheControl ?? '');
    return m ? Math.min(Number(m[1]), 86_400) * 1000 : DEFAULT_TTL_MS;
}

async function fetchJwks(provider: Pick<ProviderRuntime, 'allowedHosts' | 'jwksUri'>, now: number): Promise<JwksEntry | null> {
    const url = provider.jwksUri;
    if (!url) return null;
    const prev = cache.get(url);
    try {
        const res = await providerFetch(provider.allowedHosts, url, { maxBytes: 200_000, timeoutMs: 8_000 });
        const keys = (res.json as { keys?: unknown } | null)?.keys;
        if (!res.ok || !Array.isArray(keys) || keys.length === 0 || keys.length > 50) throw new Error('bad_jwks');
        const entry: JwksEntry = { jwks: { keys: keys as JSONWebKeySet['keys'] }, fetchedAt: now, expiresAt: now + DEFAULT_TTL_MS, lastAttempt: now };
        cache.set(url, entry);
        return entry;
    } catch {
        if (prev) { prev.lastAttempt = now; return prev.fetchedAt + GRACE_MS > now ? prev : null; }
        return null;
    }
}

async function getJwks(provider: Pick<ProviderRuntime, 'allowedHosts' | 'jwksUri'>, kid: string | undefined, now: number): Promise<JSONWebKeySet | null> {
    const url = provider.jwksUri;
    if (!url) return null;
    let entry = cache.get(url) ?? null;
    const stale = !entry || entry.expiresAt <= now;
    const unknownKid = !!entry && !!kid && !entry.jwks.keys.some((k) => (k as { kid?: string }).kid === kid);
    if (stale || (unknownKid && now - entry!.lastAttempt >= MIN_REFETCH_MS)) entry = (await fetchJwks(provider, now)) ?? entry;
    return entry && entry.fetchedAt + GRACE_MS > now ? entry.jwks : null;
}

export type IdTokenClaims = JWTPayload & { sub: string; email?: string; email_verified?: boolean; name?: string; picture?: string };
export type IdTokenResult = { ok: true; claims: IdTokenClaims } | { ok: false; reason: 'no_oidc_config' | 'bad_header' | 'no_jwks' | 'signature' | 'claims' | 'nonce' | 'azp' };

export async function verifyIdToken(
    provider: Pick<ProviderRuntime, 'allowedHosts' | 'jwksUri' | 'issuer'> & { issuerPins?: Record<string, string> },
    idToken: string,
    expect: { clientId: string; nonce: string | null },
    now = Date.now(),
): Promise<IdTokenResult> {
    if (!provider.issuer || !provider.jwksUri) return { ok: false, reason: 'no_oidc_config' };
    let header;
    try { header = decodeProtectedHeader(idToken); } catch { return { ok: false, reason: 'bad_header' }; }
    if (!header.alg || !ALGS.includes(header.alg)) return { ok: false, reason: 'bad_header' };
    const jwks = await getJwks(provider, header.kid, now);
    if (!jwks) return { ok: false, reason: 'no_jwks' };
    let payload: JWTPayload;
    try {
        // Emisor con claim (Microsoft multi-tenant: https://login.microsoftonline.com/{claim:tid}/v2.0): la firma y las demas claims se verifican con jose y el
        // emisor se compara DESPUES, con el tid del propio token ya firmado, de forma exacta y (con tenant fijo) fijado a ese tenant.
        const templated = issuerClaimNames(provider.issuer).length > 0;
        ({ payload } = await jwtVerify(idToken, createLocalJWKSet(jwks), { ...(templated ? {} : { issuer: provider.issuer }), audience: expect.clientId, algorithms: ALGS, clockTolerance: 60, currentDate: new Date(now) }));
        if (templated && !issuerMatches(provider.issuer, payload.iss, payload as Record<string, unknown>, provider.issuerPins ?? {})) return { ok: false, reason: 'claims' };
    } catch (error) {
        const code = (error as { code?: string } | null)?.code ?? '';
        return { ok: false, reason: /JWS|JWK|signature|NO_MATCHING_KEY|MULTIPLE_MATCHING/i.test(code) ? 'signature' : 'claims' };
    }
    if (typeof payload.sub !== 'string' || !payload.sub) return { ok: false, reason: 'claims' };
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (aud.length > 1 && payload.azp !== expect.clientId) return { ok: false, reason: 'azp' };
    if (typeof payload.azp === 'string' && payload.azp !== expect.clientId) return { ok: false, reason: 'azp' };
    if (expect.nonce !== null) {
        if (typeof payload.nonce !== 'string' || !safeEqual(payload.nonce, expect.nonce)) return { ok: false, reason: 'nonce' };
    }
    return { ok: true, claims: payload as IdTokenClaims };
}
