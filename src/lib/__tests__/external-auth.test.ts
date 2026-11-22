import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { parseExternalClients, sha256Hex, validateAuthorizeParams, isAllowedRedirectUri } from '../external-auth';
import { authorizeFlow, discoveryDocument, tokenFlow, type FlowDeps } from '../external-auth-flow';
import { createMemoryCodeStore } from '../external-auth-store';
import { safeLoginNext } from '../login-next';

const CB = 'https://backend.killio.dev/auth/social/bloomx/callback';
const VERIFIER = 'v'.repeat(50);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const SECRET = 'killio-secret-value';

const clientsJson = JSON.stringify([{ clientId: 'killio', name: 'Killio', secretHash: sha256Hex(SECRET), redirectUris: [CB] }]);
const clients = parseExternalClients(clientsJson, true);

function deps(over: Partial<FlowDeps> = {}): FlowDeps & { audits: Array<{ event: string; data: any }> } {
    const audits: Array<{ event: string; data: any }> = [];
    return {
        clients,
        store: createMemoryCodeStore(),
        getUser: async (id) => (id === 'u1' ? { id: 'u1', email: 'Ana@Empresa.com', name: 'Ana' } : null),
        isDisabled: async (id) => id === 'off',
        rateLimit: async () => ({ ok: true, retryAfter: 0 }),
        audit: (event, data) => void audits.push({ event, data }),
        audits,
        ...over,
    };
}

const params = (over: Record<string, string | null> = {}) => ({ client_id: 'killio', redirect_uri: CB, state: 'st-1', code_challenge: CHALLENGE, code_challenge_method: 'S256', response_type: 'code', ...over });

async function issueCode(d = deps(), user = 'u1') {
    const r = await authorizeFlow(d, params(), user, '1.1.1.1');
    if (r.kind !== 'redirect') throw new Error('no redirect');
    return { d, code: new URL(r.location).searchParams.get('code')!, state: new URL(r.location).searchParams.get('state') };
}
const tokenBody = (code: string, over: Record<string, unknown> = {}) => ({ client_id: 'killio', client_secret: SECRET, code, code_verifier: VERIFIER, redirect_uri: CB, ...over });

describe('config de clientes', () => {
    it('sin clientes validos el flujo esta apagado', () => {
        expect(parseExternalClients(undefined)).toEqual([]);
        expect(parseExternalClients('no es json')).toEqual([]);
        expect(parseExternalClients('{"a":1}')).toEqual([]);
        expect(discoveryDocument('https://mail.x.com', [])).toEqual({ enabled: false, version: 1 });
    });
    it('descarta entradas mal formadas (hash, redirect http, sin redirects)', () => {
        const bad = JSON.stringify([
            { clientId: 'a', secretHash: 'zz', redirectUris: [CB] },
            { clientId: 'b', secretHash: sha256Hex('x'), redirectUris: ['http://evil.com/cb'] },
            { clientId: 'c', secretHash: sha256Hex('x'), redirectUris: [] },
            { clientId: 'd e', secretHash: sha256Hex('x'), redirectUris: [CB] },
        ]);
        expect(parseExternalClients(bad, true)).toEqual([]);
    });
    it('cliente publico (sin secretHash): valido; un secretHash mal formado descarta la entrada', () => {
        const pub = parseExternalClients(JSON.stringify([{ clientId: 'killio', redirectUris: [CB] }]), true);
        expect(pub).toHaveLength(1);
        expect(pub[0].secretHash).toBeNull();
        expect(parseExternalClients(JSON.stringify([{ clientId: 'killio', secretHash: 'zz', redirectUris: [CB] }]), true)).toEqual([]);
    });
    it('cliente publico: el canje solo depende de PKCE y redirect_uri', async () => {
        const pubClients = parseExternalClients(JSON.stringify([{ clientId: 'killio', redirectUris: [CB] }]), true);
        const d = deps({ clients: pubClients });
        const { code } = await issueCode(d);
        expect(await tokenFlow(d, tokenBody(code, { client_secret: undefined, code_verifier: 'x'.repeat(50) }), 'ip')).toMatchObject({ status: 400 });
        const again = await issueCode(d);
        expect((await tokenFlow(d, tokenBody(again.code, { client_secret: undefined }), 'ip')).status).toBe(200);
    });
    it('redirect_uri: https sin credenciales ni fragmento', () => {
        expect(isAllowedRedirectUri(CB, true)).toBe(true);
        for (const u of ['http://x.com/cb', 'https://u:p@x.com/cb', 'https://x.com/cb#f', 'javascript:alert(1)', '', 42]) expect(isAllowedRedirectUri(u as any, true)).toBe(false);
    });
    it('discovery activado expone los endpoints y ningun secreto', () => {
        const d = discoveryDocument('https://mail.empresa.com', clients);
        expect(d).toMatchObject({ enabled: true, authorizationEndpoint: 'https://mail.empresa.com/api/auth/authorize', tokenEndpoint: 'https://mail.empresa.com/api/auth/token', codeChallengeMethods: ['S256'] });
        expect(JSON.stringify(d)).not.toContain(sha256Hex(SECRET));
    });
});

