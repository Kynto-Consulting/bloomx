import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePrisma } from './harness';
import { FakeIdP, json } from './provider-harness';

// Nucleo OAuth v2 (oauth.provider.v2) con proveedores SINTETICOS: variables de URL ({tenant}), emisor por claim ({claim:tid}), client_secret_basic,
// revocacion por access token, OAuth v2 de Slack (bot + usuario), credenciales S2S, query con $ y parametros acotados por un ajuste del admin.
// Los proveedores REALES (manifests de bloomx-extensions) se prueban en microsoft.flow.test.ts, zoom.flow.test.ts y slack.flow.test.ts.

const h = vi.hoisted(() => ({
    prisma: null as any,
    currentUser: null as null | { id: string; email: string },
    audits: [] as Array<{ event: string; data: any }>,
}));
vi.mock('@/lib/prisma', () => ({ get prisma() { return h.prisma; } }));
vi.mock('@/lib/session', () => ({
    getCurrentUser: vi.fn(async () => h.currentUser),
    getSessionCookie: vi.fn(async () => ({ mfa: false })),
    setSessionCookie: vi.fn(async () => undefined),
}));
vi.mock('@/lib/mfa', () => ({ mfaRequiredFor: vi.fn(() => false) }));
vi.mock('@/lib/permissions', () => ({ refreshPermissions: vi.fn(async () => undefined) }));
vi.mock('@/lib/google/meet', () => ({ patchAllUserMeetRooms: vi.fn(async () => undefined) }));
vi.mock('@/lib/security', async () => {
    const actual = await vi.importActual<typeof import('@/lib/security')>('@/lib/security');
    return { ...actual, auditLog: vi.fn((event: string, data: any) => { h.audits.push({ event, data }); }) };
});
vi.mock('next/server', async () => {
    const actual = await vi.importActual<typeof import('next/server')>('next/server');
    return { ...actual, after: (p: Promise<unknown>) => { void p; } };
});
vi.mock('@/lib/db/pool', () => ({ getDbPool: () => { throw new Error('no db in unit tests'); } }));

import { NextRequest } from 'next/server';
import { startOAuth, finishOAuth } from '../flow';
import { __setOAuthTransport } from '../http';
import { __setOAuthStore, createMemoryOAuthStore } from '../store';
import { __setExtensionsSource, getProvider, saveProviderSecret, saveSharedCredential } from '../providers';
import { __resetFlowMemory } from '../flow-state';
import { __resetJwksCache } from '../id-token';
import { __setRefreshLock, getAccessToken } from '../tokens';
import { __resetPrincipalCache } from '../principals';
import { unlinkUserProvider } from '../unlink';
import { handleOAuthBridge, oauthBridgeRequest } from '../broker';

const ORIGIN = 'https://app.test';
const GUID_A = '11111111-2222-3333-4444-555555555555';
const GUID_B = '99999999-8888-7777-6666-000000000000';
let idp: FakeIdP;
let fake: ReturnType<typeof createFakePrisma>;
let store: ReturnType<typeof createMemoryOAuthStore>;
let ipSeq = 0;
let apiCalls: Array<{ url: string; method: string; auth: string | null; body: string | undefined }>;

const req = (url: string, cookie?: string, headers: Record<string, string> = {}) => new NextRequest(url, { headers: { 'x-forwarded-for': `10.60.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`, ...(cookie ? { cookie } : {}), ...headers } });
const cookieFrom = (res: Response, id: string) => { for (const c of res.headers.getSetCookie()) { const m = new RegExp(`^bloomx_oauth_flow_${id}=([^;]*)`).exec(c); if (m && m[1]) return `bloomx_oauth_flow_${id}=${m[1]}`; } return null; };
async function begin(id: string, query = '') {
    const res = await startOAuth(req(`${ORIGIN}/api/oauth/${id}/start${query}`), id);
    return { res, auth: res.headers.get('location') ? new URL(res.headers.get('location') as string) : null, cookie: cookieFrom(res, id) };
}
const callback = (id: string, code: string | null, state: string | null, cookie: string | null, extra = '') =>
    finishOAuth(req(`${ORIGIN}/api/oauth/${id}/callback?${[code ? `code=${code}` : '', state ? `state=${state}` : '', extra].filter(Boolean).join('&')}`, cookie ?? undefined), id);
const loc = (res: Response) => res.headers.get('location') ?? '';

