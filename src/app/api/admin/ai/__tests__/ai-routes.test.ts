import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const KEY = 'sk-test-SECRET-KEY-1234567890';

let level = 4;
let fresh = true;
const auditLog = vi.fn();
const testConn = vi.fn();
const purgeUsage = vi.fn();
const store: { settings: any; audits: any[][] } = { settings: null, audits: [] };

vi.mock('@/lib/admin-auth', () => ({
    requireLevel: async (min: number) => {
        if (level < min) return { ok: false, response: NextResponse.json({ error: 'Forbidden', code: 'insufficient_level' }, { status: 403 }) };
        return { ok: true, actor: { kind: 'user', id: 'u-admin', email: 'boss@corp.com', level, levelSource: 'console' } };
    },
}));
vi.mock('@/lib/security', () => ({
    auditLog: (...a: unknown[]) => auditLog(...a),
    rateLimitAsync: async () => ({ ok: true, retryAfter: 0, backend: 'memory' }),
    getClientIp: () => '9.9.9.9',
    safeEqual: () => false,
}));
vi.mock('@/lib/admin/stepup', async () => {
    const { HttpError } = await import('@/lib/admin/http');
    return { assertFreshMfa: async () => { if (!fresh) throw new HttpError(403, 'reauth_required', 'mfa_reauth_required'); } };
});
vi.mock('@/lib/encryption', () => ({ encrypt: (s: string) => `ENC[${Buffer.from(s).toString('base64')}]`, decrypt: (s: string) => Buffer.from(s.slice(4, -1), 'base64').toString() }));
vi.mock('@/lib/admin/sql', async (orig) => ({
    ...(await orig<typeof import('@/lib/admin/sql')>()),
    query: async (sql: string) => (sql.includes('"AiSettings"') ? (store.settings ? [store.settings] : []) : sql.includes('"AiAudit"') ? store.audits.map((a) => ({ id: a[0], actor: a[1], action: a[2], fields: a[3], ts: new Date('2026-01-01') })) : []),
    execute: async (sql: string, ...p: any[]) => {
        if (sql.includes('INSERT INTO "AiSettings"')) {
            store.settings = { enabled: p[1], provider: p[2], model: p[3], baseUrl: p[4], apiKeyEnc: p[5], apiKeyLast4: p[6], config: JSON.parse(p[7]), updatedAt: new Date(), updatedBy: p[8] };
        } else if (sql.includes('INSERT INTO "AiAudit"')) store.audits.push(p);
        return 1;
    },
}));
vi.mock('@/lib/ai/service', () => ({ testConnection: (...a: unknown[]) => testConn(...a) }));
vi.mock('@/lib/ai/usage', () => ({
    usageSummary: async () => ({ from: 'a', to: 'b', totals: { requests: 1 }, byDay: [], byFeature: [], byUser: [], byExtension: [] }),
    usageCsv: async () => 'day,requests\n2026-01-01,1\n',
    purgeUsage: (...a: unknown[]) => purgeUsage(...a),
}));

import { GET as getSettings, PUT as putSettings } from '../settings/route';
import { POST as testRoute } from '../test/route';
import { GET as usageRoute } from '../usage/route';
import { GET as csvRoute } from '../usage/csv/route';
import { GET as auditRoute } from '../audit/route';
import { GET as stateRoute } from '../state/route';
import { POST as purgeRoute } from '../purge/route';
import { invalidateAiCache } from '@/lib/ai/settings';

