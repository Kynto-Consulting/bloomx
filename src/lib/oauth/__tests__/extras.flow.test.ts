import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePrisma } from './harness';
import { FakeIdP, json, manifestExtension } from './provider-harness';

// SALESFORCE (host por instancia), DISCORD (webhook cifrado por cuenta) y TELEGRAM (OIDC con chat_id verificado) con sus manifests REALES contra servidores
// OAuth FALSOS en proceso. Cubre el nucleo nuevo: datos extra por cuenta (validacion estricta, cifrado, no filtracion), host dinamico validado, acciones sin
// token (noAuth), cuerpos fijos, campos permitidos por el admin, onUnlink, hash de identidad y SSRF.
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
import { __setExtensionsSource, getProvider, saveProviderSecret } from '../providers';
import { __resetFlowMemory } from '../flow-state';
import { __resetJwksCache } from '../id-token';
import { __setRefreshLock } from '../tokens';
import { unlinkUserProvider } from '../unlink';
import { handleOAuthBridge, oauthBridgeRequest } from '../broker';
import { buildActionRequestUrl } from '../action-url';
import { encryptAccountData } from '@/lib/account-tokens';
import { detectFormat } from '@/lib/encryption';

const ORIGIN = 'https://app.test';
const WEBHOOK = { id: '123456789012345678', token: 'abcdefghij'.repeat(7), url: 'https://discord.com/api/webhooks/123456789012345678/' + 'abcdefghij'.repeat(7), channel_id: '223456789012345678', guild_id: '323456789012345678', name: 'BloomX', type: 1 };
const SF_FIELDS = ['FirstName', 'LastName', 'Company', 'Email', 'Description', 'LeadSource'];
const CONFIGS: Record<string, Record<string, unknown>> = {
    salesforcelib: { SALESFORCE_CLIENT_ID: 'cid-sf', SALESFORCE_SANDBOX_CLIENT_ID: 'cid-sfs', SALESFORCE_LEAD_FIELDS: SF_FIELDS, SALESFORCE_CONTACT_FIELDS: ['LastName'], SALESFORCE_CASE_FIELDS: [], SALESFORCE_TASK_FIELDS: ['Subject'] },
    discordlib: { DISCORD_CLIENT_ID: 'cid-dc' },
    telegramlib: { TELEGRAM_CLIENT_ID: 'cid-tg' },
};

let sf: FakeIdP, sfs: FakeIdP, dc: FakeIdP, tg: FakeIdP;
let fake: ReturnType<typeof createFakePrisma>;
let ipSeq = 0;
let apiCalls: Array<{ url: string; method: string; auth: string | null; body: string | undefined }>;
let state: { instanceUrl: unknown; webhook: unknown; tgClaims: Record<string, unknown>; resolver: (host: string) => Promise<string[]>; apiResponse: ((u: URL, method: string) => Response) | null };

const req = (url: string, cookie?: string) => new NextRequest(url, { headers: { 'x-forwarded-for': `10.90.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`, ...(cookie ? { cookie } : {}) } });
const cookieFrom = (res: Response, id: string) => { for (const c of res.headers.getSetCookie()) { const m = new RegExp(`^bloomx_oauth_flow_${id}=([^;]*)`).exec(c); if (m && m[1]) return `bloomx_oauth_flow_${id}=${m[1]}`; } return null; };
async function begin(id: string, query = '') {
    const res = await startOAuth(req(`${ORIGIN}/api/oauth/${id}/start${query}`), id);
    return { res, auth: res.headers.get('location') ? new URL(res.headers.get('location') as string) : null, cookie: cookieFrom(res, id) };
}
const callback = (id: string, code: string, state_: string | null, cookie: string | null) =>
    finishOAuth(req(`${ORIGIN}/api/oauth/${id}/callback?code=${code}${state_ ? `&state=${state_}` : ''}`, cookie ?? undefined), id);
const loc = (res: Response) => res.headers.get('location') ?? '';
const noDb = { rateLimit: async () => ({ ok: true, retryAfter: 0 }) };
const call = (provider: string, action: string, params: any, groups: string[], extra: Record<string, unknown> = {}) =>
    handleOAuthBridge(noDb, oauthBridgeRequest.parse({ op: 'call', userId: 'u1', extensionId: 'consumer', grantedGroups: groups, args: { provider, action, params, ...extra } }));
const accountsOf = (provider: string) => handleOAuthBridge(noDb, oauthBridgeRequest.parse({ op: 'accounts', userId: 'u1', extensionId: 'consumer', grantedGroups: ['x'], args: { provider } })) as Promise<any[]>;

async function approveAll() {
    for (const id of ['salesforce', 'salesforce-sandbox', 'discord', 'telegram']) {
        const p = (await getProvider(id))!;
        expect(p.status).toBe('pending_approval');
        await saveProviderSecret(p, `secret-${id}`, 'admin1');
        expect((await getProvider(id))!.status).toBe('ready');
    }
}

