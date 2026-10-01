import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ai = vi.hoisted(() => ({ state: null as any }));
vi.mock('@/lib/ai/settings', () => ({ getPublicAiState: async () => { if (!ai.state) throw new Error('no state'); return ai.state; } }));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => ({ id: 'u1', email: 'a@acme.com' }) }));
vi.mock('@/lib/conferencing/auth-context', () => ({ getLinkedAuth: async () => ({ auth: {} }) }));
vi.mock('@/lib/expansions/user-disabled', () => ({ loadDisabledExtensionsForUser: async () => [], MAX_DISABLED_FOR_SERVER: 200 }));

import { GET } from '../route';
import { GET as expansionsGET } from '../../expansions/route';
import { __resetBlockedIds } from '@/lib/ai/extension-block';

const FEATURES = { composer: true, 'smart-reply': true, summarize: true, translate: true, organizer: true, other: true };
const mk = (over: Record<string, unknown> = {}) => ({ enabled: false, configured: false, source: 'none', features: { ...FEATURES }, extensions: {}, ...over });

const extensions = [
    { id: 'composer', template: { id: 'composer', permissions: ['AI_GENERATE'], ai: { features: ['composer'] } } },
    { id: 'soft', template: { id: 'soft', permissions: ['AI'], ai: { required: false } } },
    { id: 'plain', template: { id: 'plain', permissions: ['READ_EMAIL'] } },
];
const fetchMock = vi.fn();
const reqOf = (url: string) => new Request(url, { headers: { host: 'acme.com' } }) as any;
const byId = (list: any[]) => Object.fromEntries(list.map((e) => [e.id, e]));
const config = async () => (await GET(reqOf('https://app.test/api/config'))).json();

beforeEach(() => {
    process.env.TOP_DOMAIN = 'acme.com';
    ai.state = mk();
    __resetBlockedIds();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
        if (String(url).includes('/api/config')) return { ok: true, status: 200, json: async () => ({ config: {}, extensions: JSON.parse(JSON.stringify(extensions)) }) };
        return { ok: true, status: 200, json: async () => [{ extensionId: 'composer', handler: 'h' }, { extensionId: 'plain', handler: 'h' }] };
    });
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('/api/config marca aiBlock por extension', () => {
    it('IA off: la que la requiere queda blocked (sigue en la lista), la opcional degradada, la normal intacta', async () => {
        const body = await config();
        const m = byId(body.extensions);
        expect(m.composer.aiBlock).toMatchObject({ requiresAi: true, blocked: true, reason: 'ai_disabled' });
        expect(m.soft.aiBlock).toMatchObject({ blocked: false, degraded: true, optional: true });
        expect(m.plain.aiBlock).toMatchObject({ requiresAi: false, blocked: false });
        expect(body.extensions).toHaveLength(3);
    });

    it('al reactivar la IA vuelve desbloqueada (nada se reinstala)', async () => {
        ai.state = mk({ enabled: true });
        expect(byId((await config()).extensions).composer.aiBlock).toMatchObject({ blocked: false, reason: null });
    });

    it('funcion desactivada => feature_disabled; desactivada por extension => extension_disabled', async () => {
        ai.state = mk({ enabled: true, features: { ...FEATURES, composer: false } });
        expect(byId((await config()).extensions).composer.aiBlock.reason).toBe('feature_disabled');
        ai.state = mk({ enabled: true, extensions: { composer: false } });
        expect(byId((await config()).extensions).composer.aiBlock.reason).toBe('extension_disabled');
    });

    it('sin estado de IA no rompe la config', async () => {
        ai.state = null;
        const r = await GET(reqOf('https://app.test/api/config'));
        expect(r.status).toBe(200);
    });
});

describe('/api/expansions?trigger= no ofrece handlers de extensiones bloqueadas', () => {
    it('IA off: se omiten los de la bloqueada; IA on: vuelven', async () => {
        let list = await (await expansionsGET(reqOf('https://app.test/api/expansions?trigger=X'))).json();
        expect(list.map((h: any) => h.extensionId)).toEqual(['plain']);
        ai.state = mk({ enabled: true });
        __resetBlockedIds();
        list = await (await expansionsGET(reqOf('https://app.test/api/expansions?trigger=X'))).json();
        expect(list.map((h: any) => h.extensionId)).toEqual(['composer', 'plain']);
    });
});
