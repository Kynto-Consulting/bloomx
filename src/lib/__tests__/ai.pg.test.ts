import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertLocalPg, createFreshDatabase, uid } from './helpers/pg';
import { prisma } from '../prisma';

// Servicio de IA contra Postgres REAL: DDL, cifrado de la clave en reposo, respaldo heredado, cache, cuotas, resumen/CSV, retencion,
// auditoria, SSRF al guardar y kill switch con transporte falso. `npm run test:pg -- ai`.

const KEY = 'sk-live-ABCDEFGHIJKLMNOP-9f3a';
const reply = (text: string) => JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
const raw = async (sql: string, ...p: unknown[]) => (await prisma.$queryRawUnsafe(sql, ...p)) as any[];
const wipe = async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM "AiSettings"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "AiUsage"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "AiAudit"`);
};

let S: typeof import('../ai/settings');
let U: typeof import('../ai/usage');
let SV: typeof import('../ai/service');
let P: typeof import('../ai/providers');
let T: typeof import('../ai/types');

beforeAll(async () => {
    assertLocalPg();
    for (const m of ['log', 'error', 'warn'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
    S = await import('../ai/settings');
    U = await import('../ai/usage');
    SV = await import('../ai/service');
    P = await import('../ai/providers');
    T = await import('../ai/types');
});
beforeEach(async () => {
    await wipe();
    S.invalidateAiCache();
    U.__resetPurge();
});
afterEach(() => { P.__setTransport(null); vi.useRealTimers(); });
afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
});

const baseSave = (over: Record<string, unknown> = {}) => S.saveAiSettings({ enabled: true, provider: 'openai', model: 'gpt-x', apiKey: KEY, ...over }, 'admin@pg.test');

describe('DDL', () => {
    it('ensureDatabaseSchema es idempotente para las tablas de IA (dos ejecuciones, BD nueva)', async () => {
        const url = await createFreshDatabase();
        const { Pool } = await import('pg');
        const saved = process.env.DATABASE_URL;
        vi.resetModules();
        const g = globalThis as any;
        await g.__bloomxCustomPool?.end?.();
        g.__bloomxCustomPool = undefined;
        process.env.DATABASE_URL = url;
        try {
            const { ensureDatabaseSchema } = await import('../db/schema');
            await ensureDatabaseSchema();
            vi.resetModules();
            await g.__bloomxCustomPool?.end?.();
            g.__bloomxCustomPool = undefined;
            const second = await import('../db/schema');
            await second.ensureDatabaseSchema();
            await second.ensureDatabaseSchema();
            const pool = new Pool({ connectionString: url, max: 1 });
            try {
                const t = (await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)).rows.map((r: any) => r.table_name);
                for (const n of ['AiSettings', 'AiUsage', 'AiAudit']) expect(t).toContain(n);
                const idx = (await pool.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname LIKE 'Ai%'`)).rows.map((r: any) => r.indexname);
                expect(idx).toEqual(expect.arrayContaining(['AiUsage_ts_idx', 'AiUsage_userId_ts_idx', 'AiAudit_ts_idx']));
                expect(second.expectedSchemaTables()).toEqual(expect.arrayContaining(['AiSettings', 'AiUsage', 'AiAudit']));
            } finally { await pool.end(); }
        } finally {
            await g.__bloomxCustomPool?.end?.();
            g.__bloomxCustomPool = undefined;
            process.env.DATABASE_URL = saved;
        }
    });
});

