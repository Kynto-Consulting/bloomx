import { beforeEach, describe, expect, it, vi } from 'vitest';

const guard = vi.fn();
vi.mock('@/lib/admin-auth', () => ({ requireLevel: (min: number, ...a: unknown[]) => guard(min, ...a) }));
vi.mock('@/lib/permissions', () => ({ refreshPermissions: vi.fn(async () => undefined) }));
vi.mock('@/lib/security', () => ({ rateLimitAsync: vi.fn(async () => ({ ok: true, retryAfter: 0 })) }));
const queryMock = vi.fn();
vi.mock('@/lib/admin/sql', async (orig) => ({ ...(await orig<any>()), query: (...a: unknown[]) => queryMock(...a) }));

import { GET } from '../users/route';
import { rateLimitAsync } from '@/lib/security';

const req = (qs: string) => new Request(`https://f.test/api/admin/extensions/users${qs}`);
beforeEach(() => {
    guard.mockReset();
    guard.mockResolvedValue({ ok: true, actor: { kind: 'user', id: 'a1', email: 'admin@a.test', level: 3 } });
    queryMock.mockReset();
    queryMock.mockImplementation(async (sql: string) => (/COUNT/.test(sql) ? [{ n: 1 }] : [{ id: 'u1', email: 'ana@a.test', name: 'Ana', disabled: false, password: 'HASH', token: 'T' }]));
    (rateLimitAsync as any).mockResolvedValue({ ok: true, retryAfter: 0 });
});

describe('GET /api/admin/extensions/users', () => {
    it('exige nivel 3 (admin): sin permiso devuelve la respuesta del guardia y no consulta la BD', async () => {
        guard.mockResolvedValueOnce({ ok: false, response: new Response('{}', { status: 403 }) });
        const res = await GET(req(''));
        expect(guard).toHaveBeenCalledWith(3, expect.anything());
        expect(res.status).toBe(403);
        expect(queryMock).not.toHaveBeenCalled();
    });

    it('lista paginada con solo id/correo/nombre/estado/nivel (nunca campos extra de la fila) y sin cache', async () => {
        const res = await GET(req('?q=an&page=0&limit=5'));
        expect(res.status).toBe(200);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        const data = await res.json();
        expect(data.users).toEqual([{ id: 'u1', email: 'ana@a.test', name: 'Ana', disabled: false, level: 0, levelName: 'user' }]);
        expect(JSON.stringify(data)).not.toMatch(/HASH|password|token/);
        expect(data.limit).toBe(5);
    });

    it('?ids= resuelve ids y marca los inexistentes como missing; formato invalido = 400', async () => {
        const res = await GET(req('?ids=u1,gone'));
        const data = await res.json();
        expect(data.users.map((u: any) => u.id)).toEqual(['u1']);
        expect(data.missing).toEqual(['gone']);
        expect((await GET(req('?ids=u1,bad%27id'))).status).toBe(400);
    });

    it('valida minLevel y role; aplica limite de frecuencia', async () => {
        expect((await GET(req('?minLevel=9'))).status).toBe(400);
        expect((await GET(req('?minLevel=abc'))).status).toBe(400);
        expect((await GET(req('?role=bad%20role'))).status).toBe(400);
        (rateLimitAsync as any).mockResolvedValueOnce({ ok: false, retryAfter: 7 });
        const limited = await GET(req(''));
        expect(limited.status).toBe(429);
        expect(limited.headers.get('Retry-After')).toBe('7');
    });

    it('un error interno no filtra detalles', async () => {
        queryMock.mockRejectedValueOnce(new Error('secret connection string'));
        const res = await GET(req(''));
        expect(res.status).toBe(500);
        expect(JSON.stringify(await res.json())).not.toContain('connection');
    });
});
