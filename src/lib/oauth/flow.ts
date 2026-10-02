import { NextRequest, NextResponse, after } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser, getSessionCookie, setSessionCookie } from '@/lib/session';
import { mfaRequiredFor } from '@/lib/mfa';
import { refreshPermissions } from '@/lib/permissions';
import { auditLog, getClientIp, isSafeRelativePath, rateLimitAsync } from '@/lib/security';
import { checkOAuthEndpointUrl, extractOAuthExtras, issuerClaimNames, issuerParamMatches, OAUTH_RESERVED_PARAMS } from '@/lib/expansions/oauth-schema';
import { patchAllUserMeetRooms } from '@/lib/google/meet';
import { codeChallengeS256, PKCE_METHOD } from './pkce';
import { clearFlowCookie, newFlow, persistFlow, setFlowCookie, verifyAndConsumeFlow, type FlowMode } from './flow-state';
import { getProvider, usesOfficialEndpoints, type ProviderRuntime } from './providers';
import { exchangeCode, grantAccountId, normalizeScope, OAuthAccountError, parseAccountExtras, tokenGrants } from './tokens';
import { runOnUnlink } from './unlink';
import { verifyIdToken, type IdTokenClaims } from './id-token';
import { providerFetch } from './http';

/**
 * Flujo OAuth 2.0 / OIDC del NUCLEO para los proveedores registrados (ver providers.ts). Rutas:
 *   GET /api/oauth/[provider]/start      inicia (login con Google, vincular o reconectar)
 *   GET /api/oauth/[provider]/callback   redirect_uri
 * y los ALIAS /api/auth/google y /api/auth/callback/google (URLs ya registradas en Google Cloud; mismos handlers).
 *
 * Normas: RFC 6749 (authorization code), RFC 7636 (PKCE S256), RFC 9700 (BCP: state opaco y de un solo uso, redirect_uri EXACTA, sin tokens
 * en URLs ni logs, id_token validado), RFC 9207 (parametro `iss` contra mix-up), OIDC Core (nonce, iss/aud/azp/exp, firma JWKS), RFC 7009
 * (revocacion al desvincular), OWASP ASVS V2/V3/V5/V7.
 */

const DEFAULT_RETURN_TO = '/';

/** returnTo: SOLO ruta relativa del propio origen (nada de //host, esquemas, backslash ni caracteres de control). */
export function resolveReturnTo(value: unknown): string {
    if (!isSafeRelativePath(value) || value.length > 300 || /[\u0000-\u001f\u007f\s]/.test(value)) return DEFAULT_RETURN_TO;
    try {
        const u = new URL(value, 'https://origin.invalid');
        return u.origin === 'https://origin.invalid' && u.pathname.startsWith('/') && !u.pathname.startsWith('//') ? value : DEFAULT_RETURN_TO;
    } catch {
        return DEFAULT_RETURN_TO;
    }
}

export function appOrigin(): string | null {
    const raw = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || '';
    try {
        const u = new URL(raw);
        if (process.env.NODE_ENV === 'production' && u.protocol !== 'https:') return null;
        return u.origin;
    } catch {
        return null;
    }
}

const redirect = (origin: string, path: string) => NextResponse.redirect(`${origin}${path}`);
const fail = (status: number, error: string, headers: Record<string, string> = {}) => NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

/** Peticiones que inician vinculacion con sesion: no desde otro sitio (CSRF en el inicio del flujo). El login anonimo lo cubre el state ligado a la cookie. */
export function isCrossSiteStart(headers: { get(name: string): string | null }): boolean {
    return headers.get('sec-fetch-site') === 'cross-site';
}

export type StartOptions = { mode?: FlowMode; legacyGoogle?: boolean };

