import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePrisma } from './harness';
import { EXT_ROOT, FakeIdP, json, manifestExtension } from './provider-harness';

// Proveedores REALES (manifests de bloomx-extensions) contra un servidor OAuth FALSO local: registro y reserva de ids, aprobacion del admin, flujo completo
// (PKCE/state/iss/id_token), refresco con rotacion, desvinculacion y revocacion, token nunca expuesto, SSRF y TODAS las acciones del broker (barrido).

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
import { __setExtensionsSource, getProvider, parseExtensionProviders, saveProviderSecret, saveSharedCredential } from '../providers';
import { __resetFlowMemory } from '../flow-state';
import { __resetJwksCache } from '../id-token';
import { __setRefreshLock, getAccessToken } from '../tokens';
import { __resetPrincipalCache } from '../principals';
import { unlinkUserProvider } from '../unlink';
import { handleOAuthBridge, oauthBridgeRequest } from '../broker';
import { validateActionInput } from '@/lib/expansions/oauth-schema';

const ORIGIN = 'https://app.test';
const TID = '11111111-2222-3333-4444-555555555555';
let idp: FakeIdP;
let fake: ReturnType<typeof createFakePrisma>;
let ipSeq = 0;
let apiCalls: Array<{ url: string; method: string; auth: string | null; body: string | undefined }>;

const req = (url: string, cookie?: string) => new NextRequest(url, { headers: { 'x-forwarded-for': `10.70.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`, ...(cookie ? { cookie } : {}) } });
const cookieFrom = (res: Response, id: string) => { for (const c of res.headers.getSetCookie()) { const m = new RegExp(`^bloomx_oauth_flow_${id}=([^;]*)`).exec(c); if (m && m[1]) return `bloomx_oauth_flow_${id}=${m[1]}`; } return null; };
async function begin(id: string, query = '') {
    const res = await startOAuth(req(`${ORIGIN}/api/oauth/${id}/start${query}`), id);
    return { res, auth: res.headers.get('location') ? new URL(res.headers.get('location') as string) : null, cookie: cookieFrom(res, id) };
}
const callback = (id: string, code: string | null, state: string | null, cookie: string | null, extra = '') =>
    finishOAuth(req(`${ORIGIN}/api/oauth/${id}/callback?${[code ? `code=${code}` : '', state ? `state=${state}` : '', extra].filter(Boolean).join('&')}`, cookie ?? undefined), id);
const loc = (res: Response) => res.headers.get('location') ?? '';

/** Aprueba como admin los hosts de un proveedor y guarda su secreto (estado ready). */
async function approve(id: string, secret = 'real-client-secret') {
    let p = (await getProvider(id))!;
    expect(p.status).toBe('pending_approval');
    await saveProviderSecret(p, secret, 'admin1');
    p = (await getProvider(id))!;
    expect(p.status).toBe('ready');
    return p;
}

/** Valor de ejemplo que cumple la definicion de un parametro de accion. */
function sample(def: any): unknown {
    if (def.enum) return def.enum[0];
    switch (def.type) {
        case 'integer': case 'number': return def.min ?? 1;
        case 'boolean': return true;
        case 'object': return {};
        case 'array': return [];
        default: {
            const candidates = ['me', 'primary', 'AAMkAGI2TG93AAA=', '123456789', 'C0123ABCD', 'U0123ABCD', '1700000000.000100', 'abc@x.test', '2026-01-01T00:00:00Z', 'a1b2c3', 'inbox', 'x'];
            if (def.pattern) { const re = new RegExp(def.pattern); const hit = candidates.find((c) => re.test(c)); if (hit) return hit; }
            return 'x';
        }
    }
}
const sampleParams = (action: any) => Object.fromEntries(Object.entries<any>(action.params ?? {}).filter(([, d]) => d.required).map(([k, d]) => [k, sample(d)]));

