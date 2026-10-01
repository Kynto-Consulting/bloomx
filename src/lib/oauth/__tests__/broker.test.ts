import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePrisma, FakeGoogle } from './harness';

const h = vi.hoisted(() => ({ prisma: null as any, audits: [] as Array<{ event: string; data: any }> }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return h.prisma; } }));
vi.mock('@/lib/db/pool', () => ({ getDbPool: () => { throw new Error('no db'); } }));
vi.mock('@/lib/security', async () => {
    const actual = await vi.importActual<typeof import('@/lib/security')>('@/lib/security');
    return { ...actual, auditLog: vi.fn((event: string, data: any) => { h.audits.push({ event, data }); }) };
});

import { NextRequest } from 'next/server';
import { createBridgeHandler, type BridgeDeps } from '@/lib/expansions/host-services/bridge-route';
import { handleOAuthBridge, oauthBridgeRequest } from '../broker';
import { __setOAuthTransport } from '../http';
import { __setOAuthStore, createMemoryOAuthStore } from '../store';
import { __setExtensionsSource } from '../providers';
import { __setRefreshLock } from '../tokens';

const CAL = 'https://www.googleapis.com/auth/calendar';
const CONTACTS = 'https://www.googleapis.com/auth/contacts.readonly';
const googleLib = () => ({
    id: 'core-googlelib',
    settings: { config: { GOOGLE_CLIENT_ID: 'cid-123' } },
    template: {
        id: 'core-googlelib', version: '1.0.0',
        settingsSchema: { fields: [{ key: 'GOOGLE_CLIENT_ID', type: 'string', label: 'ID' }, { key: 'GOOGLE_CLIENT_SECRET', type: 'string', secret: true, label: 'S' }] },
        oauthProviders: [{
            id: 'google', displayName: 'Google', authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', revokeUrl: 'https://oauth2.googleapis.com/revoke',
            userinfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo', issuer: 'https://accounts.google.com', jwksUri: 'https://www.googleapis.com/oauth2/v3/certs', apiBase: 'https://www.googleapis.com',
            allowedHosts: ['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com'],
            scopes: [{ id: 'openid', group: 'userinfo', es: 'a', en: 'a', risk: 'low' }, { id: CAL, group: 'calendar', es: 'c', en: 'c', risk: 'high' }, { id: CONTACTS, group: 'contacts', es: 'p', en: 'p', risk: 'medium' }],
            pkce: true, clientIdSetting: 'GOOGLE_CLIENT_ID', clientSecretCredential: 'GOOGLE_CLIENT_SECRET', redirectPath: '/api/auth/callback/google',
            actions: [
                { id: 'calendar.events.list', group: 'calendar', method: 'GET', path: '/calendar/v3/calendars/{calendarId}/events', requiresScopes: [CAL], maxResponseBytes: 2000,
                    params: { calendarId: { in: 'path', type: 'string', required: true, pattern: '^[A-Za-z0-9_.@-]{1,200}$' }, timeMin: { in: 'query', type: 'string', maxLength: 40 } } },
                { id: 'calendar.events.insert', group: 'calendar', method: 'POST', path: '/calendar/v3/calendars/{calendarId}/events', write: true, requiresScopes: [CAL],
                    params: { calendarId: { in: 'path', type: 'string', required: true, pattern: '^[A-Za-z0-9_.@-]{1,200}$' }, summary: { in: 'body', type: 'string', maxLength: 200 } } },
                { id: 'contacts.list', group: 'contacts', method: 'GET', path: '/people/v1/people/me/connections', requiresScopes: [CONTACTS] },
            ],
        }],
    },
});

let google: FakeGoogle;
let fake: ReturnType<typeof createFakePrisma>;
let apiCalls: Array<{ url: string; method: string; auth: string | null; body: string | undefined }>;
let apiHandler: (url: URL, init: any) => Response;
const deps: BridgeDeps & { allow: boolean } = {
    allow: true,
    verify: async (req: NextRequest) => (req.headers.get('x-test-sig') === 'ok' ? { ok: true, userId: req.headers.get('x-user-id') } : { ok: false, reason: 'invalid' }),
    rateLimit: async () => ({ ok: true, retryAfter: 0 }),
    userExists: async () => true,
} as never;

const call = (req: any, grantedGroups = ['calendar', 'contacts'], over: Record<string, unknown> = {}) =>
    handleOAuthBridge({ rateLimit: async () => ({ ok: true, retryAfter: 0 }) }, oauthBridgeRequest.parse({ op: 'call', userId: 'u1', extensionId: 'google-meet', grantedGroups, args: req, ...over }));
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e: any) { return e?.code ?? e?.message; } };

beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ENCRYPTION_KEY', 'unit-test-key-0123456789abcdef0123456789');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'csecret-xyz');
    google = new FakeGoogle({ clientId: 'cid-123', clientSecret: 'csecret-xyz' });
    await google.init();
    apiCalls = [];
    apiHandler = (url) => new Response(JSON.stringify({ items: [{ id: 'e1', summary: 'Reunion' }], path: url.pathname }), { status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'secret=1', 'x-goog-internal': 'dato-interno' } });
    __setOAuthTransport(((url: string, init: any) => {
        const u = new URL(url);
        if (u.host === 'www.googleapis.com' && (u.pathname.startsWith('/calendar') || u.pathname.startsWith('/people'))) {
            apiCalls.push({ url, method: init.method, auth: init.headers.Authorization ?? null, body: init.body });
            return Promise.resolve(apiHandler(u, init));
        }
        return google.transport(url, init);
    }) as never, async () => ['142.250.1.1']);
    __setOAuthStore(createMemoryOAuthStore());
    __setExtensionsSource(async () => [googleLib()]);
    __setRefreshLock((async (_id: string, fn: () => Promise<unknown>) => fn()) as never);
    fake = createFakePrisma();
    h.prisma = fake.prisma;
    h.audits = [];
    fake.accounts.push({ id: 'acc1', userId: 'u1', type: 'oauth', provider: 'google', providerAccountId: 'g1', access_token: 'at-secret-1', refresh_token: 'rt-secret-1', id_token: null, expires_at: Math.floor(Date.now() / 1000) + 3000, scope: `openid email profile ${CAL} ${CONTACTS}`, token_type: 'Bearer' });
    google.refreshTokens.set('rt-secret-1', { sub: 'g1', scope: `openid ${CAL}` });
});
afterEach(() => {
    __setOAuthTransport(null);
    __setOAuthStore(null);
    __setExtensionsSource(null);
    __setRefreshLock(null);
    vi.unstubAllEnvs();
});

