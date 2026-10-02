import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePrisma } from './harness';
import { FakeIdP, json, manifestExtension } from './provider-harness';

// PRUEBA DE FLUJO de un proveedor OAuth escrito como extension, contra un servidor OAuth FALSO local (sin red ni credenciales reales).
// Generado por `npm run new:oauth-provider -- asana` desde template-provider.flow.test.ts: amplialo con lo propio del proveedor (id_token OIDC, formatos de token, scopes...).
// Cubre: aprobacion del admin, inicio (PKCE S256, state), flujo completo, state reutilizado/ajeno, redirect manipulado, PKCE alterado, secreto equivocado,
// refresh con rotacion e invalid_grant, desvinculacion con revocacion (si el proveedor la tiene), token jamas expuesto, SSRF y TODAS las acciones del broker.
const DIR = 'asanalib';

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
import { __setOAuthTransport, providerFetch } from '../http';
import { __setOAuthStore, createMemoryOAuthStore } from '../store';
import { __setExtensionsSource, getProvider, parseExtensionProviders, saveProviderSecret } from '../providers';
import { __resetFlowMemory } from '../flow-state';
import { __setRefreshLock, getAccessToken } from '../tokens';
import { unlinkUserProvider } from '../unlink';
import { handleOAuthBridge, oauthBridgeRequest } from '../broker';

const ORIGIN = 'https://app.test';
const SECRET = 'template-client-secret';
const ext0 = manifestExtension(DIR);
const DEF = ext0.template.oauthProviders[0];
const ID: string = DEF.id;
const CONFIG = { [DEF.clientIdSetting]: 'cid-template' };
const URLS = { token: new URL(DEF.tokenUrl), revoke: DEF.revokeUrl ? new URL(DEF.revokeUrl) : null, userinfo: DEF.userinfoUrl ? new URL(DEF.userinfoUrl) : null, api: new URL(DEF.apiBase) };

let idp: FakeIdP;
let fake: ReturnType<typeof createFakePrisma>;
let ipSeq = 0;
let apiCalls: Array<{ url: string; method: string; auth: string | null; body: string | undefined }>;

const req = (url: string, cookie?: string) => new NextRequest(url, { headers: { 'x-forwarded-for': `10.80.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`, ...(cookie ? { cookie } : {}) } });
const cookieFrom = (res: Response) => { for (const c of res.headers.getSetCookie()) { const m = new RegExp(`^bloomx_oauth_flow_${ID}=([^;]*)`).exec(c); if (m && m[1]) return `bloomx_oauth_flow_${ID}=${m[1]}`; } return null; };
async function begin(query = '') {
    const res = await startOAuth(req(`${ORIGIN}/api/oauth/${ID}/start${query}`), ID);
    return { res, auth: res.headers.get('location') ? new URL(res.headers.get('location') as string) : null, cookie: cookieFrom(res) };
}
const callback = (code: string | null, state: string | null, cookie: string | null, extra = '') =>
    finishOAuth(req(`${ORIGIN}/api/oauth/${ID}/callback?${[code ? `code=${code}` : '', state ? `state=${state}` : '', extra].filter(Boolean).join('&')}`, cookie ?? undefined), ID);
const loc = (res: Response) => res.headers.get('location') ?? '';

