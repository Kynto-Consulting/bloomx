import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportPKCS8, exportSPKI, generateKeyPair, importSPKI, jwtVerify } from 'jose';
import { createFakePrisma } from './harness';

const h = vi.hoisted(() => ({ prisma: null as any }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return h.prisma; } }));
vi.mock('@/lib/db/pool', () => ({ getDbPool: () => { throw new Error('no db'); } }));
vi.mock('@/lib/security', async () => {
    const actual = await vi.importActual<typeof import('@/lib/security')>('@/lib/security');
    return { ...actual, auditLog: vi.fn() };
});

import { handleOAuthBridge, oauthBridgeRequest, buildMultipart } from '../broker';
import { __setOAuthTransport } from '../http';
import { __setOAuthStore, createMemoryOAuthStore } from '../store';
import { __setExtensionsSource, getProvider, saveProviderSecret, saveSharedCredential } from '../providers';
import { __resetPrincipalCache, parseServiceAccount, sharedScopesAllowed } from '../principals';
import { __setRefreshLock } from '../tokens';

const CAL = 'https://www.googleapis.com/auth/calendar';
const MEET = 'https://www.googleapis.com/auth/meetings.space.created';
const DRIVE = 'https://www.googleapis.com/auth/drive.file';

const lib = () => ({
    id: 'core-googlelib',
    settings: { config: { GOOGLE_CLIENT_ID: 'cid-123', GOOGLE_IMPERSONATE_USER: 'org@acme.test', GOOGLE_AUTH_MODE: 'service-account' } },
    template: {
        id: 'core-googlelib', version: '1.0.0',
        settingsSchema: { fields: [
            { key: 'GOOGLE_CLIENT_ID', type: 'string', label: 'ID' }, { key: 'GOOGLE_CLIENT_SECRET', type: 'string', secret: true, label: 'S' },
            { key: 'GOOGLE_SERVICE_ACCOUNT_JSON', type: 'string', secret: true, label: 'SA' }, { key: 'GOOGLE_ORGANIZER_REFRESH_TOKEN', type: 'string', secret: true, label: 'R' },
            { key: 'GOOGLE_IMPERSONATE_USER', type: 'string', label: 'I' }, { key: 'GOOGLE_ORGANIZER_EMAIL', type: 'string', label: 'E' }, { key: 'GOOGLE_AUTH_MODE', type: 'string', label: 'M' },
        ] },
        oauthProviders: [{
            id: 'google', displayName: 'Google', authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', revokeUrl: 'https://oauth2.googleapis.com/revoke',
            userinfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo', issuer: 'https://accounts.google.com', jwksUri: 'https://www.googleapis.com/oauth2/v3/certs', apiBase: 'https://www.googleapis.com',
            allowedHosts: ['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com', 'meet.googleapis.com'],
            scopes: [{ id: 'openid', group: 'userinfo', es: 'a', en: 'a', risk: 'low' }, { id: CAL, group: 'calendar', es: 'c', en: 'c', risk: 'high' }, { id: MEET, group: 'meet', es: 'm', en: 'm', risk: 'medium' }, { id: DRIVE, group: 'drive', es: 'd', en: 'd', risk: 'medium' }],
            pkce: true, clientIdSetting: 'GOOGLE_CLIENT_ID', clientSecretCredential: 'GOOGLE_CLIENT_SECRET', redirectPath: '/api/auth/callback/google',
            principals: { serviceAccountJson: 'GOOGLE_SERVICE_ACCOUNT_JSON', organizerRefreshToken: 'GOOGLE_ORGANIZER_REFRESH_TOKEN', impersonateUser: 'GOOGLE_IMPERSONATE_USER', organizerEmail: 'GOOGLE_ORGANIZER_EMAIL', authMode: 'GOOGLE_AUTH_MODE' },
            actions: [
                { id: 'calendar.events.insert', group: 'calendar', method: 'POST', write: true, path: '/calendar/v3/calendars/{calendarId}/events', requiresScopes: [CAL], bodyFrom: 'event',
                    params: { calendarId: { in: 'path', type: 'string', required: true, pattern: '^[A-Za-z0-9_.@-]{1,200}$' }, conferenceDataVersion: { in: 'query', type: 'integer', min: 0, max: 1 }, event: { in: 'body', type: 'object', required: true } } },
                { id: 'meet.spaces.create', group: 'meet', method: 'POST', write: true, apiBase: 'https://meet.googleapis.com', path: '/v2/spaces', requiresScopes: [MEET], bodyFrom: 'space', params: { space: { in: 'body', type: 'object' } } },
                { id: 'drive.files.upload', group: 'drive', method: 'POST', write: true, path: '/upload/drive/v3/files', fixedQuery: { uploadType: 'multipart', fields: 'id,name,webViewLink' }, requiresScopes: [DRIVE],
                    upload: { metadata: 'metadata', content: 'content', mimeType: 'mimeType' },
                    params: { metadata: { in: 'body', type: 'object', required: true }, content: { in: 'body', type: 'string', required: true, maxLength: 900000 }, mimeType: { in: 'body', type: 'string', maxLength: 100 } } },
            ],
        }],
    },
});

