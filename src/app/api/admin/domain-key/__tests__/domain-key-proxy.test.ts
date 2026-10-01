import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/** Proxy /api/admin/domain-key: propiedad del dominio de la instancia, rechazo de claves privadas y lista blanca. */

type Actor = { kind: 'user'; id: string; email: string } | { kind: 'manager'; id?: string; email?: string };
let guard: { ok: true; actor: Actor } | { ok: false; response: NextResponse };

const mocks = vi.hoisted(() => ({
    auditLog: vi.fn(),
    rateLimitAsync: vi.fn(async () => ({ ok: true, retryAfter: 0, backend: 'memory' })),
}));

vi.mock('@/lib/admin-auth', () => {
    const guardFn = vi.fn(async () => guard);
    // adminRoute usa requireLevel(n): en estas pruebas el nivel no se evalua (lo cubre admin-levels.test / admin-cli.pg.test)
    return { requireAdmin: guardFn, requireLevel: (_min: number, ...a: unknown[]) => (guardFn as (...x: unknown[]) => unknown)(...a) };
});
vi.mock('@/lib/security', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/security')>()),
    auditLog: mocks.auditLog,
    rateLimitAsync: mocks.rateLimitAsync,
    getClientIp: () => '9.9.9.9',
}));

import { GET, POST } from '../route';

const PUB = 'Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyMTI'; // 32 bytes en base64url (no es secreto)
const PRIVATE_PEM = '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE\n-----END PRIVATE KEY-----';

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function backend(opts: { domains?: unknown; keyGet?: Response; keyPost?: Response } = {}) {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        const u = new URL(url);
        if (u.pathname === '/api/manager/domains') {
            return reply(200, { domains: opts.domains ?? [{ id: 'dom-1', name: 'mail.empresa.com' }, { id: 'dom-2', name: 'otro.com' }] });
        }
        if (u.pathname === '/api/manager/domain-key') {
            return init?.method === 'POST' ? (opts.keyPost ?? reply(200, { success: true, registered: true, fingerprint: 'abcd1234abcd1234' }))
                : (opts.keyGet ?? reply(200, { registered: true, fingerprint: 'abcd1234abcd1234', requireSignature: false, legacyMode: false }));
        }
        return reply(404, {});
    });
}