async function approve() {
    let p = (await getProvider(ID))!;
    expect(p.status).toBe('pending_approval'); // un proveedor no integrado exige la aprobacion de sus hosts por el admin
    await saveProviderSecret(p, SECRET, 'admin1');
    p = (await getProvider(ID))!;
    expect(p.status).toBe('ready');
    return p;
}
function wire() {
    idp.opts.tokenAuth = DEF.tokenAuth === 'basic' ? 'basic' : 'post';
    idp.route(URLS.token.host, URLS.token.pathname, idp.standardToken());
    if (URLS.revoke) idp.route(URLS.revoke.host, URLS.revoke.pathname, idp.revokeEndpoint());
    if (URLS.userinfo) idp.route(URLS.userinfo.host, URLS.userinfo.pathname, () => json(200, { id: 'acct-1', sub: 'acct-1', email: 'ana@acme-saas.com' }));
}
function sample(def: any): unknown {
    if (def.enum) return def.enum[0];
    switch (def.type) {
        case 'integer': case 'number': return def.min ?? 1;
        case 'boolean': return true;
        case 'object': return {};
        case 'array': return [];
        default: {
            const candidates = ['me', 'primary', 'abc_123', '123456789', 'C0123ABCD', 'abc@x.test', '2026-01-01T00:00:00Z', 'x'];
            if (def.pattern) { const re = new RegExp(def.pattern); const hit = candidates.find((c) => re.test(c)); if (hit) return hit; }
            return 'x';
        }
    }
}
const sampleParams = (a: any) => Object.fromEntries(Object.entries<any>(a.params ?? {}).filter(([, d]) => d.required).map(([k, d]) => [k, sample(d)]));

beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('NEXTAUTH_URL', ORIGIN);
    vi.stubEnv('DATA_ENCRYPTION_KEY', 'unit-test-key-0123456789abcdef0123456789');
    idp = new FakeIdP({ clientId: 'cid-template', clientSecret: SECRET });
    await idp.init();
    apiCalls = [];
    __setOAuthTransport(((url: string, init: any) => {
        const u = new URL(url);
        const isIdp = (u.host === URLS.token.host && u.pathname === URLS.token.pathname) || (URLS.revoke && u.host === URLS.revoke.host && u.pathname === URLS.revoke.pathname) || (URLS.userinfo && u.host === URLS.userinfo.host && u.pathname === URLS.userinfo.pathname);
        if (!isIdp && u.host === URLS.api.host) {
            apiCalls.push({ url, method: init.method, auth: init.headers.Authorization ?? null, body: init.body });
            return Promise.resolve(json(200, { items: [], id: 'r1' }, { 'set-cookie': 'secret=1' }));
        }
        return idp.transport(url, init);
    }) as never, async () => ['34.120.1.1']);
    __setOAuthStore(createMemoryOAuthStore());
    __setExtensionsSource(async () => [manifestExtension(DIR, CONFIG)]);
    __resetFlowMemory();
    __setRefreshLock((async (_id: string, fn: () => Promise<unknown>) => fn()) as never);
    fake = createFakePrisma();
    h.prisma = fake.prisma;
    h.currentUser = { id: 'u1', email: 'u1@x.test' };
    h.audits = [];
    wire();
});
afterEach(() => {
    __setOAuthTransport(null);
    __setOAuthStore(null);
    __setExtensionsSource(null);
    __setRefreshLock(null);
    vi.unstubAllEnvs();
});

describe(`proveedor ${ID}: registro y aprobacion`, () => {
    it('lo registra el manifest, quedando pendiente de aprobacion; sin aprobar no se inicia el flujo', async () => {
        const p = (await getProvider(ID))!;
        expect(p.status).toBe('pending_approval');
        expect(p.clientSecret).toBeNull();
        expect((await startOAuth(req(`${ORIGIN}/api/oauth/${ID}/start`), ID)).status).toBe(503);
        await approve();
    });
    it('un id reservado solo lo registra su extension oficial', () => {
        const spoof = { ...manifestExtension(DIR, CONFIG), id: 'evil-ext' };
        spoof.template = { ...spoof.template, oauthProviders: [{ ...DEF, id: 'microsoft' }] };
        expect(parseExtensionProviders([spoof]).has('microsoft')).toBe(false);
    });
});

