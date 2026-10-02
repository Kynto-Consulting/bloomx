import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });

beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_BACKEND_URL', 'https://backend.test'); vi.stubEnv('BLOOMX_DOMAIN_PRIVATE_KEY', ''); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

const res = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const base = { domain: 'brand.com', userId: 'u1', email: 'u1@brand.com', extensionId: 'core-zoom', action: 'status' };

describe('bridge callExtension', () => {
    it('envia extensionId/action/params/context al backend con identidad de la sesion y lee el modo de autenticacion', async () => {
        const { callExtension } = await import('../bridge');
        const f = vi.fn(async () => res(200, { success: true, result: { configured: true } }, { 'x-bloomx-auth': 'legacy' }));
        const out = await callExtension({ ...base, params: { a: 1 }, context: { auth: { zoom: { accessToken: 'T' } } }, fetchImpl: f as any });
        expect(out).toMatchObject({ ok: true, result: { configured: true }, authMode: 'legacy' });
        const [url, init] = f.mock.calls[0] as any;
        expect(url).toBe('https://backend.test/api/extension/execute');
        expect(JSON.parse(init.body)).toEqual({ extensionId: 'core-zoom', action: 'status', params: { a: 1 }, context: { auth: { zoom: { accessToken: 'T' } } } });
        expect(init.headers['X-User-ID']).toBe('u1');
        expect(init.headers['X-BloomX-Domain']).toBe('brand.com');
        expect(init.headers.Authorization).toBeUndefined(); // nunca el JWT de sesion
    });

    it('clasifica errores: no instalada, accion inexistente, AUTH_REQUIRED, 429, timeout, tipados por prefijo, red caida', async () => {
        const { callExtension } = await import('../bridge');
        const run = async (r: Response | Error) => callExtension({ ...base, fetchImpl: (async () => { if (r instanceof Error) throw r; return r; }) as any });

        expect(await run(res(404, { error: 'Extension is not installed for this domain' }))).toMatchObject({ ok: false, kind: 'not_installed' });
        expect(await run(res(404, { error: 'Action not found on extension' }))).toMatchObject({ ok: false, kind: 'rejected', error: { code: 'not_supported' } });
        expect(await run(res(401, { success: false, error: 'AUTH_REQUIRED' }))).toMatchObject({ error: { code: 'not_connected' } });
        expect(await run(res(429, { error: 'Too many requests' }, { 'retry-after': '7' }))).toMatchObject({ error: { code: 'rate_limited', retryAfter: 7 } });
        expect(await run(res(408, { success: false, error: 'Extension script timed out' }))).toMatchObject({ error: { code: 'provider_error' } });
        expect(await run(res(500, { success: false, error: 'rate_limited: Zoom is busy [retryAfter=30]' }))).toMatchObject({ error: { code: 'rate_limited', retryAfter: 30, message: 'Zoom is busy' } });
        expect(await run(res(500, { success: false, error: 'token_revoked: reconnect Zoom' }))).toMatchObject({ error: { code: 'token_revoked' } });
        expect(await run(res(500, { success: false, error: 'Execution failed' }))).toMatchObject({ error: { code: 'provider_error' } });
        expect(await run(res(500, {}))).toMatchObject({ kind: 'unreachable', error: { code: 'unavailable' } });
        expect(await run(new Error('ECONNREFUSED'))).toMatchObject({ ok: false, kind: 'unreachable', error: { code: 'unavailable' } });
    });
});

