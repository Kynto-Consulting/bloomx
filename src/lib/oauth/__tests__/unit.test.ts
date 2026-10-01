import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePrisma, FakeGoogle } from './harness';

const h = vi.hoisted(() => ({ prisma: null as any }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return h.prisma; } }));
vi.mock('@/lib/db/pool', () => ({ getDbPool: () => { throw new Error('no db'); } }));

import { codeChallengeS256, generateCodeVerifier, isValidCodeVerifier, PKCE_METHOD } from '../pkce';
import { __setOAuthTransport, isPrivateAddress, makePinnedLookup, providerFetch, ProviderHttpError } from '../http';
import { __setOAuthStore, createMemoryOAuthStore } from '../store';
import {
    __setExtensionsSource, accountMatchesProvider, approveProviderHosts, attachCredentials, endpointHostsOf, invalidateProviderCache, providerIdentityHash, getProvider, listProviderSummaries, loadProviders, parseExtensionProviders, providerScopeGroups, saveProviderSecret, usesOfficialEndpoints,
} from '../providers';
import { __setRefreshLock, getAccessToken, grantedScopeSet, OAuthAccountError, pickAccount, revokeAtProvider } from '../tokens';
import { unlinkUserProvider } from '../unlink';

vi.mock('@/lib/security', async () => {
    const actual = await vi.importActual<typeof import('@/lib/security')>('@/lib/security');
    return { ...actual, auditLog: vi.fn() };
});

beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ENCRYPTION_KEY', 'unit-test-key-0123456789abcdef0123456789');
    vi.stubEnv('GOOGLE_CLIENT_ID', 'cid-123');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'csecret-xyz');
    __setOAuthStore(createMemoryOAuthStore());
    __setExtensionsSource(async () => []);
});
afterEach(() => {
    __setOAuthTransport(null);
    __setOAuthStore(null);
    __setExtensionsSource(null);
    __setRefreshLock(null);
    vi.unstubAllEnvs();
});

