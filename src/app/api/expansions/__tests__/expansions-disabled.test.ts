import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateEd25519KeyPair } from '@/lib/bloomx-signature';

const mocks = vi.hoisted(() => ({
    user: { id: 'u1', email: 'a@acme.com' } as any,
    disabled: vi.fn(async (_id: string): Promise<string[]> => []),
}));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => mocks.user }));
vi.mock('@/lib/conferencing/auth-context', () => ({ getLinkedAuth: async () => ({ auth: { google: { accessToken: 'USER-TOKEN' } } }) }));
const tpl = vi.hoisted(() => ({ templates: new Map<string, any>(), level: null as number | null }));
vi.mock('@/lib/expansions/domain-templates', () => ({ loadDomainTemplates: async () => tpl.templates }));
vi.mock('@/lib/ext-edge-identity', () => ({ resolveEdgeIdentity: async () => (tpl.level === null ? { id: 'u1', email: 'a@acme.com', level: null, stepUp: false } : { id: 'u1', email: 'a@acme.com', level: tpl.level, stepUp: false }) }));
vi.mock('@/lib/expansions/user-disabled', () => ({ loadDisabledExtensionsForUser: (id: string) => mocks.disabled(id), MAX_DISABLED_FOR_SERVER: 200 }));

import { POST } from '../route';

const savedEnv = { ...process.env };
const fetchMock = vi.fn();
const req = (body: unknown) => new Request('https://app.test/api/expansions', { method: 'POST', headers: { 'content-type': 'application/json', host: 'acme.com' }, body: JSON.stringify(body) }) as any;
const sent = () => JSON.parse((fetchMock.mock.calls[0] as any)[1].body);

beforeEach(() => {
    delete process.env.BLOOMX_DOMAIN_PRIVATE_KEY;
    process.env.TOP_DOMAIN = 'acme.com';
    tpl.templates = new Map(); tpl.level = null;
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

describe('M3: acciones de paginas admin se exigen en el servidor', () => {
    const template = { api: { functions: { loadUsers: { handler: 'listUsers' } } }, mounts: [{ point: 'PAGE', path: 'adm', auth: 'admin', minLevel: 3, component: { type: 'Button', onClick: { type: 'call', function: 'loadUsers' } } }] };
    it('un usuario sin nivel recibe 403 y NO se llama al backend; con el nivel pasa; el handler directo tambien esta protegido', async () => {
        tpl.templates = new Map([['ext-adm', template]]);
        tpl.level = null;
        expect((await POST(req({ extensionId: 'ext-adm', action: 'loadUsers' }))).status).toBe(403);
        expect((await POST(req({ extensionId: 'ext-adm', action: 'listUsers' }))).status).toBe(403);
        tpl.level = 2;
        expect((await POST(req({ extensionId: 'ext-adm', action: 'loadUsers' }))).status).toBe(403);
        expect(fetchMock).not.toHaveBeenCalled();
        tpl.level = 3;
        expect((await POST(req({ extensionId: 'ext-adm', action: 'loadUsers' }))).status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it('acciones no protegidas siguen pasando sin nivel', async () => {
        tpl.templates = new Map([['ext-adm', template]]);
        expect((await POST(req({ extensionId: 'ext-adm', action: 'publicOne' }))).status).toBe(200);
    });
});

describe('A1: context.auth (tokens) solo a OAUTH_READ o versiones legadas conocidas', () => {
    const authOf = () => sent().context?.auth;
    it('sin permiso y fuera de la lista: no se envia auth', async () => {
        tpl.templates = new Map([['ext-x', { version: '1.0.0', permissions: ['READ_USER'], mounts: [] }]]);
        await POST(req({ extensionId: 'ext-x', action: 'run' }));
        expect(authOf()).toBeUndefined();
        expect(JSON.stringify(sent())).not.toContain('USER-TOKEN');
        // sin plantilla conocida tampoco
        fetchMock.mockClear();
        await POST(req({ extensionId: 'desconocida', action: 'run' }));
        expect(authOf()).toBeUndefined();
    });
    it('con OAUTH_READ si; una version legada conocida si; una version posterior de la lista no', async () => {
        tpl.templates = new Map([['ext-r', { version: '1.0.0', permissions: ['OAUTH_READ'] }]]);
        await POST(req({ extensionId: 'ext-r', action: 'run' }));
        expect(authOf()).toEqual({ google: { accessToken: 'USER-TOKEN' } });
        fetchMock.mockClear();
        tpl.templates = new Map([['core-google-meet', { version: '1.4.0', permissions: ['READ_USER'] }]]);
        await POST(req({ extensionId: 'core-google-meet', action: 'run' }));
        expect(authOf()).toEqual({ google: { accessToken: 'USER-TOKEN' } });
        fetchMock.mockClear();
        tpl.templates = new Map([['core-google-meet', { version: '2.0.0', permissions: ['READ_USER', 'OAUTH_ACCOUNT:google:meet'] }]]);
        await POST(req({ extensionId: 'core-google-meet', action: 'run' }));
        expect(authOf()).toBeUndefined();
    });
});
