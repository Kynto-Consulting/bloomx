import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiError } from '../types';
import { __setTransport, buildRequest, callProvider, type ProviderCall } from '../providers';
import type { TransportRequest } from '../url-guard';

const call = (over: Partial<ProviderCall> = {}): ProviderCall => ({
    provider: 'openai', model: 'm1', apiKey: 'KEY-SECRET-123', baseUrl: null, system: 'SYS',
    messages: [{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'ey' }, { role: 'user', content: 'ultimo' }],
    temperature: 0.2, maxTokens: 100, timeoutMs: 5000, ...over,
});
const schema = { type: 'object' as const, properties: { a: { type: 'string' as const } }, additionalProperties: false };

afterEach(() => __setTransport(null));

describe('buildRequest', () => {
    it('openai: bearer, system primero, json_schema con schema', () => {
        const r = buildRequest(call({ json: { schema } }));
        expect(r.url).toBe('https://api.openai.com/v1/chat/completions');
        expect(r.headers.Authorization).toBe('Bearer KEY-SECRET-123');
        const b = r.body as any;
        expect(b.messages[0]).toEqual({ role: 'system', content: 'SYS' });
        expect(b.response_format.type).toBe('json_schema');
        expect((buildRequest(call({ json: {} })).body as any).response_format).toEqual({ type: 'json_object' });
        expect((buildRequest(call({ system: '' })).body as any).messages[0].role).toBe('user');
    });
    it('openrouter usa json_object aun con schema', () => {
        const r = buildRequest(call({ provider: 'openrouter', json: { schema } }));
        expect(r.url).toBe('https://openrouter.ai/api/v1/chat/completions');
        expect((r.body as any).response_format).toEqual({ type: 'json_object' });
    });
    it('compatible exige baseUrl segura', () => {
        const r = buildRequest(call({ provider: 'compatible', baseUrl: 'https://llm.example.com/v1/' }));
        expect(r.url).toBe('https://llm.example.com/v1/chat/completions');
        expect(() => buildRequest(call({ provider: 'compatible', baseUrl: 'http://127.0.0.1/v1' }))).toThrow();
        expect(() => buildRequest(call({ provider: 'compatible', baseUrl: null }))).toThrow();
    });
    it('azure: api-key, deployment en la ruta y sin model en el cuerpo', () => {
        const r = buildRequest(call({ provider: 'azure-openai', model: 'dep one', baseUrl: 'https://x.openai.azure.com' }));
        expect(r.url).toBe('https://x.openai.azure.com/openai/deployments/dep%20one/chat/completions?api-version=2024-10-21');
        expect(r.headers['api-key']).toBe('KEY-SECRET-123');
        expect(r.headers.Authorization).toBeUndefined();
        expect((r.body as any).model).toBeUndefined();
    });
    it('anthropic: system aparte, tool-use forzado con schema, temperatura <= 1', () => {
        const r = buildRequest(call({ provider: 'anthropic', temperature: 1.8, json: { schema }, messages: [{ role: 'user', content: 'x' }] }));
        const b = r.body as any;
        expect(r.headers['x-api-key']).toBe('KEY-SECRET-123');
        expect(r.headers['anthropic-version']).toBeTruthy();
        expect(b.system).toBe('SYS');
        expect(b.temperature).toBe(1);
        expect(b.tools[0].name).toBe('respond');
        expect(b.tool_choice).toEqual({ type: 'tool', name: 'respond' });
        expect(b.messages.every((m: any) => m.role !== 'system')).toBe(true);
        expect((buildRequest(call({ provider: 'anthropic' })).body as any).tools).toBeUndefined();
    });
    it('gemini: responseSchema, systemInstruction, rol model, clave en cabecera (no en URL)', () => {
        const r = buildRequest(call({ provider: 'google', model: 'gemini-x', json: { schema } }));
        const b = r.body as any;
        expect(r.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent');
        expect(r.url).not.toContain('KEY');
        expect(r.headers['x-goog-api-key']).toBe('KEY-SECRET-123');
        expect(b.generationConfig.responseMimeType).toBe('application/json');
        expect(b.generationConfig.responseSchema.type).toBe('OBJECT');
        expect(b.systemInstruction.parts[0].text).toBe('SYS');
        expect(b.contents[1].role).toBe('model');
    });
    it('cohere: message final, chat_history y preamble', () => {
        const b = buildRequest(call({ provider: 'cohere' })).body as any;
        expect(b.message).toBe('ultimo');
        expect(b.chat_history).toEqual([{ role: 'USER', message: 'hola' }, { role: 'CHATBOT', message: 'ey' }]);
        expect(b.preamble).toBe('SYS');
    });
});

describe('callProvider con transporte falso', () => {
    const capture = (res: { status: number; body: string }) => {
        const seen: TransportRequest[] = [];
        __setTransport(async (r) => { seen.push(r); return res; });
        return seen;
    };
    it('parsea openai y estima tokens si faltan', async () => {
        const seen = capture({ status: 200, body: JSON.stringify({ choices: [{ message: { content: 'respuesta' } }] }) });
        const out = await callProvider(call());
        expect(out.text).toBe('respuesta');
        expect(out.tokensIn).toBeGreaterThan(0);
        expect(out.tokensOut).toBeGreaterThan(0);
        expect(JSON.parse(seen[0].body).messages).toBeTruthy();
    });
    it('anthropic tool_use se serializa como JSON', async () => {
        capture({ status: 200, body: JSON.stringify({ content: [{ type: 'tool_use', input: { a: 'x' } }], usage: { input_tokens: 3, output_tokens: 4 } }) });
        const out = await callProvider(call({ provider: 'anthropic', json: { schema } }));
        expect(JSON.parse(out.text)).toEqual({ a: 'x' });
        expect(out).toMatchObject({ tokensIn: 3, tokensOut: 4 });
    });
    it('gemini y cohere', async () => {
        capture({ status: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'g' }] } }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1 } }) });
        expect(await callProvider(call({ provider: 'google' }))).toMatchObject({ text: 'g', tokensIn: 2, tokensOut: 1 });
        capture({ status: 200, body: JSON.stringify({ text: 'c', meta: { tokens: { input_tokens: 5, output_tokens: 6 } } }) });
        expect(await callProvider(call({ provider: 'cohere' }))).toMatchObject({ text: 'c', tokensIn: 5, tokensOut: 6 });
    });
    it('error HTTP -> provider_error sin cuerpo ni clave', async () => {
        capture({ status: 401, body: 'invalid key KEY-SECRET-123 body-del-proveedor' });
        const e: AiError = await callProvider(call()).catch((x) => x);
        expect(e).toBeInstanceOf(AiError);
        expect(e.code).toBe('provider_error');
        expect(e.detail).toBe('http_401');
        expect(JSON.stringify({ m: e.message, d: e.detail })).not.toMatch(/KEY-SECRET|body-del/);
    });
    it('fallos de red/timeout/host bloqueado y cuerpo no JSON o vacio', async () => {
        __setTransport(async () => { throw new Error('connect to KEY-SECRET-123 timeout'); });
        expect(await callProvider(call()).catch((x) => x)).toMatchObject({ code: 'provider_error', detail: 'timeout' });
        __setTransport(async () => { throw new Error('private_ip'); });
        expect(await callProvider(call()).catch((x) => x)).toMatchObject({ detail: 'blocked_host' });
        __setTransport(async () => { throw new Error('ECONNRESET'); });
        expect(await callProvider(call()).catch((x) => x)).toMatchObject({ detail: 'network' });
        capture({ status: 200, body: '<html>' });
        expect(await callProvider(call()).catch((x) => x)).toMatchObject({ detail: 'bad_response' });
        capture({ status: 200, body: '{"choices":[]}' });
        expect(await callProvider(call()).catch((x) => x)).toMatchObject({ detail: 'empty' });
    });
    it('baseUrl insegura -> not_configured', async () => {
        const t = vi.fn();
        __setTransport(t as any);
        expect(await callProvider(call({ provider: 'compatible', baseUrl: 'http://10.0.0.1' })).catch((x) => x)).toMatchObject({ code: 'not_configured' });
        expect(t).not.toHaveBeenCalled();
    });
});