describe('status por proveedor', () => {
    const actor = { userId: 'u1', email: 'u1@brand.com', domain: 'brand.com' };
    const none = async () => ({ auth: {}, problems: { google: 'not_connected' as const, zoom: 'not_connected' as const } });

    const extOk = (over: Record<string, unknown>) => async () => ({ ok: true as const, authMode: 'signed' as const, result: over });

    it('Zoom S2S configurado por el panel: configured, fuente instancia, sin boton Conectar', async () => {
        const { listProviderStatuses } = await import('../status');
        const call = vi.fn(async (init: any) =>
            init.extensionId === 'core-zoom'
                ? { ok: true as const, authMode: 'signed' as const, result: { configured: true, connected: true, mode: 'server-to-server', source: 'instance', modes: [{ id: 'server-to-server', available: true }, { id: 'user-oauth', available: true }] } }
                : { ok: false as const, kind: 'not_installed' as const, authMode: null, error: new (await import('../types')).ConferencingError('unavailable', 'x') },
        );
        const list = await listProviderStatuses(actor, { deps: { call, linked: none, env: {} } });
        const zoom = list.find((p) => p.id === 'zoom')!;
        expect(zoom).toMatchObject({ configured: true, connected: true, mode: 'server-to-server', source: 'instance', origin: 'extension', connect: null });
        expect(list.map((p) => p.id)).toEqual(['google-meet', 'zoom', 'microsoft-teams', 'custom']);
        expect(list.find((p) => p.id === 'custom')).toMatchObject({ configured: true, mode: 'custom-link' });
        // Solo viaja el status de la cuenta de ese proveedor al contexto (sin tokens de otros)
        const zoomCall = call.mock.calls.find((c: any) => c[0].extensionId === 'core-zoom')![0] as any;
        expect(zoomCall.context).toEqual({ auth: {} });
    });

    it('extension sin configurar: Conectar por OAuth si el frontend tiene cliente OAuth; si no, a Ajustes', async () => {
        const { listProviderStatuses } = await import('../status');
        const call = extOk({ configured: false, connected: false, mode: 'user-oauth', source: 'none' });
        const withOauth = await listProviderStatuses(actor, { deps: { call, linked: none, env: { ZOOM_CLIENT_ID: 'id', ZOOM_CLIENT_SECRET: 's', GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 'gs' } } });
        expect(withOauth.find((p) => p.id === 'zoom')).toMatchObject({ configured: false, reason: 'not_connected', connect: { type: 'oauth', url: '/api/auth/zoom' } });
        expect(withOauth.find((p) => p.id === 'google-meet')).toMatchObject({ connect: { type: 'oauth', url: '/api/auth/google' } });
        const without = await listProviderStatuses(actor, { deps: { call, linked: none, env: {} } });
        expect(without.find((p) => p.id === 'zoom')!.connect).toEqual({ type: 'settings', section: 'integrations' });
    });

    it('token revocado del usuario => reason token_revoked (Reconectar); dominio legado => legacy_domain', async () => {
        const { listProviderStatuses } = await import('../status');
        const revoked = async () => ({ auth: {}, problems: { google: 'token_revoked' as const, zoom: 'not_connected' as const } });
        const call = extOk({ configured: false, connected: false, source: 'none' });
        const list = await listProviderStatuses(actor, { deps: { call, linked: revoked, env: {} } });
        expect(list.find((p) => p.id === 'google-meet')!.reason).toBe('token_revoked');
        const legacyCall = async () => ({ ok: true as const, authMode: 'legacy' as const, result: { configured: false, source: 'none' } });
        const legacy = await listProviderStatuses(actor, { deps: { call: legacyCall, linked: none, env: {} } });
        expect(legacy.find((p) => p.id === 'zoom')!.reason).toBe('legacy_domain');
    });

    it('extension no instalada: el adaptador del host ofrece la cuenta vinculada del usuario; sin cuenta, motivo extension_not_installed', async () => {
        const { listProviderStatuses } = await import('../status');
        const { ConferencingError } = await import('../types');
        const call = async () => ({ ok: false as const, kind: 'not_installed' as const, authMode: null, error: new ConferencingError('unavailable', 'x') });
        const withGoogle = async () => ({ auth: { google: { accessToken: 'T', accountId: 'a', source: 'user-account' as const } }, problems: { zoom: 'not_connected' as const } });
        const list = await listProviderStatuses(actor, { deps: { call, linked: withGoogle, env: {} } });
        expect(list.find((p) => p.id === 'google-meet')).toMatchObject({ configured: true, origin: 'core', source: 'user-oauth', mode: 'google-account', connect: null });
        expect(list.find((p) => p.id === 'zoom')).toMatchObject({ configured: false, reason: 'extension_not_installed', origin: 'core' });
    });

    it('Teams: sin extension -> extension_not_installed y conexion en Ajustes (sin OAuth directo ni modo de instancia)', async () => {
        const { listProviderStatuses } = await import('../status');
        const { ConferencingError } = await import('../types');
        const call = async () => ({ ok: false as const, kind: 'not_installed' as const, authMode: null, error: new ConferencingError('unavailable', 'x') });
        const none = async () => ({ auth: {}, problems: {} });
        const t = (await listProviderStatuses(actor, { deps: { call, linked: none, env: { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y' } } })).find((p) => p.id === 'microsoft-teams')!;
        expect(t).toMatchObject({ configured: false, reason: 'extension_not_installed', extensionId: 'core-microsoft-teams', connect: { type: 'settings', section: 'integrations' } });
        expect(t.modes).toEqual([{ id: 'microsoft-account', available: true }]);
    });

    it('Teams: la extension informa cuenta conectada; el host no le inyecta tokens', async () => {
        const { listProviderStatuses } = await import('../status');
        const calls: any[] = [];
        const call = async (init: any) => { calls.push(init); return { ok: true as const, authMode: 'signed' as const, result: { configured: true, connected: true, mode: 'microsoft-account', source: 'user-oauth', account: 'a@b.com' } }; };
        const none = async () => ({ auth: {}, problems: {} });
        const t = (await listProviderStatuses(actor, { deps: { call, linked: none, env: {} } })).find((p) => p.id === 'microsoft-teams')!;
        expect(t).toMatchObject({ configured: true, origin: 'extension', mode: 'microsoft-account', source: 'user-oauth', account: 'a@b.com' });
        expect(calls.find((c) => c.extensionId === 'core-microsoft-teams').context).toEqual({ auth: {} });
    });

    it('sanea lo que devuelve la extension: modos/fuentes desconocidos, cuenta larga', async () => {
        const { listProviderStatuses } = await import('../status');
        const call = extOk({ configured: true, mode: 'root', source: 'hacked', account: 'x'.repeat(500), modes: [{ id: 'nope' }, { id: 'service-account', available: false }] });
        const z = (await listProviderStatuses(actor, { deps: { call, linked: none, env: {} } })).find((p) => p.id === 'zoom')!;
        expect(z.mode).toBeNull();
        expect(z.source).toBe('none');
        expect(z.account!.length).toBe(200);
        expect(z.modes).toEqual([{ id: 'service-account', available: false }]);
    });
});
