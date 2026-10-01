import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const guard = vi.hoisted(() => ({ result: { ok: true, actor: { kind: 'manager', id: 'm1', email: 'a@b.c' } } as any }));
vi.mock('@/lib/admin-auth', () => {
    const guardFn = vi.fn(async () => guard.result);
    return { requireAdmin: guardFn, requireLevel: (_m: number, ...a: unknown[]) => (guardFn as (...x: unknown[]) => unknown)(...a) };
});
vi.mock('@/lib/security', () => ({ auditLog: vi.fn(), getClientIp: () => '1.2.3.4', rateLimitAsync: vi.fn(async () => ({ ok: true, retryAfter: 0 })) }));
vi.mock('@/lib/admin/sql', async () => ({ ...(await vi.importActual<any>('@/lib/admin/sql')), query: vi.fn(async () => []) }));
const ai = vi.hoisted(() => ({ state: { enabled: false, configured: false, source: 'none', features: { composer: true, 'smart-reply': true, summarize: true, translate: true, organizer: true, other: true }, extensions: {} } as any }));
vi.mock('@/lib/ai/settings', () => ({ getPublicAiState: async () => ai.state }));

import { __resetInstanceCache } from '@/lib/admin/extensions-instance';
import { __resetCatalogCache } from '@/lib/admin/extensions-catalog';
import { POST as installAPI } from '../install/route';
import { POST as toggleAPI } from '../toggle/route';
import { GET as installedGET } from '../installed/route';

const fetchMock = vi.fn();
const res = (status: number, body: any) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const catalog = [
    { id: 'ai-ext', name: 'AI', description: '', version: '1.0.0', template: { id: 'ai-ext', permissions: ['AI_GENERATE'], ai: { features: ['composer'] } } },
    { id: 'ai-optional', name: 'Opt', description: '', version: '1.0.0', template: { id: 'ai-optional', permissions: ['AI'], ai: { required: false } } },
    { id: 'plain', name: 'Plain', description: '', version: '1.0.0', template: { id: 'plain', permissions: ['READ_EMAIL'] } },
];
const post = (body: unknown) => new Request('https://f.test/x', { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'auth_session=abc' }, body: JSON.stringify(body) }) as any;
const managerCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/manager/'));

beforeEach(() => {
    process.env.TOP_DOMAIN = 'mail.test';
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://backend.test';
    delete process.env.BLOOMX_DOMAIN_PRIVATE_KEY;
    __resetInstanceCache(); __resetCatalogCache();
    ai.state = { ...ai.state, enabled: false, features: { ...ai.state.features, composer: true }, extensions: {} };
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
        const u = String(url);
        if (u.includes('/api/config')) return res(200, { config: { id: 'dom1', name: 'mail.test' } });
        if (u.includes('public-list')) return res(200, catalog);
        if (u.includes('/api/manager/extensions/install')) return res(200, { success: true });
        if (u.includes('/api/manager/extensions/toggle')) return res(200, { success: true, enabled: true });
        if (u.includes('/api/manager/extensions')) return res(200, { extensions: [] });
        throw new Error('fetch no esperado ' + u);
    });
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.TOP_DOMAIN; });

describe('install / toggle de extensiones que requieren IA', () => {
    it('IA desactivada: install y toggle(enabled:true) responden 409 ai_disabled y no llegan al backend', async () => {
        const a = await installAPI(post({ domainId: 'dom1', extensionId: 'ai-ext' }));
        expect(a.status).toBe(409);
        expect((await a.json()).code).toBe('ai_disabled');
        const b = await toggleAPI(post({ domainId: 'dom1', extensionId: 'ai-ext', enabled: true }));
        expect(b.status).toBe(409);
        expect((await b.json()).code).toBe('ai_disabled');
        expect(managerCalls()).toHaveLength(0);
    });

    it('IA activa pero funcion desactivada: feature_disabled', async () => {
        ai.state = { ...ai.state, enabled: true, features: { ...ai.state.features, composer: false } };
        const r = await installAPI(post({ domainId: 'dom1', extensionId: 'ai-ext' }));
        expect(r.status).toBe(409);
        expect((await r.json()).code).toBe('feature_disabled');
    });

    it('desactivar y las que no requieren IA o tienen ai.required=false siguen permitidas', async () => {
        expect((await toggleAPI(post({ domainId: 'dom1', extensionId: 'ai-ext', enabled: false }))).status).toBe(200);
        expect((await installAPI(post({ domainId: 'dom1', extensionId: 'plain' }))).status).toBe(200);
        expect((await installAPI(post({ domainId: 'dom1', extensionId: 'ai-optional' }))).status).toBe(200);
    });

    it('al reactivar la IA vuelve a poder activarse (sin reinstalar nada)', async () => {
        ai.state = { ...ai.state, enabled: true };
        expect((await toggleAPI(post({ domainId: 'dom1', extensionId: 'ai-ext', enabled: true }))).status).toBe(200);
    });

    it('la lista de instaladas expone el estado de IA (sin secretos) para marcar las filas', async () => {
        const r = await installedGET(new Request('https://f.test/api/admin/extensions/installed?domainId=dom1', { headers: { cookie: 'auth_session=abc' } }) as any);
        const body = await r.json();
        expect(body.ai).toMatchObject({ enabled: false });
        expect(JSON.stringify(body.ai)).not.toMatch(/key|secret/i);
    });
});