export async function startOAuth(req: NextRequest, providerId: string, options: StartOptions = {}): Promise<NextResponse> {
    const provider = await getProvider(providerId);
    if (!provider) return fail(404, 'unknown_provider');
    const origin = appOrigin();
    if (!origin) return fail(500, 'app_url_not_configured');

    const ip = getClientIp(req);
    if (!(await rateLimitAsync(`oauth:start:${providerId}:${ip}`, 30, 60_000)).ok) return fail(429, 'rate_limited', { 'Retry-After': '60' });

    if (provider.status !== 'ready' || !provider.clientId) {
        // Mensaje historico de la ruta de Google (instancias sin GOOGLE_CLIENT_ID); el resto de proveedores usa un codigo estable.
        return provider.id === 'google' && provider.status === 'not_configured' && !provider.clientId
            ? NextResponse.json({ error: 'Google Client ID not configured' }, { status: 500 })
            : fail(provider.status === 'needs_reapproval' ? 409 : 503, provider.status === 'needs_reapproval' ? 'provider_needs_reapproval' : 'provider_not_configured');
    }

    const user = await getCurrentUser().catch(() => null);
    // Google permite INICIAR SESION; el resto de proveedores solo vincula cuentas a un usuario con sesion.
    if (!user && providerId !== 'google') return NextResponse.redirect(new URL('/login?error=LoginRequired', origin));
    const mode: FlowMode = options.mode ?? (user ? 'link' : 'login');
    if (user && isCrossSiteStart(req.headers)) {
        auditLog('auth.oauth.cross_site_start_blocked', { provider: providerId, userId: user.id, ip });
        return fail(403, 'cross_site_start');
    }

    // Scopes pedidos (opcional): solo los del catalogo del proveedor.
    const catalog = new Set(provider.scopes.map((s) => s.id));
    const asked = (req.nextUrl.searchParams.get('scopes') || '').split(/[\s,+]+/).filter(Boolean);
    if (asked.some((s) => !catalog.has(s))) return fail(400, 'invalid_scope');
    const scopes = asked.length > 0 ? Array.from(new Set(asked)) : provider.defaultScopes;

    const redirectUri = `${origin}${provider.redirectPath}`;
    const oidc = scopes.includes('openid') && !!provider.issuer;
    const { state, record } = newFlow({
        provider: provider.id, mode, userId: user?.id ?? null, usePkce: provider.pkce, oidc, redirectUri,
        returnTo: resolveReturnTo(req.nextUrl.searchParams.get('returnTo')), scopes,
    });

    if (checkOAuthEndpointUrl(provider.authorizeUrl, provider.allowedHosts) !== null) return fail(500, 'provider_endpoint_rejected');
    // Slack OAuth v2: scopes del bot en `scope` y los de usuario (prefijo "user:" en el catalogo) en `user_scope`, ambos separados por comas.
    const slack = provider.tokenFormat === 'slack-v2';
    const userScopes = slack ? scopes.filter((s) => s.startsWith('user:')).map((s) => s.slice(5)) : [];
    const sentScopes = slack ? scopes.filter((s) => !s.startsWith('user:')) : scopes;
    const params = new URLSearchParams({ client_id: provider.clientId, redirect_uri: redirectUri, response_type: 'code', scope: sentScopes.join(slack ? ',' : ' '), state });
    if (slack) { if (sentScopes.length === 0) params.delete('scope'); if (userScopes.length) params.set('user_scope', userScopes.join(',')); }
    if (record.verifier) { params.set('code_challenge', codeChallengeS256(record.verifier)); params.set('code_challenge_method', PKCE_METHOD); }
    if (record.nonce) params.set('nonce', record.nonce);
    for (const [k, v] of Object.entries(provider.extraParams)) if (!OAUTH_RESERVED_PARAMS.includes(k)) params.set(k, v);

    // En produccion, sin tabla OAuthFlow no se inicia el flujo (fail-closed): el callback no podria garantizar el state de un solo uso.
    if (!(await persistFlow(record)) && process.env.NODE_ENV === 'production') return NextResponse.json({ error: 'OAuth storage unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    const res = NextResponse.redirect(`${provider.authorizeUrl}?${params.toString()}`);
    setFlowCookie(res, provider.id, record);
    res.headers.set('Cache-Control', 'no-store');
    return res;
}

// ---------------------------------------------------------------------------------------------------------------
// Callback
// ---------------------------------------------------------------------------------------------------------------

interface Profile { id: string; email: string | null; verified: boolean | null; name: string | null; picture: string | null }

/** Perfil real de la respuesta de userinfo: algunos proveedores lo envuelven en "data" (Asana) o "resource" (Calendly). */
export function profileBody(raw: Record<string, any> | null): Record<string, any> | null {
    if (!raw) return null;
    if (raw.id !== undefined || raw.sub !== undefined || raw.account_id !== undefined) return raw;
    for (const wrapped of [raw.data, raw.resource]) if (wrapped && typeof wrapped === 'object' && !Array.isArray(wrapped)) return wrapped as Record<string, any>;
    return raw;
}

/** Identificador estable del perfil: id/sub (OIDC y la mayoria), id numerico (GitHub), account_id (Atlassian), gid (Asana) o uri (Calendly). */
export function profileId(raw: Record<string, any> | null): string | null {
    const body = profileBody(raw);
    if (!body) return null;
    for (const v of [body.id, body.sub, body.account_id, body.gid, body.uri]) {
        if (typeof v === 'string' && v && v.length <= 256) return v;
        if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) return String(v);
    }
    return null;
}

async function loadProfile(provider: ProviderRuntime, accessToken: string, claims: { sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string } | null): Promise<Profile | null> {
    let raw: Record<string, any> | null = null;
    if (provider.userinfoUrl) {
        const res = await providerFetch(provider.allowedHosts, provider.userinfoUrl, { headers: { Authorization: `Bearer ${accessToken}` }, maxBytes: 200_000 });
        raw = res.ok && res.json && typeof res.json === 'object' ? (res.json as Record<string, any>) : null;
    }
    const body = profileBody(raw);
    const id = profileId(raw) ?? claims?.sub;
    if (typeof id !== 'string' || !id) return null;
    // Integridad: si hay id_token validado, el sujeto del userinfo debe ser el mismo (evita mezclar identidades).
    if (claims?.sub && raw && claims.sub !== id) return null;
    const verified = body?.verified_email ?? body?.email_verified ?? claims?.email_verified;
    return {
        id,
        email: typeof (body?.email ?? claims?.email) === 'string' ? String(body?.email ?? claims?.email) : null,
        verified: typeof verified === 'boolean' ? verified : null,
        name: typeof (body?.name ?? claims?.name) === 'string' ? String(body?.name ?? claims?.name) : null,
        picture: typeof (body?.picture ?? claims?.picture) === 'string' ? String(body?.picture ?? claims?.picture) : null,
    };
}

function loginError(origin: string, code: string, provider: string): NextResponse {
    const res = redirect(origin, `/login?error=${code}`);
    clearFlowCookie(res, provider);
    return res;
}

export async function finishOAuth(req: NextRequest, providerId: string): Promise<NextResponse> {
    const origin = appOrigin();
    if (!origin) return fail(500, 'app_url_not_configured');
    const ip = getClientIp(req);
    const provider = await getProvider(providerId);
    if (!provider) return fail(404, 'unknown_provider');
    const q = req.nextUrl.searchParams;
    const isGoogle = provider.id === 'google';
    // Errores de la pantalla de consentimiento (access_denied...) y configuracion ausente: mismo destino historico.
    const code = q.get('code');
    if (!code || provider.status !== 'ready' || !provider.clientId) {
        const res = loginError(origin, isGoogle ? 'ConfigurationError' : 'OAuthFailed', provider.id);
        return res;
    }
    // Mix-up (RFC 9207): si el proveedor devuelve `iss` debe ser el suyo.
    const iss = q.get('iss');
    // (con emisor por plantilla {claim:tid} se acepta cualquier segmento seguro, y el tenant fijado si lo hay; el emisor del id_token se vuelve a comprobar con su tid)
    if (iss && provider.issuer && !(issuerClaimNames(provider.issuer).length > 0 ? issuerParamMatches(provider.issuer, iss, provider.issuerPins) : iss === provider.issuer)) {
        auditLog('auth.oauth.mixup_blocked', { provider: provider.id, ip });
        return loginError(origin, 'InvalidState', provider.id);
    }

    const currentUser = await getCurrentUser().catch(() => null);
    const check = await verifyAndConsumeFlow(req, provider.id, q.get('state'), currentUser?.id ?? null);
    if (check.ok === false) {
        auditLog(isGoogle ? 'auth.google.state_mismatch' : 'auth.oauth.state_rejected', { provider: provider.id, reason: check.reason, ip });
        return loginError(origin, 'InvalidState', provider.id);
    }
    const flow = check.record;
    const returnTo = resolveReturnTo(flow.returnTo);

    try {
        // 1. Intercambio del codigo (PKCE: el verificador viene de la cookie cifrada, nunca de la URL).
        let tokens;
        try {
            tokens = await exchangeCode(provider, { code, redirectUri: flow.redirectUri, verifier: flow.verifier });
        } catch (error) {
            console.error('[OAUTH] token exchange failed:', provider.id, error instanceof Error ? error.message.slice(0, 80) : 'unknown');
            return loginError(origin, isGoogle ? 'GoogleAuthFailed' : 'OAuthFailed', provider.id);
        }

        // RFC 6749 §5.1: si la respuesta no trae `scope` (Telegram, Todoist), los scopes concedidos son los pedidos.
        if (provider.tokenFormat !== 'slack-v2' && typeof tokens.scope !== 'string') tokens = { ...tokens, scope: flow.scopes.join(' ') };

        // Slack OAuth v2: sin id_token ni userinfo; la identidad (equipo + usuario) viene en la respuesta del token y se guardan bot y usuario por separado.
        if (provider.tokenFormat === 'slack-v2') return await completeGrants({ origin, provider, tokens, returnTo, currentUserId: currentUser?.id ?? null, ip });

        // 2. id_token (OIDC): firma, iss, aud, azp, exp y nonce.
        let claims: IdTokenClaims | null = null;
        if (provider.issuer && provider.jwksUri && (tokens.id_token || flow.nonce)) {
            if (!tokens.id_token) return loginError(origin, isGoogle ? 'GoogleAuthFailed' : 'OAuthFailed', provider.id);
            const verdict = await verifyIdToken(provider, tokens.id_token, { clientId: provider.clientId, nonce: flow.nonce });
            if (verdict.ok === false) {
                auditLog('auth.oauth.id_token_rejected', { provider: provider.id, reason: verdict.reason, ip });
                return loginError(origin, isGoogle ? 'GoogleAuthFailed' : 'OAuthFailed', provider.id);
            }
            claims = verdict.claims;
        }

        // 2b. Datos extra del proveedor (instancia de Salesforce, webhook de Discord, id de Telegram...): validados con el patron del proveedor; si falta o no
        // cumple, NO se vincula (nada de URLs ni identificadores arbitrarios). Se guardan CIFRADOS por cuenta; los valores nunca se registran.
        const extras = extractOAuthExtras(provider.extras, tokens, claims);
        if (!extras) {
            auditLog('auth.oauth.extras_rejected', { provider: provider.id, ip });
            return loginError(origin, 'OAuthFailed', provider.id);
        }

        // 3. Perfil
        const profile = await loadProfile(provider, tokens.access_token, claims);
        if (!profile) return loginError(origin, isGoogle ? 'GoogleAuthFailed' : 'OAuthFailed', provider.id);

        if (isGoogle) {
            // Inicio de sesion SOLO con el proveedor Google OFICIAL (integrado o su extension oficial, con los endpoints de Google): una definicion
            // ajena con id `google` jamas puede autenticar usuarios.
            if (!isOfficialGoogle(provider)) {
                auditLog('auth.oauth.untrusted_login_provider', { provider: provider.id, extensionId: provider.extensionId, ip });
                return loginError(origin, 'ConfigurationError', provider.id);
            }
        }
        if (isGoogle) return await completeGoogleIdentity({ req, origin, provider, profile, tokens, returnTo, currentUserId: currentUser?.id ?? null, ip });
        return await completeLinkOnly({ origin, provider, profile, tokens, extras, returnTo, currentUserId: currentUser?.id ?? null, ip });
    } catch (error) {
        if (error instanceof OAuthAccountError) return loginError(origin, 'OAuthFailed', provider.id);
        console.error('[OAUTH] callback error:', provider.id, error instanceof Error ? error.message.slice(0, 120) : 'unknown');
        return loginError(origin, isGoogle ? 'ServerAuthError' : 'OAuthFailed', provider.id);
    }
}

/** Proveedor `google` legitimo: el integrado o `core-googlelib`, y con TODOS los endpoints en hosts oficiales de Google. */
export function isOfficialGoogle(provider: Pick<ProviderRuntime, 'id' | 'source' | 'extensionId' | 'endpointHosts'>): boolean {
    return provider.id === 'google' && (provider.source === 'builtin' || provider.extensionId === 'core-googlelib') && usesOfficialEndpoints('google', provider.endpointHosts);
}

type Tokens = Awaited<ReturnType<typeof exchangeCode>>;
const expiresAt = (t: Tokens) => (t.expires_in ? Math.floor(Date.now() / 1000 + Number(t.expires_in)) : undefined);

async function upsertAccount(provider: ProviderRuntime, userId: string, profile: Profile, t: Tokens, extras?: Record<string, string>) {
    // Solo los proveedores que declaran `extras` escriben provider_data (JSON cifrado por la capa de cifrado de Account); el resto no lo toca.
    let providerData: string | undefined;
    if (Object.keys(provider.extras ?? {}).length > 0) {
        const next = extras ?? {};
        const prev = await prisma.account.findUnique({ where: { provider_providerAccountId: { provider: provider.id, providerAccountId: profile.id } } }).catch(() => null) as { provider_data?: string | null } | null;
        const before = parseAccountExtras(prev?.provider_data, provider);
        let stored = next;
        if (Object.keys(next).length === 0) stored = before; // nueva autorizacion sin datos (p. ej. solo identify en Discord): se conserva lo anterior
        else if (Object.entries(before).some(([k, v]) => k in next && next[k] !== v)) {
            // Los datos se REEMPLAZAN (otro webhook/instancia): lo anterior se limpia en el proveedor (onUnlink) para no dejar credenciales vivas huerfanas.
            if (provider.onUnlink) await runOnUnlink(provider, { provider_data: prev?.provider_data });
        }
        providerData = JSON.stringify(stored);
    }
    await prisma.account.upsert({
        where: { provider_providerAccountId: { provider: provider.id, providerAccountId: profile.id } },
        create: {
            userId, type: 'oauth', provider: provider.id, providerAccountId: profile.id,
            access_token: t.access_token, refresh_token: t.refresh_token, id_token: t.id_token, scope: t.scope, token_type: t.token_type, expires_at: expiresAt(t), provider_hash: provider.identityHash, provider_data: providerData,
        },
        update: {
            access_token: t.access_token, refresh_token: t.refresh_token ?? undefined, id_token: t.id_token, scope: t.scope, expires_at: expiresAt(t), provider_hash: provider.identityHash, provider_data: providerData,
        },
    });
}

/** Proveedores que no son de inicio de sesion: solo se VINCULAN a un usuario con sesion (el mismo que inicio el flujo). */
async function completeLinkOnly(a: { origin: string; provider: ProviderRuntime; profile: Profile; tokens: Tokens; extras?: Record<string, string>; returnTo: string; currentUserId: string | null; ip: string }): Promise<NextResponse> {
    if (!a.currentUserId) return loginError(a.origin, 'LoginRequired', a.provider.id);
    const existing = await prisma.account.findUnique({ where: { provider_providerAccountId: { provider: a.provider.id, providerAccountId: a.profile.id } } });
    if (existing && existing.userId !== a.currentUserId) {
        const res = redirect(a.origin, `${a.returnTo}${a.returnTo.includes('?') ? '&' : '?'}error=AccountAlreadyLinked`);
        clearFlowCookie(res, a.provider.id);
        return res;
    }
    await upsertAccount(a.provider, a.currentUserId, a.profile, a.tokens, a.extras);
    auditLog('auth.oauth.linked', { provider: a.provider.id, userId: a.currentUserId, ip: a.ip });
    const ok = redirect(a.origin, a.returnTo);
    clearFlowCookie(ok, a.provider.id);
    return ok;
}

/** Proveedores con varias concesiones por autorizacion (Slack: bot + usuario): cada una es una cuenta propia del usuario con sesion. */
async function completeGrants(a: { origin: string; provider: ProviderRuntime; tokens: Tokens; returnTo: string; currentUserId: string | null; ip: string }): Promise<NextResponse> {
    if (!a.currentUserId) return loginError(a.origin, 'LoginRequired', a.provider.id);
    const identity = tokenGrants(a.provider, a.tokens);
    if (!identity) return loginError(a.origin, 'OAuthFailed', a.provider.id);
    const planned = identity.grants.map((g) => ({ grant: g, accountId: grantAccountId(identity, g, '') }));
    for (const { accountId } of planned) {
        const existing = await prisma.account.findUnique({ where: { provider_providerAccountId: { provider: a.provider.id, providerAccountId: accountId } } });
        if (existing && existing.userId !== a.currentUserId) {
            const res = redirect(a.origin, `${a.returnTo}${a.returnTo.includes('?') ? '&' : '?'}error=AccountAlreadyLinked`);
            clearFlowCookie(res, a.provider.id);
            return res;
        }
    }
    for (const { grant, accountId } of planned) {
        await upsertAccount(a.provider, a.currentUserId, { id: accountId, email: null, verified: null, name: identity.teamName ?? null, picture: null }, { ...grant, access_token: grant.access_token } as Tokens);
    }
    auditLog('auth.oauth.linked', { provider: a.provider.id, userId: a.currentUserId, ip: a.ip, grants: planned.map((p) => p.grant.kind) });
    const ok = redirect(a.origin, a.returnTo);
    clearFlowCookie(ok, a.provider.id);
    return ok;
}

/** Google: iniciar sesion O vincular, con EXACTAMENTE las reglas historicas (alta bloqueada en produccion, MFA, correo verificado...). */
async function completeGoogleIdentity(a: { req: NextRequest; origin: string; provider: ProviderRuntime; profile: Profile; tokens: Tokens; returnTo: string; currentUserId: string | null; ip: string }): Promise<NextResponse> {
    const { origin, provider, profile, tokens, returnTo, currentUserId, ip } = a;
    if (!profile.email) return loginError(origin, 'NoEmail', provider.id);
    // Solo emails verificados por Google (evita toma de cuenta por coincidencia de email)
    if (profile.verified !== true) {
        auditLog('auth.google.unverified_email', { email: profile.email });
        return loginError(origin, 'EmailNotVerified', provider.id);
    }

    const existingGoogleAccount = await prisma.account.findUnique({ where: { provider_providerAccountId: { provider: 'google', providerAccountId: profile.id } } });
    if (currentUserId && existingGoogleAccount && existingGoogleAccount.userId !== currentUserId) {
        const res = redirect(origin, `${returnTo}?error=GoogleAlreadyLinked`);
        clearFlowCookie(res, provider.id);
        return res;
    }

    let user = currentUserId ? await prisma.user.findUnique({ where: { id: currentUserId } }) : await prisma.user.findUnique({ where: { email: profile.email } });

    // Registro por Google solo si se habilita explicitamente en produccion (el registro por formulario exige REGISTRATION_KEY).
    if (!user && process.env.NODE_ENV === 'production' && process.env.GOOGLE_ALLOW_SIGNUP !== 'true') {
        auditLog('auth.google.signup_blocked', { email: profile.email, ip });
        return loginError(origin, 'SignupDisabled', provider.id);
    }

    // Inicio de sesion (no vinculacion) de una cuenta que EXIGE MFA (p. ej. admin): Google no sustituye al segundo factor.
    await refreshPermissions();
    if (!currentUserId && user && mfaRequiredFor(user.email)) {
        auditLog('auth.google.mfa_required_blocked', { userId: user.id, ip });
        return loginError(origin, 'MfaRequiredUsePassword', provider.id);
    }

    if (!user) {
        user = await prisma.user.create({ data: { email: profile.email, name: profile.name, avatar: profile.picture, password: '' } });
    }

    await upsertAccount(provider, user.id, profile, tokens);

    // Al vincular con sesion ya iniciada se conserva el claim mfa de esa sesion.
    const currentSession = currentUserId ? await getSessionCookie() : null;
    await setSessionCookie({ sub: user.id, email: user.email, name: user.name }, { mfa: currentSession?.mfa === true && currentSession.sub === user.id });

    // Parchea las salas de Meet existentes tras reconectar (solo si el token trae el scope de Meet).
    if (tokens.scope && grantedHas(tokens.scope, 'meetings.space.created')) {
        after(patchAllUserMeetRooms(user.id, tokens.access_token).catch(() => undefined));
    }

    auditLog('auth.google.success', { userId: user.id, email: user.email, ip });
    const ok = redirect(origin, returnTo);
    clearFlowCookie(ok, provider.id);
    return ok;
}

const grantedHas = (scope: string, needle: string) => scope.split(/[\s,]+/).map(normalizeScope).some((s) => s.includes(needle));