let calls: Array<{ url: string; method: string; auth: string | null; body?: string; ct?: string; form?: Record<string, string> }>;
let tokenMints: number;
let saPublic: Awaited<ReturnType<typeof importSPKI>>;
let saJson: string;
let assertions: any[];
const orgScopes = `${CAL} ${MEET} ${DRIVE}`;

const call = (args: any, over: Record<string, unknown> = {}) =>
    handleOAuthBridge({ rateLimit: async () => ({ ok: true, retryAfter: 0 }) }, oauthBridgeRequest.parse({ op: 'call', userId: 'u1', extensionId: 'google-meet', grantedGroups: ['calendar', 'meet', 'drive'], sharedAllowed: true, args, ...over }));
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e: any) { return e?.code ?? e?.message; } };

beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ENCRYPTION_KEY', 'unit-test-key-0123456789abcdef0123456789');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'csecret-xyz');
    const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
    saPublic = await importSPKI(await exportSPKI(publicKey), 'RS256');
    saJson = JSON.stringify({ type: 'service_account', client_email: 'svc@proj.iam.gserviceaccount.com', private_key: await exportPKCS8(privateKey), project_id: 'proj' });
    calls = []; tokenMints = 0; assertions = [];
    __resetPrincipalCache();
    __setOAuthTransport((async (url: string, init: any) => {
        const u = new URL(url);
        const form = init.body && /x-www-form-urlencoded/.test(init.headers['Content-Type'] ?? '') ? Object.fromEntries(new URLSearchParams(init.body)) : undefined;
        calls.push({ url, method: init.method, auth: init.headers.Authorization ?? null, body: form ? undefined : init.body, ct: init.headers['Content-Type'], form });
        const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
        if (u.host === 'oauth2.googleapis.com' && u.pathname === '/token') {
            tokenMints += 1;
            if (form!.grant_type === 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
                try {
                    const { payload } = await jwtVerify(form!.assertion, saPublic, { audience: 'https://oauth2.googleapis.com/token', issuer: 'svc@proj.iam.gserviceaccount.com', algorithms: ['RS256'] });
                    assertions.push(payload);
                } catch { return json(400, { error: 'invalid_grant' }); }
                return json(200, { access_token: `svc-at-${tokenMints}`, expires_in: 3599, scope: orgScopes });
            }
            if (form!.grant_type === 'refresh_token') {
                if (form!.refresh_token !== 'org-refresh' || form!.client_id !== 'cid-123' || form!.client_secret !== 'csecret-xyz') return json(400, { error: 'invalid_grant' });
                return json(200, { access_token: `org-at-${tokenMints}`, expires_in: 3599, scope: orgScopes });
            }
        }
        return json(200, { ok: true, ...(init.method === 'POST' ? { id: 'created' } : {}) });
    }) as never, async () => ['142.250.1.1']);
    __setOAuthStore(createMemoryOAuthStore());
    __setExtensionsSource(async () => [lib()]);
    __setRefreshLock((async (_id: string, fn: () => Promise<unknown>) => fn()) as never);
    h.prisma = createFakePrisma().prisma;
});
afterEach(() => {
    __setOAuthTransport(null); __setOAuthStore(null); __setExtensionsSource(null); __setRefreshLock(null); vi.unstubAllEnvs();
});