// ---------------------------------------------------------------- definiciones sinteticas -------------------------------------------------
const field = (key: string, secret = false) => ({ key, type: 'string', label: key, ...(secret ? { secret: true } : {}) });
const ms = (config: Record<string, unknown> = {}) => ({
    id: 'core-microsoftlib', settings: { config: { MS_CLIENT_ID: 'ms-cid', ...config } },
    template: {
        id: 'core-microsoftlib', version: '1.0.0',
        settingsSchema: { fields: [field('MS_CLIENT_ID'), field('MS_TENANT'), field('MS_CLIENT_SECRET', true)] },
        oauthProviders: [{
            id: 'microsoft', displayName: 'Microsoft',
            authorizeUrl: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize', tokenUrl: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token',
            jwksUri: 'https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys', issuer: 'https://login.microsoftonline.com/{claim:tid}/v2.0',
            userinfoUrl: 'https://graph.microsoft.com/oidc/userinfo', apiBase: 'https://graph.microsoft.com',
            allowedHosts: ['login.microsoftonline.com', 'graph.microsoft.com'],
            variables: { tenant: { setting: 'MS_TENANT', default: 'common', pattern: '^(common|organizations|consumers|[0-9a-fA-F-]{36})$' } },
            scopes: [
                { id: 'openid', group: 'userinfo', es: 'a', en: 'a', risk: 'low' }, { id: 'offline_access', group: 'userinfo', es: 'a', en: 'a', risk: 'low' },
                { id: 'User.Read', group: 'userinfo', es: 'a', en: 'a', risk: 'low' }, { id: 'Calendars.ReadWrite', group: 'calendar', es: 'c', en: 'c', risk: 'high' },
            ],
            defaultScopes: ['openid', 'offline_access', 'User.Read', 'Calendars.ReadWrite'], pkce: true, clientIdSetting: 'MS_CLIENT_ID', clientSecretCredential: 'MS_CLIENT_SECRET',
            actions: [
                { id: 'calendar.events.list', group: 'calendar', method: 'GET', path: '/v1.0/me/events', requiresScopes: ['Calendars.ReadWrite'], params: {
                    top: { in: 'query', type: 'integer', min: 1, max: 100, queryName: '$top' }, select: { in: 'query', type: 'string', maxLength: 200, queryName: '$select' } } },
            ],
        }],
    },
});
const zoomLike = (config: Record<string, unknown> = {}) => ({
    id: 'core-zoomlib', settings: { config: { Z_CLIENT_ID: 'z-cid', Z_ACCOUNT_ID: 'acct-1234', Z_S2S_CLIENT_ID: 's2s-cid', ...config } },
    template: {
        id: 'core-zoomlib', version: '1.0.0',
        settingsSchema: { fields: [field('Z_CLIENT_ID'), field('Z_ACCOUNT_ID'), field('Z_S2S_CLIENT_ID'), field('Z_CLIENT_SECRET', true), field('Z_S2S_SECRET', true)] },
        oauthProviders: [{
            id: 'zoom', displayName: 'Zoom', authorizeUrl: 'https://zoom.us/oauth/authorize', tokenUrl: 'https://zoom.us/oauth/token', revokeUrl: 'https://zoom.us/oauth/revoke',
            userinfoUrl: 'https://api.zoom.us/v2/users/me', apiBase: 'https://api.zoom.us', allowedHosts: ['zoom.us', 'api.zoom.us'],
            scopes: [{ id: 'meeting:write:meeting', group: 'meetings', es: 'm', en: 'm', risk: 'medium' }, { id: 'user:read:user', group: 'userinfo', es: 'u', en: 'u', risk: 'low' }],
            pkce: true, tokenAuth: 'basic', revokeToken: 'access', clientIdSetting: 'Z_CLIENT_ID', clientSecretCredential: 'Z_CLIENT_SECRET',
            serviceCredentials: { grant: 'account_credentials', accountIdSetting: 'Z_ACCOUNT_ID', clientIdSetting: 'Z_S2S_CLIENT_ID', clientSecretCredential: 'Z_S2S_SECRET' },
            actions: [{ id: 'meetings.create', group: 'meetings', method: 'POST', path: '/v2/users/{userId}/meetings', write: true, requiresScopes: ['meeting:write:meeting'], bodyFrom: 'meeting',
                params: { userId: { in: 'path', type: 'string', required: true, pattern: '^(me|[A-Za-z0-9_.@+-]{1,128})$' }, meeting: { in: 'body', type: 'object', required: true } } }],
        }],
    },
});
const slackLike = (config: Record<string, unknown> = {}) => ({
    id: 'core-slacklib', settings: { config: { S_CLIENT_ID: 's-cid', S_ALLOWED: 'C0123ABCD, G0456EFGH', ...config } },
    template: {
        id: 'core-slacklib', version: '1.0.0',
        settingsSchema: { fields: [field('S_CLIENT_ID'), field('S_ALLOWED'), field('S_CLIENT_SECRET', true)] },
        oauthProviders: [{
            id: 'slack', displayName: 'Slack', authorizeUrl: 'https://slack.com/oauth/v2/authorize', tokenUrl: 'https://slack.com/api/oauth.v2.access', revokeUrl: 'https://slack.com/api/auth.revoke',
            apiBase: 'https://slack.com', allowedHosts: ['slack.com'], tokenFormat: 'slack-v2', pkce: false, clientIdSetting: 'S_CLIENT_ID', clientSecretCredential: 'S_CLIENT_SECRET',
            scopes: [{ id: 'chat:write', group: 'chat', es: 'c', en: 'c', risk: 'medium' }, { id: 'channels:read', group: 'channels', es: 'c', en: 'c', risk: 'low' },
                { id: 'user:chat:write', group: 'chat', es: 'c', en: 'c', risk: 'medium' }],
            defaultScopes: ['chat:write', 'channels:read', 'user:chat:write'],
            actions: [
                { id: 'chat.postMessage', group: 'chat', method: 'POST', path: '/api/chat.postMessage', write: true, requiresScopes: ['chat:write'], params: {
                    channel: { in: 'body', type: 'string', required: true, pattern: '^[CG][A-Z0-9]{2,20}$', allowedFromSetting: 'S_ALLOWED' }, text: { in: 'body', type: 'string', maxLength: 3000 } } },
                { id: 'chat.postAsUser', group: 'chat', method: 'POST', path: '/api/chat.postMessage', write: true, requiresScopes: ['user:chat:write'], params: {
                    channel: { in: 'body', type: 'string', required: true, pattern: '^[CG][A-Z0-9]{2,20}$' }, text: { in: 'body', type: 'string', maxLength: 3000 } } },
            ],
        }],
    },
});