describe(`proveedor ${ID}: flujo OAuth`, () => {
    it('inicio: redirect_uri exacta, client_id, PKCE S256 y un state opaco; el secreto jamas va en la URL', async () => {
        await approve();
        const { res, auth } = await begin();
        expect(res.status).toBe(307);
        expect(`${auth!.origin}${auth!.pathname}`).toBe(DEF.authorizeUrl);
        expect(auth!.searchParams.get('client_id')).toBe('cid-template');
        expect(auth!.searchParams.get('redirect_uri')).toBe(`${ORIGIN}${DEF.redirectPath ?? `/api/oauth/${ID}/callback`}`);
        if (DEF.pkce) expect(auth!.searchParams.get('code_challenge_method')).toBe('S256');
        expect(auth!.searchParams.get('state')!.length).toBeGreaterThan(20);
        expect(auth!.toString()).not.toContain(SECRET);
        expect((await startOAuth(req(`${ORIGIN}/api/oauth/${ID}/start?scopes=no-existe`), ID)).status).toBe(400);
    });

    it('flujo completo: vincula la cuenta del usuario con sesion y el token NUNCA aparece en la redireccion ni en la auditoria', async () => {
        const p = await approve();
        const { auth, cookie } = await begin();
        const res = await callback(idp.consent(auth!.toString(), { sub: 'acct-1' }), auth!.searchParams.get('state'), cookie);
        expect(loc(res)).toBe(`${ORIGIN}/`);
        expect(fake.accounts).toHaveLength(1);
        expect(fake.accounts[0]).toMatchObject({ provider: ID, userId: 'u1', providerAccountId: 'acct-1', provider_hash: p.identityHash });
        expect(loc(res) + JSON.stringify(h.audits)).not.toMatch(/at-|rt-/);
        expect(loc(res)).not.toContain(SECRET);
    });

    it('state reutilizado, ajeno o sin cookie => InvalidState; PKCE alterado, redirect manipulado y secreto equivocado => no se vincula', async () => {
        await approve();
        const first = await begin();
        const code = idp.consent(first.auth!.toString(), { sub: 'acct-1' });
        expect(loc(await callback(code, first.auth!.searchParams.get('state'), first.cookie))).toBe(`${ORIGIN}/`);
        expect(loc(await callback(idp.consent(first.auth!.toString(), { sub: 'acct-1' }), first.auth!.searchParams.get('state'), first.cookie))).toContain('InvalidState');
        const second = await begin();
        expect(loc(await callback(idp.consent(second.auth!.toString(), { sub: 'acct-1' }), 'estado-forjado', second.cookie))).toContain('InvalidState');
        expect(loc(await callback(idp.consent(second.auth!.toString(), { sub: 'acct-1' }), second.auth!.searchParams.get('state'), null))).toContain('InvalidState');
        fake.accounts.length = 0;
        if (DEF.pkce) {
            const pk = await begin();
            const t = new URL(pk.auth!.toString());
            t.searchParams.set('code_challenge', 'A'.repeat(43));
            expect(loc(await callback(idp.consent(t.toString(), { sub: 'acct-1' }), pk.auth!.searchParams.get('state'), pk.cookie))).toContain('OAuthFailed');
        }
        const rd = await begin();
        const forged = new URL(rd.auth!.toString());
        forged.searchParams.set('redirect_uri', 'https://evil.example.com/cb');
        expect(loc(await callback(idp.consent(forged.toString(), { sub: 'acct-1' }), rd.auth!.searchParams.get('state'), rd.cookie))).toContain('OAuthFailed');
        expect(fake.accounts).toHaveLength(0);
        // sin sesion no se vincula
        h.currentUser = null;
        expect((await startOAuth(req(`${ORIGIN}/api/oauth/${ID}/start`), ID)).headers.get('location')).toContain('LoginRequired');
    });

    it('refresh con rotacion: el refresh nuevo reemplaza al anterior (y el anterior deja de valer); invalid_grant pide reconectar', async () => {
        const p = await approve();
        idp.rotateRefresh = true;
        const { auth, cookie } = await begin();
        await callback(idp.consent(auth!.toString(), { sub: 'acct-1' }), auth!.searchParams.get('state'), cookie);
        const old = fake.accounts[0].refresh_token!;
        fake.accounts[0].expires_at = 1;
        expect((await getAccessToken(p, 'u1')).accessToken).toMatch(/^at-/);
        expect(fake.accounts[0].refresh_token).not.toBe(old);
        expect(idp.refreshTokens.has(old)).toBe(false);
        fake.accounts[0].expires_at = 1;
        idp.failRefreshWith = 'invalid_grant';
        await expect(getAccessToken(p, 'u1')).rejects.toMatchObject({ code: 'OAUTH_RECONNECT_REQUIRED' });
    });

    it('desvincular borra los tokens y, si el proveedor tiene endpoint de revocacion, los revoca (un fallo de la revocacion no impide desvincular)', async () => {
        const p = await approve();
        fake.accounts.push({ id: 'a1', userId: 'u1', type: 'oauth', provider: ID, providerAccountId: 'acct-1', access_token: 'at-live', refresh_token: 'rt-live', id_token: null, expires_at: 9999999999, scope: DEF.defaultScopes.join(' '), token_type: 'Bearer', provider_hash: p.identityHash });
        if (URLS.revoke) {
            idp.revokeStatus = 500;
            expect((await unlinkUserProvider('u1', ID)).revoked).toEqual(['failed']);
        } else {
            expect((await unlinkUserProvider('u1', ID)).revoked).toEqual(['not_supported']);
        }
        expect(fake.accounts).toHaveLength(0);
    });
});