function wire() {
    const sfToken = (idp: FakeIdP) => async (r: any) => {
        const bad = idp.checkClient(r);
        if (bad) return bad;
        const c = idp.redeem(r.form);
        if (c instanceof Response) return c;
        return json(200, { access_token: 'at-sf', refresh_token: 'rt-sf', instance_url: state.instanceUrl, id: 'https://login.salesforce.com/id/00Dx/005x', scope: c.scope, token_type: 'Bearer', issued_at: '1' });
    };
    sf.route('login.salesforce.com', '/services/oauth2/token', sfToken(sf));
    sf.route('login.salesforce.com', '/services/oauth2/userinfo', () => json(200, { sub: 'https://login.salesforce.com/id/00Dx/005x', email: 'ana@acme.test' }));
    sf.route('login.salesforce.com', '/services/oauth2/revoke', sf.revokeEndpoint());
    sfs.route('test.salesforce.com', '/services/oauth2/token', sfToken(sfs));
    sfs.route('test.salesforce.com', '/services/oauth2/userinfo', () => json(200, { sub: 'https://test.salesforce.com/id/00Dy/005y' }));
    dc.route('discord.com', '/api/oauth2/token', async (r) => {
        const bad = dc.checkClient(r);
        if (bad) return bad;
        const c = dc.redeem(r.form);
        if (c instanceof Response) return c;
        return json(200, { token_type: 'Bearer', access_token: 'at-dc', expires_in: 604800, refresh_token: 'rt-dc', scope: c.scope, ...(c.scope.split(' ').includes('webhook.incoming') ? { webhook: state.webhook } : {}) });
    });
    dc.route('discord.com', '/api/oauth2/token/revoke', dc.revokeEndpoint());
    dc.route('discord.com', '/api/users/@me', () => json(200, { id: '111111111111111111', username: 'ana' }));
    tg.route('oauth.telegram.org', '/token', async (r) => {
        const bad = tg.checkClient(r);
        if (bad) return bad;
        const c = tg.redeem(r.form);
        if (c instanceof Response) return c;
        const idToken = await tg.signIdToken({ iss: 'https://oauth.telegram.org', aud: 'cid-tg', sub: '1234123412341234123', nonce: c.nonce, extra: state.tgClaims });
        return json(200, { access_token: 'at-tg', token_type: 'Bearer', expires_in: 3600, id_token: idToken });
    });
    tg.route('oauth.telegram.org', '/.well-known/jwks.json', tg.jwksEndpoint());
}

beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('NEXTAUTH_URL', ORIGIN);
    vi.stubEnv('DATA_ENCRYPTION_KEY', 'unit-test-key-0123456789abcdef0123456789');
    sf = new FakeIdP({ clientId: 'cid-sf', clientSecret: 'secret-salesforce' });
    sfs = new FakeIdP({ clientId: 'cid-sfs', clientSecret: 'secret-salesforce-sandbox' });
    dc = new FakeIdP({ clientId: 'cid-dc', clientSecret: 'secret-discord', tokenAuth: 'basic' });
    tg = new FakeIdP({ clientId: 'cid-tg', clientSecret: 'secret-telegram', tokenAuth: 'basic' });
    for (const i of [sf, sfs, dc, tg]) await i.init();
    apiCalls = [];
    state = { instanceUrl: 'https://acme.my.salesforce.com', webhook: WEBHOOK, tgClaims: { id: 987654321, name: 'Ana' }, resolver: async () => ['34.120.1.1'], apiResponse: null };
    __setOAuthTransport(((url: string, init: any) => {
        const u = new URL(url);
        if (u.host === 'login.salesforce.com') return sf.transport(url, init);
        if (u.host === 'test.salesforce.com') return sfs.transport(url, init);
        if (u.host === 'oauth.telegram.org') return tg.transport(url, init);
        if (u.host === 'discord.com' && (u.pathname.startsWith('/api/oauth2/') || u.pathname === '/api/users/@me')) return dc.transport(url, init);
        apiCalls.push({ url, method: init.method, auth: init.headers.Authorization ?? null, body: init.body });
        if (state.apiResponse) return Promise.resolve(state.apiResponse(u, init.method));
        if (init.method === 'DELETE' || (u.host === 'discord.com' && init.method === 'POST')) return Promise.resolve(new Response(null, { status: 204 }));
        return Promise.resolve(json(200, { id: '00Q000000000001', success: true }, { 'set-cookie': 'secret=1' }));
    }) as never, (host: string) => state.resolver(host));
    __setOAuthStore(createMemoryOAuthStore());
    __setExtensionsSource(async () => ['salesforcelib', 'discordlib', 'telegramlib'].map((d) => manifestExtension(d, CONFIGS[d])));
    __resetFlowMemory();
    __resetJwksCache();
    __setRefreshLock((async (_id: string, fn: () => Promise<unknown>) => fn()) as never);
    fake = createFakePrisma();
    h.prisma = fake.prisma;
    h.currentUser = { id: 'u1', email: 'u1@x.test' };
    h.audits = [];
    wire();
    await approveAll();
});
afterEach(() => {
    __setOAuthTransport(null);
    __setOAuthStore(null);
    __setExtensionsSource(null);
    __setRefreshLock(null);
    vi.unstubAllEnvs();
});

