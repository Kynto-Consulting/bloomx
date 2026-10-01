import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- dobles ---------------------------------------------------------------------------------------------------------
const guard = vi.hoisted(() => ({
    result: { ok: true, actor: { kind: 'manager', id: 'm1', email: 'a@b.c' } } as any,
}));
vi.mock('@/lib/admin-auth', () => {
    const guardFn = vi.fn(async () => guard.result);
    // adminRoute usa requireLevel(n): en estas pruebas el nivel no se evalua (lo cubre admin-levels.test / admin-cli.pg.test)
    return { requireAdmin: guardFn, requireLevel: (_min: number, ...a: unknown[]) => (guardFn as (...x: unknown[]) => unknown)(...a) };
});
vi.mock('@/lib/security', () => ({
    auditLog: vi.fn(),
    getClientIp: () => '1.2.3.4',
    rateLimitAsync: vi.fn(async () => ({ ok: true, retryAfter: 0 })),
}));
const sql = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/admin/sql', async () => {
    const actual = await vi.importActual<typeof import('@/lib/admin/sql')>('@/lib/admin/sql');
    return { ...actual, query: sql.query };
});

import { NextResponse } from 'next/server';
import { auditLog } from '@/lib/security';
import { __resetInstanceCache } from '@/lib/admin/extensions-instance';
import { __resetCatalogCache } from '@/lib/admin/extensions-catalog';
import { GET as catalogGET } from '../catalog/route';
import { GET as installedGET } from '../installed/route';
import { POST as toggleAPI } from '../toggle/route';
import { POST as orderAPI } from '../order/route';
import { POST as mandatoryAPI } from '../mandatory/route';
import { POST as installAPI } from '../install/route';
import { POST as uninstallAPI } from '../uninstall/route';
import { POST as updateAPI } from '../update/route';
import { POST as testAPI } from '../test/route';
import { GET as statusGET } from '../[id]/status/route';

const SECRET = 'SUPER-SECRET-VALUE';
const fetchMock = vi.fn();
const res = (status: number, body: any) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

type Handler = (url: string, init: any) => any;
let handlers: Handler[] = [];
/** Backend falso: enruta por URL. `/api/config` siempre responde el dominio de esta instancia. */
function backend(match: (url: string) => boolean, reply: (url: string, init: any) => any) {
    handlers.unshift((url, init) => (match(url) ? reply(url, init) : undefined));
}

