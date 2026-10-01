import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/admin-auth', () => {
    const guardFn = vi.fn(async () => ({ ok: true, actor: { kind: 'manager', id: 'm1', email: 'a@b.c' } }));
    // adminRoute usa requireLevel(n): en estas pruebas el nivel no se evalua (lo cubre admin-levels.test / admin-cli.pg.test)
    return { requireAdmin: guardFn, requireLevel: (_min: number, ...a: unknown[]) => (guardFn as (...x: unknown[]) => unknown)(...a) };
});
vi.mock('@/lib/security', () => ({ auditLog: vi.fn(), getClientIp: () => '1.2.3.4' }));

import { GET, POST } from '../settings/route';
import { auditLog } from '@/lib/security';

const fetchMock = vi.fn();
const backend = (status: number, body: any) => ({ ok: status < 300, status, json: async () => body });

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    (auditLog as any).mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('proxy de credenciales: fuentes sin valores', () => {
    it('GET devuelve name/configured/source/movable con lista blanca: descarta cualquier valor que llegue del backend', async () => {
        fetchMock.mockResolvedValueOnce(
            backend(200, {
                keys: [
                    { name: 'NOTION_API_KEY', configured: true, source: 'domain', movable: false, value: 'SECRETO', token: 'SECRETO' },
                    { name: 'GIPHY_API_KEY', configured: false, source: 'server-env', secret: 'SECRETO' },
                    { name: 'X_KEY', configured: false, source: 'inventada' },
                ],
                secret: 'SECRETO',
            }),
        );
        const res = await GET(new Request('https://f.test/api/admin/extensions/settings?domainId=d&extensionId=e'));
        const data = await res.json();
        expect(data.keys).toEqual([
            { name: 'NOTION_API_KEY', configured: true, source: 'domain', movable: false },
            { name: 'GIPHY_API_KEY', configured: false, source: 'server-env', movable: false },
            { name: 'X_KEY', configured: false, source: 'missing', movable: false },
        ]);
        expect(JSON.stringify(data)).not.toContain('SECRETO');
    });

    it('POST migrate-legacy reenvia solo los campos conocidos, audita nombres (no valores) y filtra la respuesta', async () => {
        fetchMock.mockResolvedValueOnce(
            backend(200, { success: true, migrated: ['NOTION_API_KEY', 'valor-raro SECRETO'], serverEnv: ['GIPHY_API_KEY'], keys: [{ name: 'NOTION_API_KEY', configured: true, source: 'domain', movable: false }] }),
        );
        const res = await POST(
            new Request('https://f.test/api/admin/extensions/settings', {
                method: 'POST',
                headers: { 'content-type': 'application/json', cookie: 'auth_session=abc' },
                body: JSON.stringify({ domainId: 'd', extensionId: 'e', action: 'migrate-legacy', credentials: { A: 'SECRETO' } }),
            }),
        );
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain('/api/extension/settings');
        expect(init.method).toBe('POST');
        expect(init.headers.Cookie).toBe('auth_session=abc');
        expect(JSON.parse(init.body)).toEqual({ domainId: 'd', extensionId: 'e', action: 'migrate-legacy' });
        const data = await res.json();
        expect(data.migrated).toEqual(['NOTION_API_KEY']);
        expect(data.serverEnv).toEqual(['GIPHY_API_KEY']);
        expect(JSON.stringify(data)).not.toContain('SECRETO');
        expect((auditLog as any).mock.calls[0][1].set).toEqual(['NOTION_API_KEY']);
    });

    it('POST rechaza acciones distintas y campos ausentes', async () => {
        const bad = await POST(new Request('https://f.test/x', { method: 'POST', body: JSON.stringify({ domainId: 'd', extensionId: 'e', action: 'otra' }) }));
        expect(bad.status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