describe('PKCE (RFC 7636)', () => {
    it('verificador de 43 caracteres aleatorio, challenge S256 correcto y NUNCA plain', () => {
        const v = generateCodeVerifier();
        expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(generateCodeVerifier()).not.toBe(v);
        expect(codeChallengeS256(v)).toBe(createHash('sha256').update(v, 'ascii').digest('base64url'));
        expect(codeChallengeS256(v)).not.toBe(v);
        expect(PKCE_METHOD).toBe('S256');
        // vector del RFC 7636 Apendice B
        expect(codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
        expect(isValidCodeVerifier('corto')).toBe(false);
        expect(() => codeChallengeS256('corto')).toThrow();
    });
});

describe('transporte hacia el proveedor (SSRF)', () => {
    it('rechaza http, IP literal, localhost, puerto, credenciales, host fuera de allowedHosts y redes internas', async () => {
        const allowed = ['oauth2.googleapis.com'];
        for (const url of ['http://oauth2.googleapis.com/token', 'https://127.0.0.1/token', 'https://localhost/token', 'https://oauth2.googleapis.com:8443/token', 'https://u:p@oauth2.googleapis.com/token', 'https://evil.com/token', 'https://10.0.0.5/token', 'https://[::1]/token', 'https://169.254.169.254/latest']) {
            await expect(providerFetch(allowed, url)).rejects.toMatchObject({ code: 'oauth_url_rejected' });
        }
    });

    it('DNS: si el host resuelve a una direccion privada/loopback/link-local se rechaza (DNS rebinding)', async () => {
        for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.1.1', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1', 'no-es-ip']) {
            __setOAuthTransport((async () => new Response('{}')) as never, async () => ['142.250.1.1', ip]);
            await expect(providerFetch(['oauth2.googleapis.com'], 'https://oauth2.googleapis.com/token')).rejects.toMatchObject({ code: 'oauth_dns_rejected' });
        }
        expect(isPrivateAddress('142.250.1.1')).toBe(false);
        expect(isPrivateAddress('2607:f8b0:4004::1')).toBe(false);
    });

    it('B5: 6to4, NAT64, compatible-IPv4, Teredo e IPv4 mapeado en hexadecimal tambien son privados', () => {
        for (const ip of ['2002:7f00:1::1', '2002:0a00:1::1', '64:ff9b::7f00:1', '64:ff9b:1::1', '::7f00:1', '::10.0.0.1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '::ffff:7f00:1', '::ffff:a00:1']) expect(isPrivateAddress(ip), ip).toBe(true);
        expect(isPrivateAddress('::ffff:8efa:101')).toBe(false); // 142.250.1.1 mapeado
    });

    it('M2: el lookup del transporte valida CADA resolucion y entrega al socket esa misma direccion (DNS rebinding entre comprobacion y conexion)', async () => {
        const answers = [['142.250.1.1'], ['127.0.0.1'], ['142.250.1.1', '10.0.0.5']];
        let call = 0;
        const lookup = makePinnedLookup(async () => answers[call++]);
        const run = (opts: unknown) => new Promise<{ err: Error | null; address?: unknown }>((resolve) => lookup('oauth2.googleapis.com', opts, (err, address) => resolve({ err, address })));
        const first = await run({});
        expect(first.err).toBeNull();
        expect(first.address).toBe('142.250.1.1');
        const second = await run({ all: true });
        expect(second.err).toMatchObject({ code: 'oauth_dns_rejected' }); // el resolver "cambio" a loopback: no se conecta
        const third = await run({ all: true });
        expect(third.err).toMatchObject({ code: 'oauth_dns_rejected' }); // basta UNA privada entre las respuestas
        const ok = await new Promise<{ address?: unknown }>((resolve) => makePinnedLookup(async () => ['142.250.1.1'])('x.googleapis.com', { all: true }, (_e, address) => resolve({ address })));
        expect(ok.address).toEqual([{ address: '142.250.1.1', family: 4 }]);
    });

    it('no sigue redirecciones, corta respuestas enormes y respeta el timeout', async () => {
        __setOAuthTransport((async () => new Response(null, { status: 302, headers: { location: 'https://evil.test/' } })) as never, async () => ['1.1.1.1']);
        await expect(providerFetch(['oauth2.googleapis.com'], 'https://oauth2.googleapis.com/token')).rejects.toMatchObject({ code: 'oauth_redirect_rejected' });
        __setOAuthTransport((async () => new Response('x'.repeat(5000))) as never, async () => ['1.1.1.1']);
        await expect(providerFetch(['oauth2.googleapis.com'], 'https://oauth2.googleapis.com/token', { maxBytes: 1000 })).rejects.toMatchObject({ code: 'oauth_response_too_large' });
        __setOAuthTransport(((_u: string, init: { signal: AbortSignal }) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))))) as never, async () => ['1.1.1.1']);
        await expect(providerFetch(['oauth2.googleapis.com'], 'https://oauth2.googleapis.com/token', { timeoutMs: 20 })).rejects.toMatchObject({ code: 'oauth_timeout' });
        expect(new ProviderHttpError('oauth_network').code).toBe('oauth_network');
    });

    it('__setOAuthTransport solo existe en tests', () => {
        vi.stubEnv('NODE_ENV', 'production');
        try { expect(() => __setOAuthTransport(null)).toThrow(); } finally { vi.stubEnv('NODE_ENV', 'test'); }
    });
});

const googleExt = (over: Record<string, unknown> = {}, settings: Record<string, unknown> = { config: { GOOGLE_CLIENT_ID: 'ext-cid' } }) => ({
    id: 'core-googlelib',
    settings,
    template: {
        id: 'core-googlelib', version: '1.0.0',
        settingsSchema: { fields: [{ key: 'GOOGLE_CLIENT_ID', type: 'string', label: 'ID' }, { key: 'GOOGLE_CLIENT_SECRET', type: 'string', secret: true, label: 'S' }] },
        oauthProviders: [{
            id: 'google', displayName: 'Google (ext)', authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', revokeUrl: 'https://oauth2.googleapis.com/revoke',
            userinfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo', issuer: 'https://accounts.google.com', jwksUri: 'https://www.googleapis.com/oauth2/v3/certs', apiBase: 'https://www.googleapis.com',
            allowedHosts: ['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com'],
            scopes: [{ id: 'openid', group: 'userinfo', es: 'a', en: 'a', risk: 'low' }, { id: 'https://www.googleapis.com/auth/calendar', group: 'calendar', es: 'c', en: 'c', risk: 'high' }],
            pkce: true, clientIdSetting: 'GOOGLE_CLIENT_ID', clientSecretCredential: 'GOOGLE_CLIENT_SECRET', redirectPath: '/api/auth/callback/google', ...over,
        }],
    },
});