/** Barrido: TODA accion del manifest llega al host permitido, con su metodo, ruta bajo apiBase y Bearer; sin tokens en la respuesta. */
async function sweepActions(providerId: string, ext: any, grantedGroups: string[], scope: string) {
    const provider = (await getProvider(providerId))!;
    fake.accounts.push({ id: 'acc-sweep', userId: 'u1', type: 'oauth', provider: providerId, providerAccountId: 'sweep', access_token: 'at-live-token', refresh_token: 'rt-live', id_token: null, expires_at: 9999999999, scope, token_type: 'Bearer', provider_hash: provider.identityHash });
    const actions = ext.template.oauthProviders[0].actions as any[];
    for (const a of actions) {
        apiCalls.length = 0;
        const out = (await handleOAuthBridge({ rateLimit: async () => ({ ok: true, retryAfter: 0 }) },
            oauthBridgeRequest.parse({ op: 'call', userId: 'u1', extensionId: 'consumer', grantedGroups, args: { provider: providerId, action: a.id, params: sampleParams(a) } }))) as any;
        expect(out.status, a.id).toBe(200);
        expect(apiCalls, a.id).toHaveLength(1);
        const u = new URL(apiCalls[0].url);
        expect(provider.allowedHosts, a.id).toContain(u.host);
        expect(u.protocol).toBe('https:');
        expect(apiCalls[0].method, a.id).toBe(a.method);
        expect(apiCalls[0].url.startsWith(a.apiBase ?? provider.apiBase!), a.id).toBe(true);
        expect(apiCalls[0].auth, a.id).toBe('Bearer at-live-token');
        expect(JSON.stringify(out), a.id).not.toMatch(/at-live-token|rt-live|set-cookie|real-client-secret/i);
        // la peticion del SDK con un parametro NO declarado se rechaza antes de salir
        apiCalls.length = 0;
        await expect(handleOAuthBridge({ rateLimit: async () => ({ ok: true, retryAfter: 0 }) },
            oauthBridgeRequest.parse({ op: 'call', userId: 'u1', extensionId: 'consumer', grantedGroups, args: { provider: providerId, action: a.id, params: { ...sampleParams(a), __extra: 1 } } }))).rejects.toMatchObject({ code: 'invalid_args' });
        expect(apiCalls, a.id).toHaveLength(0);
        // sin el permiso del grupo
        await expect(handleOAuthBridge({ rateLimit: async () => ({ ok: true, retryAfter: 0 }) },
            oauthBridgeRequest.parse({ op: 'call', userId: 'u1', extensionId: 'consumer', grantedGroups: ['otro'], args: { provider: providerId, action: a.id, params: sampleParams(a) } }))).rejects.toMatchObject({ code: 'forbidden' });
    }
    // accion fuera de la lista
    await expect(handleOAuthBridge({ rateLimit: async () => ({ ok: true, retryAfter: 0 }) },
        oauthBridgeRequest.parse({ op: 'call', userId: 'u1', extensionId: 'consumer', grantedGroups, args: { provider: providerId, action: 'admin.everything.delete', params: {} } }))).rejects.toMatchObject({ code: 'invalid_args' });
    return actions.length;
}

beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('NEXTAUTH_URL', ORIGIN);
    vi.stubEnv('DATA_ENCRYPTION_KEY', 'unit-test-key-0123456789abcdef0123456789');
    idp = new FakeIdP({ clientId: 'cid-real', clientSecret: 'real-client-secret' });
    await idp.init();
    apiCalls = [];
    __setOAuthTransport(((url: string, init: any) => {
        const u = new URL(url);
        const isApi = (u.host === 'graph.microsoft.com' && u.pathname.startsWith('/v1.0') && !u.pathname.startsWith('/oidc'))
            || (u.host === 'api.zoom.us' && u.pathname.startsWith('/v2/') && u.pathname !== '/v2/users/me')
            || (u.host === 'slack.com' && u.pathname.startsWith('/api/') && !/oauth\.v2\.access|auth\.revoke/.test(u.pathname));
        if (isApi) {
            apiCalls.push({ url, method: init.method, auth: init.headers.Authorization ?? null, body: init.body });
            return Promise.resolve(json(200, { ok: true, value: [], id: 'r1' }, { 'set-cookie': 'secret=1' }));
        }
        return idp.transport(url, init);
    }) as never, async () => ['52.96.1.1']);
    __setOAuthStore(createMemoryOAuthStore());
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

