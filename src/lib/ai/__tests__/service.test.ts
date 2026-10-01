import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, AiError, type AiConfig } from '../types';

const m = vi.hoisted(() => ({
    resolveAi: vi.fn(), checkQuotas: vi.fn(), recordUsage: vi.fn(), maybePurge: vi.fn(), remainingFor: vi.fn(),
}));
vi.mock('../settings', () => ({
    resolveAi: m.resolveAi,
    getPublicAiState: vi.fn(),
    isConfigured: (r: any) => !!(r.provider && r.model && r.apiKey),
}));
vi.mock('../usage', () => {
    return {
        checkQuotas: m.checkQuotas, recordUsage: m.recordUsage, maybePurge: m.maybePurge, remainingFor: m.remainingFor,
        estimateCost: () => 0,
    };
});

import { runAi, statusFor, type AiRequest } from '../service';
import { __setTransport } from '../providers';
import type { TransportRequest } from '../url-guard';

const cfg = (over: Partial<AiConfig> = {}): AiConfig => ({ ...structuredClone(DEFAULT_CONFIG), ...over });
const resolved = (over: Record<string, unknown> = {}, config: AiConfig = cfg()) => ({
    source: 'ui', enabled: true, provider: 'openai', model: 'gpt-x', baseUrl: null, apiKey: 'sk-test-key-123456', keyLast4: '3456',
    config, updatedAt: null, updatedBy: null, ...over,
});
const req = (over: Partial<AiRequest> = {}): AiRequest => ({ userId: 'u1', feature: 'composer', prompt: 'hola', ...over });
const reply = (text: string) => JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });

let sent: TransportRequest[] = [];
const respond = (...texts: string[]) => {
    let i = 0;
    __setTransport(async (r) => { sent.push(r); return { status: 200, body: reply(texts[Math.min(i++, texts.length - 1)]) }; });
};
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as AiError; } throw new Error('no lanzo'); };
const body = (i = 0) => JSON.parse(sent[i].body);

beforeEach(() => {
    sent = [];
    Object.values(m).forEach((f) => f.mockReset());
    m.resolveAi.mockResolvedValue(resolved());
    m.checkQuotas.mockResolvedValue(null);
    m.recordUsage.mockResolvedValue(undefined);
    m.maybePurge.mockResolvedValue(undefined);
    respond('ok');
});
afterEach(() => { __setTransport(null); vi.restoreAllMocks(); });

describe('runAi: precondiciones', () => {
    it('ai_disabled / not_configured / feature_disabled / extension desactivada', async () => {
        m.resolveAi.mockResolvedValue(resolved({ enabled: false }));
        expect(await fails(runAi(req()))).toMatchObject({ code: 'ai_disabled', status: 403 });
        m.resolveAi.mockResolvedValue(resolved({ apiKey: null }));
        expect(await fails(runAi(req()))).toMatchObject({ code: 'not_configured', status: 503 });
        m.resolveAi.mockResolvedValue(resolved({}, cfg({ features: { ...DEFAULT_CONFIG.features, composer: false } })));
        expect(await fails(runAi(req()))).toMatchObject({ code: 'feature_disabled' });
        m.resolveAi.mockResolvedValue(resolved({}, cfg({ extensions: { 'ext.a': { enabled: false } } })));
        expect(await fails(runAi(req({ extensionId: 'ext.a' })))).toMatchObject({ code: 'feature_disabled', detail: 'extension' });
        expect((await runAi(req({ extensionId: 'ext.b' }))).text).toBe('ok');
        expect(sent).toHaveLength(1);
    });
    it('feature y usuario invalidos', async () => {
        expect(await fails(runAi(req({ feature: 'nada' })))).toMatchObject({ code: 'invalid_args' });
        expect(await fails(runAi(req({ userId: '' })))).toMatchObject({ code: 'invalid_args' });
        expect(await fails(runAi(req({ prompt: undefined })))).toMatchObject({ code: 'invalid_args' });
        expect(await fails(runAi(req({ prompt: undefined, messages: [{ role: 'assistant', content: 'x' }] })))).toMatchObject({ code: 'invalid_args' });
        expect(await fails(runAi(req({ schema: { $ref: 'x' } })))).toMatchObject({ code: 'invalid_args' });
        expect(sent).toHaveLength(0);
    });
    it('acepta alias de funcion', async () => {
        await runAi(req({ feature: 'smart_reply' }));
        expect(m.recordUsage.mock.calls[0][0].feature).toBe('smart-reply');
    });
});

describe('runAi: cuotas', () => {
    it('quota_exceeded por usuario y global con retryAfter; no llama al proveedor', async () => {
        m.checkQuotas.mockResolvedValueOnce({ scope: 'user', metric: 'requestsDay', period: 'day', retryAfter: 120 });
        const e = await fails(runAi(req()));
        expect(e).toMatchObject({ code: 'quota_exceeded', status: 429, retryAfter: 120, detail: 'user:requestsDay' });
        m.checkQuotas.mockResolvedValueOnce({ scope: 'global', metric: 'tokensMonth', period: 'month', retryAfter: 9999 });
        expect(await fails(runAi(req()))).toMatchObject({ detail: 'global:tokensMonth', retryAfter: 9999 });
        expect(sent).toHaveLength(0);
        expect(m.recordUsage.mock.calls.every(([u]) => u.errorCode === 'quota_exceeded' && u.ok === false)).toBe(true);
    });
});