describe('registro de proveedores', () => {
    it('sin extensiones: Google integrado, con las variables de entorno heredadas (nada deja de funcionar)', async () => {
        const p = (await getProvider('google'))!;
        expect(p.source).toBe('builtin');
        expect(p.status).toBe('ready');
        expect(p.clientId).toBe('cid-123');
        expect(p.clientSecret).toBe('csecret-xyz');
        expect(p.redirectPath).toBe('/api/auth/callback/google');
        expect(p.pkce).toBe(true);
        expect(await getProvider('Bad Id!')).toBeNull();
        expect(await getProvider('slack')).toBeNull();
    });

    it('una extension que registra google SUSTITUYE al integrado y usa su clientId (ajuste) con el secreto de la instancia', async () => {
        __setExtensionsSource(async () => [googleExt()]);
        const store = createMemoryOAuthStore();
        __setOAuthStore(store);
        let p = (await getProvider('google'))!;
        expect(p.source).toBe('extension');
        expect(p.extensionId).toBe('core-googlelib');
        expect(p.clientId).toBe('ext-cid');
        // endpoints oficiales => el secreto heredado del entorno sigue valiendo
        expect(p.clientSecret).toBe('csecret-xyz');
        expect(p.status).toBe('ready');
        // secreto propio de la instancia (cifrado) tiene prioridad
        await saveProviderSecret(p, 'secreto-de-la-instancia', 'admin1');
        p = (await getProvider('google'))!;
        expect(p.clientSecret).toBe('secreto-de-la-instancia');
        const row = store.configs.get('google')!;
        expect(row.clientSecret).not.toContain('secreto-de-la-instancia');
        expect(row.clientSecret).toMatch(/^v3:/);
        expect(row.approvedHosts).toEqual(endpointHostsOf(p));
    });

    it('SIN anclaje: si la extension cambia de host de endpoints el secreto aprobado NO se envia (needs_reapproval)', async () => {
        __setExtensionsSource(async () => [googleExt()]);
        const store = createMemoryOAuthStore();
        __setOAuthStore(store);
        await saveProviderSecret((await getProvider('google'))!, 'secreto-aprobado', 'admin1');
        __setExtensionsSource(async () => [googleExt({ tokenUrl: 'https://evil-oauth.example.com/token', allowedHosts: ['accounts.google.com', 'evil-oauth.example.com', 'www.googleapis.com', 'oauth2.googleapis.com'] })]);
        // (la cache se invalida al cambiar de fuente)
        const p = (await getProvider('google'))!;
        expect(p.status).toBe('needs_reapproval');
        expect(p.clientSecret).toBeNull();
    });

    it('endpoints NO oficiales: las variables de entorno heredadas NO se aplican (el secreto de Google no viaja a otro host)', async () => {
        __setExtensionsSource(async () => [googleExt({ tokenUrl: 'https://evil-oauth.example.com/token', allowedHosts: ['accounts.google.com', 'evil-oauth.example.com', 'www.googleapis.com', 'oauth2.googleapis.com'] }, { config: {} })]);
        const p = (await getProvider('google'))!;
        expect(p.clientId).toBeNull();
        expect(p.clientSecret).toBeNull();
        expect(p.status).toBe('pending_approval');
        expect(usesOfficialEndpoints('google', p.endpointHosts)).toBe(false);
        expect(usesOfficialEndpoints('google', ['accounts.google.com', 'oauth2.googleapis.com'])).toBe(true);
    });

    it('definiciones invalidas (SSRF, hosts) se descartan: solo esa extension, el integrado sigue', async () => {
        __setExtensionsSource(async () => [
            googleExt({ tokenUrl: 'http://127.0.0.1/token' }),
            { id: 'otra', settings: {}, template: { oauthProviders: [{ id: 'x', displayName: 'X', authorizeUrl: 'https://169.254.169.254/a', tokenUrl: 'https://169.254.169.254/t', allowedHosts: ['169.254.169.254'], scopes: [], pkce: true, clientIdSetting: 'A' }] } },
        ]);
        expect(parseExtensionProviders([googleExt({ tokenUrl: 'http://127.0.0.1/token' })]).size).toBe(0);
        const map = await loadProviders();
        expect(map.get('google')!.source).toBe('builtin');
        expect(map.has('x')).toBe(false);
    });

    it('dos extensiones con el mismo id (NO reservado): gana la de id menor (determinista)', () => {
        const acme = (id: string, displayName: string) => ({ id, settings: {}, template: { id, version: '1.0.0', settingsSchema: { fields: [{ key: 'A_ID', type: 'string', label: 'I' }] }, oauthProviders: [{ id: 'acme', displayName, authorizeUrl: 'https://auth.acme.com/a', tokenUrl: 'https://auth.acme.com/t', allowedHosts: ['auth.acme.com'], scopes: [{ id: 'r', group: 'g', es: 'a', en: 'a', risk: 'low' }], pkce: true, clientIdSetting: 'A_ID' }] } });
        expect(parseExtensionProviders([acme('z-lib', 'A'), acme('a-lib', 'B')]).get('acme')!.extensionId).toBe('a-lib');
    });

    it('A2: una extension AJENA no puede registrar el id "google" (ni otros reservados); la oficial si', async () => {
        const evil = { ...googleExt({ tokenUrl: 'https://evil.example.com/token', allowedHosts: ['accounts.google.com', 'evil.example.com', 'www.googleapis.com', 'oauth2.googleapis.com'] }), id: 'a-evil' };
        evil.template = { ...evil.template, id: 'a-evil' };
        expect(parseExtensionProviders([evil]).size).toBe(0);
        expect(parseExtensionProviders([googleExt()]).get('google')?.extensionId).toBe('core-googlelib');
        // aunque su id sea lexicograficamente menor, la oficial es la que queda
        expect(parseExtensionProviders([evil, googleExt()]).get('google')?.extensionId).toBe('core-googlelib');
        __setExtensionsSource(async () => [evil]);
        const p = (await getProvider('google'))!;
        expect(p.source).toBe('builtin');
        expect(p.endpointHosts).not.toContain('evil.example.com');
        const ms = { ...evil, template: { ...evil.template, oauthProviders: [{ ...evil.template.oauthProviders[0], id: 'microsoft' }] } };
        expect(parseExtensionProviders([ms]).size).toBe(0);
    });

    it('A2: un proveedor NO integrado queda en pending_approval hasta que el admin aprueba sus hosts (aunque sea PKCE publico); cambiar hosts exige reaprobar', async () => {
        const mk = (token: string) => ({ id: 'acme-lib', settings: { config: { A_ID: 'cid' } }, template: { id: 'acme-lib', version: '1.0.0', settingsSchema: { fields: [{ key: 'A_ID', type: 'string', label: 'I' }] }, oauthProviders: [{ id: 'acme', displayName: 'Acme', authorizeUrl: 'https://auth.acme.com/a', tokenUrl: token, allowedHosts: ['auth.acme.com', 'tok.acme.com'], scopes: [{ id: 'r', group: 'g', es: 'a', en: 'a', risk: 'low' }], pkce: true, clientIdSetting: 'A_ID' }] } });
        __setExtensionsSource(async () => [mk('https://auth.acme.com/t')]);
        expect((await getProvider('acme'))!.status).toBe('pending_approval');
        await approveProviderHosts((await getProvider('acme'))!, 'admin1');
        expect((await getProvider('acme'))!.status).toBe('ready');
        __setExtensionsSource(async () => [mk('https://tok.acme.com/t')]);
        invalidateProviderCache();
        expect((await getProvider('acme'))!.status).toBe('needs_reapproval');
    });

    it('A2: el hash de identidad ata la cuenta al proveedor que la emitio', () => {
        const official = parseExtensionProviders([googleExt()]).get('google')!.def;
        const other = { ...official, tokenUrl: 'https://evil.example.com/token' };
        expect(providerIdentityHash(official)).not.toBe(providerIdentityHash(other));
        const rt = (d: typeof official) => ({ id: d.id, identityHash: providerIdentityHash(d), endpointHosts: endpointHostsOf(d) });
        expect(accountMatchesProvider({ provider_hash: providerIdentityHash(official) }, rt(official))).toBe(true);
        expect(accountMatchesProvider({ provider_hash: providerIdentityHash(official) }, rt(other))).toBe(false);
        // cuentas antiguas (sin hash): solo con endpoints oficiales
        expect(accountMatchesProvider({ provider_hash: null }, rt(official))).toBe(true);
        expect(accountMatchesProvider({ provider_hash: null }, rt(other))).toBe(false);
    });

    it('resumen publico sin secretos y grupos de scopes concedidos (alias OIDC incluidos)', async () => {
        const summaries = await listProviderSummaries();
        expect(summaries[0]).toMatchObject({ id: 'google', status: 'ready', source: 'builtin' });
        expect(JSON.stringify(summaries)).not.toContain('csecret');
        const p = (await getProvider('google'))!;
        const granted = Array.from(grantedScopeSet('openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/calendar'));
        expect(providerScopeGroups(p, granted)).toEqual(['calendar', 'userinfo']);
    });

    it('sin backend (config caida) sigue funcionando con el integrado', async () => {
        __setExtensionsSource(async () => { throw new Error('boom'); });
        expect((await getProvider('google'))!.status).toBe('ready');
    });

    it('attachCredentials: cliente publico con PKCE y sin secreto declarado basta con clientId', async () => {
        const ext = googleExt({ clientSecretCredential: undefined }, { config: { GOOGLE_CLIENT_ID: 'pub-cid' } });
        __setExtensionsSource(async () => [ext]);
        vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
        const p = (await getProvider('google'))!;
        expect(p.status).toBe('ready');
        void attachCredentials;
    });
});