const url = (p: string) => `http://localhost/api/admin/ai/${p}`;
const get = (p: string) => new NextRequest(url(p));
const send = (p: string, method: string, body: unknown) =>
    new NextRequest(url(p), { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const put = (body: unknown) => putSettings(send('settings', 'PUT', body));

beforeEach(() => {
    level = 4; fresh = true;
    store.settings = null; store.audits = [];
    auditLog.mockReset(); testConn.mockReset(); purgeUsage.mockReset();
    testConn.mockResolvedValue({ ok: true, latencyMs: 5, model: 'm', provider: 'openai', error: null });
    purgeUsage.mockResolvedValue(3);
    invalidateAiCache();
});

describe('matriz de permisos por nivel', () => {
    it('nivel 0: 403 en todas las rutas', async () => {
        level = 0;
        const calls = [getSettings(get('settings')), put({ model: 'x' }), testRoute(send('test', 'POST', {})), usageRoute(get('usage')), csvRoute(get('usage/csv')), auditRoute(get('audit')), stateRoute(get('state')), purgeRoute(send('purge', 'POST', {}))];
        for (const r of await Promise.all(calls)) expect(r.status).toBe(403);
    });
    it('nivel 1 lee (settings, usage, csv, audit, state)', async () => {
        level = 1;
        for (const r of [await getSettings(get('settings')), await usageRoute(get('usage?days=7')), await csvRoute(get('usage/csv')), await auditRoute(get('audit')), await stateRoute(get('state'))]) expect(r.status).toBe(200);
        const csv = await csvRoute(get('usage/csv'));
        expect(csv.headers.get('content-type')).toContain('text/csv');
        expect(csv.headers.get('cache-control')).toBe('no-store');
    });
    it('nivel 2 no escribe (PUT, test, purge)', async () => {
        level = 2;
        expect((await put({ model: 'x' })).status).toBe(403);
        expect((await testRoute(send('test', 'POST', {}))).status).toBe(403);
        expect((await purgeRoute(send('purge', 'POST', {}))).status).toBe(403);
        expect(store.settings).toBeNull();
    });
    it('nivel 3 edita ajustes no criticos y audita solo nombres de campos', async () => {
        level = 3;
        const r = await put({ model: 'gpt-4o-mini', config: { features: { translate: false } } });
        expect(r.status).toBe(200);
        expect(store.settings.model).toBe('gpt-4o-mini');
        expect(store.audits[0][2]).toBe('settings.update');
        expect(store.audits[0][3]).toContain('model');
        expect((await testRoute(send('test', 'POST', {}))).status).toBe(200);
        expect((await purgeRoute(send('purge', 'POST', { retentionDays: 30 }))).status).toBe(200);
    });
    it('nivel 3 NO cambia clave, proveedor, baseUrl ni enabled (403 insufficient_level)', async () => {
        level = 3;
        for (const body of [{ apiKey: KEY }, { provider: 'openai' }, { baseUrl: 'https://llm.example.com/v1' }, { enabled: true }, { apiKey: null }]) {
            const r = await put(body);
            expect(r.status).toBe(403);
            expect((await r.json()).code).toBe('insufficient_level');
        }
        expect(store.settings).toBeNull();
        // prueba con clave o URL transitorias tambien exige nivel 4
        expect((await testRoute(send('test', 'POST', { apiKey: KEY }))).status).toBe(403);
        expect((await testRoute(send('test', 'POST', { baseUrl: 'https://llm.example.com/v1' }))).status).toBe(403);
        expect(testConn).not.toHaveBeenCalled();
    });
    it('nivel 4 sin step-up => 403 reauth_required; con step-up OK', async () => {
        fresh = false;
        const denied = await put({ apiKey: KEY });
        expect(denied.status).toBe(403);
        expect((await denied.json()).code).toBe('reauth_required');
        expect(store.settings).toBeNull();
        // lo no critico no pide step-up
        expect((await put({ model: 'x1' })).status).toBe(200);
        fresh = true;
        const ok = await put({ provider: 'openai', apiKey: KEY, enabled: true });
        expect(ok.status).toBe(200);
        const v = await ok.json();
        expect(v).toMatchObject({ enabled: true, provider: 'openai', keyConfigured: true });
    });
});

describe('la clave nunca sale', () => {
    it('ni en respuestas, ni en audit/auditoria, ni cifrada en la vista', async () => {
        const res = [await put({ provider: 'openai', model: 'gpt-4o', apiKey: KEY, enabled: true })];
        res.push(await getSettings(get('settings')), await stateRoute(get('state')), await auditRoute(get('audit')), await usageRoute(get('usage')));
        res.push(await testRoute(send('test', 'POST', { apiKey: KEY })));
        for (const r of res) {
            const t = await r.text();
            expect(t).not.toContain(KEY);
            expect(t).not.toContain(Buffer.from(KEY).toString('base64'));
            expect(t).not.toContain('apiKeyEnc');
        }
        expect(JSON.stringify(auditLog.mock.calls)).not.toContain(KEY);
        expect(JSON.stringify(store.audits)).not.toContain(KEY);
        expect(JSON.stringify(store.audits)).toContain('apiKey:set');
        expect(store.settings.apiKeyLast4).toBe(KEY.slice(-4));
        expect(JSON.stringify(testConn.mock.calls[0][0])).toContain('apiKey'); // la clave transitoria solo llega al servicio
    });
});

describe('SSRF y validacion', () => {
    it.each(['https://127.0.0.1/v1', 'http://llm.example.com/v1', 'https://169.254.169.254/latest', 'https://localhost/v1'])('baseUrl %s => 400 unsafe_base_url', async (u) => {
        const r = await put({ provider: 'compatible', baseUrl: u });
        expect(r.status).toBe(400);
        expect((await r.json()).code).toBe('unsafe_base_url');
        expect(store.settings).toBeNull();
    });
    it('cuerpo invalido o con campos desconocidos => 400 sin repetir valores', async () => {
        const r = await put({ model: 'x', unknown: KEY });
        expect(r.status).toBe(400);
        expect(await r.text()).not.toContain(KEY);
    });
    it('config invalida => 400 invalid_config', async () => {
        const r = await put({ config: { limits: { timeoutMs: 1 } } });
        expect(r.status).toBe(400);
        expect((await r.json()).code).toBe('invalid_config');
    });
});