describe('identidades compartidas (organizador / cuenta de servicio)', () => {
    it('cuenta de servicio: firma el JWT RS256 en el NUCLEO (iss, sub=impersonateUser, aud=tokenUrl, scope de la accion) y usa su access token', async () => {
        const p = (await getProvider('google'))!;
        await saveSharedCredential(p, 'GOOGLE_SERVICE_ACCOUNT_JSON', saJson, 'admin');
        const out = (await call({ provider: 'google', action: 'calendar.events.insert', params: { calendarId: 'primary', event: { summary: 'Hola', attendees: [{ email: 'a@x.test' }] } }, principal: 'service' })) as any;
        expect(out.status).toBe(200);
        expect(assertions[0]).toMatchObject({ iss: 'svc@proj.iam.gserviceaccount.com', sub: 'org@acme.test', aud: 'https://oauth2.googleapis.com/token', scope: CAL });
        const api = calls.find((c) => c.url.includes('/calendar/v3/'))!;
        expect(api.auth).toBe('Bearer svc-at-1');
        expect(JSON.parse(api.body!)).toEqual({ summary: 'Hola', attendees: [{ email: 'a@x.test' }] });
        // El JSON de la cuenta de servicio y su clave privada JAMAS salen del nucleo.
        expect(JSON.stringify(out)).not.toMatch(/PRIVATE KEY|svc@proj|svc-at/);
    });

    it('organizador: refresh_token del dominio + client OAuth; el access token se cachea (un solo canje para varias llamadas)', async () => {
        const p = (await getProvider('google'))!;
        await saveSharedCredential(p, 'GOOGLE_ORGANIZER_REFRESH_TOKEN', 'org-refresh', 'admin');
        await call({ provider: 'google', action: 'calendar.events.insert', params: { calendarId: 'primary', event: { summary: 'a' } }, principal: 'organizer' });
        await call({ provider: 'google', action: 'calendar.events.insert', params: { calendarId: 'primary', event: { summary: 'b' } }, principal: 'organizer' });
        expect(tokenMints).toBe(1);
        expect(calls.filter((c) => c.url.includes('/calendar/v3/')).every((c) => c.auth === 'Bearer org-at-1')).toBe(true);
    });

    it('MINIMO PRIVILEGIO: sin OAUTH_SHARED (sharedAllowed) => forbidden y NO se canjea ninguna credencial; con accountId => invalid_args', async () => {
        const p = (await getProvider('google'))!;
        await saveSharedCredential(p, 'GOOGLE_SERVICE_ACCOUNT_JSON', saJson, 'admin');
        const args = { provider: 'google', action: 'calendar.events.insert', params: { calendarId: 'primary', event: {} }, principal: 'service' };
        expect(await code(call(args, { sharedAllowed: false }))).toBe('forbidden');
        expect(await code(call(args, { sharedAllowed: undefined }))).toBe('forbidden');
        expect(await code(call({ ...args, accountId: 'acc1' }))).toBe('invalid_args');
        expect(tokenMints).toBe(0);
    });

    it('sin credenciales compartidas o sin impersonateUser => not_configured; JSON de cuenta de servicio malformado se rechaza al guardar', async () => {
        expect(await code(call({ provider: 'google', action: 'calendar.events.insert', params: { calendarId: 'primary', event: {} }, principal: 'service' }))).toBe('not_configured');
        expect(await code(call({ provider: 'google', action: 'calendar.events.insert', params: { calendarId: 'primary', event: {} }, principal: 'organizer' }))).toBe('not_configured');
        expect(parseServiceAccount('no json')).toBeNull();
        expect(parseServiceAccount(JSON.stringify({ type: 'authorized_user' }))).toBeNull();
        expect(parseServiceAccount(JSON.stringify({ type: 'service_account', client_email: 'a@b.c', private_key: 'x' }))).toBeNull();
        expect(parseServiceAccount('x'.repeat(20_000))).toBeNull();
        expect(parseServiceAccount(saJson)).toMatchObject({ client_email: 'svc@proj.iam.gserviceaccount.com' });
    });

    it('credenciales ancladas: si cambian los hosts de los endpoints dejan de usarse (hay que reaprobar)', async () => {
        const p = (await getProvider('google'))!;
        await saveSharedCredential(p, 'GOOGLE_SERVICE_ACCOUNT_JSON', saJson, 'admin');
        const swapped = lib();
        (swapped.template.oauthProviders[0] as any).tokenUrl = 'https://evil-oauth.example.com/token';
        (swapped.template.oauthProviders[0] as any).allowedHosts.push('evil-oauth.example.com');
        __setExtensionsSource(async () => [swapped]);
        expect(await code(call({ provider: 'google', action: 'calendar.events.insert', params: { calendarId: 'primary', event: {} }, principal: 'service' }))).toBe('not_configured');
        expect(calls.filter((c) => c.url.includes('evil-oauth'))).toHaveLength(0);
    });

    it('principals: solo revela la configuracion compartida a quien tiene OAUTH_SHARED', async () => {
        const p = (await getProvider('google'))!;
        await saveSharedCredential(p, 'GOOGLE_SERVICE_ACCOUNT_JSON', saJson, 'admin');
        const ask = (sharedAllowed: boolean) => handleOAuthBridge({ rateLimit: async () => ({ ok: true, retryAfter: 0 }) }, oauthBridgeRequest.parse({ op: 'principals', userId: 'u1', extensionId: 'x', grantedGroups: [], sharedAllowed, args: { provider: 'google' } }));
        expect(await ask(true)).toEqual({ user: 0, organizer: false, service: true, mode: 'service-account', accounts: { organizerEmail: '', impersonateUser: 'org@acme.test' } });
        expect(await ask(false)).toEqual({ user: 0, organizer: false, service: false, mode: '', accounts: { organizerEmail: '', impersonateUser: '' } });
    });

    it('el client secret y las credenciales compartidas se guardan CIFRADAS y nunca en claro', async () => {
        const store = createMemoryOAuthStore();
        __setOAuthStore(store);
        const p = (await getProvider('google'))!;
        await saveProviderSecret(p, 'client-secret-en-claro', 'admin');
        await saveSharedCredential((await getProvider('google'))!, 'GOOGLE_ORGANIZER_REFRESH_TOKEN', 'refresh-en-claro', 'admin');
        const row = store.configs.get('google')!;
        expect(JSON.stringify(row)).not.toMatch(/client-secret-en-claro|refresh-en-claro/);
        expect(row.clientSecret).toMatch(/^v3:/);
        expect(row.extra.GOOGLE_ORGANIZER_REFRESH_TOKEN).toMatch(/^v3:/);
        // Guardar una credencial compartida conserva el client secret y viceversa.
        await saveSharedCredential((await getProvider('google'))!, 'GOOGLE_SERVICE_ACCOUNT_JSON', saJson, 'admin');
        expect(store.configs.get('google')!.clientSecret).toBe(row.clientSecret);
        await saveProviderSecret((await getProvider('google'))!, 'otro-client-secret', 'admin');
        expect(Object.keys(store.configs.get('google')!.extra).sort()).toEqual(['GOOGLE_ORGANIZER_REFRESH_TOKEN', 'GOOGLE_SERVICE_ACCOUNT_JSON']);
    });
});