// ================================================================ registro, reserva de ids y SSRF (los tres) ================================================================
const REAL = [
    { dir: 'microsoftlib', provider: 'microsoft', owner: 'core-microsoftlib', config: { MICROSOFT_CLIENT_ID: 'cid-real' }, hosts: ['graph.microsoft.com', 'login.microsoftonline.com'] },
    { dir: 'zoomlib', provider: 'zoom', owner: 'core-zoomlib', config: { ZOOM_CLIENT_ID: 'cid-real' }, hosts: ['api.zoom.us', 'zoom.us'] },
    { dir: 'slacklib', provider: 'slack', owner: 'core-slacklib', config: { SLACK_CLIENT_ID: 'cid-real', SLACK_ALLOWED_CHANNELS: 'C0123ABCD' }, hosts: ['slack.com'] },
].filter((r) => existsSync(path.join(EXT_ROOT, r.dir, 'manifest.json')));

describe.each(REAL)('$provider: registro, ids reservados y aprobacion del admin', (r) => {
    it('lo registra SOLO su extension oficial; una extension ajena con el mismo id se descarta', async () => {
        const official = manifestExtension(r.dir, r.config);
        expect(official.id).toBe(r.owner);
        expect(parseExtensionProviders([official]).has(r.provider)).toBe(true);
        for (const evil of ['evil-ext', 'core-googlelib', ...REAL.filter((x) => x.provider !== r.provider).map((x) => x.owner)]) {
            expect(parseExtensionProviders([{ ...official, id: evil }]).has(r.provider), evil).toBe(false);
        }
        // y no puede quitarle el id a la oficial mientras ambas existan: gana la oficial
        const impostor = { ...official, id: 'a-evil', template: { ...official.template, id: 'a-evil', oauthProviders: [{ ...official.template.oauthProviders[0], tokenUrl: 'https://evil.example.com/token', allowedHosts: [...official.template.oauthProviders[0].allowedHosts, 'evil.example.com'] }] } };
        __setExtensionsSource(async () => [impostor, official]);
        const p = (await getProvider(r.provider))!;
        expect(p.extensionId).toBe(r.owner);
        expect(p.endpointHosts).toEqual(r.hosts);
    });

    it('no integrado => pending_approval hasta que el admin aprueba los hosts; sin client id/secreto no esta listo; el cambio de hosts exige re-aprobar', async () => {
        __setExtensionsSource(async () => [manifestExtension(r.dir, r.config)]);
        const p = (await getProvider(r.provider))!;
        expect(p.status).toBe('pending_approval');
        expect(p.clientSecret).toBeNull();
        expect(p.endpointHosts).toEqual(r.hosts);
        // sin aprobar no se inicia el flujo
        const blocked = await startOAuth(req(`${ORIGIN}/api/oauth/${r.provider}/start`), r.provider);
        expect(blocked.status).toBe(503);
        await approve(r.provider);
        // el mismo proveedor con otro host en un endpoint => needs_reapproval y el secreto deja de usarse
        const m = manifestExtension(r.dir, r.config);
        const def = m.template.oauthProviders[0];
        def.allowedHosts = [...def.allowedHosts, 'otro.example.org'];
        def.apiBase = 'https://otro.example.org';
        __setExtensionsSource(async () => [m]);
        const changed = (await getProvider(r.provider))!;
        expect(changed.status).toBe('needs_reapproval');
        expect(changed.clientSecret).toBeNull();
    });

    it('SSRF: ningun endpoint ni base de accion sale de allowedHosts (https:443, DNS publico) y las acciones no tienen rutas libres', async () => {
        const ext = manifestExtension(r.dir, r.config);
        const def = ext.template.oauthProviders[0];
        for (const host of def.allowedHosts) expect(host).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
        expect(def.allowedHosts.sort()).toEqual(r.hosts);
        for (const a of def.actions) {
            const base = new URL(a.apiBase ?? def.apiBase);
            expect(def.allowedHosts).toContain(base.host);
            expect(base.protocol).toBe('https:');
            expect(a.path.startsWith('/')).toBe(true);
            for (const [name, p] of Object.entries<any>(a.params ?? {})) if (p.in === 'path') expect(p.pattern ?? p.enum, `${a.id}.${name}`).toBeTruthy();
            if (a.method !== 'GET') expect(typeof a.write, a.id).toBe('boolean');
        }
        // un id de ruta con `/`, `..` o %2f no se acepta
        for (const a of def.actions) for (const [name, p] of Object.entries<any>(a.params ?? {})) {
            if (p.in !== 'path') continue;
            for (const hostile of ['a/b', '../x', '..', '%2f', 'a?b=1', 'a#b', 'a b', '']) {
                const v = validateActionInput(a, { ...sampleParams(a), [name]: hostile });
                expect(v.ok && String(v.path[name]) === hostile, `${a.id}.${name} <- ${JSON.stringify(hostile)}`).toBe(false);
            }
        }
    });
});