describe('authorize', () => {
    it('rechaza sin redirigir: cliente o redirect_uri no registrados, falta de PKCE o state', () => {
        const bad = (over: Record<string, string | null>) => validateAuthorizeParams(params(over), clients);
        expect(bad({ client_id: 'otro' })).toEqual({ ok: false, error: 'invalid_client' });
        expect(bad({ redirect_uri: 'https://evil.com/cb' })).toEqual({ ok: false, error: 'invalid_redirect_uri' });
        expect(bad({ redirect_uri: CB + '/' })).toEqual({ ok: false, error: 'invalid_redirect_uri' });
        expect(bad({ code_challenge_method: 'plain' })).toEqual({ ok: false, error: 'invalid_request' });
        expect(bad({ code_challenge: 'corto' })).toEqual({ ok: false, error: 'invalid_request' });
        expect(bad({ state: '' })).toEqual({ ok: false, error: 'invalid_request' });
        expect(bad({ response_type: 'token' })).toEqual({ ok: false, error: 'unsupported_response_type' });
        expect(validateAuthorizeParams(params(), [])).toEqual({ ok: false, error: 'disabled' });
    });
    it('sin sesion lleva al login; con sesion emite codigo y devuelve state', async () => {
        const d = deps();
        expect(await authorizeFlow(d, params(), null, 'ip')).toEqual({ kind: 'login' });
        const { code, state } = await issueCode(d);
        expect(code.length).toBeGreaterThan(30);
        expect(state).toBe('st-1');
    });
    it('un parametro invalido con sesion devuelve error (no redirige al cliente)', async () => {
        expect(await authorizeFlow(deps(), params({ redirect_uri: 'https://evil.com/cb' }), 'u1', 'ip')).toMatchObject({ kind: 'error', status: 400 });
    });
    it('cuenta deshabilitada: access_denied, sin codigo', async () => {
        const r = await authorizeFlow(deps(), params(), 'off', 'ip');
        expect(r.kind === 'redirect' && new URL(r.location).searchParams.get('error')).toBe('access_denied');
        expect(r.kind === 'redirect' && new URL(r.location).searchParams.get('code')).toBeNull();
    });
    it('respeta el rate limit', async () => {
        const d = deps({ rateLimit: async () => ({ ok: false, retryAfter: 30 }) });
        expect(await authorizeFlow(d, params(), 'u1', 'ip')).toMatchObject({ kind: 'error', status: 429 });
    });
});