describe('acciones: apiBase propia, bodyFrom y subida multipart', () => {
    beforeEach(async () => {
        const p = (await getProvider('google'))!;
        await saveSharedCredential(p, 'GOOGLE_ORGANIZER_REFRESH_TOKEN', 'org-refresh', 'admin');
    });

    it('apiBase por accion (Meet): se llama a meet.googleapis.com con el cuerpo completo del parametro bodyFrom', async () => {
        await call({ provider: 'google', action: 'meet.spaces.create', params: { space: { config: { accessType: 'OPEN' } } }, principal: 'organizer' });
        const c = calls.find((x) => x.url.startsWith('https://meet.googleapis.com/'))!;
        expect(c.url).toBe('https://meet.googleapis.com/v2/spaces');
        expect(JSON.parse(c.body!)).toEqual({ config: { accessType: 'OPEN' } });
    });

    it('subida multipart/related: metadatos JSON + contenido base64 (sin romper el limite ni inyectar cabeceras)', () => {
        const ok = buildMultipart({ name: 'a.txt' }, 'SGVsbG8=', 'text/plain');
        expect(ok.contentType).toMatch(/^multipart\/related; boundary="bloomx[0-9a-f]{24}"$/);
        expect(ok.body).toContain('Content-Type: application/json; charset=UTF-8');
        expect(ok.body).toContain('{"name":"a.txt"}');
        expect(ok.body).toContain('Content-Transfer-Encoding: base64\r\n\r\nSGVsbG8=');
        const evil = buildMultipart({ name: 'x' }, 'AAAA\r\nX-Evil: 1', 'text/plain\r\nX-Evil: 1');
        expect(evil.body.includes('\r\nX-Evil')).toBe(false);
        expect(evil.body).toContain('application/octet-stream');
    });

    it('M5: una identidad COMPARTIDA no puede pedir scopes de Drive/Gmail (lista fija); sin llamar al proveedor', async () => {
        const before = calls.length;
        expect(await code(call({ provider: 'google', action: 'drive.files.upload', params: { metadata: { name: 'a.txt' }, content: 'SGVsbG8=', mimeType: 'text/plain' }, principal: 'organizer' }))).toBe('scope_missing');
        expect(calls.length).toBe(before);
        const p = (await getProvider('google'))!;
        expect(sharedScopesAllowed(p, [CAL, MEET])).toBe(true);
        expect(sharedScopesAllowed(p, ['https://www.googleapis.com/auth/gmail.readonly'])).toBe(false);
        expect(sharedScopesAllowed(p, ['https://www.googleapis.com/auth/drive'])).toBe(false);
        expect(sharedScopesAllowed(p, ['scope-que-no-esta-en-el-catalogo'])).toBe(false);
    });

    it('limites: contenido enorme => invalid_args; el cuerpo de un parametro bodyFrom no puede superar el tope', async () => {
        expect(await code(call({ provider: 'google', action: 'drive.files.upload', params: { metadata: { name: 'a' }, content: 'A'.repeat(950_000) }, principal: 'organizer' }))).toBe('invalid_args');
        expect(await code(call({ provider: 'google', action: 'calendar.events.insert', params: { calendarId: 'primary', event: { description: 'x'.repeat(1_100_000) } }, principal: 'organizer' }))).toBe('invalid_args');
    });

    it('un parametro de ruta no puede reescribir el host ni la ruta; la query fija (uploadType) no se puede sobrescribir', async () => {
        expect(await code(call({ provider: 'google', action: 'calendar.events.insert', params: { calendarId: '..%2F..%2Fadmin', event: {} }, principal: 'organizer' }))).toBe('invalid_args');
        expect(await code(call({ provider: 'google', action: 'drive.files.upload', params: { metadata: {}, content: 'AA==', uploadType: 'media' }, principal: 'organizer' }))).toBe('invalid_args');
    });
});

void generateKeyPairSync;