// ================================================================ Microsoft ================================================================
describe.skipIf(!REAL.some((r) => r.provider === 'microsoft'))('microsoft (MicrosoftLib real)', () => {
    const config = { MICROSOFT_CLIENT_ID: 'cid-real' };
    const wire = (over: { tid?: string; iss?: string; sub?: string } = {}) => {
        idp.route('login.microsoftonline.com', '/common/oauth2/v2.0/token', idp.standardToken({
            idToken: (c) => idp.signIdToken({ iss: over.iss ?? `https://login.microsoftonline.com/${over.tid ?? TID}/v2.0`, aud: 'cid-real', sub: c.subject.sub, nonce: c.nonce, extra: { tid: over.tid ?? TID, email: 'ana@contoso.test' } }),
        }));
        idp.route('login.microsoftonline.com', '/common/discovery/v2.0/keys', idp.jwksEndpoint());
        idp.route('graph.microsoft.com', '/oidc/userinfo', () => json(200, { sub: 'ms-sub-1', name: 'Ana', email: 'ana@contoso.test' }));
    };

    it('flujo completo, refresh con rotacion y unlink (sin endpoint de revocacion): el token nunca aparece fuera de la BD', async () => {
        __setExtensionsSource(async () => [manifestExtension('microsoftlib', config)]);
        const p = await approve('microsoft');
        wire();
        idp.rotateRefresh = true;
        const { auth, cookie } = await begin('microsoft');
        expect(`${auth!.origin}${auth!.pathname}`).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
        expect(auth!.searchParams.get('scope')!.split(' ')).toEqual(expect.arrayContaining(['openid', 'offline_access', 'User.Read']));
        expect(auth!.searchParams.get('prompt')).toBe('select_account');
        expect(auth!.searchParams.get('code_challenge_method')).toBe('S256');
        const res = await callback('microsoft', idp.consent(auth!.toString(), { sub: 'ms-sub-1' }), auth!.searchParams.get('state'), cookie);
        expect(loc(res)).toBe(`${ORIGIN}/`);
        expect(fake.accounts).toHaveLength(1);
        expect(fake.accounts[0].provider_hash).toBe(p.identityHash);
        expect(loc(res) + JSON.stringify(h.audits)).not.toMatch(/at-|rt-|real-client-secret/);
        const old = fake.accounts[0].refresh_token!;
        fake.accounts[0].expires_at = 1;
        await getAccessToken(p, 'u1');
        expect(fake.accounts[0].refresh_token).not.toBe(old);
        expect(await unlinkUserProvider('u1', 'microsoft')).toEqual({ unlinked: 1, revoked: ['not_supported'] });
        expect(fake.accounts).toHaveLength(0);
    });

    it('rechaza id_token de otro emisor/tenant (iss incorrecto, tid distinto) y el tenant fijado por el admin', async () => {
        for (const bad of [{ iss: 'https://evil.example.com/' + TID + '/v2.0' }, { iss: `https://login.microsoftonline.com/99999999-8888-7777-6666-000000000000/v2.0` }, { iss: `https://sts.windows.net/${TID}/` }]) {
            __setExtensionsSource(async () => [manifestExtension('microsoftlib', config)]);
            await approve('microsoft').catch(() => undefined);
            wire(bad);
            fake.accounts.length = 0;
            __resetFlowMemory();
            const { auth, cookie } = await begin('microsoft');
            const res = await callback('microsoft', idp.consent(auth!.toString(), { sub: 'ms-sub-1' }), auth!.searchParams.get('state'), cookie);
            expect(loc(res)).toContain('OAuthFailed');
            expect(fake.accounts).toHaveLength(0);
        }
        // tenant fijo = TID: un token valido de otro tenant no entra
        __setExtensionsSource(async () => [manifestExtension('microsoftlib', { ...config, MICROSOFT_TENANT: TID })]);
        const p = (await getProvider('microsoft'))!;
        if (p.status !== 'ready') await saveProviderSecret(p, 'real-client-secret', 'admin1');
        expect(p.tokenUrl).toBe(`https://login.microsoftonline.com/${TID}/oauth2/v2.0/token`);
        const other = '99999999-8888-7777-6666-000000000000';
        idp.route('login.microsoftonline.com', `/${TID}/oauth2/v2.0/token`, idp.standardToken({ idToken: (c) => idp.signIdToken({ iss: `https://login.microsoftonline.com/${other}/v2.0`, aud: 'cid-real', sub: c.subject.sub, nonce: c.nonce, extra: { tid: other } }) }));
        idp.route('login.microsoftonline.com', `/${TID}/discovery/v2.0/keys`, idp.jwksEndpoint());
        __resetJwksCache();
        const { auth, cookie } = await begin('microsoft');
        const res = await callback('microsoft', idp.consent(auth!.toString(), { sub: 'ms-sub-1' }), auth!.searchParams.get('state'), cookie);
        expect(loc(res)).toContain('OAuthFailed');
    });

    it('barrido de acciones: cada accion de Graph sale al host permitido con su metodo; parametros extra y grupos ajenos se rechazan', async () => {
        const ext = manifestExtension('microsoftlib', config);
        __setExtensionsSource(async () => [ext]);
        await approve('microsoft');
        const all = ext.template.oauthProviders[0].scopes.map((s: any) => s.id).join(' ');
        const groups = Array.from(new Set(ext.template.oauthProviders[0].scopes.map((s: any) => s.group))) as string[];
        const n = await sweepActions('microsoft', ext, groups, all);
        expect(n).toBeGreaterThanOrEqual(25);
    });

    it('un scope no concedido a la cuenta bloquea la accion (p. ej. enviar correo sin Mail.Send)', async () => {
        const ext = manifestExtension('microsoftlib', config);
        __setExtensionsSource(async () => [ext]);
        const p = await approve('microsoft');
        fake.accounts.push({ id: 'a1', userId: 'u1', type: 'oauth', provider: 'microsoft', providerAccountId: 's', access_token: 'at-live', refresh_token: 'rt', id_token: null, expires_at: 9999999999, scope: 'openid User.Read Calendars.ReadWrite', token_type: 'Bearer', provider_hash: p.identityHash });
        const send = ext.template.oauthProviders[0].actions.find((a: any) => a.id === 'mail.messages.send');
        await expect(handleOAuthBridge({ rateLimit: async () => ({ ok: true, retryAfter: 0 }) },
            oauthBridgeRequest.parse({ op: 'call', userId: 'u1', extensionId: 'c', grantedGroups: ['mail'], args: { provider: 'microsoft', action: 'mail.messages.send', params: sampleParams(send) } }))).rejects.toMatchObject({ code: 'scope_missing' });
        expect(apiCalls).toHaveLength(0);
    });
});