describe('token', () => {
    it('devuelve la identidad una sola vez', async () => {
        const { d, code } = await issueCode();
        const r = await tokenFlow(d, tokenBody(code), 'ip');
        expect(r).toEqual({ status: 200, body: { sub: 'u1', email: 'ana@empresa.com', email_verified: true, name: 'Ana' } });
        expect(await tokenFlow(d, tokenBody(code), 'ip')).toMatchObject({ status: 400, body: { error: 'invalid_grant' } }); // replay
    });
    it('secreto incorrecto o cliente desconocido: mismo 401, y el codigo NO se quema', async () => {
        const { d, code } = await issueCode();
        expect(await tokenFlow(d, tokenBody(code, { client_secret: 'mal' }), 'ip')).toMatchObject({ status: 401, body: { error: 'invalid_client' } });
        expect(await tokenFlow(d, tokenBody(code, { client_id: 'otro' }), 'ip')).toMatchObject({ status: 401, body: { error: 'invalid_client' } });
        expect((await tokenFlow(d, tokenBody(code), 'ip')).status).toBe(200);
    });
    it('code_verifier incorrecto, redirect_uri distinta o codigo inventado: invalid_grant y el codigo se quema', async () => {
        for (const over of [{ code_verifier: 'x'.repeat(50) }, { redirect_uri: 'https://evil.com/cb' }, { code_verifier: 'corto' }]) {
            const { d, code } = await issueCode();
            expect(await tokenFlow(d, tokenBody(code, over), 'ip')).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
            expect(await tokenFlow(d, tokenBody(code), 'ip')).toMatchObject({ status: 400 });
        }
        expect(await tokenFlow(deps(), tokenBody('inventado'), 'ip')).toMatchObject({ status: 400 });
        expect(await tokenFlow(deps(), tokenBody(undefined as any), 'ip')).toMatchObject({ status: 400 });
    });
    it('codigo expirado', async () => {
        let now = 1_000;
        const store = createMemoryCodeStore(() => now);
        const d = deps({ store });
        const { code } = await issueCode(d);
        now += 61_000;
        expect(await tokenFlow(d, tokenBody(code), 'ip')).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
    });
    it('cuenta deshabilitada entre authorize y token', async () => {
        let off = false;
        const d = deps({ isDisabled: async () => off });
        const { code } = await issueCode(d);
        off = true;
        expect(await tokenFlow(d, tokenBody(code), 'ip')).toMatchObject({ status: 400 });
    });
    it('grant_type distinto, flujo apagado y rate limit', async () => {
        const { d, code } = await issueCode();
        expect(await tokenFlow(d, tokenBody(code, { grant_type: 'password' }), 'ip')).toMatchObject({ status: 400, body: { error: 'unsupported_grant_type' } });
        expect(await tokenFlow(deps({ clients: [] }), tokenBody(code), 'ip')).toMatchObject({ status: 404 });
        expect(await tokenFlow(deps({ rateLimit: async () => ({ ok: false, retryAfter: 5 }) }), tokenBody(code), 'ip')).toMatchObject({ status: 429 });
    });
    it('un codigo emitido a un cliente no sirve a otro', async () => {
        const two = parseExternalClients(JSON.stringify([
            { clientId: 'killio', secretHash: sha256Hex(SECRET), redirectUris: [CB] },
            { clientId: 'otro', secretHash: sha256Hex('s2'), redirectUris: [CB] },
        ]), true);
        const { d, code } = await issueCode(deps({ clients: two }));
        expect(await tokenFlow(d, { ...tokenBody(code), client_id: 'otro', client_secret: 's2' }, 'ip')).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
    });
});

describe('retorno tras el login (anti open redirect)', () => {
    it('solo /api/auth/authorize relativo', () => {
        expect(safeLoginNext('/api/auth/authorize?client_id=killio&state=a')).toBe('/api/auth/authorize?client_id=killio&state=a');
        for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', '/', '/admin', '/api/auth/authorizefoo', '/api/auth/authorize/../login', '/api/auth/authorize?x=\r\nSet-Cookie:a', null, undefined, 5]) {
            if (bad === '/api/auth/authorize/../login') continue; // no empieza por authorize? o authorize? => rechazado abajo
            expect(safeLoginNext(bad as any)).toBeNull();
        }
        expect(safeLoginNext('/api/auth/authorize/../login')).toBeNull();
    });
});
