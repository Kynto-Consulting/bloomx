import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePrisma, FakeGoogle } from './harness';

// --- dobles (hoisted) -------------------------------------------------------------------------------------------------
const h = vi.hoisted(() => ({
    prisma: null as any,
    currentUser: null as null | { id: string; email: string; name?: string | null },
    session: { sessionCookie: null as any, mfa: false },
    mfaRequired: false as boolean,
    audits: [] as Array<{ event: string; data: any }>,
    meetPatched: [] as string[],
}));
vi.mock('@/lib/prisma', () => ({ get prisma() { return h.prisma; } }));
vi.mock('@/lib/session', () => ({
    getCurrentUser: vi.fn(async () => h.currentUser),
    getSessionCookie: vi.fn(async () => h.session),
    setSessionCookie: vi.fn(async (payload: any, opts: any) => { h.session.sessionCookie = { payload, opts }; }),
}));
vi.mock('@/lib/mfa', () => ({ mfaRequiredFor: vi.fn(() => h.mfaRequired) }));
vi.mock('@/lib/permissions', () => ({ refreshPermissions: vi.fn(async () => undefined) }));
vi.mock('@/lib/google/meet', () => ({ patchAllUserMeetRooms: vi.fn(async (id: string) => { h.meetPatched.push(id); }) }));
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
import { startOAuth, finishOAuth, resolveReturnTo, isOfficialGoogle } from '../flow';
import { __setOAuthTransport } from '../http';
import { __setOAuthStore, createMemoryOAuthStore } from '../store';
import { __setExtensionsSource } from '../providers';
import { __resetFlowMemory } from '../flow-state';
import { __resetJwksCache } from '../id-token';

const ORIGIN = 'https://app.test';
const CB = `${ORIGIN}/api/auth/callback/google`;
let google: FakeGoogle;
let store: ReturnType<typeof createMemoryOAuthStore>;
let ipSeq = 0;

const mkReq = (url: string, cookie?: string, headers: Record<string, string> = {}) =>
    new NextRequest(url, { headers: { 'x-forwarded-for': `198.18.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`.replace('198.18', '10.50'), ...(cookie ? { cookie } : {}), ...headers } });

function cookieFrom(res: Response, name = 'bloomx_oauth_flow_google'): string | null {
    for (const c of res.headers.getSetCookie()) {
        const m = new RegExp(`^${name}=([^;]*)`).exec(c);
        if (m && m[1]) return `${name}=${m[1]}`;
    }
    return null;
}

/** Inicia el flujo y devuelve lo necesario para el callback. */
async function begin(path = '/api/auth/google', opts: { cookie?: string; headers?: Record<string, string> } = {}) {
    const res = await startOAuth(mkReq(`${ORIGIN}${path}`, opts.cookie, opts.headers), 'google');
    return { res, auth: res.headers.get('location') ? new URL(res.headers.get('location') as string) : null, cookie: cookieFrom(res) };
}
const callback = (code: string | null, state: string | null, cookie: string | null, extra = '') =>
    finishOAuth(mkReq(`${CB}?${[code ? `code=${code}` : '', state ? `state=${state}` : '', extra].filter(Boolean).join('&')}`, cookie ?? undefined), 'google');
const loc = (res: Response) => res.headers.get('location') ?? '';

beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('NEXTAUTH_URL', ORIGIN);
    vi.stubEnv('GOOGLE_CLIENT_ID', 'cid-123');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'csecret-xyz');
    vi.stubEnv('DATA_ENCRYPTION_KEY', 'unit-test-key-0123456789abcdef0123456789');
    vi.stubEnv('GOOGLE_ALLOW_SIGNUP', '');
    google = new FakeGoogle({ clientId: 'cid-123', clientSecret: 'csecret-xyz' });
    await google.init();
    __setOAuthTransport(google.transport as never, async () => ['142.250.1.1']);
    store = createMemoryOAuthStore();
    __setOAuthStore(store);
    __setExtensionsSource(async () => []);
    __resetFlowMemory();
    __resetJwksCache();
    const fake = createFakePrisma();
    h.prisma = fake.prisma;
    (h as any).fake = fake;
    h.currentUser = null;
    h.session = { sessionCookie: null, mfa: false };
    h.mfaRequired = false;
    h.audits = [];
    h.meetPatched = [];
});
afterEach(() => {
    __setOAuthTransport(null);
    __setOAuthStore(null);
    __setExtensionsSource(null);
    vi.unstubAllEnvs();
});

