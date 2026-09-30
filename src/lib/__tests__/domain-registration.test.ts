import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn(async ({ data }: any) => ({ id: 'u1', email: data.email }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: vi.fn(async () => null), create: (a: any) => create(a) } } }));
vi.mock('@/lib/env', () => ({ env: { REGISTRATION_KEY: 'k-secret' } }));
vi.mock('bcryptjs', () => ({ default: { hash: vi.fn(async () => 'hashed') } }));
vi.mock('@/lib/security', () => ({
    auditLog: vi.fn(),
    BCRYPT_COST: 4,
    getClientIp: () => '1.1.1.1',
    isProduction: () => false,
    rateLimitAsync: async () => ({ ok: true }),
    safeEqual: (a: string, b: string) => a === b,
    validateNewPassword: () => null,
}));

import { getRegistrationPolicy, registrationPolicyFromTheme } from '@/lib/domain-registration';
import { POST } from '@/app/api/register/route';

let theme: unknown;
let backendOk = true;
beforeEach(() => {
    create.mockClear();
    backendOk = true;
    theme = {};
    vi.stubGlobal('fetch', vi.fn(async () => {
        if (!backendOk) throw new Error('backend caido');
        return new Response(JSON.stringify({ config: { theme } }), { status: 200 });
    }));
});
afterEach(() => vi.unstubAllGlobals());

const req = (body: object) => new Request('http://acme.test/api/register', {
    method: 'POST', headers: { 'content-type': 'application/json', host: 'acme.test' }, body: JSON.stringify(body),
}) as any;
const good = { email: 'a@acme.test', password: 'Sup3r-secret-pass!', name: 'A' };

describe('registrationPolicyFromTheme', () => {
    it('sin landing = politica historica; valores hostiles se ignoran', () => {
        expect(registrationPolicyFromTheme(undefined)).toEqual({ enabled: true, requireKey: true });
        expect(registrationPolicyFromTheme({ landing: { registration: { enabled: false } } })).toEqual({ enabled: false, requireKey: true });
        expect(registrationPolicyFromTheme({ landing: { registration: { requireKey: false } } })).toEqual({ enabled: true, requireKey: false });
        expect(registrationPolicyFromTheme({ landing: { registration: { enabled: 'no', requireKey: 0 } } })).toEqual({ enabled: true, requireKey: true });
        expect(registrationPolicyFromTheme('x')).toEqual({ enabled: true, requireKey: true });
    });
});

describe('POST /api/register respeta landing.registration del dominio', () => {
    it('enabled:false -> 403 aunque la clave sea correcta y no crea usuario', async () => {
        theme = { landing: { registration: { enabled: false } } };
        const res = await POST(req({ ...good, key: 'k-secret' }));
        expect(res.status).toBe(403);
        expect((await res.json()).error).toMatch(/closed/i);
        expect(create).not.toHaveBeenCalled();
    });
    it('requireKey por defecto: sin clave o clave mala -> 403', async () => {
        expect((await POST(req({ ...good, key: 'nope' }))).status).toBe(403);
        expect((await POST(req(good))).status).toBe(403);
        expect(create).not.toHaveBeenCalled();
    });
    it('requireKey por defecto con clave correcta -> alta', async () => {
        const res = await POST(req({ ...good, key: 'k-secret' }));
        expect(res.status).toBe(200);
        expect(create).toHaveBeenCalledTimes(1);
    });
    it('requireKey:false -> alta sin clave', async () => {
        theme = { landing: { registration: { requireKey: false } } };
        const res = await POST(req(good));
        expect(res.status).toBe(200);
        expect(create).toHaveBeenCalledTimes(1);
    });
    it('si el backend cae se aplica la politica historica (no se abre nada)', async () => {
        backendOk = false;
        expect(await getRegistrationPolicy(req({}))).toEqual({ enabled: true, requireKey: true });
        expect((await POST(req(good))).status).toBe(403);
        expect((await POST(req({ ...good, key: 'k-secret' }))).status).toBe(200);
    });
    it('consulta el backend con el dominio de la peticion', async () => {
        await POST(req({ ...good, key: 'k-secret' }));
        const url = String((fetch as any).mock.calls[0][0]);
        expect(url).toContain('/api/config');
        expect(url).toContain('domain=acme.test');
    });
});