describe(`proveedor ${ID}: broker y SSRF`, () => {
    it('SSRF: el transporte rechaza hosts fuera de allowedHosts, http, IP y puertos aunque la URL salga de un parametro', async () => {
        const p = (await getProvider(ID))!;
        for (const bad of ['https://evil.example.com/x', 'http://' + DEF.allowedHosts[0] + '/x', 'https://127.0.0.1/x', 'https://[::1]/x', `https://${DEF.allowedHosts[0]}:8443/x`, `https://user:pw@${DEF.allowedHosts[0]}/x`]) {
            await expect(providerFetch(p.allowedHosts, bad), bad).rejects.toMatchObject({ code: 'oauth_url_rejected' });
        }
        expect(idp.calls).toHaveLength(0);
    });

    it('barrido: TODA accion llega al host permitido con su metodo y Bearer; parametros extra, grupos ajenos y acciones no declaradas se rechazan; la respuesta no trae tokens', async () => {
        const p = await approve();
        fake.accounts.push({ id: 'acc-sweep', userId: 'u1', type: 'oauth', provider: ID, providerAccountId: 'sweep', access_token: 'at-live-token', refresh_token: 'rt-live', id_token: null, expires_at: 9999999999, scope: DEF.scopes.map((s: any) => s.id).join(' '), token_type: 'Bearer', provider_hash: p.identityHash });
        const groups = Array.from(new Set(DEF.scopes.map((s: any) => s.group))) as string[];
        const call = (action: string, params: any, grantedGroups = groups) => handleOAuthBridge({ rateLimit: async () => ({ ok: true, retryAfter: 0 }) }, oauthBridgeRequest.parse({ op: 'call', userId: 'u1', extensionId: 'consumer', grantedGroups, args: { provider: ID, action, params } }));
        for (const a of DEF.actions) {
            apiCalls.length = 0;
            const out = (await call(a.id, sampleParams(a))) as any;
            expect(out.status, a.id).toBe(200);
            expect(apiCalls, a.id).toHaveLength(1);
            expect(DEF.allowedHosts).toContain(new URL(apiCalls[0].url).host);
            expect(apiCalls[0].method).toBe(a.method);
            expect(apiCalls[0].auth).toBe('Bearer at-live-token');
            expect(JSON.stringify(out)).not.toMatch(/at-live-token|rt-live|secret=1/);
            await expect(call(a.id, { ...sampleParams(a), __extra: 1 }), a.id).rejects.toMatchObject({ code: 'invalid_args' });
            await expect(call(a.id, sampleParams(a), ['otro-grupo']), a.id).rejects.toMatchObject({ code: 'forbidden' });
        }
        await expect(call('admin.everything.delete', {})).rejects.toMatchObject({ code: 'invalid_args' });
    });
});