describe('clave en reposo y vista', () => {
    it('apiKeyEnc esta cifrada (v3:/v2:), nunca en claro; la vista solo expone keyConfigured/keyLast4', async () => {
        const view = await baseSave();
        const [row] = await raw(`SELECT * FROM "AiSettings" WHERE "id"='default'`);
        expect(row.apiKeyEnc).toMatch(/^v[23]:/);
        expect(row.apiKeyEnc).not.toContain(KEY);
        expect(JSON.stringify(row)).not.toContain(KEY);
        expect(row.apiKeyLast4).toBe(KEY.slice(-4));
        expect(view).toMatchObject({ keyConfigured: true, keyLast4: KEY.slice(-4), configured: true, source: 'ui' });
        expect(JSON.stringify(view)).not.toContain(KEY);
        expect(JSON.stringify(await S.getAiSettingsView())).not.toContain(KEY);
        expect(JSON.stringify(await S.getPublicAiState())).not.toContain(KEY);
        expect((await S.resolveAi({ fresh: true })).apiKey).toBe(KEY);
    });
    it('guardar sin apiKey conserva la existente; null la borra', async () => {
        await baseSave();
        await S.saveAiSettings({ model: 'gpt-y' }, 'a');
        expect((await S.resolveAi({ fresh: true })).apiKey).toBe(KEY);
        const v = await S.saveAiSettings({ apiKey: null }, 'a');
        expect(v).toMatchObject({ keyConfigured: false, keyLast4: null, configured: false });
    });
    it('parche invalido -> SettingsError', async () => {
        await expect(S.saveAiSettings({ apiKey: 'corta' }, 'a')).rejects.toMatchObject({ code: 'invalid_input' });
        await expect(S.saveAiSettings({ desconocido: 1 }, 'a')).rejects.toMatchObject({ code: 'invalid_input' });
        await expect(S.saveAiSettings({ config: { limits: { maxOutputTokens: 1 } } }, 'a')).rejects.toMatchObject({ code: 'invalid_config' });
        await expect(S.saveAiSettings({ config: { guardrails: { blockedTopics: { patterns: ['(a+)+$'] } } } }, 'a')).rejects.toMatchObject({ code: 'invalid_config' });
    });
});

describe('baseUrl SSRF al guardar', () => {
    it('rechaza http, IPs privadas, metadata, localhost y credenciales', async () => {
        for (const u of ['http://api.example.com/v1', 'https://127.0.0.1/v1', 'https://169.254.169.254/', 'https://localhost/v1', 'https://u:p@api.example.com', 'https://[::1]/']) {
            await expect(S.saveAiSettings({ provider: 'compatible', baseUrl: u }, 'a'), u).rejects.toMatchObject({ code: expect.stringMatching(/^unsafe_base_url/) });
        }
        expect(await raw(`SELECT 1 FROM "AiSettings"`)).toHaveLength(0);
    });
    it('compatible/azure exigen baseUrl', async () => {
        await expect(S.saveAiSettings({ provider: 'compatible' }, 'a')).rejects.toMatchObject({ code: 'base_url_required' });
        await expect(S.saveAiSettings({ provider: 'azure-openai', baseUrl: '' }, 'a')).rejects.toMatchObject({ code: 'base_url_required' });
    });
});

describe('respaldo heredado (env)', () => {
    const env = { AI_KEY: 'env-key-123456789', AI_PROVIDER: 'openai', AI_MODEL: 'env-model' } as unknown as NodeJS.ProcessEnv;
    it('sin fila + AI_KEY -> source env', async () => {
        const r = await S.resolveAi({ env });
        expect(r).toMatchObject({ source: 'env', enabled: true, provider: 'openai', model: 'env-model', apiKey: 'env-key-123456789' });
        expect(S.toView(r)).toMatchObject({ legacyEnv: true, keyConfigured: true });
        expect(JSON.stringify(S.toView(r))).not.toContain('env-key-123456789');
    });
    it('sin fila ni env -> none/desactivada', async () => {
        expect(await S.resolveAi({ env: {} as NodeJS.ProcessEnv })).toMatchObject({ source: 'none', enabled: false, apiKey: null });
    });
    it('con fila el env se ignora por completo (tambien fila sin clave)', async () => {
        await S.saveAiSettings({ enabled: true, provider: 'anthropic', model: 'claude-x' }, 'a');
        const r = await S.resolveAi({ env });
        expect(r).toMatchObject({ source: 'ui', provider: 'anthropic', model: 'claude-x', apiKey: null });
        expect(S.isConfigured(r)).toBe(false);
        P.__setTransport(async () => { throw new Error('no deberia llamarse'); });
        S.invalidateAiCache();
        const prev = process.env.AI_KEY;
        process.env.AI_KEY = env.AI_KEY;
        try {
            await expect(SV.runAi({ userId: uid('u'), feature: 'composer', prompt: 'x' })).rejects.toMatchObject({ code: 'not_configured' });
        } finally { if (prev === undefined) delete process.env.AI_KEY; else process.env.AI_KEY = prev; }
    });
    it('grok/gemini heredados se mapean y un proveedor desconocido no configura nada', async () => {
        expect(await S.resolveAi({ env: { AI_KEY: 'k'.repeat(12), AI_PROVIDER: 'grok' } as any })).toMatchObject({ provider: 'compatible', baseUrl: 'https://api.x.ai/v1' });
        expect(await S.resolveAi({ env: { AI_KEY: 'k'.repeat(12), AI_PROVIDER: 'gemini' } as any })).toMatchObject({ provider: 'google' });
        expect(await S.resolveAi({ env: { AI_KEY: 'k'.repeat(12), AI_PROVIDER: 'raro' } as any })).toMatchObject({ source: 'none' });
    });
});