async function setup(ext: any, secret = 'client-secret-xyz') {
    __setExtensionsSource(async () => [ext]);
    const id = ext.template.oauthProviders[0].id;
    let p = (await getProvider(id))!;
    expect(p.status).toBe('pending_approval');
    await saveProviderSecret(p, secret, 'admin1'); // el admin aprueba los hosts y guarda el secreto
    p = (await getProvider(id))!;
    expect(p.status).toBe('ready');
    return p;
}

beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('NEXTAUTH_URL', ORIGIN);
    vi.stubEnv('DATA_ENCRYPTION_KEY', 'unit-test-key-0123456789abcdef0123456789');
    idp = new FakeIdP({ clientId: 'ms-cid', clientSecret: 'client-secret-xyz' });
    await idp.init();
    apiCalls = [];
    __setOAuthTransport(((url: string, init: any) => {
        const u = new URL(url);
        if (u.host === 'graph.microsoft.com' && u.pathname.startsWith('/v1.0')) {
            apiCalls.push({ url, method: init.method, auth: init.headers.Authorization ?? null, body: init.body });
            return Promise.resolve(json(200, { value: [{ id: 'e1' }] }, { 'set-cookie': 'a=1' }));
        }
        if ((u.host === 'api.zoom.us' && u.pathname.endsWith('/meetings')) || (u.host === 'slack.com' && u.pathname === '/api/chat.postMessage')) {
            apiCalls.push({ url, method: init.method, auth: init.headers.Authorization ?? null, body: init.body });
            return Promise.resolve(json(200, { ok: true, id: 'm1' }));
        }
        return idp.transport(url, init);
    }) as never, async () => ['40.126.1.1']);
    store = createMemoryOAuthStore();
    __setOAuthStore(store);
    __setExtensionsSource(async () => []);
    __resetFlowMemory();
    __resetJwksCache();
    __resetPrincipalCache();
    __setRefreshLock((async (_id: string, fn: () => Promise<unknown>) => fn()) as never);
    fake = createFakePrisma();
    h.prisma = fake.prisma;
    h.currentUser = { id: 'u1', email: 'u1@x.test' };
    h.audits = [];
});
afterEach(() => {
    __setOAuthTransport(null);
    __setOAuthStore(null);
    __setExtensionsSource(null);
    __setRefreshLock(null);
    vi.unstubAllEnvs();
});