// ================================================================ Zoom ================================================================
describe.skipIf(!REAL.some((r) => r.provider === 'zoom'))('zoom (ZoomLib real)', () => {
    const config = { ZOOM_CLIENT_ID: 'cid-real', ZOOM_ACCOUNT_ID: 'acct12345', ZOOM_S2S_CLIENT_ID: 's2s-id-1', ZOOM_HOST_EMAIL: 'host@x.test' };
    const wire = () => {
        idp.opts.tokenAuth = 'basic';
        idp.route('zoom.us', '/oauth/token', idp.standardToken());
        idp.route('zoom.us', '/oauth/revoke', idp.revokeEndpoint());
        idp.route('api.zoom.us', '/v2/users/me', () => json(200, { id: 'zoom-user-1', email: 'ana@x.test' }));
    };

    it('flujo completo con client_secret_basic + PKCE, refresh con rotacion y unlink que revoca el access token', async () => {
        __setExtensionsSource(async () => [manifestExtension('zoomlib', config)]);
        const p = await approve('zoom');
        wire();
        idp.rotateRefresh = true;
        const { auth, cookie } = await begin('zoom');
        expect(`${auth!.origin}${auth!.pathname}`).toBe('https://zoom.us/oauth/authorize');
        expect(auth!.searchParams.get('code_challenge_method')).toBe('S256');
        const res = await callback('zoom', idp.consent(auth!.toString(), { sub: 'zoom-user-1' }), auth!.searchParams.get('state'), cookie);
        expect(loc(res)).toBe(`${ORIGIN}/`);
        const tokenCall = idp.calls.find((c) => c.form.grant_type === 'authorization_code')!;
        expect(tokenCall.headers.Authorization).toMatch(/^Basic /);
        expect(tokenCall.form.client_secret).toBeUndefined();
        expect(fake.accounts[0].providerAccountId).toBe('zoom-user-1');
        expect(loc(res) + JSON.stringify(h.audits)).not.toMatch(/at-|rt-|real-client-secret/);
        const old = fake.accounts[0].refresh_token!;
        fake.accounts[0].expires_at = 1;
        await getAccessToken(p, 'u1');
        expect(fake.accounts[0].refresh_token).not.toBe(old);
        const out = await unlinkUserProvider('u1', 'zoom');
        expect(out.revoked).toEqual(['revoked']);
        expect(idp.calls.find((c) => c.url.endsWith('/oauth/revoke'))!.form.token_type_hint).toBe('access_token');
        expect(fake.accounts).toHaveLength(0);
    });

    it('un fallo de la revocacion de Zoom NO impide desvincular (best-effort)', async () => {
        __setExtensionsSource(async () => [manifestExtension('zoomlib', config)]);
        const p = await approve('zoom');
        wire();
        idp.revokeStatus = 500;
        fake.accounts.push({ id: 'a1', userId: 'u1', type: 'oauth', provider: 'zoom', providerAccountId: 'z1', access_token: 'at-live', refresh_token: 'rt-live', id_token: null, expires_at: 9999999999, scope: 'meeting:write:meeting', token_type: 'Bearer', provider_hash: p.identityHash });
        const out = await unlinkUserProvider('u1', 'zoom');
        expect(out).toEqual({ unlinked: 1, revoked: ['failed'] });
        expect(fake.accounts).toHaveLength(0);
    });

    it('barrido de acciones del usuario y modo S2S (principal service, ZOOM_S2S_CLIENT_SECRET en la instancia, scopes :admin normalizados)', async () => {
        const ext = manifestExtension('zoomlib', config);
        __setExtensionsSource(async () => [ext]);
        const p = await approve('zoom');
        const all = ext.template.oauthProviders[0].scopes.map((s: any) => s.id).join(' ');
        idp.route('api.zoom.us', '/v2/users/me', (r) => { apiCalls.push({ url: r.url.toString(), method: r.method, auth: r.headers.Authorization ?? null, body: r.body }); return json(200, { ok: true }); });
        const n = await sweepActions('zoom', ext, ['meetings', 'userinfo'], all);
        expect(n).toBe(6);
        // S2S
        await saveSharedCredential(p, 'ZOOM_S2S_CLIENT_SECRET', 's2s-secret', 'admin1');
        let minted = 0;
        idp.route('zoom.us', '/oauth/token', (r) => {
            expect(r.headers.Authorization).toBe(`Basic ${Buffer.from('s2s-id-1:s2s-secret').toString('base64')}`);
            expect(r.form).toEqual({ grant_type: 'account_credentials', account_id: 'acct12345' });
            minted += 1;
            return json(200, { access_token: 's2s-live-token', token_type: 'bearer', expires_in: 3600, scope: 'meeting:write:meeting:admin meeting:read:meeting:admin' });
        });
        apiCalls.length = 0;
        const out = (await handleOAuthBridge({ rateLimit: async () => ({ ok: true, retryAfter: 0 }) },
            oauthBridgeRequest.parse({ op: 'call', userId: 'u1', extensionId: 'core-zoom', grantedGroups: ['meetings'], sharedAllowed: true, args: { provider: 'zoom', action: 'meetings.create', principal: 'service', params: { userId: 'host@x.test', meeting: { topic: 'Demo' } } } }))) as any;
        expect(out.status).toBe(200);
        expect(apiCalls[0].auth).toBe('Bearer s2s-live-token');
        expect(JSON.stringify(out)).not.toContain('s2s-live-token');
        expect(minted).toBe(1);
        // principals: el modo S2S esta disponible solo para quien tiene OAUTH_SHARED
        const pr = (await handleOAuthBridge({ rateLimit: async () => ({ ok: true, retryAfter: 0 }) }, oauthBridgeRequest.parse({ op: 'principals', userId: 'u1', extensionId: 'core-zoom', grantedGroups: ['meetings'], sharedAllowed: true, args: { provider: 'zoom' } }))) as any;
        expect(pr.service).toBe(true);
        const hidden = (await handleOAuthBridge({ rateLimit: async () => ({ ok: true, retryAfter: 0 }) }, oauthBridgeRequest.parse({ op: 'principals', userId: 'u1', extensionId: 'core-zoom', grantedGroups: ['meetings'], args: { provider: 'zoom' } }))) as any;
        expect(hidden.service).toBe(false);
    });
});

