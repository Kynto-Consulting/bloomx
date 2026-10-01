import { beforeEach, describe, expect, it } from 'vitest';
import { generateEd25519KeyPair } from '@/lib/bloomx-signature';
import { GRANT_HEADER, __resetGrantUses, consumeGrantUse, grantAllowsService, issueExecutionGrant, oauthGrantFor, verifyExecutionGrant } from '../exec-grant';
import { __resetLegacyWarning, acceptsLegacyBackendSignature, serviceFromPath, verifyHostCall } from '../host-call-auth';

const keys = generateEd25519KeyPair();
const env = (over: Record<string, string> = {}) => ({ BLOOMX_DOMAIN_PRIVATE_KEY: keys.privatePem, TOP_DOMAIN: 'acme.test', ...over });
const NOW = 1_800_000_000_000;
const issue = (over: Partial<Parameters<typeof issueExecutionGrant>[0]> = {}, e: Record<string, string> = env(), now = NOW) =>
    issueExecutionGrant({ domain: 'acme.test', extensionId: 'core-x', version: '1.0.0', userId: 'u1', permissions: ['STORAGE', 'NOTIFY', 'OAUTH_ACCOUNT:google:calendar', 'OAUTH_SHARED:google'], ...over }, e, now)!;
const payloadOf = (t: string) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8'));
const reqOf = (grant: string | null, path: string, body: unknown, domain = 'acme.test') => ({
    method: 'POST', url: `https://acme.test${path}`,
    headers: { get: (n: string) => ({ [GRANT_HEADER]: grant, 'x-bloomx-domain': domain } as Record<string, string | null>)[n.toLowerCase()] ?? null },
    raw: typeof body === 'string' ? body : JSON.stringify(body),
});
const call = (g: string | null, path = '/api/internal/storage', body: unknown = { op: 'get', userId: 'u1', extensionId: 'core-x', args: {} }, opts: { e?: Record<string, string>; now?: number; domain?: string } = {}) => {
    const r = reqOf(g, path, body, opts.domain);
    return verifyHostCall(r, r.raw, { env: opts.e ?? env(), nowMs: opts.now ?? NOW + 1000 });
};

beforeEach(() => { __resetGrantUses(); __resetLegacyWarning(); });

describe('executionGrant: emision y verificacion con la clave del dominio (sin clave del backend)', () => {
    it('lleva dominio, extension+version, usuario, permisos, jti, iat/exp (120 s) y nonce; sin clave de dominio no se emite', () => {
        const p = payloadOf(issue());
        expect(p).toMatchObject({ v: 1, iss: 'acme.test', aud: 'acme.test', ext: 'core-x', ver: '1.0.0', sub: 'u1' });
        expect(p.exp - p.iat).toBe(120);
        expect(p.jti).toBeTruthy();
        expect(p.nonce).toBeTruthy();
        expect(p.perms).toEqual(['NOTIFY', 'OAUTH_ACCOUNT:google:calendar', 'OAUTH_SHARED:google', 'STORAGE']);
        expect(issueExecutionGrant({ domain: 'acme.test', extensionId: 'x', version: '1', userId: null, permissions: [] }, { TOP_DOMAIN: 'acme.test' }, NOW)).toBeNull();
        const short = payloadOf(issue({}, env({ BLOOMX_GRANT_TTL_SECONDS: '60' })));
        expect(short.exp - short.iat).toBe(60);
    });

    it('verifica sin red y rechaza: caducada, manipulada, permisos ampliados, firmada con otra clave, mal formada', () => {
        const ok = issue();
        expect(verifyExecutionGrant(ok, env(), NOW + 1000).ok).toBe(true);
        expect(verifyExecutionGrant(ok, env(), NOW + 121_000)).toEqual({ ok: false, reason: 'expired' });
        const [pre, payload, sig] = ok.split('.');
        const widened = { ...payloadOf(ok), perms: [...payloadOf(ok).perms, 'MAIL_LABEL'] };
        const t1 = `${pre}.${Buffer.from(JSON.stringify(widened)).toString('base64url')}.${sig}`;
        expect(verifyExecutionGrant(t1, env(), NOW + 1000)).toEqual({ ok: false, reason: 'bad_signature' });
        const t2 = `${pre}.${Buffer.from(JSON.stringify({ ...payloadOf(ok), sub: 'otro' })).toString('base64url')}.${sig}`;
        expect(verifyExecutionGrant(t2, env(), NOW + 1000).ok).toBe(false);
        const other = generateEd25519KeyPair();
        expect(verifyExecutionGrant(ok, env({ BLOOMX_DOMAIN_PRIVATE_KEY: other.privatePem }), NOW + 1000)).toEqual({ ok: false, reason: 'bad_signature' });
        for (const bad of ['', 'x', 'bxg1.a.b', `${pre}.${payload}`, 'jwt.a.b.c']) expect(verifyExecutionGrant(bad, env(), NOW).ok).toBe(false);
    });

    it('audiencia: una concesion de OTRO dominio no sirve en esta instancia', () => {
        const foreign = issue({ domain: 'otro.test' });
        expect(verifyExecutionGrant(foreign, env(), NOW + 1000)).toEqual({ ok: false, reason: 'wrong_audience' });
    });

    it('permisos -> servicios cubiertos (lista cerrada) y grupos OAuth derivados por la instancia', () => {
        const c = payloadOf(issue());
        expect(['storage', 'notify', 'oauth'].every((s) => grantAllowsService(c, s))).toBe(true);
        expect(['calendar', 'contacts', 'mail', 'ai', 'formats', 'otro'].some((s) => grantAllowsService(c, s))).toBe(false);
        expect(oauthGrantFor(c, 'google')).toEqual({ groups: ['calendar'], shared: true });
        expect(oauthGrantFor(c, 'microsoft')).toEqual({ groups: [], shared: false });
    });

    it('tope de usos por jti', () => {
        const c = { ...payloadOf(issue()), max: 3 };
        expect([1, 2, 3, 4].map(() => consumeGrantUse(c, NOW))).toEqual([true, true, true, false]);
    });
});