// ================================================================ Microsoft: tenant, emisor con claim ================================================================
describe('variables de URL ({tenant}) y emisor por claim ({claim:tid})', () => {
    const wireMs = (tid = GUID_A) => {
        idp.route('login.microsoftonline.com', '/common/oauth2/v2.0/token', idp.standardToken({ idToken: (c) => idp.signIdToken({ iss: `https://login.microsoftonline.com/${tid}/v2.0`, aud: 'ms-cid', sub: c.subject.sub, nonce: c.nonce, extra: { tid } }) }));
        idp.route('login.microsoftonline.com', '/common/discovery/v2.0/keys', idp.jwksEndpoint());
        idp.route('graph.microsoft.com', '/oidc/userinfo', () => json(200, { sub: 'ms-sub-1', name: 'Ana', email: 'ana@contoso.test' }));
    };

    it('por defecto usa el tenant `common` y arma el inicio con PKCE, nonce, state y offline_access', async () => {
        await setup(ms());
        const { res, auth } = await begin('microsoft');
        expect(res.status).toBe(307);
        expect(`${auth!.origin}${auth!.pathname}`).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
        expect(auth!.searchParams.get('client_id')).toBe('ms-cid');
        expect(auth!.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/oauth/microsoft/callback`);
        expect(auth!.searchParams.get('scope')).toBe('openid offline_access User.Read Calendars.ReadWrite');
        expect(auth!.searchParams.get('code_challenge_method')).toBe('S256');
        expect(auth!.searchParams.get('nonce')).toBeTruthy();
        expect(auth!.searchParams.get('state')!.length).toBeGreaterThan(20);
        expect(JSON.stringify([...auth!.searchParams])).not.toContain('client-secret-xyz');
    });

    it('un tenant GUID del ajuste se usa en TODAS las URLs; un valor hostil (../, host, esquema) cae al defecto', async () => {
        await setup(ms({ MS_TENANT: GUID_A }));
        const p = (await getProvider('microsoft'))!;
        expect(p.authorizeUrl).toBe(`https://login.microsoftonline.com/${GUID_A}/oauth2/v2.0/authorize`);
        expect(p.tokenUrl).toBe(`https://login.microsoftonline.com/${GUID_A}/oauth2/v2.0/token`);
        expect(p.jwksUri).toBe(`https://login.microsoftonline.com/${GUID_A}/discovery/v2.0/keys`);
        expect(p.issuerPins).toEqual({ tid: GUID_A });
        for (const hostile of ['../evil', 'evil.com/x', 'https://evil.test', 'common/../x', 'a b', '%2e%2e', 'x'.repeat(80)]) {
            __setExtensionsSource(async () => [ms({ MS_TENANT: hostile })]);
            const q = (await getProvider('microsoft'))!;
            expect(q.tokenUrl, hostile).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token');
        }
    });

    it('cambiar de tenant cambia la identidad del proveedor (las cuentas vinculadas con otro tenant dejan de valer)', async () => {
        __setExtensionsSource(async () => [ms()]);
        const a = (await getProvider('microsoft'))!;
        __setExtensionsSource(async () => [ms({ MS_TENANT: GUID_A })]);
        const b = (await getProvider('microsoft'))!;
        expect(a.identityHash).not.toBe(b.identityHash);
        fake.accounts.push({ id: 'acc1', userId: 'u1', type: 'oauth', provider: 'microsoft', providerAccountId: 's', access_token: 'at', refresh_token: 'rt', id_token: null, expires_at: 9999999999, scope: 'User.Read', token_type: 'Bearer', provider_hash: a.identityHash });
        await expect(getAccessToken(b, 'u1')).rejects.toMatchObject({ code: 'OAUTH_NOT_LINKED' });
        expect((await getAccessToken(a, 'u1')).accessToken).toBe('at');
    });

    it('flujo completo con `common`: iss con el tid del propio token, cuenta vinculada y el token NUNCA aparece en la redireccion', async () => {
        await setup(ms());
        wireMs();
        const { auth, cookie } = await begin('microsoft?x=1'.replace('?x=1', ''));
        const code = idp.consent(auth!.toString(), { sub: 'ms-sub-1' });
        const res = await callback('microsoft', code, auth!.searchParams.get('state'), cookie);
        expect(res.status).toBe(307);
        expect(loc(res)).toBe(`${ORIGIN}/`);
        expect(fake.accounts).toHaveLength(1);
        const acc = fake.accounts[0];
        expect(acc.provider).toBe('microsoft');
        expect(acc.providerAccountId).toBe('ms-sub-1');
        expect(acc.userId).toBe('u1');
        expect(acc.access_token).toMatch(/^at-/);
        expect(loc(res) + JSON.stringify(h.audits)).not.toMatch(/at-|rt-|client-secret/);
    });

    it('iss incorrecto, tid distinto del iss, tenant fijo con otro tid, aud ajena y firma alterada se rechazan', async () => {
        const cases: Array<[string, () => Promise<void>, Record<string, unknown>]> = [];
        const attempt = async (name: string, mk: (c: any) => Promise<string>, config: Record<string, unknown> = {}) => {
            __setExtensionsSource(async () => [ms(config)]);
            const p = (await getProvider('microsoft'))!;
            if (p.status !== 'ready') await saveProviderSecret(p, 'client-secret-xyz', 'admin1');
            idp.routes.clear();
            idp.codes.clear();
            const tenant = (config.MS_TENANT as string) ?? 'common';
            idp.route('login.microsoftonline.com', `/${tenant}/oauth2/v2.0/token`, idp.standardToken({ idToken: (c) => mk(c) }));
            idp.route('login.microsoftonline.com', `/${tenant}/discovery/v2.0/keys`, idp.jwksEndpoint());
            idp.route('graph.microsoft.com', '/oidc/userinfo', () => json(200, { sub: 'ms-sub-1' }));
            fake.accounts.length = 0;
            __resetJwksCache();
            __resetFlowMemory();
            const { auth, cookie } = await begin('microsoft');
            const res = await callback('microsoft', idp.consent(auth!.toString(), { sub: 'ms-sub-1' }), auth!.searchParams.get('state'), cookie);
            expect(loc(res), name).toContain('/login?error=OAuthFailed');
            expect(fake.accounts, name).toHaveLength(0);
        };
        void cases;
        const base = (c: any, over: any = {}) => idp.signIdToken({ iss: `https://login.microsoftonline.com/${GUID_A}/v2.0`, aud: 'ms-cid', sub: 'ms-sub-1', nonce: c.nonce, extra: { tid: GUID_A }, ...over });
        await attempt('iss de otro host', (c) => base(c, { iss: `https://evil.example.com/${GUID_A}/v2.0` }));
        await attempt('iss con tid distinto del claim', (c) => base(c, { iss: `https://login.microsoftonline.com/${GUID_B}/v2.0` }));
        await attempt('iss v1 (sts.windows.net)', (c) => base(c, { iss: `https://sts.windows.net/${GUID_A}/` }));
        await attempt('sin claim tid', (c) => base(c, { extra: {} }));
        await attempt('tid con segmento hostil', (c) => base(c, { iss: 'https://login.microsoftonline.com/../v2.0', extra: { tid: '..' } }));
        await attempt('aud ajena', (c) => base(c, { aud: 'otra-app' }));
        await attempt('firma alterada', (c) => base(c, { badSignature: true }));
        await attempt('alg none', (c) => base(c, { alg: 'none' }));
        await attempt('nonce distinto', (c) => base(c, { nonce: 'otro' }));
        // Tenant FIJO (GUID_A): un token firmado y valido de OTRO tenant (GUID_B) no entra.
        await attempt('tenant fijo con tid de otro tenant', (c) => base(c, { iss: `https://login.microsoftonline.com/${GUID_B}/v2.0`, extra: { tid: GUID_B } }), { MS_TENANT: GUID_A });
    }, 30_000);

    it('mix-up (RFC 9207): el parametro iss del callback debe ser del emisor con un segmento seguro (o el tenant fijado)', async () => {
        await setup(ms());
        wireMs();
        for (const bad of ['https://evil.example.com/abc/v2.0', 'https://login.microsoftonline.com/a/b/v2.0', 'https://login.microsoftonline.com/%2e%2e/v2.0']) {
            const { auth, cookie } = await begin('microsoft');
            const res = await callback('microsoft', idp.consent(auth!.toString(), { sub: 'ms-sub-1' }), auth!.searchParams.get('state'), cookie, `iss=${encodeURIComponent(bad)}`);
            expect(loc(res), bad).toContain('InvalidState');
        }
        const ok = await begin('microsoft');
        const res = await callback('microsoft', idp.consent(ok.auth!.toString(), { sub: 'ms-sub-1' }), ok.auth!.searchParams.get('state'), ok.cookie, `iss=${encodeURIComponent(`https://login.microsoftonline.com/${GUID_A}/v2.0`)}`);
        expect(loc(res)).toBe(`${ORIGIN}/`);
    });

    it('state y PKCE de un solo uso; redirect_uri manipulada; sin sesion no se vincula', async () => {
        await setup(ms());
        wireMs();
        const first = await begin('microsoft');
        const code = idp.consent(first.auth!.toString(), { sub: 'ms-sub-1' });
        expect(loc(await callback('microsoft', code, first.auth!.searchParams.get('state'), first.cookie))).toBe(`${ORIGIN}/`);
        // reuso del MISMO state y cookie
        expect(loc(await callback('microsoft', idp.consent(first.auth!.toString(), { sub: 'ms-sub-1' }), first.auth!.searchParams.get('state'), first.cookie))).toContain('InvalidState');
        // state ajeno
        const second = await begin('microsoft');
        expect(loc(await callback('microsoft', idp.consent(second.auth!.toString(), { sub: 'ms-sub-1' }), 'estado-forjado', second.cookie))).toContain('InvalidState');
        // redirect_uri manipulada en la autorizacion: el canje usa la registrada en la cookie y el proveedor falso rechaza
        const third = await begin('microsoft');
        const forged = new URL(third.auth!.toString());
        forged.searchParams.set('redirect_uri', 'https://evil.example.com/cb');
        const res3 = await callback('microsoft', idp.consent(forged.toString(), { sub: 'ms-sub-1' }), third.auth!.searchParams.get('state'), third.cookie);
        expect(loc(res3)).toContain('/login?error=OAuthFailed');
        // PKCE: un verificador que no corresponde al challenge
        const fourth = await begin('microsoft');
        const tampered = new URL(fourth.auth!.toString());
        tampered.searchParams.set('code_challenge', 'A'.repeat(43));
        expect(loc(await callback('microsoft', idp.consent(tampered.toString(), { sub: 'ms-sub-1' }), fourth.auth!.searchParams.get('state'), fourth.cookie))).toContain('OAuthFailed');
        // sin sesion
        h.currentUser = null;
        const anon = await startOAuth(req(`${ORIGIN}/api/oauth/microsoft/start`), 'microsoft');
        expect(anon.headers.get('location')).toContain('/login?error=LoginRequired');
    });

    it('refresh con rotacion: guarda el refresh nuevo y el anterior deja de valer; invalid_grant pide reconectar; unlink borra y no hay revocacion estandar', async () => {
        const p = await setup(ms());
        wireMs();
        idp.rotateRefresh = true;
        const { auth, cookie } = await begin('microsoft');
        await callback('microsoft', idp.consent(auth!.toString(), { sub: 'ms-sub-1' }), auth!.searchParams.get('state'), cookie);
        const acc = fake.accounts[0];
        const firstRt = acc.refresh_token!;
        acc.expires_at = 1; // caducado
        const t = await getAccessToken(p, 'u1');
        expect(t.accessToken).toMatch(/^at-/);
        expect(fake.accounts[0].refresh_token).not.toBe(firstRt);
        expect(idp.refreshTokens.has(firstRt)).toBe(false);
        // el secreto viaja en el CUERPO (client_secret_post), nunca en la URL
        const refreshCall = idp.calls.filter((c) => c.form.grant_type === 'refresh_token').at(-1)!;
        expect(refreshCall.form.client_secret).toBe('client-secret-xyz');
        expect(refreshCall.url).not.toContain('client-secret');
        // invalid_grant => reconectar
        fake.accounts[0].expires_at = 1;
        idp.failRefreshWith = 'invalid_grant';
        await expect(getAccessToken(p, 'u1')).rejects.toMatchObject({ code: 'OAUTH_RECONNECT_REQUIRED' });
        // unlink: Microsoft no tiene revokeUrl => not_supported, pero la fila (tokens) se borra
        const out = await unlinkUserProvider('u1', 'microsoft');
        expect(out).toEqual({ unlinked: 1, revoked: ['no_token'] });
        expect(fake.accounts).toHaveLength(0);
    });

    it('unlink con tokens vivos: sin endpoint de revocacion => not_supported y se borran los tokens locales', async () => {
        await setup(ms());
        fake.accounts.push({ id: 'a1', userId: 'u1', type: 'oauth', provider: 'microsoft', providerAccountId: 's', access_token: 'at', refresh_token: 'rt', id_token: null, expires_at: 9999999999, scope: 'User.Read', token_type: 'Bearer', provider_hash: (await getProvider('microsoft'))!.identityHash });
        const out = await unlinkUserProvider('u1', 'microsoft');
        expect(out).toEqual({ unlinked: 1, revoked: ['not_supported'] });
        expect(fake.accounts).toHaveLength(0);
        expect(idp.calls.some((c) => /revoke|logout/.test(c.url))).toBe(false);
    });

    it('broker: nombres de query con $ ($top/$select) y SSRF: solo graph.microsoft.com/login.microsoftonline.com', async () => {
        const p = await setup(ms());
        fake.accounts.push({ id: 'a1', userId: 'u1', type: 'oauth', provider: 'microsoft', providerAccountId: 's', access_token: 'at-live', refresh_token: 'rt', id_token: null, expires_at: 9999999999, scope: 'openid User.Read https://graph.microsoft.com/Calendars.ReadWrite', token_type: 'Bearer', provider_hash: p.identityHash });
        const call = (params: any, extra: Record<string, unknown> = {}) => handleOAuthBridge({ rateLimit: async () => ({ ok: true, retryAfter: 0 }) },
            oauthBridgeRequest.parse({ op: 'call', userId: 'u1', extensionId: 'core-microsoft-teams', grantedGroups: ['calendar'], args: { provider: 'microsoft', action: 'calendar.events.list', params }, ...extra }));
        const out = (await call({ top: 5, select: 'subject,start' })) as any;
        expect(out.status).toBe(200);
        expect(apiCalls[0].url).toBe('https://graph.microsoft.com/v1.0/me/events?%24top=5&%24select=subject%2Cstart');
        expect(apiCalls[0].auth).toBe('Bearer at-live');
        expect(JSON.stringify(out)).not.toMatch(/at-live|a=1/);
        // parametros no declarados / fuera de rango
        await expect(call({ top: 5000 })).rejects.toMatchObject({ code: 'invalid_args' });
        await expect(call({ $top: 5 })).rejects.toMatchObject({ code: 'invalid_args' });
        await expect(call({ select: 'x' }, { grantedGroups: [] })).rejects.toMatchObject({ code: 'forbidden' });
        await expect(handleOAuthBridge({ rateLimit: async () => ({ ok: true, retryAfter: 0 }) }, oauthBridgeRequest.parse({ op: 'call', userId: 'u1', extensionId: 'x', grantedGroups: ['calendar'], args: { provider: 'microsoft', action: 'mail.messages.list', params: {} } }))).rejects.toMatchObject({ code: 'invalid_args' });
    });
});

// ================================================================ client_secret_basic + revocacion por access token (Zoom) ================================================================
describe('tokenAuth basic, revokeToken access y credenciales S2S', () => {
    const wireZoom = () => {
        idp.opts.tokenAuth = 'basic';
        idp.opts.clientId = 'z-cid';
        idp.route('zoom.us', '/oauth/token', idp.standardToken());
        idp.route('zoom.us', '/oauth/revoke', idp.revokeEndpoint());
        idp.route('api.zoom.us', '/v2/users/me', () => json(200, { id: 'zoom-user-1', email: 'ana@x.test' }));
    };

    it('canje y refresh con Authorization: Basic; ni client_id ni client_secret van en el cuerpo ni en la URL', async () => {
        const p = await setup(zoomLike());
        wireZoom();
        const { auth, cookie } = await begin('zoom');
        expect(auth!.searchParams.get('code_challenge_method')).toBe('S256');
        const res = await callback('zoom', idp.consent(auth!.toString(), { sub: 'zoom-user-1' }), auth!.searchParams.get('state'), cookie);
        expect(loc(res)).toBe(`${ORIGIN}/`);
        const tokenCall = idp.calls.find((c) => c.form.grant_type === 'authorization_code')!;
        expect(tokenCall.headers.Authorization).toBe(`Basic ${Buffer.from('z-cid:client-secret-xyz').toString('base64')}`);
        expect(tokenCall.form.client_secret).toBeUndefined();
        expect(tokenCall.form.client_id).toBeUndefined();
        expect(tokenCall.form.code_verifier).toBeTruthy();
        expect(tokenCall.url).not.toContain('client-secret');
        expect(fake.accounts[0].providerAccountId).toBe('zoom-user-1');
        fake.accounts[0].expires_at = 1;
        await getAccessToken(p, 'u1');
        const refresh = idp.calls.filter((c) => c.form.grant_type === 'refresh_token').at(-1)!;
        expect(refresh.headers.Authorization).toMatch(/^Basic /);
        expect(refresh.form.client_secret).toBeUndefined();
    });

    it('un secreto equivocado del proveedor falso no vincula nada', async () => {
        await setup(zoomLike(), 'otro-secreto');
        wireZoom();
        const { auth, cookie } = await begin('zoom');
        const res = await callback('zoom', idp.consent(auth!.toString(), { sub: 'zoom-user-1' }), auth!.searchParams.get('state'), cookie);
        expect(loc(res)).toContain('OAuthFailed');
        expect(fake.accounts).toHaveLength(0);
    });

    it('unlink revoca el ACCESS token con Basic (refrescando antes si caduco) y borra la cuenta', async () => {
        const p = await setup(zoomLike());
        wireZoom();
        const { auth, cookie } = await begin('zoom');
        await callback('zoom', idp.consent(auth!.toString(), { sub: 'zoom-user-1' }), auth!.searchParams.get('state'), cookie);
        fake.accounts[0].expires_at = 1;
        const out = await unlinkUserProvider('u1', 'zoom');
        expect(out.revoked).toEqual(['revoked']);
        expect(fake.accounts).toHaveLength(0);
        const revokeCall = idp.calls.find((c) => c.url.endsWith('/oauth/revoke'))!;
        expect(revokeCall.headers.Authorization).toMatch(/^Basic /);
        expect(revokeCall.form.token_type_hint).toBe('access_token');
        expect(idp.revoked[0]).toMatch(/^at-/);
        void p;
    });

    it('modo servidor a servidor: account_credentials con las credenciales S2S (Basic), scopes :admin normalizados, token jamas devuelto a la extension', async () => {
        const p = await setup(zoomLike());
        await saveSharedCredential(p, 'Z_S2S_SECRET', 's2s-secret', 'admin1');
        let issued = 0;
        idp.route('zoom.us', '/oauth/token', (r) => {
            expect(r.headers.Authorization).toBe(`Basic ${Buffer.from('s2s-cid:s2s-secret').toString('base64')}`);
            expect(r.form).toEqual({ grant_type: 'account_credentials', account_id: 'acct-1234' });
            issued += 1;
            return json(200, { access_token: 's2s-token-abc', token_type: 'bearer', expires_in: 3600, scope: 'meeting:write:meeting:admin user:read:user:admin' });
        });
        const call = (over: Record<string, unknown> = {}) => handleOAuthBridge({ rateLimit: async () => ({ ok: true, retryAfter: 0 }) },
            oauthBridgeRequest.parse({ op: 'call', userId: 'u1', extensionId: 'core-zoom', grantedGroups: ['meetings'], sharedAllowed: true, args: { provider: 'zoom', action: 'meetings.create', principal: 'service', params: { userId: 'host@x.test', meeting: { topic: 'Demo' } } }, ...over }));
        const out = (await call()) as any;
        expect(out.status).toBe(200);
        expect(apiCalls[0].url).toBe('https://api.zoom.us/v2/users/host%40x.test/meetings');
        expect(apiCalls[0].auth).toBe('Bearer s2s-token-abc');
        expect(JSON.stringify(out)).not.toContain('s2s-token-abc');
        await call();
        expect(issued).toBe(1); // cache en memoria hasta 60 s antes de caducar
        // sin OAUTH_SHARED => prohibido; con accountId junto a un principal compartido => invalid_args
        await expect(call({ sharedAllowed: false })).rejects.toMatchObject({ code: 'forbidden' });
        // credenciales S2S incompletas => no configurado
        __resetPrincipalCache();
        __setExtensionsSource(async () => [zoomLike({ Z_ACCOUNT_ID: '' })]);
        await expect(call()).rejects.toMatchObject({ code: 'not_configured' });
    });
});

// ================================================================ Slack OAuth v2 ================================================================
describe('Slack OAuth v2 (tokenFormat slack-v2): bot + usuario', () => {
    const slackToken = (opts: { rotation?: boolean; botOnly?: boolean } = {}) => (r: { form: Record<string, string>; headers: Record<string, string> }) => {
        if (r.form.client_id !== 's-cid' || r.form.client_secret !== 'client-secret-xyz') return json(200, { ok: false, error: 'invalid_client_id' });
        if (r.form.grant_type === 'refresh_token') {
            const rt = idp.refreshTokens.get(r.form.refresh_token);
            if (!rt) return json(200, { ok: false, error: 'invalid_refresh_token' });
            idp.refreshCount += 1;
            idp.refreshTokens.delete(r.form.refresh_token);
            return json(200, { ok: true, access_token: `xoxb-new-${idp.refreshCount}`, token_type: 'bot', scope: rt.scope, expires_in: 43200, refresh_token: idp.newRefresh(rt.subject, rt.scope) });
        }
        const c = idp.redeem(r.form);
        if (c instanceof Response) return json(200, { ok: false, error: 'invalid_code' });
        const body: Record<string, any> = {
            ok: true, access_token: 'xoxb-bot-token', token_type: 'bot', scope: c.scope, bot_user_id: 'UBOT', app_id: 'A1', team: { id: 'T0TEAM', name: 'Equipo' },
            enterprise: null, is_enterprise_install: false,
            authed_user: { id: c.subject.sub, scope: c.userScope, access_token: opts.botOnly ? undefined : `xoxp-user-${c.subject.sub}`, token_type: 'user' },
        };
        if (opts.rotation) { body.refresh_token = idp.newRefresh(c.subject, c.scope); body.expires_in = 43200; }
        return json(200, body);
    };
    const wireSlack = (opts: { rotation?: boolean; botOnly?: boolean } = {}) => {
        idp.opts.clientId = 's-cid';
        idp.route('slack.com', '/api/oauth.v2.access', slackToken(opts));
        idp.route('slack.com', '/api/auth.revoke', (r) => { idp.revoked.push(r.headers.Authorization); return json(200, { ok: true, revoked: true }); });
    };

    it('inicio: scope del bot y user_scope separados por comas, sin PKCE ni nonce', async () => {
        await setup(slackLike());
        const { auth } = await begin('slack');
        expect(`${auth!.origin}${auth!.pathname}`).toBe('https://slack.com/oauth/v2/authorize');
        expect(auth!.searchParams.get('scope')).toBe('chat:write,channels:read');
        expect(auth!.searchParams.get('user_scope')).toBe('chat:write');
        expect(auth!.searchParams.get('code_challenge')).toBeNull();
        expect(auth!.searchParams.get('nonce')).toBeNull();
        expect(auth!.searchParams.get('client_id')).toBe('s-cid');
        // scopes fuera del catalogo
        const bad = await startOAuth(req(`${ORIGIN}/api/oauth/slack/start?scopes=admin`), 'slack');
        expect(bad.status).toBe(400);
    });

    it('callback: guarda DOS cuentas (bot y usuario) con scopes separados; sin tokens en redireccion/auditoria', async () => {
        await setup(slackLike());
        wireSlack();
        const { auth, cookie } = await begin('slack');
        const res = await callback('slack', idp.consent(auth!.toString(), { sub: 'U0USER1' }), auth!.searchParams.get('state'), cookie);
        expect(loc(res)).toBe(`${ORIGIN}/`);
        expect(fake.accounts.map((a) => a.providerAccountId).sort()).toEqual(['T0TEAM:U0USER1:bot', 'T0TEAM:U0USER1:user']);
        const bot = fake.accounts.find((a) => a.providerAccountId.endsWith(':bot'))!;
        const user = fake.accounts.find((a) => a.providerAccountId.endsWith(':user'))!;
        expect(bot.access_token).toBe('xoxb-bot-token');
        expect(bot.scope).toBe('chat:write,channels:read');
        expect(user.access_token).toBe('xoxp-user-U0USER1');
        expect(user.scope).toBe('user:chat:write');
        expect(loc(res) + JSON.stringify(h.audits)).not.toMatch(/xox[bp]-|client-secret/);
    });

    it('errores de Slack ({ok:false}) con HTTP 200 no vinculan nada; el state sigue siendo de un solo uso', async () => {
        await setup(slackLike(), 'otro-secreto');
        wireSlack();
        const { auth, cookie } = await begin('slack');
        const res = await callback('slack', idp.consent(auth!.toString(), { sub: 'U0USER1' }), auth!.searchParams.get('state'), cookie);
        expect(loc(res)).toContain('OAuthFailed');
        expect(fake.accounts).toHaveLength(0);
        expect(loc(await callback('slack', idp.consent(auth!.toString(), { sub: 'U0USER1' }), auth!.searchParams.get('state'), cookie))).toContain('InvalidState');
    });

    it('broker: elige la cuenta que cubre los scopes (bot vs usuario) y `channel` solo admite los canales del admin', async () => {
        await setup(slackLike());
        wireSlack();
        const { auth, cookie } = await begin('slack');
        await callback('slack', idp.consent(auth!.toString(), { sub: 'U0USER1' }), auth!.searchParams.get('state'), cookie);
        const call = (action: string, params: any, groups = ['chat']) => handleOAuthBridge({ rateLimit: async () => ({ ok: true, retryAfter: 0 }) },
            oauthBridgeRequest.parse({ op: 'call', userId: 'u1', extensionId: 'core-slack-notify', grantedGroups: groups, args: { provider: 'slack', action, params } }));
        await call('chat.postMessage', { channel: 'C0123ABCD', text: 'hola' });
        expect(apiCalls.at(-1)!.auth).toBe('Bearer xoxb-bot-token');
        await call('chat.postAsUser', { channel: 'C0999ZZZZ', text: 'hola' });
        expect(apiCalls.at(-1)!.auth).toBe('Bearer xoxp-user-U0USER1');
        // canal fuera de la lista del admin / formato invalido / lista vacia
        await expect(call('chat.postMessage', { channel: 'C0999ZZZZ', text: 'x' })).rejects.toMatchObject({ code: 'forbidden' });
        await expect(call('chat.postMessage', { channel: 'general', text: 'x' })).rejects.toMatchObject({ code: 'invalid_args' });
        await expect(call('chat.postMessage', { channel: 'C0123ABCD', text: 'x'.repeat(3001) })).rejects.toMatchObject({ code: 'invalid_args' });
        await expect(call('chat.postMessage', { channel: 'C0123ABCD', text: 'x', thread_ts: '1' })).rejects.toMatchObject({ code: 'invalid_args' });
        __setExtensionsSource(async () => [slackLike({ S_ALLOWED: '' })]);
        await expect(call('chat.postMessage', { channel: 'C0123ABCD', text: 'x' })).rejects.toMatchObject({ code: 'forbidden' });
    });

    it('refresh con rotacion de Slack; invalid_refresh_token pide reconectar', async () => {
        const p = await setup(slackLike());
        wireSlack({ rotation: true });
        const { auth, cookie } = await begin('slack');
        await callback('slack', idp.consent(auth!.toString(), { sub: 'U0USER1' }), auth!.searchParams.get('state'), cookie);
        const bot = fake.accounts.find((a) => a.providerAccountId.endsWith(':bot'))!;
        expect(bot.refresh_token).toMatch(/^rt-/);
        const old = bot.refresh_token!;
        bot.expires_at = 1;
        const t = await getAccessToken(p, 'u1', { requiresScopes: ['chat:write'] });
        expect(t.accessToken).toBe('xoxb-new-1');
        expect(bot.refresh_token).not.toBe(old);
        bot.expires_at = 1;
        bot.refresh_token = 'rt-inexistente';
        await expect(getAccessToken(p, 'u1', { requiresScopes: ['chat:write'] })).rejects.toMatchObject({ code: 'OAUTH_RECONNECT_REQUIRED' });
    });

    it('unlink: revoca el token de usuario con auth.revoke; el de BOT solo si ningun otro usuario del equipo lo conserva', async () => {
        const p = await setup(slackLike());
        wireSlack();
        for (const [sub, uid] of [['U0USER1', 'u1'], ['U0USER2', 'u2']] as const) {
            h.currentUser = { id: uid, email: `${uid}@x.test` };
            const { auth, cookie } = await begin('slack');
            await callback('slack', idp.consent(auth!.toString(), { sub }), auth!.searchParams.get('state'), cookie);
        }
        expect(fake.accounts).toHaveLength(4);
        const first = await unlinkUserProvider('u1', 'slack');
        expect(first.revoked.sort()).toEqual(['revoked', 'shared']);
        expect(idp.revoked).toEqual(['Bearer xoxp-user-U0USER1']);
        const second = await unlinkUserProvider('u2', 'slack');
        expect(second.revoked.sort()).toEqual(['revoked', 'revoked']);
        expect(idp.revoked).toContain('Bearer xoxb-bot-token');
        expect(fake.accounts).toHaveLength(0);
        void p;
    });

    it('otro usuario no puede apropiarse de la cuenta de Slack de alguien (AccountAlreadyLinked)', async () => {
        await setup(slackLike());
        wireSlack();
        const a = await begin('slack');
        await callback('slack', idp.consent(a.auth!.toString(), { sub: 'U0USER1' }), a.auth!.searchParams.get('state'), a.cookie);
        h.currentUser = { id: 'u2', email: 'u2@x.test' };
        const b = await begin('slack');
        const res = await callback('slack', idp.consent(b.auth!.toString(), { sub: 'U0USER1' }), b.auth!.searchParams.get('state'), b.cookie);
        expect(loc(res)).toContain('AccountAlreadyLinked');
        expect(fake.accounts.every((x) => x.userId === 'u1')).toBe(true);
    });
});