const COOKIE = 'auth_session=tok-manager; bloomx_session=COOKIE-DE-LA-APP; otra=secreto';
const get = (qs: string) => new NextRequest(`http://localhost/api/admin/domain-key${qs}`, { headers: { cookie: COOKIE } });
const post = (body: unknown) =>
    new NextRequest('http://localhost/api/admin/domain-key', {
        method: 'POST',
        headers: { cookie: COOKIE, 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
const keyCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/manager/domain-key'));

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    process.env.TOP_DOMAIN = 'mail.empresa.com';
    delete process.env.NEXT_PUBLIC_APP_URL;
    guard = { ok: true, actor: { kind: 'manager', id: 'm1', email: 'gestor@empresa.com' } };
    mocks.rateLimitAsync.mockResolvedValue({ ok: true, retryAfter: 0, backend: 'memory' });
    backend();
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.TOP_DOMAIN; });

describe('acceso', () => {
    it('sin sesion 401 y sin rol 403 (sin llamar al backend)', async () => {
        guard = { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
        expect((await GET(get('?domainId=dom-1'))).status).toBe(401);
        guard = { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
        expect((await POST(post({ domainId: 'dom-1', signingPublicKey: PUB }))).status).toBe(403);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('admin kind "user" (sin cookie de manager): 409 manager_session_required y nada sale a la red', async () => {
        guard = { ok: true, actor: { kind: 'user', id: 'u1', email: 'a@b.c' } };
        for (const res of [await GET(get('?domainId=dom-1')), await POST(post({ domainId: 'dom-1', signingPublicKey: PUB }))]) {
            expect(res.status).toBe(409);
            expect((await res.json()).code).toBe('manager_session_required');
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('clave privada', () => {
    it('rechaza PEM privado con 400 private_key_rejected ANTES de enviarlo a ningun sitio', async () => {
        const res = await POST(post({ domainId: 'dom-1', signingPublicKey: PRIVATE_PEM }));
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('private_key_rejected');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(JSON.stringify(mocks.auditLog.mock.calls)).not.toContain('MC4CAQAwBQYDK2VwBCIE');
    });

    it('rechaza la linea de entorno y el DER PKCS8 en base64', async () => {
        for (const k of ['BLOOMX_DOMAIN_PRIVATE_KEY="algo"', 'MC4CAQAwBQYDK2VwBCIEIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA']) {
            const res = await POST(post({ domainId: 'dom-1', signingPublicKey: k }));
            expect((await res.json()).code).toBe('private_key_rejected');
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('propiedad del dominio', () => {
    it('dominio ajeno (id de otro dominio del manager) -> 403 forbidden_domain, sin llegar a domain-key', async () => {
        const res = await POST(post({ domainId: 'dom-2', signingPublicKey: PUB }));
        expect(res.status).toBe(403);
        expect((await res.json()).code).toBe('forbidden_domain');
        expect(keyCalls()).toHaveLength(0);
        expect(JSON.stringify(await (await GET(get('?domainId=dom-2'))).json())).not.toContain('abcd1234');
    });

    it('domainId desconocido -> 403 sin revelar datos', async () => {
        const res = await GET(get('?domainId=no-existe'));
        expect(res.status).toBe(403);
        expect(keyCalls()).toHaveLength(0);
    });

    it('validacion: domainId ausente o largo -> 400', async () => {
        expect((await GET(get(''))).status).toBe(400);
        expect((await POST(post({ domainId: 'x'.repeat(201), signingPublicKey: PUB }))).status).toBe(400);
        expect((await POST(post({ domainId: 'dom-1', signingPublicKey: 'A'.repeat(4001) }))).status).toBe(400);
        expect((await POST(post({ domainId: 'dom-1' }))).status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('backend caido al comprobar propiedad -> 502', async () => {
        fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
        expect((await GET(get('?domainId=dom-1'))).status).toBe(502);
    });
});

describe('GET / POST correctos', () => {
    it('GET devuelve solo la lista blanca (descarta cualquier campo extra del backend)', async () => {
        backend({ keyGet: reply(200, { registered: true, fingerprint: 'abcd1234abcd1234', requireSignature: false, legacyMode: false, privateKey: 'PRIV', signingPublicKey: PUB }) });
        const res = await GET(get('?domainId=dom-1'));
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toEqual({ registered: true, fingerprint: 'abcd1234abcd1234', requireSignature: false, legacyMode: false });
        expect(JSON.stringify(data)).not.toContain('PRIV');
        expect(JSON.stringify(data)).not.toContain(PUB);
    });

    it('reenvia SOLO auth_session (no el resto de cookies) en todas las llamadas', async () => {
        await GET(get('?domainId=dom-1'));
        await POST(post({ domainId: 'dom-1', signingPublicKey: PUB }));
        expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(4);
        for (const [, init] of fetchMock.mock.calls) {
            expect((init as any).headers.Cookie).toBe('auth_session=tok-manager');
        }
    });

    it('POST registra/rota: cuerpo minimo al backend, respuesta con lista blanca y auditoria solo con la huella', async () => {
        backend({ keyPost: reply(200, { success: true, registered: true, fingerprint: 'abcd1234abcd1234', privateKey: 'PRIV', signingPublicKey: PUB }) });
        const res = await POST(post({ domainId: 'dom-1', signingPublicKey: `  ${PUB}  `, extra: 'x' }));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true, registered: true, fingerprint: 'abcd1234abcd1234' });

        const [, init] = keyCalls()[0];
        expect(JSON.parse((init as any).body)).toEqual({ domainId: 'dom-1', signingPublicKey: PUB });

        const audited = mocks.auditLog.mock.calls.filter((c) => c[0] === 'admin.domain_key.registered');
        expect(audited).toHaveLength(1);
        expect(audited[0][1]).toMatchObject({ domainId: 'dom-1', fingerprint: 'abcd1234abcd1234', actorKind: 'manager' });
        const dump = JSON.stringify(mocks.auditLog.mock.calls);
        expect(dump).not.toContain(PUB);
        expect(dump).not.toContain('PRIV');
    });

    it('POST requireSignature (compatibilidad con el aviso de modo heredado)', async () => {
        backend({ keyPost: reply(200, { success: true, requireSignature: true }) });
        const res = await POST(post({ domainId: 'dom-1', requireSignature: true }));
        expect(await res.json()).toEqual({ success: true, requireSignature: true });
        expect(JSON.parse((keyCalls()[0][1] as any).body)).toEqual({ domainId: 'dom-1', requireSignature: true });
    });

    it('no admite clave y requireSignature a la vez ni ninguno', async () => {
        expect((await POST(post({ domainId: 'dom-1', signingPublicKey: PUB, requireSignature: true }))).status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('errores del backend: 400 -> invalid_signing_key, 401/403 -> 403, 409 -> 409, otros -> 502', async () => {
        const cases: Array<[number, number, string]> = [[400, 400, 'invalid_signing_key'], [401, 403, 'forbidden_domain'], [403, 403, 'forbidden_domain'], [409, 409, 'register_key_first'], [500, 502, 'backend_error']];
        for (const [from, to, code] of cases) {
            backend({ keyPost: reply(from, { error: 'texto del backend con PRIV' }) });
            const res = await POST(post({ domainId: 'dom-1', signingPublicKey: PUB }));
            expect(res.status).toBe(to);
            const body = await res.json();
            expect(body.code).toBe(code);
            expect(JSON.stringify(body)).not.toContain('PRIV');
        }
        expect(mocks.auditLog.mock.calls.some((c) => c[0] === 'admin.domain_key.registered')).toBe(false);
    });

    it('limite de escritura 10/min', async () => {
        await POST(post({ domainId: 'dom-1', signingPublicKey: PUB }));
        expect(mocks.rateLimitAsync).toHaveBeenCalledWith('admin:domain-key.write:m1', 10, 60_000);
    });
});