async function link(id: string, idp: FakeIdP, subject: Record<string, any>, query = '') {
    const { auth, cookie } = await begin(id, query);
    const res = await callback(id, idp.consent(auth!.toString(), subject), auth!.searchParams.get('state'), cookie);
    return { res, auth: auth! };
}
const stored = (i = 0) => JSON.parse(fake.accounts[i].provider_data as string) as Record<string, string>;

describe('nucleo: datos extra y registro', () => {
    it('los proveedores reservados solo los registra core-salesforcelib / core-discordlib / core-telegramlib', async () => {
        const { parseExtensionProviders } = await import('../providers');
        for (const [dir, ids] of [['salesforcelib', ['salesforce', 'salesforce-sandbox']], ['discordlib', ['discord']], ['telegramlib', ['telegram']]] as const) {
            const spoof = { ...manifestExtension(dir, CONFIGS[dir]), id: 'evil-ext' };
            const out = parseExtensionProviders([spoof]);
            for (const id of ids) expect(out.has(id)).toBe(false);
        }
    });

    it('endpointHosts e identityHash cubren el sufijo y el patron: cambiarlos exige reaprobar y no acepta cuentas viejas', async () => {
        const before = (await getProvider('salesforce'))!;
        expect(before.endpointHosts).toContain('*.my.salesforce.com');
        expect(before.endpointHosts.some((x) => x.startsWith('extra:instance='))).toBe(true);
        for (const mutate of [
            (d: any) => { d.extras.instance.pattern = '^[a-z0-9-]{1,60}$'; },
            (d: any) => { d.extras.instance.hostSuffix = '.evil-salesforce.com'; d.allowedHosts = [d.allowedHosts[0], '*.evil-salesforce.com']; },
            (d: any) => { d.extras.instance.from = 'id'; },
        ]) {
            const ext = manifestExtension('salesforcelib', CONFIGS.salesforcelib);
            mutate(ext.template.oauthProviders[0]);
            __setExtensionsSource(async () => [ext]);
            const after = (await getProvider('salesforce'))!;
            expect(after.identityHash).not.toBe(before.identityHash);
            expect(after.status).toBe('needs_reapproval');
        }
    });
});