describe('cache de 30 s', () => {
    it('sirve de cache hasta 30 s, expira despues y se invalida al guardar', async () => {
        await baseSave();
        expect((await S.resolveAi()).enabled).toBe(true);
        await prisma.$executeRawUnsafe(`UPDATE "AiSettings" SET "enabled"=false`);
        expect((await S.resolveAi()).enabled).toBe(true); // cache
        vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + S.CACHE_TTL_MS + 1000 });
        expect((await S.resolveAi()).enabled).toBe(false); // expirada
        vi.useRealTimers();
        await S.saveAiSettings({ enabled: true }, 'a');
        expect((await S.resolveAi()).enabled).toBe(true); // guardar invalida
        await prisma.$executeRawUnsafe(`UPDATE "AiSettings" SET "enabled"=false`);
        S.invalidateAiCache();
        expect((await S.resolveAi()).enabled).toBe(false);
    });
});

const usage = (userId: string, over: Record<string, unknown> = {}) => U.recordUsage({ userId, feature: 'composer', extensionId: null, provider: 'openai', model: 'gpt-x', tokensIn: 10, tokensOut: 5, ok: true, ...over } as any);

describe('cuotas con recordUsage real', () => {
    const quota = (u: Partial<import('../ai/types').QuotaSet>, g: Partial<import('../ai/types').QuotaSet> = {}) => {
        const c = structuredClone(T.DEFAULT_CONFIG);
        c.quotas.perUser = { requestsDay: 0, requestsMonth: 0, tokensDay: 0, tokensMonth: 0, ...u };
        c.quotas.global = { requestsDay: 0, requestsMonth: 0, tokensDay: 0, tokensMonth: 0, ...g };
        return c;
    };
    it('por usuario: peticiones/dia, peticiones/mes, tokens', async () => {
        const a = uid('a'), b = uid('b');
        await usage(a); await usage(a);
        expect(await U.checkQuotas(a, quota({ requestsDay: 2 }), 100)).toMatchObject({ scope: 'user', metric: 'requestsDay', period: 'day' });
        expect((await U.checkQuotas(a, quota({ requestsDay: 2 }), 100))!.retryAfter).toBeGreaterThan(0);
        expect(await U.checkQuotas(a, quota({ requestsDay: 3 }), 100)).toBeNull();
        expect(await U.checkQuotas(b, quota({ requestsDay: 2 }), 100)).toBeNull(); // otro usuario no se ve afectado
        expect(await U.checkQuotas(a, quota({ requestsMonth: 2 }), 100)).toMatchObject({ metric: 'requestsMonth', period: 'month' });
        expect(await U.checkQuotas(a, quota({ tokensDay: 30 }), 100)).toMatchObject({ metric: 'tokensDay' });
        expect(await U.checkQuotas(a, quota({ tokensMonth: 30 }), 100)).toMatchObject({ metric: 'tokensMonth' });
        expect(await U.checkQuotas(a, quota({ tokensMonth: 31 }), 100)).toBeNull();
    });
    it('globales suman todos los usuarios', async () => {
        await usage(uid('a')); await usage(uid('b'));
        expect(await U.checkQuotas(uid('c'), quota({}, { requestsDay: 2 }), 10)).toMatchObject({ scope: 'global', metric: 'requestsDay' });
        expect(await U.checkQuotas(uid('c'), quota({}, { tokensMonth: 30 }), 10)).toMatchObject({ scope: 'global', metric: 'tokensMonth' });
        expect(await U.checkQuotas(uid('c'), quota({}, { requestsDay: 3 }), 10)).toBeNull();
    });
    it('los rechazos previos al proveedor no consumen cuota; los errores del proveedor si', async () => {
        const a = uid('a');
        await usage(a, { ok: false, errorCode: 'quota_exceeded', tokensIn: 0, tokensOut: 0 });
        await usage(a, { ok: false, errorCode: 'guardrail_blocked', tokensIn: 0, tokensOut: 0 });
        expect((await U.getCounters(a)).requestsDay).toBe(0);
        await usage(a, { ok: false, errorCode: 'provider_error' });
        await usage(a, { ok: false, errorCode: 'schema_validation_failed' });
        expect((await U.getCounters(a)).requestsDay).toBe(2);
    });
    it('remainingFor: -1 ilimitado y descuenta lo usado', async () => {
        const a = uid('a');
        await usage(a);
        expect(await U.remainingFor(a, quota({ requestsDay: 5 }))).toEqual({ requestsDay: 4, requestsMonth: -1, tokensDay: -1, tokensMonth: -1 });
    });
    it('un uso de dias anteriores del mes cuenta en el mes pero no en el dia', async () => {
        const a = uid('a');
        const now = new Date('2026-03-15T12:00:00Z');
        await prisma.$executeRawUnsafe(`INSERT INTO "AiUsage" ("id","userId","feature","tokensIn","tokensOut","ts") VALUES ($1,$2,'composer',10,5,$3)`, uid('r'), a, new Date('2026-03-10T08:00:00Z'));
        await prisma.$executeRawUnsafe(`INSERT INTO "AiUsage" ("id","userId","feature","tokensIn","tokensOut","ts") VALUES ($1,$2,'composer',10,5,$3)`, uid('r'), a, new Date('2026-02-28T23:59:00Z'));
        expect(await U.getCounters(a, now)).toEqual({ requestsDay: 0, requestsMonth: 1, tokensDay: 0, tokensMonth: 15 });
    });
});