// ================================================================ Slack ================================================================
describe.skipIf(!REAL.some((r) => r.provider === 'slack'))('slack (SlackLib real)', () => {
    const config = { SLACK_CLIENT_ID: 'cid-real', SLACK_ALLOWED_CHANNELS: 'C0123ABCD,G0456EFGH' };
    const wire = (rotation = false) => {
        idp.route('slack.com', '/api/oauth.v2.access', (r) => {
            if (r.form.client_id !== 'cid-real' || r.form.client_secret !== 'real-client-secret') return json(200, { ok: false, error: 'invalid_client_id' });
            if (r.headers.Authorization) return json(200, { ok: false, error: 'bad_auth' });
            if (r.form.grant_type === 'refresh_token') {
                const old = idp.refreshTokens.get(r.form.refresh_token);
                if (!old) return json(200, { ok: false, error: 'invalid_refresh_token' });
                idp.refreshTokens.delete(r.form.refresh_token);
                return json(200, { ok: true, access_token: 'xoxe.xoxb-rotated', token_type: 'bot', scope: old.scope, expires_in: 43200, refresh_token: idp.newRefresh(old.subject, old.scope) });
            }
            const c = idp.redeem(r.form);
            if (c instanceof Response) return json(200, { ok: false, error: 'invalid_code' });
            return json(200, {
                ok: true, access_token: 'xoxb-bot-live', token_type: 'bot', scope: c.scope, bot_user_id: 'UBOT', app_id: 'A1', team: { id: 'T0TEAM', name: 'Equipo' }, is_enterprise_install: false,
                authed_user: { id: c.subject.sub, scope: c.userScope, access_token: 'xoxp-user-live', token_type: 'user' },
                ...(rotation ? { refresh_token: idp.newRefresh(c.subject, c.scope), expires_in: 43200 } : {}),
            });
        });
        idp.route('slack.com', '/api/auth.revoke', (r) => { idp.revoked.push(r.headers.Authorization); return json(200, { ok: true, revoked: true }); });
    };

    it('inicio con scope de bot y user_scope; callback guarda bot y usuario; unlink revoca con auth.revoke', async () => {
        __setExtensionsSource(async () => [manifestExtension('slacklib', config)]);
        await approve('slack');
        wire();
        const first = await begin('slack');
        expect(`${first.auth!.origin}${first.auth!.pathname}`).toBe('https://slack.com/oauth/v2/authorize');
        expect(first.auth!.searchParams.get('scope')).toBe('chat:write,channels:read,users:read');
        expect(first.auth!.searchParams.has('user_scope')).toBe(false);
        expect(first.auth!.searchParams.has('code_challenge')).toBe(false);
        // con scopes de usuario pedidos explicitamente
        const withUser = await begin('slack', '?scopes=chat:write,user:chat:write');
        expect(withUser.auth!.searchParams.get('scope')).toBe('chat:write');
        expect(withUser.auth!.searchParams.get('user_scope')).toBe('chat:write');
        const res = await callback('slack', idp.consent(withUser.auth!.toString(), { sub: 'U0USER1' }), withUser.auth!.searchParams.get('state'), withUser.cookie);
        expect(loc(res)).toBe(`${ORIGIN}/`);
        expect(fake.accounts.map((a) => a.providerAccountId).sort()).toEqual(['T0TEAM:U0USER1:bot', 'T0TEAM:U0USER1:user']);
        expect(loc(res) + JSON.stringify(h.audits)).not.toMatch(/xox[bpe]-|real-client-secret/);
        const out = await unlinkUserProvider('u1', 'slack');
        expect(out.revoked.sort()).toEqual(['revoked', 'revoked']);
        expect(idp.revoked.sort()).toEqual(['Bearer xoxb-bot-live', 'Bearer xoxp-user-live']);
        expect(fake.accounts).toHaveLength(0);
    });

    it('el nucleo aplica los canales permitidos y el tope duro por hora de chat.postMessage, y nunca devuelve el token del bot', async () => {
        const ext = manifestExtension('slacklib', config);
        __setExtensionsSource(async () => [ext]);
        await approve('slack');
        wire();
        const { auth, cookie } = await begin('slack');
        await callback('slack', idp.consent(auth!.toString(), { sub: 'U0USER1' }), auth!.searchParams.get('state'), cookie);
        const counters = new Map<string, number>();
        const rateLimit = async (key: string, limit: number) => { const n = (counters.get(key) ?? 0) + 1; counters.set(key, n); return { ok: n <= limit, retryAfter: 60 }; };
        const post = (params: any) => handleOAuthBridge({ rateLimit }, oauthBridgeRequest.parse({ op: 'call', userId: 'u1', extensionId: 'core-slack-notify', grantedGroups: ['chat'], args: { provider: 'slack', action: 'chat.postMessage', params } }));
        const ok = (await post({ channel: 'C0123ABCD', text: 'hola' })) as any;
        expect(ok.status).toBe(200);
        expect(apiCalls.at(-1)!.auth).toBe('Bearer xoxb-bot-live');
        expect(JSON.stringify(ok)).not.toMatch(/xox/);
        await expect(post({ channel: 'C0999ZZZZ', text: 'x' })).rejects.toMatchObject({ code: 'forbidden' });
        await expect(post({ channel: 'D0123ABCD', text: 'md directo' })).rejects.toMatchObject({ code: 'invalid_args' });
        await expect(post({ channel: 'C0123ABCD', text: 'x'.repeat(4000) })).rejects.toMatchObject({ code: 'invalid_args' });
        const quota = ext.template.oauthProviders[0].actions.find((a: any) => a.id === 'chat.postMessage').quotaPerHour as number;
        expect(quota).toBeGreaterThan(0);
        // tras agotar el tope por hora la accion responde rate_limited aunque el minuto este libre
        counters.set('oauth-quota:u1:core-slack-notify:slack:chat.postMessage', quota);
        await expect(post({ channel: 'C0123ABCD', text: 'otra' })).rejects.toMatchObject({ code: 'rate_limited' });
    });

    it('el token de bot se refresca con rotacion de Slack y {ok:false,error:invalid_refresh_token} pide reconectar', async () => {
        __setExtensionsSource(async () => [manifestExtension('slacklib', config)]);
        const p = await approve('slack');
        wire(true);
        const { auth, cookie } = await begin('slack');
        await callback('slack', idp.consent(auth!.toString(), { sub: 'U0USER1' }), auth!.searchParams.get('state'), cookie);
        const bot = fake.accounts.find((a) => a.providerAccountId.endsWith(':bot'))!;
        bot.expires_at = 1;
        expect((await getAccessToken(p, 'u1', { requiresScopes: ['chat:write'] })).accessToken).toBe('xoxe.xoxb-rotated');
        bot.expires_at = 1;
        bot.refresh_token = 'rt-viejo';
        await expect(getAccessToken(p, 'u1', { requiresScopes: ['chat:write'] })).rejects.toMatchObject({ code: 'OAUTH_RECONNECT_REQUIRED' });
    });

    it('barrido de TODAS las acciones del manifest con los canales permitidos', async () => {
        const ext = manifestExtension('slacklib', config);
        __setExtensionsSource(async () => [ext]);
        await approve('slack');
        const def = ext.template.oauthProviders[0];
        const n = await sweepActions('slack', ext, ['chat', 'channels', 'users'], def.scopes.map((s: any) => s.id).join(' '));
        expect(n).toBe(def.actions.length);
    });
});