describe('intermediario OAuth: acciones', () => {
    it('ejecuta una accion declarada con el token del usuario y devuelve SOLO { status, data }', async () => {
        const out = (await call({ provider: 'google', action: 'calendar.events.list', params: { calendarId: 'primary', timeMin: '2026-01-01T00:00:00Z' } })) as any;
        expect(out.status).toBe(200);
        expect(out.data.items[0].summary).toBe('Reunion');
        expect(Object.keys(out).sort()).toEqual(['data', 'status']);
        const sent = apiCalls[0];
        expect(sent.url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=2026-01-01T00%3A00%3A00Z');
        expect(sent.auth).toBe('Bearer at-secret-1');
        // Ni el token, ni el secreto, ni cabeceras del proveedor (set-cookie) llegan a la extension.
        const text = JSON.stringify(out);
        for (const secret of ['at-secret-1', 'rt-secret-1', 'csecret-xyz', 'secret=1', 'dato-interno']) expect(text).not.toContain(secret);
    });

    it('escritura con cuerpo JSON validado; el cuerpo no declarado se rechaza', async () => {
        await call({ provider: 'google', action: 'calendar.events.insert', params: { calendarId: 'primary', summary: 'Nueva' } });
        expect(apiCalls[0].method).toBe('POST');
        expect(JSON.parse(apiCalls[0].body!)).toEqual({ summary: 'Nueva' });
        expect(await code(call({ provider: 'google', action: 'calendar.events.insert', params: { calendarId: 'primary', summary: 'x', attendees: ['a'] } }))).toBe('invalid_args');
        expect(apiCalls.length).toBe(1);
    });

    it('MINIMO PRIVILEGIO: sin el grupo en grantedGroups => forbidden y NO se llama al proveedor ni se lee el token', async () => {
        expect(await code(call({ provider: 'google', action: 'contacts.list', params: {} }, ['calendar']))).toBe('forbidden');
        expect(await code(call({ provider: 'google', action: 'calendar.events.list', params: { calendarId: 'primary' } }, []))).toBe('forbidden');
        expect(apiCalls.length).toBe(0);
    });

    it('accion inexistente, parametros no declarados o con inyeccion de ruta => invalid_args (nada sale)', async () => {
        for (const p of [
            { provider: 'google', action: 'calendar.events.delete', params: { calendarId: 'primary' } },
            { provider: 'google', action: 'calendar.events.list', params: { calendarId: 'primary', evil: 'x' } },
            { provider: 'google', action: 'calendar.events.list', params: { calendarId: '../../admin' } },
            { provider: 'google', action: 'calendar.events.list', params: { calendarId: 'a/b' } },
            { provider: 'google', action: 'calendar.events.list', params: { calendarId: 'a?x=1' } },
            { provider: 'google', action: 'calendar.events.list', params: {} },
            { provider: 'google', action: 'calendar.events.list', params: { calendarId: 'primary', timeMin: 'x'.repeat(100) } },
        ]) expect(await code(call(p)), JSON.stringify(p)).toBe('invalid_args');
        expect(apiCalls.length).toBe(0);
    });

    it('scope no concedido a la cuenta => scope_missing; cuenta ajena o inexistente => not_linked', async () => {
        fake.accounts[0].scope = 'openid email';
        expect(await code(call({ provider: 'google', action: 'calendar.events.list', params: { calendarId: 'primary' } }))).toBe('scope_missing');
        fake.accounts[0].scope = `openid ${CAL}`;
        expect(await code(call({ provider: 'google', action: 'calendar.events.list', params: { calendarId: 'primary' }, accountId: 'acc-de-otro' }))).toBe('not_linked');
        fake.accounts.push({ id: 'accU2', userId: 'u2', type: 'oauth', provider: 'google', providerAccountId: 'g2', access_token: 'at-u2', refresh_token: 'rt-u2', id_token: null, expires_at: Math.floor(Date.now() / 1000) + 3000, scope: CAL, token_type: null });
        expect(await code(call({ provider: 'google', action: 'calendar.events.list', params: { calendarId: 'primary' }, accountId: 'accU2' }))).toBe('not_linked');
        expect(apiCalls.filter((c) => c.auth === 'Bearer at-u2').length).toBe(0);
        expect(await code(call({ provider: 'google', action: 'calendar.events.list', params: { calendarId: 'primary' } }, ['calendar'], { userId: 'sin-cuenta' }))).toBe('not_linked');
    });

    it('proveedor desconocido => not_found; sin credenciales => not_configured; sin acciones (integrado) => invalid_args', async () => {
        expect(await code(call({ provider: 'nope', action: 'a.b', params: {} }))).toBe('not_found');
        __setExtensionsSource(async () => []);
        vi.stubEnv('GOOGLE_CLIENT_ID', 'cid-123');
        expect(await code(call({ provider: 'google', action: 'calendar.events.list', params: { calendarId: 'primary' } }))).toBe('invalid_args');
        vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
        vi.stubEnv('GOOGLE_CLIENT_ID', '');
        __setExtensionsSource(async () => [{ ...googleLib(), settings: { config: {} } }]);
        expect(await code(call({ provider: 'google', action: 'calendar.events.list', params: { calendarId: 'primary' } }))).toBe('not_configured');
    });

    it('token caducado: refresca UNA vez y reintenta; 401 del API con token valido => fuerza refresco y reintenta una sola vez', async () => {
        fake.accounts[0].expires_at = 1;
        await call({ provider: 'google', action: 'calendar.events.list', params: { calendarId: 'primary' } });
        expect(google.refreshCount).toBe(1);
        expect(apiCalls[0].auth).toMatch(/^Bearer at-/);
        expect(apiCalls[0].auth).not.toBe('Bearer at-secret-1');

        let n = 0;
        apiHandler = () => (++n === 1 ? new Response('{"error":"unauthorized"}', { status: 401 }) : new Response('{"ok":true}', { status: 200 }));
        fake.accounts[0].expires_at = Math.floor(Date.now() / 1000) + 3000;
        const out = (await call({ provider: 'google', action: 'calendar.events.list', params: { calendarId: 'primary' } })) as any;
        expect(out.status).toBe(200);
        expect(google.refreshCount).toBe(2);
        n = -10;
        apiHandler = () => new Response('{"error":"unauthorized"}', { status: 401 });
        const still = (await call({ provider: 'google', action: 'calendar.events.list', params: { calendarId: 'primary' } })) as any;
        expect(still.status).toBe(401); // se informa tal cual, sin bucle de reintentos
    });

    it('refresh_token revocado (invalid_grant) => reconnect_required y la cuenta queda sin tokens', async () => {
        fake.accounts[0].expires_at = 1;
        google.failRefreshWith = 'invalid_grant';
        expect(await code(call({ provider: 'google', action: 'calendar.events.list', params: { calendarId: 'primary' } }))).toBe('reconnect_required');
        expect(fake.accounts[0].refresh_token).toBeNull();
    });

    it('respuesta mas grande que el tope de la accion => quota_exceeded; errores del proveedor (500) se informan como estado', async () => {
        apiHandler = () => new Response('x'.repeat(5000), { status: 200 });
        expect(await code(call({ provider: 'google', action: 'calendar.events.list', params: { calendarId: 'primary' } }))).toBe('quota_exceeded');
        apiHandler = () => new Response('{"error":"backend"}', { status: 503 });
        expect(((await call({ provider: 'google', action: 'calendar.events.list', params: { calendarId: 'primary' } })) as any).status).toBe(503);
    });

    it('cuotas: lectura 120/min y escritura 30/min por usuario+extension+proveedor', async () => {
        const counts = new Map<string, number>();
        const rate = async (key: string, limit: number) => { const n = (counts.get(key) ?? 0) + 1; counts.set(key, n); return n > limit ? { ok: false, retryAfter: 7 } : { ok: true, retryAfter: 0 }; };
        const run = (action: string, params: Record<string, unknown>) =>
            handleOAuthBridge({ rateLimit: rate as never }, oauthBridgeRequest.parse({ op: 'call', userId: 'u1', extensionId: 'x', grantedGroups: ['calendar'], args: { provider: 'google', action, params } }));
        for (let i = 0; i < 30; i++) await run('calendar.events.insert', { calendarId: 'primary' });
        expect(await code(run('calendar.events.insert', { calendarId: 'primary' }))).toBe('rate_limited');
        await run('calendar.events.list', { calendarId: 'primary' }); // lectura: otro cubo
    });

    it('auditoria: quien/que/resultado, sin parametros ni tokens', async () => {
        await call({ provider: 'google', action: 'calendar.events.list', params: { calendarId: 'secreto-calendario', timeMin: 'x' } });
        const a = h.audits.find((x) => x.event === 'oauth.action')!;
        expect(a.data).toMatchObject({ userId: 'u1', extensionId: 'google-meet', provider: 'google', action: 'calendar.events.list', group: 'calendar', write: false, status: 200 });
        expect(JSON.stringify(a)).not.toMatch(/secreto-calendario|at-secret|rt-secret|csecret/);
    });

    it('accounts: solo id, grupos y estado (nunca tokens, ni scopes crudos)', async () => {
        const out = (await handleOAuthBridge({ rateLimit: async () => ({ ok: true, retryAfter: 0 }) }, oauthBridgeRequest.parse({ op: 'accounts', userId: 'u1', extensionId: 'x', grantedGroups: [], args: { provider: 'google' } }))) as any[];
        expect(out).toEqual([{ id: 'acc1', provider: 'google', groups: ['calendar', 'contacts', 'userinfo'], status: 'active' }]);
        fake.accounts[0].access_token = null; fake.accounts[0].refresh_token = null;
        const again = (await handleOAuthBridge({ rateLimit: async () => ({ ok: true, retryAfter: 0 }) }, oauthBridgeRequest.parse({ op: 'accounts', userId: 'u1', extensionId: 'x', grantedGroups: [], args: { provider: 'google' } }))) as any[];
        expect(again[0].status).toBe('needs-reconnect');
    });
});

describe('ruta /api/internal/host/oauth (autenticacion y forma)', () => {
    const route = createBridgeHandler({ service: 'oauth', schema: oauthBridgeRequest, deps: deps as never, handle: (r) => handleOAuthBridge({ rateLimit: async () => ({ ok: true, retryAfter: 0 }) }, r) });
    const body = (over: Record<string, unknown> = {}) => JSON.stringify({ op: 'call', userId: 'u1', extensionId: 'google-meet', grantedGroups: ['calendar'], args: { provider: 'google', action: 'calendar.events.list', params: { calendarId: 'primary' } }, ...over });
    const post = (raw: string, headers: Record<string, string> = { 'x-test-sig': 'ok', 'x-user-id': 'u1' }) => route(new NextRequest('https://inst.test/api/internal/host/oauth', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw }));

    it('200 con firma valida; 401 sin firma o con userId distinto al firmado; 400 con claves desconocidas', async () => {
        const ok = await post(body());
        expect(ok.status).toBe(200);
        expect(((await ok.json()) as any).data.status).toBe(200);
        expect((await post(body(), {})).status).toBe(401);
        expect((await post(body(), { 'x-test-sig': 'ok', 'x-user-id': 'otro' })).status).toBe(401);
        expect((await post(body({ extra: 1 }))).status).toBe(400);
        expect((await post(body({ args: { provider: 'google', action: 'calendar.events.list', params: {}, token: 'x' } }))).status).toBe(400);
        expect((await post('not json')).status).toBe(400);
    });

    it('errores tipados con su estado HTTP y SIN detalles internos', async () => {
        const forbidden = await post(body({ grantedGroups: [] }));
        expect(forbidden.status).toBe(403);
        expect(await forbidden.json()).toEqual({ error: 'Forbidden', code: 'forbidden' });
        fake.accounts[0].scope = 'openid';
        const scope = await post(body());
        expect(scope.status).toBe(403);
        expect(((await scope.json()) as any).code).toBe('scope_missing');
        fake.accounts.length = 0;
        const nl = await post(body());
        expect(nl.status).toBe(404);
        expect(((await nl.json()) as any).code).toBe('not_linked');
    });
});
