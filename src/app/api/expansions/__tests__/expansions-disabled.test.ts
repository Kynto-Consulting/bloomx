import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateEd25519KeyPair } from '@/lib/bloomx-signature';

const mocks = vi.hoisted(() => ({
    user: { id: 'u1', email: 'a@acme.com' } as any,
    disabled: vi.fn(async (_id: string): Promise<string[]> => []),
}));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => mocks.user }));
vi.mock('@/lib/conferencing/auth-context', () => ({ getLinkedAuth: async () => ({ auth: {} }) }));
vi.mock('@/lib/expansions/user-disabled', () => ({ loadDisabledExtensionsForUser: (id: string) => mocks.disabled(id), MAX_DISABLED_FOR_SERVER: 200 }));

import { POST } from '../route';

const savedEnv = { ...process.env };
const fetchMock = vi.fn();
const req = (body: unknown) => new Request('https://app.test/api/expansions', { method: 'POST', headers: { 'content-type': 'application/json', host: 'acme.com' }, body: JSON.stringify(body) }) as any;
const sent = () => JSON.parse((fetchMock.mock.calls[0] as any)[1].body);

beforeEach(() => {
    delete process.env.BLOOMX_DOMAIN_PRIVATE_KEY;
    process.env.TOP_DOMAIN = 'acme.com';
    mocks.disabled.mockReset();
    mocks.disabled.mockResolvedValue([]);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, result: {} }) });
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { process.env = { ...savedEnv }; vi.unstubAllGlobals(); });

describe('/api/expansions (CALL_BACKEND): preferencias del usuario hacia execute', () => {
    it('dominio FIRMADO: incluye disabledExtensions (leidas en el servidor, saneadas) dentro del cuerpo firmado', async () => {
        process.env.BLOOMX_DOMAIN_PRIVATE_KEY = generateEd25519KeyPair().privatePem;
        mocks.disabled.mockResolvedValue(['zoom', 'zoom', '../x', 'giphy']);
        const r = await POST(req({ extensionId: 'zoom', action: 'createMeeting', params: {} }));
        expect(r.status).toBe(200);
        expect(mocks.disabled).toHaveBeenCalledWith('u1');
        expect(sent()).toMatchObject({ extensionId: 'zoom', action: 'createMeeting', disabledExtensions: ['zoom', 'giphy'] });
        expect((fetchMock.mock.calls[0] as any)[1].headers['X-BloomX-Signature']).toBeTruthy();
    });

    it('el navegador no puede inyectar su propia lista: solo cuenta la de BD', async () => {
        process.env.BLOOMX_DOMAIN_PRIVATE_KEY = generateEd25519KeyPair().privatePem;
        mocks.disabled.mockResolvedValue([]);
        await POST(req({ extensionId: 'dlp', action: 'run', disabledExtensions: ['dlp'], context: { disabledExtensions: ['dlp'] } }));
        expect(sent()).not.toHaveProperty('disabledExtensions');
    });

    it('LEGADO (sin clave): ni se lee ni se envia la lista', async () => {
        mocks.disabled.mockResolvedValue(['zoom']);
        await POST(req({ extensionId: 'zoom', action: 'run' }));
        expect(mocks.disabled).not.toHaveBeenCalled();
        expect(sent()).not.toHaveProperty('disabledExtensions');
    });

    it('si falla la lectura de preferencias la accion se ejecuta igualmente (sin lista)', async () => {
        process.env.BLOOMX_DOMAIN_PRIVATE_KEY = generateEd25519KeyPair().privatePem;
        mocks.disabled.mockRejectedValue(new Error('db down'));
        const r = await POST(req({ extensionId: 'zoom', action: 'run' }));
        expect(r.status).toBe(200);
        expect(sent()).not.toHaveProperty('disabledExtensions');
    });

    it('lista gigante: se acota a 200 ids', async () => {
        process.env.BLOOMX_DOMAIN_PRIVATE_KEY = generateEd25519KeyPair().privatePem;
        mocks.disabled.mockResolvedValue(Array.from({ length: 5000 }, (_, i) => `e${i}`));
        await POST(req({ extensionId: 'zoom', action: 'run' }));
        expect(sent().disabledExtensions).toHaveLength(200);
    });
});