const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    new Request(`https://f.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'auth_session=abc', ...headers }, body: JSON.stringify(body) });
const get = (path: string) => new Request(`https://f.test${path}`, { headers: { cookie: 'auth_session=abc' } });
const callsTo = (fragment: string) => fetchMock.mock.calls.filter(([u]) => String(u).includes(fragment));

beforeEach(() => {
    process.env.TOP_DOMAIN = 'mail.test';
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://backend.test';
    delete process.env.BLOOMX_DOMAIN_PRIVATE_KEY;
    guard.result = { ok: true, actor: { kind: 'manager', id: 'm1', email: 'a@b.c' } };
    __resetInstanceCache();
    __resetCatalogCache();
    sql.query.mockReset();
    sql.query.mockResolvedValue([]);
    (auditLog as any).mockReset();
    fetchMock.mockReset();
    handlers = [(url) => (url.includes('/api/config') ? res(200, { config: { id: 'dom1', name: 'mail.test' } }) : undefined)];
    fetchMock.mockImplementation(async (url: string, init: any) => {
        for (const h of handlers) {
            const out = h(String(url), init);
            if (out !== undefined) return typeof out === 'function' ? out() : out;
        }
        throw new Error(`fetch no esperado: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TOP_DOMAIN;
    delete process.env.BLOOMX_DOMAIN_PRIVATE_KEY;
});

const denyWith = (status: 401 | 403) => {
    guard.result = { ok: false, response: NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }, { status }) };
};

describe('autorizacion: sin sesion 401, sin rol 403 (todas las rutas)', () => {
    const calls: [string, () => Promise<Response>][] = [
        ['catalog', () => catalogGET(get('/api/admin/extensions/catalog') as any)],
        ['installed', () => installedGET(get('/api/admin/extensions/installed?domainId=dom1') as any)],
        ['toggle', () => toggleAPI(json('/x', { domainId: 'dom1', extensionId: 'e', enabled: true }) as any)],
        ['order', () => orderAPI(json('/x', { domainId: 'dom1', items: [{ extensionId: 'e', order: 0 }] }) as any)],
        ['mandatory', () => mandatoryAPI(json('/x', { domainId: 'dom1', extensionId: 'e', mandatory: true }) as any)],
        ['install', () => installAPI(json('/x', { domainId: 'dom1', extensionId: 'e' }) as any)],
        ['uninstall', () => uninstallAPI(json('/x', { domainId: 'dom1', extensionId: 'e' }) as any)],
        ['update', () => updateAPI(json('/x', { domainId: 'dom1', extensionId: 'e' }) as any)],
        ['test', () => testAPI(json('/x', { extensionId: 'e' }) as any)],
        ['status', () => statusGET(get('/x') as any, { params: Promise.resolve({ id: 'e' }) })],
    ];
    for (const status of [401, 403] as const) {
        it(`responde ${status} y no llama al backend`, async () => {
            denyWith(status);
            for (const [name, call] of calls) {
                const r = await call();
                expect(r.status, name).toBe(status);
            }
            expect(fetchMock).not.toHaveBeenCalled();
        });
    }
});

describe('toggle', () => {
    it('valida con zod: enabled booleano e ids acotados (400 sin tocar el backend)', async () => {
        for (const body of [
            { domainId: 'dom1', extensionId: 'e', enabled: 'si' },
            { domainId: 'dom1', extensionId: '../x', enabled: true },
            { domainId: '', extensionId: 'e', enabled: true },
            { domainId: 'dom1', extensionId: 'e'.repeat(201), enabled: true },
            { domainId: 'dom1', extensionId: 'e' },
        ]) {
            const r = await toggleAPI(json('/x', body) as any);
            expect(r.status).toBe(400);
            expect(JSON.stringify(await r.json())).not.toContain('../x');
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rechaza un dominio que no es el de esta instancia (403 domain_mismatch) sin llamar al toggle del backend', async () => {
        const r = await toggleAPI(json('/x', { domainId: 'otro-dominio', extensionId: 'e', enabled: false }) as any);
        expect(r.status).toBe(403);
        expect((await r.json()).code).toBe('domain_mismatch');
        expect(callsTo('/manager/extensions/toggle')).toHaveLength(0);
    });

    it('reenvia solo los tres campos + cookie, audita extension.toggled y devuelve {success, enabled}', async () => {
        backend((u) => u.includes('/manager/extensions/toggle'), () => res(200, { success: true, enabled: false, authData: { accessToken: SECRET } }));
        const r = await toggleAPI(json('/x', { domainId: 'dom1', extensionId: 'core-notion', enabled: false, settings: { token: SECRET } }) as any);
        expect(r.status).toBe(200);
        const data = await r.json();
        expect(data).toEqual({ success: true, enabled: false });
        const [, init] = callsTo('/manager/extensions/toggle')[0];
        expect(JSON.parse(init.body)).toEqual({ domainId: 'dom1', extensionId: 'core-notion', enabled: false });
        expect(init.headers.Cookie).toBe('auth_session=abc');
        const audited = (auditLog as any).mock.calls.find((c: any[]) => c[0] === 'admin.extension.toggled');
        expect(audited[1]).toMatchObject({ extensionId: 'core-notion', domainId: 'dom1', enabled: false, outcome: 'ok', actorKind: 'manager' });
        expect(JSON.stringify((auditLog as any).mock.calls)).not.toContain(SECRET);
    });

    it('errores del backend: 401/403 => manager_session_required, 404 => not_installed; audita outcome failed', async () => {
        backend((u) => u.includes('/manager/extensions/toggle'), () => res(401, { error: 'Unauthorized' }));
        const denied = await toggleAPI(json('/x', { domainId: 'dom1', extensionId: 'e', enabled: true }) as any);
        expect(denied.status).toBe(403);
        expect((await denied.json()).code).toBe('manager_session_required');

        backend((u) => u.includes('/manager/extensions/toggle'), () => res(404, { error: 'Extension is not installed' }));
        const missing = await toggleAPI(json('/x', { domainId: 'dom1', extensionId: 'e', enabled: true }) as any);
        expect(missing.status).toBe(404);
        expect((await missing.json()).code).toBe('not_installed');
        expect((auditLog as any).mock.calls.filter((c: any[]) => c[0] === 'admin.extension.toggled').every((c: any[]) => c[1].outcome === 'failed')).toBe(true);
    });

    it('si el backend no responde: 502 backend_unavailable', async () => {
        backend((u) => u.includes('/manager/extensions/toggle'), () => () => { throw new TypeError('fetch failed'); });
        const r = await toggleAPI(json('/x', { domainId: 'dom1', extensionId: 'e', enabled: true }) as any);
        expect(r.status).toBe(502);
        expect((await r.json()).code).toBe('backend_unavailable');
    });
});

describe('order', () => {
    it('valida items (orden entero >= 0, sin duplicados, maximo 100)', async () => {
        for (const items of [
            [],
            [{ extensionId: 'e', order: -1 }],
            [{ extensionId: 'e', order: 1.5 }],
            [{ extensionId: 'e', order: '1' }],
            [{ extensionId: 'e', order: 1 }, { extensionId: 'e', order: 2 }],
            Array.from({ length: 101 }, (_, i) => ({ extensionId: `e${i}`, order: i })),
        ]) {
            expect((await orderAPI(json('/x', { domainId: 'dom1', items }) as any)).status).toBe(400);
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('guarda el orden, reenvia solo items y audita extension.reordered', async () => {
        backend((u) => u.includes('/manager/extensions/order'), () => res(200, { success: true, updated: 2 }));
        const r = await orderAPI(json('/x', { domainId: 'dom1', items: [{ extensionId: 'a', order: 0 }, { extensionId: 'b', order: 10 }], extra: SECRET }) as any);
        expect(await r.json()).toEqual({ success: true, updated: 2 });
        const [, init] = callsTo('/manager/extensions/order')[0];
        expect(JSON.parse(init.body)).toEqual({ domainId: 'dom1', items: [{ extensionId: 'a', order: 0 }, { extensionId: 'b', order: 10 }] });
        expect((auditLog as any).mock.calls.find((c: any[]) => c[0] === 'admin.extension.reordered')[1]).toMatchObject({ count: 2, outcome: 'ok' });
    });
});

describe('install / uninstall: no reenvian ni devuelven secretos', () => {
    it('install: el backend devuelve la fila con authData/credentials y NADA de eso llega al navegador', async () => {
        backend((u) => u.includes('/manager/extensions/install'), () =>
            res(200, { success: true, installation: { domainId: 'dom1', extensionId: 'e', authData: { accessToken: SECRET }, settings: { credentials: { K: SECRET } } } }),
        );
        const r = await installAPI(json('/x', { domainId: 'dom1', extensionId: 'e', authData: { accessToken: SECRET }, credentials: { K: SECRET } }) as any);
        expect(r.status).toBe(200);
        const text = JSON.stringify(await r.json());
        expect(text).toBe(JSON.stringify({ success: true }));
        expect(text).not.toContain(SECRET);
        const [, init] = callsTo('/manager/extensions/install')[0];
        expect(JSON.parse(init.body)).toEqual({ domainId: 'dom1', extensionId: 'e' });
        expect(String(init.body)).not.toContain(SECRET);
        expect(JSON.stringify((auditLog as any).mock.calls)).not.toContain(SECRET);
    });

    it('install de pago: 402 del backend => code PAYMENT_REQUIRED', async () => {
        backend((u) => u.includes('/manager/extensions/install'), () => res(402, { error: 'Payment required before installation', code: 'PAYMENT_REQUIRED' }));
        const r = await installAPI(json('/x', { domainId: 'dom1', extensionId: 'paid' }) as any);
        expect(r.status).toBe(402);
        expect((await r.json()).code).toBe('PAYMENT_REQUIRED');
    });

    it('uninstall: audita admin.extension.uninstall (credentialsWiped) y responde solo {success}', async () => {
        backend((u) => u.includes('/manager/extensions/uninstall'), () => res(200, { success: true, authData: SECRET }));
        const r = await uninstallAPI(json('/x', { domainId: 'dom1', extensionId: 'e' }) as any);
        expect(await r.json()).toEqual({ success: true });
        const call = (auditLog as any).mock.calls.find((c: any[]) => c[0] === 'admin.extension.uninstall');
        expect(call[1]).toMatchObject({ extensionId: 'e', outcome: 'ok', credentialsWiped: true });
    });

    it('dominio distinto al de la instancia => 403 y no se desinstala', async () => {
        const r = await uninstallAPI(json('/x', { domainId: 'otro', extensionId: 'e' }) as any);
        expect(r.status).toBe(403);
        expect(callsTo('/manager/extensions/uninstall')).toHaveLength(0);
    });
});

describe('update: actualiza una extension instalada a la version del catalogo', () => {
    it('reenvia solo los dos ids + cookie, audita admin.extension.update y devuelve solo versiones (nunca la fila de instalacion)', async () => {
        backend((u) => u.includes('/manager/extensions/update'), () => res(200, { success: true, updated: true, from: '1.0.0', to: '1.1.0', authData: { accessToken: SECRET }, settings: { credentials: { K: SECRET } } }));
        const r = await updateAPI(json('/x', { domainId: 'dom1', extensionId: 'core-signature', authData: { accessToken: SECRET }, settings: { a: SECRET } }) as any);
        expect(r.status).toBe(200);
        const data = await r.json();
        expect(data).toEqual({ success: true, updated: true, from: '1.0.0', to: '1.1.0' });
        const [, init] = callsTo('/manager/extensions/update')[0];
        expect(JSON.parse(init.body)).toEqual({ domainId: 'dom1', extensionId: 'core-signature' });
        expect(init.headers.Cookie).toBe('auth_session=abc');
        const call = (auditLog as any).mock.calls.find((c: any[]) => c[0] === 'admin.extension.update');
        expect(call[1]).toMatchObject({ extensionId: 'core-signature', domainId: 'dom1', outcome: 'ok', from: '1.0.0', to: '1.1.0' });
        expect(JSON.stringify((auditLog as any).mock.calls)).not.toContain(SECRET);
    });

    it('rechaza un dominio ajeno a esta instancia sin llamar al backend', async () => {
        const r = await updateAPI(json('/x', { domainId: 'otro', extensionId: 'e' }) as any);
        expect(r.status).toBe(403);
        expect((await r.json()).code).toBe('domain_mismatch');
        expect(callsTo('/manager/extensions/update')).toHaveLength(0);
    });

    it('catalogo con version no valida: el codigo EXTENSION_INVALID llega al navegador; 403 => manager_session_required; 404 => not_installed', async () => {
        backend((u) => u.includes('/manager/extensions/update'), () => res(422, { error: 'x', code: 'EXTENSION_INVALID', details: 'mounts[0].handler: ...' }));
        const invalid = await updateAPI(json('/x', { domainId: 'dom1', extensionId: 'core-signature' }) as any);
        expect((await invalid.json()).code).toBe('EXTENSION_INVALID');
        handlers = handlers.slice(1);
        backend((u) => u.includes('/manager/extensions/update'), () => res(403, { error: 'Unauthorized domain access' }));
        expect((await (await updateAPI(json('/x', { domainId: 'dom1', extensionId: 'e' }) as any)).json()).code).toBe('manager_session_required');
        handlers = handlers.slice(1);
        backend((u) => u.includes('/manager/extensions/update'), () => res(404, { error: 'Extension is not installed' }));
        expect((await (await updateAPI(json('/x', { domainId: 'dom1', extensionId: 'e' }) as any)).json()).code).toBe('not_installed');
    });
});

describe('installed', () => {
    const installedBackend = {
        extensions: [
            {
                extensionId: 'core-notion', name: 'Notion', description: 'd', enabled: true, state: 'enabled', installedVersion: '1.2.0', catalogVersion: '1.3.0',
                isPaid: false, ui: { order: 10, secretThing: SECRET }, hasCredentials: true,
                authData: { accessToken: SECRET }, credentials: { NOTION_API_KEY: SECRET }, settings: { credentials: { NOTION_API_KEY: SECRET } },
                template: { id: 'core-notion', permissions: ['ENV_READ:NOTION_API_KEY'], apiToken: SECRET, mounts: [{ point: 'SETTINGS_PANEL', component: { type: 'TEXT', props: { text: SECRET } } }] },
            },
            { extensionId: '../bad', name: 'x', enabled: true },
        ],
    };

    it('devuelve lista blanca: ni authData, ni credenciales, ni settings, ni props de componentes', async () => {
        backend((u) => u.includes('/api/manager/extensions?'), () => res(200, installedBackend));
        sql.query.mockResolvedValue([{ id: 'core-notion' }]);
        const r = await installedGET(get('/api/admin/extensions/installed?domainId=dom1') as any);
        expect(r.status).toBe(200);
        const data = await r.json();
        expect(JSON.stringify(data)).not.toContain(SECRET);
        expect(data.managerSessionRequired).toBe(false);
        expect(data.extensions).toHaveLength(1);
        expect(data.extensions[0]).toMatchObject({ extensionId: 'core-notion', enabled: true, installedVersion: '1.2.0', catalogVersion: '1.3.0', ui: { order: 10 }, hasCredentials: true });
        expect(data.errorExtensionIds).toEqual(['core-notion']);
        expect(data.capabilities).toEqual({ test: false, testReason: 'user_context_required' });
        const [url, init] = callsTo('/api/manager/extensions?')[0];
        expect(String(url)).toContain('domainId=dom1');
        expect(init.headers.Cookie).toBe('auth_session=abc');
    });

    it('sin sesion de gestor (401/403 del backend): 200 con managerSessionRequired y lista vacia', async () => {
        for (const status of [401, 403]) {
            backend((u) => u.includes('/api/manager/extensions?'), () => res(status, { error: 'x' }));
            const r = await installedGET(get('/api/admin/extensions/installed?domainId=dom1') as any);
            expect(r.status).toBe(200);
            expect(await r.json()).toMatchObject({ managerSessionRequired: true, extensions: [] });
        }
    });

    it('valida domainId (400) y que sea el de la instancia (403)', async () => {
        expect((await installedGET(get('/api/admin/extensions/installed') as any)).status).toBe(400);
        const other = await installedGET(get('/api/admin/extensions/installed?domainId=ajeno') as any);
        expect(other.status).toBe(403);
        expect(callsTo('/api/manager/extensions?')).toHaveLength(0);
    });

    it('si no se puede resolver el dominio de la instancia falla cerrado (503)', async () => {
        handlers = [(url) => (url.includes('/api/config') ? res(200, { config: { name: 'BloomX Default' } }) : undefined)];
        const r = await installedGET(get('/api/admin/extensions/installed?domainId=dom1') as any);
        expect(r.status).toBe(503);
    });

    it('un admin de tipo user con clave de firma declara que "Probar" esta soportado', async () => {
        const { privateKey } = generateKeyPairSync('ed25519');
        process.env.BLOOMX_DOMAIN_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
        guard.result = { ok: true, actor: { kind: 'user', id: 'u1', email: 'u@b.c' } };
        backend((u) => u.includes('/api/manager/extensions?'), () => res(401, {}));
        const data = await (await installedGET(get('/api/admin/extensions/installed?domainId=dom1') as any)).json();
        expect(data.capabilities).toEqual({ test: true });
    });
});

describe('catalog', () => {
    const item = {
        id: 'core-notion', name: 'Notion', description: 'desc', version: '1.3.0', authType: 'API_KEY', isPaid: true, price: '4.5', currency: 'USD',
        authConfig: { clientSecret: SECRET }, scriptUrl: 'https://b2/x.js', filePath: 'p',
        template: {
            id: 'core-notion', permissions: ['ENV_READ:NOTION_API_KEY', 'READ_EMAIL'], category: 'productivity', apiToken: SECRET,
            api: { functions: { testConnection: { handler: 'h', secretOpt: SECRET }, sync: { handler: 's' } } },
            mounts: [{ point: 'SETTINGS_PANEL', component: { type: 'INPUT', props: { name: 'apiBase', label: 'Base', defaultValue: 'x' } } }],
        },
    };

    it('devuelve forma acotada: sin authConfig/scriptUrl/props de componentes/valores', async () => {
        backend((u) => u.includes('/public-list'), () => res(200, [item, { nope: true }]));
        const r = await catalogGET(get('/api/admin/extensions/catalog') as any);
        expect(r.status).toBe(200);
        const data = await r.json();
        expect(JSON.stringify(data)).not.toContain(SECRET);
        expect(JSON.stringify(data)).not.toContain('b2/x.js');
        expect(data.extensions).toHaveLength(1);
        const ext = data.extensions[0];
        expect(ext).toMatchObject({ id: 'core-notion', version: '1.3.0', isPaid: true, price: '4.5' });
        expect(ext.template.api.functions).toEqual({ testConnection: {}, sync: {} });
        expect(ext.template.testConnection).toBe(true);
        expect(ext.template.settingsFields).toEqual([{ name: 'apiBase', type: 'INPUT', label: 'Base', defaultValue: 'x' }]);
        expect(ext.template.mounts).toEqual([{ point: 'SETTINGS_PANEL' }]);
    });

    it('usa cache (una sola llamada al backend) y fresh=1 la salta', async () => {
        backend((u) => u.includes('/public-list'), () => res(200, [item]));
        await catalogGET(get('/api/admin/extensions/catalog') as any);
        await catalogGET(get('/api/admin/extensions/catalog') as any);
        expect(callsTo('/public-list')).toHaveLength(1);
        await catalogGET(get('/api/admin/extensions/catalog?fresh=1') as any);
        expect(callsTo('/public-list')).toHaveLength(2);
    });

    it('timeout o error del backend => 502 y usa senal de timeout', async () => {
        backend((u) => u.includes('/public-list'), () => () => { throw new DOMException('timeout', 'TimeoutError'); });
        const r = await catalogGET(get('/api/admin/extensions/catalog') as any);
        expect(r.status).toBe(502);
        expect((await r.json()).code).toBe('backend_unavailable');
        const [, init] = callsTo('/public-list')[0];
        expect(init.signal).toBeInstanceOf(AbortSignal);

        __resetCatalogCache();
        backend((u) => u.includes('/public-list'), () => res(500, {}));
        expect((await catalogGET(get('/api/admin/extensions/catalog') as any)).status).toBe(502);
    });
});

describe('test (probar conexion)', () => {
    const catalog = [
        { id: 'with-test', name: 'W', description: '', version: '1.0.0', isPaid: false, template: { api: { functions: { testConnection: { handler: 'h' } } } } },
        { id: 'no-test', name: 'N', description: '', version: '1.0.0', isPaid: false, template: { api: { functions: { other: { handler: 'h' } } } } },
    ];
    const withKey = () => {
        const { privateKey } = generateKeyPairSync('ed25519');
        process.env.BLOOMX_DOMAIN_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
        guard.result = { ok: true, actor: { kind: 'user', id: 'u1', email: 'u@b.c' } };
        backend((u) => u.includes('/public-list'), () => res(200, catalog));
    };

    it('501 not_supported con sesion de gestor (no hay usuario de la app) y no ejecuta nada', async () => {
        const r = await testAPI(json('/x', { extensionId: 'with-test' }) as any);
        expect(r.status).toBe(501);
        expect(await r.json()).toMatchObject({ code: 'not_supported', reason: 'user_context_required' });
        expect(callsTo('/extension/execute')).toHaveLength(0);
    });

    it('501 not_supported sin clave de firma del dominio (modo legado: sin credenciales)', async () => {
        guard.result = { ok: true, actor: { kind: 'user', id: 'u1', email: 'u@b.c' } };
        const r = await testAPI(json('/x', { extensionId: 'with-test' }) as any);
        expect(r.status).toBe(501);
        expect((await r.json()).reason).toBe('signing_key_required');
    });

    it('valida la entrada (400), extension inexistente (404) y sin funcion de prueba (400)', async () => {
        withKey();
        expect((await testAPI(json('/x', { extensionId: '../../x' }) as any)).status).toBe(400);
        expect((await testAPI(json('/x', { extensionId: 'unknown' }) as any)).status).toBe(404);
        const none = await testAPI(json('/x', { extensionId: 'no-test' }) as any);
        expect(none.status).toBe(400);
        expect((await none.json()).code).toBe('no_test_function');
        expect(callsTo('/extension/execute')).toHaveLength(0);
    });

    it('ejecuta testConnection firmada, con timeout, y devuelve SOLO ok (nada del proveedor); audita', async () => {
        withKey();
        backend((u) => u.includes('/extension/execute'), () => res(200, { success: true, result: { token: SECRET, accounts: [SECRET] } }));
        const r = await testAPI(json('/x', { extensionId: 'with-test' }) as any);
        expect(r.status).toBe(200);
        const text = JSON.stringify(await r.json());
        expect(text).toBe(JSON.stringify({ ok: true }));
        expect(text).not.toContain(SECRET);
        const [, init] = callsTo('/extension/execute')[0];
        expect(JSON.parse(init.body)).toEqual({ extensionId: 'with-test', action: 'testConnection', params: {}, context: {} });
        expect(init.headers['X-BloomX-Signature']).toBeTruthy();
        expect(init.headers['X-User-ID']).toBe('u1');
        expect(init.headers['X-BloomX-Domain']).toBe('mail.test');
        expect(init.signal).toBeInstanceOf(AbortSignal);
        expect((auditLog as any).mock.calls.find((c: any[]) => c[0] === 'admin.extension.test')[1]).toMatchObject({ extensionId: 'with-test', outcome: 'ok' });
    });

    it('fallos: codigos estables sin texto del backend; una funcion que devuelve ok:false cuenta como fallo', async () => {
        withKey();
        backend((u) => u.includes('/extension/execute'), () => res(401, { success: false, error: `AUTH_REQUIRED ${SECRET}` }));
        let body = await (await testAPI(json('/x', { extensionId: 'with-test' }) as any)).json();
        expect(body).toEqual({ ok: false, message: 'auth_required' });

        backend((u) => u.includes('/extension/execute'), () => res(500, { success: false, error: `boom ${SECRET}` }));
        body = await (await testAPI(json('/x', { extensionId: 'with-test' }) as any)).json();
        expect(body).toEqual({ ok: false, message: 'failed' });
        expect(JSON.stringify(body)).not.toContain(SECRET);

        backend((u) => u.includes('/extension/execute'), () => res(200, { success: true, result: { ok: false } }));
        expect((await (await testAPI(json('/x', { extensionId: 'with-test' }) as any)).json()).ok).toBe(false);

        const calls = (auditLog as any).mock.calls.filter((c: any[]) => c[0] === 'admin.extension.test');
        expect(calls.map((c: any[]) => c[1].outcome)).toEqual(['failed', 'failed', 'failed']);
    });

    it('timeout de 10 s => { ok:false, message:"timeout" }', async () => {
        withKey();
        backend((u) => u.includes('/extension/execute'), () => () => { throw new DOMException('timed out', 'TimeoutError'); });
        const r = await testAPI(json('/x', { extensionId: 'with-test' }) as any);
        expect(r.status).toBe(200);
        expect(await r.json()).toEqual({ ok: false, message: 'timeout' });
    });
});

describe('status de extension', () => {
    const call = (id: string) => statusGET(get(`/api/admin/extensions/${id}/status`) as any, { params: Promise.resolve({ id }) });

    it('devuelve entradas resumidas y enmascaradas (sin data) y consulta parametrizada', async () => {
        const row = (id: string, event: string, outcome: string | null, status: string | null, extra: Record<string, unknown> = {}) => ({
            id, ts: new Date('2026-09-01T10:00:00Z'), event, outcome, status, ...extra,
        });
        sql.query
            .mockResolvedValueOnce([
                row('1', 'admin.extension.credentials', 'failed', '503', { data: { set: ['NOTION_API_KEY'], token: SECRET } }),
                row('2', 'admin.extension.install', 'ok', '200'),
            ])
            .mockResolvedValueOnce([row('1', 'admin.extension.credentials', 'failed', '503')])
            .mockResolvedValueOnce([{ n: BigInt(3) }]);
        const r = await call('core-notion');
        expect(r.status).toBe(200);
        const data = await r.json();
        expect(JSON.stringify(data)).not.toContain(SECRET);
        expect(JSON.stringify(data)).not.toContain('NOTION_API_KEY');
        expect(data).toMatchObject({ extensionId: 'core-notion', errors24h: 3 });
        expect(data.lastEvent).toEqual({ id: '1', event: 'admin.extension.credentials', ts: '2026-09-01T10:00:00.000Z', outcome: 'failed', status: 503 });
        expect(data.lastError.outcome).toBe('failed');
        expect(data.entries).toHaveLength(2);
        for (const [sqlText, ...params] of sql.query.mock.calls) {
            expect(sqlText).toContain('$1');
            expect(sqlText).not.toContain('core-notion');
            expect(params[0]).toBe('core-notion');
        }
        expect(sql.query.mock.calls[0][0]).toContain('LIMIT 20');
    });

    it('sin registros => vacio y 0', async () => {
        const data = await (await call('nueva')).json();
        expect(data).toEqual({ extensionId: 'nueva', lastEvent: null, lastError: null, errors24h: 0, entries: [] });
    });

    it('tabla inexistente (42P01) => tolerante, sin registros', async () => {
        sql.query.mockRejectedValue(Object.assign(new Error('relation "AuditEvent" does not exist'), { code: '42P01' }));
        const r = await call('x');
        expect(r.status).toBe(200);
        expect((await r.json()).entries).toEqual([]);
    });

    it('id no valido => 400 sin consultar', async () => {
        const r = await call("x'; DROP TABLE");
        expect(r.status).toBe(400);
        expect(sql.query).not.toHaveBeenCalled();
    });
});

describe('mandatory (obligatoria para todos)', () => {
    it('valida con zod: mandatory booleano e ids acotados (400 sin tocar el backend)', async () => {
        for (const body of [
            { domainId: 'dom1', extensionId: 'e', mandatory: 'si' },
            { domainId: 'dom1', extensionId: '../x', mandatory: true },
            { domainId: '', extensionId: 'e', mandatory: true },
            { domainId: 'dom1', extensionId: 'e' },
        ]) {
            const r = await mandatoryAPI(json('/x', body) as any);
            expect(r.status).toBe(400);
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rechaza un dominio que no es el de esta instancia (403 domain_mismatch) sin llamar al backend', async () => {
        const r = await mandatoryAPI(json('/x', { domainId: 'otro-dominio', extensionId: 'e', mandatory: true }) as any);
        expect(r.status).toBe(403);
        expect((await r.json()).code).toBe('domain_mismatch');
        expect(callsTo('/manager/extensions/mandatory')).toHaveLength(0);
    });

    it('reenvia solo tres campos + cookie, audita extension.mandatory_changed y devuelve {success, mandatory, effective}', async () => {
        backend((u) => u.includes('/manager/extensions/mandatory'), () => res(200, { success: true, mandatory: true, effective: true, authData: { accessToken: SECRET } }));
        const r = await mandatoryAPI(json('/x', { domainId: 'dom1', extensionId: 'core-dlp', mandatory: true, settings: { token: SECRET } }) as any);
        expect(r.status).toBe(200);
        expect(await r.json()).toEqual({ success: true, mandatory: true, effective: true });
        const [, init] = callsTo('/manager/extensions/mandatory')[0];
        expect(JSON.parse(init.body)).toEqual({ domainId: 'dom1', extensionId: 'core-dlp', mandatory: true });
        expect(init.headers.Cookie).toBe('auth_session=abc');
        const audited = (auditLog as any).mock.calls.find((c: any[]) => c[0] === 'admin.extension.mandatory_changed');
        expect(audited[1]).toMatchObject({ extensionId: 'core-dlp', domainId: 'dom1', mandatory: true, outcome: 'ok', actorKind: 'manager' });
        expect(JSON.stringify((auditLog as any).mock.calls)).not.toContain(SECRET);
    });

    it('errores del backend: 401/403 => manager_session_required, 404 => not_installed, 409 => EXTENSION_NOT_ENABLED; audita outcome failed', async () => {
        for (const [status, code, httpStatus] of [[401, 'manager_session_required', 403], [403, 'manager_session_required', 403], [404, 'not_installed', 404], [409, 'EXTENSION_NOT_ENABLED', 409]] as const) {
            handlers = [(url) => (url.includes('/api/config') ? res(200, { config: { id: 'dom1', name: 'mail.test' } }) : undefined)];
            backend((u) => u.includes('/manager/extensions/mandatory'), () => res(status, { error: 'texto interno' }));
            (auditLog as any).mockClear();
            const r = await mandatoryAPI(json('/x', { domainId: 'dom1', extensionId: 'e', mandatory: true }) as any);
            expect(r.status, String(status)).toBe(httpStatus);
            const body = await r.json();
            expect(body.code, String(status)).toBe(code);
            expect(JSON.stringify(body)).not.toContain('texto interno');
            const audited = (auditLog as any).mock.calls.find((c: any[]) => c[0] === 'admin.extension.mandatory_changed');
            expect(audited[1]).toMatchObject({ outcome: 'failed', status });
        }
    });
});