describe('resumen, CSV y retencion', () => {
    it('usageSummary agrega sin contenido', async () => {
        const a = uid('a');
        await usage(a, { costUsd: 0.5 }); await usage(a, { ok: false, errorCode: 'provider_error', extensionId: 'ext.a' });
        const s = await U.usageSummary(7);
        expect(s.totals).toMatchObject({ requests: 2, errors: 1, tokensIn: 20, tokensOut: 10, costUsd: 0.5 });
        expect(s.byUser[0]).toMatchObject({ userId: a, requests: 2, tokens: 30 });
        expect(s.byExtension).toEqual([{ extensionId: 'ext.a', requests: 1, tokens: 15 }]);
        expect(s.byDay).toHaveLength(1);
    });
    it('usageCsv: cabecera, sin contenido y proteccion de formulas', async () => {
        await usage('=HYPERLINK("x")', { model: '@evil', extensionId: '+cmd' });
        await usage('plain,comma"q');
        const csv = await U.usageCsv(7);
        const lines = csv.trim().split('\r\n');
        expect(lines[0]).toBe('day,userId,feature,extensionId,provider,model,requests,errors,tokensIn,tokensOut,costUsd');
        expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
        expect(csv).toContain(`'@evil`);
        expect(csv).toContain(`'+cmd`);
        expect(csv).toContain('"plain,comma""q"');
        expect(lines.slice(1).every((l) => !/^[=+@-]/.test(l))).toBe(true);
    });
    it('purgeUsage borra solo lo anterior a la retencion', async () => {
        const a = uid('a');
        await prisma.$executeRawUnsafe(`INSERT INTO "AiUsage" ("id","userId","feature","ts") VALUES ($1,$2,'composer',$3)`, uid('r'), a, new Date(Date.now() - 100 * 86_400_000));
        await prisma.$executeRawUnsafe(`INSERT INTO "AiUsage" ("id","userId","feature","ts") VALUES ($1,$2,'composer',$3)`, uid('r'), a, new Date(Date.now() - 10 * 86_400_000));
        await usage(a);
        expect(await U.purgeUsage(90)).toBe(1);
        expect(await raw(`SELECT 1 FROM "AiUsage"`)).toHaveLength(2);
        expect(await U.purgeUsage(5)).toBe(1);
    });
});