describe('runAi: guardarrailes y limites', () => {
    it('tema bloqueado -> guardrail_blocked y registro sin contenido', async () => {
        m.resolveAi.mockResolvedValue(resolved({}, cfg({ guardrails: { ...DEFAULT_CONFIG.guardrails, blockedTopics: { mode: 'enforce', patterns: ['explosivos'] } } })));
        const e = await fails(runAi(req({ prompt: 'como fabricar explosivos' })));
        expect(e).toMatchObject({ code: 'guardrail_blocked', status: 422, detail: 'blocked_topic' });
        expect(sent).toHaveLength(0);
        expect(JSON.stringify(m.recordUsage.mock.calls)).not.toContain('explosivos');
    });
    it('entrada demasiado larga', async () => {
        m.resolveAi.mockResolvedValue(resolved({}, cfg({ limits: { ...DEFAULT_CONFIG.limits, maxInputChars: 100 } })));
        expect(await fails(runAi(req({ prompt: 'x'.repeat(101) })))).toMatchObject({ code: 'guardrail_blocked', detail: 'input_too_long' });
        expect(sent).toHaveLength(0);
    });
    it('la redaccion llega aplicada al transporte; el prefijo de system se antepone y no se redacta', async () => {
        m.resolveAi.mockResolvedValue(resolved({}, cfg({ guardrails: { ...DEFAULT_CONFIG.guardrails, systemPrefix: 'REGLA-INSTANCIA' } })));
        const r = await runAi(req({ system: 'Eres util. IBAN ES91 2100 0418 4502 0005 1332', prompt: 'mi tarjeta 4111 1111 1111 1111' }));
        const b = body();
        const all = JSON.stringify(b);
        expect(all).not.toContain('4111');
        expect(all).not.toContain('2100 0418');
        expect(b.messages[0].role).toBe('system');
        expect(b.messages[0].content.startsWith('REGLA-INSTANCIA\n\nEres util.')).toBe(true);
        expect(b.messages[1].content).toContain('[REDACTED:card]');
        expect(r.warnings).toContain('redacted');
        expect(m.recordUsage.mock.calls[0][0].flags.join()).toMatch(/redacted:2/);
    });
    it('politica de cuerpo subject-only: el cuerpo nunca sale', async () => {
        m.resolveAi.mockResolvedValue(resolved({}, cfg({ guardrails: { ...DEFAULT_CONFIG.guardrails, bodyPolicy: { mode: 'subject-only', snippetChars: 10 } } })));
        await runAi(req({ prompt: 'resume', parts: { subject: 'Asunto uno', body: 'CUERPO-PRIVADO' } }));
        const s = JSON.stringify(body());
        expect(s).toContain('Asunto uno');
        expect(s).not.toContain('CUERPO-PRIVADO');
    });
    it('maxTokens y temperatura topados; modelo no permitido ignorado; permitido aceptado', async () => {
        m.resolveAi.mockResolvedValue(resolved({}, cfg({ allowedModels: ['gpt-alt'], limits: { ...DEFAULT_CONFIG.limits, maxOutputTokens: 200, maxTemperature: 0.5 }, extensions: { 'ext.a': { maxTokens: 50 } } })));
        await runAi(req({ maxTokens: 99999, temperature: 2, model: 'otro-modelo' }));
        expect(body()).toMatchObject({ max_tokens: 200, temperature: 0.5, model: 'gpt-x' });
        await runAi(req({ model: 'gpt-alt', extensionId: 'ext.a', maxTokens: 150 }));
        expect(body(1)).toMatchObject({ max_tokens: 50, model: 'gpt-alt' });
        await runAi(req({ maxTokens: 1, temperature: -3 }));
        expect(body(2)).toMatchObject({ max_tokens: 16, temperature: 0 });
    });
    it('filtro de salida enforce bloquea la respuesta', async () => {
        m.resolveAi.mockResolvedValue(resolved({}, cfg({ guardrails: { ...DEFAULT_CONFIG.guardrails, output: { mode: 'enforce', maxChars: 1000, patterns: ['prohibido'] } } })));
        respond('esto es prohibido');
        expect(await fails(runAi(req()))).toMatchObject({ code: 'guardrail_blocked', detail: 'output_pattern' });
    });
});

describe('runAi: errores del proveedor', () => {
    it('provider_error se registra con tokens estimados y sin contenido', async () => {
        __setTransport(async () => ({ status: 500, body: 'SECRETO-DEL-PROVEEDOR' }));
        const e = await fails(runAi(req({ prompt: 'PROMPT-PRIVADO' })));
        expect(e).toMatchObject({ code: 'provider_error', detail: 'http_500' });
        const u = m.recordUsage.mock.calls[0][0];
        expect(u).toMatchObject({ ok: false, errorCode: 'provider_error' });
        expect(JSON.stringify(m.recordUsage.mock.calls)).not.toMatch(/PROMPT-PRIVADO|SECRETO-DEL/);
    });
});