describe('verifyHostCall: el puente de la instancia con la concesion', () => {
    it('acepta la concesion valida y devuelve el usuario de la concesion', async () => {
        expect(await call(issue())).toMatchObject({ ok: true, userId: 'u1' });
    });

    it('rechaza: expirada, otra extension, otro usuario, otro dominio (cabecera), servicio fuera de permisos, cuerpo invalido', async () => {
        const g = issue();
        expect((await call(g, undefined, undefined, { now: NOW + 130_000 })).ok).toBe(false);
        expect((await call(g, undefined, { op: 'get', userId: 'u1', extensionId: 'core-OTRA', args: {} })).ok).toBe(false);
        expect((await call(g, undefined, { op: 'get', userId: 'u2', extensionId: 'core-x', args: {} })).ok).toBe(false);
        expect((await call(g, undefined, undefined, { domain: 'otro.test' })).ok).toBe(false);
        expect((await call(g, '/api/internal/calendar')).ok).toBe(false);
        expect((await call(g, '/api/internal/mail')).ok).toBe(false);
        expect((await call(g, '/api/internal/storage', 'no-json')).ok).toBe(false);
    });

    it('una concesion de ruta publica (sub null) no sirve para servicios de usuario', async () => {
        expect((await call(issue({ userId: null }))).ok).toBe(false);
    });

    it('la misma ejecucion hace N llamadas hasta el tope; despues se rechaza (replay)', async () => {
        const e = env({ BLOOMX_GRANT_MAX_USES: '2' });
        const g = issue({}, e);
        expect((await call(g, undefined, undefined, { e })).ok).toBe(true);
        expect((await call(g, undefined, undefined, { e })).ok).toBe(true);
        expect((await call(g, undefined, undefined, { e })).ok).toBe(false);
    });

    it('sin concesion: camino LEGADO (firma del backend) mientras se acepte; BLOOMX_ACCEPT_BACKEND_SIGNATURE=false lo apaga', async () => {
        const legacyOk = async () => ({ ok: true as const, userId: 'u1' });
        const r = reqOf(null, '/api/internal/storage', { op: 'get', userId: 'u1', extensionId: 'x', args: {} });
        expect(await verifyHostCall(r, r.raw, { env: env(), legacyVerify: legacyOk })).toMatchObject({ ok: true, userId: 'u1', legacy: true });
        expect(acceptsLegacyBackendSignature({})).toBe(true);
        expect(acceptsLegacyBackendSignature({ BLOOMX_ACCEPT_BACKEND_SIGNATURE: 'false' })).toBe(false);
        expect(await verifyHostCall(r, r.raw, { env: env({ BLOOMX_ACCEPT_BACKEND_SIGNATURE: 'false' }), legacyVerify: legacyOk })).toEqual({ ok: false, reason: 'invalid' });
    });

    it('el flujo con concesion NO necesita ninguna variable BACKEND_* ni clave del backend', async () => {
        const e = { BLOOMX_DOMAIN_PRIVATE_KEY: keys.privatePem, TOP_DOMAIN: 'acme.test' };
        const g = issue({}, e);
        const legacy = async () => { throw new Error('no debe consultar la clave del backend'); };
        const r = reqOf(g, '/api/internal/storage', { op: 'get', userId: 'u1', extensionId: 'core-x', args: {} });
        expect(await verifyHostCall(r, r.raw, { env: e, nowMs: NOW + 1000, legacyVerify: legacy })).toMatchObject({ ok: true });
    });

    it('serviceFromPath', () => {
        expect(serviceFromPath('/api/internal/storage')).toBe('storage');
        expect(serviceFromPath('/api/internal/host/oauth')).toBe('oauth');
        expect(serviceFromPath('/api/internal/host/../x')).toBeNull();
        expect(serviceFromPath('/api/other/storage')).toBeNull();
    });
});