describe('tokens: refresco, rotacion, concurrencia y revocacion', () => {
    let google: FakeGoogle;
    let fake: ReturnType<typeof createFakePrisma>;
    const mutex = () => { let chain: Promise<unknown> = Promise.resolve(); return async <T,>(_id: string, fn: () => Promise<T>) => { const run = chain.then(fn, fn); chain = run.catch(() => undefined); return run; }; };

    beforeEach(async () => {
        google = new FakeGoogle({ clientId: 'cid-123', clientSecret: 'csecret-xyz' });
        await google.init();
        __setOAuthTransport(google.transport as never, async () => ['142.250.1.1']);
        fake = createFakePrisma();
        h.prisma = fake.prisma;
        __setRefreshLock(mutex() as never);
        google.refreshTokens.set('rt-old', { sub: 's', scope: 'openid' });
        fake.accounts.push({ id: 'acc1', userId: 'u1', type: 'oauth', provider: 'google', providerAccountId: 's', access_token: 'expired', refresh_token: 'rt-old', id_token: null, expires_at: 1, scope: 'openid', token_type: 'Bearer' });
    });

    it('A2: una cuenta emitida por OTRO proveedor (hash distinto) no se usa ni se refresca contra el proveedor activo', async () => {
        fake.accounts[0].provider_hash = 'hash-de-otro-proveedor';
        const p = (await getProvider('google'))!;
        await expect(getAccessToken(p, 'u1')).rejects.toMatchObject({ code: 'OAUTH_NOT_LINKED' });
        expect(google.refreshCount).toBe(0);
        // con el hash correcto, vuelve a funcionar
        fake.accounts[0].provider_hash = p.identityHash;
        expect((await getAccessToken(p, 'u1')).accessToken).toBeTruthy();
    });

    it('cuentas antiguas sin hash (proveedor oficial): se aceptan y se les graba el hash', async () => {
        const p = (await getProvider('google'))!;
        await getAccessToken(p, 'u1');
        await new Promise((r) => setTimeout(r, 10));
        expect(fake.accounts[0].provider_hash).toBe(p.identityHash);
    });

    it('token vigente: no llama al proveedor', async () => {
        fake.accounts[0].expires_at = Math.floor(Date.now() / 1000) + 3000;
        fake.accounts[0].access_token = 'vigente';
        const p = (await getProvider('google'))!;
        expect((await getAccessToken(p, 'u1')).accessToken).toBe('vigente');
        expect(google.refreshCount).toBe(0);
    });

    it('refresco CONCURRENTE (10 peticiones): una sola llamada al proveedor y todas reciben el mismo token nuevo', async () => {
        google.refreshDelayMs = 30;
        const p = (await getProvider('google'))!;
        const results = await Promise.all(Array.from({ length: 10 }, () => getAccessToken(p, 'u1')));
        expect(google.refreshCount).toBe(1);
        expect(new Set(results.map((r) => r.accessToken)).size).toBe(1);
        expect(fake.accounts[0].access_token).toBe(results[0].accessToken);
    });

    it('dos PROCESOS (sin dedupe en memoria): el candado + relectura evita el segundo refresco', async () => {
        google.refreshDelayMs = 20;
        const p = (await getProvider('google'))!;
        // Simula otro proceso: segunda llamada empieza cuando la primera aun no escribio pero espera el candado.
        const a = getAccessToken(p, 'u1');
        await new Promise((r) => setTimeout(r, 1));
        const b = getAccessToken(p, 'u1');
        const [ra, rb] = await Promise.all([a, b]);
        expect(ra.accessToken).toBe(rb.accessToken);
        expect(google.refreshCount).toBe(1);
    });

    it('ROTACION: si Google devuelve un refresh_token nuevo, reemplaza al anterior', async () => {
        google.rotateRefresh = true;
        const p = (await getProvider('google'))!;
        await getAccessToken(p, 'u1');
        expect(fake.accounts[0].refresh_token).toMatch(/^rt-/);
        expect(fake.accounts[0].refresh_token).not.toBe('rt-old');
        expect(google.refreshTokens.has('rt-old')).toBe(false);
    });

    it('invalid_grant: la cuenta queda en "reconectar" (sin tokens) y las siguientes llamadas NO gastan mas refrescos', async () => {
        google.failRefreshWith = 'invalid_grant';
        const p = (await getProvider('google'))!;
        await expect(getAccessToken(p, 'u1')).rejects.toMatchObject({ code: 'OAUTH_RECONNECT_REQUIRED' });
        expect(fake.accounts[0].access_token).toBeNull();
        expect(fake.accounts[0].refresh_token).toBeNull();
        await expect(getAccessToken(p, 'u1')).rejects.toMatchObject({ code: 'OAUTH_RECONNECT_REQUIRED' });
        expect(google.refreshCount).toBe(1);
    });

    it('error temporal del proveedor NO borra los tokens', async () => {
        google.failRefreshWith = 'temporarily_unavailable';
        const p = (await getProvider('google'))!;
        await expect(getAccessToken(p, 'u1')).rejects.toMatchObject({ code: 'OAUTH_PROVIDER_UNAVAILABLE' });
        expect(fake.accounts[0].refresh_token).toBe('rt-old');
    });

    it('sin cuenta => OAUTH_NOT_LINKED; cuenta de OTRO usuario nunca se usa; accountId ajeno no sirve', async () => {
        const p = (await getProvider('google'))!;
        await expect(getAccessToken(p, 'otro-usuario')).rejects.toMatchObject({ code: 'OAUTH_NOT_LINKED' });
        await expect(getAccessToken(p, 'u1', { accountId: 'acc-de-otro' })).rejects.toMatchObject({ code: 'OAUTH_NOT_LINKED' });
        expect(new OAuthAccountError('OAUTH_NOT_LINKED').code).toBe('OAUTH_NOT_LINKED');
    });

    it('pickAccount determinista: con refresh_token primero, luego el token mas vigente', () => {
        expect(pickAccount([{ id: 'b', refresh_token: null, expires_at: 9 }, { id: 'a', refresh_token: 'r', expires_at: 1 }])!.id).toBe('a');
        expect(pickAccount([{ id: 'b', refresh_token: 'r', expires_at: 5 }, { id: 'a', refresh_token: 'r', expires_at: 9 }])!.id).toBe('a');
        expect(pickAccount([])).toBeNull();
    });

    it('revocacion RFC 7009 al desvincular: el refresh_token se revoca en Google y la fila se borra; si Google falla, igualmente se desvincula', async () => {
        const out = await unlinkUserProvider('u1', 'google');
        expect(out.unlinked).toBe(1);
        expect(out.revoked).toEqual(['revoked']);
        const call = google.calls.find((c) => c.url.endsWith('/revoke'))!;
        expect(call.form.token).toBe('rt-old');
        expect(call.form.token_type_hint).toBe('refresh_token');
        expect(fake.accounts).toHaveLength(0);
        expect(google.refreshTokens.has('rt-old')).toBe(false);

        fake.accounts.push({ id: 'acc2', userId: 'u1', type: 'oauth', provider: 'google', providerAccountId: 's2', access_token: 'a', refresh_token: 'r2', id_token: null, expires_at: 1, scope: 'openid', token_type: null });
        google.revokeStatus = 503;
        const failed = await unlinkUserProvider('u1', 'google');
        expect(failed).toMatchObject({ unlinked: 1, revoked: ['failed'] });
        expect(fake.accounts).toHaveLength(0);
    });

    it('revokeAtProvider: sin revokeUrl o sin token no llama a nadie', async () => {
        const p = { ...(await getProvider('google'))!, revokeUrl: null };
        expect(await revokeAtProvider(p, { refresh_token: 'x' })).toBe('not_supported');
        const q = (await getProvider('google'))!;
        expect(await revokeAtProvider(q, {})).toBe('no_token');
    });
});