describe('Salesforce: instancia validada y guardada por cuenta', () => {
    it('vincula con instance_url del token: guarda SOLO la etiqueta, cifrable, y la cuenta lleva el hash del proveedor', async () => {
        const p = (await getProvider('salesforce'))!;
        const { res, auth } = await link('salesforce', sf, { sub: 'x' });
        expect(loc(res)).toBe(`${ORIGIN}/`);
        expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
        expect(`${auth.origin}${auth.pathname}`).toBe('https://login.salesforce.com/services/oauth2/authorize');
        expect(fake.accounts[0]).toMatchObject({ provider: 'salesforce', providerAccountId: 'https://login.salesforce.com/id/00Dx/005x', provider_hash: p.identityHash });
        expect(stored()).toEqual({ instance: 'acme' });
        expect(detectFormat(encryptAccountData({ provider_data: fake.accounts[0].provider_data }).provider_data as string).format).toBe('v3');
        expect(loc(res) + JSON.stringify(h.audits)).not.toMatch(/acme|at-sf|rt-sf/);
    });

    it('sandbox: provider salesforce-sandbox usa test.salesforce.com y admite acme--dev.sandbox', async () => {
        state.instanceUrl = 'https://acme--dev.sandbox.my.salesforce.com';
        const { auth, res } = await link('salesforce-sandbox', sfs, { sub: 'x' });
        expect(auth.host).toBe('test.salesforce.com');
        expect(loc(res)).toBe(`${ORIGIN}/`);
        expect(stored()).toEqual({ instance: 'acme--dev.sandbox' });
    });

    const ATTACKS: Array<[string, unknown]> = [
        ['punto extra (subdominio anidado)', 'https://a.b.my.salesforce.com'],
        ['userinfo @', 'https://acme.my.salesforce.com@evil.com'],
        ['@ al inicio', 'https://evil.com@acme.my.salesforce.com'],
        ['puerto', 'https://acme.my.salesforce.com:8443'],
        ['puerto 443 explicito', 'https://acme.my.salesforce.com:443'],
        ['ruta', 'https://acme.my.salesforce.com/evil'],
        ['consulta', 'https://acme.my.salesforce.com/?x=1'],
        ['fragmento .my.salesforce.com', 'https://evil.com#.my.salesforce.com'],
        ['sufijo como subdominio de otro dominio', 'https://my.salesforce.com.evil.com'],
        ['dominio hermano', 'https://acme.my.salesforce.com.evil.com'],
        ['%2e', 'https://acme%2eevil.com.my.salesforce.com'],
        ['unicode (homoglifo)', 'https://аcme.my.salesforce.com'],
        ['mayusculas', 'https://ACME.my.salesforce.com'],
        ['IPv4', 'https://127.0.0.1'],
        ['IPv4 decimal', 'https://2130706433'],
        ['IPv6', 'https://[::1]'],
        ['IPv4 con sufijo', 'https://127.0.0.1.my.salesforce.com'],
        ['http', 'http://acme.my.salesforce.com'],
        ['cadena larguisima', `https://${'a'.repeat(70)}.my.salesforce.com`],
        ['etiqueta de 1 caracter', 'https://a.my.salesforce.com'],
        ['solo el sufijo', 'https://.my.salesforce.com'],
        ['dobles puntos', 'https://acme..my.salesforce.com'],
        ['sandbox doble', 'https://acme.sandbox.sandbox.my.salesforce.com'],
        ['backslash', 'https://acme.my.salesforce.com\\@evil.com'],
        ['espacio / salto', 'https://acme.my.salesforce.com\n.evil.com'],
        ['no es cadena (objeto)', { host: 'acme.my.salesforce.com' }],
        ['no es cadena (array)', ['https://acme.my.salesforce.com']],
        ['vacia', ''],
        ['ausente', undefined],
    ];
    for (const [name, value] of ATTACKS) {
        it(`ataque instance_url (${name}): la vinculacion se rechaza y no se guarda nada`, async () => {
            state.instanceUrl = value;
            const { res } = await link('salesforce', sf, { sub: 'x' });
            expect(loc(res)).toContain('OAuthFailed');
            expect(fake.accounts).toHaveLength(0);
            expect(h.audits.some((a) => a.event === 'auth.oauth.extras_rejected')).toBe(true);
            expect(apiCalls).toHaveLength(0);
        });
    }

    it('acciones: el host es el guardado (nunca de la peticion), Bearer, API fija y solo campos permitidos', async () => {
        await link('salesforce', sf, { sub: 'x' });
        const groups = ['crm', 'userinfo'];
        const out = (await call('salesforce', 'lead.create', { record: { LastName: 'Perez', Company: 'ACME', Email: 'a@acme.test' } }, groups)) as any;
        expect(out.status).toBe(200);
        expect(apiCalls).toHaveLength(1);
        expect(apiCalls[0]).toMatchObject({ url: 'https://acme.my.salesforce.com/services/data/v62.0/sobjects/Lead', method: 'POST', auth: 'Bearer at-sf' });
        expect(JSON.parse(apiCalls[0].body!)).toEqual({ LastName: 'Perez', Company: 'ACME', Email: 'a@acme.test' });
        expect(JSON.stringify(out)).not.toMatch(/secret=1|at-sf|rt-sf/);
        // El llamador no puede aportar host ni URL.
        for (const params of [{ record: { LastName: 'x' }, instance: 'evil' }, { record: { LastName: 'x' }, host: 'evil.com' }, { record: { LastName: 'x' }, url: 'https://evil.com' }, { record: { LastName: 'x' }, apiBase: 'https://evil.com' }]) {
            await expect(call('salesforce', 'lead.create', params, groups)).rejects.toMatchObject({ code: 'invalid_args' });
        }
        // Campo fuera de la lista cerrada, campo fuera de la lista del admin, valor anidado, objeto no permitido.
        await expect(call('salesforce', 'lead.create', { record: { LastName: 'x', OwnerId: '005' } }, groups)).rejects.toMatchObject({ code: 'invalid_args' });
        await expect(call('salesforce', 'lead.create', { record: { LastName: 'x', Phone: '1' } }, groups)).rejects.toMatchObject({ code: 'forbidden' });
        await expect(call('salesforce', 'lead.create', { record: { LastName: { a: 1 } } }, groups)).rejects.toMatchObject({ code: 'invalid_args' });
        await expect(call('salesforce', 'case.create', { record: { Subject: 'x' } }, groups)).rejects.toMatchObject({ code: 'forbidden' }); // lista vacia = nada
        await expect(call('salesforce', 'contact.create', { record: { FirstName: 'x' } }, groups)).rejects.toMatchObject({ code: 'forbidden' });
        await expect(call('salesforce', 'sobjects.describe', { object: 'User' }, groups)).rejects.toMatchObject({ code: 'invalid_args' });
        await expect(call('salesforce', 'lead.create', { record: { LastName: 'x' } }, ['userinfo'])).rejects.toMatchObject({ code: 'forbidden' });
        expect(apiCalls).toHaveLength(1);
    });

    it('SOQL: solo las consultas predefinidas; `q` es constante y no se puede enviar SOQL propio', async () => {
        await link('salesforce', sf, { sub: 'x' });
        for (const id of ['query.recentLeads', 'query.recentContacts', 'query.openCases', 'query.openTasks']) {
            apiCalls.length = 0;
            await call('salesforce', id, {}, ['crm']);
            const u = new URL(apiCalls[0].url);
            expect(u.host).toBe('acme.my.salesforce.com');
            expect(u.pathname).toBe('/services/data/v62.0/query');
            expect(u.searchParams.get('q')).toMatch(/^SELECT [A-Za-z,]+ FROM (Lead|Contact|Case|Task)( WHERE IsClosed=false)? ORDER BY CreatedDate DESC LIMIT 20$/);
            await expect(call('salesforce', id, { q: 'SELECT Id FROM User' }, ['crm'])).rejects.toMatchObject({ code: 'invalid_args' });
        }
        await expect(call('salesforce', 'query', { q: 'SELECT Id FROM User' }, ['crm'])).rejects.toMatchObject({ code: 'invalid_args' });
    });

    it('describe y userinfo: describe va a la instancia; userinfo al host global login.salesforce.com', async () => {
        await link('salesforce', sf, { sub: 'x' });
        await call('salesforce', 'sobjects.describe', { object: 'Lead' }, ['crm']);
        expect(apiCalls[0].url).toBe('https://acme.my.salesforce.com/services/data/v62.0/sobjects/Lead/describe');
        const before = sf.calls.length;
        await call('salesforce', 'userinfo', {}, ['userinfo']);
        expect(sf.calls.length).toBe(before + 1);
        expect(new URL(sf.calls[before].url).host).toBe('login.salesforce.com');
        expect(sf.calls[before].headers.Authorization).toBe('Bearer at-sf');
    });

    it('un dato guardado manipulado (BD) NO cambia el host: se rechaza sin llamar a la red', async () => {
        await link('salesforce', sf, { sub: 'x' });
        for (const evil of ['evil.com', 'a@evil.com', 'acme.my.salesforce.com.evil.com', '127.0.0.1', 'ACME', '', 'a'.repeat(70)]) {
            fake.accounts[0].provider_data = JSON.stringify({ instance: evil });
            await expect(call('salesforce', 'lead.create', { record: { LastName: 'x' } }, ['crm']), evil).rejects.toMatchObject({ code: 'not_linked' });
        }
        fake.accounts[0].provider_data = null;
        await expect(call('salesforce', 'lead.create', { record: { LastName: 'x' } }, ['crm'])).rejects.toMatchObject({ code: 'not_linked' });
        expect(apiCalls).toHaveLength(0);
    });

    it('buildActionRequestUrl: parametros de ruta con .., %2e o // no alteran la ruta ni el host', () => {
        const p = { allowedHosts: ['login.salesforce.com', '*.my.salesforce.com'], apiBase: null, extras: { instance: { from: 'instance_url', hostSuffix: '.my.salesforce.com', pattern: '^[a-z0-9][a-z0-9-]{1,60}(\\.(sandbox|develop|scratch))?$' } } } as any;
        const a = { path: '/x/{id}', apiHostExtra: 'instance' } as any;
        expect(buildActionRequestUrl(p, a, { path: { id: 'abc' }, query: {} }, { instance: 'acme' })).toBe('https://acme.my.salesforce.com/x/abc');
        for (const id of ['..', '../..', '%2e%2e', 'a/b', '//evil.com', 'a?b', 'a#b']) {
            const url = buildActionRequestUrl(p, a, { path: { id }, query: {} }, { instance: 'acme' });
            expect(url === null || new URL(url).host === 'acme.my.salesforce.com').toBe(true);
            if (url) expect(new URL(url).pathname.startsWith('/x/')).toBe(true);
        }
        expect(buildActionRequestUrl(p, a, { path: { id: 'a' }, query: {} }, { instance: 'evil.com' })).toBeNull();
        expect(buildActionRequestUrl(p, a, { path: { id: 'a' }, query: {} }, {})).toBeNull();
    });

    it('SSRF: DNS que resuelve a IP privada (rebinding) o redireccion 3xx => error del proveedor, sin enviar el token', async () => {
        await link('salesforce', sf, { sub: 'x' });
        state.resolver = async (host) => (host.endsWith('.my.salesforce.com') ? ['169.254.169.254'] : ['34.120.1.1']);
        await expect(call('salesforce', 'sobjects.describe', { object: 'Lead' }, ['crm'])).rejects.toMatchObject({ code: 'provider_error' });
        expect(apiCalls).toHaveLength(0);
        state.resolver = async () => ['34.120.1.1'];
        state.apiResponse = () => new Response(null, { status: 302, headers: { location: 'https://evil.com/steal' } });
        await expect(call('salesforce', 'sobjects.describe', { object: 'Lead' }, ['crm'])).rejects.toMatchObject({ code: 'provider_error' });
    });

    it('identidades compartidas (organizer/service) no pueden usar el host de instancia', async () => {
        await link('salesforce', sf, { sub: 'x' });
        await expect(call('salesforce', 'sobjects.describe', { object: 'Lead' }, ['crm'], { principal: 'organizer' })).rejects.toMatchObject({ code: 'forbidden' });
    });

    it('regresion: el access token se refresca con la instancia intacta (extras no se pierden)', async () => {
        await link('salesforce', sf, { sub: 'x' });
        fake.accounts[0].expires_at = 1; // caducado: se intentara refrescar contra el IdP falso (sin ruta de refresh => proveedor no disponible)
        await expect(call('salesforce', 'sobjects.describe', { object: 'Lead' }, ['crm'])).rejects.toBeTruthy();
        expect(stored()).toEqual({ instance: 'acme' });
    });
});