describe('inicio del flujo (alias /api/auth/google)', () => {
    it('redirige a Google con client_id, redirect_uri EXACTA, scopes de siempre, PKCE S256, nonce y un state opaco', async () => {
        const { res, auth, cookie } = await begin('/api/auth/google?returnTo=/mail/inbox');
        expect(res.status).toBe(307);
        expect(auth!.origin + auth!.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
        const p = auth!.searchParams;
        expect(p.get('client_id')).toBe('cid-123');
        expect(p.get('redirect_uri')).toBe(CB);
        expect(p.get('response_type')).toBe('code');
        expect(p.get('scope')).toBe('openid email profile https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/contacts.readonly https://www.googleapis.com/auth/meetings.space.created');
        expect(p.get('access_type')).toBe('offline');
        expect(p.get('prompt')).toBe('consent');
        expect(p.get('code_challenge_method')).toBe('S256');
        expect(p.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(p.get('nonce')).toBeTruthy();
        const state = p.get('state')!;
        expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
        // Opaco: ni JSON ni returnTo ni usuario dentro.
        expect(Buffer.from(state, 'base64url').toString('latin1')).not.toMatch(/returnTo|nonce|mail/);
        expect(cookie).toBeTruthy();
        const set = res.headers.getSetCookie().find((c) => c.startsWith('bloomx_oauth_flow_google='))!;
        expect(set).toMatch(/HttpOnly/i);
        expect(set).toMatch(/SameSite=lax/i);
        expect(set).toMatch(/Path=\/api/);
        expect(set).toMatch(/Max-Age=600/);
        // La cookie va cifrada: no contiene el verificador ni el returnTo en claro.
        expect(decodeURIComponent(cookie!)).not.toMatch(/mail\/inbox|code_verifier/);
        expect(store.flows.size).toBe(1);
    });

    it('sin GOOGLE_CLIENT_ID mantiene el mensaje historico {error: "Google Client ID not configured"} (500)', async () => {
        vi.stubEnv('GOOGLE_CLIENT_ID', '');
        __setExtensionsSource(async () => []);
        const { res } = await begin();
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: 'Google Client ID not configured' });
    });

    it('scopes fuera del catalogo => 400; proveedor desconocido => 404; las variables y la ruta quedan fuera del state', async () => {
        const bad = await startOAuth(mkReq(`${ORIGIN}/api/oauth/google/start?scopes=https://evil/scope`), 'google');
        expect(bad.status).toBe(400);
        const unknown = await startOAuth(mkReq(`${ORIGIN}/api/oauth/nope/start`), 'nope');
        expect(unknown.status).toBe(404);
        const subset = await startOAuth(mkReq(`${ORIGIN}/api/oauth/google/start?scopes=openid+email`), 'google');
        expect(new URL(subset.headers.get('location')!).searchParams.get('scope')).toBe('openid email');
    });

    it('CSRF en el inicio: con sesion, un inicio cross-site se rechaza; mismo sitio y anonimo si', async () => {
        h.currentUser = { id: 'u1', email: 'u1@x.test' };
        const cross = await startOAuth(mkReq(`${ORIGIN}/api/oauth/google/start`, undefined, { 'sec-fetch-site': 'cross-site' }), 'google');
        expect(cross.status).toBe(403);
        const same = await startOAuth(mkReq(`${ORIGIN}/api/oauth/google/start`, undefined, { 'sec-fetch-site': 'same-origin' }), 'google');
        expect(same.status).toBe(307);
        h.currentUser = null;
        const anon = await startOAuth(mkReq(`${ORIGIN}/api/auth/google`, undefined, { 'sec-fetch-site': 'cross-site' }), 'google');
        expect(anon.status).toBe(307);
    });

    it('returnTo: solo rutas relativas del propio origen (open redirect)', () => {
        for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', '/a b', '/x\r\nSet-Cookie: a=b', '///evil', 'evil.com', null, 123, '/' + 'a'.repeat(400)]) expect(resolveReturnTo(bad), String(bad)).toBe('/');
        expect(resolveReturnTo('/mail/inbox?x=1')).toBe('/mail/inbox?x=1');
        expect(resolveReturnTo('/')).toBe('/');
    });
});