describe('auditoria', () => {
    it('registra campos cambiados, nunca valores ni la clave', async () => {
        const patch = { enabled: true, provider: 'openai', model: 'gpt-x', apiKey: KEY, config: { limits: { maxOutputTokens: 500 } } } as any;
        await S.saveAiSettings(patch, 'admin@pg.test');
        await S.recordAudit('admin@pg.test', 'settings.update', S.changedFields(patch));
        const list = await S.listAudit();
        expect(list).toHaveLength(1);
        expect(list[0].fields).toEqual(expect.arrayContaining(['enabled', 'apiKey:set']));
        expect(JSON.stringify(list)).not.toContain(KEY);
        expect(JSON.stringify(await raw(`SELECT * FROM "AiAudit"`))).not.toContain(KEY);
    });
});

describe('kill switch con transporte falso', () => {
    it('enabled=false -> ai_disabled; al reactivar vuelve a funcionar', async () => {
        const calls: string[] = [];
        P.__setTransport(async (r) => { calls.push(r.body); return { status: 200, body: reply('hola') }; });
        const user = uid('u');
        await baseSave();
        expect((await SV.runAi({ userId: user, feature: 'composer', prompt: 'p' })).text).toBe('hola');
        await S.saveAiSettings({ enabled: false }, 'admin');
        await expect(SV.runAi({ userId: user, feature: 'composer', prompt: 'p' })).rejects.toMatchObject({ code: 'ai_disabled', status: 403 });
        expect(calls).toHaveLength(1);
        await S.saveAiSettings({ enabled: true }, 'admin');
        expect((await SV.runAi({ userId: user, feature: 'composer', prompt: 'p' })).text).toBe('hola');
        expect(calls).toHaveLength(2);
    });
    it('uso real: se registra sin contenido y la cuota por usuario corta la tercera llamada', async () => {
        P.__setTransport(async () => ({ status: 200, body: reply('RESPUESTA-PRIVADA') }));
        await baseSave({ config: { quotas: { perUser: { requestsDay: 2, requestsMonth: 0, tokensDay: 0, tokensMonth: 0 } } } });
        const user = uid('u');
        await SV.runAi({ userId: user, feature: 'composer', prompt: 'PROMPT-PRIVADO 4111 1111 1111 1111' });
        await SV.runAi({ userId: user, feature: 'composer', prompt: 'otra' });
        await expect(SV.runAi({ userId: user, feature: 'composer', prompt: 'tercera' })).rejects.toMatchObject({ code: 'quota_exceeded', status: 429 });
        const rows = await raw(`SELECT * FROM "AiUsage" WHERE "userId"=$1 ORDER BY "ts"`, user);
        expect(rows).toHaveLength(3);
        expect(JSON.stringify(rows)).not.toMatch(/PRIVAD|4111/);
        expect(rows[0].flags).toMatch(/redacted:1/);
        expect(rows[2].errorCode).toBe('quota_exceeded');
    });
    it('desactivar una funcion o una extension corta solo esa', async () => {
        P.__setTransport(async () => ({ status: 200, body: reply('ok') }));
        await baseSave({ config: { features: { translate: false }, extensions: { 'ext.a': { enabled: false } } } });
        const user = uid('u');
        await expect(SV.runAi({ userId: user, feature: 'translate', prompt: 'x' })).rejects.toMatchObject({ code: 'feature_disabled' });
        await expect(SV.runAi({ userId: user, feature: 'composer', prompt: 'x', extensionId: 'ext.a' })).rejects.toMatchObject({ code: 'feature_disabled' });
        expect((await SV.runAi({ userId: user, feature: 'composer', prompt: 'x', extensionId: 'ext.b' })).text).toBe('ok');
        expect(await S.getPublicAiState()).toMatchObject({ enabled: true, configured: true, extensions: { 'ext.a': false } });
    });
});
