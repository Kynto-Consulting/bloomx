import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/admin-auth', () => {
    const guardFn = vi.fn(async () => ({ ok: true, actor: { kind: 'manager', id: 'm1', email: 'a@b.c' } }));
    return { requireAdmin: guardFn, requireLevel: (_min: number, ...a: unknown[]) => (guardFn as (...x: unknown[]) => unknown)(...a) };
});
vi.mock('@/lib/security', () => ({ auditLog: vi.fn(), getClientIp: () => '1.2.3.4' }));

import { GET, PUT, POST } from '../config/route';
import { auditLog } from '@/lib/security';

const fetchMock = vi.fn();
const backend = (status: number, body: any) => ({ ok: status < 300, status, json: async () => body });

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    (auditLog as any).mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const put = (body: unknown) =>
    new Request('https://f.test/api/admin/extensions/config', { method: 'PUT', headers: { 'content-type': 'application/json', cookie: 'auth_session=abc' }, body: JSON.stringify(body) });

describe('proxy de ajustes por dominio', () => {
    it('GET reenvia la cookie y reconstruye la respuesta con lista blanca (sin secretos ni extras)', async () => {
        fetchMock.mockResolvedValueOnce(
            backend(200, {
                schema: { fields: [] },
                values: { keywords: ['a'], mode: 'strict' },
                sources: { keywords: 'domain', mode: 'server-env', otra: 'inventada' },
                envLegacy: ['mode', 'MAL NOMBRE!'],
                importable: ['mode'],
                secrets: [{ name: 'API_KEY', configured: true, source: 'domain', value: 'SECRETO' }, { name: 'min', configured: true }],
                checklist: { done: 1, total: 2, items: [{ key: 'API_KEY', secret: true, ok: true, extra: 'SECRETO' }] },
                meta: { updatedAt: '2026-01-01T00:00:00Z', updatedBy: 'm1', token: 'SECRETO' },
                limits: { maxConfigBytes: 32768 },
                token: 'SECRETO',
            }),
        );
        const res = await GET(new Request('https://f.test/api/admin/extensions/config?domainId=d&extensionId=e', { headers: { cookie: 'auth_session=abc' } }));
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain('/api/extension/config?domainId=d&extensionId=e');
        expect(init.headers.Cookie).toBe('auth_session=abc');
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        const data = await res.json();
        expect(data.sources).toEqual({ keywords: 'domain', mode: 'server-env' });
        expect(data.envLegacy).toEqual(['mode']);
        expect(data.importable).toEqual(['mode']);
        expect(data.secrets).toEqual([{ name: 'API_KEY', configured: true, source: 'domain' }]);
        expect(data.checklist).toEqual({ done: 1, total: 2, items: [{ key: 'API_KEY', secret: true, ok: true }] });
        expect(data.limits).toEqual({ maxConfigBytes: 32768 });
        expect(JSON.stringify(data)).not.toContain('SECRETO');
        expect(data.schema).toBeUndefined();
    });

    it('GET exige domainId y extensionId', async () => {
        const res = await GET(new Request('https://f.test/api/admin/extensions/config?domainId=d'));
        expect(res.status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('PUT reenvia solo values y audita NOMBRES de clave, nunca valores', async () => {
        fetchMock.mockResolvedValueOnce(backend(200, { schema: { fields: [] }, values: {} })); // preflight de ids de usuario (sin campos user)
        fetchMock.mockResolvedValueOnce(backend(200, { success: true, values: { keywords: ['x'] }, sources: { keywords: 'domain' } }));
        const res = await PUT(put({ domainId: 'd', extensionId: 'e', values: { keywords: ['valor-privado'], mode: null }, extra: 'no' }));
        expect(res.status).toBe(200);
        const [, init] = fetchMock.mock.calls[1];
        expect(init.method).toBe('PUT');
        expect(JSON.parse(init.body)).toEqual({ domainId: 'd', extensionId: 'e', values: { keywords: ['valor-privado'], mode: null } });
        expect(fetchMock.mock.calls[0][1].method).toBe('GET');
        const [event, data] = (auditLog as any).mock.calls[0];
        expect(event).toBe('admin.extension.config');
        expect(data).toMatchObject({ outcome: 'ok', status: 200, set: ['keywords'], removed: ['mode'], action: 'update' });
        expect(JSON.stringify(data)).not.toContain('valor-privado');
    });

    it('PUT reset reenvia reset:true', async () => {
        fetchMock.mockResolvedValueOnce(backend(200, { success: true }));
        await PUT(put({ domainId: 'd', extensionId: 'e', reset: true, values: { a: 1 } }));
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ domainId: 'd', extensionId: 'e', reset: true });
        expect((auditLog as any).mock.calls[0][1]).toMatchObject({ action: 'reset', set: [], removed: [] });
    });

    it('PUT 422 conserva errors[{path,message}] saneados (<=200) y audita el fallo', async () => {
        fetchMock.mockResolvedValueOnce(backend(200, { schema: { fields: [] }, values: {} })); // preflight de ids de usuario (sin campos user)
        fetchMock.mockResolvedValueOnce(
            backend(422, { error: 'Invalid', errors: [{ path: 'values.keywords', message: 'x'.repeat(500) }, { path: 3, message: 'no' }], detail: 'SECRETO' }),
        );
        const res = await PUT(put({ domainId: 'd', extensionId: 'e', values: { keywords: 'x' } }));
        expect(res.status).toBe(422);
        const data = await res.json();
        expect(data.error).toBe('Invalid');
        expect(data.errors).toHaveLength(1);
        expect(data.errors[0].path).toBe('values.keywords');
        expect(data.errors[0].message).toHaveLength(200);
        expect(JSON.stringify(data)).not.toContain('SECRETO');
        expect((auditLog as any).mock.calls[0][1].outcome).toBe('failed');
    });

    it('PUT rechaza cuerpos incompletos', async () => {
        expect((await PUT(put({ domainId: 'd', extensionId: 'e' }))).status).toBe(400);
        expect((await PUT(put({ domainId: 'd', extensionId: 'e', values: [1] }))).status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('POST import-env solo acepta esa accion, filtra keys y audita las importadas', async () => {
        fetchMock.mockResolvedValueOnce(backend(200, { success: true, imported: ['mode', 'valor raro SECRETO'], importable: [] }));
        const res = await POST(
            new Request('https://f.test/x', { method: 'POST', headers: { cookie: 'c=1' }, body: JSON.stringify({ domainId: 'd', extensionId: 'e', action: 'import-env', keys: ['mode', 'mal nombre'], credentials: { A: 'SECRETO' } }) }),
        );
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ domainId: 'd', extensionId: 'e', action: 'import-env', keys: ['mode'] });
        const data = await res.json();
        expect(data.imported).toEqual(['mode']);
        expect(JSON.stringify(data)).not.toContain('SECRETO');
        expect((auditLog as any).mock.calls[0][1]).toMatchObject({ action: 'import-env', set: ['mode'] });

        const bad = await POST(new Request('https://f.test/x', { method: 'POST', body: JSON.stringify({ domainId: 'd', extensionId: 'e', action: 'otra' }) }));
        expect(bad.status).toBe(400);
    });

    it('PUT reenvia secrets por elemento y audita solo NOMBRES (nunca valores)', async () => {
        fetchMock.mockResolvedValueOnce(backend(200, { success: true, secretsSet: ['endpoints.ep-1.secret', 'mal nombre', 'x.Y.z'] }));
        const res = await PUT(put({ domainId: 'd', extensionId: 'e', secrets: { 'endpoints.ep-1.secret': 'whsec-VALOR', 'endpoints.ep-2.secret': null, 'bad name': 'x' } }));
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).secrets['endpoints.ep-1.secret']).toBe('whsec-VALOR');
        const data = await res.json();
        expect(data.secretsSet).toEqual(['endpoints.ep-1.secret']);
        const audit = (auditLog as any).mock.calls[0][1];
        expect(audit.secretsSet).toEqual(['endpoints.ep-1.secret']);
        expect(audit.secretsRemoved).toEqual(['endpoints.ep-2.secret']);
        expect(JSON.stringify(audit)).not.toContain('VALOR');
    });

    it('PUT 422 conserva code/params saneados', async () => {
        fetchMock.mockResolvedValueOnce(backend(200, { schema: { fields: [] }, values: {} })); // preflight de ids de usuario (sin campos user)
        fetchMock.mockResolvedValueOnce(backend(422, { error: 'Invalid', errors: [{ path: 'values.endpoints', message: 'm', code: 'itemField', params: { index: 1, field: 'url', evil: { a: 1 }, 'bad key': 'x' } }, { path: 'secrets.a.b.c', message: 'm', code: '<script>' }] }));
        const data = await (await PUT(put({ domainId: 'd', extensionId: 'e', values: { endpoints: [] } }))).json();
        expect(data.errors[0]).toEqual({ path: 'values.endpoints', message: 'm', code: 'itemField', params: { index: 1, field: 'url' } });
        expect(data.errors[1].code).toBeUndefined();
    });

    it('POST run-action: valida ids, audita config.action y filtra result/runLog', async () => {
        fetchMock.mockResolvedValueOnce(
            backend(200, {
                ok: true,
                result: { status: 'ok', code: 200, latencyMs: 42, message: 'x'.repeat(500), report: Array.from({ length: 30 }, (_, i) => 'linea ' + i), secret: 'SECRETO' },
                runLog: [{ ts: '2026-01-01T00:00:00Z', event: 'EMAIL_SENT', target: 'ep-1', status: 'ok', code: 200, attempts: 1, latencyMs: 5, body: 'SECRETO' }, { ts: 1, event: 'x' }],
            }),
        );
        const res = await POST(new Request('https://f.test/x', { method: 'POST', body: JSON.stringify({ domainId: 'd', extensionId: 'e', action: 'run-action', actionId: 'send-test', itemId: 'ep-1', extra: 1 }) }));
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ domainId: 'd', extensionId: 'e', action: 'run-action', actionId: 'send-test', itemId: 'ep-1' });
        const data = await res.json();
        expect(data.result.message).toHaveLength(200);
        expect(data.result.report).toHaveLength(20);
        expect(data.runLog).toEqual([{ ts: '2026-01-01T00:00:00Z', event: 'EMAIL_SENT', target: 'ep-1', status: 'ok', code: 200, attempts: 1, latencyMs: 5 }]);
        expect(JSON.stringify(data)).not.toContain('SECRETO');
        expect((auditLog as any).mock.calls[0][0]).toBe('admin.extension.config.action');
        expect((auditLog as any).mock.calls[0][1]).toMatchObject({ actionId: 'send-test', itemId: 'ep-1', outcome: 'ok' });

        fetchMock.mockClear();
        const bad = await POST(new Request('https://f.test/x', { method: 'POST', body: JSON.stringify({ domainId: 'd', extensionId: 'e', action: 'run-action', actionId: 'Bad Id' }) }));
        expect(bad.status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('POST run-action propaga 429 y 404 como errores acotados', async () => {
        fetchMock.mockResolvedValueOnce(backend(429, { error: 'Too many', detail: 'SECRETO' }));
        const r = await POST(new Request('https://f.test/x', { method: 'POST', body: JSON.stringify({ domainId: 'd', extensionId: 'e', action: 'run-action', actionId: 'send-test' }) }));
        expect(r.status).toBe(429);
        expect(JSON.stringify(await r.json())).not.toContain('SECRETO');
        expect((auditLog as any).mock.calls[0][1].outcome).toBe('failed');
    });
});