describe('runAi: modo json', () => {
    const schema = { type: 'object', required: ['n'], additionalProperties: false, properties: { n: { type: 'integer' } } };
    it('devuelve data y anade la instruccion de esquema al system', async () => {
        respond('```json\n{"n": 3}\n```');
        const r = await runAi(req({ schema }));
        expect(r.data).toEqual({ n: 3 });
        expect(body().messages[0].content).toContain('JSON Schema');
        expect(body().response_format.type).toBe('json_schema');
    });
    it('reintento que corrige: 2 llamadas, 2 comprobaciones de cuota y 2 registros', async () => {
        respond('no es json', '{"n": 7}');
        const r = await runAi(req({ schema, retries: 2 }));
        expect(r.data).toEqual({ n: 7 });
        expect(sent).toHaveLength(2);
        expect(m.checkQuotas).toHaveBeenCalledTimes(2);
        expect(m.recordUsage).toHaveBeenCalledTimes(2);
        expect(m.recordUsage.mock.calls[0][0]).toMatchObject({ ok: false, errorCode: 'schema_validation_failed' });
        expect(m.recordUsage.mock.calls[1][0]).toMatchObject({ ok: true });
        const hint = body(1).messages.at(-1).content;
        expect(hint).toContain('previous answer was invalid');
        expect(hint).not.toContain('no es json');
    });
    it('agota reintentos -> schema_validation_failed con ruta, sin contenido del modelo', async () => {
        respond('{"n": "MODELO-CONTENIDO"}');
        const e = await fails(runAi(req({ schema, retries: 2 })));
        expect(e).toMatchObject({ code: 'schema_validation_failed', status: 422, detail: '$.n:type' });
        expect(sent).toHaveLength(3);
        expect(m.checkQuotas).toHaveBeenCalledTimes(3);
        expect(m.recordUsage).toHaveBeenCalledTimes(3);
        expect(JSON.stringify(e)).not.toContain('MODELO-CONTENIDO');
        expect(sent.slice(1).every((s) => !s.body.includes('MODELO-CONTENIDO'))).toBe(true);
    });
    it('la cuota se agota entre reintentos', async () => {
        respond('mal');
        m.checkQuotas.mockResolvedValueOnce(null).mockResolvedValueOnce({ scope: 'user', metric: 'requestsDay', period: 'day', retryAfter: 5 });
        expect(await fails(runAi(req({ schema, retries: 2 })))).toMatchObject({ code: 'quota_exceeded' });
        expect(sent).toHaveLength(1);
    });
    it('responseFormat json sin schema', async () => {
        respond('texto {"a":1} fin');
        expect((await runAi(req({ responseFormat: 'json' }))).data).toEqual({ a: 1 });
        respond('sin json');
        expect(await fails(runAi(req({ responseFormat: 'json' })))).toMatchObject({ detail: 'not_json' });
    });
    it('retries se topa en 2 y se ignora sin schema', async () => {
        respond('mal');
        await fails(runAi(req({ schema, retries: 99 })));
        expect(sent).toHaveLength(3);
        sent = [];
        await fails(runAi(req({ responseFormat: 'json', retries: 2 })));
        expect(sent).toHaveLength(1);
    });
});

describe('privacidad de logs', () => {
    it('ni recordUsage ni console reciben prompts/respuestas', async () => {
        const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => undefined));
        respond('RESPUESTA-PRIVADA');
        await runAi(req({ prompt: 'PROMPT-PRIVADO 4111 1111 1111 1111', system: 'SYSTEM-PRIVADO' }));
        __setTransport(async () => ({ status: 500, body: 'x' }));
        await fails(runAi(req({ prompt: 'PROMPT-PRIVADO' })));
        const dump = JSON.stringify(m.recordUsage.mock.calls) + JSON.stringify(spies.map((s) => s.mock.calls));
        expect(dump).not.toMatch(/PRIVAD|4111|sk-test-key/);
        for (const [u] of m.recordUsage.mock.calls) expect(Object.keys(u).sort()).toEqual(['costUsd', 'errorCode', 'extensionId', 'feature', 'flags', 'model', 'ok', 'provider', 'tokensIn', 'tokensOut', 'userId'].sort());
    });
});

describe('statusFor', () => {
    it('reflexa razones sin llamar al proveedor', async () => {
        m.remainingFor.mockResolvedValue({ requestsDay: 5, requestsMonth: 5, tokensDay: -1, tokensMonth: -1 });
        expect((await statusFor('u1', 'composer')).available).toBe(true);
        m.remainingFor.mockResolvedValue({ requestsDay: 0, requestsMonth: 5, tokensDay: -1, tokensMonth: -1 });
        expect((await statusFor('u1', 'composer')).reason).toBe('quota_exceeded');
        m.resolveAi.mockResolvedValue(resolved({ enabled: false }));
        expect((await statusFor('u1', 'composer')).reason).toBe('ai_disabled');
        expect(JSON.stringify(await statusFor('u1', 'composer'))).not.toContain('sk-test');
    });
});
