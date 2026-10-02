import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/admin-auth', () => {
    const guardFn = vi.fn(async () => ({ ok: true, actor: { kind: 'manager', id: 'm1', email: 'a@b.c' } }));
    return { requireAdmin: guardFn, requireLevel: (_min: number, ...a: unknown[]) => (guardFn as (...x: unknown[]) => unknown)(...a) };
});
vi.mock('@/lib/security', () => ({ auditLog: vi.fn(), getClientIp: () => '1.2.3.4' }));
vi.mock('@/lib/permissions', () => ({ refreshPermissions: vi.fn(async () => undefined) }));
const instance = vi.fn();
vi.mock('@/lib/admin/extensions-instance', () => ({ assertInstanceDomain: (...a: unknown[]) => instance(...a) }));
const validate = vi.fn();
vi.mock('@/lib/admin/extension-users', () => ({ validateUserRefs: (...a: unknown[]) => validate(...a) }));

import { PUT } from '../config/route';

const fetchMock = vi.fn();
const backend = (status: number, body: any) => ({ ok: status < 300, status, json: async () => body });
const put = (body: unknown) => new Request('https://f.test/api/admin/extensions/config', { method: 'PUT', headers: { 'content-type': 'application/json', cookie: 'auth_session=abc' }, body: JSON.stringify(body) });
const state = (fields: unknown[], values: Record<string, unknown> = {}) => backend(200, { schema: { fields }, values });

beforeEach(() => {
    fetchMock.mockReset();
    instance.mockReset();
    validate.mockReset();
    instance.mockResolvedValue(undefined);
    validate.mockResolvedValue([]);
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('proxy de ajustes: ids de usuario validados en el servidor del dominio', () => {
    it('valida ids de campos user/users/userMap contra la BD del dominio y solo despues reenvia al backend', async () => {
        fetchMock
            .mockResolvedValueOnce(state([{ key: 'digest', type: 'userMap', valueType: 'boolean', label: 'd' }], { digest: { old: true } }))
            .mockResolvedValueOnce(backend(200, { success: true }));
        const res = await PUT(put({ domainId: 'd1', extensionId: 'e', values: { digest: { old: true, u1: false } } }));
        expect(res.status).toBe(200);
        expect(instance).toHaveBeenCalledWith('d1', expect.anything());
        const [fields, next, stored] = validate.mock.calls[0];
        expect((fields as any[])[0].type).toBe('userMap');
        expect(next).toEqual({ digest: { old: true, u1: false } });
        expect(stored).toEqual({ digest: { old: true } });
        expect(fetchMock.mock.calls[1][1].method).toBe('PUT');
    });

    it('usuario inexistente/desactivado/fuera de filtro = 422 con code y SIN llamar al backend (PUT)', async () => {
        validate.mockResolvedValueOnce([{ path: 'values.owner', message: 'm', code: 'userMissing', params: { id: 'zz' } }]);
        fetchMock.mockResolvedValueOnce(state([{ key: 'owner', type: 'user', label: 'o' }]));
        const res = await PUT(put({ domainId: 'd1', extensionId: 'e', values: { owner: 'zz' } }));
        expect(res.status).toBe(422);
        const data = await res.json();
        expect(data.errors[0]).toMatchObject({ path: 'values.owner', code: 'userMissing', params: { id: 'zz' } });
        expect(fetchMock).toHaveBeenCalledTimes(1); // solo el preflight GET
    });

    it('IDOR entre dominios: un domainId que no es el de esta instancia se rechaza antes de validar o guardar', async () => {
        instance.mockRejectedValueOnce(Object.assign(new Error('domain_mismatch'), { status: 403 }));
        fetchMock.mockResolvedValueOnce(state([{ key: 'owner', type: 'user', label: 'o' }]));
        const res = await PUT(put({ domainId: 'OTRO', extensionId: 'e', values: { owner: 'u1' } }));
        expect(res.status).toBe(403);
        expect(validate).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('sin campos de usuario en el schema no valida nada ni exige el dominio', async () => {
        fetchMock.mockResolvedValueOnce(state([{ key: 'mode', type: 'string', label: 'm' }])).mockResolvedValueOnce(backend(200, { success: true }));
        const res = await PUT(put({ domainId: 'd1', extensionId: 'e', values: { mode: 'x' } }));
        expect(res.status).toBe(200);
        expect(instance).not.toHaveBeenCalled();
        expect(validate).not.toHaveBeenCalled();
    });

    it('si el preflight falla (backend caido / sin permiso) el PUT sigue y el backend decide', async () => {
        fetchMock.mockResolvedValueOnce(backend(403, { error: 'Unauthorized domain access' })).mockResolvedValueOnce(backend(403, { error: 'Unauthorized domain access' }));
        const res = await PUT(put({ domainId: 'd1', extensionId: 'e', values: { owner: 'u1' } }));
        expect(res.status).toBe(403);
        expect(validate).not.toHaveBeenCalled();
    });
});