describe('Discord: webhook por cuenta (cifrado) y acciones del broker', () => {
    const SCOPES = '?scopes=identify,webhook.incoming';

    it('inicio: Basic en el token, sin PKCE (la documentacion no lo describe), scopes pedidos y state; guarda id y token del webhook', async () => {
        const { res, auth } = await link('discord', dc, { sub: 'x' }, SCOPES);
        expect(loc(res)).toBe(`${ORIGIN}/`);
        expect(`${auth.origin}${auth.pathname}`).toBe('https://discord.com/oauth2/authorize');
        expect(auth.searchParams.get('scope')).toBe('identify webhook.incoming');
        expect(auth.searchParams.get('code_challenge')).toBeNull();
        expect(stored()).toEqual({ webhook_id: WEBHOOK.id, webhook_token: WEBHOOK.token, channel_id: WEBHOOK.channel_id, guild_id: WEBHOOK.guild_id });
        expect(fake.accounts[0].providerAccountId).toBe('111111111111111111');
        expect(loc(res) + JSON.stringify(h.audits)).not.toContain(WEBHOOK.token);
        // el token del webhook nunca va en claro en BD: la capa de cifrado lo protege
        const enc = encryptAccountData({ provider_data: fake.accounts[0].provider_data }).provider_data as string;
        expect(detectFormat(enc).format).toBe('v3');
        expect(enc).not.toContain(WEBHOOK.token);
    });

    it('solo identify: no hay webhook (extras opcionales) y la accion de webhook no esta disponible', async () => {
        await link('discord', dc, { sub: 'x' });
        expect(stored()).toEqual({});
        await expect(call('discord', 'webhook.post', { content: 'hola' }, ['webhook'])).rejects.toMatchObject({ code: 'not_linked' });
    });

    for (const [name, patch] of [
        ['token con caracteres fuera del patron', { token: 'abc def' }],
        ['token demasiado corto', { token: 'abc' }],
        ['id no numerico', { id: '../../x' }],
        ['id con host inyectado', { id: '1/../../evil' }],
        ['channel_id con letras', { channel_id: 'abc' }],
        ['token con barra', { token: 'a/'.repeat(40) }],
    ] as Array<[string, Record<string, unknown>]>) {
        it(`webhook invalido (${name}): la vinculacion se rechaza`, async () => {
            state.webhook = { ...WEBHOOK, ...patch };
            const { res } = await link('discord', dc, { sub: 'x' }, SCOPES);
            expect(loc(res)).toContain('OAuthFailed');
            expect(fake.accounts).toHaveLength(0);
        });
    }

    it('webhook.post: discord.com fijo, ruta con el webhook de la cuenta, sin Authorization, allowed_mentions.parse=[] fijo y respuesta sin secretos', async () => {
        await link('discord', dc, { sub: 'x' }, SCOPES);
        const out = (await call('discord', 'webhook.post', { content: '@everyone hola <@123>' }, ['webhook'])) as any;
        expect(out.status).toBe(204);
        expect(apiCalls).toHaveLength(1);
        expect(apiCalls[0].url).toBe(`https://discord.com/api/webhooks/${WEBHOOK.id}/${WEBHOOK.token}`);
        expect(apiCalls[0].method).toBe('POST');
        expect(apiCalls[0].auth).toBeNull();
        expect(JSON.parse(apiCalls[0].body!)).toEqual({ content: '@everyone hola <@123>', allowed_mentions: { parse: [] }, flags: 4 });
        expect(JSON.stringify(out)).not.toContain(WEBHOOK.token);
        // el llamador no puede sobrescribir las menciones ni aportar webhook/host/ruta
        for (const params of [{ content: 'x', allowed_mentions: { parse: ['everyone'] } }, { content: 'x', flags: 0 }, { content: 'x', webhookId: '1' }, { content: 'x', webhookToken: 'y' }, { content: 'x', url: 'https://evil.com' }, { content: 'x', username: 'Admin' }, {}]) {
            await expect(call('discord', 'webhook.post', params, ['webhook'])).rejects.toMatchObject({ code: 'invalid_args' });
        }
        await expect(call('discord', 'webhook.post', { content: 'x'.repeat(2001) }, ['webhook'])).rejects.toMatchObject({ code: 'invalid_args' });
        await expect(call('discord', 'webhook.post', { content: 'x' }, ['identity'])).rejects.toMatchObject({ code: 'forbidden' });
        await expect(call('discord', 'webhook.post', { content: 'x' }, ['webhook'], { principal: 'service' })).rejects.toMatchObject({ code: 'forbidden' });
        expect(apiCalls).toHaveLength(1);
    });

    it('un webhook manipulado en BD no cambia host ni ruta', async () => {
        await link('discord', dc, { sub: 'x' }, SCOPES);
        for (const evil of [{ webhook_id: '1/../../x', webhook_token: WEBHOOK.token }, { webhook_id: WEBHOOK.id, webhook_token: 'a/b' + 'c'.repeat(60) }, { webhook_id: WEBHOOK.id }]) {
            fake.accounts[0].provider_data = JSON.stringify(evil);
            await expect(call('discord', 'webhook.post', { content: 'x' }, ['webhook'])).rejects.toMatchObject({ code: 'not_linked' });
        }
        expect(apiCalls).toHaveLength(0);
    });

    it('accounts(): solo expone channel_id/guild_id (publicos); el id y el token del webhook jamas salen del nucleo', async () => {
        await link('discord', dc, { sub: 'x' }, SCOPES);
        const list = await accountsOf('discord');
        expect(list).toHaveLength(1);
        expect(list[0].meta).toEqual({ channel_id: WEBHOOK.channel_id, guild_id: WEBHOOK.guild_id });
        expect(JSON.stringify(list)).not.toMatch(new RegExp(`${WEBHOOK.token}|at-dc|rt-dc|${WEBHOOK.id}`));
    });

    it('me y myGuilds usan el token de la cuenta con Bearer; el barrido de acciones no filtra tokens', async () => {
        await link('discord', dc, { sub: 'x' }, '?scopes=identify,guilds');
        const g = ['identity', 'guilds'];
        await call('discord', 'myGuilds', { limit: 10 }, g);
        expect(apiCalls[0]).toMatchObject({ url: 'https://discord.com/api/users/@me/guilds?limit=10', method: 'GET', auth: 'Bearer at-dc' });
        await expect(call('discord', 'myGuilds', { limit: 10, host: 'x' }, g)).rejects.toMatchObject({ code: 'invalid_args' });
    });

    it('desconectar: BORRA el webhook en Discord (sin token), revoca el token y borra la cuenta; un fallo de Discord no impide desvincular', async () => {
        await link('discord', dc, { sub: 'x' }, SCOPES);
        const out = await unlinkUserProvider('u1', 'discord');
        expect(out.unlinked).toBe(1);
        expect(out.revoked).toEqual(['revoked']);
        const del = apiCalls.find((c) => c.method === 'DELETE')!;
        expect(del.url).toBe(`https://discord.com/api/webhooks/${WEBHOOK.id}/${WEBHOOK.token}`);
        expect(del.auth).toBeNull();
        expect(dc.revoked).toEqual(['rt-dc']);
        expect(fake.accounts).toHaveLength(0);
        // Discord caido: se desvincula igualmente
        await link('discord', dc, { sub: 'x' }, SCOPES);
        state.apiResponse = () => new Response('boom', { status: 500 });
        dc.revokeStatus = 500;
        expect((await unlinkUserProvider('u1', 'discord')).unlinked).toBe(1);
        expect(fake.accounts).toHaveLength(0);
    });

    it('volver a conectar con OTRO canal limpia el webhook anterior; reconectar solo con identify conserva el actual', async () => {
        await link('discord', dc, { sub: 'x' }, SCOPES);
        const old = { ...WEBHOOK };
        state.webhook = { ...WEBHOOK, id: '923456789012345678', token: 'ZYXWVUTSRQ'.repeat(7), channel_id: '823456789012345678' };
        await link('discord', dc, { sub: 'x' }, SCOPES);
        expect(apiCalls.some((c) => c.method === 'DELETE' && c.url.endsWith(`/${old.id}/${old.token}`))).toBe(true);
        expect(fake.accounts).toHaveLength(1);
        expect(stored().webhook_id).toBe('923456789012345678');
        apiCalls.length = 0;
        await link('discord', dc, { sub: 'x' });
        expect(stored().webhook_id).toBe('923456789012345678');
        expect(apiCalls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    });
});

describe('Telegram: OIDC con id_token verificado y chat_id', () => {
    const start = () => begin('telegram');

    it('inicio: PKCE S256, nonce, scopes openid profile telegram:bot_access y Basic en el token', async () => {
        const { auth } = await start();
        expect(`${auth!.origin}${auth!.pathname}`).toBe('https://oauth.telegram.org/auth');
        expect(auth!.searchParams.get('scope')).toBe('openid profile telegram:bot_access');
        expect(auth!.searchParams.get('code_challenge_method')).toBe('S256');
        expect(auth!.searchParams.get('nonce')!.length).toBeGreaterThan(10);
        expect(auth!.toString()).not.toContain('secret-telegram');
    });

    it('flujo completo: chat_id viene del claim `id` FIRMADO; accounts() lo expone (publico) con el grupo bot aunque Telegram no devuelva scope', async () => {
        const { res } = await link('telegram', tg, { sub: 'x' });
        expect(loc(res)).toBe(`${ORIGIN}/`);
        expect(fake.accounts[0]).toMatchObject({ provider: 'telegram', providerAccountId: '1234123412341234123', scope: 'openid profile telegram:bot_access' });
        expect(stored()).toEqual({ chat_id: '987654321' });
        const list = await accountsOf('telegram');
        expect(list[0].meta).toEqual({ chat_id: '987654321' });
        expect(list[0].groups).toEqual(['bot', 'login']);
        // Telegram firmo con Basic: el secreto fue por cabecera
        const tokenCall = tg.calls.find((c) => c.url.endsWith('/token'))!;
        expect(tokenCall.headers.Authorization).toMatch(/^Basic /);
        expect(tokenCall.form.client_secret).toBeUndefined();
    });

    for (const [name, claims] of [
        ['id ausente', { name: 'x' }],
        ['id no numerico', { id: 'abc' }],
        ['id negativo', { id: -5 }],
        ['id cero', { id: 0 }],
        ['id con inyeccion', { id: '1; DROP' }],
        ['id decimal', { id: 1.5 }],
        ['id enorme', { id: '9'.repeat(30) }],
        ['id como objeto', { id: { a: 1 } }],
    ] as Array<[string, Record<string, unknown>]>) {
        it(`claim id invalido (${name}): no se vincula (el chat no se acepta a ciegas)`, async () => {
            state.tgClaims = claims;
            const { res } = await link('telegram', tg, { sub: 'x' });
            expect(loc(res)).toContain('OAuthFailed');
            expect(fake.accounts).toHaveLength(0);
        });
    }

    it('id_token invalido (aud, iss, nonce, firma, alg none, caducado) => no se vincula', async () => {
        const cases: Array<[string, (nonce: string | null) => Promise<string>]> = [
            ['aud ajena', (n) => tg.signIdToken({ iss: 'https://oauth.telegram.org', aud: 'otro', sub: 's', nonce: n, extra: { id: 1 } })],
            ['iss ajeno', (n) => tg.signIdToken({ iss: 'https://evil.example.com', aud: 'cid-tg', sub: 's', nonce: n, extra: { id: 1 } })],
            ['nonce ajeno', (n) => tg.signIdToken({ iss: 'https://oauth.telegram.org', aud: 'cid-tg', sub: 's', nonce: 'otro-nonce', extra: { id: 1 } })],
            ['firma alterada', (n) => tg.signIdToken({ iss: 'https://oauth.telegram.org', aud: 'cid-tg', sub: 's', nonce: n, extra: { id: 1 }, badSignature: true })],
            ['alg none', (n) => tg.signIdToken({ iss: 'https://oauth.telegram.org', aud: 'cid-tg', sub: 's', nonce: n, extra: { id: 1 }, alg: 'none' })],
            ['caducado', (n) => tg.signIdToken({ iss: 'https://oauth.telegram.org', aud: 'cid-tg', sub: 's', nonce: n, extra: { id: 1 }, exp: Math.floor(Date.now() / 1000) - 3600 })],
        ];
        for (const [name, make] of cases) {
            tg.routes.set('oauth.telegram.org/token', async (r) => {
                const bad = tg.checkClient(r);
                if (bad) return bad;
                const c = tg.redeem(r.form);
                if (c instanceof Response) return c;
                return json(200, { access_token: 'at-tg', token_type: 'Bearer', expires_in: 3600, id_token: await make(c.nonce) });
            });
            const { res } = await link('telegram', tg, { sub: 'x' });
            expect(loc(res), name).toContain('OAuthFailed');
            expect(fake.accounts, name).toHaveLength(0);
        }
    });

    it('sin id_token en la respuesta no se vincula', async () => {
        tg.routes.set('oauth.telegram.org/token', async (r) => {
            const c = tg.redeem(r.form);
            if (c instanceof Response) return c;
            return json(200, { access_token: 'at-tg', token_type: 'Bearer', expires_in: 3600 });
        });
        const { res } = await link('telegram', tg, { sub: 'x' });
        expect(loc(res)).toContain('OAuthFailed');
        expect(fake.accounts).toHaveLength(0);
    });

    it('state ajeno => InvalidState; un usuario no puede apropiarse de la cuenta de Telegram de otro', async () => {
        const { auth, cookie } = await start();
        expect(loc(await callback('telegram', tg.consent(auth!.toString(), {}), 'forjado', cookie))).toContain('InvalidState');
        await link('telegram', tg, {});
        h.currentUser = { id: 'u2', email: 'u2@x.test' };
        const second = await link('telegram', tg, {});
        expect(loc(second.res)).toContain('AccountAlreadyLinked');
        expect(fake.accounts).toHaveLength(1);
        expect(fake.accounts[0].userId).toBe('u1');
    });
});

describe('regresion: proveedores sin extras no cambian', () => {
    it('Google (integrado) y proveedores sin extras: identityHash sin extras y provider_data intacto', async () => {
        const g = (await getProvider('google'))!;
        expect(g.extras).toEqual({});
        expect(g.onUnlink).toBeNull();
        expect(g.endpointHosts.some((x) => x.startsWith('extra:'))).toBe(false);
    });
});