describe('callback: inicio de sesion con Google (compatibilidad)', () => {
    async function loginAs(profile = { email: 'ana@x.test', sub: 'g-111', emailVerified: true as boolean | undefined }) {
        google.setProfile({ sub: profile.sub, email: profile.email, verified: profile.emailVerified });
        const { auth, cookie } = await begin('/api/auth/google?returnTo=/mail');
        const code = google.consent(auth!.toString(), profile);
        return { code, state: auth!.searchParams.get('state')!, cookie, auth: auth! };
    }

    it('flujo completo: crea el usuario y la cuenta con los tokens, abre sesion y vuelve a returnTo; limpia la cookie', async () => {
        const f = await loginAs();
        const res = await callback(f.code, f.state, f.cookie);
        expect(res.status).toBe(307);
        expect(loc(res)).toBe(`${ORIGIN}/mail`);
        const fake = (h as any).fake;
        expect(fake.users).toHaveLength(1);
        expect(fake.users[0].email).toBe('ana@x.test');
        expect(fake.accounts).toHaveLength(1);
        expect(fake.accounts[0]).toMatchObject({ provider: 'google', providerAccountId: 'g-111', type: 'oauth' });
        expect(fake.accounts[0].access_token).toMatch(/^at-/);
        expect(fake.accounts[0].refresh_token).toMatch(/^rt-/);
        expect(h.session.sessionCookie.payload.sub).toBe(fake.users[0].id);
        expect(res.headers.getSetCookie().some((c) => /^bloomx_oauth_flow_google=;/.test(c) && /Max-Age=0/i.test(c))).toBe(true);
        expect(h.audits.some((a) => a.event === 'auth.google.success')).toBe(true);
        // Intercambio: client_secret_post, redirect_uri exacta, verificador PKCE de 43 caracteres, sin Authorization en el token.
        const tokenCall = google.calls.find((c) => c.url.endsWith('/token'))!;
        expect(tokenCall.form.client_secret).toBe('csecret-xyz');
        expect(tokenCall.form.redirect_uri).toBe(CB);
        expect(tokenCall.form.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
        // Parchea las salas de Meet cuando el token trae el scope.
        expect(h.meetPatched).toEqual([fake.users[0].id]);
    });

    it('state REUTILIZADO: el segundo callback con el mismo state y cookie se rechaza (un solo uso)', async () => {
        const f = await loginAs();
        expect(loc(await callback(f.code, f.state, f.cookie))).toBe(`${ORIGIN}/mail`);
        const code2 = google.consent(f.auth.toString(), { email: 'ana@x.test', sub: 'g-111' });
        const again = await callback(code2, f.state, f.cookie);
        expect(loc(again)).toBe(`${ORIGIN}/login?error=InvalidState`);
        expect((h as any).fake.accounts).toHaveLength(1);
        expect(h.audits.some((a) => a.event === 'auth.google.state_mismatch' && a.data.reason === 'replayed')).toBe(true);
    });

    it('state ajeno/alterado, sin state, sin cookie o con cookie manipulada => InvalidState (y no se llama a Google)', async () => {
        const f = await loginAs();
        const before = google.calls.length;
        for (const [state, cookie] of [[f.state.replace(/.$/, f.state.endsWith('A') ? 'B' : 'A'), f.cookie], [null, f.cookie], [f.state, null], [f.state, f.cookie!.slice(0, -3) + 'abc'], ['x'.repeat(300), f.cookie]] as const) {
            const res = await callback(f.code, state, cookie);
            expect(loc(res), String(state)).toBe(`${ORIGIN}/login?error=InvalidState`);
        }
        expect(google.calls.length).toBe(before);
        expect((h as any).fake.accounts).toHaveLength(0);
    });

    it('cookie de OTRO flujo (otro state) no sirve aunque sea valida', async () => {
        const a = await loginAs();
        const b = await begin('/api/auth/google');
        const codeA = a.code;
        const res = await callback(codeA, a.state, b.cookie);
        expect(loc(res)).toBe(`${ORIGIN}/login?error=InvalidState`);
    });

    it('state caducado (10 min) => InvalidState', async () => {
        const f = await loginAs();
        vi.useFakeTimers();
        vi.setSystemTime(Date.now() + 11 * 60_000);
        try {
            expect(loc(await callback(f.code, f.state, f.cookie))).toBe(`${ORIGIN}/login?error=InvalidState`);
        } finally {
            vi.useRealTimers();
        }
    });

    it('callback de OTRO usuario: iniciado por A (link) y completado con la sesion de B => rechazado; anonimo->con sesion tambien', async () => {
        h.currentUser = { id: 'A', email: 'a@x.test' };
        (h as any).fake.users.push({ id: 'A', email: 'a@x.test', name: null, avatar: null, password: '' }, { id: 'B', email: 'b@x.test', name: null, avatar: null, password: '' });
        const f = await loginAs({ email: 'a@x.test', sub: 'g-A', emailVerified: true });
        h.currentUser = { id: 'B', email: 'b@x.test' };
        expect(loc(await callback(f.code, f.state, f.cookie))).toBe(`${ORIGIN}/login?error=InvalidState`);
        // iniciado anonimo, completado con una sesion ya abierta
        h.currentUser = null;
        const g = await loginAs({ email: 'c@x.test', sub: 'g-C', emailVerified: true });
        h.currentUser = { id: 'B', email: 'b@x.test' };
        expect(loc(await callback(g.code, g.state, g.cookie))).toBe(`${ORIGIN}/login?error=InvalidState`);
        expect((h as any).fake.accounts).toHaveLength(0);
    });

    it('PKCE incorrecto: si el verificador no corresponde al challenge, Google (falso) rechaza y no se vincula nada', async () => {
        const f = await loginAs();
        const tampered = new Map(Object.entries({}));
        void tampered;
        // Otro flujo cuyo code se canjea con el verificador de ESTE: se simula consintiendo con un challenge distinto.
        const otro = new URL(f.auth.toString());
        otro.searchParams.set('code_challenge', 'A'.repeat(43));
        const badCode = google.consent(otro.toString(), { email: 'ana@x.test', sub: 'g-111' });
        const res = await callback(badCode, f.state, f.cookie);
        expect(loc(res)).toBe(`${ORIGIN}/login?error=GoogleAuthFailed`);
        expect((h as any).fake.accounts).toHaveLength(0);
    });

    it('redirect_uri manipulada: la del canje es la registrada en la cookie; si Google tuviera otra, falla', async () => {
        const f = await loginAs();
        const evil = new URL(f.auth.toString());
        evil.searchParams.set('redirect_uri', 'https://evil.test/cb');
        const code = google.consent(evil.toString(), { email: 'ana@x.test', sub: 'g-111' });
        expect(loc(await callback(code, f.state, f.cookie))).toBe(`${ORIGIN}/login?error=GoogleAuthFailed`);
    });

    it('mix-up (RFC 9207): un parametro iss de otro emisor se rechaza', async () => {
        const f = await loginAs();
        const res = await callback(f.code, f.state, f.cookie, 'iss=https%3A%2F%2Fevil.example');
        expect(loc(res)).toBe(`${ORIGIN}/login?error=InvalidState`);
        const ok = await loginAs();
        expect(loc(await callback(ok.code, ok.state, ok.cookie, 'iss=https%3A%2F%2Faccounts.google.com'))).toBe(`${ORIGIN}/mail`);
    });

    it('id_token invalido => no se vincula: nonce distinto, aud ajena, iss ajeno, caducado, azp ajeno, sin nonce, alg none, firma alterada', async () => {
        const cases: Array<[string, Partial<FakeGoogle['idTokenOverrides']>]> = [
            ['nonce', { nonce: 'otro' }], ['aud', { aud: 'otro-client' }], ['iss', { iss: 'https://evil.example' }],
            ['exp', { exp: Math.floor(Date.now() / 1000) - 3600 }], ['azp', { azp: 'otro-client' }], ['sin nonce', { omitNonce: true }],
            ['alg none', { alg: 'none' }], ['firma', { badSignature: true }],
        ];
        for (const [label, over] of cases) {
            google.idTokenOverrides = over;
            const f = await loginAs();
            const res = await callback(f.code, f.state, f.cookie);
            expect(loc(res), label).toBe(`${ORIGIN}/login?error=GoogleAuthFailed`);
        }
        expect((h as any).fake.accounts).toHaveLength(0);
        expect(h.audits.filter((a) => a.event === 'auth.oauth.id_token_rejected').length).toBe(cases.length);
    });

    it('JWKS: rotacion de claves (kid desconocido => recarga) y gracia si el proveedor cae', async () => {
        const f1 = await loginAs();
        expect(loc(await callback(f1.code, f1.state, f1.cookie))).toBe(`${ORIGIN}/mail`);
        expect(google.jwksFetches).toBe(1);
        await google.rotateKey('k2');
        vi.useFakeTimers({ now: Date.now() + 120_000 });
        try {
            const f2 = await loginAs({ email: 'bea@x.test', sub: 'g-222', emailVerified: true });
            expect(loc(await callback(f2.code, f2.state, f2.cookie))).toBe(`${ORIGIN}/mail`);
            expect(google.jwksFetches).toBe(2);
            google.jwksFailing = true;
            const f3 = await loginAs({ email: 'cleo@x.test', sub: 'g-333', emailVerified: true });
            expect(loc(await callback(f3.code, f3.state, f3.cookie))).toBe(`${ORIGIN}/mail`);
        } finally {
            vi.useRealTimers();
        }
    });

    it('A2: email_verified AUSENTE tambien se rechaza (debe ser explicitamente true); y solo el Google oficial inicia sesion', async () => {
        const unk = await loginAs({ email: 'u@x.test', sub: 'g-9', emailVerified: null as unknown as boolean });
        expect(loc(await callback(unk.code, unk.state, unk.cookie))).toBe(`${ORIGIN}/login?error=EmailNotVerified`);
        expect((h as any).fake.users).toHaveLength(0);
        const official = { id: 'google', source: 'builtin' as const, extensionId: null, endpointHosts: ['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com'] };
        expect(isOfficialGoogle(official)).toBe(true);
        expect(isOfficialGoogle({ ...official, source: 'extension', extensionId: 'core-googlelib' })).toBe(true);
        expect(isOfficialGoogle({ ...official, source: 'extension', extensionId: 'evil-ext' })).toBe(false);
        expect(isOfficialGoogle({ ...official, endpointHosts: [...official.endpointHosts, 'evil.example.com'] })).toBe(false);
        expect(isOfficialGoogle({ ...official, id: 'acme' })).toBe(false);
    });

    it('reglas historicas: correo no verificado, alta bloqueada en produccion, MFA obligatorio y cuenta ya vinculada a otro usuario', async () => {
        const unv = await loginAs({ email: 'u@x.test', sub: 'g-1', emailVerified: false });
        expect(loc(await callback(unv.code, unv.state, unv.cookie))).toBe(`${ORIGIN}/login?error=EmailNotVerified`);

        vi.stubEnv('NODE_ENV', 'production');
        const blocked = await loginAs({ email: 'n@x.test', sub: 'g-2', emailVerified: true });
        expect(loc(await callback(blocked.code, blocked.state, blocked.cookie))).toBe(`${ORIGIN}/login?error=SignupDisabled`);
        vi.stubEnv('NODE_ENV', 'test');

        (h as any).fake.users.push({ id: 'adm', email: 'adm@x.test', name: null, avatar: null, password: 'x' });
        h.mfaRequired = true;
        const mfa = await loginAs({ email: 'adm@x.test', sub: 'g-3', emailVerified: true });
        expect(loc(await callback(mfa.code, mfa.state, mfa.cookie))).toBe(`${ORIGIN}/login?error=MfaRequiredUsePassword`);
        h.mfaRequired = false;

        (h as any).fake.users.push({ id: 'U1', email: 'u1@x.test', name: null, avatar: null, password: '' });
        (h as any).fake.accounts.push({ id: 'accX', userId: 'U1', type: 'oauth', provider: 'google', providerAccountId: 'g-4', access_token: 'old', refresh_token: 'old', id_token: null, expires_at: 1, scope: 's', token_type: null });
        (h as any).fake.users.push({ id: 'U2', email: 'u2@x.test', name: null, avatar: null, password: '' });
        h.currentUser = { id: 'U2', email: 'u2@x.test' };
        const linked = await loginAs({ email: 'u2@x.test', sub: 'g-4', emailVerified: true });
        expect(loc(await callback(linked.code, linked.state, linked.cookie))).toBe(`${ORIGIN}/mail?error=GoogleAlreadyLinked`);
        expect((h as any).fake.accounts.find((a: any) => a.id === 'accX').access_token).toBe('old');
    });

    it('con sesion abierta VINCULA a ese usuario conservando el claim mfa de la sesion', async () => {
        (h as any).fake.users.push({ id: 'U9', email: 'u9@x.test', name: null, avatar: null, password: 'p' });
        h.currentUser = { id: 'U9', email: 'u9@x.test' };
        h.session = { sessionCookie: null, mfa: true, sub: 'U9' } as never;
        const f = await loginAs({ email: 'otro@gmail.test', sub: 'g-9', emailVerified: true });
        expect(loc(await callback(f.code, f.state, f.cookie))).toBe(`${ORIGIN}/mail`);
        expect((h as any).fake.accounts[0].userId).toBe('U9');
        expect(h.session.sessionCookie.opts.mfa).toBe(true);
    });

    it('el token JAMAS aparece en redirecciones, respuestas, auditoria ni logs', async () => {
        const logs: string[] = [];
        const spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); }));
        try {
            const f = await loginAs();
            const res = await callback(f.code, f.state, f.cookie);
            const acc = (h as any).fake.accounts[0];
            const everything = [loc(res), JSON.stringify(h.audits), logs.join('\n'), res.headers.getSetCookie().join('\n'), f.auth.toString()].join('\n');
            for (const secret of [acc.access_token, acc.refresh_token, 'csecret-xyz', f.code]) expect(everything).not.toContain(secret);
            // fallos del proveedor tampoco filtran el secreto
            google.idTokenOverrides = { aud: 'x' };
            const g = await loginAs({ email: 'q@x.test', sub: 'g-q', emailVerified: true });
            await callback(g.code, g.state, g.cookie);
            expect(logs.join('\n') + JSON.stringify(h.audits)).not.toContain('csecret-xyz');
        } finally {
            spies.forEach((s) => s.mockRestore());
        }
    });

    it('sin tabla OAuthFlow degrada al nonce de la cookie y SIGUE un solo uso por proceso', async () => {
        __setOAuthStore(createMemoryOAuthStore({ flowsAvailable: false }));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            const f = await loginAs();
            expect(loc(await callback(f.code, f.state, f.cookie))).toBe(`${ORIGIN}/mail`);
            const code2 = google.consent(f.auth.toString(), { email: 'ana@x.test', sub: 'g-111' });
            expect(loc(await callback(code2, f.state, f.cookie))).toBe(`${ORIGIN}/login?error=InvalidState`);
        } finally {
            warn.mockRestore();
        }
    });
});

describe('B6: sin tabla OAuthFlow en PRODUCCION el flujo falla cerrado', () => {
    it('el callback rechaza (no degrada a memoria) y el inicio responde 503', async () => {
        __setOAuthStore(createMemoryOAuthStore({ flowsAvailable: false }));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            const f = await (async () => {
                google.setProfile({ sub: 'g-1', email: 'a@x.test', verified: true });
                const { auth, cookie } = await begin('/api/auth/google?returnTo=/mail');
                return { code: google.consent(auth!.toString(), { email: 'a@x.test', sub: 'g-1' }), state: auth!.searchParams.get('state')!, cookie };
            })();
            vi.stubEnv('NODE_ENV', 'production');
            expect(loc(await callback(f.code, f.state, f.cookie))).toBe(`${ORIGIN}/login?error=InvalidState`);
            expect((h as any).fake.users).toHaveLength(0);
            const start = await startOAuth(mkReq(`${ORIGIN}/api/auth/google`), 'google');
            expect(start.status).toBe(503);
        } finally {
            vi.stubEnv('NODE_ENV', 'test');
            warn.mockRestore();
        }
    });
});
